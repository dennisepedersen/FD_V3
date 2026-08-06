"use strict";

const pool = require("../../db/pool");
const { withTransaction } = require("../../db/tx");
const { createHttpError } = require("../../middleware/errorHandler");
const auditService = require("../../services/auditService");
const absenceRequestRepository = require("./absenceRequest.repository");
const absenceTypeRepository = require("./absenceType.repository");
const absenceSpecialWindowRepository = require("./absenceSpecialWindow.repository");
const employeeManagerRelationRepository = require("./employeeManagerRelation.repository");
const absenceNotificationService = require("../notifications/absenceNotification.service");
const {
  assertAbsenceTypeAllowsDuration,
  assertAbsenceTypeAllowsEmployeeRequest,
  assertCommentPolicy,
  getChangedFields,
  normalizeActionVersion,
  normalizeCreatePayload,
  normalizeLimit,
  normalizeOffset,
  normalizeOptionalText,
  normalizeOptionalUuid,
  normalizeUpdatePayload,
  normalizeUuid,
} = require("./absence.validation");
const { ABSENCE_REQUEST_STATUSES } = require("./absence.constants");

const MODULE_KEY = "absence_request";
const RESOURCE_TYPE = "absence_request";
const CANCEL_ALLOWED_STATUSES = Object.freeze(["draft", "submitted"]);
const STATUS_SET = new Set(ABSENCE_REQUEST_STATUSES);

async function requireNotificationContext(client, { tenantId, absenceRequestId }) {
  const context = await absenceRequestRepository.findNotificationContextById(client, { tenantId, absenceRequestId });
  if (!context) throw new Error("absence_notification_context_not_found");
  return context;
}

function toDateString(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function toTimeString(value) {
  if (!value) return null;
  return String(value).slice(0, 8);
}

function normalizeIdempotencyKey(value) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  if (normalized.length > 120) throw createHttpError(400, "idempotency_key_too_long");
  return normalized;
}

function normalizeStatusFilter(value) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  if (!STATUS_SET.has(normalized)) throw createHttpError(400, "invalid_absence_request_status_filter");
  return normalized;
}

function normalizeFilterDate(value, errorCode) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw createHttpError(400, errorCode);
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw createHttpError(400, errorCode);
  }
  return normalized;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function mapAbsenceTypeFromRow(row) {
  if (!row) return null;
  const id = row.absence_type_id || row.id;
  const key = row.absence_type_key || row.key;
  const name = row.absence_type_name || row.name;
  return {
    id,
    key,
    name,
    workflow_mode: row.absence_type_workflow_mode || row.workflow_mode,
    comment_policy: row.absence_type_comment_policy || row.comment_policy,
    visibility_policy: row.absence_type_visibility_policy || row.visibility_policy,
  };
}

function mapManager(row) {
  if (!row?.assigned_manager_tenant_user_id) return null;
  return {
    id: row.assigned_manager_tenant_user_id,
    name: row.assigned_manager_name || null,
  };
}

function mapSpecialWindow(row) {
  if (!row?.special_window_id) return null;
  return {
    id: row.special_window_id,
    key: row.special_window_key || null,
    name: row.special_window_name || null,
    review_start_date: toDateString(row.special_window_review_start_date),
    submission_deadline: toDateString(row.special_window_submission_deadline),
  };
}

function displayStatus(row) {
  return row?.status || null;
}

function mapRequest(row, { includeComment = true } = {}) {
  if (!row) return null;
  const mapped = {
    id: row.id,
    absence_type: mapAbsenceTypeFromRow(row),
    duration_type: row.duration_type,
    start_date: toDateString(row.start_date),
    end_date: toDateString(row.end_date),
    start_time: toTimeString(row.start_time),
    end_time: toTimeString(row.end_time),
    timezone: row.timezone,
    status: row.status,
    display_status: displayStatus(row),
    assigned_manager: mapManager(row),
    special_window: mapSpecialWindow(row),
    submitted_at: row.submitted_at || null,
    cancelled_at: row.cancelled_at || null,
    version: Number(row.version),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (includeComment) {
    mapped.employee_comment = row.employee_comment || null;
  }
  return mapped;
}

function mapEvent(row) {
  return {
    id: row.id,
    event_type: row.event_type,
    old_status: row.old_status,
    new_status: row.new_status,
    reason: row.reason,
    metadata: row.metadata_json || {},
    created_at: row.created_at,
  };
}

async function audit(client, {
  tenantId,
  actorId,
  eventType,
  requestId,
  metadata,
  reason = null,
}) {
  await auditService.logAuditEvent({
    client,
    tenantId,
    actorId,
    actorType: "tenant_user",
    actorScope: "tenant",
    moduleKey: MODULE_KEY,
    eventType,
    resourceType: RESOURCE_TYPE,
    resourceId: requestId,
    outcome: "success",
    reason,
    metadata: metadata || {},
  });
}

function absenceTypeFromRequestRow(row) {
  return {
    id: row.absence_type_id,
    workflow_mode: row.absence_type_workflow_mode,
    comment_policy: row.absence_type_comment_policy,
    visibility_policy: row.absence_type_visibility_policy,
    allowed_duration_types: row.absence_type_allowed_duration_types || [],
    special_window_eligible: row.absence_type_special_window_eligible === true,
    is_active: row.absence_type_is_active === true,
  };
}

function validatePayloadAgainstType(absenceType, payload) {
  assertAbsenceTypeAllowsEmployeeRequest(absenceType);
  assertAbsenceTypeAllowsDuration(absenceType, payload.durationType);
  assertCommentPolicy(absenceType, payload.employeeComment);
}

async function requireAbsenceType(client, { tenantId, absenceTypeId }) {
  const absenceType = await absenceTypeRepository.findById(client, { tenantId, absenceTypeId });
  if (!absenceType) throw createHttpError(404, "absence_type_not_found");
  return absenceType;
}

async function resolvePrimaryManager(client, { tenantId, employeeTenantUserId }) {
  const managers = await employeeManagerRelationRepository.findActivePrimaryManagersForEmployee(client, {
    tenantId,
    employeeTenantUserId,
    asOfDate: todayDate(),
  });
  if (managers.length === 0) throw createHttpError(409, "absence_manager_not_found");
  if (managers.length > 1) throw createHttpError(409, "absence_manager_ambiguous");
  const manager = managers[0];
  if (String(manager.manager_tenant_user_id) === String(employeeTenantUserId)) {
    throw createHttpError(409, "absence_manager_ambiguous");
  }
  if (manager.manager_status !== "active" || manager.manager_login_status !== "active") {
    throw createHttpError(409, "absence_manager_not_found");
  }
  return manager;
}

function requestEndDateForWindow(payloadOrRow) {
  return toDateString(payloadOrRow.endDate || payloadOrRow.end_date || payloadOrRow.startDate || payloadOrRow.start_date);
}

async function resolveSpecialWindow(client, {
  tenantId,
  employeeTenantUserId,
  absenceType,
  absenceTypeId,
  startDate,
  endDate,
}) {
  if (absenceType.special_window_eligible !== true) return null;
  const overlaps = await absenceSpecialWindowRepository.listOverlappingActiveScopedForEmployee(client, {
    tenantId,
    employeeTenantUserId,
    absenceTypeId,
    startDate,
    endDate,
  });
  if (overlaps.length === 0) return null;
  if (overlaps.some((row) => row.scope_type === "resource_group")) {
    throw createHttpError(409, "absence_special_window_scope_unclear");
  }
  if (overlaps.some((row) => row.fully_contains_request !== true)) {
    throw createHttpError(409, "absence_special_window_partial_overlap");
  }
  const safeMatches = new Map();
  for (const row of overlaps) {
    if (row.scope_type === "tenant" || row.scope_type === "tenant_user") {
      safeMatches.set(String(row.id), row);
    }
  }
  if (safeMatches.size === 0) {
    throw createHttpError(409, "absence_special_window_scope_unclear");
  }
  if (safeMatches.size > 1) {
    throw createHttpError(409, "absence_special_window_conflict");
  }
  return Array.from(safeMatches.values())[0];
}

async function getDetailRow(client, { tenantId, employeeTenantUserId, absenceRequestId }) {
  const row = await absenceRequestRepository.findByIdForEmployee(client, {
    tenantId,
    employeeTenantUserId,
    absenceRequestId,
  });
  if (!row) throw createHttpError(404, "absence_request_not_found");
  return row;
}

async function listMine({ tenantId, userId, filters = {} }) {
  const normalizedTenantId = normalizeUuid(tenantId, "tenant_id_required");
  const normalizedUserId = normalizeUuid(userId, "tenant_user_id_required");
  const status = normalizeStatusFilter(filters.status);
  const dateFrom = normalizeFilterDate(filters.date_from || filters.from, "invalid_absence_request_date_from");
  const dateTo = normalizeFilterDate(filters.date_to || filters.to, "invalid_absence_request_date_to");
  const limit = normalizeLimit(filters.limit);
  const offset = normalizeOffset(filters.offset);
  if (dateFrom && dateTo && dateTo < dateFrom) throw createHttpError(400, "absence_request_date_filter_invalid_range");

  const client = await pool.connect();
  try {
    const rows = await absenceRequestRepository.listForEmployee(client, {
      tenantId: normalizedTenantId,
      employeeTenantUserId: normalizedUserId,
      status,
      dateFrom,
      dateTo,
      limit,
      offset,
    });
    return {
      requests: rows.map((row) => mapRequest(row, { includeComment: false })),
      limit,
      offset,
    };
  } finally {
    client.release();
  }
}

async function getMineDetail({ tenantId, userId, absenceRequestId, includeHistory = false }) {
  const normalizedTenantId = normalizeUuid(tenantId, "tenant_id_required");
  const normalizedUserId = normalizeUuid(userId, "tenant_user_id_required");
  const normalizedRequestId = normalizeUuid(absenceRequestId, "absence_request_id_required");

  const client = await pool.connect();
  try {
    const row = await getDetailRow(client, {
      tenantId: normalizedTenantId,
      employeeTenantUserId: normalizedUserId,
      absenceRequestId: normalizedRequestId,
    });
    const events = includeHistory
      ? await absenceRequestRepository.listEvents(client, {
        tenantId: normalizedTenantId,
        absenceRequestId: normalizedRequestId,
      })
      : [];
    return {
      request: mapRequest(row),
      events: events.map(mapEvent),
    };
  } finally {
    client.release();
  }
}

async function createDraft({ tenantId, userId, body, idempotencyKey }) {
  const normalizedTenantId = normalizeUuid(tenantId, "tenant_id_required");
  const normalizedUserId = normalizeUuid(userId, "tenant_user_id_required");
  const payload = normalizeCreatePayload(body || {});
  const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);

  return withTransaction(async (client) => {
    if (normalizedIdempotencyKey) {
      await absenceRequestRepository.acquireIdempotencyLock(client, {
        lockKey: `absence:create:${normalizedTenantId}:${normalizedUserId}:${normalizedIdempotencyKey}`,
      });
      const existing = await absenceRequestRepository.findCreatedByIdempotencyKey(client, {
        tenantId: normalizedTenantId,
        employeeTenantUserId: normalizedUserId,
        idempotencyKey: normalizedIdempotencyKey,
      });
      if (existing) {
        const row = await getDetailRow(client, {
          tenantId: normalizedTenantId,
          employeeTenantUserId: normalizedUserId,
          absenceRequestId: existing.id,
        });
        return { request: mapRequest(row), idempotent: true };
      }
    }

    const absenceType = await requireAbsenceType(client, {
      tenantId: normalizedTenantId,
      absenceTypeId: payload.absenceTypeId,
    });
    validatePayloadAgainstType(absenceType, payload);

    const request = await absenceRequestRepository.insertRequest(client, {
      tenantId: normalizedTenantId,
      employeeTenantUserId: normalizedUserId,
      absenceTypeId: payload.absenceTypeId,
      durationType: payload.durationType,
      dayPart: payload.dayPart,
      startDate: payload.startDate,
      endDate: payload.endDate,
      startTime: payload.startTime,
      endTime: payload.endTime,
      timezone: payload.timezone,
      employeeComment: payload.employeeComment,
      status: "draft",
    });
    await absenceRequestRepository.insertEvent(client, {
      tenantId: normalizedTenantId,
      absenceRequestId: request.id,
      eventType: "created",
      actorTenantUserId: normalizedUserId,
      oldStatus: null,
      newStatus: "draft",
      metadata: {
        duration_type: payload.durationType,
        idempotency_key: normalizedIdempotencyKey,
      },
    });
    await audit(client, {
      tenantId: normalizedTenantId,
      actorId: normalizedUserId,
      eventType: "absence_request.created",
      requestId: request.id,
      metadata: {
        duration_type: payload.durationType,
        start_date: payload.startDate,
        end_date: payload.endDate,
      },
    });
    const row = await getDetailRow(client, {
      tenantId: normalizedTenantId,
      employeeTenantUserId: normalizedUserId,
      absenceRequestId: request.id,
    });
    return { request: mapRequest(row), idempotent: false };
  });
}

async function updateDraft({ tenantId, userId, absenceRequestId, body }) {
  const normalizedTenantId = normalizeUuid(tenantId, "tenant_id_required");
  const normalizedUserId = normalizeUuid(userId, "tenant_user_id_required");
  const normalizedRequestId = normalizeUuid(absenceRequestId, "absence_request_id_required");

  return withTransaction(async (client) => {
    const existing = await absenceRequestRepository.findByIdForEmployee(client, {
      tenantId: normalizedTenantId,
      employeeTenantUserId: normalizedUserId,
      absenceRequestId: normalizedRequestId,
      forUpdate: true,
    });
    if (!existing) throw createHttpError(404, "absence_request_not_found");
    if (existing.status !== "draft") throw createHttpError(409, "absence_request_not_editable");

    const payload = normalizeUpdatePayload(body || {}, existing);
    const changedFields = getChangedFields(existing, payload);
    if (changedFields.length === 0) throw createHttpError(400, "absence_request_patch_empty");

    const absenceType = await requireAbsenceType(client, {
      tenantId: normalizedTenantId,
      absenceTypeId: payload.absenceTypeId,
    });
    validatePayloadAgainstType(absenceType, payload);

    const updated = await absenceRequestRepository.updateDraftForEmployee(client, {
      tenantId: normalizedTenantId,
      employeeTenantUserId: normalizedUserId,
      absenceRequestId: normalizedRequestId,
      expectedVersion: payload.version,
      absenceTypeId: payload.absenceTypeId,
      durationType: payload.durationType,
      dayPart: payload.dayPart,
      startDate: payload.startDate,
      endDate: payload.endDate,
      startTime: payload.startTime,
      endTime: payload.endTime,
      timezone: payload.timezone,
      employeeComment: payload.employeeComment,
    });
    if (!updated) throw createHttpError(409, "absence_request_version_conflict");

    await absenceRequestRepository.insertEvent(client, {
      tenantId: normalizedTenantId,
      absenceRequestId: normalizedRequestId,
      eventType: "draft_updated",
      actorTenantUserId: normalizedUserId,
      oldStatus: "draft",
      newStatus: "draft",
      metadata: {
        changed_fields: changedFields.filter((field) => field !== "employee_comment"),
        private_comment_changed: changedFields.includes("employee_comment"),
      },
    });
    await audit(client, {
      tenantId: normalizedTenantId,
      actorId: normalizedUserId,
      eventType: "absence_request.updated",
      requestId: normalizedRequestId,
      metadata: {
        changed_fields: changedFields.filter((field) => field !== "employee_comment"),
        private_comment_changed: changedFields.includes("employee_comment"),
        old_version: payload.version,
        new_version: updated.version,
      },
    });
    const row = await getDetailRow(client, {
      tenantId: normalizedTenantId,
      employeeTenantUserId: normalizedUserId,
      absenceRequestId: normalizedRequestId,
    });
    return { request: mapRequest(row) };
  });
}

async function submitDraft({ tenantId, userId, absenceRequestId, body, idempotencyKey }) {
  const normalizedTenantId = normalizeUuid(tenantId, "tenant_id_required");
  const normalizedUserId = normalizeUuid(userId, "tenant_user_id_required");
  const normalizedRequestId = normalizeUuid(absenceRequestId, "absence_request_id_required");
  const expectedVersion = normalizeActionVersion(body || {});
  const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);

  return withTransaction(async (client) => {
    if (normalizedIdempotencyKey) {
      await absenceRequestRepository.acquireIdempotencyLock(client, {
        lockKey: `absence:submit:${normalizedTenantId}:${normalizedUserId}:${normalizedRequestId}:${normalizedIdempotencyKey}`,
      });
    }
    const existing = await absenceRequestRepository.findByIdForEmployee(client, {
      tenantId: normalizedTenantId,
      employeeTenantUserId: normalizedUserId,
      absenceRequestId: normalizedRequestId,
      forUpdate: true,
    });
    if (!existing) throw createHttpError(404, "absence_request_not_found");
    if (existing.status === "submitted" && (Number(existing.version) === expectedVersion || Number(existing.version) === expectedVersion + 1)) {
      return { request: mapRequest(existing), idempotent: true };
    }
    if (existing.status !== "draft") throw createHttpError(409, "absence_request_not_submittable");
    if (Number(existing.version) !== expectedVersion) throw createHttpError(409, "absence_request_version_conflict");

    const absenceType = absenceTypeFromRequestRow(existing);
    const payload = {
      absenceTypeId: existing.absence_type_id,
      durationType: existing.duration_type,
      employeeComment: existing.employee_comment,
    };
    validatePayloadAgainstType(absenceType, payload);

    const manager = await resolvePrimaryManager(client, {
      tenantId: normalizedTenantId,
      employeeTenantUserId: normalizedUserId,
    });
    const specialWindow = await resolveSpecialWindow(client, {
      tenantId: normalizedTenantId,
      employeeTenantUserId: normalizedUserId,
      absenceType,
      absenceTypeId: existing.absence_type_id,
      startDate: toDateString(existing.start_date),
      endDate: requestEndDateForWindow(existing),
    });

    const submitted = await absenceRequestRepository.submitDraftForEmployee(client, {
      tenantId: normalizedTenantId,
      employeeTenantUserId: normalizedUserId,
      absenceRequestId: normalizedRequestId,
      expectedVersion,
      managerTenantUserId: manager.manager_tenant_user_id,
      specialWindowId: specialWindow?.id || null,
    });
    if (!submitted) throw createHttpError(409, "absence_request_version_conflict");

    await absenceRequestRepository.insertEvent(client, {
      tenantId: normalizedTenantId,
      absenceRequestId: normalizedRequestId,
      eventType: "submitted",
      actorTenantUserId: normalizedUserId,
      oldStatus: "draft",
      newStatus: "submitted",
      metadata: {
        manager_relation_id: manager.id,
        assigned_manager_tenant_user_id: manager.manager_tenant_user_id,
        special_window_id: specialWindow?.id || null,
        duration_type: existing.duration_type,
        idempotency_key: normalizedIdempotencyKey,
      },
    });
    await audit(client, {
      tenantId: normalizedTenantId,
      actorId: normalizedUserId,
      eventType: "absence_request.submitted",
      requestId: normalizedRequestId,
      metadata: {
        old_status: "draft",
        new_status: "submitted",
        old_version: expectedVersion,
        new_version: submitted.version,
        assigned_manager_tenant_user_id: manager.manager_tenant_user_id,
        special_window_id: specialWindow?.id || null,
      },
    });
    await absenceNotificationService.enqueueAbsenceSubmitted(client, {
      tenantId: normalizedTenantId,
      actorId: normalizedUserId,
      requestContext: await requireNotificationContext(client, {
        tenantId: normalizedTenantId,
        absenceRequestId: normalizedRequestId,
      }),
    });
    const row = await getDetailRow(client, {
      tenantId: normalizedTenantId,
      employeeTenantUserId: normalizedUserId,
      absenceRequestId: normalizedRequestId,
    });
    return { request: mapRequest(row), idempotent: false };
  });
}

async function cancelOwn({ tenantId, userId, absenceRequestId, body }) {
  const normalizedTenantId = normalizeUuid(tenantId, "tenant_id_required");
  const normalizedUserId = normalizeUuid(userId, "tenant_user_id_required");
  const normalizedRequestId = normalizeUuid(absenceRequestId, "absence_request_id_required");
  const expectedVersion = normalizeActionVersion(body || {});

  return withTransaction(async (client) => {
    const existing = await absenceRequestRepository.findByIdForEmployee(client, {
      tenantId: normalizedTenantId,
      employeeTenantUserId: normalizedUserId,
      absenceRequestId: normalizedRequestId,
      forUpdate: true,
    });
    if (!existing) throw createHttpError(404, "absence_request_not_found");
    if (existing.status === "cancelled" && (Number(existing.version) === expectedVersion || Number(existing.version) === expectedVersion + 1)) {
      return { request: mapRequest(existing), idempotent: true };
    }
    if (!CANCEL_ALLOWED_STATUSES.includes(existing.status)) {
      throw createHttpError(409, "absence_request_not_cancellable");
    }
    if (Number(existing.version) !== expectedVersion) {
      throw createHttpError(409, "absence_request_version_conflict");
    }
    const cancelled = await absenceRequestRepository.cancelForEmployee(client, {
      tenantId: normalizedTenantId,
      employeeTenantUserId: normalizedUserId,
      absenceRequestId: normalizedRequestId,
      expectedVersion,
      allowedStatuses: CANCEL_ALLOWED_STATUSES,
    });
    if (!cancelled) throw createHttpError(409, "absence_request_version_conflict");
    await absenceRequestRepository.insertEvent(client, {
      tenantId: normalizedTenantId,
      absenceRequestId: normalizedRequestId,
      eventType: "cancelled",
      actorTenantUserId: normalizedUserId,
      oldStatus: existing.status,
      newStatus: "cancelled",
      metadata: {
        old_version: expectedVersion,
        new_version: cancelled.version,
      },
    });
    await audit(client, {
      tenantId: normalizedTenantId,
      actorId: normalizedUserId,
      eventType: "absence_request.cancelled",
      requestId: normalizedRequestId,
      metadata: {
        old_status: existing.status,
        new_status: "cancelled",
        old_version: expectedVersion,
        new_version: cancelled.version,
      },
    });
    await absenceNotificationService.enqueueAbsenceCancelled(client, {
      tenantId: normalizedTenantId,
      actorId: normalizedUserId,
      requestContext: await requireNotificationContext(client, {
        tenantId: normalizedTenantId,
        absenceRequestId: normalizedRequestId,
      }),
    });
    const row = await getDetailRow(client, {
      tenantId: normalizedTenantId,
      employeeTenantUserId: normalizedUserId,
      absenceRequestId: normalizedRequestId,
    });
    return { request: mapRequest(row), idempotent: false };
  });
}

module.exports = {
  cancelOwn,
  createDraft,
  getMineDetail,
  listMine,
  mapEvent,
  mapRequest,
  submitDraft,
  updateDraft,
  _test: {
    absenceTypeFromRequestRow,
    displayStatus,
    mapRequest,
    normalizeIdempotencyKey,
    resolveSpecialWindow,
    validatePayloadAgainstType,
  },
};
