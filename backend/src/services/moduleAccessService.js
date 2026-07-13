const { createHttpError } = require("../middleware/errorHandler");

function isEnabledFlag(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

const RESTARBEJDE_ACTIONS = Object.freeze([
  "read",
  "create",
  "update",
  "close",
  "archive",
  "restore",
  "comment",
  "manage_placements",
  "manage_drawings",
  "manage_photos",
  "export",
  "report",
]);

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
  resource_groups: Object.freeze({
    key: "resource_groups",
    enabled: true,
    actions: Object.freeze(["read", "create", "update", "delete"]),
  }),
  tenant_admin: Object.freeze({
    key: "tenant_admin",
    enabled: true,
    actions: Object.freeze(["read", "create", "update", "invite", "sync"]),
  }),
  project_equipment_beta: Object.freeze({
    key: "project_equipment_beta",
    enabled: isEnabledFlag(process.env.PROJECT_EQUIPMENT_BETA_ENABLED),
    actions: Object.freeze(["read", "create", "update", "delete", "export"]),
  }),
  project_restarbejde: Object.freeze({
    key: "project_restarbejde",
    enabled: true,
    actions: RESTARBEJDE_ACTIONS,
  }),
});

const ROLE_PERMISSIONS = Object.freeze({
  tenant_admin: Object.freeze([
    "qa:read",
    "qa:create",
    "qa:update",
    "calendar_absence:read",
    "calendar_absence:create",
    "resource_groups:read",
    "resource_groups:create",
    "resource_groups:update",
    "resource_groups:delete",
    "tenant_admin:read",
    "tenant_admin:create",
    "tenant_admin:update",
    "tenant_admin:invite",
    "tenant_admin:sync",
    "project_equipment_beta:read",
    "project_equipment_beta:create",
    "project_equipment_beta:update",
    "project_equipment_beta:delete",
    "project_equipment_beta:export",
    ...RESTARBEJDE_ACTIONS.map((action) => `project_restarbejde:${action}`),
  ]),
  project_leader: Object.freeze([
    "qa:read",
    "qa:create",
    "qa:update",
    "project_equipment_beta:read",
    "project_equipment_beta:create",
    "project_equipment_beta:update",
    "project_equipment_beta:delete",
    "project_equipment_beta:export",
    ...RESTARBEJDE_ACTIONS.map((action) => `project_restarbejde:${action}`),
  ]),
  technician: Object.freeze([
    "qa:read",
    "qa:create",
    "project_equipment_beta:read",
    "project_equipment_beta:create",
    "project_equipment_beta:update",
    "project_equipment_beta:export",
    "project_restarbejde:read",
    "project_restarbejde:create",
    "project_restarbejde:update",
    "project_restarbejde:comment",
    "project_restarbejde:manage_placements",
    "project_restarbejde:manage_photos",
  ]),
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
