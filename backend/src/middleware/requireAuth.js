const pool = require("../db/pool");
const userQueries = require("../db/queries/user");
const { verifyToken } = require("../services/jwtService");
const { createHttpError } = require("./errorHandler");

function isActiveTenantUser(user) {
  return user
    && user.status === "active"
    && user.login_status === "active";
}

function requireAuth(expectedType) {
  return async (req, res, next) => {
    const header = req.headers.authorization || "";
    const [scheme, token] = header.split(" ");

    if (scheme !== "Bearer" || !token) {
      return next(createHttpError(401, "Missing Bearer token"));
    }

    let payload;
    try {
      payload = verifyToken(token, expectedType);
    } catch (error) {
      return next(createHttpError(401, "Invalid token"));
    }

    if (expectedType !== "access") {
      req.auth = payload;
      return next();
    }

    let client;
    try {
      client = await pool.connect();
      const user = await userQueries.findSessionTenantUserById(client, {
        tenantId: payload.tenant_id,
        userId: payload.sub,
      });

      if (!user || String(user.tenant_id) !== String(payload.tenant_id)) {
        return next(createHttpError(401, "tenant_user_not_found"));
      }

      if (!isActiveTenantUser(user)) {
        return next(createHttpError(401, "tenant_user_inactive"));
      }

      if (Number(user.session_version || 0) !== Number(payload.session_version || -1)) {
        return next(createHttpError(401, "session_revoked"));
      }

      req.auth = {
        ...payload,
        role: user.role,
        email: user.email,
        session_version: Number(user.session_version || 0),
      };
      return next();
    } catch (error) {
      return next(error);
    } finally {
      if (client) client.release();
    }
  };
}

module.exports = requireAuth;
