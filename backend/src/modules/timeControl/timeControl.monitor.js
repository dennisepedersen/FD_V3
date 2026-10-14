"use strict";

const pool = require("../../db/pool");
const dates = require("./timeControl.dates");
const obs = require("./timeControl.observability");
const automation = require("./timeControl.automation");
const ENV = require("../../config/env");
const { sendEmail } = require("../../services/mailService");
const { renderTimeControlHtml } = require("./timeControl.email");
const SENDER = "Fielddesk Timekontrol <timekontrol@mail.fielddesk.dk>";
const LABELS = { accepted: "Provider accepterede", pending: "Afventer", queued: "Afventer", sending: "Uafklaret",
  rejected: "Afvist/fejlet", unclear: "Uafklaret", completed: "Lykkedes", partial: "Delvist gennemført", failed: "Fejlede", missed: "Ikke startet" };
const STEP_LABELS = {
  scheduled_start: "Planlagt start", run_started: "Kontrolkørsel", run_binding: "Tilknytning af kontrol",
  capture_started: "Indhentning fra EK", capture_page: "Indhentning fra EK", capture_completed: "Indhentning fra EK",
  validation: "Kontrol af datagrundlag", calculation: "Beregning", mail_decision: "Valg af mails",
  queue_committed: "Lagring af mails i kø", dispatch: "Afsendelse af mails", provider_result: "Mailudbyderens svar",
  execution_finished: "Afslutning af kontrol", watchdog: "Overvågning af kontrol", watchdog_mail: "Overvågning af mails",
};
function statusFailureReason(code) {
  const reasons = {
    time_control_expected_start_missing: "Den planlagte kontrol startede ikke",
    time_control_execution_deadline_exceeded: "Kontrollen blev ikke færdig inden fristen",
    time_control_expected_mail_unprocessed: "Forventede medarbejdermails blev ikke behandlet inden fristen",
    time_control_delivery_incomplete: "Ikke alle forventede mails har en bekræftet accept fra mailudbyderen",
    provider_acceptance_unclear: "Det er uafklaret, om mailudbyderen accepterede mailen; den genafsendes ikke automatisk",
    mail_provider_rejected_message: "Mailudbyderen afviste mailen",
    time_control_capture_invalid: "Datagrundlaget fra EK kunne ikke godkendes",
    time_control_capture_failed: "Indhentningen fra EK mislykkedes",
    "time_control_capture_invalid:request_failed": "Kaldet til EK mislykkedes",
    time_control_dispatch_window_expired: "Fristen for afsendelse er overskredet",
  };
  if (Object.hasOwn(reasons, code)) return reasons[code];
  if (String(code).startsWith("time_control_capture_invalid:")) return reasons.time_control_capture_invalid;
  return "Kontrollen kunne ikke gennemføres; se detaljerne i driftsloggen";
}

function registrationRows(execution) {
  // Count published datasets, never page reads or the two acquisition passes.
  const days = new Map();
  for (const step of execution.steps || []) {
    if (step.step !== "capture_completed" || step.status !== "completed") continue;
    const count = step.counts?.row_count;
    const day = step.counts?.controlled_date;
    if (Number.isSafeInteger(count) && count >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(day || "")) days.set(day, count);
  }
  if (!days.size) return ["Datagrundlag: antal registreringsrækker er ikke oplyst."];
  return [...days].map(([day, count]) => `Datagrundlag ${day}: ${count} registreringsrækker fra EK (ikke antal arbejdstimer).`);
}

function buildStatusMessage({ tenantId, reportDate, executions, correction = null }) {
  if (tenantId !== obs.HC) throw new Error("time_control_status_scope_invalid");
  dates.normalizeIsoDate(reportDate);
  const lines = ["Hej Dennis", "", `Timekontrol driftsstatus ${reportDate}`, ""];
  for (const e of executions) {
    lines.push(`Kontroldato: ${e.controlled_date}. ${e.control_type === "friday_weekly_v1" ? "Ugekontrol" : "Dagskontrol"}: ${LABELS[e.status] || "Afventer"}.`,
      `OK: ${e.counts?.ok || 0}. Under norm: ${e.counts?.under_norm || 0}. Blokerede: ${e.counts?.blocked || 0}.`,
      `Forventede medarbejdermails: ${e.counts?.expected_mails || 0}.`);
    lines.push(...registrationRows(e));
    const totals = { accepted: 0, pending: 0, rejected: 0, unclear: 0 };
    for (const m of e.mails || []) if (/employee/.test(m.template_key || "")) totals[m.status]++;
    for (const key of Object.keys(totals)) lines.push(`${LABELS[key]}: ${totals[key]}.`);
    const stopped = [...(e.steps || [])].reverse().find(s => s.status === "failed" && !["execution_finished", "run_started"].includes(s.step));
    if (e.error_code) lines.push(`Stoppunkt: ${STEP_LABELS[stopped?.step] ||
      (e.error_code === "time_control_delivery_incomplete" ? "Afsendelse af mails" : "Kontrolkørsel")}. Årsag: ${statusFailureReason(e.error_code)}.`);
    lines.push("");
  }
  if (!executions.length) lines.push("Den forventede kontrol mangler. Ingen medarbejdermails er dokumenteret afsendt.", "");
  if (correction) lines.push(correction, "");
  lines.push("Provideraccept er ikke bevis for modtagelse i indbakken.",
    "Driftslog: https://hoyrup-clemmensen.fielddesk.dk/tenant/time-control.html#operations", "", "Fielddesk Timekontrol");
  const text = lines.join("\n");
  return { to: obs.DEP, cc: [], from: SENDER, replyTo: "admin@fielddesk.dk",
    subject: `Timekontrol: driftsstatus ${reportDate}`, text,
    html: renderTimeControlHtml({ text, origin: "https://hoyrup-clemmensen.fielddesk.dk" }),
    tenantId, template: "time_control.daily_status" };
}
async function enqueueReport({ tenantId, reportDate, correction = null }) {
  const overview = await obs.getOverview({ tenantId });
  const executions = overview.executions.filter(e => dates.getCopenhagenParts(new Date(e.scheduled_at)).isoDate === reportDate);
  const message = buildStatusMessage({ tenantId, reportDate, executions, correction });
  const key = `time_control:status:${tenantId}:${reportDate}`;
  return (await pool.query(
    `INSERT INTO time_control_status_report(tenant_id,report_date,message_json,idempotency_key,expires_at)
     VALUES($1,$2::date,$3::jsonb,$4,$5) ON CONFLICT(tenant_id,report_date)
     DO UPDATE SET report_date=time_control_status_report.report_date RETURNING *`,
    [tenantId, reportDate, JSON.stringify(message), key, new Date(obs.reportDueAt(reportDate).getTime() + 48 * 3600000)])).rows[0];
}
function classifyStatusFailure(error, providerStarted) {
  const http = Number(error?.details?.status || 0);
  // A parsed explicit rejection is different from a lost/invalid provider response.
  const rejected = error?.code === "mail_provider_rejected_message" && http >= 400 && http < 500 && ![408, 409].includes(http);
  return { status: !providerStarted ? "queued" : rejected ? "rejected" : "unclear",
    code: !providerStarted ? obs.safeError(error) : rejected ? `mail_provider_rejected_http_${http}` : "provider_acceptance_unclear",
    http: http || null };
}
async function sendReport({ tenantId, reportId, sendEmailFn = sendEmail }) {
  obs.scope(tenantId);
  if (!automation.schedulerEnabled() || !automation.mailEnabled() || !await obs.activePolicy(pool, tenantId)) {
    return { skipped: true, reason: "time_control_status_sending_disabled" };
  }
  const report = (await pool.query(
    `UPDATE time_control_status_report SET status='sending',attempt_count=attempt_count+1,last_attempt_at=clock_timestamp()
     WHERE tenant_id=$1 AND id=$2 AND status IN ('queued','rejected') AND attempt_count<3
       AND next_attempt_at<=now() AND expires_at>now() RETURNING *`, [tenantId, reportId])).rows[0];
  if (!report) return { skipped: true, reason: "time_control_status_already_claimed_or_terminal" };
  let providerStarted = false;
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const locked = (await client.query("SELECT status FROM time_control_status_report WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId, report.id])).rows[0];
    if (locked?.status !== "sending") {
      await client.query("ROLLBACK");
      return { id: report.id, status: locked?.status || "unclear", skipped: true, reason: "time_control_status_claim_changed" };
    }
    // Honor the immediate database stop while retaining the durable pre-network claim.
    if (!await obs.activePolicy(client, tenantId, true)) throw new Error("time_control_status_sending_disabled");
    automation.requireSendingEnabled();
    const m = report.message_json;
    if (m.to !== obs.DEP || JSON.stringify(m.cc) !== "[]" || m.from !== SENDER || m.replyTo !== "admin@fielddesk.dk" ||
        m.tenantId !== tenantId || m.template !== "time_control.daily_status" || ENV.MAIL_REPLY_TO !== "admin@fielddesk.dk" ||
        ENV.MAIL_PROVIDER !== "resend" || !ENV.MAIL_API_KEY) throw new Error("time_control_status_message_invalid");
    providerStarted = true;
    const receipt = await sendEmailFn(m, { idempotencyKey: report.idempotency_key, timeoutMs: 15000 });
    if (receipt?.provider !== "resend" || typeof receipt.providerMessageId !== "string" || !receipt.providerMessageId.trim()) {
      throw new Error("provider_acceptance_unclear");
    }
    const saved = (await client.query(
      `UPDATE time_control_status_report SET status='accepted',provider_message_id=$3,completed_at=clock_timestamp(),error_code=NULL
       WHERE tenant_id=$1 AND id=$2 AND status='sending' RETURNING id`, [tenantId, report.id, receipt.providerMessageId])).rows[0];
    if (!saved) throw new Error("provider_acceptance_unclear");
    await client.query("COMMIT");
    return { id: report.id, status: "accepted", provider_message_id: receipt.providerMessageId, inbox_receipt_verified: false };
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    const failure = classifyStatusFailure(error, providerStarted);
    await pool.query(
      `UPDATE time_control_status_report SET status=$3,error_code=$4,provider_http_status=$5,completed_at=clock_timestamp(),
       next_attempt_at=clock_timestamp()+interval '5 minutes' WHERE tenant_id=$1 AND id=$2 AND status='sending'`,
      [tenantId, report.id, failure.status, failure.code, failure.http]);
    return { id: report.id, status: failure.status, error_code: failure.code, provider_http_status: failure.http };
  } finally { client?.release(); }
}

async function monitor({ tenantId, now = new Date(), sendReports = true }) {
  obs.scope(tenantId);
  const policy = await obs.activePolicy(pool, tenantId);
  if (!policy) return { skipped: true, reason: "monitor_policy_not_active" };
  const localDay = dates.getCopenhagenParts(now).isoDate;
  const executions = [];
  // A bounded week detects missed slots after outages; only 48-hour status recovery is sendable.
  for (let offset = -7; offset <= 1; offset++) {
    const day = dates.addDaysIso(localDay, offset);
    if (day < policy.first_day) continue;
    for (const slot of obs.slotsForDay(day)) {
      const execution = await obs.ensureExecution(pool, { tenantId, policy, slot });
      if (!execution) continue;
      executions.push(execution);
      let errorCode = null, status = null;
      if (execution.status === "planned" && now - slot.scheduledAt >= 120000) {
        errorCode = "time_control_expected_start_missing"; status = "missed";
      } else if (execution.status === "running" && now - slot.scheduledAt >= 15 * 60000) {
        errorCode = "time_control_execution_deadline_exceeded"; status = "failed";
      }
      if (status) {
        const changed = (await pool.query(
          `UPDATE time_control_execution SET status=$3,error_code=$4,finished_at=$5
           WHERE tenant_id=$1 AND id=$2 AND status=$6 RETURNING id`,
          [tenantId, execution.id, status, errorCode, now, execution.status])).rows[0];
        if (changed) await obs.recordStep({ tenantId, executionId: execution.id, step: "watchdog", status: "failed", errorCode });
      }
      if (execution.run_id && now - slot.scheduledAt >= 15 * 60000) {
        const evidence = await obs.runEvidence(pool, { tenantId, runId: execution.run_id });
        if (evidence.mails.some(m => obs.deliveryState(m) === "pending") && execution.error_code !== "time_control_expected_mail_unprocessed") {
          await pool.query("UPDATE time_control_execution SET status='partial',error_code='time_control_expected_mail_unprocessed' WHERE tenant_id=$1 AND id=$2 AND status IN ('completed','partial')", [tenantId, execution.id]);
          await obs.recordStep({ tenantId, executionId: execution.id, step: "watchdog_mail", status: "failed", errorCode: "time_control_expected_mail_unprocessed" });
        }
      }
    }
    if (offset >= -2 && obs.slotsForDay(day).length && now >= obs.reportDueAt(day)) await enqueueReport({ tenantId, reportDate: day });
  }
  const abandoned = (await pool.query(
    `UPDATE time_control_status_report SET status='unclear',error_code='provider_acceptance_unclear',completed_at=clock_timestamp()
     WHERE tenant_id=$1 AND status='sending' AND last_attempt_at<now()-interval '2 minutes' RETURNING id`, [tenantId])).rows;
  const reports = (await pool.query(
    `SELECT id FROM time_control_status_report WHERE tenant_id=$1 AND status IN ('queued','rejected')
     AND attempt_count<3 AND next_attempt_at<=now() AND expires_at>now() ORDER BY report_date`, [tenantId])).rows;
  const delivery = [];
  if (sendReports) for (const report of reports) delivery.push(await sendReport({ tenantId, reportId: report.id }));
  await pool.query("UPDATE time_control_monitor_policy SET last_checked_at=clock_timestamp() WHERE tenant_id=$1", [tenantId]);
  return { tenant_id: tenantId, checked_at: now.toISOString(), expected_slots: executions.length, abandoned_status_reports: abandoned.length, delivery };
}

async function importIncident({ tenantId, runId, correction }) {
  if (tenantId !== obs.HC) throw new Error("time_control_status_scope_invalid");
  const policy = await obs.activePolicy(pool, tenantId);
  if (!policy) throw new Error("time_control_monitor_policy_not_active");
  const evidence = await obs.runEvidence(pool, { tenantId, runId });
  const run = evidence.run;
  if (!run || run.triggered_by !== "scheduler" || run.mode !== "live" || run.control_type !== "daily_09" ||
      run.controlled_day !== "2026-10-12") throw new Error("time_control_incident_original_run_required");
  const slot = obs.slotsForDay("2026-10-13")[0];
  const e = await obs.ensureExecution(pool, { tenantId, policy, slot, origin: "incident" });
  if (e.status === "planned") {
    const state = obs.outcome(run, evidence.results, evidence.mails);
    await pool.query(
      `UPDATE time_control_execution SET run_id=$3,status=$4,counts=$5::jsonb,error_code=$6,started_at=$7,finished_at=$8
       WHERE tenant_id=$1 AND id=$2 AND status='planned'`,
      [tenantId, e.id, run.id, state.status, JSON.stringify(state.counts), state.errorCode, run.started_at, run.finished_at]);
    await obs.recordStep({ tenantId, executionId: e.id, step: "original_run_observed", status: "observed",
      counts: { run_id: run.id, ...state.counts }, startedAt: run.started_at, finishedAt: run.finished_at,
      errorCode: "time_control_delivery_incomplete" });
  }
  return enqueueReport({ tenantId, reportDate: "2026-10-13", correction });
}

module.exports = { buildStatusMessage, classifyStatusFailure, enqueueReport, sendReport, monitor, importIncident };
