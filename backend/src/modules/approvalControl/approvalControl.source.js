"use strict";

const { createHash } = require("node:crypto");

const LIMITS = Object.freeze({ pageSize: 100, pagesPerPass: 20, deadlineMs: 30000, requestMs: 8000 });
const ENDPOINT = "/api/v4/paginatedfitterhours";
const empty = value => value == null || value === "" || Array.isArray(value) && value.length === 0 ||
  typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
const validErrorCount = value => value == null || value === 0;
const fingerprint = rows => createHash("sha256").update(JSON.stringify(rows.slice().sort((a, b) => a.id - b.id))).digest("hex");

function projectRow(raw) {
  if (!raw || !Number.isSafeInteger(raw.id) || raw.id <= 0 || !Number.isSafeInteger(raw.projectID) || raw.projectID <= 0) {
    throw new Error("approval_control_source_row_identity_invalid");
  }
  const row = {};
  for (const key of ["id", "projectID", "date", "hours", "fitterID", "fitterName", "approvedBy", "approvedDate"]) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) row[key] = raw[key];
  }
  return row;
}

async function capture({ config, fromDate, toDate, fetchImpl = global.fetch, clock = Date.now }) {
  const started = clock();
  const base = new URL(config.ekBaseUrl);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new Error("approval_control_source_config_invalid");
  const headers = { apikey: config.ekApiKey, sitename: config.siteName, Accept: "application/json" };
  const passes = [];
  let requests = 0;
  for (let pass = 0; pass < 2; pass++) {
    const collected = [];
    const ids = new Set();
    let total = null;
    let terminal = false;
    for (let page = 1; page <= LIMITS.pagesPerPass; page++) {
      const remaining = LIMITS.deadlineMs - (clock() - started);
      if (remaining <= 0) throw new Error("approval_control_source_deadline");
      const url = new URL(ENDPOINT, base.origin);
      for (const [key, value] of Object.entries({ fromDate, toDate, page, pageSize: LIMITS.pageSize })) url.searchParams.set(key, String(value));
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.min(remaining, LIMITS.requestMs));
      let body;
      try {
        requests++;
        const response = await fetchImpl(url, { method: "GET", headers, redirect: "error", signal: controller.signal });
        if (response.status !== 200) throw new Error("approval_control_source_http_" + response.status);
        body = await response.json();
      } catch (error) {
        // Never forward an HTTP client exception, URL, headers or provider body.
        if (/^approval_control_source_http_[0-9]{3}$/.test(error.message)) throw error;
        throw new Error("approval_control_source_read_failed");
      } finally { clearTimeout(timeout); }
      const data = body?.data;
      if (body?.hasErrors !== false || !empty(body.errorMessage) || !empty(body.validationErrors) || !empty(body.modelStateErrors) ||
          !empty(body.errors) || !validErrorCount(body.errorCount) ||
          !data || !Array.isArray(data.data) || !(data.hasErrors == null || data.hasErrors === false) || !empty(data.errors) || !validErrorCount(data.errorCount) ||
          !Number.isSafeInteger(data.total) || data.total < 0 ||
          !(data.currentPage === page || page === 1 && data.total === 0 && data.currentPage === 0)) {
        throw new Error("approval_control_source_envelope_invalid");
      }
      if (total === null) total = data.total;
      if (data.total !== total || data.data.length > LIMITS.pageSize) throw new Error("approval_control_source_paging_invalid");
      for (const raw of data.data) {
        const row = projectRow(raw);
        if (ids.has(row.id)) throw new Error("approval_control_source_duplicate_id");
        if (typeof row.date !== "string" || row.date.slice(0, 10) < fromDate || row.date.slice(0, 10) > toDate) throw new Error("approval_control_source_date_scope_invalid");
        ids.add(row.id);
        collected.push(row);
      }
      if (data.nextPage === null) {
        if (collected.length !== total) throw new Error("approval_control_source_incomplete");
        terminal = true;
        break;
      }
      if (data.nextPage !== page + 1 || data.data.length !== LIMITS.pageSize || collected.length >= total) throw new Error("approval_control_source_paging_invalid");
    }
    if (!terminal) throw new Error("approval_control_source_page_limit");
    passes.push(collected);
  }
  if (clock() - started > LIMITS.deadlineMs || fingerprint(passes[0]) !== fingerprint(passes[1])) throw new Error("approval_control_source_unstable");
  return { rows: passes[1], observed_at: new Date(started).toISOString(), completed_at: new Date(clock()).toISOString(), requests, endpoint: ENDPOINT, passes: 2 };
}

module.exports = { capture, LIMITS };
