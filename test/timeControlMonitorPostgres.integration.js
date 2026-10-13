"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const path = require("node:path");

const enabled = process.env.FIELD_DESK_LOCAL_PG_TEST === "1";
const HC = "f1f51c07-2d88-4ee4-a766-78eac833a9d0";
const DEP = "dep@hoyrup-clemmensen.dk";
const SENDER = "Fielddesk Timekontrol <timekontrol@mail.fielddesk.dk>";
const FITTERS = ["15", "18", "208", "290", "295", "498"];

function safeUrl() {
  const url = new URL(process.env.FIELDDESK_TIME_CONTROL_TEST_DATABASE_URL || "postgres://example.invalid/blocked");
  assert.equal(url.protocol, "postgres:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55432");
  assert.equal(url.username, "tc_validation");
  assert.equal(url.password, "");
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
  assert.match(url.pathname, /^\/fielddesk_tc_validation_upgrade_[a-f0-9]{24}$/);
  return url;
}

test("Timekontrol monitor: isolated actual migrations, durable traces, watchdog and mocked status transport", {
  skip: !enabled,
  timeout: 300000,
}, async t => {
  const url = safeUrl();
  const { Client, Pool } = require("../backend/node_modules/pg");
  const database = `fielddesk_tc_validation_upgrade_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
  assert.match(database, /^fielddesk_tc_validation_upgrade_[a-f0-9]{24}$/);
  const admin = new Client({ connectionString: url.toString(), ssl: false, connectionTimeoutMillis: 5000 });
  await admin.connect();
  try { await admin.query(`CREATE DATABASE "${database}"`); }
  finally { await admin.end(); }
  url.pathname = `/${database}`;
  const connectionString = url.toString();
  const ephemeralSigningKey = randomUUID();

  const envValues = {
    DATABASE_URL: connectionString, NODE_ENV: "test", JWT_SECRET: ephemeralSigningKey, ROOT_DOMAIN: "example.test",
    MAIL_PROVIDER: "resend", MAIL_API_KEY: "dummy", MAIL_REPLY_TO: "admin@fielddesk.dk",
    TIME_CONTROL_SCHEDULER_ENABLED: "false", TIME_CONTROL_MAIL_ENABLED: "false",
  };
  const originalEnv = new Map(Object.keys(envValues).map(key => [key, process.env[key]]));
  Object.assign(process.env, envValues);
  const originalFetch = global.fetch;
  let forbiddenNetworkCalls = 0;
  global.fetch = async () => { forbiddenNetworkCalls++; throw new Error("local_postgres_network_forbidden"); };
  const pool = new Pool({ connectionString: url.toString(), ssl: false, max: 6, connectionTimeoutMillis: 5000 });
  let appPool, mailService, originalSendEmail;
  let providerCalls = 0;
  const otherTenantId = randomUUID();
  let groupId, actorId, epoch;
  const configs = [];
  const wallDate = global.Date;

  async function tx(fn) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const value = await fn(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  const queryOne = async (sql, args = []) => (await pool.query(sql, args)).rows[0];
  const executionRow = id => queryOne("SELECT * FROM time_control_execution WHERE tenant_id=$1 AND id=$2", [HC, id]);
  const reportRow = id => queryOne("SELECT * FROM time_control_status_report WHERE tenant_id=$1 AND id=$2", [HC, id]);
  const receiptCount = async () => (await queryOne("SELECT count(*)::int AS n FROM time_control_operational_check WHERE tenant_id=$1", [HC])).n;

  try {
    const runner = require("../backend/scripts/db_migrate");
    const files = runner.getMigrationFiles();
    assert.ok(files.some(file => file.filename === "0060_time_control_observability.sql"),
      "The actual observability migration must be present.");
    const migrationClient = await pool.connect();
    try {
      await runner.ensureMigrationTable(migrationClient);
      await runner.runPendingMigrations(migrationClient, files, new Map());
    } finally { migrationClient.release(); }
    assert.equal((await queryOne("SELECT count(*)::int AS n FROM schema_migration WHERE success")).n, files.length,
      "Apply all current actual migrations, not a copied or truncated schema.");
    const server = await queryOne("SELECT current_database() AS name,current_user AS username,inet_server_port() AS port");
    assert.deepEqual(server, { name: database, username: "tc_validation", port: 55432 });

    appPool = require("../backend/src/db/pool");
    assert.equal((await appPool.query("SELECT current_database() AS name")).rows[0].name, database);
    mailService = require("../backend/src/services/mailService");
    originalSendEmail = mailService.sendEmail;
    // Install before monitor captures the default sender; every allowed transport is passed explicitly.
    mailService.sendEmail = async () => { forbiddenNetworkCalls++; throw new Error("local_postgres_provider_forbidden"); };
    const obs = require("../backend/src/modules/timeControl/timeControl.observability");
    const monitor = require("../backend/src/modules/timeControl/timeControl.monitor");
    const operation = require("../backend/src/modules/timeControl/timeControl.operation");
    const dates = require("../backend/src/modules/timeControl/timeControl.dates");
    assert.equal(obs.HC, HC);
    assert.equal(obs.DEP, DEP);

    // HC is created after migrations: migration 0060 cannot seed its policy in an empty database.
    await pool.query("INSERT INTO tenant(id,slug,name,status) VALUES($1,'hoyrup-clemmensen','HC local fixture','active'),($2,'monitor-other','Other fixture','active')", [HC, otherTenantId]);
    actorId = (await queryOne(
      `INSERT INTO tenant_user(tenant_id,email,name,role,status,password_hash)
       VALUES($1,'admin@example.test','Monitor fixture admin','tenant_admin','active','fixture') RETURNING id`, [HC])).id;
    groupId = (await queryOne(
      `INSERT INTO resource_groups(tenant_id,name,status,source,external_source,external_id)
       VALUES($1,'Monitor group 61','active','ekomplet','ekomplet','61') RETURNING id`, [HC])).id;
    await pool.query(
      `INSERT INTO time_control_settings(tenant_id,is_enabled,mode,live_enabled_at,live_enabled_by_user_id,friday_manager_emails)
       VALUES($1,true,'live','2026-10-12T06:00:00Z',$2,$3::jsonb)`, [HC, actorId, JSON.stringify([DEP])]);
    for (const fitterId of FITTERS) {
      const email = `fixture-${fitterId}@example.test`;
      await pool.query("INSERT INTO fitter(tenant_id,fitter_id,name,email,is_active_derived) VALUES($1,$2,$3,$4,true)", [HC, fitterId, `Fixture ${fitterId}`, email]);
      await pool.query("INSERT INTO resource_group_members(tenant_id,group_id,fitter_id,source) VALUES($1,$2,$3,'ekomplet')", [HC, groupId, fitterId]);
      const config = await queryOne(
        `INSERT INTO time_control_employee_config(tenant_id,internal_ref,fitter_id,approved_group_id,approved_email,
         email_source,email_source_value,email_approved_at,email_approved_by_user_id,approval_reason,approval_version)
         VALUES($1,$2,$3,$4,$5,'admin_override',$5,now(),$6,'local monitor fixture',1) RETURNING *`,
        [HC, `FIXTURE_${fitterId}`, fitterId, groupId, email, actorId]);
      configs.push(config);
    }
    const identity = config => ({ fitter_id: config.fitter_id, group_id: groupId, approval_version: 1, approved_email: config.approved_email });
    // Immutable fixture epoch, no operation activation service, wall-clock substitution or production state.
    epoch = await queryOne(
      `INSERT INTO time_control_operation(tenant_id,group_id,covered_from,started_at,started_by_user_id,cohort_json)
       VALUES($1,$2,'2026-10-12','2026-10-12T06:00:00Z',$3,$4::jsonb) RETURNING *`,
      [HC, groupId, actorId, JSON.stringify(configs.map(config => ({ fitter_id: config.fitter_id, identity_hash: operation.identityHash(identity(config)) })))]);
    await pool.query("INSERT INTO time_control_operation_state(tenant_id,group_id,operation_id,status) VALUES($1,$2,$3,'active')", [HC, groupId, epoch.id]);
    await pool.query(
      `INSERT INTO time_control_monitor_policy(tenant_id,is_enabled,first_schedule_on,status_recipient_email)
       VALUES($1,true,'2026-10-13',$2)`, [HC, DEP]);
    const policy = await obs.activePolicy(pool, HC);
    assert.equal(policy.operation_id, epoch.id);
    assert.equal(policy.first_day, "2026-10-13");
    assert.deepEqual(epoch.cohort_json.map(member => member.fitter_id).sort(), [...FITTERS].sort());
    const immutableEpoch = JSON.stringify(epoch);

    const slotFor = (day, type = "daily_09") => {
      const slot = obs.slotsForDay(day).find(value => value.controlType === type);
      assert.ok(slot, `Missing fixture slot ${day}:${type}`);
      return slot;
    };
    const ensure = (day, type) => obs.ensureExecution(pool, { tenantId: HC, policy, slot: slotFor(day, type) });
    const begin = (day, type = "daily_09") => {
      const slot = slotFor(day, type);
      return obs.beginExecution({ tenantId: HC, scheduled: slot, now: slot.scheduledAt });
    };
    const watch = now => monitor.monitor({ tenantId: HC, now: new Date(now), sendReports: false });
    async function seedRun({ day, type = "daily_09", owner = HC, triggeredBy = "scheduler", status = "completed", resultStatus = "ok" }, client = pool) {
      const run = (await client.query(
        `INSERT INTO time_control_run(tenant_id,control_type,controlled_date,mode,status,required_hours,triggered_by,started_at,finished_at)
         VALUES($1,$2,$3::date,'live',$4,7.5,$5,$6,$7) RETURNING *`,
        [owner, type, day, status, triggeredBy, obs.scheduledAt(dates.addDaysIso(day, 1), 9), obs.scheduledAt(dates.addDaysIso(day, 1), 9)])).rows[0];
      if (owner === HC) for (const config of configs) {
        await client.query(
          `INSERT INTO time_control_result(tenant_id,run_id,employee_config_id,fitter_id,internal_ref,required_hours,
           valid_hours,missing_hours,status,coverage_status,identity_snapshot)
           VALUES($1,$2,$3,$4,$5,7.5,$6,$7,$8,$9,$10::jsonb)`,
          [HC, run.id, config.id, config.fitter_id, config.internal_ref, resultStatus === "ok" ? 7.5 : 0,
            resultStatus === "data_incomplete" ? null : resultStatus === "missing_hours" ? 7.5 : 0,
            resultStatus, resultStatus === "data_incomplete" ? "incomplete" : "complete",
            JSON.stringify({ ...identity(config), hours_dataset: { server_captured: true } })]);
      }
      return run;
    }
    async function seedPendingMail(run) {
      const template = await queryOne("SELECT id FROM email_template WHERE tenant_id IS NULL AND template_key='time_control.missing_hours.employee' AND is_active AND locale='da-DK'");
      assert.ok(template);
      const outbox = await queryOne(
        `INSERT INTO email_outbox(tenant_id,template_id,template_key,recipient_email,subject,html_body,text_body,
         source_type,source_id,idempotency_key,payload_json)
         VALUES($1,$2,'time_control.missing_hours.employee','fixture-15@example.test','Local fixture','<p>Local fixture</p>',
         'Local fixture','time_control',$3,$4,$5::jsonb) RETURNING *`,
        [HC, template.id, run.id, `time_control:monitor-fixture:${run.id}`, JSON.stringify({ sender: SENDER, reply_to: "admin@fielddesk.dk", cc_emails: [DEP] })]);
      await pool.query(
        `INSERT INTO time_control_mail_log(tenant_id,run_id,mail_type,mode,status,recipient_emails,cc_emails,subject,
         body_preview,email_outbox_id,idempotency_key)
         VALUES($1,$2,'employee_missing_hours','live','queued',$3::jsonb,$4::jsonb,'Local fixture','Local fixture',$5,$6)`,
        [HC, run.id, JSON.stringify([outbox.recipient_email]), JSON.stringify([DEP]), outbox.id, `time_control:monitor-log:${run.id}`]);
      return outbox;
    }
    async function assertMessage(message, options, report) {
      assert.equal(message.to, DEP);
      assert.deepEqual(message.cc, []);
      assert.equal(message.from, SENDER);
      assert.equal(message.replyTo, "admin@fielddesk.dk");
      assert.equal(message.tenantId, HC);
      assert.equal(message.template, "time_control.daily_status");
      assert.equal(options.idempotencyKey, report.idempotency_key);
      assert.equal(options.timeoutMs, 15000);
      assert.doesNotMatch(message.text, /LKE@|sensitive-fixture|fixture-\d+@/i);
      assert.match(message.text, /Provideraccept er ikke bevis/);
      const durableClaim = await reportRow(report.id);
      assert.equal(durableClaim.status, "sending", "Claim must commit before entering the mock transport.");
      assert.ok(durableClaim.last_attempt_at);
      assert.equal(global.Date, wallDate, "Do not fake Date: sender claims use PostgreSQL now().");
    }
    function sender(report, behavior = async () => ({ provider: "resend", providerMessageId: `local-monitor-${randomUUID()}` })) {
      return async (message, options) => {
        providerCalls++;
        await assertMessage(message, options, report);
        return behavior(message, options);
      };
    }
    const send = (report, sendEmailFn) => monitor.sendReport({ tenantId: HC, reportId: report.id, sendEmailFn });
    const report = reportDate => monitor.enqueueReport({ tenantId: HC, reportDate });

    await t.test("durable slot and independent redacted steps survive evaluation rollback; steps are immutable", async () => {
      const committedRun = await seedRun({ day: "2026-11-02", type: "manual", triggeredBy: "manual" });
      const client = await pool.connect();
      let execution, rolledBackRun;
      try {
        await client.query("BEGIN");
        rolledBackRun = await seedRun({ day: "2026-11-03", type: "manual", triggeredBy: "manual" }, client);
        execution = await ensure("2026-11-03");
        await obs.recordStep({ tenantId: HC, executionId: execution.id, step: "run_binding", status: "completed",
          counts: { run_id: committedRun.id, controlled_date: "2026-11-02" } });
        await obs.recordStep({ tenantId: HC, executionId: execution.id, step: "capture_page", status: "failed",
          counts: { page: 2, pass: 1, row_count: 10, raw_payload: "sensitive-fixture", apikey: "sensitive-fixture", duration_ms: 1000 },
          errorCode: new Error("sensitive-fixture https://example.test/private"),
          startedAt: new Date("2026-11-03T08:00:00Z"), finishedAt: new Date("2026-11-03T08:00:01Z") });
        assert.equal((await executionRow(execution.id)).status, "planned");
        await client.query("ROLLBACK");
      } finally { client.release(); }
      assert.equal(await queryOne("SELECT id FROM time_control_run WHERE tenant_id=$1 AND id=$2", [HC, rolledBackRun.id]), undefined);
      assert.equal((await executionRow(execution.id)).id, execution.id);
      assert.equal((await executionRow(execution.id)).run_id, committedRun.id);
      const binding = await queryOne("SELECT * FROM time_control_execution_step WHERE tenant_id=$1 AND execution_id=$2 AND step='run_binding'", [HC, execution.id]);
      assert.deepEqual(binding.counts, { run_id: committedRun.id, controlled_date: "2026-11-02" });
      const step = await queryOne("SELECT * FROM time_control_execution_step WHERE tenant_id=$1 AND execution_id=$2 AND step='capture_page'", [HC, execution.id]);
      assert.deepEqual(step.counts, { page: 2, pass: 1, row_count: 10, duration_ms: 1000 });
      assert.equal(step.error_code, "time_control_failed");
      assert.equal(Number(step.duration_ms), 1000);
      assert.doesNotMatch(JSON.stringify(step), /sensitive-fixture|apikey|raw_payload/);
      for (const sql of [
        "UPDATE time_control_execution_step SET status='completed' WHERE tenant_id=$1 AND id=$2",
        "DELETE FROM time_control_execution_step WHERE tenant_id=$1 AND id=$2",
      ]) await assert.rejects(pool.query(sql, [HC, step.id]), error => error.code === "P0001");
    });

    await t.test("composite execution, group, run and step foreign keys reject cross-tenant links", async () => {
      const execution = await ensure("2026-11-04");
      await assert.rejects(pool.query(
        `INSERT INTO time_control_execution(tenant_id,operation_id,group_id,scheduled_at,controlled_date,control_type,origin)
         VALUES($1,$2,$3,'2026-11-04T08:00:00Z','2026-11-03','daily_09','scheduled')`,
        [otherTenantId, epoch.id, groupId]), error => error.code === "23503");
      await assert.rejects(pool.query("UPDATE time_control_execution SET group_id=$3 WHERE tenant_id=$1 AND id=$2", [HC, execution.id, randomUUID()]), error => error.code === "23503");
      const foreignRun = await seedRun({ owner: otherTenantId, day: "2026-11-03" });
      await assert.rejects(pool.query("UPDATE time_control_execution SET run_id=$3 WHERE tenant_id=$1 AND id=$2", [HC, execution.id, foreignRun.id]), error => error.code === "23503");
      await assert.rejects(obs.recordStep({ tenantId: otherTenantId, executionId: execution.id, step: "capture_page", status: "started" }), error => error.code === "23503");
      await assert.rejects(pool.query(
        "INSERT INTO time_control_monitor_policy(tenant_id,is_enabled,first_schedule_on,status_recipient_email) VALUES($1,true,'2026-10-13',$2)",
        [otherTenantId, DEP]), error => error.code === "23514");
      await assert.rejects(pool.query("UPDATE time_control_monitor_policy SET status_recipient_email='other@example.test' WHERE tenant_id=$1", [HC]), error => error.code === "23514");
      assert.equal(await obs.activePolicy(pool, otherTenantId), null);
      const other = await obs.getOverview({ tenantId: otherTenantId, now: new Date("2026-10-14T07:20:00Z") });
      assert.deepEqual(other.executions, []);
      assert.deepEqual(other.reports, []);
    });

    let successfulExecution;
    await t.test("daily 09:00-09:02 admission, cross-minute concurrent claim and restart keep one durable slot and actual start", async () => {
      const slot = slotFor("2026-10-13");
      await assert.rejects(obs.beginExecution({ tenantId: HC, scheduled: slot, now: new Date("2026-10-12T07:00:00Z") }), /time_control_monitor_schedule_not_started/);
      for (const value of ["2026-10-13T06:59:59.999Z", "2026-10-13T07:02:00Z"]) {
        await assert.rejects(obs.beginExecution({ tenantId: HC, scheduled: slot, now: new Date(value) }), /time_control_scheduled_start_window_expired/);
      }
      const starts = [new Date("2026-10-13T07:00:00Z"), new Date("2026-10-13T07:01:00Z")];
      const attempts = await Promise.all(starts.map(now => obs.beginExecution({ tenantId: HC, scheduled: slot, now })));
      assert.equal(attempts.filter(Boolean).length, 1);
      successfulExecution = attempts.find(Boolean);
      assert.equal((await executionRow(successfulExecution.id)).status, "running");
      assert.equal((await executionRow(successfulExecution.id)).scheduled_at.toISOString(), "2026-10-13T07:00:00.000Z");
      assert.equal((await executionRow(successfulExecution.id)).started_at.toISOString(), starts[attempts.findIndex(Boolean)].toISOString());
      const { execFileSync } = require("node:child_process");
      const restartProof = JSON.parse(execFileSync(process.execPath, ["-e", `
        global.fetch=async()=>{throw new Error("local_postgres_network_forbidden");};
        const obs=require("./backend/src/modules/timeControl/timeControl.observability");
        const pool=require("./backend/src/db/pool");
        (async()=>{try{
          const claim=await obs.beginExecution({tenantId:${JSON.stringify(HC)},
            scheduled:${JSON.stringify(slot)},now:new Date("2026-10-13T07:01:59.999Z")});
          const rows=await pool.query("SELECT id,status FROM time_control_execution WHERE tenant_id=$1 AND scheduled_at=$2 AND control_type='daily_09'",
            [${JSON.stringify(HC)},"2026-10-13T07:00:00Z"]);
          console.log(JSON.stringify({claim,rows:rows.rows}));
        }finally{await pool.end();}})().catch(()=>{console.error("restart_probe_failed");process.exitCode=1;});
      `], { cwd: path.resolve(__dirname, ".."), env: { ...process.env }, encoding: "utf8", timeout: 15000 }));
      assert.equal(restartProof.claim, null);
      assert.deepEqual(restartProof.rows, [{ id: successfulExecution.id, status: "running" }]);
      assert.equal((await queryOne("SELECT count(*)::int AS n FROM time_control_execution_step WHERE tenant_id=$1 AND execution_id=$2 AND step='scheduled_start'", [HC, successfulExecution.id])).n, 1);
    });

    await t.test("late first admission preserves 09:01:59.999 as actual start and the separate 09:00 slot timestamp", async () => {
      const slot = slotFor("2026-11-24");
      const actual = new Date("2026-11-24T08:01:59.999Z");
      const claim = await obs.beginExecution({ tenantId: HC, scheduled: slot, now: actual });
      assert.ok(claim);
      const row = await executionRow(claim.id);
      assert.equal(row.scheduled_at.toISOString(), "2026-11-24T08:00:00.000Z");
      assert.equal(row.started_at.toISOString(), actual.toISOString());
      assert.equal(await obs.beginExecution({ tenantId: HC, scheduled: slot, now: actual }), null);
      await assert.rejects(obs.beginExecution({ tenantId: HC, scheduled: slot, now: new Date("2026-11-24T08:02:00Z") }), /start_window_expired/);
    });

    await t.test("Friday 12:00 weekly window must not admit the separate daily 09:00 slot", async () => {
      await assert.rejects(obs.beginExecution({ tenantId: HC, scheduled: slotFor("2026-11-06", "daily_09"),
        now: new Date("2026-11-06T11:00:00Z") }), /time_control_scheduled_start_window_expired/);
      await assert.rejects(obs.beginExecution({ tenantId: HC, scheduled: slotFor("2026-11-06", "friday_weekly_v1"),
        now: new Date("2026-11-06T11:01:00Z") }), /time_control_scheduled_start_window_expired/);
    });

    await t.test("all six OK results finish successfully with zero employee mails and a manager status report", async () => {
      const run = await seedRun({ day: "2026-10-12" });
      const result = await obs.finishExecution({ tenantId: HC, executionId: successfulExecution.id, result: { run } });
      assert.equal(result.status, "completed");
      assert.equal(result.counts.ok, 6);
      assert.equal(result.counts.expected_mails, 0);
      assert.equal(result.counts.pending + result.counts.rejected + result.counts.unclear, 0);
      const stored = await executionRow(successfulExecution.id);
      assert.equal(stored.status, "completed");
      assert.equal(stored.run_id, run.id);
      assert.ok(stored.finished_at);
      const first = await report("2026-10-13");
      const second = await report("2026-10-13");
      assert.equal(first.id, second.id);
      assert.deepEqual(first.message_json, second.message_json);
      assert.match(first.message_json.text, /OK: 6/);
      assert.match(first.message_json.text, /Forventede medarbejdermails: 0/);
      assert.equal((await pool.query("SELECT id FROM email_outbox WHERE tenant_id=$1", [HC])).rowCount, 0);
    });

    await t.test("missing start is visible after two minutes; monitor rerun does not duplicate watchdog steps", async () => {
      const overview = await obs.getOverview({ tenantId: HC, now: new Date("2026-10-14T07:02:00Z") });
      assert.ok(overview.missing_expected.some(value => value.controlled_date === "2026-10-13"));
      await watch("2026-10-14T07:01:59Z");
      let row = await ensure("2026-10-14");
      assert.equal(row.status, "planned");
      await watch("2026-10-14T07:02:00Z");
      row = await executionRow(row.id);
      assert.equal(row.status, "missed");
      assert.equal(row.error_code, "time_control_expected_start_missing");
      await watch("2026-10-14T07:20:00Z");
      const rerun = await watch("2026-10-14T07:20:00Z");
      assert.deepEqual(rerun.delivery, []);
      assert.equal((await queryOne("SELECT count(*)::int AS n FROM time_control_execution_step WHERE tenant_id=$1 AND execution_id=$2 AND step='watchdog'", [HC, row.id])).n, 1);
      const statusReport = await report("2026-10-14");
      assert.match(statusReport.message_json.text, /Ikke startet/);
      assert.match(statusReport.message_json.text, /Den planlagte kontrol startede ikke/);
      assert.doesNotMatch(statusReport.message_json.text, /time_control_expected_start_missing/);
    });

    await t.test("running execution fails at fifteen-minute deadline, never before, without employee transport", async () => {
      const execution = await begin("2026-10-15");
      assert.ok(execution);
      await watch("2026-10-15T07:14:59Z");
      assert.equal((await executionRow(execution.id)).status, "running");
      await watch("2026-10-15T07:15:00Z");
      let stored = await executionRow(execution.id);
      assert.equal(stored.status, "failed");
      assert.equal(stored.error_code, "time_control_execution_deadline_exceeded");
      await watch("2026-10-15T07:20:00Z");
      stored = await executionRow(execution.id);
      assert.equal(stored.finished_at.toISOString(), "2026-10-15T07:15:00.000Z");
      assert.equal(providerCalls, 0);
    });

    let pendingOutbox;
    await t.test("pending expected employee mail is detected without dispatching or changing the outbox", async () => {
      const execution = await begin("2026-10-16");
      const run = await seedRun({ day: "2026-10-15", resultStatus: "missing_hours" });
      pendingOutbox = await seedPendingMail(run);
      const before = JSON.stringify(pendingOutbox);
      const result = await obs.finishExecution({ tenantId: HC, executionId: execution.id, result: { run } });
      assert.equal(result.status, "partial");
      assert.equal(result.counts.under_norm, 6);
      assert.equal(result.counts.expected_mails, 1);
      assert.equal(result.counts.pending, 1);
      await watch("2026-10-16T07:14:59Z");
      assert.equal((await executionRow(execution.id)).error_code, "time_control_delivery_incomplete");
      await watch("2026-10-16T07:15:00Z");
      assert.equal((await executionRow(execution.id)).error_code, "time_control_expected_mail_unprocessed");
      await watch("2026-10-16T07:16:00Z");
      assert.equal((await queryOne("SELECT count(*)::int AS n FROM time_control_execution_step WHERE tenant_id=$1 AND execution_id=$2 AND step='watchdog_mail'", [HC, execution.id])).n, 1);
      const after = await queryOne("SELECT * FROM email_outbox WHERE tenant_id=$1 AND id=$2", [HC, pendingOutbox.id]);
      assert.equal(JSON.stringify(after), before);
      await pool.query("UPDATE time_control_execution SET status='failed',error_code='time_control_capture_api_error' WHERE tenant_id=$1 AND id=$2", [HC, execution.id]);
      await Promise.all([watch("2026-10-16T07:17:00Z"), watch("2026-10-16T07:17:00Z")]);
      const failed = await executionRow(execution.id);
      assert.equal(failed.status, "failed", "A pending mail must not downgrade a data failure to partial.");
      assert.equal(failed.error_code, "time_control_capture_api_error");
      assert.equal((await queryOne("SELECT count(*)::int AS n FROM time_control_execution_step WHERE tenant_id=$1 AND execution_id=$2 AND step='watchdog_mail'", [HC, execution.id])).n, 1);
      assert.equal(providerCalls, 0);
    });

    await t.test("report flags block transport; two concurrent calls claim and accept exactly once", async () => {
      const row = await report("2026-10-13");
      const sendEmailFn = sender(row);
      assert.equal((await send(row, sendEmailFn)).reason, "time_control_status_sending_disabled");
      assert.equal((await reportRow(row.id)).attempt_count, 0);
      process.env.TIME_CONTROL_SCHEDULER_ENABLED = "true";
      process.env.TIME_CONTROL_MAIL_ENABLED = "true";
      const before = providerCalls;
      const outcomes = await Promise.all([send(row, sendEmailFn), send(row, sendEmailFn)]);
      assert.equal(outcomes.filter(value => value.status === "accepted").length, 1);
      assert.equal(outcomes.filter(value => value.skipped).length, 1);
      assert.equal(providerCalls - before, 1);
      const stored = await reportRow(row.id);
      assert.equal(stored.status, "accepted");
      assert.equal(stored.attempt_count, 1);
      assert.ok(stored.provider_message_id);
      assert.equal(outcomes.find(value => value.status === "accepted").inbox_receipt_verified, false);
      assert.equal((await send(row, sendEmailFn)).skipped, true);
      assert.equal((await report("2026-10-13")).id, row.id);
      assert.equal(providerCalls - before, 1);
    });

    await t.test("HTTP 422 is a durable explicit rejection with backoff and at most three same-key attempts", async () => {
      const row = await report("2026-10-14");
      const sendEmailFn = sender(row, async () => {
        const error = new Error("sensitive-fixture provider body must not persist");
        error.code = "mail_provider_rejected_message";
        error.details = { status: 422, body: "sensitive-fixture" };
        throw error;
      });
      const before = providerCalls;
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (attempt > 1) await pool.query("UPDATE time_control_status_report SET next_attempt_at=now()-interval '1 second' WHERE tenant_id=$1 AND id=$2", [HC, row.id]);
        const result = await send(row, sendEmailFn);
        assert.equal(result.status, "rejected");
        assert.equal(result.error_code, "mail_provider_rejected_http_422");
        assert.equal(result.provider_http_status, 422);
        const stored = await reportRow(row.id);
        assert.equal(stored.attempt_count, attempt);
        assert.equal(stored.provider_message_id, null);
        assert.ok(stored.next_attempt_at > stored.completed_at);
        assert.doesNotMatch(JSON.stringify(stored), /sensitive-fixture/);
        assert.equal((await send(row, sendEmailFn)).skipped, true, "Backoff must be real PostgreSQL time, not a fake Date.");
      }
      await pool.query("UPDATE time_control_status_report SET next_attempt_at=now()-interval '1 second' WHERE tenant_id=$1 AND id=$2", [HC, row.id]);
      assert.equal((await send(row, sendEmailFn)).skipped, true);
      assert.equal(providerCalls - before, 3);
    });

    await t.test("unknown transport and invalid provider receipt remain terminal unclear, never automatically retried", async () => {
      for (const [day, behavior] of [
        ["2026-10-15", async () => { throw new Error("sensitive-fixture lost provider response"); }],
        ["2026-10-16", async () => ({ provider: "resend", providerMessageId: "" })],
      ]) {
        const row = await report(day);
        const before = providerCalls;
        const sendEmailFn = sender(row, behavior);
        assert.equal((await send(row, sendEmailFn)).status, "unclear");
        await pool.query("UPDATE time_control_status_report SET next_attempt_at=now()-interval '1 day' WHERE tenant_id=$1 AND id=$2", [HC, row.id]);
        const duplicate = await report(day);
        assert.equal(duplicate.id, row.id);
        assert.equal(duplicate.status, "unclear");
        assert.equal((await send(row, sendEmailFn)).skipped, true);
        const stored = await reportRow(row.id);
        assert.equal(stored.status, "unclear");
        assert.equal(stored.error_code, "provider_acceptance_unclear");
        assert.equal(stored.attempt_count, 1);
        assert.equal(stored.provider_message_id, null);
        assert.equal(providerCalls - before, 1);
        assert.doesNotMatch(JSON.stringify(stored), /sensitive-fixture/);
      }
    });

    await t.test("abandoned pre-network sending claim becomes unclear without transport or reclaim", async () => {
      const row = await report("2026-10-20");
      await pool.query("UPDATE time_control_status_report SET status='sending',attempt_count=1,last_attempt_at=now()-interval '3 minutes' WHERE tenant_id=$1 AND id=$2", [HC, row.id]);
      const before = providerCalls;
      const result = await watch("2026-10-20T07:20:00Z");
      assert.equal(result.abandoned_status_reports, 1);
      assert.equal((await reportRow(row.id)).status, "unclear");
      assert.equal((await send(row, sender(row))).skipped, true);
      assert.equal(providerCalls, before);
    });

    await t.test("downstream data failure still permits one safe manager report and no employee mail", async () => {
      const execution = await begin("2026-10-21");
      const beforeOutbox = (await pool.query("SELECT * FROM email_outbox WHERE tenant_id=$1 ORDER BY id", [HC])).rows;
      await obs.recordStep({ tenantId: HC, executionId: execution.id, step: "capture_page", status: "failed",
        counts: { page: 1, pass: 1, raw_response: "sensitive-fixture" }, errorCode: "time_control_capture_api_error" });
      const state = await obs.finishExecution({ tenantId: HC, executionId: execution.id, error: new Error("time_control_capture_api_error") });
      assert.equal(state.status, "failed");
      assert.equal(state.counts.expected_mails, 0);
      await watch("2026-10-21T07:20:00Z");
      const row = await report("2026-10-21");
      assert.match(row.message_json.text, /Fejlede/);
      assert.match(row.message_json.text, /Stoppunkt:/);
      assert.match(row.message_json.text, /Indhentning fra EK/);
      assert.match(row.message_json.text, /se detaljerne i driftsloggen/);
      assert.doesNotMatch(row.message_json.text, /time_control_capture_api_error/);
      const before = providerCalls;
      assert.equal((await send(row, sender(row))).status, "accepted");
      assert.equal(providerCalls - before, 1);
      assert.deepEqual((await pool.query("SELECT * FROM email_outbox WHERE tenant_id=$1 ORDER BY id", [HC])).rows, beforeOutbox);
    });

    await t.test("manual and historical rows cannot qualify week, create receipts or alter immutable operation", async () => {
      const before = await receiptCount();
      assert.equal(before, 0, "Observability itself must never create qualification receipts.");
      for (const args of [
        { day: "2026-10-12", type: "manual", triggeredBy: "manual" },
        { day: "2026-10-13", triggeredBy: "manual_test" },
        { day: "2026-10-14", triggeredBy: "scheduler" },
      ]) {
        const run = await seedRun(args);
        const evidence = await obs.runEvidence(pool, { tenantId: HC, runId: run.id });
        assert.equal(evidence.results.length, 6);
        const results = (await pool.query("SELECT * FROM time_control_result WHERE tenant_id=$1 AND run_id=$2", [HC, run.id])).rows;
        const startedAt = obs.scheduledAt(dates.addDaysIso(args.day, 1), 9);
        const checks = await tx(client => operation.recordChecks(client, { tenantId: HC, run, results,
          execution: { historical: args.triggeredBy === "scheduler", controlledDate: args.day, startedAt,
            now: () => new Date(startedAt.getTime() + 1000), operationIds: [epoch.id] } }));
        assert.deepEqual(checks, []);
      }
      for (const config of configs) {
        const gate = await tx(client => operation.checkGate(client, { tenantId: HC, identity: identity(config), friday: "2026-10-16" }));
        assert.equal(gate.eligible, false);
        assert.match(gate.reason, /^scheduled_control_missing:daily_09:/);
      }
      assert.equal(await receiptCount(), before);
      assert.equal(JSON.stringify(await queryOne("SELECT * FROM time_control_operation WHERE tenant_id=$1 AND id=$2", [HC, epoch.id])), immutableEpoch);
      const operationState = await queryOne("SELECT * FROM time_control_operation_state WHERE tenant_id=$1 AND group_id=$2", [HC, groupId]);
      assert.equal(operationState.status, "active");
      assert.equal(operationState.operation_id, epoch.id);
    });

    await t.test("database policy stop and tenant boundary prevent additional report claims", async () => {
      const row = await report("2026-10-22");
      const before = providerCalls;
      await pool.query("UPDATE time_control_monitor_policy SET is_enabled=false WHERE tenant_id=$1", [HC]);
      try {
        assert.equal((await send(row, sender(row))).reason, "time_control_status_sending_disabled");
        assert.equal((await reportRow(row.id)).attempt_count, 0);
        assert.equal((await watch("2026-10-22T07:20:00Z")).skipped, true);
      } finally { await pool.query("UPDATE time_control_monitor_policy SET is_enabled=true WHERE tenant_id=$1", [HC]); }
      assert.equal((await monitor.sendReport({ tenantId: otherTenantId, reportId: row.id, sendEmailFn: sender(row) })).skipped, true);
      assert.equal(providerCalls, before);
      assert.equal((await reportRow(row.id)).status, "queued");
      assert.equal(forbiddenNetworkCalls, 0);
      assert.equal(global.Date, wallDate);
      const employeeMail = await queryOne("SELECT * FROM email_outbox WHERE tenant_id=$1 AND id=$2", [HC, pendingOutbox.id]);
      assert.equal(employeeMail.status, "queued");
      assert.equal(employeeMail.attempt_count, 0);
      assert.equal(employeeMail.provider_message_id, null);
    });

    await t.test("report body and identity are immutable; provider-time row lock fences late watchdog changes and persists receipt", async () => {
      const databaseNow = (await queryOne("SELECT clock_timestamp() AS at")).at;
      const day = dates.addDaysIso(dates.getCopenhagenParts(databaseNow).isoDate, 20);
      const row = await report(day);
      assert.equal(row.expires_at.toISOString(), new Date(obs.reportDueAt(day).getTime() + 48 * 3600000).toISOString());
      const before = providerCalls;
      const providerMessageId = `local-locked-report-${randomUUID()}`;
      const result = await send(row, sender(row, async () => {
        // A separate connection must not rewrite a live claim while transport owns its row lock.
        await assert.rejects(tx(async client => {
          await client.query("SET LOCAL lock_timeout='100ms'");
          await client.query("UPDATE time_control_status_report SET status='unclear',error_code='provider_acceptance_unclear' WHERE tenant_id=$1 AND id=$2 AND status='sending'", [HC, row.id]);
        }), error => error.code === "55P03");
        return { provider: "resend", providerMessageId };
      }));
      assert.equal(result.status, "accepted");
      assert.equal(result.provider_message_id, providerMessageId);
      assert.equal(providerCalls - before, 1);
      const accepted = await reportRow(row.id);
      assert.equal(accepted.status, "accepted");
      assert.equal(accepted.provider_message_id, providerMessageId);
      assert.equal(accepted.attempt_count, 1);
      const mutations = [
        ["message_json=jsonb_set(message_json,'{text}',to_jsonb($3::text))", "changed fixture body"],
        ["idempotency_key=$3", `${row.idempotency_key}:changed`],
        ["report_date=$3::date", dates.addDaysIso(day, 1)],
        ["tenant_id=$3::uuid", otherTenantId],
        ["expires_at=$3::timestamptz", new Date(row.expires_at.getTime() + 1000)],
      ];
      for (const [assignment, value] of mutations) {
        await assert.rejects(pool.query(`UPDATE time_control_status_report SET ${assignment} WHERE tenant_id=$1 AND id=$2`, [HC, row.id, value]),
          error => error.code === "P0001" && error.message === "time_control_status_message_immutable");
      }
      assert.deepEqual(await reportRow(row.id), accepted);
      assert.equal((await report(day)).id, row.id, "Idempotent no-op enqueue must remain allowed by the immutability trigger.");
      assert.equal((await send(row, sender(row))).skipped, true);
      assert.equal(providerCalls - before, 1);
    });

    await t.test("old report date expires at due plus 48 hours even when newly created; enqueue cannot revive it", async () => {
      const databaseNow = (await queryOne("SELECT clock_timestamp() AS at")).at;
      const day = dates.addDaysIso(dates.getCopenhagenParts(databaseNow).isoDate, -3);
      const row = await report(day);
      const after = (await queryOne("SELECT clock_timestamp() AS at")).at;
      assert.ok(row.created_at >= databaseNow && row.created_at <= after, "Fixture must be freshly inserted, not backdated.");
      assert.equal(row.expires_at.toISOString(), new Date(obs.reportDueAt(day).getTime() + 48 * 3600000).toISOString());
      assert.ok(row.expires_at < databaseNow);
      const before = providerCalls;
      const results = await Promise.all([send(row, sender(row)), send(row, sender(row))]);
      assert.ok(results.every(result => result.skipped === true));
      const duplicate = await report(day);
      assert.equal(duplicate.id, row.id);
      assert.equal(duplicate.expires_at.toISOString(), row.expires_at.toISOString());
      assert.equal((await send(duplicate, sender(duplicate))).skipped, true);
      const stored = await reportRow(row.id);
      assert.equal(stored.status, "queued");
      assert.equal(stored.attempt_count, 0);
      assert.equal(stored.last_attempt_at, null);
      assert.equal(stored.provider_message_id, null);
      assert.equal(providerCalls, before);
    });

    await t.test("changed operation epoch cannot claim an older planned slot or process its run or mail", async () => {
      const scheduled = slotFor("2026-11-10");
      const oldSlot = await ensure("2026-11-10");
      assert.equal(oldSlot.status, "planned");
      const before = await executionRow(oldSlot.id);
      const replacementEpoch = await queryOne(
        `INSERT INTO time_control_operation(tenant_id,group_id,covered_from,started_at,started_by_user_id,cohort_json)
         VALUES($1,$2,'2026-11-09','2026-11-09T06:00:00Z',$3,$4::jsonb) RETURNING *`,
        [HC, groupId, actorId, JSON.stringify(epoch.cohort_json)]);
      let runCalls = 0, dispatchCalls = 0;
      await pool.query("UPDATE time_control_operation_state SET operation_id=$3 WHERE tenant_id=$1 AND group_id=$2", [HC, groupId, replacementEpoch.id]);
      try {
        const changedPolicy = await obs.activePolicy(pool, HC);
        assert.equal(changedPolicy.operation_id, replacementEpoch.id);
        assert.equal(await obs.ensureExecution(pool, { tenantId: HC, policy: changedPolicy, slot: scheduled }), undefined);
        await assert.rejects(begin("2026-11-10"), /time_control_monitor_operation_not_admitted/);
        const scheduler = require("../backend/src/modules/timeControl/timeControl.scheduler");
        const results = await scheduler._test.runTenantControls([HC], scheduled, {
          observer: obs, now: () => scheduled.scheduledAt,
          runControl: async () => { runCalls++; assert.fail("Old epoch collision must not run control."); },
          dispatch: async () => { dispatchCalls++; assert.fail("Old epoch collision must not dispatch mail."); },
        });
        assert.equal(results.length, 1);
        assert.equal(results[0].ok, false);
        assert.match(results[0].error, /time_control_monitor_operation_not_admitted/);
        assert.equal(runCalls, 0);
        assert.equal(dispatchCalls, 0);
        assert.deepEqual(await executionRow(oldSlot.id), before);
        assert.equal((await queryOne("SELECT count(*)::int AS n FROM time_control_execution_step WHERE tenant_id=$1 AND execution_id=$2", [HC, oldSlot.id])).n, 0);
        assert.equal(await receiptCount(), 0);
      } finally {
        await pool.query("UPDATE time_control_operation_state SET operation_id=$3 WHERE tenant_id=$1 AND group_id=$2", [HC, groupId, epoch.id]);
      }
      assert.equal((await obs.activePolicy(pool, HC)).operation_id, epoch.id);
      assert.equal(forbiddenNetworkCalls, 0);
    });
    await t.test("actual scheduled service pipeline commits independent traces, complete absent-fitter result and guarded one-shot mock dispatch", { timeout: 60000 }, async () => {
      const service = require("../backend/src/modules/timeControl/timeControl.service");
      const coverage = require("../backend/src/modules/timeControl/timeControl.coverage");
      const storage = require("../backend/src/modules/timeControl/timeControl.dataset");
      const automation = require("../backend/src/modules/timeControl/timeControl.automation");
      const processor = require("../backend/src/modules/notifications/emailOutbox.processor");
      const originalInvalidate = storage.invalidateHoursDataset;
      const RealDate = global.Date;
      const day = "2026-11-16";
      let clock = new RealDate("2026-11-17T08:01:00Z").getTime();
      let captureCalls = 0, pageCalls = 0, transportCalls = 0;
      const receiptsBefore = await receiptCount();
      const unrelatedOutbox = (await pool.query("SELECT * FROM email_outbox WHERE tenant_id=$1 ORDER BY id", [HC])).rows;
      await pool.query(
        `INSERT INTO tenant_user(tenant_id,email,name,role,status,password_hash)
         VALUES($1,$2,'Dennis Fixture','tenant_admin','active','fixture')`, [HC, DEP]);
      await pool.query(
        `UPDATE time_control_settings SET employee_cc_emails=$2::jsonb,internal_error_emails=$2::jsonb,
         friday_manager_emails=$2::jsonb WHERE tenant_id=$1`, [HC, JSON.stringify([DEP])]);
      await pool.query("INSERT INTO time_control_pay_code_rule(tenant_id,pay_code,counts_as_valid_hours,label) VALUES($1,'3300',true,'Local working hours') ON CONFLICT(tenant_id,pay_code) DO UPDATE SET counts_as_valid_hours=true", [HC]);
      await pool.query("UPDATE fitter SET name='Patrick Fixture' WHERE tenant_id=$1 AND fitter_id='208'", [HC]);
      global.Date = class ControlledPipelineDate extends RealDate {
        constructor(...args) { super(...(args.length ? args : [clock])); }
        static now() { return clock; }
      };
      // Only the isolated fixture's mutable invalidation head follows the source clock; DB sender claims remain real-time.
      storage.invalidateHoursDataset = async (client, input) => {
        const value = await originalInvalidate(client, input);
        await client.query(
          `UPDATE time_control_hours_dataset_head SET invalidated_at=$3::timestamptz
           WHERE tenant_id=$1 AND controlled_date=$2::date AND invalidated_at IS NOT NULL`,
          [input.tenantId, input.controlledDate, new Date(clock)]);
        return value;
      };
      try {
        const execution = await obs.beginExecution({ tenantId: HC, scheduled: slotFor("2026-11-17"), now: new Date(clock) });
        assert.ok(execution);
        assert.equal((await executionRow(execution.id)).started_at.toISOString(), "2026-11-17T08:01:00.000Z");
        const trace = async (step, status, counts = {}, errorCode = null) => {
          await obs.recordStep({ tenantId: HC, executionId: execution.id, step, status, counts, errorCode });
          const independent = await queryOne(
            "SELECT id FROM time_control_execution_step WHERE tenant_id=$1 AND execution_id=$2 AND step=$3 AND status=$4 ORDER BY id DESC LIMIT 1",
            [HC, execution.id, step, status]);
          assert.ok(independent, "Each trace must already be visible on a separate connection, including during evaluation.");
          if (step === "queue_committed" && status === "completed") {
            assert.equal((await queryOne(
              `SELECT count(*)::int AS n FROM time_control_mail_log m JOIN time_control_run r ON r.id=m.run_id AND r.tenant_id=m.tenant_id
               WHERE m.tenant_id=$1 AND r.controlled_date=$2::date AND r.control_type='daily_09' AND m.status='queued'`, [HC, day])).n, 1);
          }
        };
        const result = await service.runTimeControlWithPool({ tenantId: HC, controlledDate: day, controlType: "daily_09", triggeredBy: "scheduler" }, {
          trace,
          captureDay: async ({ tenantId, controlledDate, trace: captureTrace }) => {
            captureCalls++;
            assert.equal(tenantId, HC);
            assert.equal(controlledDate, day);
            clock += 1;
            const rows = [
              ...FITTERS.filter(id => id !== "208").map((id, index) => ({
                id: String(10000 + index), date: day, fitterId: Number(id), projectId: 123,
                projectReference: "LOCAL", categoryId: 72, categoryReference: "3300", hours: 7.5,
              })),
              ...Array.from({ length: 25 }, (_, index) => ({
                id: String(11000 + index), date: day, fitterId: 999, projectId: 123,
                projectReference: "LOCAL", categoryId: 72, categoryReference: "3300", hours: 0,
              })),
            ];
            return coverage.captureHoursDataset({ tenantId, controlledDate, pageSize: 10,
              evidence: { endpointContract: {
                version: "ek_v4_all_projects_single_day_two_pass_v3", endpoint: "/api/v4/paginatedfitterhours",
                scope: "tenant_all_projects", requestParameters: { fromDate: day, toDate: day, pageSize: 10 },
                verificationReference: "controlled-local-fixture-not-external-evidence",
              } },
              fetchPage: async ({ page }) => {
                pageCalls++;
                const slice = rows.slice((page - 1) * 10, page * 10);
                await captureTrace("capture_page", "completed", { page, row_count: slice.length });
                return { rows: slice, currentPage: page, nextPage: page * 10 < rows.length ? page + 1 : null,
                  total: rows.length, status: 200, hasErrors: false, errorCount: 0 };
              },
            });
          },
        });
        assert.equal(result.run.status, "completed", result.run.error_reason);
        assert.equal(result.run.mode, "live");
        assert.equal(result.results.length, 6);
        assert.equal(result.results.filter(row => row.status === "ok" && Number(row.valid_hours) === 7.5).length, 5);
        const patrick = result.results.find(row => row.fitter_id === "208");
        assert.equal(patrick.status, "missing_hours");
        assert.equal(Number(patrick.valid_hours), 0);
        assert.equal(Number(patrick.missing_hours), 7.5);
        assert.equal(patrick.coverage_status, "complete");
        assert.equal(patrick.identity_snapshot.hours_dataset.server_captured, true);
        assert.equal(captureCalls, 1);
        assert.ok(pageCalls >= 6, "Synthetic complete evidence must traverse both passes, not a lone page.");
        assert.equal(result.mails.length, 1);
        assert.equal(result.mails[0].status, "queued");
        assert.equal((await executionRow(execution.id)).run_id, result.run.id);
        assert.equal(await receiptCount(), receiptsBefore + 6, "Only this timely scheduler pipeline may create its six genuine fixture receipts.");
        const actualReceipts = (await pool.query("SELECT started_at FROM time_control_operational_check WHERE tenant_id=$1 AND run_id=$2", [HC, result.run.id])).rows;
        assert.ok(actualReceipts.every(row => row.started_at.toISOString() === "2026-11-17T08:01:00.000Z"));
        const replay = await service.runTimeControlWithPool({ tenantId: HC, controlledDate: day, controlType: "daily_09", triggeredBy: "scheduler" }, {
          captureDay: async () => { throw new Error("completed_slot_must_not_recapture"); },
        });
        assert.equal(replay.replayed, true);
        assert.equal(replay.run.id, result.run.id);
        assert.equal(await receiptCount(), receiptsBefore + 6);
        const steps = (await pool.query("SELECT * FROM time_control_execution_step WHERE tenant_id=$1 AND execution_id=$2 ORDER BY id", [HC, execution.id])).rows;
        for (const step of ["capture_started", "capture_completed", "run_binding", "validation", "calculation", "mail_decision", "queue_committed"]) {
          assert.ok(steps.some(row => row.step === step && row.status === (step === "capture_started" ? "started" : "completed")), `Missing actual pipeline trace ${step}`);
        }
        // Real PostgreSQL stamps started_at with wall time; adjust only this run fixture for the real dispatch guard.
        await pool.query("UPDATE time_control_run SET started_at=$3 WHERE tenant_id=$1 AND id=$2", [HC, result.run.id, new Date(clock)]);
        const dispatch = () => automation.dispatchRun({ tenantId: HC, result, trace }, input => processor.processDueEmails({
          ...input, sendEmailFn: async (message, options) => {
            transportCalls++;
            assert.equal(message.to, "fixture-208@example.test");
            assert.deepEqual(message.cc, [DEP]);
            assert.equal(message.from, SENDER);
            assert.equal(message.replyTo, "admin@fielddesk.dk");
            assert.equal(message.template, "time_control.missing_hours.employee");
            assert.match(message.text, /Patrick/);
            assert.ok(options.idempotencyKey.startsWith("time_control:"));
            assert.equal(options.timeoutMs, 15000);
            return { provider: "resend", providerMessageId: "local-pipeline-provider-receipt" };
          },
        }));
        const deliveries = await Promise.all([dispatch(), dispatch()]);
        assert.equal(deliveries.reduce((sum, value) => sum + value.sent, 0), 1, JSON.stringify(deliveries));
        assert.equal(deliveries.reduce((sum, value) => sum + value.dead_letter, 0), 0);
        assert.equal((await dispatch()).claimed, 0);
        assert.equal(transportCalls, 1);
        const sent = await queryOne("SELECT * FROM email_outbox WHERE tenant_id=$1 AND id=$2", [HC, result.mails[0].email_outbox_id]);
        assert.equal(sent.status, "sent");
        assert.equal(sent.provider_message_id, "local-pipeline-provider-receipt");
        const receiptStep = await queryOne("SELECT * FROM time_control_execution_step WHERE tenant_id=$1 AND execution_id=$2 AND step='provider_result' AND status='completed'", [HC, execution.id]);
        assert.ok(receiptStep);
        assert.equal((await obs.finishExecution({ tenantId: HC, executionId: execution.id, result })).status, "completed");
        const receiptsAfter = await receiptCount();
        const manual = await service.runTimeControlWithPool({ tenantId: HC, controlledDate: day, controlType: "manual", triggeredBy: "manual", dryRun: true }, {
          hoursDatasetId: patrick.hours_dataset_id,
        });
        assert.equal(manual.run.status, "completed");
        assert.equal(await receiptCount(), receiptsAfter, "Actual manual evaluation cannot manufacture scheduled qualification receipts.");
        assert.equal(JSON.stringify((await pool.query("SELECT * FROM email_outbox WHERE tenant_id=$1 AND id<>$2 ORDER BY id", [HC, sent.id])).rows), JSON.stringify(unrelatedOutbox));
        assert.equal((await queryOne("SELECT count(*)::int AS n FROM sync_job WHERE tenant_id=$1", [HC])).n, 0);
        assert.equal(forbiddenNetworkCalls, 0);
        t.diagnostic(`Actual pipeline: ${captureCalls} synthetic capture, ${pageCalls} local page calls, six complete results, one queued/simulated employee delivery, zero duplicate claims or manual receipts.`);
      } finally {
        storage.invalidateHoursDataset = originalInvalidate;
        global.Date = RealDate;
      }
    });
    t.diagnostic(`Fresh local database: ${database}; ${files.length} actual migrations; ${providerCalls} mocked status provider calls; ${forbiddenNetworkCalls} external calls.`);
  } finally {
    if (mailService && originalSendEmail) mailService.sendEmail = originalSendEmail;
    global.fetch = originalFetch;
    try { await appPool?.end(); }
    finally {
      try { await pool.end(); }
      finally {
        for (const [key, value] of originalEnv) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    }
  }
});
