"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const enabled = process.env.FIELD_DESK_LOCAL_PG_TEST === "1";

test("daily capture and operational-week gate: actual PostgreSQL, controlled clock, immutable history and dispatch", { skip: !enabled }, async () => {
  const { Client, Pool } = require("../backend/node_modules/pg");
  const url = new URL(process.env.FIELDDESK_TIME_CONTROL_TEST_DATABASE_URL || "postgres://example.invalid/blocked");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55432");
  assert.equal(url.username, "tc_validation");
  assert.equal(url.password, "");
  assert.match(url.pathname, /^\/fielddesk_tc_validation_upgrade_[a-f0-9]{24}$/);
  const database = `fielddesk_tc_validation_upgrade_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  try { await admin.query(`CREATE DATABASE "${database}"`); } finally { await admin.end(); }
  url.pathname = `/${database}`;
  const connectionString = url.toString();
  process.env.DATABASE_URL = connectionString;
  process.env.NODE_ENV = "test";
  const ephemeralSigningKey = randomUUID();
  process.env.JWT_SECRET = ephemeralSigningKey;
  process.env.ROOT_DOMAIN = "example.test";
  process.env.MAIL_PROVIDER = "resend";
  process.env.MAIL_API_KEY = "dummy";
  process.env.MAIL_REPLY_TO = "admin@fielddesk.dk";
  process.env.TIME_CONTROL_SCHEDULER_ENABLED = "false";
  const pool = new Pool({ connectionString: url.toString(), max: 5 });
  const runner = require("../backend/scripts/db_migrate");
  const client = await pool.connect();
  try {
    await runner.ensureMigrationTable(client);
    await runner.runPendingMigrations(client, runner.getMigrationFiles(), new Map());
  } finally { client.release(); }
  const appPool = require("../backend/src/db/pool");
  const coverage = require("../backend/src/modules/timeControl/timeControl.coverage");
  const storage = require("../backend/src/modules/timeControl/timeControl.dataset");
  const orchestration = require("../backend/src/modules/timeControl/timeControl.orchestration");
  const operation = require("../backend/src/modules/timeControl/timeControl.operation");
  const weekly = require("../backend/src/modules/timeControl/timeControl.weekly");
  const service = require("../backend/src/modules/timeControl/timeControl.service");
  const dates = require("../backend/src/modules/timeControl/timeControl.dates");
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const RealDate = Date;
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error("local_postgres_network_forbidden"); };
  let clock = new RealDate("2026-10-12T06:00:00Z").getTime();
  global.Date = class ControlledDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  };
  const at = value => { clock = new RealDate(value).getTime(); };
  async function tx(fn) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const value = await fn(c);
      await c.query("COMMIT");
      return value;
    } catch (error) { await c.query("ROLLBACK"); throw error; }
    finally { c.release(); }
  }
  let sourceHours = 7;
  let sourceRows = null;
  let calls = 0;
  let simulatedProviderCalls = 0;
  async function captureDay({ controlledDate }) {
    calls++;
    // This is a controlled source fixture, never external zero-day or actual EK evidence.
    clock += 1;
    const rows = sourceRows || [
      { id:"1001", date:controlledDate, fitterId:290, projectId:123,
        projectReference:"LOCAL", categoryId:1, categoryReference:"3300", hours:sourceHours },
      ...Array.from({ length:29 }, (_, i) => ({
        id:String(2000 + i), date:controlledDate, fitterId:999, projectId:123,
        projectReference:"LOCAL", categoryId:1, categoryReference:"3300", hours:0,
      })),
    ];
    return coverage.captureHoursDataset({
      tenantId, controlledDate, pageSize: 10,
      evidence: { endpointContract: {
        version: "ek_v4_all_projects_single_day_two_pass_v3", endpoint: "/api/v4/paginatedfitterhours",
        scope: "tenant_all_projects", requestParameters: { fromDate: controlledDate, toDate: controlledDate, pageSize: 10 },
        verificationReference: "controlled-local-fixture-not-external-evidence",
      } },
      fetchPage: async ({ page }) => ({
        rows: rows.slice((page - 1) * 10, page * 10),
        currentPage:page, nextPage:page * 10 < rows.length ? page + 1 : null,
        total:rows.length, status:200, hasErrors:false, errorCount:0,
      }),
    });
  }
  let groupId;
  let actorId;
  const start = (coveredFrom, status = "active") => tx(c => operation.setOperation(c, {
    tenantId, groupId, actorId, coveredFrom, status,
  }));
  const run = (day, type = "daily_09", extra = {}) => service.runTimeControlWithPool({
    tenantId, controlledDate: day, controlType: type, triggeredBy: "scheduler", ...extra,
  }, { captureDay });
  try {
    await pool.query("INSERT INTO tenant(id,slug,name,status) VALUES($1,'operational-fixture','Local fixture','active'),($2,'other-operational','Other','active')", [tenantId, otherTenantId]);
    actorId = (await pool.query(
      `INSERT INTO tenant_user(tenant_id,email,name,role,status,password_hash)
       VALUES($1,'admin@example.test','Admin','tenant_admin','active','fixture') RETURNING id`, [tenantId])).rows[0].id;
    await pool.query(
      `INSERT INTO tenant_user(tenant_id,email,name,role,status,password_hash)
       VALUES($1,'dep@hoyrup-clemmensen.dk','DEP Fixture','tenant_admin','active','fixture')`, [tenantId]);
    groupId = (await pool.query(
      `INSERT INTO resource_groups(tenant_id,name,status,source,external_source,external_id)
       VALUES($1,'Group 61','active','ekomplet','ekomplet','61') RETURNING id`, [tenantId])).rows[0].id;
    await pool.query("INSERT INTO fitter(tenant_id,fitter_id,name,email,is_active_derived) VALUES($1,'290','MBO Fixture','mbo@example.test',true)", [tenantId]);
    await pool.query("INSERT INTO resource_group_members(tenant_id,group_id,fitter_id,source) VALUES($1,$2,'290','ekomplet')", [tenantId, groupId]);
    await pool.query(
      `INSERT INTO time_control_employee_config(tenant_id,internal_ref,fitter_id,approved_group_id,approved_email,
       email_source,email_source_value,email_approved_at,email_approved_by_user_id,approval_reason,approval_version)
       VALUES($1,'MBO','290',$2,'mbo@example.test','admin_override','mbo@example.test',now(),$3,'fixture',1)`,
      [tenantId, groupId, actorId]);
    const modeArgs = { tenantId, actorId, tenantSlug: "operational-fixture" };
    await assert.rejects(service.setMode({ ...modeArgs, mode: "live", confirm: "wrong" }), /live_confirm_required/);
    const drySettings = await service.setMode({ ...modeArgs, mode: "dry_run" });
    assert.equal(drySettings.live_enabled_at, null);
    assert.equal(drySettings.live_enabled_by_user_id, null);
    const liveArgs = { ...modeArgs, mode: "live", confirm: "AKTIVER:timekontrol-live:operational-fixture" };
    const liveSettings = await service.setMode(liveArgs);
    assert.equal(liveSettings.mode, "live");
    assert.equal(liveSettings.live_enabled_by_user_id, actorId);
    assert.ok(liveSettings.live_enabled_at);
    const repeatedLive = await service.setMode(liveArgs);
    assert.equal(repeatedLive.live_enabled_at.toISOString(), liveSettings.live_enabled_at.toISOString());
    const stoppedSettings = await service.setMode({ ...modeArgs, mode: "dry_run" });
    assert.equal(stoppedSettings.live_enabled_at, null);
    assert.equal(stoppedSettings.live_enabled_by_user_id, null);
    await service.setMode(liveArgs);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM time_control_settings WHERE tenant_id=$1", [otherTenantId])).rows[0].n, 0);
    await pool.query("INSERT INTO time_control_pay_code_rule(tenant_id,pay_code,counts_as_valid_hours) VALUES($1,'3300',true)", [tenantId]);
    const approvedIdentity = { fitter_id: "290", group_id: groupId, approval_version: 1, approved_email: "mbo@example.test" };
    const activeArgs = { tenantId, identity: approvedIdentity, controlledDate: "2026-10-12" };
    await assert.rejects(tx(c => operation.requireActiveIdentity(c, activeArgs)), /operation_not_active/);
    const epoch = await start("2026-10-12");
    assert.equal(epoch.covered_day, "2026-10-12");
    assert.deepEqual(await tx(c => operation.requireActiveIdentity(c, activeArgs)), { operation_id: epoch.id, receipt_ids: [] });
    await assert.rejects(tx(c => operation.requireActiveIdentity(c, { ...activeArgs, tenantId: otherTenantId })), /operation_not_active/);
    await assert.rejects(tx(c => operation.requireActiveIdentity(c, { ...activeArgs, controlledDate: "2026-10-11" })), /coverage_start_after_controlled_date/);
    await assert.rejects(tx(c => operation.setOperation(c, { tenantId: otherTenantId, groupId, actorId, coveredFrom: "2026-10-12", status: "active" })), /tenant_admin_required/);
    const period = dates.weeklyPeriod("2026-10-16");
    const automaticDispatch = async result => {
      // PostgreSQL uses wall time; align this isolated fixture with its controlled execution clock.
      await pool.query("UPDATE time_control_run SET started_at=$3 WHERE tenant_id=$1 AND id=$2", [tenantId, result.run.id, new Date(clock)]);
      process.env.TIME_CONTROL_SCHEDULER_ENABLED = "true";
      process.env.TIME_CONTROL_MAIL_ENABLED = "true";
      try {
        if (simulatedProviderCalls === 0 || result.run.control_type === "friday_weekly_v1" && simulatedProviderCalls === 4) {
          const queued = (await pool.query("SELECT * FROM email_outbox WHERE tenant_id=$1 AND id=$2",
            [tenantId, result.mails[0].email_outbox_id])).rows[0];
          await assert.rejects(tx(async c => {
            await c.query("UPDATE time_control_employee_config SET is_enabled=false WHERE tenant_id=$1", [tenantId]);
            await require("../backend/src/modules/timeControl/timeControl.dispatch").validateAutomatic(c, { tenantId, row: queued });
          }), /cohort_changed/, "removing the entire current cohort after enqueue must block all employee transport");
        }
        return await require("../backend/src/modules/timeControl/timeControl.automation").dispatchRun({ tenantId, result },
          args => require("../backend/src/modules/notifications/emailOutbox.processor").processDueEmails({
            ...args, sendEmailFn: async (message, options) => {
              simulatedProviderCalls++;
              assert.equal(message.from, service.SENDER);
              assert.equal(message.replyTo, "admin@fielddesk.dk");
              assert.ok(options.idempotencyKey.startsWith("time_control:"));
              assert.equal(options.timeoutMs, 15000);
              return { provider: "resend", providerMessageId: `local-simulated-${simulatedProviderCalls}` };
            },
          }));
      } finally {
        process.env.TIME_CONTROL_SCHEDULER_ENABLED = "false";
        process.env.TIME_CONTROL_MAIL_ENABLED = "false";
      }
    };
    for (const [i, day] of period.days.slice(0, 4).entries()) {
      at(`${dates.addDaysIso(day, 1)}T07:00:00Z`);
      const daily = await run(day);
      assert.equal(daily.run.status, "completed");
      assert.equal(daily.results[0].status, "missing_hours");
      const receiptArgs = { tenantId, identity: daily.results[0].identity_snapshot, controlledDate: day, runId: daily.run.id };
      const active = await tx(c => operation.requireActiveIdentity(c, receiptArgs));
      assert.equal(active.operation_id, epoch.id);
      assert.equal(active.receipt_ids.length, 1);
      await assert.rejects(tx(c => operation.requireActiveIdentity(c, { ...receiptArgs, runId: randomUUID() })), /daily_receipt_missing/);
      await assert.rejects(tx(c => operation.requireActiveIdentity(c, { ...receiptArgs, tenantId: otherTenantId })), /operation_not_active/);
      await assert.rejects(tx(c => operation.requireActiveIdentity(c, { ...receiptArgs,
        identity: { ...receiptArgs.identity, approval_version: 2 } })), /cohort_changed/);
      if (i === 0) {
        await assert.rejects(tx(async c => {
          await operation.setOperation(c, { tenantId, groupId, actorId, status: "paused" });
          await operation.requireActiveIdentity(c, receiptArgs);
        }), /operation_not_active/);
        await assert.rejects(tx(async c => {
          await operation.setOperation(c, { tenantId, groupId, actorId, status: "paused" });
          const restarted = await operation.setOperation(c, { tenantId, groupId, actorId, status: "active", coveredFrom: day });
          assert.notEqual(restarted.id, epoch.id);
          assert.equal((await operation.requireActiveIdentity(c, { ...receiptArgs, runId: null })).operation_id, restarted.id);
          await operation.requireActiveIdentity(c, receiptArgs);
        }), /daily_receipt_missing/);
        for (const changed of [{ mode: "dry_run", triggeredBy: "scheduler" }, { mode: "live", triggeredBy: "manual_test" }]) {
          await assert.rejects(tx(async c => {
            await c.query("UPDATE time_control_run SET mode=$3,triggered_by=$4 WHERE tenant_id=$1 AND id=$2",
              [tenantId, daily.run.id, changed.mode, changed.triggeredBy]);
            await operation.requireActiveIdentity(c, receiptArgs);
          }), /daily_receipt_missing/);
        }
      }
      const outbox = (await pool.query("SELECT * FROM email_outbox WHERE tenant_id=$1 AND id=$2",
        [tenantId, daily.mails[0].email_outbox_id])).rows[0];
      await tx(c => require("../backend/src/modules/timeControl/timeControl.dispatch").validateDaily(c, { tenantId, row: outbox }));
      await assert.rejects(tx(async c => {
        await c.query("UPDATE tenant SET status='suspended' WHERE id=$1", [tenantId]);
        await require("../backend/src/modules/timeControl/timeControl.dispatch").validateDaily(c, { tenantId, row: outbox });
      }), /dispatch_settings_invalid/);
      assert.deepEqual(outbox.payload_json.cc_emails, ["dep@hoyrup-clemmensen.dk"]);
      assert.equal(outbox.recipient_email, "mbo@example.test");
      assert.equal((await automaticDispatch(daily)).sent, 1);
      assert.equal((await automaticDispatch(daily)).claimed, 0);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM time_control_operational_check WHERE tenant_id=$1", [tenantId])).rows[0].n, i + 1);
    }
    const dailyGate = await tx(c => operation.checkGate(c, { tenantId, identity: approvedIdentity, friday: period.friday }));
    assert.equal(dailyGate.eligible, true);
    assert.equal(dailyGate.receipt_ids.length, 4);
    assert.equal((await tx(c => operation.checkGate(c, { tenantId, identity: approvedIdentity, friday: period.friday,
      requireWeekly: true, snapshotId: randomUUID() }))).reason, "scheduled_control_missing:friday_weekly_v1:2026-10-16");
    for (const day of period.days.slice(0, 4)) {
      await assert.rejects(tx(async c => {
        await c.query("UPDATE time_control_run SET status='blocked' WHERE tenant_id=$1 AND control_type='daily_09' AND controlled_date=$2::date", [tenantId, day]);
        const gate = await operation.checkGate(c, { tenantId, identity: approvedIdentity, friday: period.friday });
        assert.equal(gate.reason, `scheduled_control_missing:daily_09:${day}`);
        throw new Error("fixture_rollback_blocked_daily");
      }), /fixture_rollback_blocked_daily/);
    }
    at("2026-10-16T10:00:00Z");
    const full = await run(period.friday, weekly.CONTROL_TYPE);
    assert.equal(full.results[0].status, "weekly_reminder");
    assert.equal(full.mails.filter(mail => mail.status === "queued").length, 2);
    assert.equal((await automaticDispatch(full)).sent, 2);
    assert.equal((await automaticDispatch(full)).claimed, 0);
    assert.equal(simulatedProviderCalls, 6, "four daily plus one weekly employee and one weekly summary, never duplicates");
    const employee = full.mails.find(mail => mail.mail_type === "employee_weekly_reminder_v1");
    const outbox = (await pool.query("SELECT * FROM email_outbox WHERE tenant_id=$1 AND id=$2", [tenantId, employee.email_outbox_id])).rows[0];
    await tx(c => weekly.validateDispatchSnapshot(c, { tenantId, row: outbox }));
    await assert.rejects(tx(async c => {
      await c.query("UPDATE time_control_operation_state SET status='paused' WHERE tenant_id=$1", [tenantId]);
      await weekly.validateDispatchSnapshot(c, { tenantId, row: outbox });
    }), /operation_dispatch_blocked:operation_not_active/);
    await assert.rejects(tx(async c => {
      await c.query("UPDATE time_control_pay_code_rule SET counts_as_valid_hours=false WHERE tenant_id=$1 AND pay_code='3300'", [tenantId]);
      await weekly.validateDispatchSnapshot(c, { tenantId, row: outbox });
    }), /dispatch_evaluation_changed/);
    await assert.rejects(tx(c => weekly.validateDispatchSnapshot(c, {
      tenantId, row: { ...outbox, recipient_email: "changed@example.test" },
    })), /dispatch_routing_changed/);
    const counts = async () => (await pool.query(
      `SELECT (SELECT count(*) FROM time_control_run WHERE tenant_id=$1)::int AS runs,
       (SELECT count(*) FROM time_control_result WHERE tenant_id=$1)::int AS results,
       (SELECT count(*) FROM time_control_mail_log WHERE tenant_id=$1)::int AS mails,
       (SELECT count(*) FROM email_outbox WHERE tenant_id=$1)::int AS outbox,
       (SELECT count(*) FROM time_control_hours_dataset WHERE tenant_id=$1)::int AS datasets,
       (SELECT count(*) FROM time_control_operational_check WHERE tenant_id=$1)::int AS checks`, [tenantId])).rows[0];
    const before = await counts();
    const { execFileSync } = require("node:child_process");
    const restartProof = JSON.parse(execFileSync(process.execPath, ["-e", `
      const RealDate=Date;
      global.Date=class extends RealDate {
        constructor(...args){ super(...(args.length ? args : ["2026-10-16T10:00:01Z"])); }
        static now(){ return new RealDate("2026-10-16T10:00:01Z").getTime(); }
      };
      const service=require("./backend/src/modules/timeControl/timeControl.service");
      const pool=require("./backend/src/db/pool");
      (async()=>{
        const result=await service.runTimeControlWithPool(${JSON.stringify({
          tenantId, controlType: weekly.CONTROL_TYPE, controlledDate: period.friday,
          triggeredBy: "scheduler", dryRun: false,
        })}, {hoursDatasetIds:${JSON.stringify(full.sync.coverage.days.map(day => day.dataset_id))}});
        console.log(JSON.stringify({outboxIds:result.mails.map(mail=>mail.email_outbox_id),status:result.run.status}));
      })().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>pool.end());
    `], { cwd: require("node:path").resolve(__dirname, ".."), env: process.env, encoding: "utf8", timeout: 20_000 }));
    assert.equal(restartProof.status, "completed");
    assert.deepEqual(restartProof.outboxIds.sort(), full.mails.map(mail => mail.email_outbox_id).sort());
    assert.deepEqual(await counts(), before, "a fresh service process reuses persisted notification keys");
    const concurrent = await Promise.allSettled([run(period.friday, weekly.CONTROL_TYPE), run(period.friday, weekly.CONTROL_TYPE)]);
    assert.ok(concurrent.some(result => result.status === "fulfilled"), concurrent.map(result => result.reason?.stack || "fulfilled").join("\n"));
    for (const item of concurrent) if (item.status === "rejected") assert.match(item.reason.message, /already_in_progress/);
    assert.deepEqual(await counts(), before);
    await tx(c => weekly.validateDispatchSnapshot(c, { tenantId, row: outbox }));
    const retained = (await pool.query("SELECT count(*)::int AS n FROM time_control_hours_dataset WHERE tenant_id=$1", [tenantId])).rows[0].n;
    const badClient = await pool.connect();
    try {
      await assert.rejects(orchestration.captureAndPublish(badClient, {
        tenantId, controlledDate: period.days[0], captureDay: async () => { throw new Error("time_control_capture_api_error"); },
      }), /api_error/);
    } finally { badClient.release(); }
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM time_control_hours_dataset WHERE tenant_id=$1", [tenantId])).rows[0].n, retained);
    const latestMail = (await pool.query(
      "SELECT * FROM email_outbox WHERE tenant_id=$1 AND template_key='time_control.employee_weekly_reminder_v1' ORDER BY created_at DESC LIMIT 1", [tenantId])).rows[0];
    await assert.rejects(tx(c => weekly.validateDispatchSnapshot(c, { tenantId, row: latestMail })), /snapshot_invalid|not_current/);
    // A corrected and deleted source row publishes a new immutable revision, retaining the first.
    const captureClient = await pool.connect();
    try {
      sourceRows = [
        { id: "1001", date: period.days[0], fitterId: 290, projectId: 123, categoryId: 1, categoryReference: "3300", hours: 6 },
        { id: "1002", date: period.days[0], fitterId: 999, projectId: 456, categoryId: 1, categoryReference: "3300", hours: 2 },
      ];
      const changed = await orchestration.captureAndPublish(captureClient, { tenantId, controlledDate: period.days[0], captureDay });
      sourceRows = [sourceRows[0]];
      const deleted = await orchestration.captureAndPublish(captureClient, { tenantId, controlledDate: period.days[0], captureDay });
      assert.notEqual(changed.proof.dataset_revision, deleted.proof.dataset_revision);
      assert.equal(deleted.proof.row_count, 1);
      await assert.rejects(tx(c => storage.loadHoursDataset(c, { tenantId, controlledDate: period.days[0], datasetId: changed.id, freshnessMinutes: 180 })), /not_current/);
      assert.equal((await pool.query("SELECT row_count FROM time_control_hours_dataset WHERE tenant_id=$1 AND id=$2", [tenantId, changed.id])).rows[0].row_count, 2);
    } finally { captureClient.release(); sourceRows = null; }
    // Pause/restart retains epochs and Thursday's first week is internal only.
    at("2026-10-29T07:00:00Z");
    await start(null, "paused");
    const thursdayEpoch = await start("2026-10-29");
    assert.notEqual(thursdayEpoch.id, epoch.id);
    const catchupClient = await pool.connect();
    try {
      const catchup = await orchestration.catchUp(catchupClient, { tenantId, captureDay });
      assert.equal(catchup.captures.length, 3);
      assert.equal(catchup.operational_checks_recorded, 0);
    } finally { catchupClient.release(); }
    at("2026-10-30T08:00:00Z");
    await run("2026-10-29");
    at("2026-10-30T11:00:00Z");
    const partial = await run("2026-10-30", weekly.CONTROL_TYPE);
    assert.equal(partial.mails.some(mail => mail.mail_type === "employee_weekly_reminder_v1"), false);
    const identity = partial.results[0].identity_snapshot;
    assert.equal((await tx(c => operation.checkGate(c, { tenantId, identity, friday: "2026-10-30" }))).reason, "first_partial_operational_week");
    // The same Thursday-start epoch can qualify the following full week.
    for (const day of dates.weeklyPeriod("2026-11-06").days.slice(0, 4)) {
      at(`${dates.addDaysIso(day, 1)}T08:00:00Z`);
      await run(day);
    }
    at("2026-11-06T11:00:00Z");
    const following = await run("2026-11-06", weekly.CONTROL_TYPE);
    assert.equal(following.mails.filter(mail => mail.mail_type === "employee_weekly_reminder_v1").length, 1);
    const followingOutbox = (await pool.query("SELECT * FROM email_outbox WHERE tenant_id=$1 AND id=$2",
      [tenantId, following.mails.find(mail => mail.result_id).email_outbox_id])).rows[0];
    await tx(c => weekly.validateDispatchSnapshot(c, { tenantId, row: followingOutbox }));
    await pool.query("UPDATE time_control_settings SET sync_freshness_minutes=1 WHERE tenant_id=$1", [tenantId]);
    at("2026-11-06T11:02:00Z");
    await assert.rejects(tx(c => weekly.validateDispatchSnapshot(c, { tenantId, row: followingOutbox })), /stale/);
    await pool.query("UPDATE time_control_settings SET sync_freshness_minutes=180 WHERE tenant_id=$1", [tenantId]);
    at("2026-11-06T13:30:00Z");
    assert.equal(operation.dispatchWindow(weekly.CONTROL_TYPE, "2026-11-06"), false);
    // Dry-run controls and historical/catch-up never supply a missing scheduled receipt.
    at("2026-11-10T08:00:00Z");
    await run("2026-11-09", "daily_09", { dryRun: true });
    for (const day of ["2026-11-10", "2026-11-11", "2026-11-12"]) {
      at(`${dates.addDaysIso(day, 1)}T08:00:00Z`);
      await run(day);
    }
    at("2026-11-13T11:00:00Z");
    const dryGap = await run("2026-11-13", weekly.CONTROL_TYPE);
    assert.equal(dryGap.mails.some(mail => mail.mail_type === "employee_weekly_reminder_v1"), false);
    assert.match((await tx(c => operation.checkGate(c, { tenantId, identity, friday: "2026-11-13" }))).reason, /scheduled_control_missing.*2026-11-09/);
    at("2026-11-17T08:00:00Z");
    await pool.query("INSERT INTO time_control_employee_config(tenant_id,internal_ref) VALUES($1,'UNRESOLVED')", [tenantId]);
    const blocked = await run("2026-11-16");
    assert.equal(blocked.run.status, "blocked");
    assert.ok(blocked.results.some(result => result.status === "missing_hours"));
    assert.ok(blocked.results.some(result => result.status === "config_error"));
    assert.equal((await pool.query(
      "SELECT count(*)::int AS n FROM time_control_operational_check WHERE tenant_id=$1 AND controlled_date='2026-11-16'",
      [tenantId])).rows[0].n, 0);
    await assert.rejects(pool.query("UPDATE time_control_operation SET covered_from='2020-01-01' WHERE tenant_id=$1", [tenantId]), /immutable/);
    await assert.rejects(pool.query("DELETE FROM time_control_operational_check WHERE tenant_id=$1", [tenantId]), /immutable/);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM sync_job WHERE tenant_id=$1", [tenantId])).rows[0].n, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM email_outbox WHERE tenant_id=$1 AND status='sent'", [tenantId])).rows[0].n, 6);
    console.log(JSON.stringify({ database, controlledSourceCaptures: calls, plannedDailyControlsVerified: true,
      mondayStartQualified: true, thursdayStartPartial: true, followingFullWeekQualified: true,
      dryRunGateBlocked: true, revisionsAndDeletionVerified: true, providerCalls: 0, simulatedProviderCalls, syncJobs: 0 }));
  } finally {
    global.fetch = originalFetch;
    global.Date = RealDate;
    await appPool.end();
    await pool.end();
  }
});
