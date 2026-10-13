"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const enabled = process.env.FIELD_DESK_LOCAL_PG_TEST === "1";
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function safeUrl() {
  const url = new URL(process.env.FIELDDESK_TIME_CONTROL_TEST_DATABASE_URL || "postgres://example.invalid/blocked");
  assert.equal(url.protocol, "postgres:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55432");
  assert.equal(url.username, "tc_validation");
  assert.equal(url.password, "");
  assert.match(url.pathname, /^\/fielddesk_tc_validation_upgrade_[a-f0-9]{24}$/);
  return url.toString();
}

function evidence(tenantId, day, hours, code = "3300") {
  const rows = hours === null ? [] : [{
    id: "1", date: `${day}T00:00:00`, hours, fitterId: 290,
    categoryId: 1, categoryReference: code, projectId: 123, projectReference: "LOCAL",
  }];
  return {
    tenantId, endpoint: "/api/v4/paginatedfitterhours", fromDate: day, toDate: day,
    pageSize: 10, expectedTotal: rows.length, rows,
    passes: [1, 2].map(() => ({
      pageEvidence: [{ page: 1, currentPage: rows.length ? 1 : 0, nextPage: null, total: rows.length,
        rowCount: rows.length, status: 200, hasErrors: false, errorCount: 0 }],
      summary: { orderedIdsHash: hash(rows.map((r) => r.id)), canonicalRowsHash: hash(rows) },
    })),
    evidence: rows.length ? { closedProjectControl: { id: "1", fitterId: 290, projectId: 123, hours, isClosed: true } } : {
      emptyDayContract: {
        endpoint: "/api/v4/paginatedfitterhours", version: "ek_v4_all_projects_empty_day_v1",
        includesClosedProjects: true, dateFilterInclusive: true, zeroTotalTerminalPage: true,
        emptyCurrentPage: 0,
        verificationReference: "synthetic-local-contract-fixture-not-live-EK-proof",
      },
    },
  };
}

test("weekly immutable five-day bindings, repeat/concurrency, zero-day and fail-closed PostgreSQL contracts", { skip: !enabled }, async () => {
  const { Pool, Client } = require("../backend/node_modules/pg");
  const admin = new Client({ connectionString: safeUrl(), ssl: false });
  const database = `fielddesk_tc_validation_upgrade_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
  assert.match(database, /^fielddesk_tc_validation_upgrade_[a-f0-9]{24}$/);
  const url = new URL(safeUrl());
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
  process.env.MAIL_REPLY_TO = "admin@fielddesk.dk";
  process.env.TIME_CONTROL_SCHEDULER_ENABLED = "true";
  process.env.TIME_CONTROL_MAIL_ENABLED = "true";
  process.env.MAIL_API_KEY = "dummy";
  const pool = new Pool({ connectionString, ssl: false, max: 5 });
  const runner = require("../backend/scripts/db_migrate");
  const migrationClient = await pool.connect();
  const originalLog = console.log;
  try {
    console.log = () => {};
    await runner.ensureMigrationTable(migrationClient);
    await runner.runPendingMigrations(migrationClient, runner.getMigrationFiles(), new Map());
  } finally {
    console.log = originalLog;
    migrationClient.release();
  }
  const appPool = require("../backend/src/db/pool");
  const service = require("../backend/src/modules/timeControl/timeControl.service");
  const storage = require("../backend/src/modules/timeControl/timeControl.dataset");
  const coverage = require("../backend/src/modules/timeControl/timeControl.coverage");
  const weekly = require("../backend/src/modules/timeControl/timeControl.weekly");
  const dates = require("../backend/src/modules/timeControl/timeControl.dates");
  const repository = require("../backend/src/modules/timeControl/timeControl.repository");
  const tenantId = randomUUID();
  const tenantSlug = `weekly-${tenantId.slice(0, 8)}`;
  const period = dates.weeklyPeriod("2026-03-27");
  let observations = 0;
  async function transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  async function publish(hours, code = "3300") {
    const ids = [];
    for (const [i, day] of period.days.entries()) {
      const input = evidence(tenantId, day, hours[i], code);
      const observedAt = new Date(Date.UTC(2026, 2, 27, 11, 0, ++observations)).toISOString();
      const result = await transaction((client) => storage.storeHoursDataset(client, {
        tenantId, dataset: coverage.createHoursDataset(input), observedAt,
      }));
      ids.push(result.id);
    }
    return ids;
  }
  const runArgs = { tenantId, controlType: weekly.CONTROL_TYPE, controlledDate: period.friday, dryRun: true, triggeredBy: "manual_test", waitForSync: false };
  const run = (ids, historical = true) => service.runTimeControlWithPool(runArgs, { hoursDatasetIds: ids, allowHistoricalSnapshot: historical });
  try {
    const { rows: [server] } = await pool.query("SELECT current_database() AS name, inet_server_port() AS port, version()");
    assert.equal(server.name, new URL(connectionString).pathname.slice(1));
    assert.equal(server.port, 55432);
    assert.match(server.version, /^PostgreSQL 17\./);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM schema_migration WHERE success")).rows[0].n, runner.getMigrationFiles().length);
    await pool.query("INSERT INTO tenant (id, slug, name, status) VALUES ($1, $2, 'Local weekly fixture', 'active')", [tenantId, tenantSlug]);
    const { rows: [actor] } = await pool.query(
      `INSERT INTO tenant_user (tenant_id,email,name,role,status,password_hash)
       VALUES ($1,'admin@example.test','Admin','tenant_admin','active','not-a-password') RETURNING id`, [tenantId]);
    await pool.query(
      `INSERT INTO tenant_user (tenant_id,email,name,role,status,password_hash)
       VALUES ($1,'dep@hoyrup-clemmensen.dk','Dennis','tenant_admin','active','fixture')`, [tenantId]);
    const { rows: [group] } = await pool.query(
      `INSERT INTO resource_groups (tenant_id,name,status,source,external_source,external_id)
       VALUES ($1,'Group 61','active','ekomplet','ekomplet','61') RETURNING id`, [tenantId]);
    await pool.query("INSERT INTO fitter (tenant_id,fitter_id,name,email,is_active_derived) VALUES ($1,'290','MBO Montør','mbo@example.test',true)", [tenantId]);
    await pool.query("INSERT INTO resource_group_members (tenant_id,group_id,fitter_id,source) VALUES ($1,$2,'290','ekomplet')", [tenantId, group.id]);
    const { rows: [config] } = await pool.query(
      `INSERT INTO time_control_employee_config
       (tenant_id,internal_ref,fitter_id,approved_group_id,approved_email,email_source,email_source_value,
        email_approved_at,email_approved_by_user_id,approval_reason,approval_version)
       VALUES ($1,'MBO','290',$2,'mbo@example.test','admin_override','mbo@example.test',now(),$3,'local fixture',1) RETURNING id`,
      [tenantId, group.id, actor.id]);
    let ids = await publish([7.75, 7.75, 7.75, 7.75, 6]);
    const exact = await run(ids);
    assert.equal(exact.results[0].valid_hours, "37.00");
    assert.equal(exact.results[0].status, "ok");
    assert.equal(exact.results[0].missing_hours, null);
    assert.equal(exact.mails.length, 0);
    const bindingRows = await pool.query(
      "SELECT * FROM time_control_weekly_snapshot_day WHERE tenant_id = $1 AND snapshot_id = $2 ORDER BY controlled_date",
      [tenantId, exact.run.weekly_snapshot_id]);
    assert.equal(bindingRows.rows.length, 5);
    assert.deepEqual(bindingRows.rows.map((r) => r.dataset_id), ids);
    await assert.rejects(pool.query(
      "UPDATE time_control_run SET controlled_date = '2026-04-03' WHERE tenant_id = $1 AND id = $2",
      [tenantId, exact.run.id]), /period_mismatch/);
    const otherTenantId = randomUUID();
    await pool.query("INSERT INTO tenant (id,slug,name,status) VALUES ($1,$2,'Cross tenant fixture','active')",
      [otherTenantId, `cross-${otherTenantId.slice(0, 8)}`]);
    await assert.rejects(transaction(async (client) => {
      const { rows: [snapshot] } = await client.query(
        "INSERT INTO time_control_weekly_snapshot (tenant_id,monday,binding_hash,proof_json) VALUES ($1,$2,$3,'{}') RETURNING id",
        [otherTenantId, period.monday, "b".repeat(64)]);
      await client.query(
        "INSERT INTO time_control_weekly_snapshot_day (snapshot_id,tenant_id,controlled_date,dataset_id) VALUES ($1,$2,$3,$4)",
        [snapshot.id, otherTenantId, period.monday, ids[0]]);
    }), (error) => error.code === "23503");
    const snapshotRow = (await pool.query("SELECT * FROM time_control_weekly_snapshot WHERE tenant_id = $1 AND id = $2", [tenantId, exact.run.weekly_snapshot_id])).rows[0];
    assert.equal(snapshotRow.proof_json.freshness, "explicit_historical_demo");
    const repeated = await run(ids);
    assert.equal(repeated.run.weekly_snapshot_id, exact.run.weekly_snapshot_id);
    const auditRows = await pool.query("SELECT metadata FROM audit_event WHERE tenant_id = $1 AND event_type = 'time_control.run_completed'", [tenantId]);
    assert.ok(auditRows.rows.some((r) => r.metadata.weekly_snapshot_id === exact.run.weekly_snapshot_id));
    for (const sql of [
      "UPDATE time_control_weekly_snapshot SET proof_json = '{}' WHERE tenant_id = $1",
      "DELETE FROM time_control_weekly_snapshot_day WHERE tenant_id = $1",
    ]) await assert.rejects(pool.query(sql, [tenantId]), /immutable/);
    await assert.rejects(pool.query("TRUNCATE time_control_weekly_snapshot_day"), /immutable/);
    await assert.rejects(transaction(async (client) => {
      await client.query("INSERT INTO time_control_weekly_snapshot (tenant_id,monday,binding_hash,proof_json) VALUES ($1,'2026-03-23',$2,'{}')", [tenantId, "a".repeat(64)]);
    }), /five_days/);
    await assert.rejects(transaction((client) => weekly.loadWeeklySnapshot(client, {
      tenantId: randomUUID(), controlledDate: period.friday, datasetIds: ids, freshnessMinutes: 180, allowHistoricalSnapshot: true,
    })), /scope_mismatch/);
    await assert.rejects(run([ids[4]]), /five_dataset_ids/);
    const noEvidence = await service.runTimeControlWithPool({ ...runArgs, controlledDate: "2026-03-06" }, {
      captureDay: async () => { throw new Error("time_control_capture_test_unavailable"); },
    });
    assert.equal(noEvidence.run.status, "blocked");
    assert.equal(noEvidence.mails.filter((m) => m.mail_type === "employee_weekly_reminder_v1").length, 0);
    const nullObserved = evidence(tenantId, period.days[0], 7.75);
    await assert.rejects(transaction((client) => storage.storeHoursDataset(client, { tenantId, dataset: coverage.createHoursDataset(nullObserved) })), /newer_observation/);
    assert.equal((await run(ids, false)).run.status, "blocked");
    await assert.rejects(transaction((client) => weekly.loadWeeklySnapshot(client, {
      tenantId, controlledDate: period.friday, datasetIds: ids, freshnessMinutes: 180,
    })), /stale_or_observation_missing/);
    const nullPeriod = dates.weeklyPeriod("2026-03-20");
    const nullIds = [];
    for (const day of nullPeriod.days) {
      const saved = await transaction((client) => storage.storeHoursDataset(client, {
        tenantId, dataset: coverage.createHoursDataset(evidence(tenantId, day, 7)),
      }));
      nullIds.push(saved.id);
    }
    await assert.rejects(transaction((client) => weekly.loadWeeklySnapshot(client, {
      tenantId, controlledDate: nullPeriod.friday, datasetIds: nullIds, freshnessMinutes: 180,
    })), /stale_or_observation_missing/);
    const oldIds = ids;
    ids = await publish([10, 10, 10, 10, null]);
    assert.equal((await run(oldIds)).run.status, "blocked", "replaced current heads invalidate old weekly proof");
    assert.equal((await run(ids)).results[0].status, "ok");
    assert.equal((await pool.query("SELECT row_count FROM time_control_hours_dataset WHERE tenant_id = $1 AND id = $2", [tenantId, ids[4]])).rows[0].row_count, 0);
    const empty = evidence(tenantId, period.friday, null);
    const zeroDataset = coverage.createHoursDataset(empty);
    await assert.rejects(pool.query(
      `INSERT INTO time_control_hours_dataset
       (tenant_id,controlled_date,dataset_revision,rows_hash,capture_key,row_count,evidence_json,proof_json)
       VALUES ($1,$2,$3,$4,$5,0,$6,$7)`,
      [tenantId, period.friday, zeroDataset.proof.dataset_revision, zeroDataset.proof.rows_hash, "f".repeat(64),
        JSON.stringify({ ...empty, passes: [] }), JSON.stringify(zeroDataset.proof)]), (error) => error.code === "23514");
    ids = await publish([7, 7, 7, 7, 7]);
    const under = await run(ids);
    const automatic = await transaction((client) => weekly.loadWeeklySnapshot(client, {
      tenantId, controlledDate: period.friday, datasetIds: null, freshnessMinutes: 180, allowHistoricalSnapshot: true,
    }));
    assert.equal(automatic.id, under.run.weekly_snapshot_id, "scheduler resolution selects exact current tenant/day heads");
    assert.equal(under.results[0].status, "weekly_reminder");
    assert.equal(under.results[0].missing_hours, null);
    const employee = under.mails.find((m) => m.mail_type === "employee_weekly_reminder_v1");
    const leaders = under.mails.find((m) => m.mail_type === "friday_weekly_summary_v1");
    assert.deepEqual(employee.recipient_emails, ["mbo@example.test"]);
    assert.deepEqual(employee.cc_emails, ["dep@hoyrup-clemmensen.dk"]);
    assert.deepEqual(leaders.recipient_emails, ["dep@hoyrup-clemmensen.dk"]);
    assert.deepEqual(leaders.cc_emails, ["lke@hoyrup-clemmensen.dk"]);
    assert.match(employee.body_preview, /14\.30/);
    assert.doesNotMatch(employee.body_preview + leaders.body_preview, /mangl|underskud/);
    await pool.query("UPDATE time_control_employee_config SET approved_email = 'changed@example.test', approval_version = 2 WHERE tenant_id = $1 AND id = $2", [tenantId, config.id]);
    const rerun = await run(ids);
    assert.equal(rerun.mails.find((m) => m.mail_type === "employee_weekly_reminder_v1").id, employee.id);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM time_control_mail_log WHERE tenant_id = $1 AND mail_type = 'employee_weekly_reminder_v1'", [tenantId])).rows[0].n, 1);
    const concurrent = await Promise.allSettled([run(ids), run(ids)]);
    assert.ok(concurrent.some((r) => r.status === "fulfilled"));
    for (const item of concurrent.filter((r) => r.status === "rejected")) assert.match(item.reason.message, /already_in_progress/);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM time_control_mail_log WHERE tenant_id = $1 AND mail_type = 'employee_weekly_reminder_v1'", [tenantId])).rows[0].n, 1);
    const lock = await pool.connect();
    try {
      assert.equal(await repository.acquireRunLock(lock, runArgs), true);
      await assert.rejects(run(ids), /already_in_progress/);
    } finally { await repository.releaseRunLock(lock, runArgs); lock.release(); }
    ids = await publish([7, 7, 7, 7, 7], "9315");
    assert.equal((await run(ids)).results[0].valid_hours, "35.00");
    ids = await publish([7, 7, 7, 7, 7], "9070");
    assert.equal((await run(ids)).results[0].valid_hours, "0.00");
    ids = await publish([7, 7, 7, 7, 7], "unknown");
    const unknown = await run(ids);
    assert.equal(unknown.run.status, "blocked");
    assert.equal(unknown.results[0].status, "unclassified_hours");
    assert.equal(unknown.mails.filter((m) => m.mail_type === "employee_weekly_reminder_v1").length, 0);
    ids = await publish([7, 7, 7, 7, 7]);
    const beforeInvalidation = await run(ids);
    const previousResult = beforeInvalidation.results[0];
    await transaction((client) => storage.invalidateHoursDataset(client, { tenantId, controlledDate: period.days[2], reason: "local invalidation" }));
    const invalidated = await run(ids);
    assert.equal(invalidated.run.status, "blocked");
    assert.equal(invalidated.results.length, 1);
    assert.equal(invalidated.results[0].id, previousResult.id);
    assert.equal(invalidated.results[0].status, "data_incomplete");
    assert.equal(invalidated.results[0].missing_hours, null);
    assert.equal(invalidated.results[0].coverage_status, "incomplete");
    assert.equal(invalidated.results[0].weekly_snapshot_id, null);
    assert.equal(invalidated.results[0].identity_snapshot.hours_dataset, undefined);
    assert.equal((await pool.query("SELECT result_id FROM time_control_mail_log WHERE tenant_id = $1 AND id = $2",
      [tenantId, employee.id])).rows[0].result_id, previousResult.id);
    const archived = (await pool.query(
      `SELECT metadata FROM audit_event WHERE tenant_id = $1 AND target_id = $2
       AND event_type = 'time_control.run_blocked' AND metadata ? 'previous_evaluation'
       ORDER BY occurred_at DESC LIMIT 1`, [tenantId, invalidated.run.id])).rows[0].metadata.previous_evaluation;
    assert.equal(archived.weekly_snapshot_id, beforeInvalidation.run.weekly_snapshot_id);
    assert.equal(archived.run.id, beforeInvalidation.run.id);
    assert.equal(archived.run.status, "completed");
    assert.equal(archived.run.weekly_snapshot_id, beforeInvalidation.run.weekly_snapshot_id);
    assert.equal(archived.result_count, 1);
    assert.equal(archived.results[0].id, previousResult.id);
    assert.equal(archived.results[0].weekly_snapshot_id, previousResult.weekly_snapshot_id);
    assert.equal(archived.results[0].status, "weekly_reminder");
    assert.equal(archived.results[0].valid_hours, "35.00");
    assert.deepEqual(archived.results[0].identity_snapshot, previousResult.identity_snapshot);
    const overview = await service.getOverview({ tenantId });
    assert.ok(overview.runs.some((r) => r.control_type === weekly.CONTROL_TYPE));
    const replacementEvidence = evidence(tenantId, period.days[2], 7);
    const captured = await coverage.captureHoursDataset({
      tenantId, controlledDate: period.days[2], pageSize: 10, evidence: replacementEvidence.evidence,
      fetchPage: async () => ({ rows: replacementEvidence.rows, currentPage: 1, nextPage: null, total: 1, status: 200, hasErrors: false, errorCount: 0 }),
    });
    // Invalidation and source observation use actual server time, not the CLI import timestamp.
    const replacement = await transaction((client) => storage.storeHoursDataset(client, { tenantId, dataset: captured }));
    ids[2] = replacement.id;
    const restored = await run(ids);
    assert.equal(restored.results[0].status, "weekly_reminder");
    assert.equal(restored.results[0].id, previousResult.id);
    const current = await transaction((client) => storage.loadHoursDataset(client, {
      tenantId, controlledDate: period.days[2], datasetId: replacement.id, freshnessMinutes: 180,
    }));
    assert.equal(current.proof.server_captured, true);
    assert.equal(current.proof.freshness, "fresh_observation");
    const cli = execFileSync(process.execPath, [
      path.join(__dirname, "..", "backend", "scripts", "run_time_control.js"),
      "--tenant", tenantSlug, "--date", period.friday, "--control-type", weekly.CONTROL_TYPE,
      "--dry-run", "--hours-dataset-ids", ids.join(","), "--historical-snapshot",
    ], { encoding: "utf8", env: { ...process.env, DATABASE_URL: connectionString } });
    assert.equal(JSON.parse(cli).status, "completed");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM email_outbox WHERE tenant_id = $1", [tenantId])).rows[0].n, 0);
    const outboxService = require("../backend/src/modules/notifications/emailOutbox.service");
    const linked = [];
    for (const mail of [employee, leaders]) {
      const saved = await transaction(async (client) => {
        const outbox = await outboxService.enqueueEmail(client, {
          tenantId, actorId: "system:time_control",
          templateKey: `time_control.${mail.mail_type}`,
          recipientEmail: mail.recipient_emails[0], recipientName: "Local linked fixture",
          variables: { subject: mail.subject, body: mail.body_preview },
          payload: { friday: period.friday }, sourceType: "time_control", sourceId: mail.run_id,
          idempotencyKey: mail.idempotency_key,
        });
        return (await client.query(
          `UPDATE time_control_mail_log SET mode = 'live', status = 'queued', email_outbox_id = $3
           WHERE tenant_id = $1 AND id = $2 RETURNING *`, [tenantId, mail.id, outbox.id])).rows[0];
      });
      linked.push(saved);
    }
    await run(ids);
    for (const original of linked) {
      const after = (await pool.query("SELECT * FROM time_control_mail_log WHERE tenant_id = $1 AND id = $2", [tenantId, original.id])).rows[0];
      assert.deepEqual(after, original, "provider-linked weekly employee/summary logs must never be rewritten");
    }
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM email_outbox WHERE tenant_id = $1", [tenantId])).rows[0].n, 2);
    const processor = require("../backend/src/modules/notifications/emailOutbox.processor");
    let providerCalls = 0;
    const processed = await processor.processDueEmails({
      tenantId, sendEmailFn: async () => { providerCalls += 1; throw new Error("provider must not be called"); },
    });
    assert.equal(processed.dead_letter, 2);
    assert.equal(providerCalls, 0, "expired historical reminders must be stopped before provider calls");
    const RealDate = Date;
    const originalInvalidate = storage.invalidateHoursDataset;
    let clock = new RealDate("2026-10-12T06:00:00Z").getTime();
    global.Date = class LocalFixtureDate extends RealDate {
      constructor(...args) { super(...(args.length ? args : [clock])); }
      static now() { return clock; }
    };
    // Keep the real PostgreSQL invalidation transaction on the same clock as this synthetic source fixture.
    storage.invalidateHoursDataset = async (client, input) => {
      const result = await originalInvalidate(client, input);
      await client.query(
        `UPDATE time_control_hours_dataset_head SET invalidated_at=$3::timestamptz
         WHERE tenant_id=$1 AND controlled_date=$2::date AND invalidated_at IS NOT NULL`,
        [input.tenantId, input.controlledDate, new Date(clock)]);
      return result;
    };
    try {
      const livePeriod = dates.weeklyPeriod("2026-10-16");
      await pool.query("INSERT INTO time_control_settings (tenant_id,mode,live_enabled_at) VALUES ($1,'live',now())", [tenantId]);
      const approved = (await pool.query(
        "SELECT approved_group_id FROM time_control_employee_config WHERE tenant_id=$1 LIMIT 1", [tenantId])).rows[0];
      await transaction(client => require("../backend/src/modules/timeControl/timeControl.operation").setOperation(client, {
        tenantId, groupId: approved.approved_group_id, actorId: actor.id, coveredFrom: livePeriod.monday,
        status: "active",
      }));
      for (const day of livePeriod.days.slice(0, 4)) {
        clock = new RealDate(`${dates.addDaysIso(day, 1)}T07:00:00Z`).getTime();
        await service.runTimeControlWithPool({ ...runArgs, controlledDate: day, controlType: "daily_09",
          triggeredBy: "scheduler", dryRun: false }, {
          captureDay: async () => {
            clock += 1;
            const dayEvidence = evidence(tenantId, day, 7.5);
            return coverage.captureHoursDataset({ tenantId, controlledDate: day, pageSize: 10, evidence: dayEvidence.evidence,
              fetchPage: async () => ({ rows: dayEvidence.rows, currentPage: 1, nextPage: null,
                total: 1, status: 200, hasErrors: false, errorCount: 0 }) });
          },
        });
      }
      clock = new RealDate("2026-10-16T10:00:00Z").getTime();
      const liveIds = [];
      for (const day of livePeriod.days) {
        const dayEvidence = evidence(tenantId, day, 7);
        const capturedDay = await coverage.captureHoursDataset({
          tenantId, controlledDate: day, pageSize: 10, evidence: dayEvidence.evidence,
          fetchPage: async () => ({ rows: dayEvidence.rows, currentPage: 1, nextPage: null,
            total: 1, status: 200, hasErrors: false, errorCount: 0 }),
        });
        const storedDay = await transaction((client) => storage.storeHoursDataset(client, { tenantId, dataset: capturedDay }));
        liveIds.push(storedDay.id);
      }
      const liveArgs = { ...runArgs, controlledDate: livePeriod.friday, triggeredBy: "scheduler", dryRun: false };
      const live = await service.runTimeControlWithPool(liveArgs, { hoursDatasetIds: liveIds });
      // Match PostgreSQL's run timestamp to the controlled application clock in this fixture.
      await pool.query("UPDATE time_control_run SET started_at=$3 WHERE tenant_id=$1 AND id=$2", [tenantId, live.run.id, new Date(clock)]);
      assert.equal(live.run.status, "completed");
      assert.equal(live.results[0].status, "weekly_reminder");
      assert.equal(live.mails.filter((m) => m.status === "queued").length, 2);
      assert.equal(live.sync.coverage.freshness, "fresh_server_observations");
      const onceQueued = (await pool.query("SELECT count(*)::int AS n FROM email_outbox WHERE tenant_id = $1", [tenantId])).rows[0].n;
      assert.equal(onceQueued, 4);
      const replay = await service.runTimeControlWithPool(liveArgs, { hoursDatasetIds: liveIds });
      assert.deepEqual(replay.mails.map((m) => m.email_outbox_id).sort(), live.mails.map((m) => m.email_outbox_id).sort());
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM email_outbox WHERE tenant_id = $1", [tenantId])).rows[0].n, onceQueued);
      const queuedEmployee = (await pool.query("SELECT * FROM email_outbox WHERE tenant_id = $1 AND id = $2",
        [tenantId, live.mails.find((mail) => mail.result_id).email_outbox_id])).rows[0];
      await transaction((client) => weekly.validateDispatchSnapshot(client, { tenantId, row: queuedEmployee }));
      await assert.rejects(transaction((client) => weekly.validateDispatchSnapshot(client, {
        tenantId: otherTenantId, row: queuedEmployee,
      })), /snapshot_invalid/);
      await assert.rejects(transaction(async (client) => {
        await client.query("UPDATE time_control_result SET status = 'data_incomplete' WHERE tenant_id = $1 AND run_id = $2",
          [tenantId, live.run.id]);
        await weekly.validateDispatchSnapshot(client, { tenantId, row: queuedEmployee });
      }), /result_invalid/);
      await assert.rejects(transaction(async (client) => {
        await client.query("UPDATE time_control_run SET mode = 'dry_run' WHERE tenant_id = $1 AND id = $2",
          [tenantId, live.run.id]);
        await weekly.validateDispatchSnapshot(client, { tenantId, row: queuedEmployee });
      }), /snapshot_invalid/);
      await assert.rejects(transaction((client) => weekly.validateDispatchSnapshot(client, {
        tenantId, row: { ...queuedEmployee, payload_json: { ...queuedEmployee.payload_json, weekly_snapshot_id: under.run.weekly_snapshot_id } },
      })), /snapshot_invalid/);
      await pool.query("UPDATE time_control_settings SET sync_freshness_minutes = 1 WHERE tenant_id = $1", [tenantId]);
      clock += 2 * 60 * 1000;
      await assert.rejects(transaction((client) => weekly.validateDispatchSnapshot(client, {
        tenantId, row: queuedEmployee,
      })), /stale_or_observation_missing/);
      clock -= 2 * 60 * 1000;
      await pool.query("UPDATE time_control_settings SET sync_freshness_minutes = 180 WHERE tenant_id = $1", [tenantId]);
      await transaction((client) => storage.invalidateHoursDataset(client, {
        tenantId, controlledDate: livePeriod.days[1], reason: "queued weekly evidence invalidated",
      }));
      const invalidQueue = await processor.processDueEmails({
        tenantId, sendEmailFn: async () => { providerCalls += 1; throw new Error("provider must not be called"); },
      });
      assert.equal(invalidQueue.dead_letter, 2);
      assert.equal(providerCalls, 0);
      assert.match((await pool.query("SELECT last_error_code FROM email_outbox WHERE tenant_id = $1 AND id = $2",
        [tenantId, queuedEmployee.id])).rows[0].last_error_code, /not_current_or_scope_mismatch/);
      clock = new RealDate("2026-10-16T12:30:00Z").getTime();
      const expiredLive = await processor.processDueEmails({
        tenantId, sendEmailFn: async () => { providerCalls += 1; throw new Error("provider must not be called"); },
      });
      assert.equal(expiredLive.claimed, 0, "invalid evidence rows remain dead-lettered");
      assert.equal(providerCalls, 0);
      const tooLate = await service.runTimeControlWithPool(liveArgs, { hoursDatasetIds: liveIds });
      assert.equal(tooLate.run.status, "blocked");
      assert.match(tooLate.run.error_reason, /not_current_or_scope_mismatch|outside_reminder_window/);
      assert.equal(tooLate.mails.filter((m) => m.mail_type === "employee_weekly_reminder_v1").length, 0);
    } finally {
      storage.invalidateHoursDataset = originalInvalidate;
      global.Date = RealDate;
    }
    console.log(JSON.stringify({ weeklyPostgres: "verified", database: server.name, immutableDayBindings: 5,
      historicalWeekEmployeeNotifications: 1, liveFixtureWeekEmployeeNotifications: 1,
      providerCalls: 0, actualMigrations: runner.getMigrationFiles().length, proofBasis: "synthetic_local_fixtures_and_clock" }));
  } finally {
    await appPool.end();
    await pool.end();
  }
});
