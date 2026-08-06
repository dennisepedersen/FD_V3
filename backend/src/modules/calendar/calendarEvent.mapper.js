"use strict";

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

function initialsForName(name) {
  return String(name || "Medarbejder")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || null;
}

function titleForEvent(row, scope) {
  if (scope === "mine") return row.absence_type_name || "Fravær";
  if (row.visibility_policy === "manager_visible") return row.absence_type_name || "Fravær";
  return "Ikke til stede";
}

function mapApprovedAbsenceEvent(row, { scope }) {
  const reasonVisible = scope === "mine" || row.visibility_policy === "manager_visible";
  return {
    id: row.id,
    event_type: "absence",
    source_type: row.source_type,
    source_id: row.source_id,
    title: titleForEvent(row, scope),
    start_date: toDateString(row.start_date),
    end_date: toDateString(row.end_date || row.start_date),
    start_time: toTimeString(row.start_time),
    end_time: toTimeString(row.end_time),
    all_day: row.duration_type === "full_days",
    timezone: row.timezone,
    status: row.status,
    employee: {
      id: row.employee_tenant_user_id,
      display_name: row.employee_name || "Medarbejder",
      initials: initialsForName(row.employee_name),
    },
    visibility: {
      policy: row.visibility_policy,
      reason_visible: reasonVisible,
    },
    metadata: {
      duration_type: row.duration_type,
    },
  };
}

module.exports = {
  mapApprovedAbsenceEvent,
  _test: {
    titleForEvent,
  },
};
