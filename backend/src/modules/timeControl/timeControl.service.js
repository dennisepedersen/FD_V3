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

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureFitterhoursFresh(client, { tenantId, actorId, run, settings, wait = true, commitPreparation }) {
  const freshnessMinutes = Number(settings.sync_freshness_minutes || 180);
  let state = await repository.getFitterhoursSyncState(client, { tenantId });
  if (isFreshSyncState(state, freshnessMinutes)) {
    await repository.updateRunSync(client, {
      runId: run.id,
      tenantId,
      syncStatus: "fresh",
      syncJobId: state.current_job_id || state.active_job_id || null,
      syncCompletedAt: state.last_successful_sync_at,
    });
    await commitPreparation();
    return { ok: true, status: "fresh", state };
  }

  const queued = await repository.queueFitterhoursSync(client, {
    tenantId,
    actorId,
    metadata: {
      source: "time_control",
      run_id: run.id,
      controlled_date: run.controlled_date,
      control_type: run.control_type,
    },
  });
  await repository.updateRunSync(client, {
    runId: run.id,
    tenantId,
    syncStatus: queued?.status === "running" ? "running" : "queued",
    syncJobId: queued?.id || null,
  });
  await commitPreparation();

  if (!wait) return { ok: false, status: "queued", state, job: queued, reason: "sync_queued_not_waited" };

  const deadline = Date.now() + Number(settings.sync_wait_seconds ?? 900) * 1000;
  while (Date.now() < deadline) {
    await sleep(5000);
    const job = queued?.id ? await repository.getSyncJob(client, { tenantId, jobId: queued.id }) : null;
    state = await repository.getFitterhoursSyncState(client, { tenantId });
    if (job?.status === "failed") {
      const reason = compactError(job.error_message || "fitterhours_sync_job_failed");
      await repository.updateRunSync(client, {
        runId: run.id, tenantId, syncStatus: "failed", syncJobId: job.id, errorReason: reason,
      });
      return { ok: false, status: "failed", state, job, reason };
    }
    if (isFreshSyncState(state, freshnessMinutes)) {
      await repository.updateRunSync(client, {
        runId: run.id,
        tenantId,
        syncStatus: "fresh",
        syncJobId: state.current_job_id || state.active_job_id || queued?.id || null,
        syncCompletedAt: state.last_successful_sync_at,
      });
      return { ok: true, status: "fresh", state, job: queued };
    }
    if (state?.endpoint_status === "failed" || state?.last_error) {
      const reason = compactError(state.last_error || "fitterhours_sync_failed");
      await repository.updateRunSync(client, {
        runId: run.id,
        tenantId,
        syncStatus: "failed",
        syncJobId: state.current_job_id || state.active_job_id || queued?.id || null,
        errorReason: reason,
      });
      return { ok: false, status: "failed", state, job: queued, reason };
    }
  }

  await repository.updateRunSync(client, {
    runId: run.id,
    tenantId,
    syncStatus: "timeout",
    syncJobId: queued?.id || null,
    errorReason: "fitterhours_sync_timeout_or_stale",
  });
  return { ok: false, status: "timeout", state, job: queued, reason: "fitterhours_sync_timeout_or_stale" };
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
    payload: { run_id: run.id, result_id: result.id, controlled_date: run.controlled_date, cc_emails: ccEmails, sender: SENDER, identity_snapshot: result.identity_snapshot },
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
  if (run.mode === "dry_run") {
    return repository.upsertMailLog(client, {
      tenantId, runId: run.id, mailType: "friday_manager_summary", mode: run.mode, status: "would_send",
      recipientEmails: recipients, subject, bodyPreview: summaryLines, idempotencyKey,
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
    status: outbox.status === "queued" ? "queued" : "failed", recipientEmails: recipients,
    subject, bodyPreview: summaryLines, emailOutboxId: outbox.id, idempotencyKey,
  });
}

async function auditTimeControlRun(client, { tenantId, run, outcome, reason = null }) {
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
      controlled_date: run.controlled_date,
      mode: run.mode,
      sync_status: run.sync_status,
    },
  });
}

async function runTimeControl(client, { tenantId, controlType, controlledDate, actorId = null, triggeredBy = "scheduler", waitForSync = true, dryRun = false }, {
  commitPreparation = async () => {},
  beginEvaluation = async () => {},
  hoursDataset = null,
  hoursDatasetId = null,
  allowHistoricalSnapshot = false,
} = {}) {
  const date = normalizeIsoDate(controlledDate);
  let datasetProof = null;
  if (hoursDataset !== null) throw new Error("time_control_dataset_must_be_stored");
  if (hoursDatasetId !== null) {
    if (dryRun !== true) throw new Error("time_control_snapshot_requires_explicit_dry_run");
    if (hoursDatasetId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hoursDatasetId)) {
      throw new Error("time_control_dataset_id_invalid");
    }
  }
  if (allowHistoricalSnapshot && (!hoursDatasetId || dryRun !== true)) throw new Error("time_control_historical_snapshot_requires_stored_dry_run");
  const settings = await repository.getSettings(client, { tenantId });
  const requiredHours = requiredHoursForDate(date, settings);
  const storedRun = await repository.upsertRun(client, {
    tenantId, controlType, controlledDate: date, mode: dryRun ? "dry_run" : settings.mode || "dry_run",
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
  if (datasetProof || hoursDatasetId) {
    await commitPreparation();
    sync = { ok: true, status: "dataset_snapshot", coverage: datasetProof };
  } else {
    sync = await ensureFitterhoursFresh(client, { tenantId, actorId, run, settings, wait: waitForSync, commitPreparation });
  }
  await beginEvaluation();
  if (hoursDatasetId) {
    const stored = await datasetStorage.loadHoursDataset(client, {
      tenantId, controlledDate: date, datasetId: hoursDatasetId,
      freshnessMinutes: settings.sync_freshness_minutes, allowHistoricalSnapshot,
    });
    hoursDataset = stored.dataset;
    datasetProof = stored.proof;
    sync.coverage = datasetProof;
    await repository.bindRunDataset(client, { tenantId, runId: run.id, datasetId: hoursDatasetId });
  } else if (storedRun.hours_dataset_id) {
    await repository.bindRunDataset(client, { tenantId, runId: run.id, datasetId: null });
  }
  if (!sync.ok) {
    const reason = sync.reason || "fitterhours_sync_not_fresh";
    const mail = await logInternalErrorMail(client, { tenantId, run, settings, dateLabel, errorReason: reason });
    const blocked = await repository.finishRun(client, { runId: run.id, tenantId, status: "blocked", errorReason: reason });
    await auditTimeControlRun(client, { tenantId, run: blocked, outcome: "fail", reason });
    return { run: blocked, results: [], mails: [mail], sync };
  }

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
      }));
      continue;
    }
    const employee = resolution.employee;
    const scope = { tenantId, fitterId: employee.fitterId, controlledDate: date };
    const sourceRows = datasetProof
      ? hoursCoverage.getFitterDay(hoursDataset, scope).rows
      : await repository.listHoursForFitterDate(client, scope);
    const summary = summarizeHours(sourceRows, payCodeRules);
    const coverage = datasetProof || await repository.getHoursPeriodCoverage(client, scope);
    const evaluation = evaluateHoursData({ summary, requiredHours, coverage });
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
    });
    results.push(result);
    if (evaluation.status === "missing_hours") {
      mails.push(await logEmployeeMail(client, { tenantId, run, result, settings, dateLabel }));
    }
  }

  if (controlType === "friday_12") {
    const leaderMail = await logFridayManagerMail(client, {
      tenantId, run, settings, dateLabel,
      missingResults: results.filter((result) => result.status === "missing_hours"),
    });
    if (leaderMail) mails.push(leaderMail);
  }

  const uncertain = results.some((result) => ["config_error", "data_incomplete", "unclassified_hours"].includes(result.status));
  const reason = uncertain ? "time_control_data_or_configuration_incomplete" : null;
  if (uncertain) {
    mails.push(await logInternalErrorMail(client, { tenantId, run, settings, dateLabel, errorReason: reason }));
  }
  const finished = await repository.finishRun(client, { runId: run.id, tenantId, status: uncertain ? "blocked" : "completed", errorReason: reason });
  await auditTimeControlRun(client, { tenantId, run: finished, outcome: uncertain ? "fail" : "success", reason });
  return { run: finished, results, mails, sync };
}

async function runTimeControlWithPool(args, { hoursDataset = null, hoursDatasetId = null, allowHistoricalSnapshot = false } = {}) {
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
      allowHistoricalSnapshot,
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
};
