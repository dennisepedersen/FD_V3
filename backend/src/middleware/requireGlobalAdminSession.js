const env = require("../config/env");
const pool = require("../db/pool");
const globalAdminQueries = require("../db/queries/globalAdmin");
const { verifyToken } = require("../services/jwtService");
const { createHttpError } = require("./errorHandler");

const PORTAL_SESSION_COOKIE_NAME = "fd_portal_session";

function portalSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  };
}

function parseCookies(headerValue) {
  const cookies = {};
  String(headerValue || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) {
        return;
      }
      const key = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      cookies[key] = decodeURIComponent(value);
    });
  return cookies;
}

async function getGlobalAdminSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[PORTAL_SESSION_COOKIE_NAME];
  if (!token) {
    return null;
  }

  let payload;
  try {
    payload = verifyToken(token, "global_admin");
  } catch (error) {
    return null;
  }

  const client = await pool.connect();
  try {
    const user = await globalAdminQueries.findActiveGlobalAdminById(client, {
      id: payload.sub,
    });
    if (!user) {
      return null;
    }

    return {
      token,
      payload,
      user,
    };
  } finally {
    client.release();
  }
}

async function requireGlobalAdminSession(req, res, next) {
  try {
    const session = await getGlobalAdminSession(req);
    if (!session) {
      res.clearCookie(PORTAL_SESSION_COOKIE_NAME, portalSessionCookieOptions());
      return next(createHttpError(401, "portal_auth_required"));
    }

    req.globalAdmin = {
      actorId: session.user.id,
      username: session.user.username,
      displayName: session.user.display_name,
      authType: "portal_session",
    };
    req.globalAdminSession = session;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  PORTAL_SESSION_COOKIE_NAME,
  portalSessionCookieOptions,
  getGlobalAdminSession,
  requireGlobalAdminSession,
};