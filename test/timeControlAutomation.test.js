"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://example.invalid/fielddesk_test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.ROOT_DOMAIN = "example.test";
const automation = require("../backend/src/modules/timeControl/timeControl.automation");
const dispatch = require("../backend/src/modules/timeControl/timeControl.dispatch");
const operation = require("../backend/src/modules/timeControl/timeControl.operation");
const service = require("../backend/src/modules/timeControl/timeControl.service");
const ENV = require("../backend/src/config/env");
const tenantId = "f1f51c07-2d88-4ee4-a766-78eac833a9d0";
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function flags(t, enabled = true) {
  for (const [key, value] of Object.entries({ TIME_CONTROL_SCHEDULER_ENABLED: enabled ? "true" : "false",
    TIME_CONTROL_MAIL_ENABLED: enabled ? "true" : "false" })) {
    const original = process.env[key];
    process.env[key] = value;
    t.after(() => { if (original === undefined) delete process.env[key]; else process.env[key] = original; });
  }
}

test("automatic Timekontrol is default-off and a disabled tick does not query the database", async t => {
  flags(t, false);
  const pool = require("../backend/src/db/pool");
  t.mock.method(pool, "query", async () => { throw new Error("disabled_scheduler_queried_db"); });
  const scheduler = require("../backend/src/modules/timeControl/timeControl.scheduler");
  assert.deepEqual(await scheduler._test.tick(new Date("2026-10-13T07:00:00Z")), { skipped: true, reason: "scheduler_disabled" });
  let calls = 0;
  assert.equal((await automation.dispatchRun({ tenantId, result: {} }, async () => { calls++; })).skipped, true);
  assert.equal(calls, 0);
  delete process.env.TIME_CONTROL_MAIL_ENABLED;
  assert.equal(automation.mailEnabled(), false);
  assert.throws(automation.requireSendingEnabled, /automatic_mail_disabled/);
});

test("scheduler bridge dispatches only exact unique IDs from the committed live scheduled run", async t => {
  flags(t);
  const run = { id: id(1), mode: "live", triggered_by: "scheduler", control_type: "daily_09", status: "completed" };
  const result = { run, mails: [{ email_outbox_id: id(2) }, { email_outbox_id: id(2) }, { email_outbox_id: null }, { email_outbox_id: id(3) }] };
  const calls = [];
  const process = async args => { calls.push(args); return { claimed: 2, sent: 2 }; };
  assert.equal((await automation.dispatchRun({ tenantId, result }, process)).sent, 2);
  assert.deepEqual(calls, [{ tenantId, timeControlOutboxIds: [id(2), id(3)] }]);
  for (const patch of [{ mode: "dry_run" }, { triggered_by: "manual_test" }, { control_type: "manual" }, { control_type: "friday_12" }]) {
    assert.equal((await automation.dispatchRun({ tenantId, result: { ...result, run: { ...run, ...patch } } }, process)).skipped, true);
  }
  assert.equal(calls.length, 1);
});

test("scheduler reports blocked calculation as failure and calls the narrow dispatch bridge after evaluation", async t => {
  flags(t);
  t.mock.method(console, "log", () => {});
  const scheduler = require("../backend/src/modules/timeControl/timeControl.scheduler")._test;
  const now = new Date("2026-10-13T07:00:00Z");
  const events = [];
  const result = { run: { id: id(1), status: "blocked", error_reason: "unsafe_data" } };
  const rows = await scheduler.runTenantControls([tenantId], require("../backend/src/modules/timeControl/timeControl.dates").determineScheduledControl(now), {
    now: () => now, runControl: async () => { events.push("evaluation_committed"); return result; },
    dispatch: async args => { assert.equal(args.result, result); events.push("narrow_dispatch"); return { claimed: 0 }; },
  });
  assert.deepEqual(events, ["evaluation_committed", "narrow_dispatch"]);
  assert.equal(rows[0].ok, false);
  assert.equal(rows[0].status, "blocked");
  assert.equal(rows[0].error, "unsafe_data");
});

function guardFixture(t) {
  flags(t);
  for (const [key, value] of Object.entries({ MAIL_REPLY_TO: "admin@fielddesk.dk", MAIL_PROVIDER: "resend", MAIL_API_KEY: "dummy" })) {
    const original = ENV[key];
    ENV[key] = value;
    t.after(() => { ENV[key] = original; });
  }
  t.mock.method(operation, "scheduledStart", () => true);
  t.mock.method(operation, "dispatchWindow", () => true);
  t.mock.method(operation, "requireCurrentCohorts", async () => []);
  const settings = { is_enabled: true, mode: "live", live_enabled_at: "2026-10-12T11:00:00Z",
    employee_cc_emails: ["dep@hoyrup-clemmensen.dk"], friday_manager_emails: ["dep@hoyrup-clemmensen.dk"],
    internal_error_emails: ["dep@hoyrup-clemmensen.dk"] };
  const run = { id: id(1), mode: "live", triggered_by: "scheduler", control_type: "daily_09",
    controlled_day: "2026-10-12", started_at: "2026-10-13T07:00:00Z", status: "completed" };
  const row = { tenant_id: tenantId, source_type: "time_control", source_id: id(2),
    template_key: "time_control.missing_hours.employee", recipient_email: "mhj@hoyrup-clemmensen.dk",
    payload_json: { run_id: run.id, sender: service.SENDER, reply_to: "admin@fielddesk.dk", cc_emails: ["dep@hoyrup-clemmensen.dk"] } };
  const s = { settings, run, row, active: true };
  const client = { query: async (sql, values) => {
    assert.equal(values[0], tenantId);
    if (sql.includes("FROM time_control_settings")) return { rows: [settings] };
    if (sql.includes("FROM time_control_run")) return { rows: [run] };
    if (sql.includes("FROM time_control_operation_state")) return { rows: s.active ? [{ id: id(9) }] : [] };
    throw new Error(`unexpected_query:${sql}`);
  } };
  s.validate = () => dispatch.validateAutomatic(client, { tenantId, row });
  return s;
}

test("automatic guard validates configured Timekontrol sender and reply-to without changing other mail senders", async t => {
  const s = guardFixture(t);
  await s.validate();
  for (const field of ["sender", "reply_to"]) {
    const original = s.row.payload_json[field];
    s.row.payload_json[field] = "other@example.test";
    await assert.rejects(s.validate(), /automatic_message_invalid/);
    s.row.payload_json[field] = original;
  }
});

test("automatic mail refuses an unverified transport configuration before provider access", async t => {
  const s = guardFixture(t);
  ENV.MAIL_PROVIDER = "postmark";
  await assert.rejects(s.validate(), /automatic_resend_required/);
  ENV.MAIL_PROVIDER = "resend";
  ENV.MAIL_API_KEY = "";
  await assert.rejects(s.validate(), /automatic_resend_required/);
});

for (const change of [
  s => { s.row.tenant_id = id(90); },
  s => { s.row.source_type = "absence_request"; },
  s => { s.row.template_key = "time_control.friday_manager_summary"; },
  s => { s.settings.mode = "dry_run"; },
  s => { s.settings.is_enabled = false; },
  s => { s.settings.live_enabled_at = null; },
  s => { s.run.triggered_by = "manual_test"; },
  s => { s.run.status = "blocked"; },
  s => { s.run.control_type = "manual"; },
]) {
  test("automatic guard rejects unsupported scope, manual/historical or unactivated operation before sending", async t => {
    const s = guardFixture(t);
    change(s);
    await assert.rejects(s.validate(), /time_control_automatic_/);
  });
}

for (const field of ["employee_cc_emails", "friday_manager_emails", "internal_error_emails"]) {
  test(`HC ${field} cannot silently add LKE`, async t => {
    const s = guardFixture(t);
    s.settings[field].push("lke@hoyrup-clemmensen.dk");
    await assert.rejects(s.validate(), /automatic_routing_changed/);
  });
}

test("diagnostics are routed only to the configured administrator and stop when operation is paused", async t => {
  const s = guardFixture(t);
  s.row.template_key = "time_control.internal_error";
  s.row.source_id = s.run.id;
  s.row.recipient_email = "dep@hoyrup-clemmensen.dk";
  s.row.payload_json.cc_emails = [];
  s.run.status = "blocked";
  await s.validate();
  s.active = false;
  await assert.rejects(s.validate(), /operation_not_active/);
});
