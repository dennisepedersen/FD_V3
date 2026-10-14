"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ||= "postgres://example.invalid/blocked";
process.env.JWT_SECRET ||= "test-secret";
process.env.ROOT_DOMAIN ||= "example.test";

const email = require("../backend/src/modules/timeControl/timeControl.email");
const logic = require("../backend/src/modules/timeControl/timeControl.logic");
const weekly = require("../backend/src/modules/timeControl/timeControl.weekly");
const monitor = require("../backend/src/modules/timeControl/timeControl.monitor");
const { renderTemplate } = require("../backend/src/modules/notifications/templateRenderer");
const templateRepository = require("../backend/src/modules/notifications/emailTemplate.repository");
const outboxRepository = require("../backend/src/modules/notifications/emailOutbox.repository");
const outboxService = require("../backend/src/modules/notifications/emailOutbox.service");
const audit = require("../backend/src/services/auditService");
const env = require("../backend/src/config/env");
const mail = require("../backend/src/services/mailService");
const tenantId = "00000000-0000-4000-8000-000000000001";
const origin = "https://hoyrup-clemmensen.fielddesk.dk";
const danish = "Blåbær, Søren og Åse: æ ø å Æ Ø Å";
const template = {
  id: tenantId, locale: "da-DK", subject_template: "{{subject}}",
  html_template: "<p>Hej {{first_name}}</p><p>{{intro}}</p><p>Bemærk, at tillæg ikke tæller som arbejdstimer i denne kontrol. Godkendte arbejdstids- og sygdomslønarter tæller.</p>",
  text_template: "Hej {{first_name}}\n\n{{intro}}\n\nBemærk, at tillæg ikke tæller som arbejdstimer i denne kontrol. Godkendte arbejdstids- og sygdomslønarter tæller.",
  allowed_variables_json: ["subject", "first_name", "intro"],
};

test("daily, weekly, summary and status HTML/text preserve Danish through actual Resend JSON and UTF-8 bytes", async t => {
  const previous = { ...env };
  Object.assign(env, { MAIL_PROVIDER: "resend", MAIL_API_KEY: "dummy", MAIL_FROM: "Fielddesk <mail@example.test>" });
  t.after(() => Object.assign(env, previous));
  const calls = [];
  t.mock.method(global, "fetch", async (url, options) => {
    assert.equal(url, "https://api.resend.com/emails");
    const bytes = Buffer.from(options.body, "utf8");
    const body = JSON.parse(bytes.toString("utf8"));
    calls.push(body);
    return { ok: true, json: async () => ({ id: "mock-only" }) };
  });
  const daily = renderTemplate(template, { ...logic.buildEmployeeMailVariables({ employeeName: "Blåbær Søndergaard",
    dateLabel: "13. oktober", requiredHours: 7.5, validHours: 0, missingHours: 7.5 }), intro: danish });
  const week = weekly.weeklyMail({ name: "Blåbær Søndergaard", monday: "2026-10-12", friday: "2026-10-16", validHours: 30 });
  const summary = weekly.weeklySummary([{ employee_name: danish, valid_hours: 30 }], { monday: "2026-10-12", friday: "2026-10-16" });
  const status = monitor.buildStatusMessage({ tenantId: "f1f51c07-2d88-4ee4-a766-78eac833a9d0", reportDate: "2026-10-15", executions: [], correction: danish });
  const messages = [
    { ...daily, template: "time_control.missing_hours.employee" },
    { subject: week.subject, text: week.body, template: "time_control.employee_weekly_reminder_v1" },
    { subject: "Ugekontrol", text: summary, template: "time_control.friday_weekly_summary_v1" },
    { subject: "Årsag", text: danish, template: "time_control.internal_error" },
    { subject: "Fredagsoversigt", text: danish, template: "time_control.friday_manager_summary" },
    status,
  ];
  for (const message of messages) {
    const html = message.template === "time_control.daily_status" ? message.html : email.renderTimeControlHtml({ ...message, origin });
    await mail.sendEmail({ ...message, html, to: "employee@example.test", cc: ["dep@example.test"], tenantId,
      from: "Fielddesk Timekontrol <timekontrol@mail.fielddesk.dk>", replyTo: "admin@fielddesk.dk" },
    { idempotencyKey: "time_control:encoding:fixture", timeoutMs: 15000 });
    const sent = calls.at(-1);
    assert.equal(sent.text, message.text);
    assert.equal(sent.html, html);
    for (const char of ["æ", "ø", "å"]) {
      assert.ok(sent.text.includes(char), `${message.template} text missing ${char}`);
      assert.ok(sent.html.includes(char), `${message.template} HTML missing ${char}`);
    }
    assert.match(sent.html, /charset="utf-8"/);
    assert.match(sent.html, /alt="Fielddesk"/);
    assert.match(sent.html, /max-width:560px/);
    assert.doesNotMatch(sent.html, /<a\b|<button\b|Bemaerk|tillaeg|taeller|sygdomsloenarter|\uFFFD/);
    assert.deepEqual(sent.cc, ["dep@example.test"]);
    assert.equal(sent.reply_to, "admin@fielddesk.dk");
  }
  assert.equal(calls.length, 6);
});

test("branding uses server-side tenant origin and preserves escaped content and text exactly", async () => {
  const input = renderTemplate(template, { subject: "Påmindelse", first_name: '<Blåbær & Søren>', intro: "æ ø å\nNy linje" }, { htmlLineBreaks: true });
  const original = structuredClone(input);
  const client = { async query(sql, params) {
    assert.equal(sql, "SELECT slug FROM tenant WHERE id = $1");
    assert.deepEqual(params, [tenantId]);
    return { rows: [{ slug: "hoyrup-clemmensen" }] };
  } };
  const rendered = await email.brandTimeControlEmail(client, { tenantId, rendered: input, rootDomain: "fielddesk.dk" });
  assert.equal(rendered.text, input.text);
  assert.match(rendered.html, /&lt;Blåbær &amp; Søren&gt;/);
  assert.match(rendered.html, /æ ø å<br>Ny linje/);
  assert.match(rendered.html, /https:\/\/hoyrup-clemmensen\.fielddesk\.dk\/tenant\/assets\/FD_logo.png/);
  assert.deepEqual(input, original);
  await assert.rejects(email.brandTimeControlEmail({ query: async () => ({ rows: [] }) }, { tenantId, rendered: input, rootDomain: "fielddesk.dk" }), /origin_invalid/);
});

test("Timekontrol keeps multiline HTML markup intact and converts only escaped variable line breaks", () => {
  const html = '<table\nrole="presentation">\n<tr>\n<td><p\nclass="notice">{{intro}}</p></td>\n</tr>\n</table>';
  const input = renderTemplate({ ...template, html_template: html }, {
    subject: "Påmindelse", first_name: "Blåbær", intro: '<b>æ ø å</b>\nNy linje',
  }, { htmlLineBreaks: true });
  const rendered = email.renderTimeControlHtml({ ...input, origin });
  assert.ok(rendered.includes('<table\nrole="presentation">\n<tr>\n<td><p\nclass="notice">'));
  assert.match(rendered, /&lt;b&gt;æ ø å&lt;\/b&gt;<br>Ny linje/);
  assert.doesNotMatch(rendered, /<p<br>|<table<br>|<tr><br>/);
});

test("only new Timekontrol outbox content is branded; other flows render unchanged", async t => {
  t.mock.method(templateRepository, "findActiveTemplate", async () => template);
  t.mock.method(audit, "logAuditEvent", async () => {});
  const saved = [];
  t.mock.method(outboxRepository, "upsertEmail", async (_client, args) => { saved.push(args); return { id: tenantId, status: "queued" }; });
  const variables = { subject: "Påmindelse", first_name: "Blåbær", intro: danish };
  let queries = 0;
  const client = { query: async () => { queries++; return { rows: [{ slug: "hc" }] }; } };
  const options = { tenantId, actorId: "system:time_control", recipientEmail: "employee@example.test", variables,
    payload: { cc_emails: [] }, sourceId: tenantId, idempotencyKey: "unchanged-key" };
  await outboxService.enqueueEmail(client, { ...options, templateKey: "time_control.missing_hours.employee", sourceType: "time_control" });
  assert.equal(queries, 1);
  assert.match(saved[0].htmlBody, /alt="Fielddesk"/);
  assert.equal(saved[0].textBody, renderTemplate(template, variables).text);
  assert.equal(saved[0].idempotencyKey, "unchanged-key");
  await outboxService.enqueueEmail(client, { ...options, templateKey: "absence_request.submitted.employee", sourceType: "absence_request" });
  assert.equal(queries, 1);
  assert.equal(saved[1].htmlBody, renderTemplate(template, variables).html);
  assert.equal(saved[1].textBody, renderTemplate(template, variables).text);
});
