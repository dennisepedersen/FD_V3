"use strict";

function toDateString(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function nextDate(dateString) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function coalesceKey(row) {
  return [
    row.tenant_id,
    row.employee_tenant_user_id,
    row.absence_type_key,
    row.duration_type,
    row.timezone,
    row.status,
    row.visibility_policy,
  ].join("|");
}

function maxDate(a, b) {
  return String(a || "") >= String(b || "") ? a : b;
}

function rangesTouchOrOverlap(previousEnd, start) {
  return String(start || "") <= nextDate(previousEnd);
}

function coalesceAbsenceRows(rows) {
  const sorted = [...(rows || [])].sort((a, b) => {
    const byTenant = String(a.tenant_id || "").localeCompare(String(b.tenant_id || ""));
    if (byTenant) return byTenant;
    const byEmployee = String(a.employee_tenant_user_id || "").localeCompare(String(b.employee_tenant_user_id || ""));
    if (byEmployee) return byEmployee;
    const byType = String(a.absence_type_key || "").localeCompare(String(b.absence_type_key || ""));
    if (byType) return byType;
    const byStart = toDateString(a.start_date).localeCompare(toDateString(b.start_date));
    if (byStart) return byStart;
    return toDateString(a.end_date || a.start_date).localeCompare(toDateString(b.end_date || b.start_date));
  });
  const merged = [];
  for (const row of sorted) {
    const start = toDateString(row.start_date);
    const end = toDateString(row.end_date || row.start_date);
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.__coalesce_key === coalesceKey(row) &&
      rangesTouchOrOverlap(toDateString(previous.end_date || previous.start_date), start)
    ) {
      previous.end_date = maxDate(toDateString(previous.end_date || previous.start_date), end);
      previous.source_ids = [...(previous.source_ids || [previous.source_id]), row.source_id];
      continue;
    }
    merged.push({
      ...row,
      start_date: start,
      end_date: end,
      source_ids: [row.source_id],
      __coalesce_key: coalesceKey(row),
    });
  }
  return merged.map(({ __coalesce_key, ...row }) => row);
}

module.exports = {
  coalesceAbsenceRows,
  _test: {
    coalesceKey,
    maxDate,
    nextDate,
    rangesTouchOrOverlap,
  },
};
