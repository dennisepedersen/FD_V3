"use strict";

const { createHttpError } = require("../../middleware/errorHandler");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const ALLOWED_LATE_POLICIES = new Set(["blocked", "manual_review", "allowed"]);
const ALLOWED_SCOPE_TYPES = new Set(["tenant", "tenant_user", "resource_group"]);
const CREATE_FIELDS = new Set([
  "key",
  "name",
  "description",
  "absence_start_date",
  "absence_end_date",
  "submission_open_date",
  "submission_deadline",
  "review_start_date",
  "collective_processing",
  "approval_blocked_before_review",
  "late_submission_policy",
  "vacation_day_exemption_quota",
  "receipt_text",
  "is_active",
  "scopes",
  "absence_type_ids",
  "absence_type_scopes",
]);
const UPDATE_FIELDS = new Set([
  "version",
  "name",
  "description",
  "absence_start_date",
  "absence_end_date",
  "submission_open_date",
  "submission_deadline",
  "review_start_date",
  "collective_processing",
  "approval_blocked_before_review",
  "late_submission_policy",
  "vacation_day_exemption_quota",
  "receipt_text",
  "is_active",
  "scopes",
  "absence_type_ids",
  "absence_type_scopes",
]);
const TEXT_ONLY_FIELDS = new Set(["name", "description", "receipt_text"]);
const PROTECTED_AFTER_REQUEST_FIELDS = new Set([
  "absence_start_date",
  "absence_end_date",
  "submission_open_date",
  "submission_deadline",
  "review_start_date",
  "collective_processing",
  "approval_blocked_before_review",
  "late_submission_policy",
  "vacation_day_exemption_quota",
  "is_active",
  "scopes",
  "absence_type_ids",
  "absence_type_scopes",
]);
const SERVER_MANAGED_FIELDS = new Set([
  "id",
  "tenant_id",
  "created_by_tenant_user_id",
  "updated_by_tenant_user_id",
  "created_at",
  "updated_at",
  "status",
  "actor",
  "audit_actor",
]);

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeRequiredText(value, errorCode) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) throw createHttpError(400, errorCode);
  return normalized;
}

function normalizeUuid(value, errorCode) {
  const normalized = normalizeRequiredText(value, errorCode).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw createHttpError(400, errorCode);
  return normalized;
}

function normalizeOptionalUuid(value, errorCode) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  if (!UUID_PATTERN.test(normalized)) throw createHttpError(400, errorCode);
  return normalized.toLowerCase();
}

function toDateString(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
function normalizeDate(value, errorCode) {
  const normalized = normalizeRequiredText(value, errorCode);
  if (!DATE_PATTERN.test(normalized)) throw createHttpError(400, errorCode);
  const [year, month, day] = normalized.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw createHttpError(400, errorCode);
  }
  return normalized;
}

function normalizeBoolean(value, defaultValue) {
  if (value === undefined || value === null) return defaultValue;
  if (value === true || value === false) return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  throw createHttpError(400, "invalid_boolean");
}

function normalizeVersion(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw createHttpError(400, "version_required");
  return number;
}

function normalizeLimit(value) {
  if (value === undefined || value === null || value === "") return 100;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 200) throw createHttpError(400, "invalid_special_window_limit");
  return number;
}

function normalizeOffset(value) {
  if (value === undefined || value === null || value === "") return 0;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw createHttpError(400, "invalid_special_window_offset");
  return number;
}

function rejectUnknownFields(body, allowedFields) {
  for (const key of Object.keys(body || {})) {
    if (SERVER_MANAGED_FIELDS.has(key)) throw createHttpError(400, "special_window_server_managed_field");
    if (!allowedFields.has(key)) throw createHttpError(400, "special_window_unknown_field");
  }
}

function normalizeKey(value) {
  const key = normalizeRequiredText(value, "special_window_key_required").toLowerCase();
  if (!KEY_PATTERN.test(key)) throw createHttpError(400, "invalid_special_window_key");
  return key;
}

function normalizeName(value) {
  const name = normalizeRequiredText(value, "special_window_name_required");
  if (name.length > 160) throw createHttpError(400, "special_window_name_too_long");
  return name;
}

function normalizeDescription(value) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  if (normalized.length > 1000) throw createHttpError(400, "special_window_description_too_long");
  return normalized;
}

function normalizeReceiptText(value) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  if (normalized.length > 2000) throw createHttpError(400, "special_window_receipt_text_too_long");
  return normalized;
}

function normalizeLateSubmissionPolicy(value) {
  const normalized = normalizeRequiredText(value || "blocked", "late_submission_policy_required").toLowerCase();
  if (!ALLOWED_LATE_POLICIES.has(normalized)) throw createHttpError(400, "invalid_late_submission_policy");
  return normalized;
}

function normalizeVacationDayExemptionQuota(value) {
  if (value === undefined || value === null || value === "") return 1;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 31) throw createHttpError(400, "invalid_vacation_day_exemption_quota");
  return number;
}

function assertDateRules(payload) {
  if (payload.absenceEndDate < payload.absenceStartDate) throw createHttpError(400, "special_window_absence_end_before_start");
  if (payload.submissionDeadline < payload.submissionOpenDate) throw createHttpError(400, "special_window_deadline_before_open");
  if (payload.reviewStartDate < payload.submissionDeadline) throw createHttpError(400, "special_window_review_before_deadline");
  if (payload.submissionOpenDate > payload.absenceStartDate) throw createHttpError(400, "special_window_open_after_absence_start");
  if (payload.submissionDeadline > payload.absenceStartDate) throw createHttpError(400, "special_window_deadline_after_absence_start");
}

function normalizeCorePayload(body, existing = null, { requireAll = false } = {}) {
  const source = body || {};
  const get = (wire, current) => Object.prototype.hasOwnProperty.call(source, wire) ? source[wire] : current;
  const payload = {};
  if (Object.prototype.hasOwnProperty.call(source, "key")) payload.key = normalizeKey(get("key", existing?.key));
  else if (requireAll) payload.key = null;
  if (requireAll || Object.prototype.hasOwnProperty.call(source, "name")) payload.name = normalizeName(get("name", existing?.name));
  if (requireAll || Object.prototype.hasOwnProperty.call(source, "description")) {
    payload.description = normalizeDescription(get("description", existing?.description));
    payload.hasDescription = true;
  }
  if (requireAll || Object.prototype.hasOwnProperty.call(source, "receipt_text")) {
    payload.receiptText = normalizeReceiptText(get("receipt_text", existing?.receipt_text));
    payload.hasReceiptText = true;
  }
  for (const [wire, key, error] of [
    ["absence_start_date", "absenceStartDate", "special_window_absence_start_date_required"],
    ["absence_end_date", "absenceEndDate", "special_window_absence_end_date_required"],
    ["submission_open_date", "submissionOpenDate", "special_window_submission_open_date_required"],
    ["submission_deadline", "submissionDeadline", "special_window_submission_deadline_required"],
    ["review_start_date", "reviewStartDate", "special_window_review_start_date_required"],
  ]) {
    if (requireAll || Object.prototype.hasOwnProperty.call(source, wire)) payload[key] = normalizeDate(get(wire, existing?.[wire]), error);
  }
  if (requireAll || Object.prototype.hasOwnProperty.call(source, "collective_processing")) {
    payload.collectiveProcessing = normalizeBoolean(get("collective_processing", existing?.collective_processing), true);
  }
  if (requireAll || Object.prototype.hasOwnProperty.call(source, "approval_blocked_before_review")) {
    payload.approvalBlockedBeforeReview = normalizeBoolean(get("approval_blocked_before_review", existing?.approval_blocked_before_review), true);
  }
  if (requireAll || Object.prototype.hasOwnProperty.call(source, "is_active")) {
    payload.isActive = normalizeBoolean(get("is_active", existing?.is_active), true);
  }
  if (requireAll || Object.prototype.hasOwnProperty.call(source, "late_submission_policy")) {
    payload.lateSubmissionPolicy = normalizeLateSubmissionPolicy(get("late_submission_policy", existing?.late_submission_policy));
  }
  if (requireAll || Object.prototype.hasOwnProperty.call(source, "vacation_day_exemption_quota")) {
    payload.vacationDayExemptionQuota = normalizeVacationDayExemptionQuota(get("vacation_day_exemption_quota", existing?.vacation_day_exemption_quota));
  }

  const completeForValidation = {
    absenceStartDate: payload.absenceStartDate || toDateString(existing?.absence_start_date),
    absenceEndDate: payload.absenceEndDate || toDateString(existing?.absence_end_date),
    submissionOpenDate: payload.submissionOpenDate || toDateString(existing?.submission_open_date),
    submissionDeadline: payload.submissionDeadline || toDateString(existing?.submission_deadline),
    reviewStartDate: payload.reviewStartDate || toDateString(existing?.review_start_date),
  };
  if (Object.values(completeForValidation).every(Boolean)) assertDateRules(completeForValidation);
  return payload;
}

function normalizeScopeType(value) {
  const normalized = normalizeRequiredText(value, "special_window_scope_type_required").toLowerCase();
  if (!ALLOWED_SCOPE_TYPES.has(normalized)) throw createHttpError(400, "invalid_special_window_scope_type");
  return normalized;
}

function normalizeUuidArray(value, errorCode) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw createHttpError(400, errorCode);
  return Array.from(new Set(value.map((item) => normalizeUuid(item, errorCode))));
}

function normalizePersonScopes(value) {
  if (value === undefined || value === null) return [{ scopeType: "tenant", resourceGroupId: null, tenantUserId: null }];
  if (!Array.isArray(value) || value.length === 0) throw createHttpError(400, "special_window_scope_required");
  const scopes = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw createHttpError(400, "invalid_special_window_scope");
    const scopeType = normalizeScopeType(item.scope_type);
    scopes.push({
      scopeType,
      resourceGroupId: scopeType === "resource_group" ? normalizeUuid(item.resource_group_id, "resource_group_id_required") : null,
      tenantUserId: scopeType === "tenant_user" ? normalizeUuid(item.scope_tenant_user_id || item.tenant_user_id, "tenant_user_id_required") : null,
      absenceTypeId: normalizeOptionalUuid(item.absence_type_id, "invalid_absence_type_id"),
    });
  }
  return scopes;
}

function normalizeScopesFromBody(body, { requirePresent = false } = {}) {
  const hasScopes = Object.prototype.hasOwnProperty.call(body || {}, "scopes");
  const hasTypes = Object.prototype.hasOwnProperty.call(body || {}, "absence_type_ids")
    || Object.prototype.hasOwnProperty.call(body || {}, "absence_type_scopes");
  if (!requirePresent && !hasScopes && !hasTypes) return null;

  const personScopes = normalizePersonScopes(hasScopes ? body.scopes : undefined);
  const topLevelTypeIds = normalizeUuidArray(
    Object.prototype.hasOwnProperty.call(body || {}, "absence_type_ids") ? body.absence_type_ids : body?.absence_type_scopes,
    "invalid_absence_type_id"
  );
  const allRows = [];
  for (const scope of personScopes) {
    const rowTypeIds = scope.absenceTypeId ? [scope.absenceTypeId] : topLevelTypeIds;
    if (rowTypeIds.length === 0) {
      allRows.push({ ...scope, absenceTypeId: null });
    } else {
      for (const absenceTypeId of rowTypeIds) allRows.push({ ...scope, absenceTypeId });
    }
  }
  const seen = new Set();
  return allRows.filter((row) => {
    const key = [row.scopeType, row.resourceGroupId || "", row.tenantUserId || "", row.absenceTypeId || ""].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeCreatePayload(body) {
  rejectUnknownFields(body, CREATE_FIELDS);
  return {
    ...normalizeCorePayload(body, null, { requireAll: true }),
    scopes: normalizeScopesFromBody(body || {}, { requirePresent: true }),
  };
}

function normalizeUpdatePayload(body, existing) {
  rejectUnknownFields(body, UPDATE_FIELDS);
  if (!body || Object.keys(body).length === 0) throw createHttpError(400, "special_window_patch_empty");
  const payload = {
    version: normalizeVersion(body.version),
    ...normalizeCorePayload(body, existing, { requireAll: false }),
  };
  const scopes = normalizeScopesFromBody(body, { requirePresent: false });
  if (scopes) payload.scopes = scopes;
  const changedFields = Object.keys(body).filter((field) => field !== "version");
  if (changedFields.length === 0) throw createHttpError(400, "special_window_patch_empty");
  payload.changedFields = changedFields;
  return payload;
}

function normalizeArchivePayload(body) {
  rejectUnknownFields(body, new Set(["version"]));
  return { version: normalizeVersion(body?.version) };
}

function assertEditableWithRequests(changedFields, requestCount) {
  if (Number(requestCount || 0) <= 0) return;
  const blocked = changedFields.filter((field) => PROTECTED_AFTER_REQUEST_FIELDS.has(field));
  if (blocked.length > 0) {
    throw createHttpError(409, "special_window_has_requests_protected_fields", { fields: blocked });
  }
  const unsafe = changedFields.filter((field) => !TEXT_ONLY_FIELDS.has(field));
  if (unsafe.length > 0) {
    throw createHttpError(409, "special_window_has_requests_protected_fields", { fields: unsafe });
  }
}

module.exports = {
  ALLOWED_LATE_POLICIES,
  ALLOWED_SCOPE_TYPES,
  assertEditableWithRequests,
  normalizeArchivePayload,
  normalizeBoolean,
  normalizeCreatePayload,
  normalizeLimit,
  normalizeVacationDayExemptionQuota,
  normalizeOffset,
  normalizeOptionalText,
  normalizeOptionalUuid,
  normalizeUpdatePayload,
  normalizeUuid,
};