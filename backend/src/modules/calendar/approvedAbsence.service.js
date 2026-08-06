"use strict";

const { createHttpError } = require("../../middleware/errorHandler");
const approvedAbsenceRepository = require("./approvedAbsence.repository");

const ALLOWED_PR6_DURATION_TYPES = new Set(["full_days", "time_range"]);
const ALLOWED_VISIBILITY_POLICIES = new Set(["private", "manager_visible", "neutral_shared"]);

function normalizeRequired(value, errorCode) {
  const normalized = value == null ? "" : String(value).trim();
  if (!normalized) throw createHttpError(400, errorCode);
  return normalized;
}

function assertRequestShape(absenceRequest) {
  if (!absenceRequest || absenceRequest.status !== "approved") {
    throw new Error("approved_absence_request_not_approved");
  }
  if (!ALLOWED_PR6_DURATION_TYPES.has(absenceRequest.duration_type)) {
    throw new Error("approved_absence_duration_not_supported");
  }
  if (!ALLOWED_VISIBILITY_POLICIES.has(absenceRequest.absence_type_visibility_policy)) {
    throw new Error("approved_absence_visibility_policy_not_supported");
  }
  if (!absenceRequest.reviewed_at) {
    throw new Error("approved_absence_reviewed_at_required");
  }
  if (absenceRequest.duration_type === "full_days") {
    if (!absenceRequest.end_date || String(absenceRequest.end_date) < String(absenceRequest.start_date)) {
      throw new Error("approved_absence_invalid_full_days");
    }
    if (absenceRequest.start_time || absenceRequest.end_time) {
      throw new Error("approved_absence_invalid_full_days");
    }
  }
  if (absenceRequest.duration_type === "time_range") {
    if (absenceRequest.end_date) {
      throw new Error("approved_absence_invalid_time_range");
    }
    if (!absenceRequest.start_time || !absenceRequest.end_time || String(absenceRequest.end_time) <= String(absenceRequest.start_time)) {
      throw new Error("approved_absence_invalid_time_range");
    }
  }
}

async function materializeFromApprovedRequest(client, {
  tenantId,
  absenceRequest,
  approvedByTenantUserId,
}) {
  if (!client) throw new Error("approved_absence_client_required");
  const normalizedTenantId = normalizeRequired(tenantId, "tenant_id_required");
  const normalizedApprovedBy = normalizeRequired(approvedByTenantUserId, "tenant_user_id_required");
  assertRequestShape(absenceRequest);

  const inserted = await approvedAbsenceRepository.insertFromAbsenceRequest(client, {
    tenantId: normalizedTenantId,
    absenceRequest,
    approvedByTenantUserId: normalizedApprovedBy,
  });
  if (inserted) {
    return { approvedAbsence: inserted, created: true };
  }

  const existing = await approvedAbsenceRepository.findBySource(client, {
    tenantId: normalizedTenantId,
    sourceType: "absence_request",
    sourceId: absenceRequest.id,
  });
  if (!existing) throw new Error("approved_absence_source_conflict_without_row");
  return { approvedAbsence: existing, created: false };
}

module.exports = {
  materializeFromApprovedRequest,
  _test: {
    assertRequestShape,
  },
};
