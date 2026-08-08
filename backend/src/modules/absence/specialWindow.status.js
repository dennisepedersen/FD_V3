"use strict";

const STATUS_LABELS = Object.freeze({
  draft: "Kladde",
  scheduled: "Planlagt",
  open: "Åben for ønsker",
  closed_waiting_review: "Frist udløbet",
  review_open: "Klar til behandling",
  ended: "Afsluttet",
  archived: "Arkiveret",
});

function toDateString(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function deriveSpecialWindowStatus(row, { asOfDate = todayDate() } = {}) {
  if (!row || row.is_active === false) return "archived";
  const open = toDateString(row.submission_open_date);
  const deadline = toDateString(row.submission_deadline);
  const review = toDateString(row.review_start_date);
  const absenceEnd = toDateString(row.absence_end_date);

  if (!open || !deadline || !review || !absenceEnd) return "draft";
  if (asOfDate < open) return "scheduled";
  if (asOfDate <= deadline) return "open";
  if (asOfDate < review) return "closed_waiting_review";
  if (asOfDate <= absenceEnd) return "review_open";
  return "ended";
}

function mapSpecialWindowStatus(row, options = {}) {
  const status = deriveSpecialWindowStatus(row, options);
  return {
    status,
    label: STATUS_LABELS[status] || status,
  };
}

module.exports = {
  STATUS_LABELS,
  deriveSpecialWindowStatus,
  mapSpecialWindowStatus,
  todayDate,
  toDateString,
};