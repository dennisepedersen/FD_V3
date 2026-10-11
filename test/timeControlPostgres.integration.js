"use strict";

const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const enabled = process.env.FIELD_DESK_LOCAL_PG_TEST === "1";
const DAY = "2026-03-27";
const DEFAULT_DATABASE_URL = "postgres://tc_validation@127.0.0.1:55432/fielddesk_tc_validation";

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function projectedRows(rows) {
  return rows.map((row) => ({
    id: String(row.id),
    date: row.date,
    hours: row.hours,
    fitterId: row.fitterId,
    categoryId: row.categoryId ?? null,
    categoryReference: row.categoryReference ?? null,
    projectId: row.projectId,
    projectReference: row.projectReference ?? null,
  }));
}

function updatePassHashes(evidence) {
  const rows = projectedRows(evidence.rows);
  const orderedIdsHash = hash(rows.map((row) => row.id));
  const canonicalRowsHash = hash(
    [...rows].sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }))
  );
  evidence.passes = evidence.passes.map((pass) => ({
    ...pass,
    summary: { ...pass.summary, orderedIdsHash, canonicalRowsHash },
  }));
  return evidence;
}

function makePages(total, pageSize) {
  const pageCount = Math.ceil(total / pageSize);
  return Array.from({ length: pageCount }, (_, index) => {
    const page = index + 1;
    const rowCount = Math.min(pageSize, total - index * pageSize);
    return {
      page,
      currentPage: page,
      nextPage: page < pageCount ? page + 1 : null,
      rowCount,
      total,
      status: 200,
      hasErrors: false,
      errorCount: 0,
    };
  });
}

function syntheticEvidence(tenantId) {
  const rows = Array.from({ length: 301 }, (_, index) => ({
    id: String(317000 + index),
    date: `${DAY}T00:00:00`,
    hours: 0.5,
    fitterId: 24,
    categoryId: 291,
    categoryReference: "1236",
    projectId: 23050,
    projectReference: "12325-026",
  }));
  rows[0] = { ...rows[0], id: "318942", hours: 3 };
  const pages = makePages(rows.length, 10);
  const projected = projectedRows(rows);
  const orderedIdsHash = hash(projected.map((row) => row.id));
  const canonicalRowsHash = hash(
    [...projected].sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }))
  );
  return {
    tenantId,
    endpoint: "/api/v4/paginatedfitterhours",
    fromDate: DAY,
    toDate: DAY,
    pageSize: 10,
    expectedTotal: rows.length,
    rows,
    passes: [1, 2].map((pass) => ({
      summary: { pass, orderedIdsHash, canonicalRowsHash },
      pageEvidence: pages,
    })),
    evidence: {
      closedProjectControl: {
        id: "318942",
        fitterId: 24,
        projectId: 23050,
        hours: 3,
        isClosed: true,
      },
    },
  };
}

function loadEvidence(tenantId) {
  const evidencePath = process.env.FIELDDESK_TC_EVIDENCE_PATH;
  if (!evidencePath) return syntheticEvidence(tenantId);
  const source = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  return {
    tenantId,
    endpoint: source.endpoint,
    fromDate: source.fromDate,
    toDate: source.toDate,
    pageSize: source.pageSize,
    expectedTotal: source.expectedTotal,
    rows: source.rows,
    passes: source.passes,
    evidence: source.evidence,
  };
}

function runTimeControlCli({ tenantSlug, controlledDate, controlType, datasetId }) {
  const root = path.resolve(__dirname, "..");
  const args = [
    "--tenant", tenantSlug,
    "--date", controlledDate,
    "--control-type", controlType,
    "--no-wait-sync",
    "--dry-run",
    "--hours-dataset-id", datasetId,
    "--historical-snapshot",
  ];
  const env = {
    ...process.env,
    DATABASE_URL: DEFAULT_DATABASE_URL,
    NODE_ENV: "test",
    JWT_SECRET: process.env.JWT_SECRET,
    ROOT_DOMAIN: "example.test",
    MAIL_PROVIDER: "disabled",
    MAIL_API_KEY: "",
  };
  console.log(`node backend/scripts/run_time_control.js ${args.join(" ")}`);
  const stdout = execFileSync(process.execPath, [
    path.join(root, "backend", "scripts", "run_time_control.js"),
    ...args,
  ], { cwd: root, env, encoding: "utf8" });
  const result = JSON.parse(stdout.trim());
  console.log(JSON.stringify({
    cli: "run_time_control.js",
    control_type: result.control_type,
    controlled_date: result.controlled_date,
    mode: result.mode,
    status: result.status,
    result_count: result.result_count,
    mail_count: result.mail_count,
  }));
  return result;
}

function safeDatabaseUrl() {
  const value = process.env.FIELDDESK_TIME_CONTROL_TEST_DATABASE_URL || DEFAULT_DATABASE_URL;
  const url = new URL(value);
  assert.equal(url.protocol, "postgres:");
  assert.equal(url.hostname, "127.0.0.1", "integration tests must use IPv4 loopback only");
  assert.equal(url.port, "55432", "integration tests must use the disposable local cluster port");
  assert.equal(url.pathname, "/fielddesk_tc_validation", "integration tests must use their dedicated database");
  assert.equal(decodeURIComponent(url.username), "tc_validation");
  assert.equal(url.password, "", "the disposable loopback cluster uses no reusable credential");
  return value;
}

test("Timekontrol storage and dry-run service against disposable PostgreSQL 17", {
  skip: !enabled,
}, async () => {
  const connectionString = safeDatabaseUrl();
  process.env.DATABASE_URL = connectionString;
  process.env.NODE_ENV = "test";
  const ephemeralSigningKey = randomUUID();
  process.env.JWT_SECRET = ephemeralSigningKey;
  process.env.ROOT_DOMAIN = "example.test";
  process.env.MAIL_PROVIDER = "disabled";
  process.env.MAIL_API_KEY = "";

  const { Pool } = require("../backend/node_modules/pg");
  const pool = new Pool({ connectionString, ssl: false, max: 4 });
  let appPool;
  try {
    const { rows: [connection] } = await pool.query(
      "SELECT current_database() AS database, host(inet_server_addr()) AS address, inet_server_port() AS port, version() AS version"
    );
    assert.equal(connection.database, "fielddesk_tc_validation");
    assert.equal(connection.address, "127.0.0.1");
    assert.equal(connection.port, 55432);
    assert.match(connection.version, /^PostgreSQL 17\./);

    const coverage = require("../backend/src/modules/timeControl/timeControl.coverage");
    const storage = require("../backend/src/modules/timeControl/timeControl.dataset");
    const repository = require("../backend/src/modules/timeControl/timeControl.repository");
    const service = require("../backend/src/modules/timeControl/timeControl.service");
    appPool = require("../backend/src/db/pool");

    const { rows: [tenant] } = await pool.query(
      "SELECT id, slug FROM tenant WHERE slug = 'hoyrup-clemmensen'"
    );
    assert.ok(tenant, "0053 must be applied against the exact local target tenant slug");
    const tenantId = tenant.id;
    let { rows: [controlTenant] } = await pool.query(
      "SELECT id, slug FROM tenant WHERE slug = 'timecontrol-migration-control-fixture'"
    );
    if (!controlTenant) {
      ({ rows: [controlTenant] } = await pool.query(
        `INSERT INTO tenant (id, slug, name, status)
         VALUES ($1, 'timecontrol-migration-control-fixture', 'Timekontrol local migration control', 'active')
         RETURNING id, slug`,
        [randomUUID()]
      ));
    }
    assert.equal(controlTenant.slug, "timecontrol-migration-control-fixture");

    const legacyRules = [
      ["3300", true, "fixture legacy 3300"],
      ["1220", true, "fixture legacy 1220"],
      ["9010", true, "fixture legacy 9010"],
      ["9012", true, "fixture legacy 9012"],
      ["1246", false, "fixture legacy 1246"],
      ["9300", false, "pre-migration conflicting 9300"],
    ];
    for (const [payCode, valid, label] of legacyRules) {
      await pool.query(
        `INSERT INTO time_control_pay_code_rule (tenant_id, pay_code, counts_as_valid_hours, label)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, pay_code) DO UPDATE
           SET counts_as_valid_hours = EXCLUDED.counts_as_valid_hours, label = EXCLUDED.label`,
        [tenantId, payCode, valid, label]
      );
    }
    await pool.query(
      `INSERT INTO time_control_pay_code_rule (tenant_id, pay_code, counts_as_valid_hours, label)
       VALUES ($1, '9300', false, 'control tenant rule must remain unchanged')
       ON CONFLICT (tenant_id, pay_code) DO UPDATE
         SET counts_as_valid_hours = false, label = EXCLUDED.label`,
      [controlTenant.id]
    );
    const migrationSql = fs.readFileSync(
      path.join(__dirname, "..", "migrations", "0053_time_control_approved_pay_codes.sql"),
      "utf8"
    );
    const legacyBefore = await pool.query(
      `SELECT pay_code, counts_as_valid_hours, label
       FROM time_control_pay_code_rule
       WHERE tenant_id = $1 AND pay_code = ANY($2::text[])
       ORDER BY pay_code`,
      [tenantId, ["3300", "1220", "9010", "9012", "1246"]]
    );
    await pool.query(migrationSql);
    await pool.query(migrationSql);
    const targetRules = await pool.query(
      `SELECT pay_code, counts_as_valid_hours, label
       FROM time_control_pay_code_rule WHERE tenant_id = $1 ORDER BY pay_code`,
      [tenantId]
    );
    assert.equal(targetRules.rows.length, 15, "0053 should add ten rules while preserving five target legacy rules");
    const targetRuleMap = new Map(targetRules.rows.map((rule) => [rule.pay_code, rule]));
    for (const payCode of ["9000", "1195", "9315", "9200", "9300", "9320", "1199", "9022"]) {
      assert.equal(targetRuleMap.get(payCode)?.counts_as_valid_hours, true, `${payCode} is a valid-hours rule`);
    }
    for (const payCode of ["9070", "1244"]) {
      assert.equal(targetRuleMap.get(payCode)?.counts_as_valid_hours, false, `${payCode} is excluded`);
    }
    const legacyAfter = await pool.query(
      `SELECT pay_code, counts_as_valid_hours, label
       FROM time_control_pay_code_rule
       WHERE tenant_id = $1 AND pay_code = ANY($2::text[])
       ORDER BY pay_code`,
      [tenantId, ["3300", "1220", "9010", "9012", "1246"]]
    );
    assert.deepEqual(legacyAfter.rows, legacyBefore.rows, "0053 must preserve 3300/1220/9010/9012/1246 exactly");
    const controlRules = await pool.query(
      "SELECT pay_code, counts_as_valid_hours, label FROM time_control_pay_code_rule WHERE tenant_id = $1 ORDER BY pay_code",
      [controlTenant.id]
    );
    assert.deepEqual(controlRules.rows, [{
      pay_code: "9300",
      counts_as_valid_hours: false,
      label: "control tenant rule must remain unchanged",
    }], "0053 must not add or alter rules for another tenant");
    const migrationState = await pool.query(
      `SELECT count(*) FILTER (WHERE success)::int AS successes,
              count(*) FILTER (WHERE NOT success)::int AS failures,
              bool_and(checksum_sha256 = $1) FILTER (WHERE filename = '0053_time_control_approved_pay_codes.sql') AS checksum_matches
       FROM schema_migration`,
      [createHash("sha256").update(migrationSql).digest("hex")]
    );
    assert.equal(migrationState.rows[0].successes, 53);
    assert.equal(migrationState.rows[0].failures, 0);
    assert.equal(migrationState.rows[0].checksum_matches, true);

    const fixtureActorEmail = "tc-admin@local-validation.invalid";
    await pool.query(
      `INSERT INTO tenant_user (tenant_id, email, name, role, status, password_hash)
       VALUES ($1, $2, 'Local Test Admin', 'tenant_admin', 'active', 'not-a-real-password-hash')
       ON CONFLICT DO NOTHING`,
      [tenantId, fixtureActorEmail]
    );
    const { rows: [actor] } = await pool.query(
      "SELECT id FROM tenant_user WHERE tenant_id = $1 AND lower(email) = lower($2)",
      [tenantId, fixtureActorEmail]
    );
    assert.ok(actor, "local fixture admin must belong to the target tenant");
    const actorId = actor.id;

    const { rows: [existingGroup] } = await pool.query(
      `SELECT id FROM resource_groups
       WHERE tenant_id = $1 AND external_source = 'ekomplet' AND external_id = '61'`,
      [tenantId]
    );
    const groupId = existingGroup?.id || randomUUID();
    await pool.query(
      `INSERT INTO resource_groups (id, tenant_id, name, status, source, external_source, external_id)
       VALUES ($1, $2, 'Timekontrol local validation group 61', 'active', 'ekomplet', 'ekomplet', '61')
       ON CONFLICT (tenant_id, external_source, external_id)
         WHERE external_source IS NOT NULL AND external_id IS NOT NULL
       DO UPDATE SET status = 'active'`,
      [groupId, tenantId]
    );

    const fitterFixtures = [
      { fitterId: "15", name: "Local Fitter 15", email: "tc-fitter15@local-validation.invalid", internalRef: "TC-15" },
      { fitterId: "295", name: "Local Fitter 295", email: "tc-fitter295@local-validation.invalid", internalRef: "TC-295" },
      { fitterId: "18", name: "Local Fitter 18", email: "tc-fitter18@local-validation.invalid", internalRef: "TC-18" },
      { fitterId: "208", name: "Local Fitter 208", email: "tc-fitter208@local-validation.invalid", internalRef: "TC-208" },
      { fitterId: "290", name: "Local Fitter 290", email: "tc-fitter290@local-validation.invalid", internalRef: "TC-290" },
      { fitterId: "498", name: "Local Fitter 498", email: "tc-fitter498@local-validation.invalid", internalRef: "TC-498" },
    ];
    const employeeConfigs = [];
    for (const fixture of fitterFixtures) {
      await pool.query(
        `INSERT INTO fitter (tenant_id, fitter_id, name, email, is_active_derived)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (tenant_id, fitter_id) DO UPDATE
           SET name = EXCLUDED.name, email = EXCLUDED.email, is_active_derived = true`,
        [tenantId, fixture.fitterId, fixture.name, fixture.email]
      );
      await pool.query(
        `INSERT INTO resource_group_members (tenant_id, group_id, fitter_id, source)
         VALUES ($1, $2, $3, 'ekomplet')
         ON CONFLICT (tenant_id, group_id, fitter_id) DO UPDATE SET source = 'ekomplet'`,
        [tenantId, groupId, fixture.fitterId]
      );
      const { rows: [config] } = await pool.query(
        `INSERT INTO time_control_employee_config
           (tenant_id, internal_ref, resource_group_external_id, tenant_user_id, fitter_id,
            is_enabled, approved_group_id, approved_email, email_source, email_source_value,
            email_approved_at, email_approved_by_user_id, approval_reason, approval_version)
         VALUES ($1, $2, '61', NULL, $3, true, $4, $5, 'admin_override', $5, now(), $6,
            'local PostgreSQL migration integration fixture', 1)
         ON CONFLICT (tenant_id, internal_ref) DO UPDATE SET
           tenant_user_id = NULL, fitter_id = EXCLUDED.fitter_id, is_enabled = true,
           approved_group_id = EXCLUDED.approved_group_id, approved_email = EXCLUDED.approved_email,
           email_source = 'admin_override', email_source_value = EXCLUDED.email_source_value,
           email_approved_at = now(), email_approved_by_user_id = EXCLUDED.email_approved_by_user_id,
           approval_reason = EXCLUDED.approval_reason, approval_version = 1
         RETURNING id, internal_ref, fitter_id, tenant_user_id`,
        [tenantId, fixture.internalRef, fixture.fitterId, groupId, fixture.email, actorId]
      );
      assert.equal(config.fitter_id, fixture.fitterId);
      assert.equal(config.tenant_user_id, null, "approved fitter fixtures intentionally have no Fielddesk login");
      employeeConfigs.push({ ...fixture, configId: config.id });
    }

    await pool.query(
      `INSERT INTO fitter (tenant_id, fitter_id, name, email, is_active_derived)
       VALUES ($1, '24', 'Local Control Fitter', 'fitter24@example.test', true)
       ON CONFLICT (tenant_id, fitter_id) DO UPDATE
         SET name = EXCLUDED.name, email = EXCLUDED.email, is_active_derived = true`,
      [tenantId]
    );
    await pool.query(
      `INSERT INTO resource_group_members (tenant_id, group_id, fitter_id, source)
       VALUES ($1, $2, '24', 'ekomplet')
       ON CONFLICT (tenant_id, group_id, fitter_id) DO UPDATE SET source = 'ekomplet'`,
      [tenantId, groupId]
    );
    const { rows: [legacyApprovalConfig] } = await pool.query(
      `INSERT INTO time_control_employee_config
         (tenant_id, internal_ref, resource_group_external_id, tenant_user_id, fitter_id,
          is_enabled, approved_group_id, approved_email, email_source, email_source_value,
          email_approved_at, email_approved_by_user_id, approval_reason, approval_version)
       VALUES ($1, 'TC-24', '61', NULL, '24', true, $2, 'fitter24@example.test',
          'fitter_master', 'fitter24@example.test', now(), $3, 'local approval regression fixture', 1)
       ON CONFLICT (tenant_id, internal_ref) DO UPDATE SET
         tenant_user_id = NULL, fitter_id = '24', is_enabled = true,
         approved_group_id = EXCLUDED.approved_group_id, approved_email = EXCLUDED.approved_email,
         email_source = 'fitter_master', email_source_value = EXCLUDED.email_source_value,
         email_approved_at = now(), email_approved_by_user_id = EXCLUDED.email_approved_by_user_id,
         approval_reason = EXCLUDED.approval_reason, approval_version = 1
       RETURNING id`,
      [tenantId, groupId, actorId]
    );
    const configId = legacyApprovalConfig.id;

    await pool.query(
      `INSERT INTO time_control_settings
         (tenant_id, is_enabled, mode, resource_group_external_id, internal_error_emails,
          employee_cc_emails, friday_manager_emails)
       VALUES ($1, true, 'dry_run', '61', '["tc-internal@local-validation.invalid"]'::jsonb,
          '[]'::jsonb, '["tc-manager@local-validation.invalid"]'::jsonb)
       ON CONFLICT (tenant_id) DO UPDATE SET
         is_enabled = true, mode = 'dry_run', resource_group_external_id = '61',
         internal_error_emails = '["tc-internal@local-validation.invalid"]'::jsonb,
         employee_cc_emails = '[]'::jsonb,
         friday_manager_emails = '["tc-manager@local-validation.invalid"]'::jsonb`,
      [tenantId]
    );

    const evidence = loadEvidence(tenantId);
    const firstDataset = coverage.createHoursDataset(evidence);
    const firstObservedAt = null;
    const firstCapture = await storage.importHoursEvidenceWithPool({
      tenantId, controlledDate: DAY, evidence, observedAt: firstObservedAt,
    });
    assert.equal(firstCapture.proof.row_count, 301);
    assert.equal(firstCapture.proof.controlled_date, DAY);
    assert.match(firstCapture.proof.rows_hash, /^[a-f0-9]{64}$/);
    if (process.env.FIELDDESK_TC_EXPECTED_ROWS_HASH) {
      assert.equal(firstCapture.proof.rows_hash, process.env.FIELDDESK_TC_EXPECTED_ROWS_HASH);
    }

    const idempotentClient = await pool.connect();
    try {
      await idempotentClient.query("BEGIN");
      const repeated = await storage.storeHoursDataset(idempotentClient, {
        tenantId, dataset: firstDataset, observedAt: firstObservedAt,
      });
      await idempotentClient.query("COMMIT");
      assert.equal(repeated.id, firstCapture.id, "same revision and observation must reuse the immutable capture");
    } catch (error) {
      await idempotentClient.query("ROLLBACK");
      throw error;
    } finally {
      idempotentClient.release();
    }

    const approvalAuditBaseline = await pool.query(
      `SELECT count(*)::int AS count FROM audit_event
       WHERE tenant_id = $1 AND target_type = 'time_control_employee_config'
         AND target_id = $2 AND event_type = 'time_control.employee_email_approved'`,
      [tenantId, configId]
    );
    const sourceMismatchError = await service.approveEmployeeRecipient({
      tenantId,
      actorId,
      configId,
      fitterId: "24",
      groupId,
      email: "not-the-fitter-master@example.test",
      source: "fitter_master",
      reason: "verify source must match the active fitter master value",
      expectedVersion: 1,
    }).then(() => null, (error) => error);
    assert.equal(sourceMismatchError?.statusCode, 409);
    assert.equal(sourceMismatchError?.message, "time_control_approval_source_mismatch");
    const rejectedApprovalState = await pool.query(
      `SELECT approval_version, approved_email FROM time_control_employee_config
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, configId]
    );
    assert.equal(rejectedApprovalState.rows[0].approval_version, 1);
    assert.equal(rejectedApprovalState.rows[0].approved_email, "fitter24@example.test");
    const approvalAuditAfterReject = await pool.query(
      `SELECT count(*)::int AS count FROM audit_event
       WHERE tenant_id = $1 AND target_type = 'time_control_employee_config'
         AND target_id = $2 AND event_type = 'time_control.employee_email_approved'`,
      [tenantId, configId]
    );
    assert.equal(
      approvalAuditAfterReject.rows[0].count,
      approvalAuditBaseline.rows[0].count,
      "rejected approval source must not be audited as success"
    );

    const approved = await service.approveEmployeeRecipient({
      tenantId,
      actorId,
      configId,
      fitterId: "24",
      groupId,
      email: "fitter24@example.test",
      source: "fitter_master",
      reason: "verified active fitter master email",
      expectedVersion: 1,
    });
    assert.equal(approved.approval_version, 2);
    assert.equal(approved.approved_email, "fitter24@example.test");
    const approvalAudit = await pool.query(
      `SELECT event_type, outcome, actor_id, metadata
       FROM audit_event
       WHERE tenant_id = $1 AND target_type = 'time_control_employee_config'
         AND target_id = $2 AND event_type = 'time_control.employee_email_approved'`,
      [tenantId, configId]
    );
    assert.equal(approvalAudit.rows.length, approvalAuditBaseline.rows[0].count + 1);
    assert.equal(approvalAudit.rows[0].event_type, "time_control.employee_email_approved");
    assert.equal(approvalAudit.rows[0].outcome, "success");
    assert.equal(approvalAudit.rows[0].actor_id, actorId);
    assert.equal(approvalAudit.rows[0].metadata.email_source, "fitter_master");
    assert.equal(approvalAudit.rows[0].metadata.new_version, 2);

    const historicalClient = await pool.connect();
    try {
      await assert.rejects(
        storage.loadHoursDataset(historicalClient, {
          tenantId, controlledDate: DAY, datasetId: firstCapture.id, freshnessMinutes: 180,
        }),
        /time_control_dataset_stale_or_observation_missing/
      );
      const historical = await storage.loadHoursDataset(historicalClient, {
        tenantId, controlledDate: DAY, datasetId: firstCapture.id,
        freshnessMinutes: 180, allowHistoricalSnapshot: true,
      });
      assert.equal(historical.proof.freshness, "explicit_historical_demo");
      assert.equal(historical.proof.row_count, 301);
    } finally {
      historicalClient.release();
    }

    const runArgs = {
      tenantId,
      controlType: "manual",
      controlledDate: DAY,
      actorId: null,
      triggeredBy: "local_postgres_integration",
      waitForSync: false,
      dryRun: true,
    };
    const blockedAuditBaseline = await pool.query(
      `SELECT count(*)::int AS count FROM audit_event
       WHERE tenant_id = $1 AND event_type = 'time_control.run_blocked'`,
      [tenantId]
    );
    const storeAuditBaseline = await pool.query(
      `SELECT count(*)::int AS count FROM audit_event
       WHERE tenant_id = $1 AND event_type = 'sync_success'
         AND target_type = 'time_control_hours_dataset' AND target_id = $2`,
      [tenantId, firstCapture.id]
    );
    const dryRun = await service.runTimeControlWithPool(runArgs, {
      hoursDatasetId: firstCapture.id,
      allowHistoricalSnapshot: true,
    });
    assert.equal(dryRun.run.mode, "dry_run");
    assert.equal(dryRun.run.status, "blocked", "unclassified source hours must not be treated as missing hours");
    assert.equal(dryRun.results.length, 7);
    const legacyResult = dryRun.results.find((result) => result.fitter_id === "24");
    assert.equal(legacyResult.status, "unclassified_hours");
    assert.equal(legacyResult.missing_hours, null);
    assert.equal(legacyResult.tenant_user_id, null, "fitter identity must not require a Fielddesk login");
    assert.equal(legacyResult.hours_dataset_id, firstCapture.id);
    assert.equal(legacyResult.identity_snapshot.hours_dataset.freshness, "explicit_historical_demo");
    assert.ok(dryRun.results.every((result) => result.hours_dataset_id === firstCapture.id));
    assert.ok(dryRun.mails.every((mail) => mail.status === "would_send"));

    const sideEffects = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM email_outbox WHERE tenant_id = $1) AS outbox_rows,
         (SELECT count(*)::int FROM time_control_mail_log
            WHERE tenant_id = $1 AND run_id = $2 AND status = 'would_send') AS previews,
         (SELECT count(*)::int FROM audit_event
            WHERE tenant_id = $1 AND event_type = 'time_control.run_blocked') AS blocked_audits`,
      [tenantId, dryRun.run.id]
    );
    assert.equal(sideEffects.rows[0].outbox_rows, 0, "dry-run must not enqueue or apply email");
    assert.equal(sideEffects.rows[0].previews, dryRun.mails.length);
    assert.equal(sideEffects.rows[0].blocked_audits, blockedAuditBaseline.rows[0].count + 1);
    const systemStoreAudit = await pool.query(
      `SELECT actor_id, actor_scope, metadata ->> 'actor_type' AS actor_type
       FROM audit_event
       WHERE tenant_id = $1 AND event_type = 'sync_success'
         AND target_type = 'time_control_hours_dataset' AND target_id = $2`,
      [tenantId, firstCapture.id]
    );
    assert.equal(
      systemStoreAudit.rows.length,
      storeAuditBaseline.rows[0].count,
      "the initial and idempotent imports must each be audited before dry-run evaluation"
    );
    assert.ok(systemStoreAudit.rows.length >= 2);
    assert.ok(systemStoreAudit.rows.every((row) =>
      row.actor_id === "system:time_control_dataset" && row.actor_scope === "system" && row.actor_type === "system"
    ));

    const linkedRows = await pool.query(
      `SELECT r.hours_dataset_id AS run_dataset_id, x.hours_dataset_id AS result_dataset_id,
              x.fitter_id, x.internal_ref, x.tenant_user_id, x.status, x.identity_snapshot
       FROM time_control_run r
       JOIN time_control_result x ON x.run_id = r.id AND x.tenant_id = r.tenant_id
       WHERE r.tenant_id = $1 AND r.control_type = 'manual' AND r.controlled_date = $2::date`,
      [tenantId, DAY]
    );
    assert.equal(linkedRows.rows.length, 7);
    assert.ok(linkedRows.rows.every((row) =>
      row.run_dataset_id === firstCapture.id && row.result_dataset_id === firstCapture.id
    ));
    const legacyLinkedRow = linkedRows.rows.find((row) => row.internal_ref === "TC-24");
    assert.equal(legacyLinkedRow.fitter_id, "24");
    assert.equal(legacyLinkedRow.tenant_user_id, null);

    const lockInput = { tenantId, controlType: "manual", controlledDate: DAY };
    await assert.rejects(
      service.runTimeControlWithPool(runArgs, { hoursDatasetId: "not-a-uuid", allowHistoricalSnapshot: true }),
      /time_control_dataset_id_invalid/
    );
    const lockProbe = await pool.connect();
    try {
      assert.equal(await repository.acquireRunLock(lockProbe, lockInput), true, "run session lock must be released after success and SQL-backed failure");
      await repository.releaseRunLock(lockProbe, lockInput);
    } finally {
      lockProbe.release();
    }

    await pool.query(
      "UPDATE time_control_employee_config SET is_enabled = false WHERE tenant_id = $1 AND id = $2",
      [tenantId, configId]
    );
    async function inspectCliRun(controlType) {
      const { rows: [run] } = await pool.query(
        `SELECT id, status, mode, hours_dataset_id
         FROM time_control_run WHERE tenant_id = $1 AND control_type = $2 AND controlled_date = $3::date`,
        [tenantId, controlType, DAY]
      );
      const { rows: results } = await pool.query(
        `SELECT id, fitter_id, internal_ref, status, required_hours, valid_hours, missing_hours,
                counted_pay_codes, excluded_pay_codes, hours_dataset_id
         FROM time_control_result
         WHERE tenant_id = $1 AND run_id = $2 ORDER BY fitter_id`,
        [tenantId, run.id]
      );
      const { rows: previews } = await pool.query(
        `SELECT id, mail_type, status, idempotency_key
         FROM time_control_mail_log WHERE tenant_id = $1 AND run_id = $2 ORDER BY mail_type`,
        [tenantId, run.id]
      );
      return { run, results, previews };
    }
    for (const controlType of ["daily_09", "friday_12"]) {
      const firstCli = runTimeControlCli({
        tenantSlug: "hoyrup-clemmensen", controlledDate: DAY, controlType, datasetId: firstCapture.id,
      });
      assert.equal(firstCli.event, "time_control_run_finished");
      assert.equal(firstCli.control_type, controlType);
      assert.equal(firstCli.controlled_date, DAY);
      assert.equal(firstCli.mode, "dry_run");
      assert.equal(firstCli.result_count, 6);
      assert.equal(firstCli.mail_count, controlType === "friday_12" ? 2 : 1);

      const firstSnapshot = await inspectCliRun(controlType);
      assert.equal(firstSnapshot.run.status, "completed");
      assert.equal(firstSnapshot.run.mode, "dry_run");
      assert.equal(firstSnapshot.run.hours_dataset_id, firstCapture.id);
      assert.equal(firstSnapshot.results.length, 6);
      assert.ok(firstSnapshot.results.every((result) => result.hours_dataset_id === firstCapture.id));
      const resultByFitter = new Map(firstSnapshot.results.map((result) => [result.fitter_id, result]));
      const expectedValidCode = {
        "15": "1220", "295": "3300", "18": "1220", "208": "9000", "498": "3300",
      };
      for (const [fitterId, payCode] of Object.entries(expectedValidCode)) {
        assert.equal(resultByFitter.get(fitterId)?.status, "ok", `${controlType} fitter ${fitterId} has seven valid hours`);
        assert.equal(Number(resultByFitter.get(fitterId)?.valid_hours), 7);
        assert.equal(Number(resultByFitter.get(fitterId)?.required_hours), 7);
        assert.deepEqual(resultByFitter.get(fitterId)?.counted_pay_codes, [{ pay_code: payCode, hours: 7 }]);
      }
      const fitter290 = resultByFitter.get("290");
      assert.equal(fitter290.status, "missing_hours");
      assert.equal(Number(fitter290.required_hours), 7);
      assert.equal(Number(fitter290.valid_hours), 6);
      assert.equal(Number(fitter290.missing_hours), 1);
      assert.deepEqual(fitter290.counted_pay_codes, [{ pay_code: "3300", hours: 6 }]);
      assert.deepEqual(fitter290.excluded_pay_codes, [{ pay_code: "9070", hours: 6 }]);
      assert.equal(firstSnapshot.previews.length, controlType === "friday_12" ? 2 : 1);
      assert.ok(firstSnapshot.previews.every((preview) => preview.status === "would_send"));

      const secondCli = runTimeControlCli({
        tenantSlug: "hoyrup-clemmensen", controlledDate: DAY, controlType, datasetId: firstCapture.id,
      });
      assert.equal(secondCli.mode, "dry_run");
      assert.equal(secondCli.result_count, 6);
      assert.equal(secondCli.mail_count, firstCli.mail_count);
      const secondSnapshot = await inspectCliRun(controlType);
      assert.equal(secondSnapshot.run.id, firstSnapshot.run.id);
      assert.deepEqual(
        secondSnapshot.results.map((result) => result.id),
        firstSnapshot.results.map((result) => result.id),
        `${controlType} rerun must update six results rather than duplicate them`
      );
      assert.deepEqual(
        secondSnapshot.previews.map((preview) => preview.id),
        firstSnapshot.previews.map((preview) => preview.id),
        `${controlType} rerun must keep the same preview IDs`
      );
      assert.deepEqual(
        secondSnapshot.previews.map((preview) => preview.idempotency_key),
        firstSnapshot.previews.map((preview) => preview.idempotency_key)
      );
    }
    const localOutbox = await pool.query("SELECT count(*)::int AS count FROM email_outbox");
    assert.equal(localOutbox.rows[0].count, 0, "the whole disposable database must have no provider outbox rows");

    const updateClient = await pool.connect();
    const changedEvidence = structuredClone(evidence);
    const changeIndex = changedEvidence.rows.findIndex((row) => String(row.id) !== "318942");
    changedEvidence.rows[changeIndex].hours += 0.25;
    updatePassHashes(changedEvidence);
    const changedDataset = coverage.createHoursDataset(changedEvidence);
    const changedObservedAt = new Date(Date.now() - 1000).toISOString();
    let changedCapture;
    try {
      await updateClient.query("BEGIN");
      changedCapture = await storage.storeHoursDataset(updateClient, {
        tenantId, dataset: changedDataset, observedAt: changedObservedAt, actorId,
      });
      await updateClient.query("COMMIT");
    } catch (error) {
      await updateClient.query("ROLLBACK");
      throw error;
    } finally {
      updateClient.release();
    }
    assert.notEqual(changedCapture.id, firstCapture.id);

    const scopedLoadClient = await pool.connect();
    try {
      await assert.rejects(
        storage.loadHoursDataset(scopedLoadClient, {
          tenantId, controlledDate: DAY, datasetId: firstCapture.id, freshnessMinutes: 180,
        }),
        /time_control_dataset_not_current_or_scope_mismatch/
      );
      await assert.rejects(
        storage.loadHoursDataset(scopedLoadClient, {
          tenantId, controlledDate: "2026-03-28", datasetId: changedCapture.id, freshnessMinutes: 180,
        }),
        /time_control_dataset_not_current_or_scope_mismatch/
      );
      const current = await storage.loadHoursDataset(scopedLoadClient, {
        tenantId, controlledDate: DAY, datasetId: changedCapture.id, freshnessMinutes: 180,
      });
      assert.equal(current.proof.freshness, "fresh_observation");
      assert.notEqual(current.proof.rows_hash, firstCapture.proof.rows_hash);
    } finally {
      scopedLoadClient.release();
    }

    await assert.rejects(
      pool.query("UPDATE time_control_hours_dataset SET row_count = row_count + 1 WHERE id = $1", [changedCapture.id]),
      /time_control_hours_dataset_immutable/
    );
    await assert.rejects(
      pool.query("DELETE FROM time_control_hours_dataset WHERE id = $1", [changedCapture.id]),
      /time_control_hours_dataset_immutable/
    );

    const otherTenantId = randomUUID();
    await pool.query(
      "INSERT INTO tenant (id, slug, name, status) VALUES ($1, $2, 'Cross-scope fixture', 'active')",
      [otherTenantId, `tc-cross-${randomUUID()}`]
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO time_control_hours_dataset_head (tenant_id, controlled_date, dataset_id)
         VALUES ($1, $2::date, $3)`,
        [otherTenantId, DAY, changedCapture.id]
      ),
      /fk_time_control_dataset_head/
    );
    const otherScopeClient = await pool.connect();
    try {
      await assert.rejects(
        storage.loadHoursDataset(otherScopeClient, {
          tenantId: otherTenantId, controlledDate: DAY, datasetId: changedCapture.id, freshnessMinutes: 180,
        }),
        /time_control_dataset_not_current_or_scope_mismatch/
      );
    } finally {
      otherScopeClient.release();
    }

    const invalidEvidence = structuredClone(changedEvidence);
    invalidEvidence.evidence.closedProjectControl = null;
    await assert.rejects(
      storage.importHoursEvidenceWithPool({
        tenantId, controlledDate: DAY, evidence: invalidEvidence, observedAt: changedObservedAt,
      }),
      /time_control_coverage_invalid:closed_project_control_missing/
    );
    let head = await pool.query(
      "SELECT dataset_id, invalidated_at FROM time_control_hours_dataset_head WHERE tenant_id = $1 AND controlled_date = $2::date",
      [tenantId, DAY]
    );
    assert.equal(head.rows[0].dataset_id, null);
    assert.ok(head.rows[0].invalidated_at);
    const systemInvalidationAudit = await pool.query(
      `SELECT actor_id, actor_scope, metadata ->> 'actor_type' AS actor_type
       FROM audit_event
       WHERE tenant_id = $1 AND event_type = 'sync_fail'
         AND target_type = 'time_control_hours_dataset'
       ORDER BY occurred_at DESC LIMIT 1`,
      [tenantId]
    );
    assert.equal(systemInvalidationAudit.rows.length, 1);
    assert.equal(systemInvalidationAudit.rows[0].actor_id, "system:time_control_dataset");
    assert.equal(systemInvalidationAudit.rows[0].actor_scope, "system");
    assert.equal(systemInvalidationAudit.rows[0].actor_type, "system");

    const replayClient = await pool.connect();
    try {
      await replayClient.query("BEGIN");
      await assert.rejects(
        storage.storeHoursDataset(replayClient, {
          tenantId, dataset: changedDataset, observedAt: changedObservedAt, actorId,
        }),
        /time_control_dataset_replacement_requires_newer_observation/
      );
      await replayClient.query("ROLLBACK");
    } finally {
      replayClient.release();
    }

    const emptyEvidence = structuredClone(changedEvidence);
    emptyEvidence.rows = [];
    emptyEvidence.expectedTotal = 0;
    await assert.rejects(
      storage.importHoursEvidenceWithPool({
        tenantId, controlledDate: DAY, evidence: emptyEvidence,
      }),
      /time_control_coverage_invalid:total/
    );
    head = await pool.query(
      "SELECT dataset_id, invalidated_at FROM time_control_hours_dataset_head WHERE tenant_id = $1 AND controlled_date = $2::date",
      [tenantId, DAY]
    );
    assert.equal(head.rows[0].dataset_id, null);
    assert.ok(head.rows[0].invalidated_at);

    const refreshedClient = await pool.connect();
    let refreshed;
    try {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await refreshedClient.query("BEGIN");
      refreshed = await storage.storeHoursDataset(refreshedClient, {
        tenantId, dataset: changedDataset, observedAt: new Date().toISOString(), actorId,
      });
      await refreshedClient.query("COMMIT");
    } catch (error) {
      await refreshedClient.query("ROLLBACK");
      throw error;
    } finally {
      refreshedClient.release();
    }
    assert.notEqual(refreshed.id, changedCapture.id);
    const refreshedLoadClient = await pool.connect();
    try {
      const loaded = await storage.loadHoursDataset(refreshedLoadClient, {
        tenantId, controlledDate: DAY, datasetId: refreshed.id, freshnessMinutes: 180,
      });
      assert.equal(loaded.proof.freshness, "fresh_observation");
    } finally {
      refreshedLoadClient.release();
    }
  } finally {
    if (appPool) await appPool.end();
    await pool.end();
  }
});
