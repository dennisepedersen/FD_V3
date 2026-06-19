const { createHttpError } = require("../middleware/errorHandler");

const MODULE_REGISTRY = Object.freeze({
  qa: Object.freeze({
    key: "qa",
    enabled: true,
    actions: Object.freeze(["read", "create", "update"]),
  }),
  calendar_absence: Object.freeze({
    key: "calendar_absence",
    enabled: true,
    actions: Object.freeze(["read", "create"]),
  }),
});

const ROLE_PERMISSIONS = Object.freeze({
  tenant_admin: Object.freeze([
    "qa:read",
    "qa:create",
    "qa:update",
    "calendar_absence:read",
    "calendar_absence:create",
  ]),
  project_leader: Object.freeze(["qa:read", "qa:create", "qa:update"]),
  technician: Object.freeze(["qa:read", "qa:create"]),
});

function safeDeny() {
  throw createHttpError(403, "module_access_denied");
}

function normalizeRequiredString(value) {
  const normalized = value == null ? "" : String(value).trim();
  if (!normalized) {
    safeDeny();
  }
  return normalized;
}

function requireModuleAccess({ tenant, auth, moduleKey, action }) {
  if (!tenant || !auth) {
    safeDeny();
  }

  const tenantId = normalizeRequiredString(tenant.id);
  const authTenantId = normalizeRequiredString(auth.tenant_id);
  const userId = normalizeRequiredString(auth.sub);
  const role = normalizeRequiredString(auth.role);
  const normalizedModuleKey = normalizeRequiredString(moduleKey).toLowerCase();
  const normalizedAction = normalizeRequiredString(action).toLowerCase();

  if (authTenantId !== tenantId) {
    safeDeny();
  }

  const module = MODULE_REGISTRY[normalizedModuleKey];
  if (!module || module.enabled !== true) {
    safeDeny();
  }

  if (!module.actions.includes(normalizedAction)) {
    safeDeny();
  }

  const permission = `${normalizedModuleKey}:${normalizedAction}`;
  const rolePermissions = ROLE_PERMISSIONS[role] || [];
  if (!rolePermissions.includes(permission)) {
    safeDeny();
  }

  return {
    tenantId,
    userId,
    role,
    moduleKey: normalizedModuleKey,
    action: normalizedAction,
    permission,
    module: {
      key: module.key,
      enabled: module.enabled,
    },
  };
}

module.exports = {
  requireModuleAccess,
};
