"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const connectionString = "postgres://example.invalid/blocked";
const ephemeralSigningKey = randomUUID();
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = connectionString;
process.env.JWT_SECRET = ephemeralSigningKey;
process.env.ROOT_DOMAIN = "example.test";
const dates = require("../backend/src/modules/timeControl/timeControl.dates");
const operation = require("../backend/src/modules/timeControl/timeControl.operation");

test("planned control/start and completion windows use Copenhagen including DST and year boundary", () => {
  for (const [start, day, type] of [
    ["2026-03-24T08:00:00Z", "2026-03-23", "daily_09"],
    ["2026-03-31T07:00:00Z", "2026-03-30", "daily_09"],
    ["2026-10-23T10:00:00Z", "2026-10-23", "friday_weekly_v1"],
    ["2026-10-30T11:00:00Z", "2026-10-30", "friday_weekly_v1"],
    ["2027-01-01T11:00:00Z", "2027-01-01", "friday_weekly_v1"],
  ]) {
    const now = new Date(start);
    assert.equal(operation.scheduledStart(type, day, now), true);
    assert.equal(operation.scheduledStart(type, day, new Date(now.getTime() + 60_000)), false);
    assert.equal(operation.completionWindow(type, day, new Date(now.getTime() + 14 * 60_000)), true);
    assert.equal(operation.completionWindow(type, day, new Date(now.getTime() + 15 * 60_000)), false);
    assert.equal(operation.dispatchWindow(type, day, new Date(now.getTime() + 15 * 60_000)), type === "friday_weekly_v1");
  }
  assert.equal(dates.weeklyPeriod("2027-01-01").monday, "2026-12-28");
  assert.equal(dates.determineScheduledControl(new Date("2026-10-12T07:00:00Z")), null);
  assert.equal(operation.dispatchWindow("daily_09", "2026-10-18", new Date("2026-10-19T07:01:00Z")), false);
  assert.equal(operation.dispatchWindow("daily_09", "2026-10-23", new Date("2026-10-24T07:01:00Z")), false);
});

test("operational identity changes invalidate cohort compatibility, without changing mail deduplication key", () => {
  const identity = { fitter_id: "290", group_id: "fixture-group", approval_version: 1, approved_email: "mbo@example.test" };
  const hash = operation.identityHash(identity);
  for (const changed of [{ approval_version: 2 }, { group_id: "another-group" }, { fitter_id: "15" }, { approved_email: "changed@example.test" }]) {
    assert.notEqual(operation.identityHash({ ...identity, ...changed }), hash);
  }
  assert.equal(operation.identityHash({ ...identity, tenant_user_id: "optional-login" }), hash);
});

test("blocked, dry-run and historical controls never issue operational receipts", async () => {
  const start = new Date("2026-10-20T07:00:00Z");
  const execution = { startedAt:start, now:() => start, controlledDate:"2026-10-19", historical:false };
  const run = { status:"completed", mode:"live", triggered_by:"scheduler", control_type:"daily_09" };
  const client = { query:async () => { throw new Error("ineligible_receipt_queried_database"); } };
  for (const changed of [{ status:"blocked" }, { status:"running" }, { mode:"dry_run" }, { triggered_by:"manual" }, { triggered_by:"backfill" }]) {
    assert.deepEqual(await operation.recordChecks(client, { tenantId:"tenant", run:{...run,...changed}, results:[{}], execution }), []);
  }
  assert.deepEqual(await operation.recordChecks(client, { tenantId:"tenant", run, results:[{}],
    execution:{...execution,historical:true} }), []);
  assert.deepEqual(await operation.recordChecks(client, { tenantId:"tenant", run, results:[{}],
    execution:{...execution,startedAt:new Date("2026-10-20T07:01:00Z")} }), []);
  assert.deepEqual(await operation.recordChecks(client, { tenantId:"tenant", run, results:[{}],
    execution:{...execution,now:() => new Date("2026-10-20T07:15:00Z")} }), []);
});

test("scheduler starts tenants concurrently, bounds fanout and rejects expired queued starts", async () => {
  const scheduler = require("../backend/src/modules/timeControl/timeControl.scheduler")._test;
  let clock = new Date("2026-10-20T07:00:00Z"), active = 0, peak = 0;
  const starts = [], unblock = [];
  const scheduled = dates.determineScheduledControl(clock);
  const promise = scheduler.runTenantControls(["a","b","c","d","e"], scheduled, {
    now:() => clock,
    dispatch:async () => ({ skipped: true, reason: "mocked_dispatch" }),
    runControl:async args => {
      starts.push({ tenant:args.tenantId, at:clock.toISOString() });
      peak = Math.max(peak, ++active);
      await new Promise(resolve => unblock.push(resolve));
      active--;
      return { run:{ id:args.tenantId, status:"completed" } };
    },
  });
  assert.equal(starts.length, 4);
  assert.equal(peak, scheduler.TENANT_CONCURRENCY);
  assert.ok(starts.every(s => s.at === "2026-10-20T07:00:00.000Z"));
  clock = new Date("2026-10-20T07:01:30Z");
  for (const resolve of unblock) resolve();
  const originalError = console.error;
  try {
    console.error = () => {};
    const results = await promise;
    assert.equal(results.filter(r => r.ok).length, 4);
    assert.equal(results[4].error, "time_control_scheduled_start_window_expired");
    assert.equal(starts.length, 4);
  } finally { console.error = originalError; }
});

test("Monday or Tuesday before 09 with explicit Monday coverage qualifies; late Tuesday/Thursday cannot", async () => {
  const identity = { fitter_id: "290", group_id: "group", approval_version: 1, approved_email: "mbo@example.test" };
  const period = dates.weeklyPeriod("2026-10-23");
  for (const [startedAt, coveredDay, expected] of [
    ["2026-10-19T06:00:00Z", "2026-10-19", true],
    ["2026-10-20T06:59:00Z", "2026-10-19", true],
    ["2026-10-20T07:00:00Z", "2026-10-19", false],
    ["2026-10-22T06:00:00Z", "2026-10-19", false],
    ["2026-10-20T06:00:00Z", "2026-10-20", false],
  ]) {
    const client = { query: async sql => ({
      rows: sql.includes("operation_state") ? [{
        id: "epoch", status: "active", started_at: startedAt, covered_day: coveredDay,
        cohort_json: [{ fitter_id: identity.fitter_id, identity_hash: operation.identityHash(identity) }],
      }] : period.days.slice(0, 4).map(day => ({
        id: day, controlled_date: day, control_type: "daily_09", identity_hash: operation.identityHash(identity),
      })),
    }) };
    const gate = await operation.checkGate(client, { tenantId: "tenant", identity, friday: period.friday });
    assert.equal(gate.eligible, expected, startedAt);
    if (!expected) assert.equal(gate.reason, "first_partial_operational_week");
  }
});

test("October 12-16 requires exactly four planned daily checks and the current Friday snapshot", async () => {
  const identity = { fitter_id: "290", group_id: "group", approval_version: 1, approved_email: "mbo@example.test" };
  const hash = operation.identityHash(identity);
  const period = dates.weeklyPeriod("2026-10-16");
  assert.deepEqual(period.days, ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
  const slots = period.days.slice(0, 4).map(day => dates.determineScheduledControl(new Date(`${dates.addDaysIso(day, 1)}T07:00:59.999Z`)));
  assert.ok(slots.every(slot => slot.controlType === "daily_09"));
  assert.deepEqual(slots.map(slot => slot.controlledDate), period.days.slice(0, 4));
  assert.equal(dates.determineScheduledControl(new Date("2026-10-13T07:01:00Z")), null);
  assert.equal(dates.determineScheduledControl(new Date("2026-10-16T10:00:00Z")).controlType, "friday_weekly_v1");
  let startedAt = "2026-10-13T06:59:59.999Z";
  let receipts = period.days.slice(0, 4).map(day => ({
    id: day, controlled_date: day, control_type: "daily_09", identity_hash: hash,
  }));
  const client = { query: async (sql, values) => {
    if (sql.includes("operation_state")) return { rows: [{
      id: "epoch", status: "active", started_at: startedAt, covered_day: period.monday,
      cohort_json: [{ fitter_id: identity.fitter_id, identity_hash: hash }],
    }] };
    assert.match(sql, /r\.status='completed'/);
    assert.deepEqual(values, ["tenant", "epoch", "290", period.monday, period.friday]);
    return { rows: receipts };
  } };
  const args = { tenantId: "tenant", identity, friday: period.friday };
  assert.deepEqual((await operation.checkGate(client, args)).receipt_ids, period.days.slice(0, 4));
  for (const missing of period.days.slice(0, 4)) {
    const original = receipts;
    receipts = original.filter(receipt => receipt.controlled_date !== missing);
    receipts.push({ id: "manual", controlled_date: missing, control_type: "manual", identity_hash: hash });
    assert.equal((await operation.checkGate(client, args)).reason, `scheduled_control_missing:daily_09:${missing}`);
    receipts = original;
  }
  assert.equal((await operation.checkGate(client, { ...args, requireWeekly: true, snapshotId: "current" })).reason,
    "scheduled_control_missing:friday_weekly_v1:2026-10-16");
  receipts.push({ id: "weekly", controlled_date: period.friday, control_type: "friday_weekly_v1", identity_hash: hash, weekly_snapshot_id: "current" });
  assert.equal((await operation.checkGate(client, { ...args, requireWeekly: true, snapshotId: "current" })).receipt_ids.length, 5);
  assert.equal((await operation.checkGate(client, { ...args, requireWeekly: true, snapshotId: "old" })).eligible, false);
  startedAt = "2026-10-13T07:00:00Z";
  assert.equal((await operation.checkGate(client, args)).reason, "first_partial_operational_week");
});

test("active daily identity requires tenant-scoped cohort and coverage before enqueue", async () => {
  const identity = { fitter_id: "290", group_id: "group", approval_version: 1, approved_email: "mbo@example.test" };
  const op = { id: "epoch", status: "active", covered_day: "2026-10-12",
    cohort_json: [{ fitter_id: "290", identity_hash: operation.identityHash(identity) }] };
  let state = op;
  let queries = 0;
  const client = { query: async (sql, values) => {
    queries++;
    assert.match(sql, /s\.tenant_id=\$1 AND s\.group_id=\$2 FOR SHARE OF s,o/);
    assert.deepEqual(values, ["tenant", "group"]);
    return { rows: state ? [state] : [] };
  } };
  const args = { tenantId: "tenant", identity, controlledDate: "2026-10-12" };
  await assert.rejects(operation.requireActiveIdentity(client, { ...args, identity: {} }), /approved_identity_missing/);
  assert.equal(queries, 0);
  assert.deepEqual(await operation.requireActiveIdentity(client, args), { operation_id: "epoch", receipt_ids: [] });
  state = null;
  await assert.rejects(operation.requireActiveIdentity(client, args), /operation_not_active/);
  state = { ...op, status: "paused" };
  await assert.rejects(operation.requireActiveIdentity(client, args), /operation_not_active/);
  state = op;
  await assert.rejects(operation.requireActiveIdentity(client, { ...args, identity: { ...identity, approval_version: 2 } }), /cohort_changed/);
  await assert.rejects(operation.requireActiveIdentity(client, { ...args, controlledDate: "2026-10-11" }), /coverage_start_after_controlled_date/);
});

test("daily dispatch requires the exact run/date/identity receipt in the current epoch", async () => {
  const identity = { fitter_id: "290", group_id: "group", approval_version: 1, approved_email: "mbo@example.test" };
  const hash = operation.identityHash(identity);
  let epoch = "original";
  let receiptPresent = true;
  const client = { query: async (sql, values) => {
    if (sql.includes("operation_state")) return { rows: [{ id: epoch, status: "active", covered_day: "2026-10-12",
      cohort_json: [{ fitter_id: "290", identity_hash: hash }] }] };
    assert.match(sql, /r\.tenant_id=c\.tenant_id AND r\.id=c\.run_id/);
    assert.match(sql, /c\.tenant_id=\$1 AND c\.operation_id=\$2 AND c\.group_id=\$3 AND c\.fitter_id=\$4/);
    assert.match(sql, /c\.run_id=\$5 AND c\.controlled_date=\$6::date AND c\.control_type='daily_09' AND c\.identity_hash=\$7/);
    assert.match(sql, /r\.status='completed' AND r\.mode='live' AND r\.triggered_by='scheduler'/);
    assert.match(sql, /r\.control_type=c\.control_type AND r\.controlled_date=c\.controlled_date/);
    assert.match(sql, /FOR SHARE OF c,r/);
    assert.deepEqual(values, ["tenant", epoch, "group", "290", "daily-run", "2026-10-12", hash]);
    return { rows: receiptPresent && epoch === "original" ? [{ id: "receipt" }] : [] };
  } };
  const args = { tenantId: "tenant", identity, controlledDate: "2026-10-12", runId: "daily-run" };
  assert.deepEqual(await operation.requireActiveIdentity(client, args), { operation_id: "original", receipt_ids: ["receipt"] });
  receiptPresent = false;
  await assert.rejects(operation.requireActiveIdentity(client, args), /daily_receipt_missing/);
  receiptPresent = true;
  epoch = "restarted";
  await assert.rejects(operation.requireActiveIdentity(client, args), /daily_receipt_missing/);
  assert.equal((await operation.requireActiveIdentity(client, { ...args, runId: null })).operation_id, "restarted");
});

test("whole current cohorts are locked and cannot shrink or disappear between evaluation and dispatch", async t => {
  const repo = require("../backend/src/modules/timeControl/timeControl.repository");
  const service = require("../backend/src/modules/timeControl/timeControl.service");
  const identities = ["15", "290"].map(fitter_id => ({ fitter_id, group_id: "group", approval_version: 1, approved_email: `${fitter_id}@example.test` }));
  const op = { id: "epoch", group_id: "group", cohort_json: identities.map(identity => ({
    fitter_id: identity.fitter_id, identity_hash: operation.identityHash(identity),
  })) };
  let configs = identities.map(identity => ({ id: identity.fitter_id, identity }));
  const client = { query: async (sql, args) => {
    assert.equal(args[0], "tenant");
    if (sql.includes("FROM time_control_operation_state")) return { rows: [op] };
    assert.match(sql, /tenant_id=\$1 AND approved_group_id=\$2/);
    assert.match(sql, /FOR SHARE/);
    return { rows: configs };
  } };
  t.mock.method(repo, "resolveEmployeeConfig", async (_client, { config }) => [config]);
  t.mock.method(service._test, "classifyResolvedEmployee", config => ({ ok: true,
    employee: { fitterId: config.identity.fitter_id, identitySnapshot: config.identity } }));
  const check = () => operation.requireCurrentCohorts(client, { tenantId: "tenant", controlledDate: "2026-10-12" });
  assert.equal((await check()).length, 1);
  configs = configs.slice(0, 1);
  await assert.rejects(check(), /cohort_changed/);
  configs = [];
  await assert.rejects(check(), /cohort_changed/);
});

test("operation activation timestamp is taken after waiting across the Tuesday 09:00 boundary", async t => {
  const repo = require("../backend/src/modules/timeControl/timeControl.repository");
  const service = require("../backend/src/modules/timeControl/timeControl.service");
  const audit = require("../backend/src/services/auditService");
  const RealDate = Date;
  let clock = new RealDate("2026-10-13T06:59:59Z").getTime();
  global.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [clock])); } };
  t.after(() => { global.Date = RealDate; });
  const identity = { fitter_id: "15", group_id: "group", approval_version: 1, approved_email: "mhj@example.test" };
  t.mock.method(repo, "listEmployeeConfigs", async () => [{ id: "config", approved_group_id: "group" }]);
  t.mock.method(repo, "resolveEmployeeConfig", async () => []);
  t.mock.method(service._test, "classifyResolvedEmployee", () => ({ ok: true, employee: { identitySnapshot: identity } }));
  t.mock.method(audit, "logAuditEvent", async () => {});
  let startedAt;
  const client = { query: async (sql, args) => {
    if (sql.includes("FROM tenant_user")) return { rows: [{ id: "actor" }] };
    if (sql.includes("pg_advisory_xact_lock")) clock = new RealDate("2026-10-13T07:00:02Z").getTime();
    if (sql.includes("INSERT INTO time_control_operation(")) { startedAt = args[3]; return { rows: [{ id: "epoch" }] }; }
    return { rows: [] };
  } };
  await operation.setOperation(client, { tenantId: "tenant", actorId: "actor", groupId: "group", coveredFrom: "2026-10-12", status: "active" });
  assert.equal(startedAt.toISOString(), "2026-10-13T07:00:02.000Z");
  await assert.rejects(operation.requireActiveIdentity({ query: async () => ({ rows: [{ id: "new-epoch", status: "active", started_at: startedAt }] }) }, {
    tenantId: "tenant", identity, controlledDate: "2026-10-12", startedAt: new RealDate("2026-10-13T07:00:00Z"), operationIds: ["original-epoch"],
  }), /not_active_at_scheduled_start/);
});

test("operation and catch-up routes reject tenant mismatch/RBAC and derive operation actor server-side", async () => {
  const router = require("../backend/src/modules/timeControl/timeControl.routes");
  const access = require("../backend/src/services/moduleAccessService");
  const tx = require("../backend/src/db/tx");
  const originalAccess = access.requireModuleAccess;
  const originalTx = tx.withTransaction;
  const originalOperation = operation.setOperation;
  const originalError = console.error;
  const groupId = "00000000-0000-4000-8000-000000000061";
  const req = {
    auth: { tenant_id: "server-tenant", sub: "server-admin", role: "tenant_admin" },
    context: { tenant: { id: "server-tenant", slug: "fixture" } },
    body: { tenant_id: "untrusted-tenant", actor_id: "untrusted-actor", group_id: groupId,
      covered_from: "2026-10-19", status: "active", confirm: "BEKRAEFT:timekontrol-drift:fixture:active" },
  };
  const res = { status() { return this; }, json() {} };
  let calls = 0;
  try {
    console.error = () => {};
    access.requireModuleAccess = () => {};
    tx.withTransaction = fn => fn({});
    operation.setOperation = async (client, args) => {
      calls++;
      assert.equal(args.tenantId, "server-tenant");
      assert.equal(args.actorId, "server-admin");
      assert.equal(args.groupId, groupId);
      return { status: "active" };
    };
    const routes = [["/operation", "post"], ["/operation", "get"], ["/catch-up", "post"]];
    for (const [suffix, method] of routes) {
      const route = router.stack.find(layer => layer.route?.path === `/api/tenant/admin/time-control${suffix}` &&
        layer.route.methods[method]).route;
      const handler = route.stack.at(-1).handle;
      let error;
      await handler({ ...req, auth: { ...req.auth, tenant_id: "different-tenant" } }, res, e => { error = e; });
      assert.equal(error.statusCode, 403);
      access.requireModuleAccess = () => { const denied = new Error("denied"); denied.statusCode = 403; throw denied; };
      await handler(req, res, e => { error = e; });
      assert.equal(error.statusCode, 403);
      access.requireModuleAccess = () => {};
      if (suffix === "/operation" && method === "post") {
        error = null;
        await handler(req, res, e => { error = e; });
        assert.equal(error, null);
        await handler({ ...req, body: { ...req.body, confirm: "wrong" } }, res, e => { error = e; });
        assert.equal(error.statusCode, 400);
      }
    }
    assert.equal(calls, 1);
  } finally {
    console.error = originalError;
    access.requireModuleAccess = originalAccess;
    tx.withTransaction = originalTx;
    operation.setOperation = originalOperation;
  }
});
