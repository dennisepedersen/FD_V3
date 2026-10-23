"use strict";

const crypto = require("node:crypto");

// Dennis explicitly confirmed HC's full FitterHours null-pair semantics.
// The POC gate restricts this contract to HC/DEP; it is not a tenant setting.
const NULL_PAIR_PENDING_VERIFIED = true;
const own = (row, key) => Object.prototype.hasOwnProperty.call(row, key);
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

function approvalStatus(row) {
  if (!own(row, "approvedBy") || !own(row, "approvedDate")) {
    return { status: "unknown", reason: "Godkendelsesfelter mangler i EK-svaret." };
  }
  const by = typeof row.approvedBy === "string" && row.approvedBy.trim();
  const date = typeof row.approvedDate === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(row.approvedDate) &&
    validDay(row.approvedDate.slice(0, 10)) && Number.isFinite(Date.parse(row.approvedDate));
  if (by && date) return { status: "approved", reason: "Godkendt i EK." };
  if (row.approvedBy === null && row.approvedDate === null) {
    return NULL_PAIR_PENDING_VERIFIED
      ? { status: "pending", reason: "Afventer godkendelse i EK." }
      : { status: "unknown", reason: "Ingen dokumenteret godkendelse; godkendelsespligten skal afklares." };
  }
  return { status: "unknown", reason: "EK's godkendelsesfelter er ugyldige eller indbyrdes uenige." };
}

function validDay(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
}

function summarize({ tenantId, userId, projects, bindings, rows, fromDate, toDate }) {
  const mine = new Map(projects.map(project => [project.project_id, project]));
  const byEk = new Map();
  const ambiguous = new Set();
  for (const binding of bindings) {
    if (!mine.has(binding.project_id) || !/^[1-9][0-9]*$/.test(binding.ek_project_id)) continue;
    if (byEk.has(binding.ek_project_id)) ambiguous.add(binding.ek_project_id);
    byEk.set(binding.ek_project_id, mine.get(binding.project_id));
  }
  const distinct = new Map();
  for (const raw of rows) {
    const key = String(raw.projectID);
    if (!byEk.has(key)) continue;
    if (!Number.isSafeInteger(raw.id) || raw.id <= 0) throw new Error("approval_control_invalid_row_identity");
    const project = byEk.get(key);
    const status = ambiguous.has(key)
      ? { status: "unknown", reason: "Flere af dine sager peger på samme EK-projekt." } : approvalStatus(raw);
    const date = typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}T00:00:00$/.test(raw.date) ? raw.date.slice(0, 10) : null;
    const valid = validDay(date) && date >= fromDate && date <= toDate && Number.isFinite(raw.hours) && raw.hours >= 0 &&
      Number.isSafeInteger(raw.fitterID) && raw.fitterID > 0;
    const item = {
      id: String(raw.id), project_id: project.project_id, project_reference: project.external_project_ref,
      project_name: project.name, fitter_id: raw.fitterID, fitter_name: raw.fitterName || null,
      date, hours: raw.hours, approved_by: raw.approvedBy ?? null, approved_date: raw.approvedDate ?? null,
      status: valid ? status.status : "unknown", reason: valid ? status.reason : "Arbejdsdato, timer eller medarbejder-ID er ugyldigt.",
    };
    const previous = distinct.get(item.id);
    if (previous && hash(previous) !== hash(item)) {
      distinct.set(item.id, { ...previous, status: "unknown", reason: "Samme EK-registrerings-ID har modstridende indhold." });
    } else if (!previous) distinct.set(item.id, item);
  }
  const all = [...distinct.values()].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  const pending = all.filter(row => row.status === "pending");
  const unknown = all.filter(row => row.status === "unknown");
  const approved = all.filter(row => row.status === "approved");
  const groups = [...new Set(pending.map(row => row.project_id))].map(id => ({
    project_id: id, reference: mine.get(id).external_project_ref, name: mine.get(id).name,
    rows: pending.filter(row => row.project_id === id),
  }));
  return {
    fingerprint: hash({ tenantId, userId, fromDate, toDate, projects: [...mine.keys()].sort(), all }),
    pending, unknown, approved_count: approved.length, groups,
    counts: { open_rows: pending.length, projects: groups.length, hours: Math.round(pending.reduce((total, row) => total + row.hours, 0) * 100) / 100, oldest_date: pending.length ? pending.map(row => row.date).sort()[0] : null },
    pending_status_verified: NULL_PAIR_PENDING_VERIFIED,
  };
}

module.exports = { approvalStatus, summarize, validDay };
