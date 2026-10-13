"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

process.env.NODE_ENV = "test";
const fixtureDatabaseUrl = "postgres://example.invalid/blocked";
const ephemeralSigningKey = randomUUID();
process.env.DATABASE_URL = fixtureDatabaseUrl;
process.env.JWT_SECRET = ephemeralSigningKey;
process.env.ROOT_DOMAIN = "example.test";

const env = require("../backend/src/config/env");
const mail = require("../backend/src/services/mailService");
const pool = require("../backend/src/db/pool");
const audit = require("../backend/src/services/auditService");
const repository = require("../backend/src/modules/notifications/emailOutbox.repository");
const processor = require("../backend/src/modules/notifications/emailOutbox.processor");
const dispatch = require("../backend/src/modules/timeControl/timeControl.dispatch");
const automation = require("../backend/src/modules/timeControl/timeControl.automation");
const operation = require("../backend/src/modules/timeControl/timeControl.operation");

const tenantId = "00000000-0000-4000-8000-000000000001";
const outboxId = "00000000-0000-4000-8000-000000000002";
const unsafeBody = "provider response with private data https://example.invalid/private";
const message = {
  to: "employee@example.test", subject: "Local fixture", text: "Local fixture",
  tenantId, template: "time_control.missing_hours.employee",
};

function mailFixture(t, { status = 200, id = "local-provider-id", fetchError = null, invalidJson = false } = {}) {
  const previous = { ...env };
  Object.assign(env, { MAIL_PROVIDER: "resend", MAIL_API_KEY: "dummy",
    MAIL_FROM: "Fielddesk <mail@example.test>", MAIL_REPLY_TO: "admin@fielddesk.dk" });
  t.after(() => Object.assign(env, previous));
  const calls = [];
  let bodyReads = 0;
  let bodyCancellations = 0;
  t.mock.method(global, "fetch", async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    if (fetchError) throw fetchError;
    return {
      ok: status >= 200 && status < 300, status,
      body: { cancel: async () => { bodyCancellations++; } },
      text: async () => { bodyReads++; return unsafeBody; },
      json: async () => {
        if (invalidJson) throw new Error("invalid_json");
        return { id, MessageID: "local-postmark-id" };
      },
    };
  });
  return { calls, bodyReads: () => bodyReads, bodyCancellations: () => bodyCancellations };
}

function processorFixture(t, options = {}) {
  const transport = mailFixture(t, options);
  const row = {
    id: outboxId, tenant_id: tenantId, source_type: "time_control",
    template_key: message.template, recipient_email: message.to,
    subject: message.subject, text_body: message.text, status: "processing",
    attempt_count: 1, max_attempts: 5, idempotency_key: "time_control:incident:fixture",
    payload_json: { sender: env.MAIL_FROM, reply_to: env.MAIL_REPLY_TO, cc_emails: [] },
    ...options.row,
  };
  const dead = [], retries = [], sent = [], audits = [], transactions = [];
  const client = { release() {}, async query(sql) {
    assert.ok(["BEGIN", "COMMIT", "ROLLBACK"].includes(sql));
    transactions.push(sql);
    return { rows: [] };
  } };
  t.mock.method(pool, "connect", async () => client);
  t.mock.method(repository, "claimTimeControlBatch", async () => [row]);
  t.mock.method(repository, "claimDueBatch", async () => [row]);
  t.mock.method(repository, "markDeadLetter", async (_client, args) => { dead.push(args); return { id: args.id }; });
  t.mock.method(repository, "markRetry", async (_client, args) => { retries.push(args); return { id: args.id }; });
  t.mock.method(repository, "markSent", async (_client, args) => { sent.push(args); return { id: args.id }; });
  t.mock.method(audit, "logAuditEvent", async args => { audits.push(args); });
  t.mock.method(dispatch, "validateAutomatic", async () => {});
  t.mock.method(dispatch, "validateDaily", async () => {});
  t.mock.method(automation, "requireSendingEnabled", () => {});
  t.mock.method(operation, "dispatchWindow", () => true);
  return { ...transport, row, dead, retries, sent, audits, transactions };
}

test("actual Resend request tags are legal for Timekontrol without altering template identity or idempotency", async t => {
  const fixture = mailFixture(t);
  for (const template of [message.template, "time_control.employee_weekly_reminder_v1",
    "time_control.friday_weekly_summary_v1", "time_control.internal_error", "time_control_daily.status_v1"]) {
    const input = { ...message, template };
    const original = structuredClone(input);
    await mail.sendEmail(input, { idempotencyKey: "time_control:incident:fixture", timeoutMs: 15000 });
    const request = fixture.calls.at(-1);
    assert.equal(request.url, "https://api.resend.com/emails");
    assert.deepEqual(request.body.tags, [
      { name: "tenant_id", value: tenantId },
      { name: "template", value: template.replaceAll(".", "_") },
    ]);
    assert.ok(request.body.tags.every(tag => /^[A-Za-z0-9_-]+$/.test(tag.name) && /^[A-Za-z0-9_-]+$/.test(tag.value)));
    assert.equal(request.options.headers["Idempotency-Key"], "time_control:incident:fixture");
    assert.deepEqual(input, original);
  }
});

test("unrelated Resend tags and Postmark metadata retain their existing values", async t => {
  const fixture = mailFixture(t);
  const otherTemplate = "absence_request.submitted.employee";
  await mail.sendEmail({ ...message, template: otherTemplate });
  assert.equal(fixture.calls[0].body.tags[1].value, otherTemplate);
  assert.equal(fixture.calls[0].options.headers["Idempotency-Key"], undefined);
  env.MAIL_PROVIDER = "postmark";
  await mail.sendEmail(message);
  assert.equal(fixture.calls[1].body.Metadata.template, message.template);
  assert.equal(fixture.calls[1].body.tags, undefined);
});

test("Timekontrol provider errors expose only HTTP status, while other flows retain their error contract", async t => {
  const fixture = mailFixture(t, { status: 422 });
  await assert.rejects(mail.sendEmail(message), error => {
    assert.equal(error.code, "mail_provider_rejected_message");
    assert.deepEqual(error.details, { status: 422 });
    assert.doesNotMatch(JSON.stringify(error), /private|https:/);
    return true;
  });
  assert.equal(fixture.bodyReads(), 0);
  assert.equal(fixture.bodyCancellations(), 1);
  await assert.rejects(mail.sendEmail({ ...message, template: "absence_request.submitted.employee" }), error => {
    assert.deepEqual(error.details, { status: 422, body: unsafeBody });
    return true;
  });
  assert.equal(fixture.bodyReads(), 1);
  assert.equal(fixture.bodyCancellations(), 1);
});

for (const status of [400, 401, 403, 404, 405, 413, 422, 429]) {
  test(`Timekontrol HTTP ${status} is a definitive rejection with safe audit and no retry`, async t => {
    const fixture = processorFixture(t, { status });
    const result = await processor.processDueEmails({ tenantId, timeControlOutboxIds: [outboxId] });
    assert.equal(result.sent, 0);
    assert.equal(result.retry, 0);
    assert.equal(result.dead_letter, 1);
    assert.deepEqual(result.failures, [{ id: outboxId, code: "mail_provider_rejected_message", delivery_state: "rejected", http_status: status }]);
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.dead[0].errorCode, "mail_provider_rejected_message");
    assert.equal(fixture.retries.length + fixture.sent.length, 0);
    assert.deepEqual(fixture.audits.at(-1).metadata, {
      template_key: message.template, attempt_count: 1, max_attempts: 5,
      error_code: "mail_provider_rejected_message", delivery_state: "rejected", http_status: status,
    });
    assert.doesNotMatch(JSON.stringify([result, fixture.dead, fixture.audits]), /private|https:/);
    assert.equal(fixture.bodyReads(), 0);
  });
}

for (const options of [
  { status: 408 }, { status: 409 }, { status: 500 }, { status: 503 },
  { fetchError: new Error("transport timeout https://example.invalid/private") },
  { id: null }, { invalidJson: true },
]) {
  test(`Timekontrol ${options.status || (options.fetchError ? "timeout" : options.invalidJson ? "invalid receipt" : "missing receipt")} remains unclear without retry`, async t => {
    const fixture = processorFixture(t, options);
    const result = await processor.processDueEmails({ tenantId, timeControlOutboxIds: [outboxId] });
    assert.deepEqual(result.failures, [{ id: outboxId, code: "provider_acceptance_unclear", delivery_state: "unclear",
      ...(options.status ? { http_status: options.status } : {}) }]);
    assert.equal(result.sent + result.retry, 0);
    assert.equal(result.dead_letter, 1);
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.retries.length + fixture.sent.length, 0);
    assert.equal(fixture.dead[0].errorCode, "provider_acceptance_unclear");
    assert.equal(fixture.audits.at(-1).metadata.delivery_state, "unclear");
    assert.doesNotMatch(JSON.stringify([result, fixture.dead, fixture.audits]), /private|https:/);
  });
}

for (const status of [422, 500]) {
  test(`other-flow HTTP ${status} keeps the existing retry and audit behavior`, async t => {
    const fixture = processorFixture(t, { status,
      row: { source_type: "absence_request", template_key: "absence_request.submitted.employee" } });
    const result = await processor.processDueEmails({ tenantId });
    assert.equal(result.retry, status === 500 ? 1 : 0);
    assert.equal(result.dead_letter, status === 422 ? 1 : 0);
    assert.deepEqual(result.failures, [{ id: outboxId, code: "mail_provider_rejected_message" }]);
    assert.deepEqual(fixture.audits.at(-1).metadata, {
      template_key: fixture.row.template_key, attempt_count: 1, max_attempts: 5,
    });
  });
}

test("provider trace starts after durable claim and completes after committed acceptance, with allowlisted metadata", async t => {
  const fixture = processorFixture(t);
  const traces = [];
  const result = await processor.processDueEmails({ tenantId, timeControlOutboxIds: [outboxId],
    timeControlTrace: async (step, status, metadata, code) => {
      traces.push({ step, status, metadata, code });
      assert.equal(step, "provider_result");
      assert.equal(metadata.tenant_id, tenantId);
      assert.equal(metadata.outbox_id, outboxId);
      assert.equal(code, null);
      if (status === "started") {
        assert.equal(fixture.transactions.filter(sql => sql === "COMMIT").length, 1);
        assert.equal(fixture.calls.length, 0);
      } else {
        assert.equal(status, "completed");
        assert.equal(fixture.transactions.at(-1), "COMMIT");
        assert.equal(fixture.sent.length, 1);
        assert.equal(metadata.delivery_state, "accepted");
        assert.equal(metadata.provider_message_id, "local-provider-id");
      }
    } });
  assert.equal(result.sent, 1);
  assert.deepEqual(traces.map(trace => trace.status), ["started", "completed"]);
  assert.doesNotMatch(JSON.stringify(traces), /employee@example|local-fixture|https:|text_body|payload_json/);
});

for (const options of [{ status: 422 }, { fetchError: new Error("timeout") }]) {
  test(`provider trace reports committed ${options.status ? "rejection" : "uncertainty"} safely`, async t => {
    const fixture = processorFixture(t, options);
    const traces = [];
    const result = await processor.processDueEmails({ tenantId,
      timeControlTrace: async (step, status, metadata, code) => {
        traces.push({ step, status, metadata, code });
        if (status === "failed") {
          assert.equal(fixture.transactions.at(-1), "COMMIT");
          assert.equal(fixture.dead.length, 1);
          assert.equal(metadata.provider_attempted, true);
          assert.equal(metadata.delivery_state, options.status ? "rejected" : "unclear");
          assert.equal(metadata.http_status, options.status);
          assert.equal(code, options.status ? "mail_provider_rejected_message" : "provider_acceptance_unclear");
        }
      } });
    assert.equal(result.retry, 0);
    assert.deepEqual(traces.map(trace => [trace.step, trace.status]), [["provider_result", "started"], ["provider_result", "failed"]]);
    assert.doesNotMatch(JSON.stringify(traces), /private|https:|local-fixture/);
  });
}

test("dispatch guard denial is traced only after committed dead-letter and never invokes the provider", async t => {
  const fixture = processorFixture(t);
  t.mock.method(dispatch, "validateAutomatic", async () => { throw new Error("time_control_operation_not_active"); });
  const traces = [];
  await processor.processDueEmails({ tenantId, timeControlTrace: async (step, status, metadata, code) => {
    assert.equal(fixture.transactions.at(-1), "COMMIT");
    assert.equal(fixture.dead.length, 1);
    traces.push({ step, status, metadata, code });
  } });
  assert.equal(fixture.calls.length, 0);
  assert.deepEqual(traces.map(trace => [trace.step, trace.status, trace.code]), [["dispatch", "failed", "time_control_operation_not_active"]]);
  assert.equal(traces[0].metadata.provider_attempted, false);
});

for (const failedStatus of ["started", "completed", "failed"]) {
  test(`trace persistence failure at ${failedStatus} never retries or rewrites an accepted delivery`, async t => {
    const fixture = processorFixture(t, failedStatus === "failed" ? { status: 422 } : {});
    const logs = [];
    t.mock.method(console, "error", (...args) => { logs.push(args); });
    const result = await processor.processDueEmails({ tenantId, timeControlTrace: async (_step, status) => {
      if (status === failedStatus) throw new Error("trace database https://example.invalid/private");
    } });
    assert.equal(result.retry, 0);
    assert.equal(fixture.retries.length, 0);
    if (failedStatus === "completed") {
      assert.equal(result.sent, 1);
      assert.equal(fixture.dead.length, 0);
    } else {
      assert.equal(result.sent, 0);
      assert.equal(fixture.calls.length, failedStatus === "started" ? 0 : 1);
      assert.equal(fixture.dead[0].errorCode, failedStatus === "started"
        ? "time_control_trace_persistence_failed" : "mail_provider_rejected_message");
    }
    assert.ok(logs.length > 0);
    assert.doesNotMatch(JSON.stringify(logs), /private|https:/);
  });
}

test("trace wait cannot extend the existing dispatch deadline", async t => {
  const fixture = processorFixture(t);
  t.mock.method(operation, "dispatchWindow", () => false);
  const result = await processor.processDueEmails({ tenantId, timeControlTrace: async () => {} });
  assert.equal(result.sent + result.retry, 0);
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.dead[0].errorCode, "time_control_dispatch_window_expired");
});

test("other flows never call the Timekontrol trace callback", async t => {
  const fixture = processorFixture(t, { row: { source_type: "absence_request", template_key: "absence_request.submitted.employee" } });
  const result = await processor.processDueEmails({ tenantId, timeControlTrace: async () => { assert.fail("other-flow trace forbidden"); } });
  assert.equal(result.sent, 1);
  assert.equal(fixture.calls.length, 1);
});
