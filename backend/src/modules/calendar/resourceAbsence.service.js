const crypto = require("crypto");
const pool = require("../../db/pool");
const { withTransaction } = require("../../db/tx");
const { createHttpError } = require("../../middleware/errorHandler");
const resourceAbsenceRepository = require("./resourceAbsence.repository");

const ALLOWED_ABSENCE_TYPES = new Set(["vacation", "vacation_free", "course", "sickness", "other"]);
const ALLOWED_VISIBILITY_SCOPES = new Set([
  "tenant_admin_only",
  "limited_availability",
  "manager_full",
  "finance_relevant",
  "custom",
]);

function normalizeRequiredText(value, errorCode) {
  const normalized = value == null ? "" : String(value).trim();
  if (!normalized) {
    throw createHttpError(400, errorCode);
  }
  return normalized;
}

function normalizeOptionalText(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function normalizeDate(value, errorCode) {
  const normalized = normalizeRequiredText(value, errorCode);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw createHttpError(400, errorCode);
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw createHttpError(400, errorCode);
  }
  return normalized;
}

function normalizeAbsenceType(value) {
  const normalized = normalizeRequiredText(value, "absence_type_required").toLowerCase();
  if (!ALLOWED_ABSENCE_TYPES.has(normalized)) {
    throw createHttpError(400, "invalid_absence_type");
  }
  return normalized;
}

function normalizeVisibilityScope(value) {
  const normalized = String(value || "tenant_admin_only").trim().toLowerCase() || "tenant_admin_only";
  if (!ALLOWED_VISIBILITY_SCOPES.has(normalized)) {
    throw createHttpError(400, "invalid_absence_visibility_scope");
  }
  return normalized;
}

function normalizeIncludeInactive(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function assertValidDateRange(startDate, endDate) {
  if (endDate < startDate) {
    throw createHttpError(400, "absence_end_date_before_start_date");
  }
}

async function listAbsencesForTenantRange({ tenantId, from, to }) {
  const normalizedTenantId = normalizeRequiredText(tenantId, "tenant_id_required");
  const normalizedFrom = normalizeDate(from, "from_date_required");
  const normalizedTo = normalizeDate(to, "to_date_required");
  assertValidDateRange(normalizedFrom, normalizedTo);

  const client = await pool.connect();
  try {
    const absences = await resourceAbsenceRepository.listAbsencesForTenantRange(client, {
      tenantId: normalizedTenantId,
      from: normalizedFrom,
      to: normalizedTo,
    });

    return { absences };
  } finally {
    client.release();
  }
}

async function listResourcesForTenant({ tenantId, includeInactive }) {
  const normalizedTenantId = normalizeRequiredText(tenantId, "tenant_id_required");
  const normalizedIncludeInactive = normalizeIncludeInactive(includeInactive);

  const client = await pool.connect();
  try {
    const resources = await resourceAbsenceRepository.listResourcesForTenant(client, {
      tenantId: normalizedTenantId,
      includeInactive: normalizedIncludeInactive,
    });

    return { resources };
  } finally {
    client.release();
  }
}


function normalizeIdempotencyKey(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > 160) throw createHttpError(400, "direct_absence_idempotency_key_too_long");
  return normalized;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashPayload(payload) {
  return crypto.createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function shiftDate(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function subtractOverlapSegments(startDate, endDate, overlaps) {
  let segments = [{ start_date: startDate, end_date: endDate }];
  for (const overlap of overlaps) {
    const overlapStart = String(overlap.start_date).slice(0, 10);
    const overlapEnd = String(overlap.end_date).slice(0, 10);
    segments = segments.flatMap((segment) => {
      if (overlapEnd < segment.start_date || overlapStart > segment.end_date) return [segment];
      const next = [];
      const beforeEnd = shiftDate(overlapStart, -1);
      const afterStart = shiftDate(overlapEnd, 1);
      if (segment.start_date <= beforeEnd) next.push({ start_date: segment.start_date, end_date: beforeEnd });
      if (afterStart <= segment.end_date) next.push({ start_date: afterStart, end_date: segment.end_date });
      return next;
    });
  }
  return segments;
}

function sanitizeOverlap(row) {
  return {
    id: row.id,
    absence_type: row.absence_type,
    status: row.status,
    start_date: String(row.start_date).slice(0, 10),
    end_date: String(row.end_date).slice(0, 10),
    visibility_scope: row.visibility_scope,
  };
}

function buildAbsencePreflight(input, overlaps) {
  const conflicts = (overlaps || []).filter((row) => row.absence_type !== input.absenceType);
  const sameTypeOverlaps = (overlaps || []).filter((row) => row.absence_type === input.absenceType);
  if (conflicts.length > 0) {
    return {
      can_apply: false,
      requires_confirmation: false,
      reason: "different_type_overlap",
      conflicts: conflicts.map(sanitizeOverlap),
      same_type_overlaps: sameTypeOverlaps.map(sanitizeOverlap),
      missing_segments: [],
    };
  }
  const missingSegments = subtractOverlapSegments(input.startDate, input.endDate, sameTypeOverlaps);
  if (missingSegments.length === 0) {
    return {
      can_apply: false,
      already_covered: true,
      requires_confirmation: false,
      reason: "already_covered",
      conflicts: [],
      same_type_overlaps: sameTypeOverlaps.map(sanitizeOverlap),
      missing_segments: [],
    };
  }
  return {
    can_apply: true,
    requires_confirmation: sameTypeOverlaps.length > 0,
    reason: sameTypeOverlaps.length > 0 ? "same_type_partial_overlap" : "clear",
    conflicts: [],
    same_type_overlaps: sameTypeOverlaps.map(sanitizeOverlap),
    missing_segments: missingSegments,
  };
}

function normalizeCreateInput(input) {
  const tenantId = normalizeRequiredText(input?.tenantId, "tenant_id_required");
  const fitterId = normalizeRequiredText(input?.fitterId, "fitter_id_required");
  const absenceType = normalizeAbsenceType(input?.absenceType);
  const startDate = normalizeDate(input?.startDate, "start_date_required");
  const endDate = normalizeDate(input?.endDate, "end_date_required");
  const visibilityScope = normalizeVisibilityScope(input?.visibilityScope);
  const note = normalizeOptionalText(input?.note);
  const createdByUserId = normalizeOptionalText(input?.createdByUserId);
  const updatedByUserId = normalizeOptionalText(input?.updatedByUserId) || createdByUserId;
  const idempotencyKey = normalizeIdempotencyKey(input?.idempotencyKey);
  assertValidDateRange(startDate, endDate);
  if (absenceType === "sickness" && !note) throw createHttpError(400, "direct_sickness_note_required");
  return { tenantId, fitterId, absenceType, startDate, endDate, visibilityScope, note, createdByUserId, updatedByUserId, idempotencyKey };
}
async function preflightAbsenceForTenant(input) {
  const normalized = normalizeCreateInput(input);
  const client = await pool.connect();
  try {
    const overlaps = await resourceAbsenceRepository.listAbsencesForFitterRange(client, {
      tenantId: normalized.tenantId,
      fitterId: normalized.fitterId,
      startDate: normalized.startDate,
      endDate: normalized.endDate,
    });
    return { preflight: buildAbsencePreflight(normalized, overlaps) };
  } finally {
    client.release();
  }
}

async function createAbsenceForTenant(input) {
  const normalized = normalizeCreateInput(input);
  const payloadHash = hashPayload({
    fitter_id: normalized.fitterId,
    absence_type: normalized.absenceType,
    start_date: normalized.startDate,
    end_date: normalized.endDate,
    note: normalized.note,
    visibility_scope: normalized.visibilityScope,
  });

  return withTransaction(async (client) => {
    if (normalized.idempotencyKey) {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`calendar:direct-absence:${normalized.tenantId}:${normalized.createdByUserId || "anonymous"}:${normalized.idempotencyKey}`]);
      const existing = await resourceAbsenceRepository.listByDirectIdempotencyKey(client, {
        tenantId: normalized.tenantId,
        createdByUserId: normalized.createdByUserId,
        idempotencyKey: normalized.idempotencyKey,
      });
      if (existing.length > 0) {
        if (existing.some((row) => row.idempotency_payload_hash !== payloadHash)) {
          throw createHttpError(409, "direct_absence_idempotency_payload_mismatch");
        }
        return { absence: existing[0] || null, absences: existing, idempotent: true };
      }
    }

    const overlaps = await resourceAbsenceRepository.listAbsencesForFitterRange(client, {
      tenantId: normalized.tenantId,
      fitterId: normalized.fitterId,
      startDate: normalized.startDate,
      endDate: normalized.endDate,
      forUpdate: true,
    });
    const preflight = buildAbsencePreflight(normalized, overlaps);
    if (preflight.can_apply !== true) {
      if (preflight.already_covered === true) return { absence: null, absences: [], preflight, already_covered: true };
      throw createHttpError(409, "direct_absence_overlap_conflict", { preflight });
    }

    const absences = [];
    for (let index = 0; index < preflight.missing_segments.length; index += 1) {
      const segment = preflight.missing_segments[index];
      const absence = await resourceAbsenceRepository.createAbsenceForTenant(client, {
        tenantId: normalized.tenantId,
        fitterId: normalized.fitterId,
        absenceType: normalized.absenceType,
        status: "approved",
        startDate: segment.start_date,
        endDate: segment.end_date,
        note: normalized.note,
        visibilityScope: normalized.visibilityScope,
        sourceType: "direct_registration",
        idempotencyKey: normalized.idempotencyKey,
        idempotencyPayloadHash: normalized.idempotencyKey ? payloadHash : null,
        idempotencySegmentIndex: normalized.idempotencyKey ? index + 1 : null,
        createdByUserId: normalized.createdByUserId,
        updatedByUserId: normalized.updatedByUserId,
      });
      absences.push(absence);
    }

    return { absence: absences[0] || null, absences, preflight, idempotent: false };
  });
}
module.exports = {
  createAbsenceForTenant,
  preflightAbsenceForTenant,
  listAbsencesForTenantRange,
  listResourcesForTenant,
};
