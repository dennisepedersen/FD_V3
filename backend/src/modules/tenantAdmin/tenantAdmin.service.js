const crypto = require("crypto");
const pool = require("../../db/pool");
const { withTransaction } = require("../../db/tx");
const { createHttpError } = require("../../middleware/errorHandler");
const { hashPassword } = require("../../services/passwordService");
const auditService = require("../../services/auditService");
const repository = require("./tenantAdmin.repository");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_ROLES = new Set(["tenant_admin", "project_leader", "technician"]);
const ALLOWED_USER_STATUSES = new Set(["active", "suspended", "invited", "deleted"]);
const ALLOWED_ASSIGNMENT_ROLES = new Set(["owner", "contributor", "reviewer"]);
const LIFECYCLE_STATUSES = new Set(["deactivated", "pending_reactivation"]);
const SUPPORTED_SYNC_ENTITIES = new Map([
  ["fitters", "fitters"],
  ["fitter", "fitters"],
  ["resource-groups", "fitters"],
  ["resource_groups", "fitters"],
  ["resourcegroups", "fitters"],
]);

function requiredText(value, code) {
  const normalized = value == null ? "" : String(value).trim();
  if (!normalized) {
    throw createHttpError(400, code);
  }
  return normalized;
}

function optionalText(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeUuid(value, code) {
  const normalized = requiredText(value, code).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw createHttpError(400, code);
  }
  return normalized;
}

function normalizeEmail(value) {
  const email = requiredText(value, "email_required").toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw createHttpError(400, "invalid_email");
  }
  return email;
}

function normalizeRole(value, fallback = "technician") {
  const role = optionalText(value) || fallback;
  if (!ALLOWED_ROLES.has(role)) {
    throw createHttpError(400, "invalid_role");
  }
  return role;
}


function normalizeAssignmentRole(value) {
  const role = optionalText(value) || "contributor";
  if (!ALLOWED_ASSIGNMENT_ROLES.has(role)) {
    throw createHttpError(400, "invalid_project_assignment_role");
  }
  return role;
}
function normalizeStatus(value, fallback = "invited") {
  const status = optionalText(value) || fallback;
  if (LIFECYCLE_STATUSES.has(status)) {
    throw createHttpError(409, "tenant_user_lifecycle_transition_requires_dedicated_endpoint");
  }
  if (!ALLOWED_USER_STATUSES.has(status)) {
    throw createHttpError(400, "invalid_user_status");
  }
  return status;
}

function assertManualStatusPatchAllowed({ currentStatus, requestedStatus }) {
  if (!requestedStatus) return;
  if (LIFECYCLE_STATUSES.has(requestedStatus) || LIFECYCLE_STATUSES.has(currentStatus)) {
    throw createHttpError(409, "tenant_user_lifecycle_transition_requires_dedicated_endpoint");
  }
}
function initialsFromEmail(email) {
  const prefix = String(email || "").split("@")[0] || "";
  const compact = prefix.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
  return compact ? compact.toUpperCase() : null;
}

function normalizeUsername(value, email) {
  const explicit = optionalText(value);
  const candidate = explicit || initialsFromEmail(email);
  if (!candidate) return null;
  return candidate.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toLowerCase() || null;
}

function normalizeEndpoint(source, entity) {
  const normalizedSource = String(source || "").trim().toLowerCase();
  if (normalizedSource !== "ekomplet") {
    throw createHttpError(400, "unsupported_integration_source");
  }
  const normalizedEntity = String(entity || "").trim().toLowerCase();
  const endpointKey = SUPPORTED_SYNC_ENTITIES.get(normalizedEntity);
  if (!endpointKey) {
    throw createHttpError(400, "unsupported_sync_entity");
  }
  return { source: normalizedSource, entity: normalizedEntity, endpointKey };
}

async function audit(client, input) {
  await auditService.logAuditEvent({
    client,
    tenantId: input.tenantId,
    actorId: input.actorId,
    actorType: "tenant_user",
    actorScope: "tenant",
    moduleKey: "tenant_admin",
    eventType: input.eventType,
    resourceType: input.resourceType,
    resourceId: input.resourceId || null,
    outcome: input.outcome || "success",
    reason: input.reason || null,
    metadata: input.metadata || {},
  });
}

async function listUsers({ tenantId, search }) {
  const normalizedTenantId = normalizeUuid(tenantId, "tenant_id_required");
  const client = await pool.connect();
  try {
    const users = await repository.listUsers(client, {
      tenantId: normalizedTenantId,
      search: optionalText(search),
    });
    return { users };
  } finally {
    client.release();
  }
}

async function createManualUser(input) {
  const tenantId = normalizeUuid(input?.tenantId, "tenant_id_required");
  const actorId = normalizeUuid(input?.actorId, "actor_id_required");
  const email = normalizeEmail(input?.email);
  const name = requiredText(input?.name, "name_required");
  const role = normalizeRole(input?.role);
  const status = normalizeStatus(input?.status, "invited");
  const loginStatus = status === "active" ? "active" : "imported_no_login";
  const username = normalizeUsername(input?.shortCode || input?.username, email);
  const note = optionalText(input?.note);
  const passwordHash = await hashPassword(crypto.randomBytes(24).toString("base64url"));

  return withTransaction(async (client) => {
    const existingByEmail = await repository.findTenantUserByEmail(client, { tenantId, email });
    if (existingByEmail) {
      if (["deactivated", "pending_reactivation"].includes(existingByEmail.status)) {
        throw createHttpError(409, "tenant_user_requires_reactivation");
      }
      throw createHttpError(400, "tenant_user_already_exists");
    }

    let user;
    try {
      user = await repository.createManualTenantUser(client, {
        tenantId,
        email,
        name,
        role,
        status,
        username,
        passwordHash,
        loginStatus,
      });
    } catch (error) {
      if (error && error.code === "23505") {
        throw createHttpError(400, "tenant_user_already_exists");
      }
      throw error;
    }

    const fitterId = `manual:${user.id}`;
    const fitter = await repository.createManualFitterForTenantUser(client, {
      tenantId,
      tenantUserId: user.id,
      fitterId,
      name,
      email,
      username,
      note,
    });

    await audit(client, {
      tenantId,
      actorId,
      eventType: "tenant_user_created",
      resourceType: "tenant_user",
      resourceId: user.id,
      metadata: {
        source: "manual",
        fitter_id: fitter.fitter_id,
        role,
        status,
      },
    });

    return { user, fitter };
  });
}

async function updateManualUser(input) {
  const tenantId = normalizeUuid(input?.tenantId, "tenant_id_required");
  const actorId = normalizeUuid(input?.actorId, "actor_id_required");
  const userId = normalizeUuid(input?.userId, "user_id_required");
  const patch = {};

  if (Object.prototype.hasOwnProperty.call(input || {}, "name")) {
    patch.name = requiredText(input.name, "name_required");
  }
  if (Object.prototype.hasOwnProperty.call(input || {}, "role")) {
    patch.role = normalizeRole(input.role);
  }
  if (Object.prototype.hasOwnProperty.call(input || {}, "status")) {
    patch.status = normalizeStatus(input.status);
  }
  if (Object.prototype.hasOwnProperty.call(input || {}, "shortCode")
      || Object.prototype.hasOwnProperty.call(input || {}, "username")) {
    patch.hasUsername = true;
    patch.username = normalizeUsername(input.shortCode || input.username, "");
  }
  if (Object.prototype.hasOwnProperty.call(input || {}, "note")) {
    patch.hasNote = true;
    patch.note = optionalText(input.note);
  }

  if (Object.keys(patch).length === 0) {
    throw createHttpError(400, "user_patch_empty");
  }

  return withTransaction(async (client) => {
    const existing = await repository.findTenantUser(client, { tenantId, userId });
    if (!existing) {
      throw createHttpError(404, "tenant_user_not_found");
    }
    assertManualStatusPatchAllowed({
      currentStatus: existing.status,
      requestedStatus: patch.status,
    });

    const user = await repository.updateManualTenantUser(client, {
      tenantId,
      userId,
      ...patch,
    });
    await repository.updateManualFitterForTenantUser(client, {
      tenantId,
      userId,
      ...patch,
    });

    await audit(client, {
      tenantId,
      actorId,
      eventType: "tenant_user_updated",
      resourceType: "tenant_user",
      resourceId: userId,
      metadata: {
        fields: Object.keys(patch),
      },
    });

    return { user };
  });
}

async function deactivateUser(input) {
  const tenantId = normalizeUuid(input?.tenantId, "tenant_id_required");
  const actorId = normalizeUuid(input?.actorId, "actor_id_required");
  const userId = normalizeUuid(input?.userId, "user_id_required");
  const reason = requiredText(input?.reason, "deactivation_reason_required");

  if (actorId === userId) {
    throw createHttpError(409, "self_deactivation_not_allowed");
  }

  const passwordHash = await hashPassword(crypto.randomBytes(24).toString("base64url"));

  return withTransaction(async (client) => {
    await repository.acquireTenantLifecycleLock(client, { tenantId });

    const existing = await repository.findTenantUserForUpdate(client, { tenantId, userId });
    if (!existing) {
      throw createHttpError(404, "tenant_user_not_found");
    }

    if (existing.status === "deactivated") {
      return { user: existing, already_deactivated: true, revoked_invitations: 0 };
    }

    if (existing.status === "pending_reactivation") {
      throw createHttpError(409, "tenant_user_pending_reactivation");
    }

    if (existing.status !== "active") {
      throw createHttpError(409, "tenant_user_not_active");
    }

    if (existing.role === "tenant_admin") {
      const activeAdminCount = await repository.countActiveTenantAdmins(client, { tenantId });
      if (activeAdminCount <= 1) {
        throw createHttpError(409, "last_active_tenant_admin");
      }
    }

    const revokedCount = await repository.revokeOpenTenantUserInvitations(client, { tenantId, userId });
    const user = await repository.deactivateTenantUser(client, {
      tenantId,
      userId,
      actorId,
      reason,
      passwordHash,
    });

    if (!user) {
      throw createHttpError(409, "tenant_user_deactivation_conflict");
    }

    await repository.insertTenantUserLifecycleEvent(client, {
      tenantId,
      userId,
      eventType: "deactivated",
      reason,
      actorId,
      metadata: { revoked_invitations: revokedCount },
    });
    await repository.insertTenantUserLifecycleEvent(client, {
      tenantId,
      userId,
      eventType: "sessions_revoked",
      reason: "session_version_bumped",
      actorId,
      metadata: { session_version: user.session_version },
    });

    await audit(client, {
      tenantId,
      actorId,
      eventType: "tenant_user_deactivated",
      resourceType: "tenant_user",
      resourceId: userId,
      reason,
      metadata: { revoked_invitations: revokedCount },
    });
    await audit(client, {
      tenantId,
      actorId,
      eventType: "tenant_user_sessions_revoked",
      resourceType: "tenant_user",
      resourceId: userId,
      reason: "session_version_bumped",
      metadata: { session_version: user.session_version },
    });

    return { user, already_deactivated: false, revoked_invitations: revokedCount };
  });
}
async function listResourceGroups({ tenantId, includeArchived, search }) {
  const normalizedTenantId = normalizeUuid(tenantId, "tenant_id_required");
  const client = await pool.connect();
  try {
    const groups = await repository.listResourceGroups(client, {
      tenantId: normalizedTenantId,
      includeArchived: includeArchived === true || String(includeArchived || "").toLowerCase() === "true",
      search: optionalText(search),
    });
    return { groups };
  } finally {
    client.release();
  }
}

async function listProjects(input) {
  const tenantId = normalizeUuid(input?.tenantId, "tenant_id_required");
  const client = await pool.connect();
  try {
    const projects = await repository.listProjects(client, {
      tenantId,
      search: optionalText(input?.search),
    });
    return { projects };
  } finally {
    client.release();
  }
}

async function listProjectAssignments(input) {
  const tenantId = normalizeUuid(input?.tenantId, "tenant_id_required");
  const projectId = normalizeUuid(input?.projectId, "project_id_required");
  const client = await pool.connect();
  try {
    const project = await repository.findProject(client, { tenantId, projectId });
    if (!project) {
      throw createHttpError(404, "project_not_found");
    }
    const assignments = await repository.listProjectAssignments(client, { tenantId, projectId });
    return { project, assignments };
  } finally {
    client.release();
  }
}

async function assignProjectUser(input) {
  const tenantId = normalizeUuid(input?.tenantId, "tenant_id_required");
  const actorId = normalizeUuid(input?.actorId, "actor_id_required");
  const projectId = normalizeUuid(input?.projectId, "project_id_required");
  const userId = normalizeUuid(input?.userId || input?.tenantUserId, "tenant_user_id_required");
  const assignmentRole = normalizeAssignmentRole(input?.assignmentRole || input?.assignment_role);

  return withTransaction(async (client) => {
    const project = await repository.findProject(client, { tenantId, projectId });
    if (!project) {
      throw createHttpError(404, "project_not_found");
    }

    const user = await repository.findAssignableTenantUser(client, { tenantId, userId });
    if (!user) {
      throw createHttpError(404, "tenant_user_not_found_or_not_assignable");
    }

    const assignment = await repository.upsertProjectAssignment(client, {
      tenantId,
      projectId,
      userId,
      assignmentRole,
    });
    if (!assignment) {
      throw createHttpError(409, "project_assignment_conflict");
    }

    await audit(client, {
      tenantId,
      actorId,
      eventType: "tenant_user_updated",
      resourceType: "project_assignment",
      resourceId: assignment.id,
      metadata: {
        action: assignment.inserted ? "project_assignment_created" : "project_assignment_updated",
        project_id: projectId,
        tenant_user_id: userId,
        assignment_role: assignmentRole,
      },
    });

    return { project, user, assignment };
  });
}

async function removeProjectUserAssignment(input) {
  const tenantId = normalizeUuid(input?.tenantId, "tenant_id_required");
  const actorId = normalizeUuid(input?.actorId, "actor_id_required");
  const projectId = normalizeUuid(input?.projectId, "project_id_required");
  const userId = normalizeUuid(input?.userId || input?.tenantUserId, "tenant_user_id_required");

  return withTransaction(async (client) => {
    const project = await repository.findProject(client, { tenantId, projectId });
    if (!project) {
      throw createHttpError(404, "project_not_found");
    }

    const assignment = await repository.deleteProjectAssignment(client, { tenantId, projectId, userId });
    if (!assignment) {
      throw createHttpError(404, "project_assignment_not_found");
    }

    await audit(client, {
      tenantId,
      actorId,
      eventType: "tenant_user_updated",
      resourceType: "project_assignment",
      resourceId: assignment.id,
      metadata: {
        action: "project_assignment_removed",
        project_id: projectId,
        tenant_user_id: userId,
        assignment_role: assignment.assignment_role,
      },
    });

    return { project, assignment };
  });
}
async function getSyncStatus({ tenantId }) {
  const normalizedTenantId = normalizeUuid(tenantId, "tenant_id_required");
  const endpoints = ["fitters"];
  const client = await pool.connect();
  try {
    const [hasEkomplet, rows] = await Promise.all([
      repository.hasEkompletIntegration(client, { tenantId: normalizedTenantId }),
      repository.listSyncStatus(client, { tenantId: normalizedTenantId, endpoints }),
    ]);
    const byEndpoint = new Map(rows.map((row) => [row.endpoint_key, row]));
    return {
      integration: {
        source: "ekomplet",
        configured: hasEkomplet,
      },
      endpoints: endpoints.map((endpointKey) => byEndpoint.get(endpointKey) || {
        endpoint_key: endpointKey,
        status: "idle",
        current_mode: null,
        sync_strategy: "reconcile_scan",
        current_job_id: null,
        last_job_id: null,
        last_attempt_at: null,
        last_successful_sync_at: null,
        rows_fetched: 0,
        rows_persisted: 0,
        pages_processed_last_job: 0,
        rows_fetched_last_job: 0,
        retry_count: 0,
        pending_backlog_count: 0,
        failed_page_count: 0,
        next_planned_at: null,
        last_error: null,
      }),
    };
  } finally {
    client.release();
  }
}

async function requestSync(input) {
  const tenantId = normalizeUuid(input?.tenantId, "tenant_id_required");
  const actorId = normalizeUuid(input?.actorId, "actor_id_required");
  const normalized = normalizeEndpoint(input?.source, input?.entity);

  return withTransaction(async (client) => {
    const hasEkomplet = await repository.hasEkompletIntegration(client, { tenantId });
    if (!hasEkomplet) {
      throw createHttpError(400, "ekomplet_integration_not_configured");
    }

    const active = await repository.findActiveEndpointJob(client, {
      tenantId,
      endpointKey: normalized.endpointKey,
    });
    if (active) {
      return {
        syncRun: {
          id: active.id,
          status: active.status,
          endpoint_key: normalized.endpointKey,
          reused: true,
        },
      };
    }

    await repository.ensureEndpointSelected(client, {
      tenantId,
      endpointKey: normalized.endpointKey,
    });

    const syncRun = await repository.createManualSyncJob(client, {
      tenantId,
      endpointKey: normalized.endpointKey,
      userId: actorId,
      metadata: {
        source: normalized.source,
        entity: normalized.entity,
        requested_from: "tenant_admin",
      },
    });

    await audit(client, {
      tenantId,
      actorId,
      eventType: "sync_requested",
      resourceType: "integration_sync",
      resourceId: syncRun.id,
      metadata: {
        source: normalized.source,
        entity: normalized.entity,
        endpoint_key: normalized.endpointKey,
      },
    });

    return { syncRun };
  });
}

module.exports = {
  assignProjectUser,
  createManualUser,
  deactivateUser,
  getSyncStatus,
  listProjectAssignments,
  listProjects,
  listResourceGroups,
  listUsers,
  requestSync,
  removeProjectUserAssignment,
  updateManualUser,
  _test: {
    assertManualStatusPatchAllowed,
    normalizeAssignmentRole,
    normalizeStatus,
  },
};
