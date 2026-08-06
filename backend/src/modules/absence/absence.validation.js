"use strict";

const { createHttpError } = require("../../middleware/errorHandler");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}(?::\d{2})?$/;
const SUPPORTED_DURATION_TYPES = new Set(["full_days", "time_range"]);
const REQUEST_WORKFLOW_MODES = new Set(["request"]);
const MUTATION_ALLOWED_FIELDS = new Set([
  "absence_type_id",
  "duration_type",
  "start_date",
  "end_date",
  "start_time",
  "end_time",
  "timezone",
  "employee_comment",
  "version",
]);
const CREATE_ALLOWED_FIELDS = new Set([
  "absence_type_id",
  "duration_type",
  "start_date",
  "end_date",
  "start_time",
  "end_time",
  "timezone",
  "employee_comment",
]);
const UPDATE_ALLOWED_FIELDS = MUTATION_ALLOWED_FIELDS;
const SERVER_MANAGED_FIELDS = new Set([
  "id",
  "tenant_id",
  "employee_tenant_user_id",
  "employee_fitter_id",
  "assigned_manager_tenant_user_id",
  "status",
  "special_window_id",
  "submitted_at",
  "reviewed_at",
  "cancelled_at",
  "created_at",
  "updated_at",
  "created_by_user_id",
  "updated_by_user_id",
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

function normalizeDate(value, errorCode) {
  const normalized = value instanceof Date
    ? value.toISOString().slice(0, 10)
    : normalizeRequiredText(value, errorCode);
  if (!DATE_PATTERN.test(normalized)) throw createHttpError(400, errorCode);
  const [year, month, day] = normalized.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw createHttpError(400, errorCode);
  }
  return normalized;
}

function normalizeOptionalDate(value, errorCode) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  return normalizeDate(normalized, errorCode);
}

function normalizeTime(value, errorCode) {
  const normalized = normalizeRequiredText(value, errorCode).slice(0, 8);
  if (!TIME_PATTERN.test(normalized)) throw createHttpError(400, errorCode);
  const [hourText, minuteText, secondText = "0"] = normalized.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (
    !Number.isInteger(hour)
    || !Number.isInteger(minute)
    || !Number.isInteger(second)
    || hour < 0
    || hour > 23
    || minute < 0
    || minute > 59
    || second < 0
    || second > 59
  ) {
    throw createHttpError(400, errorCode);
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

function normalizeOptionalTime(value, errorCode) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  return normalizeTime(normalized, errorCode);
}

function normalizeVersion(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw createHttpError(400, "version_required");
  }
  return number;
}

function normalizeLimit(value) {
  if (value === undefined || value === null || value === "") return 100;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 200) {
    throw createHttpError(400, "invalid_absence_request_limit");
  }
  return number;
}

function normalizeOffset(value) {
  if (value === undefined || value === null || value === "") return 0;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw createHttpError(400, "invalid_absence_request_offset");
  }
  return number;
}

function rejectUnknownFields(body, allowedFields) {
  for (const key of Object.keys(body || {})) {
    if (SERVER_MANAGED_FIELDS.has(key)) {
      throw createHttpError(400, "absence_request_server_managed_field");
    }
    if (!allowedFields.has(key)) {
      throw createHttpError(400, "absence_request_unknown_field");
    }
  }
}

function normalizeEmployeeComment(value) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  if (normalized.length > 250) throw createHttpError(400, "absence_employee_comment_too_long");
  return normalized;
}

function normalizeDurationPayload(input, existing = null) {
  const source = input || {};
  const durationType = normalizeRequiredText(
    Object.prototype.hasOwnProperty.call(source, "duration_type") ? source.duration_type : existing?.duration_type,
    "absence_duration_type_required"
  ).toLowerCase();

  if (durationType === "partial_day") {
    throw createHttpError(400, "partial_day is not supported yet");
  }
  if (!SUPPORTED_DURATION_TYPES.has(durationType)) {
    throw createHttpError(400, "invalid_absence_duration_type");
  }

  const startDate = normalizeDate(
    Object.prototype.hasOwnProperty.call(source, "start_date") ? source.start_date : existing?.start_date,
    "absence_start_date_required"
  );
  const endDate = normalizeOptionalDate(
    Object.prototype.hasOwnProperty.call(source, "end_date") ? source.end_date : existing?.end_date,
    "invalid_absence_end_date"
  );
  const startTime = normalizeOptionalTime(
    Object.prototype.hasOwnProperty.call(source, "start_time") ? source.start_time : existing?.start_time,
    "invalid_absence_start_time"
  );
  const endTime = normalizeOptionalTime(
    Object.prototype.hasOwnProperty.call(source, "end_time") ? source.end_time : existing?.end_time,
    "invalid_absence_end_time"
  );
  const timezone = normalizeRequiredText(
    Object.prototype.hasOwnProperty.call(source, "timezone") ? source.timezone : existing?.timezone || "Europe/Copenhagen",
    "absence_timezone_required"
  );

  if (durationType === "full_days") {
    if (!endDate) throw createHttpError(400, "absence_end_date_required");
    if (endDate < startDate) throw createHttpError(400, "absence_end_date_before_start_date");
    if (startTime || endTime) throw createHttpError(400, "absence_full_days_must_not_have_times");
  }

  if (durationType === "time_range") {
    if (endDate && endDate !== startDate) throw createHttpError(400, "absence_time_range_must_be_same_day");
    if (!startTime || !endTime) throw createHttpError(400, "absence_time_range_times_required");
    if (endTime <= startTime) throw createHttpError(400, "absence_end_time_must_be_after_start_time");
  }

  return {
    durationType,
    dayPart: null,
    startDate,
    endDate: durationType === "time_range" ? null : endDate,
    startTime,
    endTime,
    timezone,
  };
}

function assertAbsenceTypeAllowsEmployeeRequest(absenceType) {
  if (!absenceType) throw createHttpError(404, "absence_type_not_found");
  if (absenceType.is_active !== true) throw createHttpError(400, "absence_type_inactive");
  if (!REQUEST_WORKFLOW_MODES.has(String(absenceType.workflow_mode || ""))) {
    throw createHttpError(400, "absence_type_workflow_not_request");
  }
}

function assertAbsenceTypeAllowsDuration(absenceType, durationType) {
  const allowed = Array.isArray(absenceType?.allowed_duration_types)
    ? absenceType.allowed_duration_types
    : [];
  if (!allowed.includes(durationType)) {
    throw createHttpError(400, "absence_duration_type_not_allowed_for_type");
  }
}

function assertCommentPolicy(absenceType, comment) {
  const policy = String(absenceType?.comment_policy || "optional");
  if (policy === "required" && !normalizeOptionalText(comment)) {
    throw createHttpError(400, "absence_employee_comment_required");
  }
  if (policy === "disabled" && normalizeOptionalText(comment)) {
    throw createHttpError(400, "absence_employee_comment_disabled");
  }
}

function normalizeCreatePayload(body) {
  rejectUnknownFields(body, CREATE_ALLOWED_FIELDS);
  return {
    absenceTypeId: normalizeUuid(body?.absence_type_id, "absence_type_id_required"),
    employeeComment: normalizeEmployeeComment(body?.employee_comment),
    ...normalizeDurationPayload(body),
  };
}

function normalizeUpdatePayload(body, existing) {
  rejectUnknownFields(body, UPDATE_ALLOWED_FIELDS);
  if (!body || Object.keys(body).length === 0) {
    throw createHttpError(400, "absence_request_patch_empty");
  }
  const version = normalizeVersion(body.version);
  const absenceTypeId = Object.prototype.hasOwnProperty.call(body, "absence_type_id")
    ? normalizeUuid(body.absence_type_id, "absence_type_id_required")
    : existing.absence_type_id;
  const employeeComment = Object.prototype.hasOwnProperty.call(body, "employee_comment")
    ? normalizeEmployeeComment(body.employee_comment)
    : existing.employee_comment;
  return {
    version,
    absenceTypeId,
    employeeComment,
    ...normalizeDurationPayload(body, existing),
  };
}

function normalizeActionVersion(body) {
  rejectUnknownFields(body, new Set(["version"]));
  return normalizeVersion(body?.version);
}

function getChangedFields(existing, next) {
  const pairs = [
    ["absence_type_id", existing.absence_type_id, next.absenceTypeId],
    ["duration_type", existing.duration_type, next.durationType],
    ["start_date", existing.start_date, next.startDate],
    ["end_date", existing.end_date, next.endDate],
    ["start_time", existing.start_time, next.startTime],
    ["end_time", existing.end_time, next.endTime],
    ["timezone", existing.timezone, next.timezone],
    ["employee_comment", existing.employee_comment, next.employeeComment],
  ];
  return pairs
    .filter(([, before, after]) => String(before || "") !== String(after || ""))
    .map(([field]) => field);
}

module.exports = {
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
};
