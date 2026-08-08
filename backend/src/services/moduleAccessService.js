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

const ABSENCE_REQUEST_ACTIONS = Object.freeze([
  "create_own",
  "read_own",
  "update_own_draft",
  "submit_own",
  "cancel_own",
  "read_own_history",
  "read_managed",
  "approve_managed",
  "reject_managed",
  "propose_change_managed",
  "read_private_comment",
  "administrative_override",
  "approve_before_review_date",
  "read_audit",
]);

const CALENDAR_EVENT_ACTIONS = Object.freeze([
  "read_own",
  "read_managed",
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
  absence_request: Object.freeze({
    key: "absence_request",
    enabled: true,
    actions: ABSENCE_REQUEST_ACTIONS,
  }),
  calendar_event: Object.freeze({
    key: "calendar_event",
    enabled: true,
    actions: CALENDAR_EVENT_ACTIONS,
  }),
  absence_type: Object.freeze({
    key: "absence_type",
    enabled: true,
    actions: Object.freeze(["manage"]),
  }),
  absence_special_window: Object.freeze({
    key: "absence_special_window",
    enabled: true,
    actions: Object.freeze(["manage", "review"]),
  }),
  employee_manager_relation: Object.freeze({
    key: "employee_manager_relation",
    enabled: true,
    actions: Object.freeze(["manage"]),
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

const OWN_ABSENCE_REQUEST_PERMISSIONS = Object.freeze([
  "absence_request:create_own",
  "absence_request:read_own",
  "absence_request:update_own_draft",
  "absence_request:submit_own",
  "absence_request:cancel_own",
  "absence_request:read_own_history",
]);

const OWN_CALENDAR_EVENT_PERMISSIONS = Object.freeze([
  "calendar_event:read_own",
]);

const ROLE_PERMISSIONS = Object.freeze({
  tenant_admin: Object.freeze([
    "qa:read",
    "qa:create",
    "qa:update",
    "calendar_absence:read",
    "calendar_absence:create",
    ...OWN_CALENDAR_EVENT_PERMISSIONS,
    ...OWN_ABSENCE_REQUEST_PERMISSIONS,
    "absence_request:administrative_override",
    "absence_request:approve_before_review_date",
    "absence_request:read_audit",
    "absence_type:manage",
    "absence_special_window:manage",
    "employee_manager_relation:manage",
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
    ...OWN_CALENDAR_EVENT_PERMISSIONS,
    ...OWN_ABSENCE_REQUEST_PERMISSIONS,
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
    ...OWN_CALENDAR_EVENT_PERMISSIONS,
    ...OWN_ABSENCE_REQUEST_PERMISSIONS,
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

function normalizePermissionList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((permission) => String(permission || "").trim().toLowerCase())
    .filter(Boolean);
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
  const actorPermissions = normalizePermissionList(auth.permissions);
  if (!rolePermissions.includes(permission) && !actorPermissions.includes(permission)) {
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
