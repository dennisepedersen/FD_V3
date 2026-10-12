"use strict";

const { createHash } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const storage = require("./timeControl.dataset");
const coverage = require("./timeControl.coverage");
const dispatch = require("./timeControl.dispatch");
const { emailListFailureFor } = require("../../services/emailRecipients");
const { weeklyPeriod, getCopenhagenParts } = require("./timeControl.dates");
const { summarizeHours, evaluateHoursData, formatHoursDa } = require("./timeControl.logic");

const CONTROL_TYPE = "friday_weekly_v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateBindings(ids) {
  if (!Array.isArray(ids) || ids.length !== 5 || ids.some((id) => !UUID.test(id)) || new Set(ids).size !== 5) {
    throw new Error("time_control_weekly_requires_five_dataset_ids");
  }
}

function reminderWindow(friday, now = new Date()) {
  const local = getCopenhagenParts(now);
  const minutes = local.hour * 60 + local.minute;
  return local.isoDate === friday && minutes >= 12 * 60 && minutes < 14 * 60 + 30;
}

async function loadWeeklySnapshot(client, { tenantId, controlledDate, datasetIds, freshnessMinutes, allowHistoricalSnapshot = false }) {
  const period = weeklyPeriod(controlledDate);
  if (datasetIds === null) {
    const { rows } = await client.query(
      `SELECT dataset_id FROM time_control_hours_dataset_head
       WHERE tenant_id = $1 AND controlled_date = ANY($2::date[])
         AND invalidated_at IS NULL ORDER BY controlled_date`,
      [tenantId, period.days]
    );
    datasetIds = rows.map((row) => row.dataset_id);
  }
  validateBindings(datasetIds);
  const days = [];
  // Stable day order also fixes lock ordering against publication/invalidation.
  for (const [i, day] of period.days.entries()) {
    const stored = await storage.loadHoursDataset(client, {
      tenantId, controlledDate: day, datasetId: datasetIds[i], freshnessMinutes, allowHistoricalSnapshot,
    });
    if (!allowHistoricalSnapshot && stored.proof.server_captured !== true) {
      throw new Error("time_control_weekly_server_observation_required");
    }
    days.push({ day, ...stored });
  }
  const proof = {
    contract: CONTROL_TYPE, status: "complete", tenant_id: tenantId,
    monday: period.monday, friday: period.friday, required_hours: 37,
    freshness: allowHistoricalSnapshot ? "explicit_historical_demo" : "fresh_server_observations",
    days: days.map(({ day, proof: dayProof }) => ({ controlled_date: day, ...dayProof })),
  };
  const bindingHash = createHash("sha256").update(JSON.stringify(proof)).digest("hex");
  const inserted = await client.query(
    `INSERT INTO time_control_weekly_snapshot (tenant_id, monday, binding_hash, proof_json)
     VALUES ($1, $2::date, $3, $4::jsonb)
     ON CONFLICT (tenant_id, monday, binding_hash) DO NOTHING RETURNING id`,
    [tenantId, period.monday, bindingHash, JSON.stringify(proof)]
  );
  const row = inserted.rows[0] || (await client.query(
    "SELECT id FROM time_control_weekly_snapshot WHERE tenant_id = $1 AND monday = $2::date AND binding_hash = $3",
    [tenantId, period.monday, bindingHash]
  )).rows[0];
  if (!row) throw new Error("time_control_weekly_snapshot_store_failed");
  if (inserted.rows.length) {
    for (const [i, day] of period.days.entries()) {
      await client.query(
        `INSERT INTO time_control_weekly_snapshot_day (snapshot_id, tenant_id, controlled_date, dataset_id)
         VALUES ($1, $2, $3::date, $4)`,
        [row.id, tenantId, day, datasetIds[i]]
      );
    }
  }
  return { id: row.id, proof: { ...proof, weekly_snapshot_id: row.id }, days, period };
}

function evaluateWeeklyFitter(snapshot, { tenantId, fitterId, payCodeRules }) {
  const rows = snapshot.days.flatMap(({ day, dataset }) =>
    coverage.getFitterDay(dataset, { tenantId, controlledDate: day, fitterId }).rows);
  const summary = summarizeHours(rows, payCodeRules);
  const evaluation = evaluateHoursData({ summary, requiredHours: 37, coverage: snapshot.proof });
  return {
    summary,
    evaluation: { ...evaluation, missingHours: null, status: evaluation.status === "missing_hours" ? "weekly_reminder" : evaluation.status },
  };
}

function weeklyMail({ name, monday, friday, validHours }) {
  const subject = `Ugens timeregistrering ${monday} – ${friday}`;
  const body = `Hej ${name.split(/\s+/)[0]}\n\nVed kontrollen fredag kl. 12.00 kunne Fielddesk se ${formatHoursDa(validHours)} medregnede timer for denne uge (${monday} – ${friday}). Ugenormen er 37 timer.\nHusk at færdiggøre ugens timeregistrering inden hjemgang kl. 14.30 samme fredag.\nFredagen er stadig i gang. Du kan se bort fra denne besked, hvis du allerede har registreret resten efter kontrollen.`;
  return { subject, body };
}

function weeklySummary(results, period) {
  return `Ugekontrol ${period.monday} – ${period.friday} fredag kl. 12.00. Ugenormen er 37 timer. Fredagen og registreringen er stadig i gang.\n\n` +
    results.map((row) => `${row.employee_name} (${row.internal_ref}): ${formatHoursDa(row.valid_hours)} medregnede timer; påmindelse om at færdiggøre ugens registrering inden kl. 14.30.`).join("\n");
}

async function validateDispatchSnapshot(client, { tenantId, row }) {
  const payload = row.payload_json || {};
  if (![payload.run_id, payload.weekly_snapshot_id].every((id) => typeof id === "string" && UUID.test(id))) {
    throw new Error("time_control_weekly_dispatch_binding_invalid");
  }
  const period = weeklyPeriod(payload.friday);
  if (!reminderWindow(period.friday)) throw new Error("time_control_weekly_reminder_expired");
  if (payload.monday !== period.monday) throw new Error("time_control_weekly_dispatch_binding_invalid");
  const { rows: runs } = await client.query(
    `SELECT r.id, s.proof_json FROM time_control_run r
     JOIN time_control_weekly_snapshot s ON s.id = r.weekly_snapshot_id AND s.tenant_id = r.tenant_id
     WHERE r.tenant_id = $1 AND r.id = $2 AND r.weekly_snapshot_id = $3
       AND r.control_type = 'friday_weekly_v1' AND r.controlled_date = $4::date
       AND r.mode = 'live' AND r.triggered_by = 'scheduler' AND r.status = 'completed' FOR SHARE OF r`,
    [tenantId, payload.run_id, payload.weekly_snapshot_id, period.friday]
  );
  const proof = runs[0]?.proof_json;
  if (!proof || proof.freshness !== "fresh_server_observations" || proof.status !== "complete") {
    throw new Error("time_control_weekly_dispatch_snapshot_invalid");
  }
  const { rows: settings } = await client.query(
    `SELECT s.sync_freshness_minutes,s.is_enabled,s.mode,s.employee_cc_emails,s.friday_manager_emails FROM time_control_settings s
     JOIN tenant t ON t.id=s.tenant_id WHERE s.tenant_id=$1 AND t.status='active' FOR SHARE OF s,t`, [tenantId]
  );
  if (settings[0]?.is_enabled !== true || settings[0]?.mode !== "live") {
    throw new Error("time_control_weekly_dispatch_settings_invalid");
  }
  const employeeMail = row.template_key === "time_control.employee_weekly_reminder_v1";
  if (!employeeMail) {
    const routing = emailListFailureFor(settings[0].friday_manager_emails);
    if (routing.errorCode) throw new Error("time_control_weekly_dispatch_routing_changed");
    dispatch.validateRouting(row, { to: routing.emails[0], cc: routing.emails.slice(1) }, "time_control_weekly");
  }
  const { rows: bindings } = await client.query(
    `SELECT dataset_id, controlled_date::text AS day FROM time_control_weekly_snapshot_day
     WHERE tenant_id = $1 AND snapshot_id = $2 ORDER BY controlled_date`,
    [tenantId, payload.weekly_snapshot_id]
  );
  if (bindings.length !== 5 || !Array.isArray(proof.days) || proof.days.length !== 5) {
    throw new Error("time_control_weekly_dispatch_binding_invalid");
  }
  for (const [i, binding] of bindings.entries()) {
    if (binding.day !== period.days[i]) throw new Error("time_control_weekly_dispatch_binding_invalid");
    const current = await storage.loadHoursDataset(client, {
      tenantId, controlledDate: binding.day, datasetId: binding.dataset_id,
      freshnessMinutes: settings[0]?.sync_freshness_minutes,
    });
    const normalized = JSON.parse(JSON.stringify({ controlled_date: binding.day, ...current.proof }));
    if (!current.proof.server_captured || !isDeepStrictEqual(normalized, proof.days[i])) {
      throw new Error("time_control_weekly_dispatch_snapshot_invalid");
    }
  }
  const { rows: results } = await client.query(
    "SELECT * FROM time_control_result WHERE tenant_id = $1 AND run_id = $2 FOR SHARE",
    [tenantId, payload.run_id]
  );
  if (!results.length) {
    throw new Error("time_control_weekly_dispatch_result_invalid");
  }
  const { rows: logs } = await client.query(
    `SELECT result_id FROM time_control_mail_log WHERE tenant_id = $1 AND run_id = $2
      AND email_outbox_id = $3 FOR SHARE`, [tenantId, payload.run_id, row.id]
  );
  if (logs.length !== 1 || (row.template_key === "time_control.employee_weekly_reminder_v1"
    ? !results.some((result) => result.id === logs[0].result_id && result.status === "weekly_reminder")
    : !results.some((result) => result.status === "weekly_reminder"))) {
    throw new Error("time_control_weekly_dispatch_result_invalid");
  }
  const queuedBindings = payload.result_bindings;
  if (!Array.isArray(queuedBindings) || !queuedBindings.length ||
      new Set(queuedBindings.map(binding => binding?.result_id)).size !== queuedBindings.length ||
      employeeMail && (queuedBindings.length !== 1 || queuedBindings[0]?.result_id !== logs[0].result_id)) {
    throw new Error("time_control_weekly_dispatch_binding_invalid");
  }
  const recipients = queuedBindings.map(binding => results.find(result => result.id === binding?.result_id));
  if (recipients.some((result, i) => !result || result.status !== "weekly_reminder" ||
      result.weekly_snapshot_id !== payload.weekly_snapshot_id || result.coverage_status !== "complete" ||
      !dispatch.matchesResultBinding(result, queuedBindings[i]))) {
    throw new Error("time_control_weekly_dispatch_binding_invalid");
  }
  if (employeeMail) {
    dispatch.validateRouting(row, { to: recipients[0].employee_email, cc: settings[0].employee_cc_emails }, "time_control_weekly");
  }
  const operation = require("./timeControl.operation");
  for (const result of recipients) {
    const gate = await operation.checkGate(client, { tenantId, identity: result.identity_snapshot, friday: period.friday,
      requireWeekly: true, snapshotId: payload.weekly_snapshot_id });
    if (!gate.eligible) throw new Error(`time_control_operation_dispatch_blocked:${gate.reason}`);
    const config = await require("./timeControl.repository").lockEmployeeConfig(client, { tenantId, configId: result.employee_config_id });
    const resolution = config && require("./timeControl.service")._test.classifyResolvedEmployee(config,
      await require("./timeControl.repository").resolveEmployeeConfig(client, { tenantId, config }));
    if (!resolution?.ok || !dispatch.matchesIdentity(resolution.employee.identitySnapshot, result.identity_snapshot) ||
        employeeMail && row.recipient_email.trim().toLowerCase() !== resolution.employee.email) {
      throw new Error("time_control_weekly_dispatch_identity_changed");
    }
  }
  const rules = require("./timeControl.logic").normalizePayCodeRules(await require("./timeControl.repository").listPayCodeRules(client, { tenantId }));
  for (const result of recipients) {
    const days = [];
    for (const binding of bindings) {
      days.push({ day: binding.day, ...await storage.loadHoursDataset(client, { tenantId, controlledDate: binding.day,
        datasetId: binding.dataset_id, freshnessMinutes: settings[0].sync_freshness_minutes }) });
    }
    const evaluated = evaluateWeeklyFitter({ days, proof }, { tenantId, fitterId: result.fitter_id, payCodeRules: rules });
    if (evaluated.evaluation.status !== result.status || evaluated.evaluation.validHours !== Number(result.valid_hours)) {
      throw new Error("time_control_weekly_dispatch_evaluation_changed");
    }
  }
  if (!reminderWindow(period.friday)) throw new Error("time_control_weekly_reminder_expired");
}

module.exports = { CONTROL_TYPE, validateBindings, reminderWindow, loadWeeklySnapshot, validateDispatchSnapshot, evaluateWeeklyFitter, weeklyMail, weeklySummary };
