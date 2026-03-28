const express = require("express");
const pool = require("../db/pool");
const requireTenantHost = require("../middleware/requireTenantHost");
const userQueries = require("../db/queries/user");
const auditQueries = require("../db/queries/audit");
const { verifyPassword } = require("../services/passwordService");
const { issueAccessToken } = require("../services/jwtService");
const { createHttpError } = require("../middleware/errorHandler");

const router = express.Router();

router.post("/v1/auth/login", requireTenantHost, async (req, res, next) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return next(createHttpError(400, "Missing login fields"));
  }

  const client = await pool.connect();
  try {
    const user = await userQueries.findActiveUserByEmail(client, {
      tenantId: req.context.tenant.id,
      email,
    });

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
        metadata: { email: String(email).toLowerCase() },
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
        metadata: { email: String(email).toLowerCase() },
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
