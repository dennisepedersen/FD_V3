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
  for (const changed of [{ status:"blocked" }, { status:"running" }, { mode:"dry_run" }, { triggered_by:"manual" }]) {
    assert.deepEqual(await operation.recordChecks(client, { tenantId:"tenant", run:{...run,...changed}, results:[{}], execution }), []);
  }
  assert.deepEqual(await operation.recordChecks(client, { tenantId:"tenant", run, results:[{}],
    execution:{...execution,historical:true} }), []);
});

test("scheduler starts tenants concurrently, bounds fanout and rejects expired queued starts", async () => {
  const scheduler = require("../backend/src/modules/timeControl/timeControl.scheduler")._test;
  let clock = new Date("2026-10-20T07:00:00Z"), active = 0, peak = 0;
  const starts = [], unblock = [];
  const scheduled = dates.determineScheduledControl(clock);
  const promise = scheduler.runTenantControls(["a","b","c","d","e"], scheduled, {
    now:() => clock,
    runControl:async args => {
      starts.push({ tenant:args.tenantId, at:clock.toISOString() });
      peak = Math.max(peak, ++active);
      await new Promise(resolve => unblock.push(resolve));
      active--;
      return { run:{ id:args.tenantId } };
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
