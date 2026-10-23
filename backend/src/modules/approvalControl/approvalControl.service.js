"use strict";

const pool = require("../../db/pool");
const refresh = require("../../services/fitterhoursRefreshService");
const scope = require("./approvalControl.scope");
const source = require("./approvalControl.source");
const logic = require("./approvalControl.logic");
const audit = require("./approvalControl.audit");
const admission = require("./approvalControl.admission");
const { createHttpError } = require("../../middleware/errorHandler");

const running = new Set();

function request(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some(key => !["from_date", "to_date", "project_id"].includes(key))) {
    throw createHttpError(400, "approval_control_preview_input_invalid");
  }
  if (!logic.validDay(input.from_date) || !logic.validDay(input.to_date)) throw createHttpError(400, "approval_control_date_invalid");
  const days = (Date.parse(input.to_date) - Date.parse(input.from_date)) / 86400000;
  if (days < 0 || days > 6) throw createHttpError(400, "approval_control_period_max_seven_days");
  if (input.project_id != null && (typeof input.project_id !== "string" || !/^[0-9a-f-]{36}$/i.test(input.project_id))) throw createHttpError(400, "approval_control_project_invalid");
  return { fromDate: input.from_date, toDate: input.to_date, projectId: input.project_id ?? null };
}

async function readScope(context, period, withConfig) {
  const client = await pool.connect();
  try {
    const selected = await scope.loadMine(client, { ...context, projectId: period.projectId });
    const config = withConfig && selected.projects.length ? await refresh.resolveTenantConfig(client, { tenant: context.tenantId }) : null;
    if (config && config.tenantId !== context.tenantId) throw createHttpError(403, "tenant_context_mismatch");
    return { ...selected, config };
  } finally { client.release(); }
}

const scopeKey = selected => JSON.stringify({ projects: selected.projects.map(p => p.project_id).sort(), bindings: selected.bindings.map(b => [b.project_id, b.ek_project_id]).sort() });

async function execute(context, period, initial) {
  try {
    const captured = initial.projects.length ? await source.capture({ config: initial.config, ...period })
      : { rows: [], observed_at: new Date().toISOString(), completed_at: new Date().toISOString(), endpoint: null, requests: 0, passes: 0 };
    const current = await readScope(context, period, false);
    if (scopeKey(current) !== scopeKey(initial)) throw createHttpError(409, "approval_control_scope_changed");
    const summary = logic.summarize({ ...context, ...period, ...current, rows: captured.rows });
    const query = new URLSearchParams({ from_date: period.fromDate, to_date: period.toDate });
    if (period.projectId) query.set("project_id", period.projectId);
    const result = {
      feature: "approval_control", mode: "preview", scope: "mine", ...period,
      observed_at: captured.observed_at, finished_at: captured.completed_at,
      mine_project_count: current.projects.length, ...summary,
      source: { endpoint: captured.endpoint, passes: captured.passes, requests: captured.requests },
      missing_project_bindings: current.projects.filter(p => !current.bindings.some(b => b.project_id === p.project_id && /^[1-9][0-9]*$/.test(b.ek_project_id))).map(p => ({ project_id: p.project_id, reference: p.external_project_ref, reason: "Sagen mangler en gyldig eksisterende relation til EK-projekt-ID." })),
      mail: {
        to: current.user.email, cc: [], subject: `Godkendelseskontrol: ${summary.counts.open_rows} registreringer afventer på dine sager`,
        link: "/tenant/approval-control.html?" + query, would_include: summary.counts.open_rows > 0,
        delivery: "not_attempted", sending_enabled: false,
      },
      scheduler_enabled: false,
    };
    const client = await pool.connect();
    try { result.audit = await audit.record(client, context, result); }
    catch (_) { throw createHttpError(503, "approval_control_audit_unavailable"); }
    finally { client.release(); }
    return result;
  } catch (error) {
    if (error.statusCode) throw error;
    if (/^approval_control_source_/.test(error.message)) {
      let client;
      try {
        client = await pool.connect();
        await audit.record(client, context, { ...period, observed_at: new Date().toISOString() }, error.message);
      } catch (_) { throw createHttpError(503, "approval_control_audit_unavailable"); }
      finally { if (client) client.release(); }
    }
    throw createHttpError(502, "approval_control_source_unavailable");
  }
}

async function preview(context, input) {
  const period = request(input);
  const key = context.tenantId + ":" + context.userId;
  if (running.has(key)) throw createHttpError(409, "approval_control_preview_running");
  running.add(key);
  try {
    const initial = await readScope(context, period, true);
    // Admission covers capture, reauthorization and audit, including failures.
    return initial.projects.length ? await admission.read(context, () => execute(context, period, initial))
      : await execute(context, period, initial);
  } finally { running.delete(key); }
}

async function status(context) {
  const client = await pool.connect();
  try {
    const current = await scope.loadMine(client, context);
    const last = await audit.latest(client, context);
    if (!last) return { latest: null, mine_project_count: current.projects.length, scheduler_enabled: false, sending_enabled: false };
    // Historical rows require an explicit interval preview, never a page-load status request.
    return { latest: { id: last.id, at: last.created_at,
      result: last.event_type === "approval_control.previewed" ? "preview_only" : last.event_type === "approval_control.capture_admitted" ? "running" : "failed" },
      mine_project_count: current.projects.length, scheduler_enabled: false, sending_enabled: false };
  } finally { client.release(); }
}

module.exports = { preview, request, status };
