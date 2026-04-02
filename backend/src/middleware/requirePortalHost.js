const { createHttpError } = require("./errorHandler");

function requirePortalHost(req, res, next) {
  if (!req.context || req.context.domainScope !== "portal") {
    return next(createHttpError(403, "deny_wrong_domain"));
  }
  return next();
}

module.exports = requirePortalHost;