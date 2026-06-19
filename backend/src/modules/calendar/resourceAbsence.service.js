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

async function listResourcesForTenant({ tenantId }) {
  const normalizedTenantId = normalizeRequiredText(tenantId, "tenant_id_required");

  const client = await pool.connect();
  try {
    const resources = await resourceAbsenceRepository.listResourcesForTenant(client, {
      tenantId: normalizedTenantId,
    });

    return { resources };
  } finally {
    client.release();
  }
}

async function createAbsenceForTenant(input) {
  const tenantId = normalizeRequiredText(input?.tenantId, "tenant_id_required");
  const fitterId = normalizeRequiredText(input?.fitterId, "fitter_id_required");
  const absenceType = normalizeAbsenceType(input?.absenceType);
  const status = "approved";
  const startDate = normalizeDate(input?.startDate, "start_date_required");
  const endDate = normalizeDate(input?.endDate, "end_date_required");
  const visibilityScope = normalizeVisibilityScope(input?.visibilityScope);
  const note = normalizeOptionalText(input?.note);
  const createdByUserId = normalizeOptionalText(input?.createdByUserId);
  const updatedByUserId = normalizeOptionalText(input?.updatedByUserId) || createdByUserId;

  assertValidDateRange(startDate, endDate);

  return withTransaction(async (client) => {
    const absence = await resourceAbsenceRepository.createAbsenceForTenant(client, {
      tenantId,
      fitterId,
      absenceType,
      status,
      startDate,
      endDate,
      note,
      visibilityScope,
      createdByUserId,
      updatedByUserId,
    });

    return { absence };
  });
}

module.exports = {
  createAbsenceForTenant,
  listAbsencesForTenantRange,
  listResourcesForTenant,
};
