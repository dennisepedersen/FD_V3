"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { inspect } = require("node:util");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://example.invalid/fielddesk_test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.ROOT_DOMAIN = process.env.ROOT_DOMAIN || "fielddesk.test";

const env = require("../backend/src/config/env");
const { sendEmail } = require("../backend/src/services/mailService");

const message = {
  to: " Employee@Example.Test ",
  cc: [" Copy@Example.Test "],
  subject: "BCC fixture",
  html: "<p>Fixture content</p>",
  text: "Fixture content",
  tenantId: "fixture-tenant",
  template: "fixture.template",
};
const blindAddresses = ["private.one@example.test", "private.two@example.test"];

async function withProvider(t, provider, fn) {
  const previous = { ...env };
  const calls = [];
  const logs = [];
  Object.assign(env, {
    MAIL_PROVIDER: provider,
    MAIL_API_KEY: "dummy",
    MAIL_FROM: "Fielddesk <mail@example.test>",
    MAIL_REPLY_TO: "reply@example.test",
    MAIL_STREAM: "outbound",
  });
  let respond = async () => ({
    ok: true,
    json: async () => ({ id: "resend-fixture-id", MessageID: "postmark-fixture-id", bcc: blindAddresses }),
  });
  t.mock.method(global, "fetch", async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return respond();
  });
  for (const method of ["log", "info", "warn", "error", "debug", "trace"]) {
    t.mock.method(console, method, (...args) => logs.push(args));
  }
  try {
    await fn({ calls, logs, setResponse: (fn) => { respond = fn; } });
  } finally {
    Object.assign(env, previous);
    t.mock.restoreAll();
  }
}

function assertPrivate(value) {
  const rendered = inspect(value, { depth: null }).toLowerCase();
  for (const address of blindAddresses) assert.equal(rendered.includes(address), false);
}

for (const provider of ["resend", "postmark"]) {
  test(`${provider} sends normalized BCC only in its provider recipient field`, async t => {
    await withProvider(t, provider, async ({ calls, logs }) => {
      const input = { ...message, bcc: [" Private.One@Example.Test ", "PRIVATE.TWO@example.test"] };
      const before = structuredClone(input);
      const receipt = await sendEmail(input);
      await sendEmail({ ...message, bcc: " Private.One@Example.Test " });
      assert.deepEqual(input, before);
      assert.equal(calls.length, 2);
      const field = provider === "resend" ? "bcc" : "Bcc";
      assert.equal(calls[0].url, provider === "resend" ? "https://api.resend.com/emails" : "https://api.postmarkapp.com/email");
      assert.deepEqual(calls[0].body[field], provider === "resend" ? blindAddresses : blindAddresses.join(","));
      assert.deepEqual(calls[1].body[field], provider === "resend" ? [blindAddresses[0]] : blindAddresses[0]);
      for (const call of calls) {
        const { [field]: recipients, ...rest } = call.body;
        assert.ok(recipients);
        assertPrivate(rest);
        assertPrivate(call.options.headers);
        assert.equal(call.body.Headers, undefined);
        assert.equal(call.body.headers, undefined);
        assert.equal(call.body[provider === "resend" ? "html" : "HtmlBody"], message.html);
        assert.equal(call.body[provider === "resend" ? "text" : "TextBody"], message.text);
      }
      assert.deepEqual(receipt, { provider, sent: true, providerMessageId: `${provider}-fixture-id` });
      assertPrivate(receipt);
      assertPrivate(logs);
      assert.deepEqual(logs, []);
    });
  });

  test(`${provider} rejects invalid, duplicate and conflicting BCC before fetch without exposing addresses`, async t => {
    await withProvider(t, provider, async ({ calls, logs }) => {
      for (const bcc of ["", "invalid", "private.one@example.test\r\nBcc: other@example.test", {}, 42, false, [""], [null], [42], [{}], [blindAddresses[0], "invalid"]]) {
        await assert.rejects(sendEmail({ ...message, bcc }), error => {
          assert.equal(error.code, "mail_bcc_invalid");
          assert.equal(error.statusCode, 400);
          assertPrivate(error);
          return true;
        });
      }
      await assert.rejects(sendEmail({ ...message, bcc: [blindAddresses[0], " PRIVATE.ONE@EXAMPLE.TEST "] }), error => {
        assert.equal(error.code, "mail_bcc_duplicate");
        assert.equal(error.statusCode, 400);
        assertPrivate(error);
        return true;
      });
      for (const overrides of [
        { to: " PRIVATE.ONE@EXAMPLE.TEST ", bcc: blindAddresses },
        { cc: [" PRIVATE.ONE@EXAMPLE.TEST "], bcc: blindAddresses },
        { cc: [" EMPLOYEE@EXAMPLE.TEST "], bcc: blindAddresses },
        { cc: [" EMPLOYEE@EXAMPLE.TEST "], bcc: [] },
        { cc: [" EMPLOYEE@EXAMPLE.TEST "], bcc: null },
      ]) {
        await assert.rejects(sendEmail({ ...message, ...overrides }), error => {
          assert.equal(error.code, "mail_recipient_conflict");
          assert.equal(error.statusCode, 400);
          assertPrivate(error);
          return true;
        });
      }
      assert.equal(calls.length, 0);
      assert.deepEqual(logs, []);
    });
  });

  test(`${provider} preserves exact legacy payload, CC deduplication and To/CC overlap without BCC`, async t => {
    await withProvider(t, provider, async ({ calls }) => {
      const legacy = { ...message, cc: [" EMPLOYEE@EXAMPLE.TEST ", "employee@example.test"] };
      await sendEmail(legacy);
      await sendEmail({ ...legacy, bcc: undefined });
      const expected = provider === "resend" ? {
        from: env.MAIL_FROM,
        to: ["employee@example.test"],
        cc: ["employee@example.test"],
        subject: message.subject,
        html: message.html,
        text: message.text,
        reply_to: env.MAIL_REPLY_TO,
        tags: [{ name: "tenant_id", value: message.tenantId }, { name: "template", value: message.template }],
      } : {
        From: env.MAIL_FROM,
        To: "employee@example.test",
        Cc: "employee@example.test",
        Subject: message.subject,
        HtmlBody: message.html,
        TextBody: message.text,
        ReplyTo: env.MAIL_REPLY_TO,
        MessageStream: env.MAIL_STREAM,
        Metadata: { tenant_id: message.tenantId, template: message.template },
      };
      assert.equal(calls.length, 2);
      for (const call of calls) assert.equal(call.options.body, JSON.stringify(expected));
      await sendEmail({ ...message, cc: undefined });
      await sendEmail({ ...message, bcc: null });
      await sendEmail({ ...message, bcc: [] });
      for (const call of calls) {
        assert.equal(Object.hasOwn(call.body, "bcc"), false);
        assert.equal(Object.hasOwn(call.body, "Bcc"), false);
      }
    });
  });

  test(`${provider} redacts BCC provider rejection echoes and preserves legacy error bodies`, async t => {
    await withProvider(t, provider, async ({ setResponse, logs }) => {
      let bodyReads = 0;
      let cancellations = 0;
      const echo = JSON.stringify({ bcc: blindAddresses, message: "provider rejected fixture" });
      setResponse(async () => ({
        ok: false,
        status: 422,
        text: async () => { bodyReads++; return echo; },
        body: { cancel: async () => { cancellations++; } },
      }));
      for (const bcc of [blindAddresses, null, []]) {
        await assert.rejects(sendEmail({ ...message, bcc }), error => {
          assert.equal(error.code, "mail_provider_rejected_message");
          assert.equal(error.statusCode, 502);
          assert.deepEqual(error.details, { status: 422 });
          assertPrivate(error);
          return true;
        });
      }
      assert.equal(bodyReads, 0);
      assert.equal(cancellations, 3);
      await assert.rejects(sendEmail(message), error => {
        assert.deepEqual(error.details, { status: 422, body: echo });
        return true;
      });
      assert.equal(bodyReads, 1);
      assert.equal(cancellations, 3);
      assert.deepEqual(logs, []);
    });
  });

  test(`${provider} hides BCC transport error echoes while preserving legacy transport errors`, async t => {
    await withProvider(t, provider, async ({ setResponse, logs }) => {
      const failure = new Error(`transport echo: ${blindAddresses.join(",")}`);
      failure.details = { recipients: blindAddresses };
      setResponse(async () => { throw failure; });
      await assert.rejects(sendEmail({ ...message, bcc: blindAddresses }), error => {
        assert.equal(error.code, "mail_provider_request_failed");
        assert.equal(error.statusCode, 502);
        assert.equal(error.cause, undefined);
        assertPrivate(error);
        return true;
      });
      await assert.rejects(sendEmail(message), error => error === failure);
      assert.deepEqual(logs, []);
    });
  });
}
