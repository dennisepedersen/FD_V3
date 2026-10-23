"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), { randomUUID } = require("node:crypto");
const fixtureDatabaseUrl = "postgres://example.invalid/approval_scheduler", fixtureSigningKey = randomUUID();
Object.assign(process.env, { NODE_ENV: "test", DATABASE_URL: fixtureDatabaseUrl,
  JWT_SECRET: fixtureSigningKey, ROOT_DOMAIN: "example.test" });
const ENV = require("../backend/src/config/env"), pool = require("../backend/src/db/pool");
const scheduler = require("../backend/src/modules/approvalControl/approvalControl.scheduler");
const policy = require("../backend/src/modules/approvalControl/approvalControl.mailPolicy");
const control = require("../backend/src/modules/approvalControl/approvalControl.control");
const context = { tenantId: randomUUID(), userId: randomUUID(), tenantSlug: "hoyrup-clemmensen" };
const patches = async (items, fn) => {
  const undo = items.map(([object, key, value]) => { const old = object[key]; object[key] = value; return () => { object[key] = old; }; });
  try { return await fn(); } finally { undo.reverse().forEach(fn => fn()); }
};
async function production(fn) {
  const keys = ["APPROVAL_CONTROL_SCHEDULER_ENABLED", "APPROVAL_CONTROL_MAIL_ENABLED"], old = keys.map(key => process.env[key]);
  keys.forEach(key => delete process.env[key]);
  try { return await patches([[ENV, "NODE_ENV", "production"]], fn); }
  finally { keys.forEach((key, index) => { if (old[index] === undefined) delete process.env[key]; else process.env[key] = old[index]; }); }
}

test("absent tenant control is off even with old positive flags; persisted tenant state enables without a new environment edit", () => {
  for (const env of [{}, { APPROVAL_CONTROL_SCHEDULER_ENABLED: "true", APPROVAL_CONTROL_MAIL_ENABLED: "true" }]) {
    assert.equal(policy.read(env).scheduler_enabled, false);
    assert.equal(policy.read(env).mail_enabled, false);
    assert.equal(policy.read(env, new Date(), null, { enabled: true }).scheduler_enabled, true);
  }
  assert.equal(policy.runtimeAllowed({}), true);
  for (const key of ["APPROVAL_CONTROL_SCHEDULER_ENABLED", "APPROVAL_CONTROL_MAIL_ENABLED"]) {
    assert.equal(policy.runtimeAllowed({ [key]: "false" }), false);
    assert.equal(policy.runtimeAllowed({ [key]: "invalid" }), false);
  }
});

test("scheduler is inert in test/development and outside the approved weekday minute, including Friday14:30", async () => production(async () => {
  let reads = 0;
  const options = { list: async () => { reads++; return []; } };
  for (const now of ["2026-10-22T12:29:59Z", "2026-10-22T12:31:00Z", "2026-10-23T12:30:00Z", "2026-10-24T12:30:00Z", "2026-10-25T13:30:00Z"]) {
    assert.equal((await scheduler.tick(new Date(now), options)).state, "not_due");
  }
  for (const mode of ["test", "development"]) await patches([[ENV, "NODE_ENV", mode]], async () => {
    assert.equal((await scheduler.tick(new Date("2026-10-22T12:30:00Z"), options)).state, "disabled");
  });
  assert.equal(reads, 0);
}));

test("weekday schedules use Copenhagen DST; inactive and paused tenants never enter the mail job", async () => production(async () => {
  for (const instant of ["2026-10-22T12:30:00Z", "2026-10-23T12:31:00Z", "2026-10-26T13:30:00Z", "2026-10-30T13:31:00Z"]) {
    let calls = 0;
    const options = { list: async () => [context], read: async () => ({ enabled: false }), run: async () => { calls++; } };
    assert.equal((await scheduler.tick(new Date(instant), options)).state, "checked");
    assert.equal(calls, 0);
    options.read = async () => ({ enabled: true });
    options.run = async (actor, input) => { assert.deepEqual(actor, context); assert.deepEqual(input, { mode: "live" }); calls++; return { state: "duplicate" }; };
    const result = await scheduler.tick(new Date(instant), options);
    assert.equal(calls, 1); assert.equal(result.results[0].state, "duplicate");
  }
}));

test("explicit false emergency flags prevent even tenant discovery", async () => production(async () => {
  for (const key of ["APPROVAL_CONTROL_SCHEDULER_ENABLED", "APPROVAL_CONTROL_MAIL_ENABLED"]) {
    process.env[key] = "false";
    assert.equal((await scheduler.tick(new Date("2026-10-22T12:30:00Z"), { list: () => assert.fail("discovery blocked") })).state, "disabled");
    delete process.env[key];
  }
}));

test("invalid Friday or historical period overrides block before any tenant discovery", async () => production(async () => {
  for (const [key, value] of [["APPROVAL_CONTROL_FRIDAY_TIME", "14:30"], ["APPROVAL_CONTROL_COVERAGE_FROM", "2020-01-01"]]) {
    const before = process.env[key];
    try {
      process.env[key] = value;
      assert.equal((await scheduler.tick(new Date("2026-10-23T12:30:00Z"), { list: () => assert.fail("invalid policy cannot discover tenants") })).state, "blocked");
    } finally { if (before === undefined) delete process.env[key]; else process.env[key] = before; }
  }
}));

test("process-local overlapping ticks are suppressed and failures do not escape as provider detail", async () => production(async () => {
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const options = { list: async () => [context], read: async () => ({ enabled: true }), run: async () => { entered(); await pending; return { result: { state: "no_open" } }; } };
  const first = scheduler.tick(new Date("2026-10-22T12:30:00Z"), options);
  await ready;
  assert.equal((await scheduler.tick(new Date("2026-10-22T12:30:10Z"), options)).state, "running");
  release(); assert.equal((await first).results[0].state, "no_open");
  const errors = [];
  await patches([[console, "error", (...args) => errors.push(args)]], async () => {
    const result = await scheduler.tick(new Date("2026-10-22T12:30:00Z"), { ...options, run: async () => { throw new Error("provider-private-data"); } });
    assert.equal(result.results[0].state, "failed");
  });
  assert.doesNotMatch(JSON.stringify(errors), /provider-private-data/);
}));

test("new scheduler attaches once without a startup job, uses wall-clock alignment and can be stopped independently", async () => production(async () => {
  const timers = [], cleared = [];
  await patches([[global, "setTimeout", (callback, delay) => { const timer = { callback, delay, unref() {} }; timers.push(timer); return timer; }],
    [global, "clearTimeout", timer => cleared.push(timer)], [pool, "query", () => assert.fail("startup must not discover or run")]], async () => {
    assert.equal(scheduler.isAttached(), false);
    scheduler.startApprovalControlScheduler(); scheduler.startApprovalControlScheduler();
    assert.equal(scheduler.isAttached(), true); assert.equal(timers.length, 1);
    assert(timers[0].delay > 0 && timers[0].delay <= 60000);
    scheduler.stopApprovalControlScheduler(); assert.equal(scheduler.isAttached(), false);
    assert.deepEqual(cleared, timers);
  });
}));

test("candidate discovery uses only the existing active HC/DEP identity, never client identifiers or resource groups", async () => {
  await patches([[pool, "query", async sql => {
    assert.match(sql, /u.tenant_id=t.id/); assert.match(sql, /t.slug='hoyrup-clemmensen'/);
    assert.match(sql, /lower\(u.username\)='dep'/); assert.match(sql, /u.login_status='active'/);
    assert.doesNotMatch(sql, /resource_group|fitter/);
    return { rows: [{ user_id: context.userId, tenant_id: context.tenantId, tenant_slug: context.tenantSlug }] };
  }]], async () => assert.deepEqual(await scheduler.candidates(), [context]));
  await patches([[pool, "query", async () => ({ rows: [{}, {}] })]], async () => assert.rejects(scheduler.candidates(), /ambiguous/));
});

test("slot generation binding rejects pause/resume and any activation within the current slot", () => {
  const first = { id: randomUUID(), coverage_from: "2026-10-23" }, planned = { scheduled_at: "2026-10-23T12:31:00Z" };
  const state = { enabled: true, revision: 1, activation_id: first.id, coverage_from: first.coverage_from, enabled_at: "2026-10-23T12:30:59Z" };
  assert.equal(control.validForSlot(state, planned, first), true);
  for (const changed of [{ enabled: false }, { enabled_at: planned.scheduled_at }, { enabled_at: "2026-10-23T12:31:01Z" }, { activation_id: randomUUID() }, { coverage_from: "2026-10-22" }]) {
    assert.equal(control.validForSlot({ ...state, ...changed }, planned, first), false);
  }
});
