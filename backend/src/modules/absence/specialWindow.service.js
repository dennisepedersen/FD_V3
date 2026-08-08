"use strict";

const pool = require("../../db/pool");
const { withTransaction } = require("../../db/tx");
const { createHttpError } = require("../../middleware/errorHandler");
const auditService = require("../../services/auditService");
const repository = require("./absenceSpecialWindow.repository");
const validation = require("./specialWindow.validation");
const { mapSpecialWindowStatus, todayDate, toDateString } = require("./specialWindow.status");

const MODULE_KEY = "absence_special_window";
const RESOURCE_TYPE = "absence_special_window";
const EDITABLE_STATUSES = new Set(["submitted", "ready_for_review", "under_review"]);

function normalizeStatusFilter(value) {
  const normalized = validation.normalizeOptionalText(value);
  if (!normalized) return null;
  if (!["draft", "scheduled", "open", "closed_waiting_review", "review_open", "ended", "archived"].includes(normalized)) {
    throw createHttpError(400, "invalid_special_window_status_filter");
  }
  return normalized;
}

function normalizeActiveFilter(value) {
  if (value === undefined || value === null || value === "") return null;
  return validation.normalizeBoolean(value, null);
}

function normalizeYear(value) {
  const normalized = validation.normalizeOptionalText(value);
  if (!normalized) return null;
  const number = Number(normalized);
  if (!Number.isInteger(number) || number < 2000 || number > 2100) throw createHttpError(400, "invalid_special_window_year");
  return number;
}

function normalizeScopeFilter(value) {
  const normalized = validation.normalizeOptionalText(value);
  if (!normalized) return null;
  if (!validation.ALLOWED_SCOPE_TYPES.has(normalized)) throw createHttpError(400, "invalid_special_window_scope_type");
  return normalized;
}

function normalizeListFilters(filters = {}) {
  return {
    active: normalizeActiveFilter(filters.active),
    year: normalizeYear(filters.year),
    status: normalizeStatusFilter(filters.status),
    absenceTypeId: validation.normalizeOptionalUuid(filters.absence_type_id || filters.absence_type, "invalid_absence_type_id"),
    scopeType: normalizeScopeFilter(filters.scope_type),
    limit: validation.normalizeLimit(filters.limit),
    offset: validation.normalizeOffset(filters.offset),
  };
}

async function audit(client, { tenantId, actorId, eventType, resourceId, metadata }) {
  await auditService.logAuditEvent({
    client,
    tenantId,
    actorId,
    actorType: "tenant_user",
    actorScope: "tenant",
    moduleKey: MODULE_KEY,
    eventType,
    resourceType: RESOURCE_TYPE,
    resourceId,
    outcome: "success",
    metadata: metadata || {},
  });
}

function mapScope(row) {
  return {
    id: row.id,
    scope_type: row.scope_type,
    resource_group: row.resource_group_id ? {
      id: row.resource_group_id,
      name: row.resource_group_name || null,
      status: row.resource_group_status || null,
    } : null,
    tenant_user: row.scope_tenant_user_id ? {
      id: row.scope_tenant_user_id,
      name: row.tenant_user_name || null,
    } : null,
    absence_type: row.absence_type_id ? {
      id: row.absence_type_id,
      key: row.absence_type_key || null,
      name: row.absence_type_name || null,
      special_window_eligible: row.absence_type_special_window_eligible === true,
    } : null,
    created_at: row.created_at || null,
  };
}

function mapAbsenceType(row) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    special_window_eligible: row.special_window_eligible === true,
    explicitly_scoped: row.explicitly_scoped === true,
  };
}

function mapCounts(row) {
  return {
    total: Number(row.request_total_count || 0),
    submitted: Number(row.request_pending_count || 0),
    approved: Number(row.request_approved_count || 0),
    rejected: Number(row.request_rejected_count || 0),
    cancelled: Number(row.request_cancelled_count || 0),
    late: Number(row.request_late_count || 0),
  };
}

function mapWindow(row, { scopes = null, relevantAbsenceTypes = null, asOfDate = todayDate() } = {}) {
  if (!row) return null;
  const derived = mapSpecialWindowStatus(row, { asOfDate });
  const mapped = {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description || null,
    absence_start_date: toDateString(row.absence_start_date),
    absence_end_date: toDateString(row.absence_end_date),
    submission_open_date: toDateString(row.submission_open_date),
    submission_deadline: toDateString(row.submission_deadline),
    review_start_date: toDateString(row.review_start_date),
    collective_processing: row.collective_processing === true,
    approval_blocked_before_review: row.approval_blocked_before_review !== false,
    late_submission_policy: row.late_submission_policy,
    receipt_text: row.receipt_text || null,
    is_active: row.is_active === true,
    derived_status: derived.status,
    derived_status_label: derived.label,
    version: Number(row.version || 1),
    request_counts: mapCounts(row),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (scopes) mapped.scopes = scopes.map(mapScope);
  if (relevantAbsenceTypes) mapped.relevant_absence_types = relevantAbsenceTypes.map(mapAbsenceType);
  return mapped;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean).map(String)));
}

async function validateScopeReferences(client, { tenantId, scopes }) {
  const tenantUserIds = unique(scopes.map((scope) => scope.tenantUserId));
  const resourceGroupIds = unique(scopes.map((scope) => scope.resourceGroupId));
  const absenceTypeIds = unique(scopes.map((scope) => scope.absenceTypeId));

  const tenantUsers = await repository.findTenantUsersByIds(client, { tenantId, ids: tenantUserIds });
  const resourceGroups = await repository.findResourceGroupsByIds(client, { tenantId, ids: resourceGroupIds });
  const absenceTypes = await repository.findAbsenceTypesByIds(client, { tenantId, ids: absenceTypeIds });

  const tenantUsersById = new Map(tenantUsers.map((row) => [String(row.id), row]));
  const resourceGroupsById = new Map(resourceGroups.map((row) => [String(row.id), row]));
  const absenceTypesById = new Map(absenceTypes.map((row) => [String(row.id), row]));

  for (const id of tenantUserIds) {
    const row = tenantUsersById.get(id);
    if (!row) throw createHttpError(400, "special_window_scope_tenant_user_not_found");
    if (row.status !== "active") throw createHttpError(400, "special_window_scope_tenant_user_inactive");
  }
  for (const id of resourceGroupIds) {
    const row = resourceGroupsById.get(id);
    if (!row) throw createHttpError(400, "special_window_scope_resource_group_not_found");
    if (row.status !== "active") throw createHttpError(400, "special_window_scope_resource_group_inactive");
  }
  for (const id of absenceTypeIds) {
    const row = absenceTypesById.get(id);
    if (!row) throw createHttpError(400, "special_window_scope_absence_type_not_found");
    if (row.is_active !== true || row.special_window_eligible !== true) {
      throw createHttpError(400, "special_window_scope_absence_type_not_eligible");
    }
  }
}

function translateDbError(error) {
  if (error?.code === "23505") return createHttpError(409, "special_window_conflict");
  if (error?.code === "23514") return createHttpError(400, "special_window_constraint_failed");
  return error;
}

async function listSpecialWindows({ tenantId, filters = {} }) {
  const normalizedTenantId = validation.normalizeUuid(tenantId, "tenant_id_required");
  const normalizedFilters = normalizeListFilters(filters);
  const client = await pool.connect();
  try {
    const rows = await repository.listWindows(client, { tenantId: normalizedTenantId, ...normalizedFilters });
    let windows = rows.map((row) => mapWindow(row));
    if (normalizedFilters.status) windows = windows.filter((window) => window.derived_status === normalizedFilters.status);
    return { windows, limit: normalizedFilters.limit, offset: normalizedFilters.offset };
  } finally {
    client.release();
  }
}

async function getSpecialWindow({ tenantId, specialWindowId }) {
  const normalizedTenantId = validation.normalizeUuid(tenantId, "tenant_id_required");
  const normalizedId = validation.normalizeUuid(specialWindowId, "special_window_id_required");
  const client = await pool.connect();
  try {
    const row = await repository.findById(client, { tenantId: normalizedTenantId, specialWindowId: normalizedId });
    if (!row) throw createHttpError(404, "special_window_not_found");
    const [scopes, relevantTypes] = await Promise.all([
      repository.listScopesForWindow(client, { tenantId: normalizedTenantId, specialWindowId: normalizedId }),
      repository.listRelevantAbsenceTypes(client, { tenantId: normalizedTenantId, specialWindowId: normalizedId }),
    ]);
    return { window: mapWindow(row, { scopes, relevantAbsenceTypes: relevantTypes }) };
  } finally {
    client.release();
  }
}

async function createSpecialWindow({ tenantId, actorId, body }) {
  const normalizedTenantId = validation.normalizeUuid(tenantId, "tenant_id_required");
  const normalizedActorId = validation.normalizeUuid(actorId, "tenant_user_id_required");
  const payload = validation.normalizeCreatePayload(body || {});

  try {
    return await withTransaction(async (client) => {
      await validateScopeReferences(client, { tenantId: normalizedTenantId, scopes: payload.scopes });
      const created = await repository.insertWindow(client, {
        tenantId: normalizedTenantId,
        key: payload.key,
        name: payload.name,
        description: payload.description,
        absenceStartDate: payload.absenceStartDate,
        absenceEndDate: payload.absenceEndDate,
        submissionOpenDate: payload.submissionOpenDate,
        submissionDeadline: payload.submissionDeadline,
        reviewStartDate: payload.reviewStartDate,
        collectiveProcessing: payload.collectiveProcessing,
        approvalBlockedBeforeReview: payload.approvalBlockedBeforeReview,
        lateSubmissionPolicy: payload.lateSubmissionPolicy,
        receiptText: payload.receiptText,
        isActive: payload.isActive,
        actorId: normalizedActorId,
      });
      await repository.insertScopes(client, { tenantId: normalizedTenantId, specialWindowId: created.id, scopes: payload.scopes });
      await audit(client, {
        tenantId: normalizedTenantId,
        actorId: normalizedActorId,
        eventType: "absence_special_window.created",
        resourceId: created.id,
        metadata: {
          key: created.key,
          name: created.name,
          scope_count: payload.scopes.length,
          absence_start_date: payload.absenceStartDate,
          absence_end_date: payload.absenceEndDate,
          submission_open_date: payload.submissionOpenDate,
          submission_deadline: payload.submissionDeadline,
          review_start_date: payload.reviewStartDate,
          late_submission_policy: payload.lateSubmissionPolicy,
        },
      });
      const scopes = await repository.listScopesForWindow(client, { tenantId: normalizedTenantId, specialWindowId: created.id });
      const relevantTypes = await repository.listRelevantAbsenceTypes(client, { tenantId: normalizedTenantId, specialWindowId: created.id });
      return { window: mapWindow(created, { scopes, relevantAbsenceTypes: relevantTypes }) };
    });
  } catch (error) {
    throw translateDbError(error);
  }
}

async function updateSpecialWindow({ tenantId, actorId, specialWindowId, body }) {
  const normalizedTenantId = validation.normalizeUuid(tenantId, "tenant_id_required");
  const normalizedActorId = validation.normalizeUuid(actorId, "tenant_user_id_required");
  const normalizedId = validation.normalizeUuid(specialWindowId, "special_window_id_required");

  try {
    return await withTransaction(async (client) => {
      const existing = await repository.findById(client, { tenantId: normalizedTenantId, specialWindowId: normalizedId, forUpdate: true });
      if (!existing) throw createHttpError(404, "special_window_not_found");
      const payload = validation.normalizeUpdatePayload(body || {}, existing);
      const counts = await repository.countRequestsForWindow(client, { tenantId: normalizedTenantId, specialWindowId: normalizedId });
      validation.assertEditableWithRequests(payload.changedFields, counts.blocking_count);
      if (payload.scopes) await validateScopeReferences(client, { tenantId: normalizedTenantId, scopes: payload.scopes });

      const updated = await repository.updateWindow(client, {
        tenantId: normalizedTenantId,
        specialWindowId: normalizedId,
        expectedVersion: payload.version,
        patch: payload,
        actorId: normalizedActorId,
      });
      if (!updated) throw createHttpError(409, "special_window_version_conflict");
      if (payload.scopes) {
        await repository.replaceScopes(client, { tenantId: normalizedTenantId, specialWindowId: normalizedId, scopes: payload.scopes });
      }
      await audit(client, {
        tenantId: normalizedTenantId,
        actorId: normalizedActorId,
        eventType: "absence_special_window.updated",
        resourceId: normalizedId,
        metadata: {
          changed_fields: payload.changedFields,
          old_version: payload.version,
          new_version: updated.version,
          request_count: Number(counts.total_count || 0),
        },
      });
      if (payload.scopes) {
        await audit(client, {
          tenantId: normalizedTenantId,
          actorId: normalizedActorId,
          eventType: "absence_special_window.scope_changed",
          resourceId: normalizedId,
          metadata: {
            old_version: payload.version,
            new_version: updated.version,
            scope_count: payload.scopes.length,
          },
        });
      }
      const scopes = await repository.listScopesForWindow(client, { tenantId: normalizedTenantId, specialWindowId: normalizedId });
      const relevantTypes = await repository.listRelevantAbsenceTypes(client, { tenantId: normalizedTenantId, specialWindowId: normalizedId });
      return { window: mapWindow(updated, { scopes, relevantAbsenceTypes: relevantTypes }) };
    });
  } catch (error) {
    throw translateDbError(error);
  }
}

async function archiveSpecialWindow({ tenantId, actorId, specialWindowId, body }) {
  const normalizedTenantId = validation.normalizeUuid(tenantId, "tenant_id_required");
  const normalizedActorId = validation.normalizeUuid(actorId, "tenant_user_id_required");
  const normalizedId = validation.normalizeUuid(specialWindowId, "special_window_id_required");
  const payload = validation.normalizeArchivePayload(body || {});

  return withTransaction(async (client) => {
    const archived = await repository.archiveWindow(client, {
      tenantId: normalizedTenantId,
      specialWindowId: normalizedId,
      expectedVersion: payload.version,
      actorId: normalizedActorId,
    });
    if (!archived) throw createHttpError(409, "special_window_version_conflict");
    await audit(client, {
      tenantId: normalizedTenantId,
      actorId: normalizedActorId,
      eventType: "absence_special_window.archived",
      resourceId: normalizedId,
      metadata: { old_version: payload.version, new_version: archived.version },
    });
    return { window: mapWindow(archived) };
  });
}

function dateRangesOverlap(a, b) {
  return a.start_date <= b.end_date && b.start_date <= a.end_date;
}

function timeRangesOverlap(a, b) {
  if (a.duration_type !== "time_range" || b.duration_type !== "time_range") return true;
  if (a.start_date !== a.end_date || b.start_date !== b.end_date || a.start_date !== b.start_date) return true;
  const aStart = a.start_time || "00:00:00";
  const aEnd = a.end_time || "23:59:59";
  const bStart = b.start_time || "00:00:00";
  const bEnd = b.end_time || "23:59:59";
  return aStart < bEnd && bStart < aEnd;
}

function buildOverlapSignals(requests) {
  const active = requests.filter((request) => request.status !== "cancelled");
  const signalsByRequestId = new Map(active.map((request) => [request.id, []]));
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const first = active[i];
      const second = active[j];
      if (!dateRangesOverlap(first, second) || !timeRangesOverlap(first, second)) continue;
      const signal = {
        request_ids: [first.id, second.id],
        overlap_start_date: first.start_date > second.start_date ? first.start_date : second.start_date,
        overlap_end_date: first.end_date < second.end_date ? first.end_date : second.end_date,
      };
      signalsByRequestId.get(first.id).push(signal);
      signalsByRequestId.get(second.id).push(signal);
    }
  }
  return signalsByRequestId;
}

function mapResourceGroups(groups) {
  if (!Array.isArray(groups)) return [];
  return groups.map((group) => ({ id: group.id, name: group.name })).filter((group) => group.id);
}

function mapReviewRequest(row, { includePrivateComment, overlapSignals }) {
  const startDate = toDateString(row.start_date);
  const endDate = toDateString(row.end_date || row.start_date);
  const status = row.status;
  const request = {
    id: row.id,
    employee: {
      id: row.employee_tenant_user_id,
      display_name: row.employee_name || "Medarbejder",
    },
    absence_type: {
      id: row.absence_type_id,
      key: row.absence_type_key,
      name: row.absence_type_name,
    },
    duration_type: row.duration_type,
    day_part: row.day_part || null,
    start_date: startDate,
    end_date: endDate,
    start_time: row.start_time ? String(row.start_time).slice(0, 8) : null,
    end_time: row.end_time ? String(row.end_time).slice(0, 8) : null,
    timezone: row.timezone,
    status,
    display_status: EDITABLE_STATUSES.has(status) ? "Klar til samlet behandling" : status,
    assigned_manager: row.assigned_manager_tenant_user_id ? {
      id: row.assigned_manager_tenant_user_id,
      name: row.assigned_manager_name || null,
    } : null,
    submitted_at: row.submitted_at || null,
    reviewed_at: row.reviewed_at || null,
    cancelled_at: row.cancelled_at || null,
    version: Number(row.version || 1),
    late_submission: row.submitted_after_deadline === true,
    late_submission_policy: row.submitted_metadata?.late_submission_policy || null,
    has_private_comment: Boolean(validation.normalizeOptionalText(row.employee_comment)),
    resource_groups: mapResourceGroups(row.resource_groups),
    overlap_signals: overlapSignals.get(row.id) || [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (includePrivateComment) request.employee_comment = row.employee_comment || null;
  return request;
}

async function getReviewOverview({ tenantId, specialWindowId, filters = {}, includePrivateComment = false }) {
  const normalizedTenantId = validation.normalizeUuid(tenantId, "tenant_id_required");
  const normalizedId = validation.normalizeUuid(specialWindowId, "special_window_id_required");
  const limit = validation.normalizeLimit(filters.limit);
  const offset = validation.normalizeOffset(filters.offset);
  const client = await pool.connect();
  try {
    const window = await repository.findById(client, { tenantId: normalizedTenantId, specialWindowId: normalizedId });
    if (!window) throw createHttpError(404, "special_window_not_found");
    const rows = await repository.listReviewOverviewRequests(client, {
      tenantId: normalizedTenantId,
      specialWindowId: normalizedId,
      limit,
      offset,
    });
    const normalizedRows = rows.map((row) => ({
      ...row,
      start_date: toDateString(row.start_date),
      end_date: toDateString(row.end_date || row.start_date),
      start_time: row.start_time ? String(row.start_time).slice(0, 8) : null,
      end_time: row.end_time ? String(row.end_time).slice(0, 8) : null,
    }));
    const overlapSignals = buildOverlapSignals(normalizedRows);
    return {
      window: mapWindow(window),
      requests: normalizedRows.map((row) => mapReviewRequest(row, { includePrivateComment, overlapSignals })),
      limit,
      offset,
    };
  } finally {
    client.release();
  }
}

module.exports = {
  _test: {
    buildOverlapSignals,
    mapReviewRequest,
    mapWindow,
    normalizeListFilters,
    validateScopeReferences,
  },
  archiveSpecialWindow,
  createSpecialWindow,
  getReviewOverview,
  getSpecialWindow,
  listSpecialWindows,
  updateSpecialWindow,
};