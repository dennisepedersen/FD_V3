"use strict";

const pool = require("../../db/pool");
const { createHttpError } = require("../../middleware/errorHandler");
const calendarFeedRepository = require("./calendarFeed.repository");
const { mapApprovedAbsenceEvent } = require("./calendarEvent.mapper");

const MAX_RANGE_DAYS = 366;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

function normalizeRequiredText(value, errorCode) {
  const normalized = value == null ? "" : String(value).trim();
  if (!normalized) throw createHttpError(400, errorCode);
  return normalized;
}

function normalizeOptionalText(value) {
  const normalized = value == null ? "" : String(value).trim();
  return normalized || null;
}

function normalizeDate(value, errorCode) {
  const normalized = normalizeRequiredText(value, errorCode);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw createHttpError(400, errorCode);
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw createHttpError(400, errorCode);
  }
  return normalized;
}

function dateDiffDays(from, to) {
  const fromTime = new Date(`${from}T00:00:00.000Z`).getTime();
  const toTime = new Date(`${to}T00:00:00.000Z`).getTime();
  return Math.round((toTime - fromTime) / 86400000);
}

function normalizeLimit(value) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return DEFAULT_LIMIT;
  if (!/^\d+$/.test(normalized)) throw createHttpError(400, "invalid_calendar_event_limit");
  const limit = Number(normalized);
  if (limit < 1 || limit > MAX_LIMIT) throw createHttpError(400, "invalid_calendar_event_limit");
  return limit;
}

function normalizeOffset(value) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return 0;
  if (!/^\d+$/.test(normalized)) throw createHttpError(400, "invalid_calendar_event_offset");
  return Number(normalized);
}

function normalizeEventType(value) {
  const normalized = normalizeOptionalText(value || "absence");
  if (normalized !== "absence") throw createHttpError(400, "unsupported_calendar_event_type");
  return normalized;
}

function normalizeFilters(filters = {}) {
  const from = normalizeDate(filters.from, "calendar_event_from_required");
  const to = normalizeDate(filters.to, "calendar_event_to_required");
  if (to < from) throw createHttpError(400, "calendar_event_date_range_invalid");
  if (dateDiffDays(from, to) > MAX_RANGE_DAYS) throw createHttpError(400, "calendar_event_date_range_too_large");
  return {
    from,
    to,
    eventType: normalizeEventType(filters.event_type || filters.eventType),
    limit: normalizeLimit(filters.limit),
    offset: normalizeOffset(filters.offset),
  };
}

async function listMine({ tenantId, userId, filters = {} }) {
  const normalizedTenantId = normalizeRequiredText(tenantId, "tenant_id_required");
  const normalizedUserId = normalizeRequiredText(userId, "tenant_user_id_required");
  const normalizedFilters = normalizeFilters(filters);

  const client = await pool.connect();
  try {
    const rows = await calendarFeedRepository.listOwnApprovedAbsenceEvents(client, {
      tenantId: normalizedTenantId,
      employeeTenantUserId: normalizedUserId,
      from: normalizedFilters.from,
      to: normalizedFilters.to,
      limit: normalizedFilters.limit,
      offset: normalizedFilters.offset,
    });
    return {
      events: rows.map((row) => mapApprovedAbsenceEvent(row, { scope: "mine" })),
      limit: normalizedFilters.limit,
      offset: normalizedFilters.offset,
      event_type: normalizedFilters.eventType,
    };
  } finally {
    client.release();
  }
}

async function listTeam({ tenantId, userId, filters = {} }) {
  const normalizedTenantId = normalizeRequiredText(tenantId, "tenant_id_required");
  const normalizedUserId = normalizeRequiredText(userId, "tenant_user_id_required");
  const normalizedFilters = normalizeFilters(filters);

  const client = await pool.connect();
  try {
    const rows = await calendarFeedRepository.listManagedApprovedAbsenceEvents(client, {
      tenantId: normalizedTenantId,
      managerTenantUserId: normalizedUserId,
      from: normalizedFilters.from,
      to: normalizedFilters.to,
      limit: normalizedFilters.limit,
      offset: normalizedFilters.offset,
    });
    return {
      events: rows.map((row) => mapApprovedAbsenceEvent(row, { scope: "team" })),
      limit: normalizedFilters.limit,
      offset: normalizedFilters.offset,
      event_type: normalizedFilters.eventType,
    };
  } finally {
    client.release();
  }
}

module.exports = {
  listMine,
  listTeam,
  _test: {
    normalizeFilters,
  },
};
