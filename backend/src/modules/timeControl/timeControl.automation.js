"use strict";

function schedulerEnabled() {
  return ["1", "true", "yes", "on"].includes(String(process.env.TIME_CONTROL_SCHEDULER_ENABLED || "").trim().toLowerCase());
}

function mailEnabled() {
  return process.env.TIME_CONTROL_MAIL_ENABLED === "true";
}

function requireSendingEnabled() {
  if (!schedulerEnabled() || !mailEnabled()) throw new Error("time_control_automatic_mail_disabled");
}

async function dispatchRun({ tenantId, result, trace = null }, processOutbox = null) {
  if (!schedulerEnabled() || !mailEnabled()) return { skipped: true, reason: "automatic_mail_disabled" };
  const run = result?.run;
  if (!run || run.mode !== "live" || run.triggered_by !== "scheduler" ||
      !["daily_09", "friday_weekly_v1"].includes(run.control_type)) {
    return { skipped: true, reason: "not_a_live_scheduled_control" };
  }
  const ids = [...new Set((result.mails || []).map(mail => mail.email_outbox_id).filter(Boolean))];
  if (!ids.length) return { skipped: true, reason: "no_run_mail" };
  // Never sweep the tenant outbox: unrelated modules and historical queues are excluded.
  const process = processOutbox || require("../notifications/emailOutbox.processor").processDueEmails;
  return process({ tenantId, timeControlOutboxIds: ids, ...(trace ? { timeControlTrace: trace } : {}) });
}

module.exports = { schedulerEnabled, mailEnabled, requireSendingEnabled, dispatchRun };
