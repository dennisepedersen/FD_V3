"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createHash, randomUUID } = require("node:crypto");

const enabled = process.env.FIELD_DESK_LOCAL_PG_TEST === "1" &&
  Boolean(process.env.FIELDDESK_TC_OCTOBER_EVIDENCE_PATH);

test("retained October EK week: v2 coverage, PostgreSQL evaluation, repeat and concurrency", { skip: !enabled }, async () => {
  const url = new URL(process.env.FIELDDESK_TIME_CONTROL_TEST_DATABASE_URL);
  assert.equal(url.protocol, "postgres:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55432");
  assert.equal(url.username, "tc_validation");
  assert.equal(url.password, "");
  assert.match(url.pathname, /^\/fielddesk_tc_validation_upgrade_[a-f0-9]{24}$/);
  const source = JSON.parse(fs.readFileSync(process.env.FIELDDESK_TC_OCTOBER_EVIDENCE_PATH, "utf8"));
  const expected = [276, 267, 261, 246, 244];
  assert.equal(source.days.length, 5);
  assert.equal(source.days.flatMap((day) => day.rows).length, 1294);
  assert.equal(new Set(source.days.flatMap((day) => day.rows.map((row) => row.id))).size, 1294);
  const sorted = (rows) => [...rows].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  assert.deepEqual(sorted(source.days.flatMap((day) => day.rows)), sorted(source.weekUnion.rows));
  const { Pool, Client } = require("../backend/node_modules/pg");
  const admin = new Client({ connectionString: url.toString(), ssl: false });
  const database = `fielddesk_tc_validation_upgrade_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
  await admin.connect();
  try { await admin.query(`CREATE DATABASE "${database}"`); } finally { await admin.end(); }
  url.pathname = `/${database}`;
  const connectionString = url.toString();
  process.env.DATABASE_URL = connectionString;
  process.env.NODE_ENV = "test";
  const ephemeralSigningKey = randomUUID();
  process.env.JWT_SECRET = ephemeralSigningKey;
  process.env.ROOT_DOMAIN = "example.test";
  process.env.MAIL_PROVIDER = "disabled";
  process.env.MAIL_API_KEY = "";
  process.env.TIME_CONTROL_SCHEDULER_ENABLED = "false";
  const pool = new Pool({ connectionString: url.toString(), ssl: false });
  let appPool;
  const tenantId = source.tenantId;
  try {
    const runner = require("../backend/scripts/db_migrate");
    const client = await pool.connect();
    try {
      await runner.ensureMigrationTable(client);
      const files = runner.getMigrationFiles();
      await runner.runPendingMigrations(client, files.filter((file) => Number(file.sequence) <= 48), new Map());
      await client.query("INSERT INTO tenant(id,slug,name,status) VALUES($1,'hoyrup-clemmensen','Isolated HC source verification','active')", [tenantId]);
      await runner.runPendingMigrations(client, files.filter((file) => Number(file.sequence) > 48 && Number(file.sequence) <= 54), new Map());
    } finally { client.release(); }
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM schema_migration WHERE success")).rows[0].n, 54);
    const otherTenantId = randomUUID();
    await pool.query("INSERT INTO tenant(id,slug,name,status) VALUES($1,'allowance-isolation-control','Local control tenant','active')", [otherTenantId]);
    await pool.query(
      `INSERT INTO time_control_pay_code_rule(tenant_id,pay_code,counts_as_valid_hours,label)
       VALUES($1,'9043',true,'Other tenant rule'),($1,'9076',true,'Other tenant rule')`, [otherTenantId]);
    const otherRules = (await pool.query("SELECT * FROM time_control_pay_code_rule WHERE tenant_id=$1 ORDER BY pay_code", [otherTenantId])).rows;
    const originalRules = (await pool.query("SELECT * FROM time_control_pay_code_rule WHERE tenant_id=$1 ORDER BY pay_code", [tenantId])).rows;
    const migration = runner.getMigrationFiles().find((file) => file.sequence === "0055");
    assert.ok(migration);
    const migrationClient = await pool.connect();
    try {
      await runner.runPendingMigrations(migrationClient, [migration], await runner.getAppliedMap(migrationClient));
      const history = await runner.getAppliedMap(migrationClient);
      assert.equal(history.get(migration.id).checksum_sha256, migration.checksum);
      assert.equal(history.get(migration.id).success, true);
      await runner.runPendingMigrations(migrationClient, [migration], history);
      assert.deepEqual(await runner.getAppliedMap(migrationClient), history);
    }
    finally { migrationClient.release(); }
    const approvedRules = (await pool.query("SELECT * FROM time_control_pay_code_rule WHERE tenant_id=$1 ORDER BY pay_code", [tenantId])).rows;
    assert.equal(approvedRules.length, originalRules.length + 2);
    assert.deepEqual(approvedRules.filter((rule) => !["9043", "9076"].includes(rule.pay_code)), originalRules);
    assert.deepEqual(approvedRules.filter((rule) => ["9043", "9076"].includes(rule.pay_code)).map((rule) => ({
      pay_code: rule.pay_code, counts_as_valid_hours: rule.counts_as_valid_hours, label: rule.label,
    })), [
      { pay_code: "9043", counts_as_valid_hours: false, label: "Formandstillaeg 4" },
      { pay_code: "9076", counts_as_valid_hours: false, label: "Funktionstillaeg" },
    ]);
    await pool.query(migration.sql);
    assert.deepEqual((await pool.query("SELECT * FROM time_control_pay_code_rule WHERE tenant_id=$1 ORDER BY pay_code", [tenantId])).rows, approvedRules);
    assert.deepEqual((await pool.query("SELECT * FROM time_control_pay_code_rule WHERE tenant_id=$1 ORDER BY pay_code", [otherTenantId])).rows, otherRules);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM schema_migration WHERE success")).rows[0].n, 55);
    const operationalMigrationClient = await pool.connect();
    try {
      await runner.runPendingMigrations(operationalMigrationClient,
        runner.getMigrationFiles().filter(file => Number(file.sequence) > 55),
        await runner.getAppliedMap(operationalMigrationClient));
    } finally { operationalMigrationClient.release(); }
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM schema_migration WHERE success")).rows[0].n, 56);
    const coverage = require("../backend/src/modules/timeControl/timeControl.coverage");
    const storage = require("../backend/src/modules/timeControl/timeControl.dataset");
    const logic = require("../backend/src/modules/timeControl/timeControl.logic");
    const service = require("../backend/src/modules/timeControl/timeControl.service");
    appPool = require("../backend/src/db/pool");
    const { rows: [actor] } = await pool.query(
      `INSERT INTO tenant_user(tenant_id,email,name,role,status,password_hash)
       VALUES($1,'admin@local-validation.invalid','Local approval fixture','tenant_admin','active','not-a-password') RETURNING id`, [tenantId]);
    const { rows: [group] } = await pool.query(
      `INSERT INTO resource_groups(tenant_id,name,status,source,external_source,external_id)
       VALUES($1,'Local group 61','active','ekomplet','ekomplet','61') RETURNING id`, [tenantId]);
    await pool.query("UPDATE time_control_employee_config SET is_enabled=false WHERE tenant_id=$1", [tenantId]);
    const cohort = [
      [15, "MHJ", "mhj@hoyrup-clemmensen.dk"],
      [295, "MUM", "mum@hoyrup-clemmensen.dk"],
      [18, "JSK", "jsk@hoyrup-clemmensen.dk"],
      [208, "PEP", "pep@hoyrup-clemmensen.dk"],
      [290, "MBO", "mbo@hoyrup-clemmensen.dk"],
      [498, "MPJ", "mpj@hoyrup-clemmensen.dk"],
    ];
    for (const [id, ref, email] of cohort) {
      const name = source.fitters.find((fitter) => fitter.id === id)?.name || String(id);
      await pool.query("INSERT INTO fitter(tenant_id,fitter_id,name,email,is_active_derived) VALUES($1,$2,$3,$4,true)", [tenantId, String(id), name, email]);
      await pool.query("INSERT INTO resource_group_members(tenant_id,group_id,fitter_id,source) VALUES($1,$2,$3,'ekomplet')", [tenantId, group.id, String(id)]);
      await pool.query(
        `INSERT INTO time_control_employee_config
         (tenant_id,internal_ref,fitter_id,is_enabled,approved_group_id,approved_email,email_source,email_source_value,
          email_approved_at,email_approved_by_user_id,approval_reason,approval_version)
         VALUES($1,$2,$3,true,$4,$5,'admin_override',$5,now(),$6,'Local fixture of explicitly approved mapping',1)
         ON CONFLICT(tenant_id,internal_ref) DO UPDATE SET fitter_id=EXCLUDED.fitter_id,is_enabled=true,
          approved_group_id=EXCLUDED.approved_group_id,approved_email=EXCLUDED.approved_email,email_source='admin_override',
          email_source_value=EXCLUDED.email_source_value,email_approved_at=now(),email_approved_by_user_id=$6,
          approval_reason=EXCLUDED.approval_reason,approval_version=1`, [tenantId, ref, String(id), group.id, email, actor.id]);
    }
    await pool.query(
      `UPDATE time_control_settings SET is_enabled=true,mode='dry_run',live_enabled_at=NULL,
       employee_cc_emails='["dep@hoyrup-clemmensen.dk"]',
       friday_manager_emails='["dep@hoyrup-clemmensen.dk","lke@hoyrup-clemmensen.dk"]',
       internal_error_emails='["dep@hoyrup-clemmensen.dk","lke@hoyrup-clemmensen.dk"]' WHERE tenant_id=$1`, [tenantId]);
    const datasetIds = [];
    const proofs = [];
    for (const [index, input] of source.days.entries()) {
      assert.equal(input.fromDate, `2026-10-${String(index + 5).padStart(2, "0")}`);
      assert.equal(input.expectedTotal, expected[index]);
      assert.deepEqual(input.passes[0].rows, input.passes[1].rows);
      assert.deepEqual(input.passes[0].rawRows, input.passes[1].rawRows);
      const evidence = structuredClone(input);
      evidence.evidence.endpointContract = {
        version: "ek_v4_all_projects_single_day_two_pass_v2", endpoint: input.endpoint, scope: "tenant_all_projects",
        requestParameters: { fromDate: input.fromDate, toDate: input.toDate, pageSize: input.pageSize },
        verificationReference: "FITTERHOURS_2026-10-05_2026-10-09.md; March closed-project ID 318942/project 23050",
      };
      const dataset = coverage.createHoursDataset(evidence);
      assert.equal(dataset.proof.contract, evidence.evidence.endpointContract.version);
      assert.equal(coverage.getCaptureObservation(dataset), null);
      assert.equal(evidence.evidence.closedProjectControl == null, true, "real nonempty day has no claimed closed-project control");
      const args = { tenantId, controlledDate: input.fromDate, evidence, observedAt: input.passes[0].startedAt };
      const stored = await storage.importHoursEvidenceWithPool(args);
      const repeated = await storage.importHoursEvidenceWithPool(args);
      assert.equal(repeated.id, stored.id);
      datasetIds.push(stored.id);
      proofs.push(stored.proof);
    }
    const rules = logic.normalizePayCodeRules((await pool.query("SELECT * FROM time_control_pay_code_rule WHERE tenant_id=$1", [tenantId])).rows);
    const detail = cohort.map(([id, ref]) => {
      const daily = source.days.map((day) => {
        const rows = day.rows.filter((row) => row.fitterId === id);
        return { date: day.fromDate, ...logic.summarizeHours(rows.map((row) => ({
          source_key: `id:${row.id}`, fitter_category_id: row.categoryId,
          fitter_category_reference: row.categoryReference, hours: row.hours,
        })), rules) };
      });
      return { fitterId: id, ref, daily };
    });
    const runArgs = { tenantId, controlType: "friday_weekly_v1", controlledDate: "2026-10-09",
      dryRun: true, triggeredBy: "manual_test", waitForSync: false };
    const run = () => service.runTimeControlWithPool(runArgs, { hoursDatasetIds: datasetIds, allowHistoricalSnapshot: true });
    const first = await run();
    assert.equal(first.results.length, 6);
    for (const result of first.results) {
      assert.equal(Number(result.valid_hours), 37);
      assert.equal(result.coverage_status, "complete");
      assert.equal(result.missing_hours, null);
      assert.equal(result.status, "ok");
      assert.equal(Number(result.unclassified_hours), 0);
      assert.deepEqual(result.unclassified_rows, []);
      if (String(result.fitter_id) === "295") {
        assert.deepEqual(result.excluded_pay_codes, [{ pay_code: "9043", hours: 15 }, { pay_code: "9076", hours: 15 }]);
      }
    }
    assert.equal(first.run.status, "completed");
    assert.ok(first.mails.every((mail) => !mail.mail_type.includes("employee")));
    const state = async () => {
      const output = {};
      for (const table of ["time_control_hours_dataset", "time_control_run", "time_control_result", "time_control_mail_log", "time_control_weekly_snapshot", "email_outbox", "sync_job"]) {
        output[table] = (await pool.query(`SELECT id FROM ${table} WHERE tenant_id=$1 ORDER BY id`, [tenantId])).rows.map((row) => row.id);
      }
      return output;
    };
    const before = await state();
    const second = await run();
    assert.equal(second.run.id, first.run.id);
    assert.deepEqual(await state(), before);
    const concurrent = await Promise.allSettled([run(), run()]);
    assert.ok(concurrent.some((result) => result.status === "fulfilled"));
    for (const result of concurrent) {
      if (result.status === "rejected") assert.equal(result.reason.message, "time_control_run_already_in_progress");
      else assert.equal(result.value.run.id, first.run.id);
    }
    const after = await state();
    assert.deepEqual(after, before);
    assert.equal(after.email_outbox.length, 0);
    assert.equal(after.sync_job.length, 0);
    const logs = (await pool.query("SELECT mail_type,recipient_emails,cc_emails,status FROM time_control_mail_log WHERE tenant_id=$1 ORDER BY mail_type", [tenantId])).rows;
    assert.equal(logs.length, 0);
    const march = JSON.parse(fs.readFileSync(process.env.FIELDDESK_TC_EVIDENCE_PATH, "utf8"));
    const legacy = coverage.createHoursDataset(march);
    assert.equal(legacy.proof.contract, "ek_v4_single_day_two_pass_v1");
    assert.ok(march.rows.some((row) => row.id === "318942" && row.projectId === 23050));
    const report = { database, sourceSha256: createHash("sha256").update(fs.readFileSync(process.env.FIELDDESK_TC_OCTOBER_EVIDENCE_PATH)).digest("hex"),
      contract: proofs[0].contract, proofs, datasetIds, detail, payCodeRules: approvedRules,
      migration: { filename: migration.filename, checksum: migration.checksum, tenantIsolationVerified: true, repeatedSqlStable: true },
      run: first.run, results: first.results,
      logs, before, after, repeatedAndConcurrentStable: true, provider: "disabled", scheduler: false,
      historicalSnapshot: true, legacyMarchProof: legacy.proof };
    if (process.env.FIELDDESK_TC_OCTOBER_RESULT_PATH) {
      fs.writeFileSync(process.env.FIELDDESK_TC_OCTOBER_RESULT_PATH, JSON.stringify(report, null, 2) + "\n");
    }
    console.log(JSON.stringify({ database, results: first.results.map((result) => ({
      fitterId: result.fitter_id, hours: result.valid_hours, status: result.status })),
      counts: Object.fromEntries(Object.entries(after).map(([key, ids]) => [key, ids.length])) }));
  } finally {
    if (appPool) await appPool.end();
    await pool.end();
  }
});
