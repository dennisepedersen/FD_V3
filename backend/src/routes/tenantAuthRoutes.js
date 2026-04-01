const express = require("express");
const pool = require("../db/pool");
const requireTenantHost = require("../middleware/requireTenantHost");
const { rateLimitRedis } = require("../middleware/rateLimitRedis");
const userQueries = require("../db/queries/user");
const auditQueries = require("../db/queries/audit");
const { verifyPassword } = require("../services/passwordService");
const { issueAccessToken } = require("../services/jwtService");
const { createHttpError } = require("../middleware/errorHandler");

const router = express.Router();
const loginRateLimit = rateLimitRedis({
  windowMs: 60 * 1000,
  maxRequests: 10,
});

router.post("/v1/auth/login", requireTenantHost, loginRateLimit, async (req, res, next) => {
  // Accepts { login, password } where login is a username (3-4 alpha chars) or legacy email.
  // Legacy mode: email fallback is kept for backward compatibility and is planned for phase-out.
  const { login, email: legacyEmail, password } = req.body || {};
  const identifier = login || legacyEmail;
  if (!identifier || !password) {
    return next(createHttpError(400, "Missing login fields"));
  }

  const client = await pool.connect();
  try {
    // Strategy: username-first lookup, then legacy email fallback.
    const isUsername = /^[a-zA-Z]{3,4}$/.test(String(identifier).trim());
    let user = null;
    if (isUsername) {
      user = await userQueries.findActiveUserByUsername(client, {
        tenantId: req.context.tenant.id,
        username: String(identifier).trim(),
      });
    }
    if (!user) {
      user = await userQueries.findActiveUserByEmail(client, {
        tenantId: req.context.tenant.id,
        email: identifier,
      });
    }

    if (!user || user.status !== "active") {
      await auditQueries.insertAuditEvent(client, {
        actorId: "anonymous",
        actorScope: "tenant",
        tenantId: req.context.tenant.id,
        eventType: "login_fail",
        targetType: "tenant_user",
        targetId: null,
        outcome: "fail",
        reason: "login_fail",
        metadata: { login: String(identifier).toLowerCase() },
      });
      throw createHttpError(401, "Invalid credentials");
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      await auditQueries.insertAuditEvent(client, {
        actorId: user.id,
        actorScope: "tenant",
        tenantId: req.context.tenant.id,
        eventType: "login_fail",
        targetType: "tenant_user",
        targetId: user.id,
        outcome: "fail",
        reason: "login_fail",
        metadata: { login: String(identifier).toLowerCase() },
      });
      throw createHttpError(401, "Invalid credentials");
    }

    const accessToken = issueAccessToken({
      userId: user.id,
      tenantId: user.tenant_id,
      role: user.role,
      email: user.email,
    });

    await auditQueries.insertAuditEvent(client, {
      actorId: user.id,
      actorScope: "tenant",
      tenantId: req.context.tenant.id,
      eventType: "login_success",
      targetType: "tenant_user",
      targetId: user.id,
      outcome: "success",
      reason: "login_success",
      metadata: {},
    });

    res.status(200).json({
      success: true,
      access_token: accessToken,
      token_type: "Bearer",
    });
  } catch (error) {
    next(error);
  } finally {
    client.release();
  }
});

module.exports = router;
