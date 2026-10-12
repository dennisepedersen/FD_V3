"use strict";

const DEFAULT_SETTINGS = Object.freeze({
  is_enabled: true,
  mode: "dry_run",
  timezone: "Europe/Copenhagen",
  resource_group_external_id: "61",
  monday_thursday_required_hours: "7.50",
  friday_required_hours: "7.00",
  sync_freshness_minutes: 180,
  sync_wait_seconds: 900,
  employee_cc_emails: ["dep@hoyrup-clemmensen.dk"],
  internal_error_emails: ["dep@hoyrup-clemmensen.dk"],
  friday_manager_emails: ["dep@hoyrup-clemmensen.dk", "LKE@hoyrup-clemmensen.dk"],
});

async function getSettings(client, { tenantId }) {
  const { rows } = await client.query(
    `
      SELECT *
      FROM time_control_settings
      WHERE tenant_id = $1
      LIMIT 1
    `,
    [tenantId]
  );
  return rows[0] || { tenant_id: tenantId, ...DEFAULT_SETTINGS };
}

async function updateMode(client, { tenantId, actorId, mode }) {
  const { rows } = await client.query(
    `
      INSERT INTO time_control_settings (
        tenant_id,
        mode,
        live_enabled_at,
        live_enabled_by_user_id
      )
      VALUES (
        $1,
        $2,
        CASE WHEN $2 = 'live' THEN now() ELSE NULL END,
        CASE WHEN $2 = 'live' THEN $3 ELSE NULL END
      )
      ON CONFLICT (tenant_id)
      DO UPDATE SET
        mode = EXCLUDED.mode,
        live_enabled_at = CASE WHEN EXCLUDED.mode = 'live' THEN COALESCE(time_control_settings.live_enabled_at, now()) ELSE NULL END,
        live_enabled_by_user_id = CASE WHEN EXCLUDED.mode = 'live' THEN $3 ELSE NULL END
      RETURNING *
    `,
    [tenantId, mode, actorId || null]
  );
  return rows[0];
}

async function listPayCodeRules(client, { tenantId }) {
  const { rows } = await client.query(
    `
      SELECT pay_code, counts_as_valid_hours, label
      FROM time_control_pay_code_rule
      WHERE tenant_id = $1
      ORDER BY pay_code ASC
      FOR SHARE
    `,
    [tenantId]
  );
  return rows;
}

async function listEmployeeConfigs(client, { tenantId }) {
  const { rows } = await client.query(
    `
      SELECT *
      FROM time_control_employee_config
      WHERE tenant_id = $1
        AND is_enabled = true
      ORDER BY internal_ref ASC
    `,
    [tenantId]
  );
  return rows;
}

async function resolveEmployeeConfig(client, { tenantId, config }) {
  const { rows } = await client.query(
    `
      SELECT
        tec.id AS employee_config_id,
        tec.internal_ref,
        tec.resource_group_external_id,
        tec.approved_email,
        tec.email_source,
        tec.email_source_value,
        tec.email_approved_at,
        tec.email_approved_by_user_id,
        tec.approval_version,
        f.tenant_user_id,
        f.fitter_id,
        f.name AS fitter_name,
        f.email AS fitter_email,
        f.username AS fitter_username,
        f.identity_link_status,
        f.identity_link_method,
        f.is_active_derived,
        rg.id AS resource_group_id,
        rg.name AS resource_group_name
      FROM time_control_employee_config tec
      JOIN fitter f
        ON f.tenant_id = tec.tenant_id
       AND f.fitter_id = tec.fitter_id
      JOIN resource_group_members rgm
        ON rgm.tenant_id = f.tenant_id
       AND rgm.fitter_id = f.fitter_id
      JOIN resource_groups rg
        ON rg.tenant_id = rgm.tenant_id
       AND rg.id = rgm.group_id
       AND rg.id = tec.approved_group_id
       AND rg.status = 'active'
       AND rg.external_source = 'ekomplet'
       AND rg.external_id = tec.resource_group_external_id
      WHERE tec.tenant_id = $1
        AND tec.id = $2
        AND tec.is_enabled = true
        AND f.is_active_derived = true
      ORDER BY f.updated_at DESC, f.fitter_id ASC
      LIMIT 2
      FOR SHARE OF tec, f, rgm, rg
    `,
    [tenantId, config.id]
  );
  return rows;
}

async function lockEmployeeConfig(client, { tenantId, configId }) {
  const { rows } = await client.query(
    "SELECT * FROM time_control_employee_config WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
    [tenantId, configId]
  );
  return rows[0] || null;
}

async function getApprovalTarget(client, { tenantId, fitterId, groupId, externalId }) {
  const { rows } = await client.query(
    `SELECT f.fitter_id, f.email, rg.id AS group_id
     FROM fitter f
     JOIN resource_group_members rgm ON rgm.tenant_id = f.tenant_id AND rgm.fitter_id = f.fitter_id
     JOIN resource_groups rg ON rg.tenant_id = rgm.tenant_id AND rg.id = rgm.group_id
     WHERE f.tenant_id = $1 AND f.fitter_id = $2 AND f.is_active_derived = true
       AND rg.id = $3 AND rg.status = 'active'
       AND rg.external_source = 'ekomplet' AND rg.external_id = $4
     FOR SHARE OF f, rgm, rg`,
    [tenantId, fitterId, groupId, externalId]
  );
  return rows[0] || null;
}

async function approveEmployeeEmail(client, {
  tenantId, configId, fitterId, groupId, email, source, sourceValue, actorId, reason,
}) {
  const { rows } = await client.query(
    `UPDATE time_control_employee_config
     SET fitter_id = $3, approved_group_id = $4, approved_email = $5,
         email_source = $6, email_source_value = $7, email_approved_by_user_id = $8,
         email_approved_at = now(), approval_reason = $9, approval_version = approval_version + 1
     WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    [tenantId, configId, fitterId, groupId, email, source, sourceValue, actorId, reason]
  );
  return rows[0];
}

async function findEmployeeMailLog(client, { tenantId, idempotencyKey }) {
  const { rows } = await client.query(
    "SELECT * FROM time_control_mail_log WHERE tenant_id = $1 AND idempotency_key = $2",
    [tenantId, idempotencyKey]
  );
  return rows[0] || null;
}

async function listHoursForFitterDate(client, { tenantId, fitterId, controlledDate }) {
  const { rows } = await client.query(
    `
      SELECT
        fh.source_key,
        fh.fitter_category_id,
        COALESCE(NULLIF(btrim(fh.fitter_category_reference), ''), fc.reference) AS fitter_category_reference,
        fh.hours,
        fh.quantity
      FROM fitter_hour fh
      LEFT JOIN fitter_category fc
        ON fc.tenant_id = fh.tenant_id
       AND fc.fitter_category_id = fh.fitter_category_id
      WHERE fh.tenant_id = $1
        AND fh.fitter_id = $2
        AND fh.work_date >= $3::date
        AND fh.work_date < ($3::date + interval '1 day')
    `,
    [tenantId, fitterId, controlledDate]
  );
  return rows;
}

async function getHoursPeriodCoverage() {
  // Existing imports filter active projects and produce no period coverage proof.
  return { status: "incomplete", reason: "period_coverage_not_verified:synced_rows_only" };
}

async function getSyncJob(client, { tenantId, jobId }) {
  const { rows } = await client.query(
    "SELECT id, status, error_message FROM sync_job WHERE tenant_id = $1 AND id = $2",
    [tenantId, jobId]
  );
  return rows[0] || null;
}

function runLockKey({ tenantId, controlType, controlledDate }) {
  if (controlType === "friday_weekly_v1") {
    controlledDate = require("./timeControl.dates").weeklyPeriod(controlledDate).monday;
  }
  return `time_control:${tenantId}:${controlType}:${controlledDate}`;
}

async function acquireRunLock(client, input) {
  const { rows } = await client.query(
    "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
    [runLockKey(input)]
  );
  if (typeof rows[0]?.locked !== "boolean") throw new Error("time_control_run_lock_acquisition_uncertain");
  return rows[0].locked;
}

async function releaseRunLock(client, input) {
  const { rows } = await client.query(
    "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked",
    [runLockKey(input)]
  );
  if (rows[0]?.unlocked !== true) throw new Error("time_control_run_lock_release_failed");
}

async function getFitterhoursSyncState(client, { tenantId }) {
  const { rows } = await client.query(
    `
      WITH active_job AS (
        SELECT id, status, created_at, started_at, updated_at, finished_at
        FROM sync_job
        WHERE tenant_id = $1
          AND endpoint_key = 'fitterhours'
          AND status IN ('queued', 'running')
        ORDER BY created_at ASC
        LIMIT 1
      )
      SELECT
        ses.endpoint_key,
        ses.status AS endpoint_status,
        ses.last_successful_sync_at,
        ses.last_error,
        ses.pending_backlog_count,
        ses.failed_page_count,
        ses.current_job_id,
        aj.id AS active_job_id,
        aj.status AS active_job_status,
        aj.updated_at AS active_job_updated_at
      FROM sync_endpoint_state ses
      LEFT JOIN active_job aj ON true
      WHERE ses.tenant_id = $1
        AND ses.endpoint_key = 'fitterhours'
      LIMIT 1
    `,
    [tenantId]
  );
  return rows[0] || null;
}

async function queueFitterhoursSync(client, { tenantId, actorId = null, metadata = {} }) {
  const { rows } = await client.query(
    `
      WITH existing AS (
        SELECT id, status, true AS reused
        FROM sync_job
        WHERE tenant_id = $1
          AND endpoint_key = 'fitterhours'
          AND status IN ('queued', 'running')
        ORDER BY created_at ASC
        LIMIT 1
      ),
      inserted AS (
        INSERT INTO sync_job (
          tenant_id,
          type,
          status,
          endpoint_key,
          requested_by_user_id,
          metadata,
          rows_processed,
          pages_processed
        )
        SELECT $1, 'manual_full_resync', 'queued', 'fitterhours', $2, $3::jsonb, 0, 0
        WHERE NOT EXISTS (SELECT 1 FROM existing)
        RETURNING id, status, false AS reused
      )
      SELECT * FROM inserted
      UNION ALL
      SELECT * FROM existing
      LIMIT 1
    `,
    [tenantId, actorId, JSON.stringify(metadata || {})]
  );
  return rows[0] || null;
}

async function upsertRun(client, {
  tenantId,
  controlType,
  controlledDate,
  mode,
  requiredHours,
  triggeredBy,
  triggeredByUserId = null,
}) {
  const { rows } = await client.query(
    `
      INSERT INTO time_control_run (
        tenant_id,
        control_type,
        controlled_date,
        mode,
        status,
        required_hours,
        triggered_by,
        triggered_by_user_id,
        started_at,
        finished_at,
        error_reason
      )
      VALUES ($1, $2, $3::date, $4, 'running', $5, $6, $7, now(), NULL, NULL)
      ON CONFLICT (tenant_id, control_type, controlled_date)
      DO UPDATE SET
        mode = EXCLUDED.mode,
        status = 'running',
        required_hours = EXCLUDED.required_hours,
        triggered_by = EXCLUDED.triggered_by,
        triggered_by_user_id = EXCLUDED.triggered_by_user_id,
        started_at = now(),
        finished_at = NULL,
        error_reason = NULL
      RETURNING *
    `,
    [tenantId, controlType, controlledDate, mode, requiredHours, triggeredBy, triggeredByUserId]
  );
  return rows[0];
}

async function updateRunSync(client, { runId, tenantId, syncStatus, syncJobId = null, syncCompletedAt = null, errorReason = null }) {
  const { rows } = await client.query(
    `
      UPDATE time_control_run
      SET
        sync_status = $3,
        sync_job_id = COALESCE($4, sync_job_id),
        sync_completed_at = COALESCE($5, sync_completed_at),
        sync_checked_at = now(),
        error_reason = $6
      WHERE id = $1
        AND tenant_id = $2
      RETURNING *
    `,
    [runId, tenantId, syncStatus, syncJobId, syncCompletedAt, errorReason]
  );
  return rows[0] || null;
}

async function finishRun(client, { runId, tenantId, status, errorReason = null }) {
  const { rows } = await client.query(
    `
      UPDATE time_control_run
      SET status = $3,
          error_reason = $4,
          finished_at = now()
      WHERE id = $1
        AND tenant_id = $2
      RETURNING *
    `,
    [runId, tenantId, status, errorReason]
  );
  return rows[0] || null;
}

async function upsertResult(client, {
  runId,
  tenantId,
  employeeConfigId,
  tenantUserId = null,
  fitterId = null,
  internalRef,
  employeeName = null,
  employeeEmail = null,
  requiredHours,
  validHours,
  missingHours,
  countedPayCodes = [],
  excludedPayCodes = [],
  status,
  configError = null,
  coverageStatus = "incomplete",
  dataQualityReason = null,
  unclassifiedHours = 0,
  unclassifiedRows = [],
  identitySnapshot = {},
  hoursDatasetId = null,
  weeklySnapshotId = null,
}) {
  const { rows } = await client.query(
    `
      INSERT INTO time_control_result (
        run_id,
        tenant_id,
        employee_config_id,
        tenant_user_id,
        fitter_id,
        internal_ref,
        employee_name,
        employee_email,
        required_hours,
        valid_hours,
        missing_hours,
        counted_pay_codes,
        excluded_pay_codes,
        status,
        config_error,
        coverage_status,
        data_quality_reason,
        unclassified_hours,
        unclassified_rows,
        identity_snapshot,
        hours_dataset_id,
        weekly_snapshot_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15, $16, $17, $18, $19::jsonb, $20::jsonb, $21, $22)
      ON CONFLICT (run_id, employee_config_id)
      DO UPDATE SET
        tenant_user_id = EXCLUDED.tenant_user_id,
        fitter_id = EXCLUDED.fitter_id,
        internal_ref = EXCLUDED.internal_ref,
        employee_name = EXCLUDED.employee_name,
        employee_email = EXCLUDED.employee_email,
        required_hours = EXCLUDED.required_hours,
        valid_hours = EXCLUDED.valid_hours,
        missing_hours = EXCLUDED.missing_hours,
        counted_pay_codes = EXCLUDED.counted_pay_codes,
        excluded_pay_codes = EXCLUDED.excluded_pay_codes,
        status = EXCLUDED.status,
        config_error = EXCLUDED.config_error,
        coverage_status = EXCLUDED.coverage_status,
        data_quality_reason = EXCLUDED.data_quality_reason,
        unclassified_hours = EXCLUDED.unclassified_hours,
        unclassified_rows = EXCLUDED.unclassified_rows,
        identity_snapshot = EXCLUDED.identity_snapshot,
        hours_dataset_id = EXCLUDED.hours_dataset_id,
        weekly_snapshot_id = EXCLUDED.weekly_snapshot_id
      RETURNING *
    `,
    [
      runId,
      tenantId,
      employeeConfigId,
      tenantUserId,
      fitterId,
      internalRef,
      employeeName,
      employeeEmail,
      requiredHours,
      validHours,
      missingHours,
      JSON.stringify(countedPayCodes || []),
      JSON.stringify(excludedPayCodes || []),
      status,
      configError,
      coverageStatus,
      dataQualityReason,
      unclassifiedHours,
      JSON.stringify(unclassifiedRows),
      JSON.stringify(identitySnapshot),
      hoursDatasetId,
      weeklySnapshotId,
    ]
  );
  return rows[0];
}

async function bindRunWeeklySnapshot(client, { tenantId, runId, snapshotId }) {
  await client.query(
    "UPDATE time_control_run SET weekly_snapshot_id = $3 WHERE tenant_id = $1 AND id = $2 AND control_type = 'friday_weekly_v1'",
    [tenantId, runId, snapshotId]
  );
  await client.query(
    `UPDATE time_control_mail_log SET status = 'skipped'
     WHERE tenant_id = $1 AND run_id = $2 AND mode = 'dry_run' AND status = 'would_send'
       AND email_outbox_id IS NULL AND sent_at IS NULL`,
    [tenantId, runId]
  );
}

async function bindRunDataset(client, { tenantId, runId, datasetId }) {
  await client.query(
    "UPDATE time_control_run SET hours_dataset_id = $3 WHERE tenant_id = $1 AND id = $2",
    [tenantId, runId, datasetId]
  );
  await client.query(
    `UPDATE time_control_mail_log SET status = 'skipped'
     WHERE tenant_id = $1 AND run_id = $2 AND mode = 'dry_run' AND status = 'would_send'
       AND email_outbox_id IS NULL`,
    [tenantId, runId]
  );
}

async function upsertMailLog(client, {
  tenantId,
  runId,
  resultId = null,
  mailType,
  mode,
  status,
  recipientEmails,
  ccEmails = [],
  subject,
  bodyPreview,
  emailOutboxId = null,
  idempotencyKey,
  sentAt = null,
}) {
  const { rows } = await client.query(
    `
      INSERT INTO time_control_mail_log (
        tenant_id,
        run_id,
        result_id,
        mail_type,
        mode,
        status,
        recipient_emails,
        cc_emails,
        subject,
        body_preview,
        email_outbox_id,
        idempotency_key,
        sent_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13)
      ON CONFLICT (tenant_id, idempotency_key)
      DO UPDATE SET
        run_id = EXCLUDED.run_id,
        result_id = EXCLUDED.result_id,
        mode = EXCLUDED.mode,
        status = EXCLUDED.status,
        recipient_emails = EXCLUDED.recipient_emails,
        cc_emails = EXCLUDED.cc_emails,
        subject = EXCLUDED.subject,
        body_preview = EXCLUDED.body_preview,
        email_outbox_id = COALESCE(EXCLUDED.email_outbox_id, time_control_mail_log.email_outbox_id),
        sent_at = COALESCE(EXCLUDED.sent_at, time_control_mail_log.sent_at)
      RETURNING *
    `,
    [
      tenantId,
      runId,
      resultId,
      mailType,
      mode,
      status,
      JSON.stringify(recipientEmails || []),
      JSON.stringify(ccEmails || []),
      subject,
      bodyPreview,
      emailOutboxId,
      idempotencyKey,
      sentAt,
    ]
  );
  return rows[0];
}

async function getStatusOverview(client, { tenantId }) {
  const [settings, runs, results, mails, sync, unfinishedRuns] = await Promise.all([
    getSettings(client, { tenantId }),
    client.query(
      `
        SELECT *
        FROM time_control_run
        WHERE tenant_id = $1
        ORDER BY started_at DESC
        LIMIT 10
      `,
      [tenantId]
    ),
    client.query(
      `
        SELECT r.*, run.control_type, run.controlled_date, s.monday AS week_monday,
          s.proof_json AS weekly_proof,
          CASE WHEN r.weekly_snapshot_id IS NOT NULL THEN
            (SELECT count(*) = 5 AND bool_and(hd.dataset_id = sd.dataset_id AND hd.invalidated_at IS NULL)
             FROM time_control_weekly_snapshot_day sd
             LEFT JOIN time_control_hours_dataset_head hd
               ON hd.tenant_id = sd.tenant_id AND hd.controlled_date = sd.controlled_date
             WHERE sd.snapshot_id = r.weekly_snapshot_id AND sd.tenant_id = r.tenant_id)
          WHEN r.hours_dataset_id IS NULL THEN NULL
          ELSE COALESCE(h.dataset_id = r.hours_dataset_id AND h.invalidated_at IS NULL, false)
          END AS dataset_is_current
        FROM time_control_result r
        JOIN time_control_run run
          ON run.id = r.run_id
         AND run.tenant_id = r.tenant_id
        LEFT JOIN time_control_hours_dataset_head h
          ON h.tenant_id = r.tenant_id AND h.controlled_date = run.controlled_date
        LEFT JOIN time_control_weekly_snapshot s
          ON s.id = r.weekly_snapshot_id AND s.tenant_id = r.tenant_id
        WHERE r.tenant_id = $1
        ORDER BY run.started_at DESC, r.internal_ref ASC
        LIMIT 80
      `,
      [tenantId]
    ),
    client.query(
      `
        SELECT m.*
        FROM time_control_mail_log m
        JOIN time_control_run run
          ON run.id = m.run_id
         AND run.tenant_id = m.tenant_id
        WHERE m.tenant_id = $1
        ORDER BY run.started_at DESC, m.created_at DESC
        LIMIT 80
      `,
      [tenantId]
    ),
    getFitterhoursSyncState(client, { tenantId }),
    client.query(
      `
        SELECT *
        FROM time_control_run
        WHERE tenant_id = $1
          AND status = 'running'
          AND finished_at IS NULL
        ORDER BY started_at ASC
        LIMIT 80
      `,
      [tenantId]
    ),
  ]);

  return {
    settings,
    latest_sync: sync,
    runs: runs.rows,
    unfinished_runs: unfinishedRuns.rows,
    results: results.rows,
    mails: mails.rows,
  };
}

module.exports = {
  bindRunWeeklySnapshot,
  acquireRunLock,
  approveEmployeeEmail,
  bindRunDataset,
  DEFAULT_SETTINGS,
  finishRun,
  findEmployeeMailLog,
  getApprovalTarget,
  getFitterhoursSyncState,
  getHoursPeriodCoverage,
  getSyncJob,
  getSettings,
  getStatusOverview,
  listEmployeeConfigs,
  listHoursForFitterDate,
  listPayCodeRules,
  lockEmployeeConfig,
  queueFitterhoursSync,
  releaseRunLock,
  resolveEmployeeConfig,
  updateMode,
  updateRunSync,
  upsertMailLog,
  upsertResult,
  upsertRun,
};
