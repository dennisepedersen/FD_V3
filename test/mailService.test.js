"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://example.invalid/fielddesk_test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.ROOT_DOMAIN = process.env.ROOT_DOMAIN || "fielddesk.test";

const env = require("../backend/src/config/env");
const mailService = require("../backend/src/services/mailService");
const { emailListFailureFor } = require("../backend/src/services/emailRecipients");

async function withMailProvider(provider, fn) {
  const previous = { ...env };
  const previousFetch = global.fetch;
  const calls = [];
  Object.assign(env, {
    MAIL_PROVIDER: provider,
    MAIL_API_KEY: "dummy",
    MAIL_FROM: "Fielddesk <mail@example.test>",
    MAIL_REPLY_TO: "reply@example.test",
    MAIL_STREAM: "outbound",
  });
  global.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ id: "resend-test-id", MessageID: "postmark-test-id" }) };
  };
  try {
    await fn(calls);
  } finally {
    Object.assign(env, previous);
    global.fetch = previousFetch;
  }
}

const message = {
  to: " Employee@Example.Test ",
  subject: "Timekontrol",
  text: "Der mangler timer.",
  html: "<p>Der mangler timer.</p>",
  tenantId: "test-tenant",
  template: "time_control.missing_hours.employee",
};

for (const provider of ["resend", "postmark"]) {
  test(`${provider} preserves configured sender, supports explicit sender and delivers normalized CC`, async () => {
    await withMailProvider(provider, async (calls) => {
      await mailService.sendEmail(message);
      const result = await mailService.sendEmail({
        ...message,
        from: "Fielddesk Timekontrol <timekontrol@fielddesk.dk>",
        cc: [" DEP@Example.Test ", "lke@example.test", "dep@example.test"],
      });
      await mailService.sendEmail({ ...message, cc: " DEP@Example.Test " });
      assert.equal(result.sent, true);
      assert.equal(calls.length, 3);
      const [plain, copies, single] = calls.map((call) => call.body);
      if (provider === "resend") {
        assert.equal(calls[0].url, "https://api.resend.com/emails");
        assert.equal(plain.from, env.MAIL_FROM);
        assert.deepEqual(plain.to, ["employee@example.test"]);
        assert.equal(plain.cc, undefined);
        assert.equal(copies.from, "Fielddesk Timekontrol <timekontrol@fielddesk.dk>");
        assert.deepEqual(copies.cc, ["dep@example.test", "lke@example.test"]);
        assert.deepEqual(single.cc, ["dep@example.test"]);
        assert.equal(copies.reply_to, env.MAIL_REPLY_TO);
      } else {
        assert.equal(calls[0].url, "https://api.postmarkapp.com/email");
        assert.equal(plain.From, env.MAIL_FROM);
        assert.equal(plain.To, "employee@example.test");
        assert.equal(plain.Cc, undefined);
        assert.equal(copies.From, "Fielddesk Timekontrol <timekontrol@fielddesk.dk>");
        assert.equal(copies.Cc, "dep@example.test,lke@example.test");
        assert.equal(single.Cc, "dep@example.test");
        assert.equal(copies.ReplyTo, env.MAIL_REPLY_TO);
        assert.equal(copies.MessageStream, env.MAIL_STREAM);
      }
    });
  });

  test(`${provider} rejects invalid To/CC before any provider call`, async () => {
    await withMailProvider(provider, async (calls) => {
      for (const cc of [["invalid"], ["dep@example.test", ""], [null], {}, 42]) {
        await assert.rejects(mailService.sendEmail({ ...message, cc }), { code: "mail_cc_invalid", statusCode: 400 });
      }
      await assert.rejects(mailService.sendEmail({ ...message, to: "invalid" }), { code: "mail_to_invalid" });
      await assert.rejects(mailService.sendEmail({ ...message, to: "" }), { code: "mail_to_required" });
      env.MAIL_FROM = null;
      await assert.rejects(mailService.sendEmail(message), { code: "mail_from_required" });
      assert.equal(calls.length, 0);
    });
  });
}

test("disabled mail provider fails explicitly without a provider call", async () => {
  await withMailProvider("disabled", async (calls) => {
    await assert.rejects(mailService.sendEmail(message), { code: "mail_provider_disabled" });
    assert.equal(calls.length, 0);
  });
});

test("optional CC list accepts absent or empty lists but not blank entries", () => {
  for (const value of [undefined, null, []]) {
    assert.deepEqual(emailListFailureFor(value), { emails: [], errorCode: null, errorMessage: null });
  }
  assert.equal(emailListFailureFor([""]).errorCode, "recipient_email_missing");
});
