"use strict";

const { createHash } = require("node:crypto");
const { summarizeHours, evaluateHoursData } = require("./timeControl.logic");

const datasets = new WeakMap();
const ENDPOINT = "/api/v4/paginatedfitterhours";

function reject(reason) {
  throw new Error(`time_control_coverage_invalid:${reason}`);
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function dateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(T00:00:00)?$/.test(value)) reject("date_shape");
  const day = value.slice(0, 10);
  const parsed = new Date(`${day}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) reject("date_value");
  return day;
}

function projectRows(rows, day) {
  if (!Array.isArray(rows)) reject("rows_missing");
  const ids = new Set();
  return rows.map((row) => {
    if (!row || typeof row !== "object" || !/^[1-9]\d*$/.test(String(row.id))) reject("row_id");
    const id = String(row.id);
    if (ids.has(id)) reject("duplicate_id");
    ids.add(id);
    if (dateOnly(row.date) !== day) reject("out_of_range");
    if (!Number.isInteger(row.fitterId) || row.fitterId < 1 ||
        !Number.isInteger(row.projectId) || row.projectId < 1) reject("row_identity");
    if (typeof row.hours !== "number" || !Number.isFinite(row.hours)) reject("hours");
    if (row.categoryId != null && (!Number.isInteger(row.categoryId) || row.categoryId < 0)) reject("category_id");
    if (row.categoryReference != null && typeof row.categoryReference !== "string") reject("category_reference");
    if (row.projectReference != null && typeof row.projectReference !== "string") reject("project_reference");
    return Object.freeze({
      id, date: row.date, hours: row.hours, fitterId: row.fitterId,
      categoryId: row.categoryId ?? null, categoryReference: row.categoryReference ?? null,
      projectId: row.projectId, projectReference: row.projectReference ?? null,
    });
  });
}

function validatePages(pages, { pageSize, total }) {
  if (!Array.isArray(pages) || !pages.length) reject("pages_missing");
  let count = 0;
  for (const [index, page] of pages.entries()) {
    const last = index === pages.length - 1;
    const number = index + 1;
    if (page.page !== number || page.currentPage !== number) reject("page_progression");
    if (page.status !== 200 || page.hasErrors !== false || page.errorCount !== 0) reject("page_error");
    if (page.total !== total) reject("total_changed");
    if (!Number.isInteger(page.rowCount) || page.rowCount < 0 || page.rowCount > pageSize) reject("page_count");
    if (last ? page.rowCount >= pageSize || page.nextPage !== null
      : page.rowCount !== pageSize || page.nextPage !== number + 1) reject("page_terminal");
    count += page.rowCount;
  }
  if (count !== total) reject("distinct_count_total");
}

function createHoursDataset(evidence) {
  if (!evidence || typeof evidence !== "object") reject("evidence_missing");
  if (typeof evidence.tenantId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(evidence.tenantId)) reject("tenant");
  if (evidence.endpoint !== ENDPOINT) reject("source");
  const day = dateOnly(evidence.fromDate);
  if (dateOnly(evidence.toDate) !== day) reject("not_single_day");
  if (!Number.isInteger(evidence.pageSize) || evidence.pageSize < 1 || evidence.pageSize > 1000) reject("page_size");
  if (!Number.isInteger(evidence.expectedTotal) || evidence.expectedTotal < 1) reject("total");
  const rows = Object.freeze(projectRows(evidence.rows, day));
  if (rows.length !== evidence.expectedTotal) reject("distinct_count_total");
  if (!Array.isArray(evidence.passes) || evidence.passes.length !== 2) reject("two_passes_required");
  const orderedIdsHash = hash(rows.map((row) => row.id));
  const canonicalRowsHash = hash([...rows].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })));
  for (const pass of evidence.passes) {
    validatePages(pass.pageEvidence, { pageSize: evidence.pageSize, total: rows.length });
    if (pass.summary?.orderedIdsHash !== orderedIdsHash ||
        pass.summary?.canonicalRowsHash !== canonicalRowsHash) reject("dataset_changed");
  }
  const control = evidence.evidence?.closedProjectControl;
  if (!control || control.isClosed !== true ||
      !rows.some((row) => row.id === String(control.id) && row.fitterId === control.fitterId &&
        row.projectId === control.projectId && row.hours === control.hours && dateOnly(row.date) === day)) {
    reject("closed_project_control_missing");
  }
  const proof = Object.freeze({
    status: "complete", tenant_id: evidence.tenantId, controlled_date: day,
    source: ENDPOINT, contract: "ek_v4_single_day_two_pass_v1",
    row_count: rows.length, page_size: evidence.pageSize, pass_count: 2,
    rows_hash: canonicalRowsHash,
    dataset_revision: hash([evidence.tenantId, day, ENDPOINT, canonicalRowsHash]),
    basis: "observed_two_pass_snapshot",
  });
  const dataset = Object.freeze({ proof });
  datasets.set(dataset, {
    rows, proof,
    evidence: structuredClone({ ...evidence, rows }),
  });
  return dataset;
}

function getDatasetProof(dataset, { tenantId, controlledDate }) {
  const stored = datasets.get(dataset);
  if (!stored) reject("untrusted_dataset");
  if (stored.proof.tenant_id !== tenantId || stored.proof.controlled_date !== dateOnly(controlledDate)) reject("scope_mismatch");
  return stored.proof;
}

function getDatasetEvidence(dataset, scope) {
  getDatasetProof(dataset, scope);
  return structuredClone(datasets.get(dataset).evidence);
}

function getFitterDay(dataset, { tenantId, controlledDate, fitterId }) {
  const coverage = getDatasetProof(dataset, { tenantId, controlledDate });
  if (!/^[1-9]\d*$/.test(String(fitterId))) reject("fitter");
  const rows = datasets.get(dataset).rows.filter((row) => String(row.fitterId) === String(fitterId)).map((row) => ({
    source_key: `id:${row.id}`, fitter_category_id: row.categoryId == null ? null : String(row.categoryId),
    fitter_category_reference: row.categoryReference, hours: row.hours,
  }));
  return { rows, coverage };
}

function evaluateFitterDay(dataset, { tenantId, controlledDate, fitterId, payCodeRules, requiredHours }) {
  const { rows, coverage } = getFitterDay(dataset, { tenantId, controlledDate, fitterId });
  const summary = summarizeHours(rows, payCodeRules);
  return { summary, evaluation: evaluateHoursData({ summary, requiredHours, coverage }), coverage };
}

module.exports = { createHoursDataset, evaluateFitterDay, getDatasetEvidence, getDatasetProof, getFitterDay };
