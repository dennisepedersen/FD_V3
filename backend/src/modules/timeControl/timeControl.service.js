"use strict";

const pool = require("../../db/pool");
const { createHash } = require("node:crypto");
const { withTransaction } = require("../../db/tx");
const auditService = require("../../services/auditService");
const emailOutboxService = require("../notifications/emailOutbox.service");
const { emailFailureFor, emailListFailureFor, normalizeEmail } = require("../../services/emailRecipients");
const repository = require("./timeControl.repository");
const hoursCoverage = require("./timeControl.coverage");
const {
  buildEmployeeMailVariables,
  buildManagerSummaryLines,
  evaluateHoursData,
  normalizePayCodeRules,
  summarizeHours,
} = require("./timeControl.logic");
const {
  formatDateLabelDa,
  normalizeIsoDate,
  requiredHoursForDate,
} = require("./timeControl.dates");

const SENDER = "Fielddesk Timekontrol <timekontrol@fielddesk.dk>";
const datasetStorage = require("./timeControl.dataset");
const weekly = require("./timeControl.weekly");
const operation = require("./timeControl.operation");
const orchestration = require("./timeControl.orchestration");
const { weeklyPeriod } = require("./timeControl.dates");

function asEmailArray(value) {
  const state = emailListFailureFor(value);
  if (state.errorCode) {
    const error = new Error(`time_control_${state.errorCode}`);
    error.code = `time_control_${state.errorCode}`;
    throw error;
  }
  return state.emails;
}

function compactError(error) {
  return String(error?.message || error || "time_control_failed").slice(0, 500);
}

function isFreshSyncState(state, freshnessMinutes, now = new Date()) {
  if (!state || !state.last_successful_sync_at) return false;
  if (state.endpoint_status !== "success" || state.last_error || state.current_job_id || state.active_job_id) return false;
  if (Number(state.pending_backlog_count || 0) > 0 || Number(state.failed_page_count || 0) > 0) return false;
  const lastSuccess = new Date(state.last_successful_sync_at).getTime();
  if (!Number.isFinite(lastSuccess)) return false;
  const age = now.getTime() - lastSuccess;
  return age >= 0 && age <= Number(freshnessMinutes || 180) * 60 * 1000;
}

function classifyResolvedEmployee(config, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, configError: "verified_fitter_mapping_missing" };
  if (rows.length !== 1) return { ok: false, configError: "verified_fitter_mapping_ambiguous" };
  const row = rows[0];
  const email = normalizeEmail(row.approved_email);
  const name = String(row.fitter_name || "").trim();
  if (!config.fitter_id || String(row.fitter_id) !== String(config.fitter_id) || !row.resource_group_id ||
      row.is_active_derived !== true) return { ok: false, configError: "verified_identity_chain_incomplete" };
  if (!row.email_approved_at || !row.email_approved_by_user_id || !Number.isInteger(row.approval_version) || row.approval_version < 1 ||
      !["fitter_master", "admin_override"].includes(row.email_source)) {
    return { ok: false, configError: "employee_email_not_approved" };
  }
  if (row.email_source === "fitter_master" &&
      (normalizeEmail(row.fitter_email) !== row.email_source_value || email !== row.email_source_value)) {
    return { ok: false, configError: "employee_email_approval_stale" };
  }
  if (!name) return { ok: false, configError: "employee_name_missing" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, configError: "employee_email_missing_or_invalid" };
  return {
    ok: true,
    employee: {
      employeeConfigId: config.id,
      internalRef: config.internal_ref,
      tenantUserId: row.tenant_user_id || null,
      fitterId: row.fitter_id,
      name,
      email,
      identitySnapshot: {
        fitter_id: row.fitter_id, group_id: row.resource_group_id,
        group_external_id: row.resource_group_external_id,
        approved_email: email, email_source: row.email_source,
        approval_version: row.approval_version, approved_at: row.email_approved_at,
        approved_by_user_id: row.email_approved_by_user_id,
      },
      resolutionMethod: "explicit_fitter_with_approved_group_and_email",
    },
  };
}

async function logInternalErrorMail(client, { tenantId, run, settings, dateLabel, errorReason }) {
  const recipients = asEmailArray(settings.internal_error_emails);
  const subject = `Timekontrol stoppet: ${dateLabel}`;
  const body = `Timekontrol blev stoppet for ${dateLabel}.\n\nAarsag: ${errorReason}`;
  const idempotencyKey = `time_control:${tenantId}:${run.control_type}:${run.controlled_date}:internal_error`;
  if (run.mode === "dry_run") {
    return repository.upsertMailLog(client, {
      tenantId, runId: run.id, mailType: "internal_error", mode: run.mode, status: "would_send",
      recipientEmails: recipients, subject, bodyPreview: body, idempotencyKey,
    });
  }
  const outbox = await emailOutboxService.enqueueEmail(client, {
    tenantId,
    actorId: "system:time_control",
    templateKey: "time_control.internal_error",
    recipientEmail: recipients[0] || null,
    recipientName: "DEP",
    variables: { date_label: dateLabel, error_reason: errorReason },
    payload: { run_id: run.id, control_type: run.control_type, controlled_date: run.controlled_date, cc_emails: recipients.slice(1), sender: SENDER },
    sourceType: "time_control",
    sourceId: run.id,
    idempotencyKey,
  });
  return repository.upsertMailLog(client, {
    tenantId, runId: run.id, mailType: "internal_error", mode: run.mode,
    status: outbox.status === "queued" ? "queued" : "failed",
    recipientEmails: recipients, subject, bodyPreview: body, emailOutboxId: outbox.id, idempotencyKey,
  });
}

async function logEmployeeMail(client, { tenantId, run, result, settings, dateLabel }) {
  const ccEmails = asEmailArray(settings.employee_cc_emails);
  const variables = buildEmployeeMailVariables({
    employeeName: result.employee_name,
    dateLabel,
    requiredHours: result.required_hours,
    validHours: result.valid_hours,
    missingHours: result.missing_hours,
  });
  const identityKey = JSON.stringify([tenantId, run.control_type, normalizeIsoDate(run.controlled_date), String(result.fitter_id), "employee_missing_hours"]);
  const idempotencyKey = `time_control:v2:${createHash("sha256").update(identityKey).digest("hex")}`;
  const existing = await repository.findEmployeeMailLog(client, { tenantId, idempotencyKey });
  // Reapproval must not rewrite an already queued/sent recipient or resend it.
  if (existing?.email_outbox_id) return existing;
  const body = `${variables.intro}\n\nDagens krav er ${variables.required_hours} timer. Fielddesk kan aktuelt se ${variables.valid_hours} gyldige timer, og der mangler derfor ${variables.missing_hours} timer.`;
  if (run.mode === "dry_run") {
    return repository.upsertMailLog(client, {
      tenantId, runId: run.id, resultId: result.id, mailType: "employee_missing_hours", mode: run.mode,
      status: "would_send", recipientEmails: [result.employee_email], ccEmails,
      subject: variables.subject, bodyPreview: body, idempotencyKey,
    });
  }
  const outbox = await emailOutboxService.enqueueEmail(client, {
    tenantId,
    actorId: "system:time_control",
    templateKey: "time_control.missing_hours.employee",
    recipientTenantUserId: null,
    recipientEmail: result.employee_email,
    recipientName: result.employee_name,
    variables,
    payload: { run_id: run.id, result_id: result.id, controlled_date: run.controlled_date, cc_emails: ccEmails, sender: SENDER,
      identity_snapshot: result.identity_snapshot, result_binding: require("./timeControl.dispatch").resultBinding(result) },
    sourceType: "time_control",
    sourceId: result.id,
    idempotencyKey,
  });
  return repository.upsertMailLog(client, {
    tenantId, runId: run.id, resultId: result.id, mailType: "employee_missing_hours", mode: run.mode,
    status: outbox.status === "queued" ? "queued" : "failed",
    recipientEmails: [result.employee_email], ccEmails, subject: variables.subject,
    bodyPreview: body, emailOutboxId: outbox.id, idempotencyKey,
  });
}

async function logFridayManagerMail(client, { tenantId, run, settings, dateLabel, missingResults }) {
  const recipients = asEmailArray(settings.friday_manager_emails);
  const summaryLines = buildManagerSummaryLines(missingResults);
  if (!summaryLines) return null;
  const subject = `Timekontrol: manglende fredagstimer for ${dateLabel}`;
  const idempotencyKey = `time_control:${tenantId}:${run.control_type}:${run.controlled_date}:friday_manager_summary`;
  const recipientEmails = recipients.slice(0, 1);
  const ccEmails = recipients.slice(1);
  const existing = await repository.findEmployeeMailLog(client, { tenantId, idempotencyKey });
  if (existing?.email_outbox_id || existing?.sent_at) return existing;
  if (run.mode === "dry_run") {
    if (existing && (JSON.stringify(existing.recipient_emails) !== JSON.stringify(recipientEmails) ||
        JSON.stringify(existing.cc_emails) !== JSON.stringify(ccEmails))) {
      if (existing.mode !== "dry_run" || !["would_send", "skipped"].includes(existing.status)) {
        throw new Error("time_control_preview_routing_correction_requires_unsent_dry_run");
      }

      await auditService.logAuditEvent({
        client, tenantId, actorId: run.triggered_by_user_id || "system:time_control",
        actorType: run.triggered_by_user_id ? "tenant_user" : "system", actorScope: "tenant",
        moduleKey: "time_control", eventType: "tenant_config_changed",
        resourceType: "time_control_mail_log", resourceId: existing.id, outcome: "success",
        reason: "preview_recipient_routing_corrected",
        metadata: {
          run_id: run.id, hours_dataset_id: run.hours_dataset_id || null, idempotency_key: idempotencyKey,
          previous_updated_at: existing.updated_at,
          old_recipient_emails: existing.recipient_emails, old_cc_emails: existing.cc_emails,
          new_recipient_emails: recipientEmails, new_cc_emails: ccEmails,
        },
      });
    }
    return repository.upsertMailLog(client, {
      tenantId, runId: run.id, mailType: "friday_manager_summary", mode: run.mode, status: "would_send",
      recipientEmails, ccEmails, subject, bodyPreview: summaryLines, idempotencyKey,
    });
  }
  const outbox = await emailOutboxService.enqueueEmail(client, {
    tenantId,
    actorId: "system:time_control",
    templateKey: "time_control.friday_manager_summary",
    recipientEmail: recipients[0] || null,
    recipientName: "Timekontrol ledere",
    variables: { date_label: dateLabel, summary_lines: summaryLines },
    payload: { run_id: run.id, controlled_date: run.controlled_date, recipients, cc_emails: recipients.slice(1), sender: SENDER },
    sourceType: "time_control",
    sourceId: run.id,
    idempotencyKey,
  });
  return repository.upsertMailLog(client, {
    tenantId, runId: run.id, mailType: "friday_manager_summary", mode: run.mode,
    status: outbox.status === "queued" ? "queued" : "failed", recipientEmails, ccEmails,
    subject, bodyPreview: summaryLines, emailOutboxId: outbox.id, idempotencyKey,
  });
}

async function logWeeklyMail(client, { tenantId, run, result = null, settings, period, summaryResults = null }) {
  const summary = summaryResults !== null;
  const mailType = summary ? "friday_weekly_summary_v1" : "employee_weekly_reminder_v1";
  const idempotencyKey = `time_control:${tenantId}:${summary ? "leaders" : result.fitter_id}:${period.monday}:${mailType}`;
  const existing = await repository.findEmployeeMailLog(client, { tenantId, idempotencyKey });
  if (existing?.email_outbox_id || existing?.sent_at) return existing;
  const recipients = summary ? asEmailArray(settings.friday_manager_emails) : [result.employee_email];
  const ccEmails = summary ? recipients.slice(1) : asEmailArray(settings.employee_cc_emails);
  const content = summary
    ? { subject: `Timekontrol: ugens registrering ${period.monday} – ${period.friday}`, body: weekly.weeklySummary(summaryResults, period) }
    : weekly.weeklyMail({ name: result.employee_name, ...period, validHours: result.valid_hours });
  let outbox = null;
  if (run.mode === "live") {
    if (!weekly.reminderWindow(period.friday)) throw new Error("time_control_weekly_outside_reminder_window");
    outbox = await emailOutboxService.enqueueEmail(client, {
      tenantId, actorId: "system:time_control", templateKey: `time_control.${mailType}`,
      recipientEmail: recipients[0], recipientName: summary ? "DEP" : result.employee_name,
      variables: { subject: content.subject, body: content.body },
      payload: { run_id: run.id, weekly_snapshot_id: run.weekly_snapshot_id, monday: period.monday,
        friday: period.friday, cc_emails: ccEmails, sender: SENDER,
        result_bindings: (summary ? summaryResults : [result]).map(require("./timeControl.dispatch").resultBinding) },
      sourceType: "time_control", sourceId: result?.id || run.id, idempotencyKey,
    });
  }
  return repository.upsertMailLog(client, {
    tenantId, runId: run.id, resultId: result?.id || null, mailType, mode: run.mode,
    status: outbox ? outbox.status === "queued" ? "queued" : "failed" : "would_send",
    recipientEmails: recipients.slice(0, 1), ccEmails, subject: content.subject, bodyPreview: content.body,
    emailOutboxId: outbox?.id || null, idempotencyKey,
  });
}

async function auditTimeControlRun(client, { tenantId, run, outcome, reason = null }) {
  const controlledDate = typeof run.controlled_date === "string" ? normalizeIsoDate(run.controlled_date)
    : require("./timeControl.dates").getCopenhagenParts(new Date(run.controlled_date)).isoDate;
  await auditService.logAuditEvent({
    client,
    tenantId,
    actorId: run.triggered_by_user_id || "system:time_control",
    actorType: run.triggered_by_user_id ? "tenant_user" : "system",
    actorScope: "tenant",
    moduleKey: "time_control",
    eventType: outcome === "success" ? "time_control.run_completed" : "time_control.run_blocked",
    resourceType: "time_control_run",
    resourceId: run.id,
    outcome,
    reason,
    metadata: {
      control_type: run.control_type,
      controlled_date: controlledDate,
      mode: run.mode,
      sync_status: run.sync_status,
      weekly_snapshot_id: run.weekly_snapshot_id || null,
      ...(run.weekly_evaluations ? { evaluations: run.weekly_evaluations } : {}),
      ...(run.previous_evaluation ? { previous_evaluation: run.previous_evaluation } : {}),
      ...(run.operation_gates ? { operation_gates: run.operation_gates } : {}),
      ...(run.control_type === weekly.CONTROL_TYPE ? { period: weeklyPeriod(controlledDate), required_hours: 37, decision: "midday_reminder_not_final_deficit" } : {}),
    },
  });
}

async function runTimeControl(client, { tenantId, controlType, controlledDate, actorId = null, triggeredBy = "scheduler", waitForSync = true, dryRun = false }, {
  commitPreparation = async () => {},
  beginEvaluation = async () => {},
  hoursDataset = null,
  hoursDatasetId = null,
  hoursDatasetIds = null,
  allowHistoricalSnapshot = false,
  execution = null,
  captureDay = null,
} = {}) {
  const date = normalizeIsoDate(controlledDate);
  const isWeekly = controlType === weekly.CONTROL_TYPE;
  let weeklySnapshot = null;
  if (isWeekly) {
    weeklyPeriod(date);
    if (hoursDatasetId !== null) throw new Error("time_control_weekly_requires_five_dataset_ids");
    if (hoursDatasetIds !== null) weekly.validateBindings(hoursDatasetIds);
  } else if (hoursDatasetIds !== null) throw new Error("time_control_weekly_dataset_ids_require_weekly_control");
  let datasetProof = null;
  if (hoursDataset !== null) throw new Error("time_control_dataset_must_be_stored");
  if (hoursDatasetId !== null) {
    if (dryRun !== true && !execution) throw new Error("time_control_snapshot_requires_explicit_dry_run");
    if (hoursDatasetId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hoursDatasetId)) {
      throw new Error("time_control_dataset_id_invalid");
    }
  }
  if (allowHistoricalSnapshot && (!(hoursDatasetId || hoursDatasetIds) || dryRun !== true)) throw new Error("time_control_historical_snapshot_requires_stored_dry_run");
  const settings = await repository.getSettings(client, { tenantId });
  const requiredHours = isWeekly ? 37 : requiredHoursForDate(date, settings);
  const previousRun = (await client.query(
    `SELECT * FROM time_control_run WHERE tenant_id = $1 AND control_type = $2
     AND controlled_date = $3::date FOR UPDATE`, [tenantId, controlType, date]
  )).rows[0] || null;
  if (previousRun) {
    const oldResults = (await client.query("SELECT * FROM time_control_result WHERE tenant_id=$1 AND run_id=$2 ORDER BY id", [tenantId, previousRun.id])).rows;
    await auditTimeControlRun(client, { tenantId, run: { ...previousRun, controlled_date: date, previous_evaluation: {
      run: previousRun, results: oldResults, result_count: oldResults.length,
      weekly_snapshot_id: previousRun.weekly_snapshot_id || null,
    } }, outcome: "success", reason: "previous_evaluation_archived_before_rerun" });
  }
  const effectiveDryRun = dryRun || !execution;
  const storedRun = await repository.upsertRun(client, {
    tenantId, controlType, controlledDate: date, mode: effectiveDryRun ? "dry_run" : settings.mode || "dry_run",
    requiredHours, triggeredBy, triggeredByUserId: actorId,
  });
  // pg can parse SQL date as local-midnight Date; use the requested calendar date for keys.
  const run = { ...storedRun, controlled_date: date };
  const dateLabel = formatDateLabelDa(date);

  if (settings.is_enabled === false) {
    const blocked = await repository.finishRun(client, { runId: run.id, tenantId, status: "blocked", errorReason: "time_control_disabled" });
    return { run: blocked, results: [], mails: [] };
  }

  let sync;
  await commitPreparation();
  if (hoursDatasetId || hoursDatasetIds) {
    sync = { ok: true, status: "dataset_snapshot", coverage: datasetProof };
  } else {
    try {
      ({ hoursDatasetId, hoursDatasetIds } = await orchestration.prepare(client, {
        tenantId, actorId, controlledDate: date, controlType, captureDay,
      }));
      sync = { ok: true, status: "daily_capture" };
    } catch (error) {
      if (!error.message.startsWith("time_control_")) throw error;
      sync = { ok: false, status: "capture_failed", reason: compactError(error) };
    }
  }
  await beginEvaluation();
  if (!sync.ok) {
    const reason = sync.reason;
    const diagnostics = (await client.query(
      `UPDATE time_control_result SET status='data_incomplete',missing_hours=NULL,coverage_status='incomplete',
       data_quality_reason=$3,hours_dataset_id=NULL,weekly_snapshot_id=NULL,identity_snapshot=identity_snapshot-'hours_dataset'
       WHERE tenant_id=$1 AND run_id=$2 RETURNING *`, [tenantId, run.id, reason])).rows;
    await repository.bindRunDataset(client, { tenantId, runId: run.id, datasetId: null });
    if (isWeekly) await repository.bindRunWeeklySnapshot(client, { tenantId, runId: run.id, snapshotId: null });
    const mail = await logInternalErrorMail(client, { tenantId, run, settings, dateLabel, errorReason: reason });
    const blocked = await repository.finishRun(client, { runId: run.id, tenantId, status: "blocked", errorReason: reason });
    await auditTimeControlRun(client, { tenantId, run: blocked, outcome: "fail", reason });
    return { run: blocked, results: diagnostics, mails: [mail], sync };
  }
  if (isWeekly) {
    let reason = null;
    try {
      if (run.mode === "dry_run" && !allowHistoricalSnapshot &&
          require("./timeControl.dates").getCopenhagenParts(new Date()).isoDate !== date) {
        throw new Error("time_control_weekly_historical_opt_in_required");
      }
      weeklySnapshot = await weekly.loadWeeklySnapshot(client, {
        tenantId, controlledDate: date, datasetIds: hoursDatasetIds,
        freshnessMinutes: settings.sync_freshness_minutes, allowHistoricalSnapshot,
      });
      if (run.mode === "live" && !weekly.reminderWindow(date)) throw new Error("time_control_weekly_outside_reminder_window");
    } catch (error) {
      if (!error.message.startsWith("time_control_")) throw error;
      reason = compactError(error);
    }
    if (reason) {
      const previous = await client.query(
        "SELECT * FROM time_control_result WHERE tenant_id = $1 AND run_id = $2 ORDER BY id FOR UPDATE",
        [tenantId, run.id]
      );
      await auditTimeControlRun(client, {
        tenantId, run: { ...run, previous_evaluation: {
          run: previousRun,
          weekly_snapshot_id: run.weekly_snapshot_id || null,
          result_count: previous.rows.length, results: previous.rows,
        } }, outcome: "fail", reason,
      });
      const diagnostics = await client.query(
        `UPDATE time_control_result SET status = 'data_incomplete', missing_hours = NULL,
          coverage_status = 'incomplete', data_quality_reason = $3, weekly_snapshot_id = NULL,
          identity_snapshot = identity_snapshot - 'hours_dataset'
         WHERE tenant_id = $1 AND run_id = $2 RETURNING *`,
        [tenantId, run.id, reason]
      );
      await repository.bindRunWeeklySnapshot(client, { tenantId, runId: run.id, snapshotId: null });
      const mail = await logInternalErrorMail(client, { tenantId, run, settings, dateLabel, errorReason: reason });
      const blocked = await repository.finishRun(client, { runId: run.id, tenantId, status: "blocked", errorReason: reason });
      await auditTimeControlRun(client, { tenantId, run: { ...blocked, controlled_date: date }, outcome: "fail", reason });
      return { run: blocked, results: diagnostics.rows, mails: [mail], sync: { ok: false, status: "weekly_snapshot_blocked", reason } };
    }
    datasetProof = weeklySnapshot.proof;
    run.weekly_snapshot_id = weeklySnapshot.id;
    await repository.bindRunWeeklySnapshot(client, { tenantId, runId: run.id, snapshotId: weeklySnapshot.id });
    sync = { ok: true, status: "weekly_dataset_snapshot", coverage: datasetProof };
  } else if (hoursDatasetId) {
    const stored = await datasetStorage.loadHoursDataset(client, {
      tenantId, controlledDate: date, datasetId: hoursDatasetId,
      freshnessMinutes: settings.sync_freshness_minutes, allowHistoricalSnapshot,
    });
    hoursDataset = stored.dataset;
    datasetProof = stored.proof;
    sync.coverage = datasetProof;
    await repository.bindRunDataset(client, { tenantId, runId: run.id, datasetId: hoursDatasetId });
  } else throw new Error("time_control_complete_dataset_required");

  const configs = await repository.listEmployeeConfigs(client, { tenantId });
  const payCodeRules = normalizePayCodeRules(await repository.listPayCodeRules(client, { tenantId }));
  const results = [];
  const mails = [];

  for (const config of configs) {
    const resolution = classifyResolvedEmployee(config, await repository.resolveEmployeeConfig(client, { tenantId, config }));
    if (!resolution.ok) {
      results.push(await repository.upsertResult(client, {
        runId: run.id, tenantId, employeeConfigId: config.id, internalRef: config.internal_ref,
        requiredHours, validHours: 0, missingHours: null, status: "config_error", configError: resolution.configError,
        hoursDatasetId, identitySnapshot: datasetProof ? { hours_dataset: datasetProof } : {},
        weeklySnapshotId: weeklySnapshot?.id || null,
      }));
      continue;
    }
    const employee = resolution.employee;
    const scope = { tenantId, fitterId: employee.fitterId, controlledDate: date };
    const sourceRows = isWeekly ? [] : hoursCoverage.getFitterDay(hoursDataset, scope).rows;
    const weeklyEvaluation = isWeekly ? weekly.evaluateWeeklyFitter(weeklySnapshot, { tenantId, fitterId: employee.fitterId, payCodeRules }) : null;
    const summary = weeklyEvaluation?.summary || summarizeHours(sourceRows, payCodeRules);
    const coverage = datasetProof;
    const evaluation = weeklyEvaluation?.evaluation || evaluateHoursData({ summary, requiredHours, coverage });
    const result = await repository.upsertResult(client, {
      runId: run.id, tenantId, employeeConfigId: config.id, tenantUserId: employee.tenantUserId,
      fitterId: employee.fitterId, internalRef: employee.internalRef, employeeName: employee.name,
      employeeEmail: employee.email, requiredHours: evaluation.requiredHours, validHours: evaluation.validHours,
      missingHours: evaluation.missingHours, countedPayCodes: summary.countedPayCodes,
      excludedPayCodes: summary.excludedPayCodes, status: evaluation.status,
      coverageStatus: evaluation.coverageStatus, dataQualityReason: evaluation.dataQualityReason,
      unclassifiedHours: summary.unclassifiedHours, unclassifiedRows: summary.unclassifiedRows,
      identitySnapshot: { ...employee.identitySnapshot, hours_dataset: coverage },
      hoursDatasetId,
      weeklySnapshotId: weeklySnapshot?.id || null,
    });
    results.push(result);
    if (evaluation.status === "missing_hours" && triggeredBy !== "backfill" && (run.mode === "dry_run" ||
        execution && operation.scheduledStart(controlType, date, execution.startedAt) &&
        operation.dispatchWindow(controlType, date, execution.now()))) {
      mails.push(await logEmployeeMail(client, { tenantId, run, result, settings, dateLabel }));
    }
    if (evaluation.status === "weekly_reminder" && run.mode === "dry_run") {
      mails.push(await logWeeklyMail(client, { tenantId, run, result, settings, period: weeklySnapshot.period }));
    }
  }

  if (controlType === "friday_12" && run.mode === "dry_run") {
    const leaderMail = await logFridayManagerMail(client, {
      tenantId, run, settings, dateLabel,
      missingResults: results.filter((result) => result.status === "missing_hours"),
    });
    if (leaderMail) mails.push(leaderMail);
  }
  const uncertain = results.some((result) => ["config_error", "data_incomplete", "unclassified_hours"].includes(result.status));
  const reason = uncertain ? "time_control_data_or_configuration_incomplete" : null;
  const finished = await repository.finishRun(client, { runId: run.id, tenantId, status: uncertain ? "blocked" : "completed", errorReason: reason });
  run.status = finished.status;
  if (isWeekly) {
    const reminders = results.filter((result) => result.status === "weekly_reminder");
    if (run.mode === "live") {
      const gates = [];
      await operation.recordChecks(client, { tenantId, run: { ...run, triggered_by: triggeredBy }, results, execution });
      for (const result of results) {
        const gate = execution && operation.scheduledStart(controlType, date, execution.startedAt) &&
          operation.completionWindow(controlType, date, execution.now())
          ? await operation.checkGate(client, { tenantId, identity: result.identity_snapshot, friday: date,
            requireWeekly: true, snapshotId: weeklySnapshot.id })
          : { eligible: false, reason: "not_a_timely_scheduled_control" };
        gates.push({ fitter_id: result.fitter_id, ...gate });
        if (gate.eligible && result.status === "weekly_reminder" && weekly.reminderWindow(date, execution?.now())) {
          mails.push(await logWeeklyMail(client, { tenantId, run, result, settings, period: weeklySnapshot.period }));
        }
      }
      run.operation_gates = gates;
      const eligible = reminders.filter(result => gates.find(gate => gate.fitter_id === result.fitter_id)?.eligible);
      if (eligible.length && weekly.reminderWindow(date, execution?.now())) {
        mails.push(await logWeeklyMail(client, { tenantId, run, settings, period: weeklySnapshot.period, summaryResults: eligible }));
      }
      if (gates.some(gate => !gate.eligible)) {
        mails.push(await logInternalErrorMail(client, { tenantId, run, settings, dateLabel,
          errorReason: `operational_week_not_eligible:${gates.filter(gate => !gate.eligible).map(gate => `${gate.fitter_id}:${gate.reason}`).join(";")}` }));
      }
    } else if (reminders.length) mails.push(await logWeeklyMail(client, { tenantId, run, settings, period: weeklySnapshot.period, summaryResults: reminders }));
  } else {
    await operation.recordChecks(client, { tenantId, run: { ...run, triggered_by: triggeredBy }, results, execution });
  }

  if (uncertain) {
    mails.push(await logInternalErrorMail(client, { tenantId, run, settings, dateLabel, errorReason: reason }));
  }
  await auditTimeControlRun(client, { tenantId, run: { ...finished, controlled_date: date,
    operation_gates: run.operation_gates || [],
    ...(isWeekly ? { weekly_evaluations: results.map((result) => ({
      fitter_id: result.fitter_id, valid_hours: result.valid_hours, required_hours: 37,
      status: result.status, coverage_status: result.coverage_status,
      data_quality_reason: result.data_quality_reason, counted_pay_codes: result.counted_pay_codes,
      excluded_pay_codes: result.excluded_pay_codes, weekly_snapshot_id: result.weekly_snapshot_id,
    })) } : {}),
  }, outcome: uncertain ? "fail" : "success", reason });
  return { run: finished, results, mails, sync };
}

async function runTimeControlWithPool(args, { hoursDataset = null, hoursDatasetId = null, hoursDatasetIds = null, allowHistoricalSnapshot = false, captureDay = null } = {}) {
  if (hoursDataset !== null) throw new Error("time_control_dataset_must_be_stored");
  const lockInput = { ...args, controlledDate: normalizeIsoDate(args.controlledDate) };
  const client = await pool.connect();
  let transactionOpen = false;
  let runLocked = false;
  let acquisitionComplete = false;
  let failure = null;
  let discardError = null;
  try {
    // Session lock survives preparation COMMIT and is released on connection loss.
    runLocked = await repository.acquireRunLock(client, lockInput);
    acquisitionComplete = true;
    if (!runLocked) throw new Error("time_control_run_already_in_progress");
    transactionOpen = true;
    await client.query("BEGIN");
    const result = await runTimeControl(client, args, {
      hoursDataset,
      hoursDatasetId,
      hoursDatasetIds,
      allowHistoricalSnapshot,
      captureDay,
      execution: args.triggeredBy === "scheduler" ? {
        startedAt: new Date(), now: () => new Date(), controlledDate: lockInput.controlledDate, historical: allowHistoricalSnapshot,
      } : null,
      // Publish the run and sync job before waiting; keep results and mail atomic.
      commitPreparation: async () => {
        await client.query("COMMIT");
        transactionOpen = false;
      },
      beginEvaluation: async () => {
        transactionOpen = true;
        await client.query("BEGIN");
      },
    });
    await client.query("COMMIT");
    transactionOpen = false;
    return result;
  } catch (error) {
    failure = error;
    if (!acquisitionComplete) discardError = error;
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
        transactionOpen = false;
      } catch (rollbackError) {
        discardError = rollbackError;
        failure = new AggregateError([error, rollbackError], `${error.message}; ${rollbackError.message}`);
      }
    }
    throw failure;
  } finally {
    try {
      if (runLocked) await repository.releaseRunLock(client, lockInput);
    } catch (error) {
      discardError = error;
      const cleanupFailure = failure ? new AggregateError([failure, error], `${failure.message}; ${error.message}`) : error;
      client.release(discardError);
      throw cleanupFailure;
    }
    client.release(discardError || undefined);
  }
}

function approvalError(code, statusCode = 400) {
  const error = new Error(code);
  error.statusCode = statusCode;
  return error;
}

async function approveEmployeeRecipient({ tenantId, actorId, configId, fitterId, groupId, email, source, reason, expectedVersion }) {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(configId || "") || !uuidPattern.test(groupId || "") || !uuidPattern.test(actorId || "") ||
      typeof fitterId !== "string" || !fitterId.trim() ||
      !["fitter_master", "admin_override"].includes(source) ||
      typeof reason !== "string" || !reason.trim() || reason.length > 500 ||
      !Number.isInteger(expectedVersion) || expectedVersion < 0) {
    throw approvalError("time_control_approval_invalid");
  }
  const emailState = emailFailureFor(email);
  if (emailState.errorCode) throw approvalError("time_control_approval_email_invalid");
  return withTransaction(async (client) => {
    const config = await repository.lockEmployeeConfig(client, { tenantId, configId });
    if (!config) throw approvalError("time_control_employee_config_not_found", 404);
    if (config.approval_version !== expectedVersion) throw approvalError("time_control_approval_version_conflict", 409);
    if (config.approval_version > 0 && config.fitter_id !== fitterId.trim()) {
      throw approvalError("time_control_approved_identity_immutable", 409);
    }
    const target = await repository.getApprovalTarget(client, {
      tenantId, fitterId: fitterId.trim(), groupId, externalId: config.resource_group_external_id,
    });
    if (!target) throw approvalError("time_control_active_fitter_or_authoritative_membership_missing", 409);
    const sourceValue = normalizeEmail(target.email);
    if (source === "fitter_master" && emailState.email !== sourceValue) {
      throw approvalError("time_control_approval_source_mismatch", 409);
    }
    const updated = await repository.approveEmployeeEmail(client, {
      tenantId, configId, fitterId: target.fitter_id, groupId: target.group_id,
      email: emailState.email, source, sourceValue: sourceValue || "",
      actorId, reason: reason.trim(),
    });
    await auditService.logAuditEvent({
      client, tenantId, actorId, actorType: "tenant_user", actorScope: "tenant",
      moduleKey: "time_control", eventType: "time_control.employee_email_approved",
      resourceType: "time_control_employee_config", resourceId: configId, outcome: "success",
      reason: reason.trim(),
      metadata: {
        fitter_id: target.fitter_id, group_id: target.group_id,
        old_email: config.approved_email, new_email: updated.approved_email,
        old_version: config.approval_version, new_version: updated.approval_version,
        email_source: source, source_value: sourceValue,
      },
    });
    return updated;
  });
}

async function getOverview({ tenantId }) {
  const client = await pool.connect();
  try {
    return repository.getStatusOverview(client, { tenantId });
  } finally {
    client.release();
  }
}

async function getPocMailPlanForClient(client, { tenantId, batchId }) {
  const settings = await repository.lockSettings(client, { tenantId });
  if (!settings || settings.mode !== "dry_run") throw approvalError("time_control_poc_requires_dry_run", 409);
  const copies = emailListFailureFor(settings.employee_cc_emails);
  if (copies.errorCode || copies.emails.length !== 1) throw approvalError("time_control_poc_dep_identity_missing", 409);
  const depUser = await repository.findActiveTenantUserByEmail(client, { tenantId, email: copies.emails[0] });
  if (!depUser?.name) throw approvalError("time_control_poc_dep_identity_missing", 409);
  const configs = await repository.listEmployeeConfigs(client, { tenantId });
  const resolved = [];
  for (const config of configs) {
    const identity = classifyResolvedEmployee(config, await repository.resolveEmployeeConfig(client, { tenantId, config }));
    if (!identity.ok) throw approvalError(identity.configError, 409);
    resolved.push(identity.employee);
  }
  const matches = resolved.filter(employee => employee.internalRef === "MHJ");
  if (matches.length !== 1) throw approvalError("time_control_poc_mhj_mapping_missing", 409);
  return require("./timeControl.mailTest").buildPlan({
    tenantId,
    batchId,
    from: SENDER,
    settings,
    employee: matches[0],
    dep: { name: depUser.name, email: depUser.email },
    controlEmployees: resolved,
  });
}

async function setManagerRecipients({ tenantId, actorId, emails, expectedEmails, reason }) {
  const desired = emailListFailureFor(emails);
  const expected = emailListFailureFor(expectedEmails);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorId || "") ||
      desired.errorCode || !desired.emails.length || expected.errorCode ||
      !Array.isArray(expectedEmails) || typeof reason !== "string" ||
      !reason.trim() || reason.length > 500) throw approvalError("time_control_recipients_invalid");
  return withTransaction(async client => {
    const current = await repository.lockSettings(client, { tenantId });
    if (!current) throw approvalError("time_control_settings_not_found", 404);
    const previous = emailListFailureFor(current.friday_manager_emails);
    if (previous.errorCode) throw approvalError("time_control_current_recipients_invalid", 409);
    if (JSON.stringify(previous.emails) !== JSON.stringify(expected.emails)) {
      throw approvalError("time_control_recipients_conflict", 409);
    }
    const settings = await repository.updateManagerRecipients(client, { tenantId, emails: desired.emails });
    await auditService.logAuditEvent({
      client, tenantId, actorId, actorType: "tenant_user", actorScope: "tenant",
      moduleKey: "time_control", eventType: "tenant_config_changed",
      resourceType: "time_control_settings", resourceId: tenantId, outcome: "success",
      reason: reason.trim(),
      metadata: { field: "friday_manager_emails", old_emails: previous.emails, new_emails: desired.emails },
    });
    return settings;
  });
}

async function getPocMailPlan({ tenantId, batchId }) {
  return withTransaction(client => getPocMailPlanForClient(client, { tenantId, batchId }));
}

async function setMode({ tenantId, actorId, tenantSlug, mode, confirm }) {
  const normalizedMode = String(mode || "").trim().toLowerCase();
  if (!["dry_run", "live"].includes(normalizedMode)) {
    const error = new Error("time_control_mode_invalid");
    error.statusCode = 400;
    throw error;
  }
  if (normalizedMode === "live") {
    const expected = `AKTIVER:timekontrol-live:${tenantSlug}`;
    if (confirm !== expected) {
      const error = new Error(`time_control_live_confirm_required:${expected}`);
      error.statusCode = 400;
      throw error;
    }
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const settings = await repository.updateMode(client, { tenantId, actorId, mode: normalizedMode });
    await auditService.logAuditEvent({
      client,
      tenantId,
      actorId,
      actorType: "tenant_user",
      actorScope: "tenant",
      moduleKey: "time_control",
      eventType: "time_control.mode_changed",
      resourceType: "time_control_settings",
      resourceId: tenantId,
      outcome: "success",
      reason: normalizedMode,
      metadata: { mode: normalizedMode },
    });
    await client.query("COMMIT");
    return settings;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  approveEmployeeRecipient,
  SENDER,
  _test: { classifyResolvedEmployee, compactError, isFreshSyncState },
  compactError,
  getOverview,
  runTimeControl,
  runTimeControlWithPool,
  setMode,
  setManagerRecipients,
  getPocMailPlan,
  getPocMailPlanForClient,
};
