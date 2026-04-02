const env = require("../config/env");
const pool = require("../db/pool");
const auditQueries = require("../db/queries/audit");
const globalAdminQueries = require("../db/queries/globalAdmin");
const { createHttpError } = require("../middleware/errorHandler");
const { hashPassword, verifyPassword } = require("./passwordService");
const { issueGlobalAdminToken } = require("./jwtService");

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function validateUsername(username) {
  if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
    throw createHttpError(400, "Invalid username format");
  }
}

function validatePassword(password) {
  if (!password || String(password).length === 0) {
    throw createHttpError(400, "Missing password");
  }
}

function bootstrapConfigured() {
  return Boolean(env.BOOTSTRAP_GLOBAL_ADMIN_USERNAME && env.BOOTSTRAP_GLOBAL_ADMIN_PASSWORD);
}

function matchesBootstrapCredentials(username, password) {
  return bootstrapConfigured()
    && username === normalizeUsername(env.BOOTSTRAP_GLOBAL_ADMIN_USERNAME)
    && password === env.BOOTSTRAP_GLOBAL_ADMIN_PASSWORD;
}

async function writeAuditEvent({ actorId, eventType, outcome, reason, metadata, targetId }) {
  const client = await pool.connect();
  try {
    await auditQueries.insertAuditEvent(client, {
      actorId,
      actorScope: "global",
      tenantId: null,
      eventType,
      targetType: "global_admin_user",
      targetId: targetId || null,
      outcome,
      reason,
      metadata,
    });
  } finally {
    client.release();
  }
}

async function authenticatePortalLogin({ username, password, ipAddress, userAgent }) {
  const normalizedUsername = normalizeUsername(username);
  validateUsername(normalizedUsername);
  validatePassword(password);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await globalAdminQueries.lockGlobalAdminTable(client);

    const adminCount = await globalAdminQueries.countGlobalAdmins(client);
    const bootstrapAllowed = adminCount === 0;
    let user = null;
    let bootstrapCreated = false;

    if (bootstrapAllowed && matchesBootstrapCredentials(normalizedUsername, password)) {
      const passwordHash = await hashPassword(password);
      user = await globalAdminQueries.createGlobalAdminUser(client, {
        username: normalizedUsername,
        passwordHash,
        displayName: env.BOOTSTRAP_GLOBAL_ADMIN_DISPLAY_NAME || normalizedUsername,
        bootstrapCreated: true,
      });
      bootstrapCreated = true;
    } else {
      user = await globalAdminQueries.findActiveGlobalAdminByUsername(client, {
        username: normalizedUsername,
      });

      if (!user) {
        await client.query("ROLLBACK");
        await writeAuditEvent({
          actorId: "anonymous",
          eventType: "login_fail",
          outcome: "fail",
          reason: "global_admin_login_fail",
          targetId: null,
          metadata: {
            username: normalizedUsername,
            ip_address: ipAddress || null,
            user_agent: userAgent || null,
            bootstrap_allowed: bootstrapAllowed,
          },
        });
        throw createHttpError(401, "Invalid credentials");
      }

      const passwordOk = await verifyPassword(password, user.password_hash);
      if (!passwordOk) {
        await client.query("ROLLBACK");
        await writeAuditEvent({
          actorId: user.id,
          eventType: "login_fail",
          outcome: "fail",
          reason: "global_admin_login_fail",
          targetId: user.id,
          metadata: {
            username: normalizedUsername,
            ip_address: ipAddress || null,
            user_agent: userAgent || null,
            bootstrap_allowed: bootstrapAllowed,
          },
        });
        throw createHttpError(401, "Invalid credentials");
      }

      user = await globalAdminQueries.touchGlobalAdminLastLogin(client, {
        userId: user.id,
      });
    }

    await auditQueries.insertAuditEvent(client, {
      actorId: user.id,
      actorScope: "global",
      tenantId: null,
      eventType: "login_success",
      targetType: "global_admin_user",
      targetId: user.id,
      outcome: "success",
      reason: bootstrapCreated ? "global_admin_bootstrap_first_login" : "global_admin_login_success",
      metadata: {
        username: user.username,
        display_name: user.display_name,
        ip_address: ipAddress || null,
        user_agent: userAgent || null,
        bootstrap_created: bootstrapCreated,
      },
    });

    await client.query("COMMIT");

    return {
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        bootstrap_created: Boolean(user.bootstrap_created),
      },
      token: issueGlobalAdminToken({
        userId: user.id,
        username: user.username,
        displayName: user.display_name,
      }),
      bootstrap_created: bootstrapCreated,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      // Keep primary error.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function writeLogoutAudit({ userId, username, ipAddress, userAgent }) {
  await writeAuditEvent({
    actorId: userId,
    eventType: "logout",
    outcome: "success",
    reason: "global_admin_logout",
    targetId: userId,
    metadata: {
      username,
      ip_address: ipAddress || null,
      user_agent: userAgent || null,
    },
  });
}

module.exports = {
  authenticatePortalLogin,
  writeLogoutAudit,
};