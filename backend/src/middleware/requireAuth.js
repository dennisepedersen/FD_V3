const pool = require("../db/pool");
const userQueries = require("../db/queries/user");
const { verifyToken } = require("../services/jwtService");
const { createHttpError } = require("./errorHandler");

function isActiveTenantUser(user) {
  return user
    && user.status === "active"
    && user.login_status === "active";
}

function normalizeSessionVersion(value, fallback) {
  if (value == null) {
    return fallback;
  }
  if (typeof value === "string" && value.trim() === "") {
    return NaN;
  }
  return Number(value);
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

      const databaseSessionVersion = normalizeSessionVersion(user.session_version, 0);
      const tokenSessionVersion = normalizeSessionVersion(payload.session_version, -1);

      if (
        !Number.isInteger(databaseSessionVersion)
        || !Number.isInteger(tokenSessionVersion)
        || databaseSessionVersion !== tokenSessionVersion
      ) {
        return next(createHttpError(401, "session_revoked"));
      }

      req.auth = {
        ...payload,
        role: user.role,
        email: user.email,
        session_version: databaseSessionVersion,
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
