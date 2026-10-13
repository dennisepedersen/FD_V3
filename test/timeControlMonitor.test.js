"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ||= "postgres://example.invalid/blocked";
process.env.JWT_SECRET ||= "test-secret";
process.env.ROOT_DOMAIN ||= "example.test";
const pool = require("../backend/src/db/pool");
const obs = require("../backend/src/modules/timeControl/timeControl.observability");
const monitor = require("../backend/src/modules/timeControl/timeControl.monitor");
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("scheduler aligns ticks to minute boundaries without widening the scheduled minute", () => {
  const scheduler = require("../backend/src/modules/timeControl/timeControl.scheduler")._test;
  assert.equal(scheduler.nextTickDelay(Date.parse("2026-10-14T06:59:55.511Z")), 4489);
  assert.equal(scheduler.nextTickDelay(Date.parse("2026-10-14T07:00:00.000Z")), 60000);
  assert.equal(scheduler.nextTickDelay(Date.parse("2026-10-14T07:00:59.999Z")), 1);
});

test("expected slots and report deadlines use Copenhagen through DST and Friday consolidation", () => {
  assert.equal(obs.scheduledAt("2026-10-14", 9).toISOString(), "2026-10-14T07:00:00.000Z");
  assert.equal(obs.scheduledAt("2026-10-28", 9).toISOString(), "2026-10-28T08:00:00.000Z");
  assert.equal(obs.slotsForDay("2026-10-12").length, 0);
  assert.equal(obs.slotsForDay("2026-10-17").length, 0);
  assert.deepEqual(obs.slotsForDay("2026-10-16").map(s => s.controlledDate), ["2026-10-15", "2026-10-16"]);
  assert.equal(obs.reportDueAt("2026-10-14").toISOString(), "2026-10-14T07:20:00.000Z");
  assert.equal(obs.reportDueAt("2026-10-16").toISOString(), "2026-10-16T10:20:00.000Z");
});
test("transport status never equates queued or absent receipt with provider acceptance", () => {
  assert.equal(obs.deliveryState({ status: "sent", provider_message_id: uuid(1) }), "accepted");
  assert.equal(obs.deliveryState({ status: "sent", provider_message_id: null }), "pending");
  assert.equal(obs.deliveryState({ status: "processing" }), "unclear");
  assert.equal(obs.deliveryState({ status: "dead_letter", last_error_code: "provider_acceptance_unclear" }), "unclear");
  assert.equal(obs.deliveryState({ status: "dead_letter", last_error_code: "mail_provider_rejected_message" }), "rejected");
});
test("whole pipeline distinguishes successful calculation from failed employee transport", () => {
  const run = { status: "completed" };
  const results = ["ok", "ok", "missing_hours", "missing_hours", "missing_hours", "missing_hours"].map(status => ({ status }));
  const mails = Array.from({ length: 4 }, () => ({ template_key: "time_control.missing_hours.employee", status: "dead_letter", last_error_code: "provider_acceptance_unclear" }));
  const state = obs.outcome(run, results, mails);
  assert.equal(state.status, "partial");
  assert.deepEqual(state.counts, { ok: 2, under_norm: 4, blocked: 0, expected_mails: 4, accepted: 0, pending: 0, rejected: 0, unclear: 4 });
  assert.equal(obs.outcome(run, Array.from({ length: 6 }, () => ({ status: "ok" })), []).status, "completed");
  assert.equal(obs.outcome({ status: "blocked", error_reason: "time_control_capture_invalid:request_failed" }, [], []).status, "failed");
});
test("status remains independent of successful acquisition and reports no-reminder success", () => {
  const message = monitor.buildStatusMessage({ tenantId: obs.HC, reportDate: "2026-10-14", executions: [
    { controlled_date: "2026-10-13", control_type: "daily_09", status: "completed", counts: { ok: 6, expected_mails: 0 }, mails: [] },
  ] });
  assert.equal(message.to, obs.DEP);
  assert.deepEqual(message.cc, []);
  assert.equal(message.from, "Fielddesk Timekontrol <timekontrol@mail.fielddesk.dk>");
  assert.equal(message.replyTo, "admin@fielddesk.dk");
  assert.match(message.text, /OK: 6/);
  assert.match(message.text, /medarbejdermails: 0/);
  assert.match(message.text, /Provideraccept er ikke bevis/);
  const failed = monitor.buildStatusMessage({ tenantId: obs.HC, reportDate: "2026-10-14", executions: [
    { controlled_date: "2026-10-13", status: "failed", error_code: "time_control_capture_invalid:request_failed", steps: [{ step: "capture_completed", status: "failed" }] },
  ] });
  assert.match(failed.text, /Stoppunkt: Indhentning fra EK/);
  assert.match(failed.text, /Årsag: Kaldet til EK mislykkedes/);
  assert.doesNotMatch(failed.text, /capture_completed|request_failed/);
  assert.throws(() => monitor.buildStatusMessage({ tenantId: uuid(1), reportDate: "2026-10-14", executions: [] }), /scope_invalid/);
});

test("status labels published registration rows per date, never page reads, passes or worked hours", () => {
  const capture = (day, count) => ({ step: "capture_completed", status: "completed", counts: { controlled_date: day, row_count: count, pass_count: 2 } });
  const message = monitor.buildStatusMessage({ tenantId: obs.HC, reportDate: "2026-10-16", executions: [
    { controlled_date: "2026-10-16", control_type: "friday_weekly_v1", status: "completed", steps: [
      { step: "capture_page", status: "completed", counts: { row_count: 100 } },
      capture("2026-10-12", 168), capture("2026-10-12", 168), capture("2026-10-13", 0),
      capture("2026-10-14", null),
      { ...capture("2026-10-15", 20), status: "failed" },
    ] },
  ] });
  assert.match(message.text, /2026-10-12: 168 registreringsrækker fra EK \(ikke antal arbejdstimer\)/);
  assert.equal(message.text.match(/168 registreringsrækker/g).length, 1);
  assert.match(message.text, /2026-10-13: 0 registreringsrækker/);
  assert.doesNotMatch(message.text, /168 timer|336|100 registreringsrækker|20 registreringsrækker|2026-10-14: 0/);
  const unknown = monitor.buildStatusMessage({ tenantId: obs.HC, reportDate: "2026-10-14", executions: [
    { controlled_date: "2026-10-13", status: "failed", error_code: "unknown_private_code", steps: [] },
  ] });
  assert.match(unknown.text, /antal registreringsrækker er ikke oplyst/);
  assert.match(unknown.text, /Stoppunkt: Kontrolkørsel. Årsag: Kontrollen kunne ikke gennemføres/);
  assert.doesNotMatch(unknown.text, /unknown_private_code/);
});

test("status names missing starts and incomplete transport in Danish without summary steps hiding the cause", () => {
  for (const [code, steps, stop, reason] of [
    ["time_control_expected_start_missing", [{ step: "watchdog", status: "failed" }], "Overvågning af kontrol", "Den planlagte kontrol startede ikke"],
    ["time_control_delivery_incomplete", [{ step: "dispatch", status: "failed" }, { step: "execution_finished", status: "failed" }], "Afsendelse af mails", "Ikke alle forventede mails"],
    ["provider_acceptance_unclear", [{ step: "provider_result", status: "failed" }], "Mailudbyderens svar", "genafsendes ikke automatisk"],
  ]) {
    const message = monitor.buildStatusMessage({ tenantId: obs.HC, reportDate: "2026-10-14", executions: [
      { controlled_date: "2026-10-13", status: "failed", error_code: code, steps },
    ] });
    assert.ok(message.text.includes(`Stoppunkt: ${stop}.`));
    assert.ok(message.text.includes(reason));
    assert.ok(!message.text.includes(code));
  }
});
test("status rejection is distinct from unknown acceptance and has no raw provider body", () => {
  const error = Object.assign(new Error("sensitive provider body"), { code: "mail_provider_rejected_message", details: { status: 422, body: "secret" } });
  assert.deepEqual(monitor.classifyStatusFailure(error, true), { status: "rejected", code: "mail_provider_rejected_http_422", http: 422 });
  for (const status of [408, 409, 500, 503]) assert.equal(monitor.classifyStatusFailure({ ...error, details: { status } }, true).status, "unclear");
  assert.equal(monitor.classifyStatusFailure(new Error("network failure"), true).status, "unclear");
  assert.equal(monitor.classifyStatusFailure(new Error("time_control_status_sending_disabled"), false).status, "queued");
});
test("trace accepts only safe counts and derives duration without retaining credentials or names", async t => {
  const calls = [];
  t.mock.method(pool, "query", async (sql, args) => { calls.push({ sql, args }); return { rows: sql.startsWith("SELECT") ? [{ occurred_at: new Date(Date.now() - 123) }] : [] }; });
  await obs.recordStep({ tenantId: obs.HC, executionId: uuid(2), step: "capture_page", status: "completed",
    counts: { pass: 2, page: 17, row_count: 8, controlled_date: "2026-10-13", apikey: "SECRET", employee_name: "Name", url: "https://secret.invalid" },
    errorCode: "https://secret.invalid?apikey=secret" });
  const insert = calls.find(c => c.sql.startsWith("INSERT"));
  assert.equal(insert.args[0], obs.HC);
  assert.deepEqual(JSON.parse(insert.args[4]), { pass: 2, page: 17, row_count: 8, controlled_date: "2026-10-13" });
  assert.equal(insert.args[5], "time_control_failed");
  assert.ok(insert.args[8] >= 0);
  assert.ok(!JSON.stringify(calls).includes("SECRET"));
  await assert.rejects(obs.recordStep({ tenantId: null, executionId: uuid(2), step: "test", status: "started" }), /tenant_required/);
});

async function watchdogFixture(t, execution, now) {
  const writes = [], steps = [], reports = [];
  t.mock.method(obs, "activePolicy", async () => ({ first_day: "2026-10-14" }));
  t.mock.method(obs, "ensureExecution", async (_client, { slot }) => slot.scheduledAt.toISOString() === "2026-10-14T07:00:00.000Z" ? execution : null);
  t.mock.method(obs, "recordStep", async value => steps.push(value));
  t.mock.method(obs, "getOverview", async () => ({ executions: [] }));
  t.mock.method(obs, "runEvidence", async () => ({ mails: [{ status: "queued" }] }));
  t.mock.method(pool, "query", async (sql, args) => {
    assert.equal(args[0], obs.HC);
    if (sql.includes("INSERT INTO time_control_status_report")) { reports.push(args); return { rows: [{ id: uuid(5) }] }; }
    if (sql.startsWith("UPDATE time_control_execution")) { writes.push({ sql, args }); return { rows: [{ id: execution.id }] }; }
    return { rows: [] };
  });
  await monitor.monitor({ tenantId: obs.HC, now: new Date(now), sendReports: false });
  return { writes, steps, reports };
}
test("independent watchdog discovers a run that never started without EK calls", async t => {
  t.mock.method(global, "fetch", async () => { throw new Error("must_not_fetch_ek_or_mail"); });
  const f = await watchdogFixture(t, { id: uuid(2), status: "planned" }, "2026-10-14T07:05:00Z");
  assert.equal(f.writes[0].args[2], "missed");
  assert.equal(f.steps[0].errorCode, "time_control_expected_start_missing");
  assert.equal(f.reports.length, 0);
});
test("watchdog finds unfinished execution and still prepares independent status", async t => {
  const f = await watchdogFixture(t, { id: uuid(2), status: "running" }, "2026-10-14T07:20:00Z");
  assert.equal(f.writes[0].args[2], "failed");
  assert.equal(f.steps[0].errorCode, "time_control_execution_deadline_exceeded");
  assert.equal(f.reports.length, 1);
});
test("watchdog finds unprocessed employee mail after calculation completion", async t => {
  const f = await watchdogFixture(t, { id: uuid(2), status: "completed", run_id: uuid(4) }, "2026-10-14T07:20:00Z");
  assert.match(f.writes[0].sql, /expected_mail_unprocessed/);
  assert.equal(f.steps[0].step, "watchdog_mail");
});
test("operations status route uses server tenant context, tenant-admin read permission and no action", async t => {
  const router = require("../backend/src/modules/timeControl/timeControl.routes");
  const access = require("../backend/src/services/moduleAccessService");
  const handler = router.stack.find(l => l.route?.path.endsWith("/operations-status")).route.stack.at(-1).handle;
  let reads = 0, denied = false;
  t.mock.method(console, "error", () => {});
  t.mock.method(access, "requireModuleAccess", args => { assert.equal(args.action, "read"); if (denied) throw Object.assign(new Error("denied"), { statusCode: 403 }); });
  t.mock.method(obs, "getOverview", async args => { reads++; assert.equal(args.tenantId, obs.HC); return { executions: [] }; });
  const req = { auth: { tenant_id: obs.HC, sub: uuid(3) }, context: { tenant: { id: obs.HC } }, query: { tenant_id: uuid(9) } };
  const res = { status() { return this; }, json() {} };
  let error;
  await handler(req, res, e => { error = e; });
  assert.equal(error, undefined);
  await handler({ ...req, auth: { tenant_id: uuid(4) } }, res, e => { error = e; });
  assert.equal(error.statusCode, 403);
  denied = true;
  await handler(req, res, e => { error = e; });
  assert.equal(error.statusCode, 403);
  assert.equal(reads, 1);
});
