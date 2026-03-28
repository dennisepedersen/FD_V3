const { createHttpError } = require("./errorHandler");

function requireRootHost(req, res, next) {
  if (!req.context || req.context.domainScope !== "root") {
    return next(createHttpError(403, "deny_wrong_domain"));
  }
  return next();
}

module.exports = requireRootHost;
