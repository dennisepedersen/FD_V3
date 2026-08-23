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
const approvedAbsenceService = require("../calendar/approvedAbsence.service");
const {
  assertAbsenceTypeAllowsDuration,
  assertAbsenceTypeAllowsEmployeeRequest,
  assertCommentPolicy,
  getChangedFields,
  normalizeActionVersion,
  normalizeApprovePayload,
  normalizeCreatePayload,
  normalizeLimit,
  normalizeOffset,
  normalizeOptionalText,
  normalizeOptionalUuid,
  normalizePreflightPayload,
  normalizeRejectPayload,
  normalizeUpdatePayload,
  normalizeUuid,
} = require("./absence.validation");
const { ABSENCE_REQUEST_STATUSES } = require("./absence.constants");

const MODULE_KEY = "absence_request";
const RESOURCE_TYPE = "absence_request";
const CANCEL_ALLOWED_STATUSES = Object.freeze(["draft", "submitted"]);
const MANAGER_DECISION_ALLOWED_STATUSES = Object.freeze(["submitted", "ready_for_review"]);
const MANAGER_PENDING_DEFAULT_STATUSES = Object.freeze(["submitted", "ready_for_review"]);
const STATUS_SET = new Set(ABSENCE_REQUEST_STATUSES);
const MAX_SPLIT_SEGMENTS = 6;

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

function normalizeManagerStatusList(value) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return [...MANAGER_PENDING_DEFAULT_STATUSES];
  const statuses = normalized.split(",").map((item) => item.trim()).filter(Boolean);
  if (statuses.length === 0) return [...MANAGER_PENDING_DEFAULT_STATUSES];
  for (const status of statuses) {
    if (!STATUS_SET.has(status)) throw createHttpError(400, "invalid_absence_request_status_filter");
  }
  return Array.from(new Set(statuses));
}

function normalizeEmployeeFilter(value) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  if (normalized.length > 120) throw createHttpError(400, "invalid_absence_employee_filter");
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

function mapEmployee(row) {
  if (!row?.employee_tenant_user_id) return null;
  const name = row.employee_name || "Medarbejder";
  const username = String(row.employee_username || "").trim();
  const initials = username ? username.toUpperCase() : name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || null;
  return {
    id: row.employee_tenant_user_id,
    display_name: name,
    initials,
  };
}

function mapManagerRequest(row, { includeComment = false } = {}) {
  const request = mapRequest(row, { includeComment: false });
  request.employee = mapEmployee(row);
  request.has_private_comment = Boolean(normalizeOptionalText(row.employee_comment));
  request.reviewed_at = row.reviewed_at || null;
  if (includeComment) {
    request.employee_comment = row.employee_comment || null;
  }
  return request;
}

function mapManagerEvent(row) {
  return {
    id: row.id,
    event_type: row.event_type,
    actor: row.actor_tenant_user_id ? {
      id: row.actor_tenant_user_id,
      display_name: row.actor_name || null,
    } : null,
    old_status: row.old_status,
    new_status: row.new_status,
    reason: row.reason || null,
    metadata: row.metadata_json || {},
    created_at: row.created_at,
  };
}
function mapEvent(row) {
  return {
    id: row.id,
    event_type: row.event_type,
    actor: row.actor_tenant_user_id ? {
      id: row.actor_tenant_user_id,
      display_name: row.actor_name || null,
    } : null,
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

async function auditApprovedAbsenceCreated(client, {
  tenantId,
  actorId,
  approvedAbsence,
  absenceRequest,
}) {
  await auditService.logAuditEvent({
    client,
    tenantId,
    actorId,
    actorType: "tenant_user",
    actorScope: "tenant",
    moduleKey: "calendar_event",
    eventType: "approved_absence.created",
    resourceType: "approved_absence",
    resourceId: approvedAbsence.id,
    outcome: "success",
    metadata: {
      approved_absence_id: approvedAbsence.id,
      absence_request_id: absenceRequest.id,
      employee_tenant_user_id: absenceRequest.employee_tenant_user_id,
      source_type: approvedAbsence.source_type,
      source_id: approvedAbsence.source_id,
    },
  });
}

function absenceTypeFromRequestRow(row) {
  return {
    id: row.absence_type_id,
    key: row.absence_type_key || null,
    name: row.absence_type_name || null,
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

function validateManagedRequestType(row) {
  const absenceType = absenceTypeFromRequestRow(row);
  if (absenceType.workflow_mode !== "request") {
    throw createHttpError(400, "absence_type_workflow_not_request");
  }
  assertAbsenceTypeAllowsDuration(absenceType, row.duration_type);
}

function specialWindowStillCoversRequest(row) {
  if (!row.special_window_id) return true;
  const start = toDateString(row.start_date);
  const end = requestEndDateForWindow(row);
  const windowStart = toDateString(row.special_window_absence_start_date);
  const windowEnd = toDateString(row.special_window_absence_end_date);
  return Boolean(windowStart && windowEnd && windowStart <= start && windowEnd >= end);
}

function validateSpecialWindowForDecision(row, { action, hasBeforeReviewOverride, reason }) {
  if (!row.special_window_id) return { override: false, metadata: {} };
  if (!row.special_window_name && !row.special_window_review_start_date) {
    throw createHttpError(409, "absence_special_window_not_available");
  }
  if (row.special_window_is_active !== true && !specialWindowStillCoversRequest(row)) {
    throw createHttpError(409, "absence_special_window_not_available");
  }

  const reviewStartDate = toDateString(row.special_window_review_start_date);
  const approvalBlocked = row.special_window_approval_blocked_before_review !== false;
  const beforeReview = Boolean(reviewStartDate && todayDate() < reviewStartDate);
  if (!approvalBlocked || !beforeReview) {
    return { override: false, metadata: {} };
  }

  if (!hasBeforeReviewOverride) {
    throw createHttpError(409, `absence_special_window_${action}_blocked_before_review`);
  }
  if (!normalizeOptionalText(reason)) {
    throw createHttpError(400, "absence_special_window_override_reason_required");
  }
  return {
    override: true,
    metadata: {
      special_window_id: row.special_window_id,
      review_start_date: reviewStartDate,
      override: true,
    },
  };
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

function isVacationDayAbsenceType(absenceType) {
  const key = String(absenceType && (absenceType.key || absenceType.absence_type_key) || "").trim().toLowerCase();
  const name = String(absenceType && (absenceType.name || absenceType.absence_type_name) || "").trim().toLowerCase();
  return key === "vacation_day" || name === "feriefridag";
}

function enumerateDateRange(startDate, endDate) {
  const start = toDateString(startDate);
  const end = toDateString(endDate || startDate);
  if (!start || !end || end < start) return [];
  const days = [];
  let cursor = start;
  while (cursor <= end) {
    days.push(cursor);
    cursor = shiftDateString(cursor, 1);
    if (!cursor) break;
  }
  return days;
}

function shouldResolveSpecialWindow(absenceType) {
  return absenceType.special_window_eligible === true;
}

function shiftDateString(dateString, days) {
  const normalized = toDateString(dateString);
  if (!normalized) return null;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mapPreflightWindow(specialWindow) {
  if (!specialWindow) return null;
  return {
    id: specialWindow.id,
    key: specialWindow.key || null,
    name: specialWindow.name || null,
    absence_start_date: toDateString(specialWindow.absence_start_date),
    absence_end_date: toDateString(specialWindow.absence_end_date),
    submission_open_date: toDateString(specialWindow.submission_open_date),
    submission_deadline: toDateString(specialWindow.submission_deadline),
    review_start_date: toDateString(specialWindow.review_start_date),
    late_submission_policy: specialWindow.late_submission_policy || "blocked",
    vacation_day_exemption_quota: Number.isInteger(Number(specialWindow.vacation_day_exemption_quota)) ? Number(specialWindow.vacation_day_exemption_quota) : 1,
    collective_processing: specialWindow.collective_processing === true,
  };
}

function buildSpecialWindowOverlapDetails(overlaps, { startDate, endDate }) {
  const requestStart = toDateString(startDate);
  const requestEnd = toDateString(endDate || startDate);
  const specialWindows = (overlaps || []).map(mapPreflightWindow).filter(Boolean);
  const primaryWindow = specialWindows[0] || null;
  const segments = [];

  if (requestStart && requestEnd && primaryWindow?.absence_start_date && primaryWindow.absence_end_date) {
    const insideStart = requestStart > primaryWindow.absence_start_date ? requestStart : primaryWindow.absence_start_date;
    const insideEnd = requestEnd < primaryWindow.absence_end_date ? requestEnd : primaryWindow.absence_end_date;
    const beforeEnd = shiftDateString(insideStart, -1);
    const afterStart = shiftDateString(insideEnd, 1);
    if (requestStart < insideStart && beforeEnd && requestStart <= beforeEnd) {
      segments.push({ start_date: requestStart, end_date: beforeEnd, special_window: null });
    }
    if (insideStart <= insideEnd) {
      segments.push({ start_date: insideStart, end_date: insideEnd, special_window: primaryWindow });
    }
    if (afterStart && afterStart <= requestEnd) {
      segments.push({ start_date: afterStart, end_date: requestEnd, special_window: null });
    }
  }

  return {
    requested_period: { start_date: requestStart, end_date: requestEnd },
    special_windows: specialWindows,
    split_suggestion: segments,
  };
}

function buildVacationDayQuotaDetails(specialWindow, { startDate, endDate, usedDates, exemptDates, normalWindowDates }) {
  const windowInfo = mapPreflightWindow(specialWindow);
  const requestedPeriod = { start_date: toDateString(startDate), end_date: toDateString(endDate || startDate) };
  const quota = Number.isInteger(Number(specialWindow.vacation_day_exemption_quota)) ? Number(specialWindow.vacation_day_exemption_quota) : 1;
  const used = Array.from(new Set((usedDates || []).map(toDateString).filter(Boolean))).sort();
  const exempt = Array.from(new Set((exemptDates || []).map(toDateString).filter(Boolean))).sort();
  const normal = Array.from(new Set((normalWindowDates || []).map(toDateString).filter(Boolean))).sort();
  const segments = [];
  let cursor = requestedPeriod.start_date;
  const end = requestedPeriod.end_date;
  const exemptSet = new Set(exempt);
  const normalSet = new Set(normal);
  while (cursor && cursor <= end) {
    const special = normalSet.has(cursor) ? windowInfo : null;
    const quotaExempt = exemptSet.has(cursor);
    const start = cursor;
    let segmentEnd = cursor;
    let next = shiftDateString(cursor, 1);
    while (next && next <= end && (normalSet.has(next) ? windowInfo.id : null) === (special ? windowInfo.id : null) && exemptSet.has(next) === quotaExempt) {
      segmentEnd = next;
      next = shiftDateString(next, 1);
    }
    segments.push({ start_date: start, end_date: segmentEnd, special_window: special, vacation_day_quota_exempt: quotaExempt });
    cursor = next;
  }
  return {
    requested_period: requestedPeriod,
    special_windows: [windowInfo],
    special_window: windowInfo,
    vacation_day_quota: {
      quota,
      used_count: used.length,
      remaining_before_request: Math.max(0, quota - used.length),
      request_uses_count: exempt.length,
      used_after_request: Math.min(quota, used.length + exempt.length),
      remaining_after_request: Math.max(0, quota - used.length - exempt.length),
      used_dates: used,
      exempt_dates: exempt,
      normal_window_dates: normal,
    },
    split_suggestion: segments,
  };
}

async function buildVacationDayQuotaPreflightDetails(client, {
  tenantId,
  employeeTenantUserId,
  absenceType,
  absenceTypeId,
  startDate,
  endDate,
}) {
  if (!shouldResolveSpecialWindow(absenceType) || !isVacationDayAbsenceType(absenceType)) return null;
  const overlaps = await absenceSpecialWindowRepository.listOverlappingActiveScopedForEmployee(client, {
    tenantId,
    employeeTenantUserId,
    absenceTypeId,
    startDate,
    endDate,
  });
  const safeMatches = new Map();
  for (const row of overlaps) {
    if (row.scope_type === "tenant" || row.scope_type === "tenant_user" || row.scope_type === "resource_group") {
      safeMatches.set(String(row.id), row);
    }
  }
  if (safeMatches.size !== 1) return null;
  const specialWindow = Array.from(safeMatches.values())[0];
  const requestDays = enumerateDateRange(startDate, endDate || startDate);
  const windowStart = toDateString(specialWindow.absence_start_date);
  const windowEnd = toDateString(specialWindow.absence_end_date);
  const insideDays = requestDays.filter((day) => day >= windowStart && day <= windowEnd);
  if (insideDays.length === 0) return null;
  const usedDates = (await absenceSpecialWindowRepository.listVacationDayQuotaUsageDates(client, {
    tenantId,
    employeeTenantUserId,
    specialWindowId: specialWindow.id,
  })).map(toDateString).filter(Boolean);
  const usedSet = new Set(usedDates);
  const quota = Number.isInteger(Number(specialWindow.vacation_day_exemption_quota)) ? Number(specialWindow.vacation_day_exemption_quota) : 1;
  const remaining = Math.max(0, quota - usedSet.size);
  const exemptDates = insideDays.filter((day) => !usedSet.has(day)).slice(0, remaining);
  const exemptSet = new Set(exemptDates);
  const normalWindowDates = insideDays.filter((day) => !exemptSet.has(day));
  return buildVacationDayQuotaDetails(specialWindow, {
    startDate,
    endDate: endDate || startDate,
    usedDates,
    exemptDates,
    normalWindowDates,
  });
}
async function resolveSpecialWindow(client, {
  tenantId,
  employeeTenantUserId,
  absenceType,
  absenceTypeId,
  startDate,
  endDate,
  lockVacationDayQuota = false,
  reservedVacationDayQuotaDatesByWindowId = null,
}) {
  if (!shouldResolveSpecialWindow(absenceType)) return null;
  const overlaps = await absenceSpecialWindowRepository.listOverlappingActiveScopedForEmployee(client, {
    tenantId,
    employeeTenantUserId,
    absenceTypeId,
    startDate,
    endDate,
  });
  if (overlaps.length === 0) return null;
  const safeMatches = new Map();
  for (const row of overlaps) {
    if (row.scope_type === "tenant" || row.scope_type === "tenant_user" || row.scope_type === "resource_group") {
      safeMatches.set(String(row.id), row);
    }
  }
  if (safeMatches.size === 0) {
    throw createHttpError(409, "absence_special_window_scope_unclear", buildSpecialWindowOverlapDetails(overlaps, { startDate, endDate }));
  }
  if (safeMatches.size > 1) {
    throw createHttpError(409, "absence_special_window_conflict", buildSpecialWindowOverlapDetails(Array.from(safeMatches.values()), { startDate, endDate }));
  }
  const specialWindow = Array.from(safeMatches.values())[0];
  if (isVacationDayAbsenceType(absenceType)) {
    if (lockVacationDayQuota) {
      await absenceRequestRepository.acquireIdempotencyLock(client, {
        lockKey: `absence:vacation-day-quota:${tenantId}:${employeeTenantUserId}:${specialWindow.id}`,
      });
    }
    const requestDays = enumerateDateRange(startDate, endDate || startDate);
    const insideDays = requestDays.filter((day) => day >= toDateString(specialWindow.absence_start_date) && day <= toDateString(specialWindow.absence_end_date));
    const usedDates = (await absenceSpecialWindowRepository.listVacationDayQuotaUsageDates(client, {
      tenantId,
      employeeTenantUserId,
      specialWindowId: specialWindow.id,
    })).map(toDateString).filter(Boolean);
    const reservedSet = reservedVacationDayQuotaDatesByWindowId?.get(String(specialWindow.id)) || new Set();
    const usedSet = new Set([...usedDates, ...Array.from(reservedSet)]);
    const quota = Number.isInteger(Number(specialWindow.vacation_day_exemption_quota)) ? Number(specialWindow.vacation_day_exemption_quota) : 1;
    const remaining = Math.max(0, quota - usedSet.size);
    const exemptDates = insideDays.filter((day) => !usedSet.has(day)).slice(0, remaining);
    const exemptSet = new Set(exemptDates);
    const normalWindowDates = insideDays.filter((day) => !exemptSet.has(day));
    const details = buildVacationDayQuotaDetails(specialWindow, {
      startDate,
      endDate: endDate || startDate,
      usedDates: Array.from(usedSet),
      exemptDates,
      normalWindowDates,
    });
    if (normalWindowDates.length === 0) {
      if (reservedVacationDayQuotaDatesByWindowId) {
        const nextReserved = reservedVacationDayQuotaDatesByWindowId.get(String(specialWindow.id)) || new Set();
        exemptDates.forEach((day) => nextReserved.add(day));
        reservedVacationDayQuotaDatesByWindowId.set(String(specialWindow.id), nextReserved);
      }
      return null;
    }
    if (exemptDates.length > 0 || overlaps.some((row) => row.fully_contains_request !== true)) {
      throw createHttpError(409, "absence_vacation_day_quota_split_required", details);
    }
    return specialWindow;
  }
  if (overlaps.some((row) => row.fully_contains_request !== true)) {
    throw createHttpError(409, "absence_special_window_partial_overlap", buildSpecialWindowOverlapDetails(overlaps, { startDate, endDate }));
  }
  return specialWindow;
}
function validateSpecialWindowSubmissionTiming(specialWindow, { asOfDate = todayDate() } = {}) {
  if (!specialWindow) return { submittedAfterDeadline: false, metadata: {} };
  const openDate = toDateString(specialWindow.submission_open_date);
  const deadline = toDateString(specialWindow.submission_deadline);
  if (openDate && asOfDate < openDate) {
    throw createHttpError(409, "absence_special_window_not_open", {
      special_window_id: specialWindow.id,
      special_window_name: specialWindow.name || null,
      submission_open_date: openDate,
    });
  }
  if (!deadline || asOfDate <= deadline) return { submittedAfterDeadline: false, metadata: {} };

  const policy = specialWindow.late_submission_policy || "blocked";
  if (policy === "blocked") {
    throw createHttpError(409, "absence_special_window_deadline_passed", {
      special_window_id: specialWindow.id,
      special_window_name: specialWindow.name || null,
      submission_deadline: deadline,
    });
  }
  return {
    submittedAfterDeadline: true,
    metadata: {
      submitted_after_deadline: true,
      late_submission_policy: policy,
      late_submission_requires_manual_review: policy === "manual_review",
      special_window_submission_deadline: deadline,
    },
  };
}


function buildSpecialWindowPreflightResult(specialWindow, { asOfDate = todayDate() } = {}) {
  if (!specialWindow) return { state: "no_match", can_submit: true, special_window: null };
  const window = mapPreflightWindow(specialWindow);
  if (window.submission_open_date && asOfDate < window.submission_open_date) {
    return { state: "before_open", can_submit: false, special_window: window };
  }
  if (!window.submission_deadline || asOfDate <= window.submission_deadline) {
    return { state: "open", can_submit: true, special_window: window };
  }
  const policy = window.late_submission_policy || "blocked";
  if (policy === "blocked") return { state: "after_deadline_blocked", can_submit: false, late: true, late_submission_policy: policy, special_window: window };
  if (policy === "manual_review") return { state: "after_deadline_manual_review", can_submit: true, late: true, late_submission_policy: policy, special_window: window };
  return { state: "after_deadline_allowed", can_submit: true, late: true, late_submission_policy: policy, special_window: window };
}

function buildVacationDayQuotaPreflightResult(details, { asOfDate = todayDate() } = {}) {
  if (!details || !details.special_window || !details.vacation_day_quota) return null;
  const normalDates = Array.isArray(details.vacation_day_quota.normal_window_dates) ? details.vacation_day_quota.normal_window_dates : [];
  const exemptDates = Array.isArray(details.vacation_day_quota.exempt_dates) ? details.vacation_day_quota.exempt_dates : [];
  if (normalDates.length === 0) {
    return {
      state: "vacation_day_quota_exempt",
      can_submit: true,
      special_window: details.special_window,
      requested_period: details.requested_period,
      special_windows: details.special_windows || [],
      vacation_day_quota: details.vacation_day_quota,
      split_suggestion: details.split_suggestion || [],
    };
  }
  if (exemptDates.length > 0) {
    return {
      state: "vacation_day_quota_split_required",
      can_submit: false,
      reason: "absence_vacation_day_quota_split_required",
      special_window: details.special_window,
      requested_period: details.requested_period,
      special_windows: details.special_windows || [],
      vacation_day_quota: details.vacation_day_quota,
      split_suggestion: details.split_suggestion || [],
    };
  }
  const base = buildSpecialWindowPreflightResult(details.special_window, { asOfDate });
  return {
    ...base,
    state: base.state === "open" ? "vacation_day_quota_collective" : base.state,
    requested_period: details.requested_period,
    special_windows: details.special_windows || [],
    vacation_day_quota: details.vacation_day_quota,
    split_suggestion: details.split_suggestion || [],
  };
}
function summarizeSplitPayload(payload) {
  if (!payload) return null;
  return {
    absence_type_id: payload.absenceTypeId || payload.absence_type_id || null,
    duration_type: payload.durationType || payload.duration_type || null,
    start_date: payload.startDate || payload.start_date || null,
    end_date: payload.endDate || payload.end_date || payload.startDate || payload.start_date || null,
  };
}

function segmentErrorDetails(error, index, payload) {
  return {
    segment_index: index + 1,
    segment: summarizeSplitPayload(payload),
    cause_code: error && error.message ? String(error.message) : "absence_split_segment_failed",
    cause_details: error && error.details ? error.details : null,
  };
}

function throwSplitSegmentError(error, index, payload) {
  throw createHttpError(error && error.statusCode ? error.statusCode : 409, "absence_split_segment_failed", segmentErrorDetails(error, index, payload));
}

function normalizeSplitSegmentsPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw createHttpError(400, "absence_split_segments_required");
  for (const key of Object.keys(body)) {
    if (key !== "segments") throw createHttpError(400, "absence_split_unknown_field");
  }
  if (!Array.isArray(body.segments) || body.segments.length < 2) throw createHttpError(400, "absence_split_segments_required");
  if (body.segments.length > MAX_SPLIT_SEGMENTS) throw createHttpError(400, "absence_split_too_many_segments");
  return body.segments.map((segment, index) => {
    try {
      const payload = normalizeCreatePayload(segment || {});
      if (payload.durationType !== "full_days") throw createHttpError(400, "absence_split_full_days_only");
      return payload;
    } catch (error) {
      throwSplitSegmentError(error, index, segment);
    }
  });
}

async function validateSplitSegmentsForSubmit(client, { tenantId, employeeTenantUserId, segments }) {
  const manager = await resolvePrimaryManager(client, { tenantId, employeeTenantUserId });
  const validated = [];
  const reservedVacationDayQuotaDatesByWindowId = new Map();
  for (let index = 0; index < segments.length; index += 1) {
    const payload = segments[index];
    try {
      const absenceType = await requireAbsenceType(client, { tenantId, absenceTypeId: payload.absenceTypeId });
      validatePayloadAgainstType(absenceType, payload);
      const specialWindow = await resolveSpecialWindow(client, {
        tenantId,
        employeeTenantUserId,
        absenceType,
        absenceTypeId: payload.absenceTypeId,
        startDate: payload.startDate,
        endDate: requestEndDateForWindow(payload),
        lockVacationDayQuota: true,
        reservedVacationDayQuotaDatesByWindowId,
      });
      const specialWindowSubmission = validateSpecialWindowSubmissionTiming(specialWindow);
      validated.push({ payload, absenceType, specialWindow, specialWindowSubmission });
    } catch (error) {
      throwSplitSegmentError(error, index, payload);
    }
  }
  return { manager, validated };
}

function preflightResultFromSpecialWindowError(error) {
  const code = error && error.message ? String(error.message) : "";
  const details = error && error.details && typeof error.details === "object" ? error.details : {};
  if (code === "absence_vacation_day_quota_split_required") {
    return {
      state: "vacation_day_quota_split_required",
      can_submit: false,
      reason: code,
      special_window: details.special_window || (details.special_windows && details.special_windows[0] ? details.special_windows[0] : null),
      requested_period: details.requested_period || null,
      special_windows: details.special_windows || [],
      vacation_day_quota: details.vacation_day_quota || null,
      split_suggestion: details.split_suggestion || [],
    };
  }
  if (code === "absence_special_window_partial_overlap") {
    return {
      state: "partial_overlap",
      can_submit: false,
      reason: code,
      special_window: details.special_windows && details.special_windows[0] ? details.special_windows[0] : null,
      requested_period: details.requested_period || null,
      special_windows: details.special_windows || [],
      split_suggestion: details.split_suggestion || [],
    };
  }
  if (code === "absence_special_window_conflict" || code === "absence_special_window_scope_unclear") {
    return {
      state: "multiple_matches",
      can_submit: false,
      reason: code,
      special_window: null,
      requested_period: details.requested_period || null,
      special_windows: details.special_windows || [],
    };
  }
  return null;
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

async function listManagedPending({ tenantId, userId, filters = {} }) {
  const normalizedTenantId = normalizeUuid(tenantId, "tenant_id_required");
  const normalizedUserId = normalizeUuid(userId, "tenant_user_id_required");
  const statuses = normalizeManagerStatusList(filters.status);
  const dateFrom = normalizeFilterDate(filters.date_from || filters.from, "invalid_absence_request_date_from");
  const dateTo = normalizeFilterDate(filters.date_to || filters.to, "invalid_absence_request_date_to");
  const employee = normalizeEmployeeFilter(filters.employee);
  const absenceTypeId = normalizeOptionalUuid(filters.absence_type || filters.absence_type_id, "invalid_absence_type_id");
  const specialWindowId = normalizeOptionalUuid(filters.special_window || filters.special_window_id, "invalid_absence_special_window_id");
  const limit = normalizeLimit(filters.limit);
  const offset = normalizeOffset(filters.offset);
  if (dateFrom && dateTo && dateTo < dateFrom) throw createHttpError(400, "absence_request_date_filter_invalid_range");

  const client = await pool.connect();
  try {
    const rows = await absenceRequestRepository.listForManager(client, {
      tenantId: normalizedTenantId,
      managerTenantUserId: normalizedUserId,
      statuses,
      dateFrom,
      dateTo,
      employee,
      absenceTypeId,
      specialWindowId,
      limit,
      offset,
    });
    return {
      requests: rows.map((row) => mapManagerRequest(row, { includeComment: false })),
      limit,
      offset,
      statuses,
    };
  } finally {
    client.release();
  }
}

async function getManagedDetail({ tenantId, userId, absenceRequestId, includePrivateComment = false }) {
  const normalizedTenantId = normalizeUuid(tenantId, "tenant_id_required");
  const normalizedUserId = normalizeUuid(userId, "tenant_user_id_required");
  const normalizedRequestId = normalizeUuid(absenceRequestId, "absence_request_id_required");

  const client = await pool.connect();
  try {
    const row = await absenceRequestRepository.findByIdForManager(client, {
      tenantId: normalizedTenantId,
      managerTenantUserId: normalizedUserId,
      absenceRequestId: normalizedRequestId,
    });
    if (!row) throw createHttpError(404, "absence_request_not_found");
    const events = await absenceRequestRepository.listEvents(client, {
      tenantId: normalizedTenantId,
      absenceRequestId: normalizedRequestId,
    });
    return {
      request: mapManagerRequest(row, { includeComment: includePrivateComment || String(row.assigned_manager_tenant_user_id) === String(normalizedUserId) }),
      events: events.map(mapManagerEvent),
    };
  } finally {
    client.release();
  }
}

async function decideManaged({
  tenantId,
  userId,
  absenceRequestId,
  body,
  action,
  hasBeforeReviewOverride = false,
  idempotencyKey = null,
}) {
  const normalizedTenantId = normalizeUuid(tenantId, "tenant_id_required");
  const normalizedUserId = normalizeUuid(userId, "tenant_user_id_required");
  const normalizedRequestId = normalizeUuid(absenceRequestId, "absence_request_id_required");
  const payload = action === "approve" ? normalizeApprovePayload(body || {}) : normalizeRejectPayload(body || {});
  const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
  const targetStatus = action === "approve" ? "approved" : "rejected";
  const eventType = targetStatus;

  return withTransaction(async (client) => {
    if (normalizedIdempotencyKey) {
      await absenceRequestRepository.acquireIdempotencyLock(client, {
        lockKey: `absence:${action}:${normalizedTenantId}:${normalizedUserId}:${normalizedRequestId}:${normalizedIdempotencyKey}`,
      });
    }

    const existing = await absenceRequestRepository.findByIdForManager(client, {
      tenantId: normalizedTenantId,
      managerTenantUserId: normalizedUserId,
      absenceRequestId: normalizedRequestId,
      forUpdate: true,
    });
    if (!existing) throw createHttpError(404, "absence_request_not_found");

    if (existing.status === targetStatus && (Number(existing.version) === payload.version || Number(existing.version) === payload.version + 1)) {
      return { request: mapManagerRequest(existing, { includeComment: false }), idempotent: true };
    }
    if (!MANAGER_DECISION_ALLOWED_STATUSES.includes(existing.status)) {
      throw createHttpError(409, "absence_request_not_reviewable");
    }
    if (Number(existing.version) !== payload.version) {
      throw createHttpError(409, "absence_request_version_conflict");
    }

    validateManagedRequestType(existing);
    const specialWindowDecision = validateSpecialWindowForDecision(existing, {
      action,
      hasBeforeReviewOverride,
      reason: payload.reason,
    });

    const updated = await absenceRequestRepository.updateManagedDecision(client, {
      tenantId: normalizedTenantId,
      managerTenantUserId: normalizedUserId,
      absenceRequestId: normalizedRequestId,
      expectedVersion: payload.version,
      fromStatuses: MANAGER_DECISION_ALLOWED_STATUSES,
      toStatus: targetStatus,
    });
    if (!updated) throw createHttpError(409, "absence_request_version_conflict");

    let approvedAbsenceResult = null;
    if (action === "approve") {
      approvedAbsenceResult = await approvedAbsenceService.materializeFromApprovedRequest(client, {
        tenantId: normalizedTenantId,
        absenceRequest: {
          ...existing,
          ...updated,
          absence_type_visibility_policy: existing.absence_type_visibility_policy,
        },
        approvedByTenantUserId: normalizedUserId,
      });
    }

    const eventMetadata = {
      old_version: payload.version,
      new_version: updated.version,
      ...specialWindowDecision.metadata,
    };
    if (approvedAbsenceResult?.approvedAbsence?.id) eventMetadata.approved_absence_id = approvedAbsenceResult.approvedAbsence.id;
    if (normalizedIdempotencyKey) eventMetadata.idempotency_key = normalizedIdempotencyKey;

    await absenceRequestRepository.insertEvent(client, {
      tenantId: normalizedTenantId,
      absenceRequestId: normalizedRequestId,
      eventType,
      actorTenantUserId: normalizedUserId,
      oldStatus: existing.status,
      newStatus: targetStatus,
      reason: payload.reason || null,
      metadata: eventMetadata,
    });
    await audit(client, {
      tenantId: normalizedTenantId,
      actorId: normalizedUserId,
      eventType: `absence_request.${targetStatus}`,
      requestId: normalizedRequestId,
      metadata: {
        request_id: normalizedRequestId,
        employee_tenant_user_id: existing.employee_tenant_user_id,
        manager_tenant_user_id: normalizedUserId,
        old_status: existing.status,
        new_status: targetStatus,
        old_version: payload.version,
        new_version: updated.version,
        special_window_override: specialWindowDecision.override,
        approved_absence_id: approvedAbsenceResult?.approvedAbsence?.id || null,
      },
    });
    if (approvedAbsenceResult?.created) {
      await auditApprovedAbsenceCreated(client, {
        tenantId: normalizedTenantId,
        actorId: normalizedUserId,
        approvedAbsence: approvedAbsenceResult.approvedAbsence,
        absenceRequest: updated,
      });
    }

    const requestContext = await requireNotificationContext(client, {
      tenantId: normalizedTenantId,
      absenceRequestId: normalizedRequestId,
    });
    if (action === "approve") {
      await absenceNotificationService.enqueueAbsenceApproved(client, {
        tenantId: normalizedTenantId,
        actorId: normalizedUserId,
        requestContext,
      });
    } else {
      await absenceNotificationService.enqueueAbsenceRejected(client, {
        tenantId: normalizedTenantId,
        actorId: normalizedUserId,
        requestContext,
        decisionReason: payload.reason,
      });
    }

    const row = await absenceRequestRepository.findByIdForManager(client, {
      tenantId: normalizedTenantId,
      managerTenantUserId: normalizedUserId,
      absenceRequestId: normalizedRequestId,
    });
    return { request: mapManagerRequest(row, { includeComment: false }), idempotent: false };
  });
}

async function approveManaged(args) {
  return decideManaged({ ...args, action: "approve" });
}

async function rejectManaged(args) {
  return decideManaged({ ...args, action: "reject" });
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

async function preflightEmployeeRequest({ tenantId, userId, body, asOfDate = todayDate() }) {
  const normalizedTenantId = normalizeUuid(tenantId, "tenant_id_required");
  const normalizedUserId = normalizeUuid(userId, "tenant_user_id_required");
  const payload = normalizePreflightPayload(body || {});

  const client = await pool.connect();
  try {
    const absenceType = await requireAbsenceType(client, { tenantId: normalizedTenantId, absenceTypeId: payload.absenceTypeId });
    assertAbsenceTypeAllowsEmployeeRequest(absenceType);
    assertAbsenceTypeAllowsDuration(absenceType, payload.durationType);
    try {
      const quotaDetails = await buildVacationDayQuotaPreflightDetails(client, {
        tenantId: normalizedTenantId,
        employeeTenantUserId: normalizedUserId,
        absenceType,
        absenceTypeId: payload.absenceTypeId,
        startDate: payload.startDate,
        endDate: requestEndDateForWindow(payload),
      });
      const quotaResult = buildVacationDayQuotaPreflightResult(quotaDetails, { asOfDate });
      if (quotaResult) return { preflight: quotaResult };
      const specialWindow = await resolveSpecialWindow(client, {
        tenantId: normalizedTenantId,
        employeeTenantUserId: normalizedUserId,
        absenceType,
        absenceTypeId: payload.absenceTypeId,
        startDate: payload.startDate,
        endDate: requestEndDateForWindow(payload),
      });
      return { preflight: buildSpecialWindowPreflightResult(specialWindow, { asOfDate }) };
    } catch (error) {
      const result = preflightResultFromSpecialWindowError(error);
      if (result) return { preflight: result };
      throw error;
    }
  } finally {
    client.release();
  }
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
      lockVacationDayQuota: true,
    });
    const specialWindowSubmission = validateSpecialWindowSubmissionTiming(specialWindow);

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
        ...specialWindowSubmission.metadata,
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
        ...specialWindowSubmission.metadata,
      },
    });
    if (specialWindowSubmission.submittedAfterDeadline) {
      await audit(client, {
        tenantId: normalizedTenantId,
        actorId: normalizedUserId,
        eventType: "absence_request.late_submitted",
        requestId: normalizedRequestId,
        metadata: {
          special_window_id: specialWindow?.id || null,
          special_window_name: specialWindow?.name || null,
          ...specialWindowSubmission.metadata,
        },
      });
    }
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

async function submitSplitSegments({ tenantId, userId, body, idempotencyKey }) {
  const normalizedTenantId = normalizeUuid(tenantId, "tenant_id_required");
  const normalizedUserId = normalizeUuid(userId, "tenant_user_id_required");
  const segments = normalizeSplitSegmentsPayload(body || {});
  const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);

  return withTransaction(async (client) => {
    if (normalizedIdempotencyKey) {
      await absenceRequestRepository.acquireIdempotencyLock(client, {
        lockKey: `absence:split-submit:${normalizedTenantId}:${normalizedUserId}:${normalizedIdempotencyKey}`,
      });
      const existing = await absenceRequestRepository.findCreatedBySplitIdempotencyKey(client, {
        tenantId: normalizedTenantId,
        employeeTenantUserId: normalizedUserId,
        splitIdempotencyKey: normalizedIdempotencyKey,
      });
      if (existing.length === segments.length) {
        return { requests: existing.map((row) => mapRequest(row)), idempotent: true };
      }
      if (existing.length > 0) {
        throw createHttpError(409, "absence_split_idempotency_partial", { expected_segments: segments.length, existing_segments: existing.length });
      }
    }

    const { manager, validated } = await validateSplitSegmentsForSubmit(client, {
      tenantId: normalizedTenantId,
      employeeTenantUserId: normalizedUserId,
      segments,
    });

    const requests = [];
    for (let index = 0; index < validated.length; index += 1) {
      const { payload, specialWindow, specialWindowSubmission } = validated[index];
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
          idempotency_key: normalizedIdempotencyKey ? `${normalizedIdempotencyKey}:create:${index + 1}` : null,
          split_idempotency_key: normalizedIdempotencyKey,
          split_segment_index: index + 1,
          split_segment_count: validated.length,
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
          split_segment_index: index + 1,
          split_segment_count: validated.length,
        },
      });

      const submitted = await absenceRequestRepository.submitDraftForEmployee(client, {
        tenantId: normalizedTenantId,
        employeeTenantUserId: normalizedUserId,
        absenceRequestId: request.id,
        expectedVersion: Number(request.version),
        managerTenantUserId: manager.manager_tenant_user_id,
        specialWindowId: specialWindow?.id || null,
      });
      if (!submitted) throw createHttpError(409, "absence_request_version_conflict");

      await absenceRequestRepository.insertEvent(client, {
        tenantId: normalizedTenantId,
        absenceRequestId: request.id,
        eventType: "submitted",
        actorTenantUserId: normalizedUserId,
        oldStatus: "draft",
        newStatus: "submitted",
        metadata: {
          manager_relation_id: manager.id,
          assigned_manager_tenant_user_id: manager.manager_tenant_user_id,
          special_window_id: specialWindow?.id || null,
          duration_type: payload.durationType,
          idempotency_key: normalizedIdempotencyKey ? `${normalizedIdempotencyKey}:submit:${index + 1}` : null,
          split_idempotency_key: normalizedIdempotencyKey,
          split_segment_index: index + 1,
          split_segment_count: validated.length,
          ...specialWindowSubmission.metadata,
        },
      });
      await audit(client, {
        tenantId: normalizedTenantId,
        actorId: normalizedUserId,
        eventType: "absence_request.submitted",
        requestId: request.id,
        metadata: {
          old_status: "draft",
          new_status: "submitted",
          old_version: Number(request.version),
          new_version: submitted.version,
          assigned_manager_tenant_user_id: manager.manager_tenant_user_id,
          special_window_id: specialWindow?.id || null,
          split_segment_index: index + 1,
          split_segment_count: validated.length,
          ...specialWindowSubmission.metadata,
        },
      });
      if (specialWindowSubmission.submittedAfterDeadline) {
        await audit(client, {
          tenantId: normalizedTenantId,
          actorId: normalizedUserId,
          eventType: "absence_request.late_submitted",
          requestId: request.id,
          metadata: {
            special_window_id: specialWindow?.id || null,
            special_window_name: specialWindow?.name || null,
            split_segment_index: index + 1,
            split_segment_count: validated.length,
            ...specialWindowSubmission.metadata,
          },
        });
      }
      await absenceNotificationService.enqueueAbsenceSubmitted(client, {
        tenantId: normalizedTenantId,
        actorId: normalizedUserId,
        requestContext: await requireNotificationContext(client, {
          tenantId: normalizedTenantId,
          absenceRequestId: request.id,
        }),
      });
      const row = await getDetailRow(client, {
        tenantId: normalizedTenantId,
        employeeTenantUserId: normalizedUserId,
        absenceRequestId: request.id,
      });
      requests.push(mapRequest(row));
    }

    return { requests, idempotent: false };
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
  approveManaged,
  cancelOwn,
  createDraft,
  getManagedDetail,
  getMineDetail,
  listManagedPending,
  listMine,
  mapEvent,
  mapRequest,
  preflightEmployeeRequest,
  rejectManaged,
  submitDraft,
  submitSplitSegments,
  updateDraft,
  _test: {
    absenceTypeFromRequestRow,
    displayStatus,
    mapManagerRequest,
    buildVacationDayQuotaPreflightResult,
    mapRequest,
    buildSpecialWindowOverlapDetails,
    buildSpecialWindowPreflightResult,
    normalizeIdempotencyKey,
    normalizeSplitSegmentsPayload,
    preflightResultFromSpecialWindowError,
    resolveSpecialWindow,
    segmentErrorDetails,
    validateManagedRequestType,
    validateSpecialWindowForDecision,
    validateSpecialWindowSubmissionTiming,
    validatePayloadAgainstType,
  },
};
