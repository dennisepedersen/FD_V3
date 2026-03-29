const env = require("../config/env");
const { createHttpError } = require("./errorHandler");

function requireGlobalAdmin(req, res, next) {
  if (!env.GLOBAL_ADMIN_API_KEY) {
    return next(createHttpError(503, "global_admin_not_configured"));
  }

  const apiKey = req.headers["x-global-admin-key"];
  const actorId = req.headers["x-global-admin-id"];

  if (!apiKey || apiKey !== env.GLOBAL_ADMIN_API_KEY) {
    return next(createHttpError(403, "deny_global_admin"));
  }

  if (!actorId || String(actorId).trim() === "") {
    return next(createHttpError(400, "Missing global admin actor id"));
  }

  req.globalAdmin = {
    actorId: String(actorId).trim(),
  };

  return next();
}

module.exports = requireGlobalAdmin;
