"use strict";

const TIMEZONE = "Europe/Copenhagen";
const WEEKDAY_TO_INDEX = Object.freeze({
  mandag: 1,
  tirsdag: 2,
  onsdag: 3,
  torsdag: 4,
  fredag: 5,
  lordag: 6,
  soendag: 0,
});

function pad(number) {
  return String(number).padStart(2, "0");
}

function normalizeIsoDate(value) {
  const normalized = value == null ? "" : String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error("time_control_invalid_date");
  }
  const parsed = new Date(`${normalized}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new Error("time_control_invalid_date");
  }
  return normalized;
}

function weeklyPeriod(friday) {
  const date = normalizeIsoDate(friday);
  if (weekdayIndexForIsoDate(date) !== 5) throw new Error("time_control_weekly_requires_friday");
  const monday = addDaysIso(date, -4);
  return { monday, friday: date, days: Array.from({ length: 5 }, (_, i) => addDaysIso(monday, i)) };
}

function getCopenhagenParts(date) {
  const formatter = new Intl.DateTimeFormat("da-DK", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "long",
  });
  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekdayName: String(parts.weekday || "").toLowerCase(),
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function dateFromIsoUtcNoon(isoDate) {
  const [year, month, day] = normalizeIsoDate(isoDate).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function addDaysIso(isoDate, days) {
  const date = dateFromIsoUtcNoon(isoDate);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function weekdayIndexForIsoDate(isoDate) {
  const parts = getCopenhagenParts(dateFromIsoUtcNoon(isoDate));
  return WEEKDAY_TO_INDEX[parts.weekdayName] ?? null;
}

function requiredHoursForDate(isoDate, settings = {}) {
  const weekday = weekdayIndexForIsoDate(isoDate);
  return weekday === 5
    ? Number(settings.friday_required_hours || settings.fridayRequiredHours || 7)
    : Number(settings.monday_thursday_required_hours || settings.mondayThursdayRequiredHours || 7.5);
}

function determineScheduledControl(now = new Date()) {
  const parts = getCopenhagenParts(now);
  const weekday = WEEKDAY_TO_INDEX[parts.weekdayName];
  if (weekday === 1 && parts.hour === 9 && parts.minute === 0) {
    return null;
  }
  if (weekday >= 2 && weekday <= 5 && parts.hour === 9 && parts.minute === 0) {
    return {
      controlType: "daily_09",
      controlledDate: addDaysIso(parts.isoDate, -1),
      localDate: parts.isoDate,
      localHour: parts.hour,
      localMinute: parts.minute,
      timezone: TIMEZONE,
    };
  }
  if (weekday === 5 && parts.hour === 12 && parts.minute === 0) {
    return {
      controlType: "friday_weekly_v1",
      controlledDate: parts.isoDate,
      localDate: parts.isoDate,
      localHour: parts.hour,
      localMinute: parts.minute,
      timezone: TIMEZONE,
    };
  }
  return null;
}

function formatDateLabelDa(isoDate, { includeYear = false } = {}) {
  const date = dateFromIsoUtcNoon(isoDate);
  const formatter = new Intl.DateTimeFormat("da-DK", {
    timeZone: TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: includeYear ? "numeric" : undefined,
  });
  return formatter.format(date);
}

module.exports = {
  TIMEZONE,
  addDaysIso,
  determineScheduledControl,
  formatDateLabelDa,
  getCopenhagenParts,
  normalizeIsoDate,
  requiredHoursForDate,
  weekdayIndexForIsoDate,
  weeklyPeriod,
};
