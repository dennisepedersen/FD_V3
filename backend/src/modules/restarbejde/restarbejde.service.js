const pool = require("../../db/pool");
const { withTransaction } = require("../../db/tx");
const { createHttpError } = require("../../middleware/errorHandler");
const auditService = require("../../services/auditService");
const projectAccessService = require("../../services/projectAccessService");
const repository = require("./restarbejde.repository");

const MODULE_KEY = "project_restarbejde";
const RESOURCE_TYPE = "project_restarbejde_item";
const KINDS = Object.freeze(["internal_defect", "obs"]);
const INTERNAL_DEFECT_STATUSES = Object.freeze(["open", "in_progress", "ready_for_review", "closed"]);
const OBS_STATUSES = Object.freeze(["open", "monitoring", "blocking", "resolved"]);
const PRIORITIES = Object.freeze(["low", "normal", "high", "critical"]);
const RISKS = Object.freeze(["low", "medium", "high", "critical"]);

function normalizeOptionalText(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeRequiredText(value, message) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) throw createHttpError(400, message);
  return normalized;
}

function normalizeOptionalUuid(value, message) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw createHttpError(400, message);
  }
  return normalized;
}

function normalizeKind(value, existing) {
  const normalized = normalizeOptionalText(value || existing?.kind);
  if (!normalized || !KINDS.includes(normalized)) {
    throw createHttpError(400, "invalid_restarbejde_kind");
  }
  if (existing && normalized !== existing.kind) {
    throw createHttpError(400, "restarbejde_kind_immutable");
  }
  return normalized;
}

function normalizeStatus(value, kind, existing) {
  const normalized = normalizeOptionalText(value || existing?.status) || "open";
  const allowed = kind === "internal_defect" ? INTERNAL_DEFECT_STATUSES : OBS_STATUSES;
  if (!allowed.includes(normalized)) {
    throw createHttpError(400, "invalid_restarbejde_status");
  }
  return normalized;
}

function normalizePriority(value, kind, existing) {
  if (kind === "obs") {
    if (value !== undefined && value !== null && normalizeOptionalText(value)) {
      throw createHttpError(400, "restarbejde_obs_priority_not_allowed");
    }
    return null;
  }
  const normalized = normalizeOptionalText(value === undefined ? existing?.priority : value) || "normal";
  if (!PRIORITIES.includes(normalized)) {
    throw createHttpError(400, "invalid_restarbejde_priority");
  }
  return normalized;
}

function normalizeRisk(value, kind, existing) {
  if (kind === "internal_defect") {
    if (value !== undefined && value !== null && normalizeOptionalText(value)) {
      throw createHttpError(400, "restarbejde_internal_defect_risk_not_allowed");
    }
    return null;
  }
  const normalized = normalizeOptionalText(value === undefined ? existing?.risk : value);
  if (!normalized) {
    throw createHttpError(400, "restarbejde_risk_required");
  }
  if (!RISKS.includes(normalized)) {
    throw createHttpError(400, "invalid_restarbejde_risk");
  }
  return normalized;
}

function normalizePercentComplete(value, kind, status, existing) {
  if (kind === "obs") {
    if (value !== undefined && value !== null && value !== "") {
      throw createHttpError(400, "restarbejde_obs_percent_not_allowed");
    }
    return null;
  }
  if (status === "closed") {
    return 100;
  }
  const raw = value === undefined || value === null || value === "" ? existing?.percent_complete ?? 0 : value;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw createHttpError(400, "invalid_restarbejde_percent_complete");
  }
  return parsed;
}

function normalizeOptionalDate(value) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw createHttpError(400, "invalid_restarbejde_deadline");
  }
  return normalized;
}

function normalizeOptionalBoolean(value) {
  if (value === undefined || value === null || value === "") return null;
  return Boolean(value);
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return Boolean(value);
}

function normalizeImportPayload(value, existing) {
  if (value === undefined) return existing?.external_import_payload || {};
  if (value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw createHttpError(400, "restarbejde_import_payload_must_be_object");
  }
  return { ...value };
}

function normalizePayload(input, { existing = null, actorUserId, canCloseInternalDefect = false } = {}) {
  const body = input || {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  const kind = normalizeKind(has("kind") ? body.kind : undefined, existing);
  const status = normalizeStatus(has("status") ? body.status : undefined, kind, existing);
  const isClosingInternal = kind === "internal_defect" && status === "closed";
  const isLeavingClosedInternal = existing?.kind === "internal_defect" && existing?.status === "closed" && status !== "closed";

  if ((isClosingInternal || isLeavingClosedInternal) && !canCloseInternalDefect) {
    throw createHttpError(403, "restarbejde_internal_defect_close_denied");
  }

  const closedAt = isClosingInternal ? existing?.closed_at || new Date().toISOString() : null;
  const closedByUserId = isClosingInternal ? existing?.closed_by_user_id || actorUserId : null;

  return {
    kind,
    title: has("title") ? normalizeRequiredText(body.title, "restarbejde_title_required") : existing?.title || normalizeRequiredText(null, "restarbejde_title_required"),
    description: has("description") ? normalizeOptionalText(body.description) : existing?.description || null,
    tradeKey: has("trade_key") ? normalizeRequiredText(body.trade_key, "restarbejde_trade_key_required") : existing?.trade_key || normalizeRequiredText(null, "restarbejde_trade_key_required"),
    status,
    priority: normalizePriority(has("priority") ? body.priority : undefined, kind, existing),
    risk: normalizeRisk(has("risk") ? body.risk : undefined, kind, existing),
    locationText: has("location_text") ? normalizeOptionalText(body.location_text) : existing?.location_text || null,
    assignedTenantUserId: has("assigned_tenant_user_id") ? normalizeOptionalUuid(body.assigned_tenant_user_id, "invalid_restarbejde_assigned_user") : existing?.assigned_tenant_user_id || null,
    responsibleText: has("responsible_text") ? normalizeOptionalText(body.responsible_text) : existing?.responsible_text || null,
    deadline: has("deadline") ? normalizeOptionalDate(body.deadline) : existing?.deadline || null,
    percentComplete: normalizePercentComplete(has("percent_complete") ? body.percent_complete : undefined, kind, status, existing),
    externalParty: has("external_party") ? normalizeOptionalText(body.external_party) : existing?.external_party || null,
    blocksDelivery: has("blocks_delivery") ? normalizeBoolean(body.blocks_delivery, false) : Boolean(existing?.blocks_delivery),
    escalated: has("escalated") ? normalizeBoolean(body.escalated, false) : Boolean(existing?.escalated),
    canInternalTeamAct: has("can_internal_team_act") ? normalizeOptionalBoolean(body.can_internal_team_act) : existing?.can_internal_team_act ?? null,
    comment: has("comment") ? normalizeOptionalText(body.comment) : existing?.comment || null,
    source: has("source") ? normalizeOptionalText(body.source) : existing?.source || null,
    externalImportId: has("external_import_id") ? normalizeOptionalText(body.external_import_id) : existing?.external_import_id || null,
    externalImportPayload: normalizeImportPayload(has("external_import_payload") ? body.external_import_payload : undefined, existing),
    closedAt,
    closedByUserId,
  };
}

function mapItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    project_id: row.project_id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    trade_key: row.trade_key,
    status: row.status,
    priority: row.priority,
    risk: row.risk,
    location_text: row.location_text,
    assigned_tenant_user_id: row.assigned_tenant_user_id,
    responsible_text: row.responsible_text,
    deadline: row.deadline,
    percent_complete: row.percent_complete == null ? null : Number(row.percent_complete),
    external_party: row.external_party,
    blocks_delivery: Boolean(row.blocks_delivery),
    escalated: Boolean(row.escalated),
    can_internal_team_act: row.can_internal_team_act,
    comment: row.comment,
    source: row.source,
    external_import_id: row.external_import_id,
    external_import_payload: row.external_import_payload || {},
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by_user_id: row.created_by_user_id,
    updated_by_user_id: row.updated_by_user_id,
    closed_at: row.closed_at,
    closed_by_user_id: row.closed_by_user_id,
    archived_at: row.archived_at,
    archived_by_user_id: row.archived_by_user_id,
  };
}

function mapSummary(row) {
  const internalCount = Number(row?.internal_defect_count || 0);
  const progressValue = row?.internal_defect_progress == null ? null : Math.round(Number(row.internal_defect_progress));
  return {
    internal_defect_count: internalCount,
    internal_defect_closed_count: Number(row?.internal_defect_closed_count || 0),
    progress_percent: internalCount > 0 ? progressValue : null,
    progress_contract: "null_when_no_active_internal_defects",
    obs_count: Number(row?.obs_count || 0),
    archived_count: Number(row?.archived_count || 0),
  };
}

async function requireProject(client, { tenantId, userId, projectId }) {
  return projectAccessService.requireProjectAccess({ client, tenantId, userId, projectId });
}

async function audit(client, { tenantId, userId, eventType, resourceId, projectId, metadata }) {
  await auditService.logAuditEvent({
    client,
    tenantId,
    actorId: userId,
    actorType: "tenant_user",
    actorScope: "tenant",
    moduleKey: MODULE_KEY,
    eventType,
    resourceType: RESOURCE_TYPE,
    resourceId,
    projectId,
    outcome: "success",
    reason: eventType,
    metadata,
  });
}

async function listItems({ tenantId, userId, projectId, includeArchived = false, kind, status }) {
  const client = await pool.connect();
  try {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const rows = await repository.listItems(client, {
      tenantId,
      projectId: projectContext.projectId,
      includeArchived,
      kind: normalizeOptionalText(kind),
      status: normalizeOptionalText(status),
    });
    return { project: projectContext.project, items: rows.map(mapItem) };
  } finally {
    client.release();
  }
}

async function getItem({ tenantId, userId, projectId, itemId }) {
  const client = await pool.connect();
  try {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const row = await repository.findItemById(client, { tenantId, projectId: projectContext.projectId, itemId, includeArchived: false });
    if (!row) throw createHttpError(404, "restarbejde_item_not_found");
    return { project: projectContext.project, item: mapItem(row) };
  } finally {
    client.release();
  }
}

async function createItem({ tenantId, userId, projectId, input, canCloseInternalDefect = false }) {
  return withTransaction(async (client) => {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const payload = normalizePayload(input, { actorUserId: userId, canCloseInternalDefect });
    const row = await repository.insertItem(client, {
      tenantId,
      projectId: projectContext.projectId,
      payload,
      actorUserId: userId,
    });
    await audit(client, {
      tenantId,
      userId,
      eventType: "restarbejde.item_created",
      resourceId: row.id,
      projectId: projectContext.projectId,
      metadata: { kind: row.kind, status: row.status, title: row.title },
    });
    if (row.status === "closed") {
      await audit(client, {
        tenantId,
        userId,
        eventType: "restarbejde.item_status_changed",
        resourceId: row.id,
        projectId: projectContext.projectId,
        metadata: { kind: row.kind, from_status: null, to_status: row.status },
      });
    }
    return { project: projectContext.project, item: mapItem(row) };
  });
}

async function updateItem({ tenantId, userId, projectId, itemId, input, canCloseInternalDefect = false }) {
  return withTransaction(async (client) => {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const existing = await repository.findItemById(client, { tenantId, projectId: projectContext.projectId, itemId, includeArchived: false });
    if (!existing) throw createHttpError(404, "restarbejde_item_not_found");
    const payload = normalizePayload(input, { existing, actorUserId: userId, canCloseInternalDefect });
    const row = await repository.updateItem(client, {
      tenantId,
      projectId: projectContext.projectId,
      itemId,
      payload,
      actorUserId: userId,
    });
    await audit(client, {
      tenantId,
      userId,
      eventType: "restarbejde.item_updated",
      resourceId: row.id,
      projectId: projectContext.projectId,
      metadata: { kind: row.kind, status: row.status, previous_status: existing.status },
    });
    if (existing.status !== row.status) {
      await audit(client, {
        tenantId,
        userId,
        eventType: "restarbejde.item_status_changed",
        resourceId: row.id,
        projectId: projectContext.projectId,
        metadata: { kind: row.kind, from_status: existing.status, to_status: row.status },
      });
    }
    return { project: projectContext.project, item: mapItem(row) };
  });
}

async function archiveItem({ tenantId, userId, projectId, itemId }) {
  return withTransaction(async (client) => {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const row = await repository.archiveItem(client, { tenantId, projectId: projectContext.projectId, itemId, actorUserId: userId });
    if (!row) throw createHttpError(404, "restarbejde_item_not_found");
    await audit(client, {
      tenantId,
      userId,
      eventType: "restarbejde.item_archived",
      resourceId: row.id,
      projectId: projectContext.projectId,
      metadata: { kind: row.kind, status: row.status },
    });
    return { project: projectContext.project, item: mapItem(row) };
  });
}

async function restoreItem({ tenantId, userId, projectId, itemId }) {
  return withTransaction(async (client) => {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const row = await repository.restoreItem(client, { tenantId, projectId: projectContext.projectId, itemId, actorUserId: userId });
    if (!row) throw createHttpError(404, "restarbejde_item_not_found");
    await audit(client, {
      tenantId,
      userId,
      eventType: "restarbejde.item_restored",
      resourceId: row.id,
      projectId: projectContext.projectId,
      metadata: { kind: row.kind, status: row.status },
    });
    return { project: projectContext.project, item: mapItem(row) };
  });
}

async function getSummary({ tenantId, userId, projectId }) {
  const client = await pool.connect();
  try {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const summary = await repository.getSummary(client, { tenantId, projectId: projectContext.projectId });
    return { project: projectContext.project, summary: mapSummary(summary) };
  } finally {
    client.release();
  }
}

module.exports = {
  archiveItem,
  createItem,
  getItem,
  getSummary,
  listItems,
  restoreItem,
  updateItem,
  _test: {
    normalizePayload,
    mapSummary,
  },
};
