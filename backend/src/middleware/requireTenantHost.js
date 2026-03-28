const { createHttpError } = require("./errorHandler");

function requireTenantHost(req, res, next) {
  if (!req.context || req.context.domainScope !== "tenant") {
    return next(createHttpError(403, "deny_wrong_domain"));
  }

  if (!req.context.tenant || !req.context.tenant.id) {
    return next(createHttpError(403, "tenant_context_missing"));
  }

  return next();
}

module.exports = requireTenantHost;
