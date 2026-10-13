"use strict";

const pool = require("../../db/pool");
const dates = require("./timeControl.dates");
const HC = "f1f51c07-2d88-4ee4-a766-78eac833a9d0";
const DEP = "dep@hoyrup-clemmensen.dk";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TERMINAL = new Set(["completed", "partial", "failed", "missed"]);
const SAFE_COUNTS = new Set(["ok", "under_norm", "blocked", "expected_mails", "queued", "accepted", "pending", "rejected", "unclear",
  "rows", "row_count", "pages", "page", "pass", "passes", "pass_count", "attempt", "attempts", "retries", "duration_ms",
  "durationMs", "requestTimeoutMs", "waitMs", "http_status", "status", "total", "run_id", "dataset_id", "outbox_id",
  "mail_count", "result_count", "dataset_count", "controlled_date", "current_page", "next_page", "provider_message_id", "request_count", "logical_page_calls", "attempt_count", "delivery_state"]);

function scope(tenantId) {
  if (!UUID.test(tenantId || "")) throw new Error("time_control_monitor_tenant_required");
}
function safeError(error) {
  const code = String(typeof error === "string" ? error : error?.code || error?.message || error?.name || "time_control_failed");
  return /^[a-zA-Z0-9_:.-]{1,180}$/.test(code) ? code : "time_control_failed";
}
function safeCounts(counts = {}) {
  const result = {};
  for (const [key, value] of Object.entries(counts)) {
    if (!SAFE_COUNTS.has(key)) continue;
    if (typeof value === "number" && Number.isFinite(value) || value === null) result[key] = value;
    else if (["run_id", "dataset_id", "outbox_id", "provider_message_id"].includes(key) && UUID.test(value || "")) result[key] = value;
    else if (key === "controlled_date") {
      try { result[key] = dates.normalizeIsoDate(value); } catch (_) { /* Do not retain arbitrary source text. */ }
    }
    else if (key === "delivery_state" && ["accepted", "pending", "rejected", "unclear"].includes(value)) result[key] = value;
  }
  return result;
}
function scheduledAt(day, hour) {
  const nominal = new Date(`${dates.normalizeIsoDate(day)}T${String(hour).padStart(2, "0")}:00:00Z`);
  const offset = dates.getCopenhagenParts(nominal).hour - hour;
  return new Date(nominal.getTime() - offset * 3600000);
}
function slotsForDay(day) {
  const weekday = dates.weekdayIndexForIsoDate(day);
  if (weekday < 2 || weekday > 5) return [];
  const result = [{ controlType: "daily_09", controlledDate: dates.addDaysIso(day, -1), scheduledAt: scheduledAt(day, 9) }];
  if (weekday === 5) result.push({ controlType: "friday_weekly_v1", controlledDate: day, scheduledAt: scheduledAt(day, 12) });
  return result;
}
function reportDueAt(day) {
  return new Date(scheduledAt(day, dates.weekdayIndexForIsoDate(day) === 5 ? 12 : 9).getTime() + 20 * 60000);
}
function deliveryState(row) {
  if (row.status === "sent" && row.provider_message_id) return "accepted";
  if (row.status === "processing" || row.last_error_code === "provider_acceptance_unclear") return "unclear";
  if (row.status === "dead_letter") return "rejected";
  return "pending";
}
function outcome(run, results, mails) {
  const counts = { ok: 0, under_norm: 0, blocked: 0, expected_mails: 0, accepted: 0, pending: 0, rejected: 0, unclear: 0 };
  for (const result of results) {
    if (result.status === "ok") counts.ok++;
    else if (["missing_hours", "weekly_reminder"].includes(result.status)) counts.under_norm++;
    else counts.blocked++;
  }
  for (const mail of mails) {
    if (/employee/.test(mail.template_key || "")) counts.expected_mails++;
    counts[deliveryState(mail)]++;
  }
  const failed = !run || run.status !== "completed" || counts.blocked > 0;
  const status = failed ? "failed" : counts.pending + counts.rejected + counts.unclear > 0 ? "partial" : "completed";
  return { status, counts, errorCode: failed ? safeError(run?.error_reason || "time_control_failed")
    : status === "partial" ? "time_control_delivery_incomplete" : null };
}

async function recordStep({ tenantId, executionId, step, status, counts = {}, errorCode = null, startedAt = null, finishedAt = null }) {
  scope(tenantId);
  if (!UUID.test(executionId || "") || !/^[a-z][a-z0-9_]{0,79}$/.test(step || "") ||
      !["started", "completed", "failed", "observed"].includes(status)) throw new Error("time_control_trace_invalid");
  const safe = safeCounts(counts);
  const at = new Date();
  if (!startedAt && status === "started") startedAt = at;
  if (!finishedAt && ["completed", "failed"].includes(status)) finishedAt = at;
  if (!startedAt && finishedAt) {
    const start = (await pool.query(
      `SELECT occurred_at FROM time_control_execution_step WHERE tenant_id=$1 AND execution_id=$2 AND step=$3 AND status='started' ORDER BY id DESC LIMIT 1`,
      [tenantId, executionId, step])).rows[0];
    startedAt = start?.occurred_at || null;
  }
  const duration = safe.duration_ms ?? (startedAt && finishedAt ? Math.max(0, new Date(finishedAt) - new Date(startedAt)) : null);
  // Independent autocommit: a rollback/crash in evaluation must not erase its trace.
  await pool.query(
    `INSERT INTO time_control_execution_step(tenant_id,execution_id,step,status,counts,error_code,started_at,finished_at,duration_ms)
     VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
    [tenantId, executionId, step, status, JSON.stringify(safe), errorCode ? safeError(errorCode) : null, startedAt, finishedAt, duration]);
  if (step === "run_binding" && status === "completed" && safe.run_id) {
    await pool.query("UPDATE time_control_execution SET run_id=$3 WHERE tenant_id=$1 AND id=$2 AND run_id IS NULL", [tenantId, executionId, safe.run_id]);
  }
}
async function activePolicy(client, tenantId, lock = false) {
  scope(tenantId);
  return (await client.query(
    `SELECT p.*,p.first_schedule_on::text AS first_day,o.id AS operation_id,o.group_id,o.started_at AS operation_started_at,
       o.covered_from::text AS covered_day,t.slug
     FROM time_control_monitor_policy p JOIN time_control_settings s ON s.tenant_id=p.tenant_id
     JOIN tenant t ON t.id=p.tenant_id JOIN time_control_operation_state os ON os.tenant_id=p.tenant_id
     JOIN time_control_operation o ON o.tenant_id=os.tenant_id AND o.group_id=os.group_id AND o.id=os.operation_id
     WHERE p.tenant_id=$1 AND p.is_enabled=true AND s.is_enabled=true AND s.mode='live'
       AND s.live_enabled_at IS NOT NULL AND t.status='active' AND os.status='active'
       AND p.tenant_id='${HC}'::uuid AND p.status_recipient_email='${DEP}'
     ${lock ? "FOR SHARE OF p,s,t,os,o" : ""}`, [tenantId])).rows[0] || null;
}
async function ensureExecution(client, { tenantId, policy, slot, origin = "scheduled" }) {
  scope(tenantId);
  if (policy.tenant_id && policy.tenant_id !== tenantId) throw new Error("time_control_monitor_policy_tenant_mismatch");
  if (slot.controlledDate < policy.covered_day || slot.scheduledAt < new Date(policy.operation_started_at)) return null;
  return (await client.query(
    `INSERT INTO time_control_execution(tenant_id,operation_id,group_id,scheduled_at,controlled_date,control_type,origin)
     VALUES($1,$2,$3,$4,$5::date,$6,$7) ON CONFLICT(tenant_id,scheduled_at,control_type)
     DO UPDATE SET scheduled_at=time_control_execution.scheduled_at
     WHERE time_control_execution.operation_id=EXCLUDED.operation_id AND time_control_execution.group_id=EXCLUDED.group_id
     RETURNING *,controlled_date::text AS controlled_day`,
    [tenantId, policy.operation_id, policy.group_id, slot.scheduledAt, slot.controlledDate, slot.controlType, origin])).rows[0];
}
async function beginExecution({ tenantId, scheduled, now = new Date() }) {
  scope(tenantId);
  const policy = await activePolicy(pool, tenantId);
  if (!policy) throw new Error("time_control_monitor_policy_not_active");
  const localDay = dates.getCopenhagenParts(now).isoDate;
  if (localDay < policy.first_day) throw new Error("time_control_monitor_schedule_not_started");
  const slot = slotsForDay(localDay).find(s => s.controlType === scheduled.controlType && s.controlledDate === scheduled.controlledDate);
  const current = dates.determineScheduledControl(now);
  if (!slot || current?.controlType !== scheduled.controlType || current?.controlledDate !== scheduled.controlledDate) {
    throw new Error("time_control_scheduled_start_window_expired");
  }
  const execution = await ensureExecution(pool, { tenantId, policy, slot });
  if (!execution) throw new Error("time_control_monitor_operation_not_admitted");
  const claimed = (await pool.query(
    `UPDATE time_control_execution SET status='running',started_at=$3 WHERE tenant_id=$1 AND id=$2 AND status='planned' RETURNING *`,
    [tenantId, execution.id, now])).rows[0];
  if (!claimed) return null;
  await recordStep({ tenantId, executionId: execution.id, step: "scheduled_start", status: "completed", startedAt: slot.scheduledAt, finishedAt: now });
  return execution;
}
async function runEvidence(client, { tenantId, runId }) {
  scope(tenantId);
  const run = (await client.query("SELECT *,controlled_date::text AS controlled_day FROM time_control_run WHERE tenant_id=$1 AND id=$2", [tenantId, runId])).rows[0];
  const results = (await client.query("SELECT status FROM time_control_result WHERE tenant_id=$1 AND run_id=$2", [tenantId, runId])).rows;
  const mails = (await client.query(
    `SELECT o.id,o.recipient_email,o.template_key,o.status,o.provider_message_id,o.last_error_code AS error_code,o.last_error_code
     FROM time_control_mail_log m JOIN email_outbox o ON o.tenant_id=m.tenant_id AND o.id=m.email_outbox_id
     WHERE m.tenant_id=$1 AND m.run_id=$2 ORDER BY o.created_at,o.id`, [tenantId, runId])).rows;
  return { run, results, mails };
}
async function finishExecution({ tenantId, executionId, result = null, error = null }) {
  scope(tenantId);
  const bound = result?.run?.id || (await pool.query("SELECT run_id FROM time_control_execution WHERE tenant_id=$1 AND id=$2", [tenantId, executionId])).rows[0]?.run_id;
  const evidence = bound ? await runEvidence(pool, { tenantId, runId: bound }) : { run: null, results: [], mails: [] };
  const state = outcome(evidence.run, evidence.results, evidence.mails);
  if (error) { state.status = "failed"; state.errorCode = safeError(error); }
  await pool.query(
    `UPDATE time_control_execution SET run_id=$3,status=$4,counts=$5::jsonb,error_code=$6,finished_at=clock_timestamp()
     WHERE tenant_id=$1 AND id=$2 AND status='running'`,
    [tenantId, executionId, evidence.run?.id || null, state.status, JSON.stringify(state.counts), state.errorCode]);
  await recordStep({ tenantId, executionId, step: "execution_finished", status: state.status === "completed" ? "completed" : "failed",
    counts: state.counts, errorCode: state.errorCode });
  return state;
}
async function heartbeat() {
  await pool.query(`UPDATE time_control_monitor_policy SET scheduler_heartbeat_at=clock_timestamp() WHERE tenant_id=$1 AND is_enabled=true`, [HC]);
}

async function getOverview({ tenantId, now = new Date() }) {
  scope(tenantId);
  const policy = await activePolicy(pool, tenantId);
  const localDay = dates.getCopenhagenParts(now).isoDate;
  const future = [];
  if (policy) for (let i = 0; i < 9; i++) {
    const day = dates.addDaysIso(localDay, i);
    if (day < policy.first_day) continue;
    for (const slot of slotsForDay(day)) if (slot.scheduledAt > now && slot.controlledDate >= policy.covered_day) future.push(slot);
  }
  const executions = (await pool.query(
    `SELECT *,controlled_date::text AS controlled_date FROM time_control_execution WHERE tenant_id=$1 ORDER BY scheduled_at DESC LIMIT 12`, [tenantId])).rows;
  const reports = (await pool.query(
    `SELECT id,report_date::text,status,provider_message_id,error_code,provider_http_status,attempt_count,last_attempt_at
     FROM time_control_status_report WHERE tenant_id=$1 ORDER BY report_date DESC LIMIT 10`, [tenantId])).rows;
  for (const execution of executions) {
    execution.steps = (await pool.query("SELECT * FROM time_control_execution_step WHERE tenant_id=$1 AND execution_id=$2 ORDER BY id", [tenantId, execution.id])).rows;
    execution.mails = execution.run_id ? (await runEvidence(pool, { tenantId, runId: execution.run_id })).mails.map(m => ({ ...m, status: deliveryState(m) })) : [];
    const day = dates.getCopenhagenParts(new Date(execution.scheduled_at)).isoDate;
    execution.status_report = reports.find(r => r.report_date === day) || null;
  }
  const next = future[0];
  const missing = executions.filter(e => e.status === "missed").map(e => ({ scheduled_at: e.scheduled_at,
    control_type: e.control_type, controlled_date: e.controlled_date, reason: e.error_code }));
  if (policy && localDay >= policy.first_day) for (const slot of slotsForDay(localDay)) {
    if (now - slot.scheduledAt >= 120000 && !executions.some(e => new Date(e.scheduled_at).getTime() === slot.scheduledAt.getTime())) {
      missing.push({ scheduled_at: slot.scheduledAt, control_type: slot.controlType, controlled_date: slot.controlledDate, reason: "time_control_expected_start_missing" });
    }
  }
  if (policy && localDay >= policy.first_day && slotsForDay(localDay).length && now >= reportDueAt(localDay) &&
      !reports.some(r => r.report_date === localDay)) {
    missing.push({ scheduled_at: reportDueAt(localDay), control_type: "daily_status", controlled_date: localDay,
      reason: "time_control_status_report_missing" });
  }
  return { now: now.toISOString(), next_expected: next ? { scheduled_at: next.scheduledAt, control_type: next.controlType, controlled_date: next.controlledDate } : null,
    watchdog: { last_checked_at: policy?.last_checked_at || null, scheduler_heartbeat_at: policy?.scheduler_heartbeat_at || null },
    executions, reports, missing_expected: missing };
}

module.exports = { HC, DEP, TERMINAL, scope, safeError, safeCounts, scheduledAt, slotsForDay, reportDueAt, deliveryState, outcome,
  recordStep, activePolicy, ensureExecution, beginExecution, runEvidence, finishExecution, heartbeat, getOverview };
