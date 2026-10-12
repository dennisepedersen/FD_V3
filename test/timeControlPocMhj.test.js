"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://example.invalid/fielddesk_test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.ROOT_DOMAIN = "fielddesk.test";

const sender = require("../backend/src/modules/timeControl/timeControl.mailTestSender");
const service = require("../backend/src/modules/timeControl/timeControl.service");
const tx = require("../backend/src/db/tx");
const audit = require("../backend/src/services/auditService");
const ENV = require("../backend/src/config/env");
const { buildPlan } = require("../backend/src/modules/timeControl/timeControl.mailTest");
const tenantId = "f1f51c07-2d88-4ee4-a766-78eac833a9d0";
const actorId = "8eaddbc0-8fc7-414a-9c5c-064617972394";
const batchId = "7aac3ac3-a4cf-4f2c-bddf-491bcb2b4f45";
const depId = "698712b3-1aec-462f-a256-f5921e4fbe7f";
const testId = "11111111-1111-4111-8111-111111111111";

function fixture(t) {
  const previous = process.env.TIME_CONTROL_SCHEDULER_ENABLED;
  process.env.TIME_CONTROL_SCHEDULER_ENABLED = "false";
  t.after(() => {
    if (previous === undefined) delete process.env.TIME_CONTROL_SCHEDULER_ENABLED;
    else process.env.TIME_CONTROL_SCHEDULER_ENABLED = previous;
  });
  for (const [key, value] of Object.entries({ MAIL_PROVIDER: "resend", MAIL_API_KEY: "dummy", MAIL_REPLY_TO: "admin@fielddesk.dk" })) {
    const original = ENV[key];
    ENV[key] = value;
    t.after(() => { ENV[key] = original; });
  }
  const state = { row: null, sends: [], audits: [], queries: [],
    settings: { mode: "dry_run", live_enabled_at: null,
      employee_cc_emails: ["dep@hoyrup-clemmensen.dk"], friday_manager_emails: ["dep@hoyrup-clemmensen.dk"] },
    dep: { status: "accepted", provider_message_id: "01a12f32-64fd-7ba0-8229-08a5400b633c",
      test_key: `time_control_poc_mail:v1:${tenantId}:${batchId}:dep_delivery:d0ca1acbd128` },
  };
  state.plan = buildPlan({ tenantId, batchId, from: service.SENDER, settings: state.settings,
    employee: { fitterId: "15", name: "Mikkel Hyldebo Jensen", email: "mhj@hoyrup-clemmensen.dk" },
    dep: { name: "Dennis", email: "dep@hoyrup-clemmensen.dk" }, controlEmployees: [{ name: "Mikkel Hyldebo Jensen" }] });
  const client = { query: async (sql, values) => {
    state.queries.push(sql);
    assert.equal(values[0], tenantId);
    if (/FROM time_control_settings/.test(sql)) return { rows: [state.settings] };
    if (/SELECT status,provider_message_id,test_key/.test(sql)) {
      assert.equal(values[1], depId);
      return { rows: state.dep ? [state.dep] : [] };
    }
    if (/INSERT INTO time_control_poc_mail_test/.test(sql)) {
      if (state.row) return { rows: [] };
      state.row = { id: testId, tenant_id: tenantId, test_key: values[1], message_json: JSON.parse(values[2]),
        content_hash: values[3], status: "prepared", attempt_started_at: null, provider_message_id: null };
      return { rows: [state.row] };
    }
    if (/SELECT \* FROM time_control_poc_mail_test/.test(sql)) return { rows: state.row ? [state.row] : [] };
    if (/SET status='sending'/.test(sql)) {
      assert.equal(state.row.status, "prepared");
      state.row = { ...state.row, status: "sending", attempt_started_at: new Date().toISOString() };
      return { rows: [state.row] };
    }
    if (/SET status=\$3/.test(sql)) {
      state.row = { ...state.row, status: values[2], provider_message_id: values[3], last_error_code: values[4] };
      return { rows: [state.row] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  } };
  // Model the production settings/row lock, including simultaneous operator attempts.
  let tail = Promise.resolve();
  t.mock.method(tx, "withTransaction", fn => {
    const result = tail.then(() => fn(client));
    tail = result.catch(() => {});
    return result;
  });
  t.mock.method(audit, "logAuditEvent", async event => state.audits.push(event));
  t.mock.method(service, "getPocMailPlan", async () => state.plan);
  t.mock.method(service, "getPocMailPlanForClient", async () => state.plan);
  state.prepare = () => sender.prepareMhj({ tenantId, actorId, batchId });
  state.send = (overrides = {}) => sender.sendPreparedMhj({ tenantId, actorId, testId,
    confirm: `SEND:timekontrol-poc-mhj:${testId}`, sendEmailFn: async (message, options) => {
      assert.equal(state.row.status, "sending");
      state.sends.push({ message, options });
      return { provider: "resend", providerMessageId: "mock-mhj-provider-id" };
    }, ...overrides });
  return state;
}

test("Mikkel preparation reuses exactly one locked record and preserves the approved content", async t => {
  const s = fixture(t);
  const results = await Promise.all([s.prepare(), s.prepare()]);
  assert.equal(results[0].test.id, results[1].test.id);
  assert.equal(s.audits.length, 1);
  assert.equal(s.sends.length, 0);
  assert.equal(s.row.status, "prepared");
  const m = s.row.message_json;
  assert.equal(m.to, "mhj@hoyrup-clemmensen.dk");
  assert.equal(m.toName, "Mikkel Hyldebo Jensen");
  assert.deepEqual(m.cc, ["dep@hoyrup-clemmensen.dk"]);
  assert.deepEqual(m.ccNames, ["Dennis"]);
  assert.equal(m.from, service.SENDER);
  assert.equal(m.replyTo, "admin@fielddesk.dk");
  assert.equal(m.depReceipt.testId, depId);
  assert.equal(m.depReceipt.inboxReceivedAt, "2026-10-12T10:19+02:00");
  assert.equal(m.subject, "[POC-TEST - ingen handling] Fielddesk Timekontrol: mailtest til Mikkel Hyldebo Jensen");
  assert.equal(m.text, "Hej Mikkel\n\nDette er en aftalt testmail fra Fielddesk Timekontrol med Dennis i kopi.\n\nMailen er kun en test af afsendelse og modtagelse. Den er ikke en rigtig timekontrol eller en påmindelse om manglende timer, og den kræver ingen handling fra dig.\n\nDu skal ikke ændre din timeregistrering på grund af denne mail. Ingen EK-timer er ændret, og testen aktiverer ikke live-mode eller scheduler.\n\nVenlig hilsen\nFielddesk Timekontrol");
  assert.match(m.testKey, /:mhj_delivery:[a-f0-9]{12}$/);
  assert.equal(sender.contentHash(m), s.row.content_hash);
});

test("Mikkel uses the shared durable claim and provider idempotency exactly once under concurrent sends", async t => {
  const s = fixture(t);
  await s.prepare();
  const results = await Promise.all([s.send(), s.send()]);
  assert.equal(s.sends.length, 1);
  assert.equal(s.row.status, "accepted");
  assert.ok(results.some(r => r.delivery_state === "accepted"));
  assert.ok(results.every(r => r.retry_allowed === false));
  const call = s.sends[0];
  assert.deepEqual(call.message.cc, ["dep@hoyrup-clemmensen.dk"]);
  assert.equal(call.message.from, s.plan.messages[1].from);
  assert.equal(call.message.replyTo, "admin@fielddesk.dk");
  assert.equal(call.options.idempotencyKey, s.row.test_key);
  assert.equal(call.options.timeoutMs, 15000);
  await s.send();
  assert.equal(s.sends.length, 1);
});

test("uncertain Mikkel provider result is terminal and never retried", async t => {
  const s = fixture(t);
  await s.prepare();
  await assert.rejects(s.send({ sendEmailFn: async () => { throw new Error("timeout"); } }), /timeout/);
  assert.equal(s.row.status, "unclear");
  assert.equal((await s.send()).retry_allowed, false);
  assert.equal(s.sends.length, 0);
});

for (const status of ["sending", "accepted", "unclear"]) {
  test(`Mikkel status ${status} cannot cause another provider attempt`, async t => {
    const s = fixture(t);
    await s.prepare();
    s.row.status = status;
    assert.equal((await s.send()).retry_allowed, false);
    assert.equal(s.sends.length, 0);
  });
}

for (const mutation of [
  s => { s.dep = null; },
  s => { s.dep.status = "prepared"; },
  s => { s.dep.provider_message_id = "wrong"; },
  s => { s.dep.test_key = s.dep.test_key.replace(batchId, actorId); },
]) {
  test("Mikkel requires the same-tenant accepted DEP receipt and campaign before prepare/send", async t => {
    const s = fixture(t);
    await s.prepare();
    mutation(s);
    await assert.rejects(s.prepare(), /dep_receipt_required/);
    await assert.rejects(s.send(), /dep_receipt_required/);
    assert.equal(s.row.status, "prepared");
    assert.equal(s.sends.length, 0);
  });
}

for (const [field, value] of [
  ["cc", []], ["cc", ["dep@hoyrup-clemmensen.dk", "lke@hoyrup-clemmensen.dk"]],
  ["to", "other@example.test"], ["from", "other@example.test"], ["replyTo", "other@example.test"],
  ["text", "changed"], ["depReceipt", {}],
]) {
  test(`Mikkel rejects tampered locked ${field} before claim`, async t => {
    const s = fixture(t);
    await s.prepare();
    s.row.message_json[field] = value;
    await assert.rejects(s.send(), /locked_message_invalid/);
    assert.equal(s.row.status, "prepared");
    assert.equal(s.sends.length, 0);
  });
}

test("changed Mikkel content key blocks historical records before claim", async t => {
  const s = fixture(t);
  await s.prepare();
  s.plan.messages[1].testKey = s.row.test_key.replace(/[a-f0-9]{12}$/, "000000000000");
  await assert.rejects(s.send(), /locked_message_superseded/);
  assert.equal(s.sends.length, 0);
});

test("Mikkel preparation cannot reuse a record with conflicting locked content", async t => {
  const s = fixture(t);
  await s.prepare();
  s.row.content_hash = "0".repeat(64);
  await assert.rejects(s.prepare(), /content_conflict/);
  assert.equal(s.sends.length, 0);
});

test("Mikkel requires Resend and a key before any claim", async t => {
  const s = fixture(t);
  await s.prepare();
  ENV.MAIL_PROVIDER = "disabled";
  await assert.rejects(s.send(), /resend_required/);
  ENV.MAIL_PROVIDER = "resend";
  ENV.MAIL_API_KEY = "";
  await assert.rejects(s.send(), /resend_required/);
  assert.equal(s.row.status, "prepared");
  assert.equal(s.sends.length, 0);
});

test("Mikkel denies other tenants, invalid actors, DEP confirmation and DEP records", async t => {
  const s = fixture(t);
  await assert.rejects(sender.prepareMhj({ tenantId: actorId, actorId, batchId }), /scope_invalid/);
  await assert.rejects(sender.prepareMhj({ tenantId, actorId: null, batchId }), /scope_invalid/);
  await s.prepare();
  await assert.rejects(s.send({ confirm: `SEND:timekontrol-poc-dep:${testId}` }), /confirmation_required/);
  s.row.test_key = s.row.test_key.replace("mhj_delivery", "dep_delivery");
  await assert.rejects(s.send(), /test_key_invalid/);
  assert.equal(s.sends.length, 0);
});

for (const change of [
  s => { s.settings.mode = "live"; },
  s => { s.settings.live_enabled_at = "2026-10-12T08:00:00Z"; },
  s => { s.settings.friday_manager_emails.push("lke@hoyrup-clemmensen.dk"); },
  s => { s.settings.employee_cc_emails = []; },
]) {
  test("Mikkel fails closed if dry-run or DEP-only routing changes", async t => {
    const s = fixture(t);
    await s.prepare();
    change(s);
    await assert.rejects(s.prepare(), /settings_changed/);
    await assert.rejects(s.send(), /settings_changed/);
    assert.equal(s.sends.length, 0);
  });
}

test("Mikkel scheduler guard rejects enabled or unset scheduler", async t => {
  const s = fixture(t);
  await s.prepare();
  for (const value of ["true", ""]) {
    process.env.TIME_CONTROL_SCHEDULER_ENABLED = value;
    await assert.rejects(s.prepare(), /scheduler_must_be_disabled/);
    await assert.rejects(s.send(), /scheduler_must_be_disabled/);
  }
  assert.equal(s.sends.length, 0);
});

test("0059 only extends the stage constraint and operator commands remain explicit and admin-scoped", () => {
  const read = name => fs.readFileSync(path.resolve(__dirname, "..", name), "utf8");
  const sql = read("migrations/0059_time_control_poc_mhj_mail_test.sql");
  assert.match(sql, /DROP CONSTRAINT ck_time_control_poc_mail_test_test_key/);
  assert.match(sql, /mhj_delivery:\[0-9a-f\]\{12\}/);
  assert.doesNotMatch(sql, /DROP TABLE|UPDATE |INSERT |TRIGGER/i);
  const script = read("backend/scripts/time_control_poc_mhj.js");
  assert.match(script, /tenant_id=\$1 AND id=\$2 AND role='tenant_admin' AND status='active'/);
  assert.match(script, /PREPARE:timekontrol-poc-mhj/);
  assert.match(script, /SEND:timekontrol-poc-mhj/);
});
