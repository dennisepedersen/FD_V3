"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), { randomUUID } = require("node:crypto"), http = require("node:http");
const fixtureDatabaseUrl = "postgres://example.invalid/operational_routing", fixtureSigningKey = randomUUID(), fixtureProviderKey = randomUUID();
Object.assign(process.env, { NODE_ENV: "test", DATABASE_URL: fixtureDatabaseUrl, JWT_SECRET: fixtureSigningKey,
  ROOT_DOMAIN: "example.test", MAIL_PROVIDER: "resend", MAIL_API_KEY: fixtureProviderKey,
  MAIL_FROM: "Fielddesk <mail@example.test>", MAIL_REPLY_TO: "reply@example.test",
  TIME_CONTROL_SCHEDULER_ENABLED: "true", TIME_CONTROL_MAIL_ENABLED: "true" });
const routing = require("../backend/src/modules/notifications/operationalMailRouting");
const policy = routing.policy, pool = require("../backend/src/db/pool"), audit = require("../backend/src/services/auditService");
const types = Object.keys(policy.TITLES), tenantId = randomUUID(), actorId = randomUUID();
const patches = async (items, fn) => {
  const undo = items.map(([object, key, value]) => { const old = object[key]; object[key] = value; return () => { object[key] = old; }; });
  try { return await fn(); } finally { undo.reverse().forEach(restore => restore()); }
};
const setting = (type = types[0], extra = {}) => ({ ...policy.defaults(type), revision: 3,
  extra_cc_enabled: true, extra_cc_emails: ["observer@example.test"],
  extra_bcc_enabled: true, extra_bcc_emails: ["blind@example.test"], ...extra });
const input = extra => ({ revision: 0, extra_cc_enabled: false, extra_cc_emails: "", extra_bcc_enabled: true, extra_bcc_emails: " Blind@Example.Test ; second@example.test ", ...extra });

test("routing allowlist has exactly three types; daily and weekly employee share one, only weekly leaders use Friday", () => {
  assert.equal(types.length, 3);
  assert.equal(policy.TEMPLATES["time_control.missing_hours.employee"], types[0]);
  assert.equal(policy.TEMPLATES["time_control.employee_weekly_reminder_v1"], types[0]);
  assert.equal(policy.TEMPLATES["time_control.friday_weekly_summary_v1"], types[1]);
  for (const name of ["time_control.daily_status", "time_control.internal_error", "time_control.friday_manager_summary", "tenant_user.invite"]) assert.equal(policy.TEMPLATES[name], undefined);
  assert.throws(() => policy.type("all"));
});
test("semicolon input normalizes without inventing or silently deduplicating recipients", () => {
  assert.deepEqual(policy.input(input()).extra_bcc_emails, ["blind@example.test", "second@example.test"]);
  for (const value of ["", " "]) assert.throws(() => policy.input(input({ extra_bcc_emails: value })), /recipients_required/);
  for (const value of ["a@example.test;", ";a@example.test", "a@example.test;;b@example.test", "a@example.test,b@example.test", "name <a@example.test>", "a@example.test\r\nBcc:x@example.test", "not-an-address", "a..b@example.test", ".a@example.test"]) assert.throws(() => policy.input(input({ extra_bcc_emails: value })), /recipients_invalid/);
  assert.throws(() => policy.input(input({ extra_bcc_emails: "Same@example.test; same@EXAMPLE.test" })), /recipients_duplicate/);
  assert.throws(() => policy.input(input({ extra_cc_enabled: true, extra_cc_emails: "blind@example.test", extra_bcc_emails: "blind@example.test" })), /recipients_duplicate/);
  for (const value of [{ ...input(), tenant_id: tenantId }, { ...input(), to: "forged@example.test" }, { ...input(), extra_bcc_enabled: "true" }, { ...input(), revision: -1 }]) assert.throws(() => policy.input(value));
});
test("defaults are disabled and turning off preserves addresses but adds nobody for every type", () => {
  for (const type of types) {
    assert.equal(policy.defaults(type).extra_cc_enabled, false); assert.equal(policy.defaults(type).extra_bcc_enabled, false);
    assert.deepEqual(policy.defaults(type).extra_bcc_emails, []);
    const disabled = setting(type, { extra_cc_enabled: false, extra_bcc_enabled: false });
    const result = policy.recipients(disabled, { to: "employee@example.test", cc: ["dep@example.test"] });
    assert.deepEqual(result.cc, ["dep@example.test"]); assert.deepEqual(result.bcc, []);
    assert.deepEqual(disabled.extra_bcc_emails, ["blind@example.test"]);
  }
});
test("normal To and CC are immutable additions; any concrete To/CC/BCC conflict rejects instead of deleting normal recipients", () => {
  for (const type of types) {
    const routed = policy.recipients(setting(type), { to: "Employee@Example.Test", cc: ["dep@example.test"] });
    assert.equal(routed.to, "employee@example.test"); assert.deepEqual(routed.cc, ["dep@example.test", "observer@example.test"]);
    assert.deepEqual(routed.bcc, ["blind@example.test"]);
    for (const extra of [ { extra_cc_emails: ["employee@example.test"] }, { extra_bcc_emails: ["dep@example.test"] },
      { extra_cc_emails: ["blind@example.test"] }, { extra_bcc_emails: ["blind@example.test", "BLIND@example.test"] }]) {
      assert.throws(() => policy.recipients(setting(type, extra), { to: "employee@example.test", cc: ["dep@example.test"] }), /recipients_duplicate/);
    }
  }
});
test("dispatch shared-lock validates tenant, type, revision and exact recipients; disable invalidates old queued mail", async () => {
  let stored = setting(), queries = [];
  const client = { async query(sql, params) { queries.push({ sql, params }); return { rows: sql.includes("SELECT * FROM tenant_operational_mail_routing") ? [stored] : [] }; } };
  const route = policy.recipients(stored, { to: "employee@example.test", cc: ["dep@example.test"] });
  const args = { tenantId, mailType: types[0], to: route.to, cc: ["dep@example.test"], queuedTo: route.to, queuedCc: route.cc, queuedBcc: route.bcc, snapshot: route.snapshot };
  await routing.validateQueued(client, args);
  assert(queries.some(q => q.sql.includes("pg_advisory_xact_lock_shared(6124")));
  assert.deepEqual(queries.find(q => q.sql.includes("SELECT * FROM tenant_operational_mail_routing")).params, [tenantId, types[0]]);
  for (const changed of [{ snapshot: { mail_type: types[1], revision: 3 } }, { queuedBcc: ["rogue@example.test"] }, { queuedTo: "rogue@example.test" }, { snapshot: null }]) await assert.rejects(routing.validateQueued(client, { ...args, ...changed }), /routing_changed/);
  stored = { ...stored, revision: 4, extra_bcc_enabled: false };
  await assert.rejects(routing.validateQueued(client, args), /routing_changed/);
  assert.deepEqual(args.queuedBcc, ["blind@example.test"], "a setting change never mutates the locked/queued message");
  await assert.rejects(routing.compose(client, { tenantId: null, mailType: types[0], to: route.to, cc: [] }), /tenant_context_mismatch/);
});
test("legacy queues are accepted only with unchanged normal recipients and no active additions", async () => {
  const client = { async query() { return { rows: [] }; } };
  const args = { tenantId, mailType: types[0], to: "employee@example.test", cc: ["dep@example.test"], queuedTo: "employee@example.test", queuedCc: ["dep@example.test"] };
  await routing.validateQueued(client, args);
  await assert.rejects(routing.validateQueued(client, { ...args, queuedBcc: ["blind@example.test"] }), /routing_changed/);
});

test("twenty extra CC recipients remain valid together with the preserved normal CC at dispatch", async () => {
  for (const mailType of types) {
    const extras = Array.from({ length: 20 }, (_, index) => `observer${index}@example.test`);
    const desired = policy.input(input({ extra_cc_enabled: true, extra_cc_emails: extras.join(";"),
      extra_bcc_enabled: false, extra_bcc_emails: "" }));
    const stored = setting(mailType, desired);
    const client = { async query(sql) { return { rows: sql.includes("SELECT * FROM tenant_operational_mail_routing") ? [stored] : [] }; } };
    const normal = { to: "employee@example.test", cc: ["dep@example.test"] };
    const route = policy.recipients(stored, normal);
    assert.equal(route.cc.length, 21);
    await routing.validateQueued(client, { tenantId, mailType, ...normal,
      queuedTo: route.to, queuedCc: route.cc, queuedBcc: route.bcc, snapshot: route.snapshot });
    const existingCc = Array.from({ length: 25 }, (_, index) => `normal${index}@example.test`);
    const larger = policy.recipients(stored, { to: normal.to, cc: existingCc });
    assert.equal(larger.cc.length, 45, "the extra-recipient limit must not limit existing system CC");
    await routing.validateQueued(client, { tenantId, mailType, to: normal.to, cc: existingCc,
      queuedTo: larger.to, queuedCc: larger.cc, queuedBcc: larger.bcc, snapshot: larger.snapshot });
    assert.throws(() => policy.input(input({ extra_cc_enabled: true,
      extra_cc_emails: [...extras, "overflow@example.test"].join(";") })), /recipients_invalid/);
  }
});
test("tenant admin route rejects nonadmin, wrong tenant and forged fields before state access; GET/save never send", async () => {
  const express = require("../backend/node_modules/express");
  const authPath = require.resolve("../backend/src/middleware/requireAuth"), hostPath = require.resolve("../backend/src/middleware/requireTenantHost");
  const routePath = require.resolve("../backend/src/modules/notifications/operationalMailRouting.routes");
  const oldAuth = require.cache[authPath], oldHost = require.cache[hostPath];
  require.cache[authPath] = { loaded: true, exports: () => (_req, _res, next) => next() };
  require.cache[hostPath] = { loaded: true, exports: (_req, _res, next) => next() };
  delete require.cache[routePath];
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.context = { tenant: { id: tenantId, status: "active" } }; req.auth = { sub: actorId, tenant_id: req.headers["x-tenant"] || tenantId, role: req.headers["x-role"] || "tenant_admin", actor_scope: "tenant" }; next(); });
  app.use(require(routePath)); app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = http.createServer(app); let reads = 0, writes = 0;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/tenant/admin/operational-mail-routing`;
    await patches([[routing, "list", async context => { assert.deepEqual(context, { tenantId, actorId }); reads++; return types.map(policy.defaults); }],
      [routing, "save", async (context, mailType, body) => { assert.deepEqual(context, { tenantId, actorId }); policy.input(body); writes++; return setting(mailType); }]], async () => {
      const result = await fetch(url); assert.equal(result.status, 200); assert.equal(result.headers.get("cache-control"), "no-store");
      assert.equal((await fetch(url, { headers: { "x-role": "project_leader" } })).status, 403);
      assert.equal((await fetch(url, { headers: { "x-tenant": randomUUID() } })).status, 403);
      assert.equal((await fetch(url + "?tenant_id=" + tenantId)).status, 400);
      const update = body => fetch(url + "/" + types[0], { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      assert.equal((await update({ ...input(), to: "forged@example.test" })).status, 400);
      assert.equal((await update(input())).status, 200);
    });
    assert.equal(reads, 1); assert.equal(writes, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
    require.cache[authPath] = oldAuth; require.cache[hostPath] = oldHost; delete require.cache[routePath];
  }
});
test("real outbox processor to real mail adapter carries blind recipients only in provider envelope and count-only send audit", async () => {
  const repository = require("../backend/src/modules/notifications/emailOutbox.repository"), processor = require("../backend/src/modules/notifications/emailOutbox.processor");
  const dispatch = require("../backend/src/modules/timeControl/timeControl.dispatch"), weekly = require("../backend/src/modules/timeControl/timeControl.weekly");
  for (const template of Object.keys(policy.TEMPLATES)) {
    const mailType = policy.TEMPLATES[template], normalTo = template.includes("summary") ? "dep@example.test" : "employee@example.test";
    const baseCc = template.includes("summary") ? [] : ["dep@example.test"];
    const config = setting(mailType), route = policy.recipients(config, { to: normalTo, cc: baseCc });
    const row = { id: randomUUID(), tenant_id: tenantId, source_type: "time_control", template_key: template,
      recipient_email: normalTo, subject: "Fixture", html_body: "<p>Fixture</p>", text_body: "Fixture",
      idempotency_key: "time_control:fixture:one", attempt_count: 1, payload_json: { ...routing.payload(route), friday: "2026-10-23" } };
    const events = [], payloads = [], client = { release() {}, async query(sql) { return { rows: sql.includes("SELECT * FROM tenant_operational_mail_routing") ? [config] : [] }; } };
    const validate = (c, args) => dispatch.validateWithExtras(c, { ...args, to: normalTo, cc: baseCc, prefix: "time_control_fixture" });
    await patches([[pool, "connect", async () => client], [repository, "claimTimeControlBatch", async () => [row]],
      [repository, "markSent", async () => ({ id: row.id })], [audit, "logAuditEvent", async event => events.push(event)],
      [dispatch, "validateAutomatic", async () => {}], [dispatch, "validateDaily", validate], [weekly, "validateDispatchSnapshot", validate], [weekly, "reminderWindow", () => true],
      [global, "fetch", async (url, options) => { assert.equal(url, "https://api.resend.com/emails"); payloads.push(JSON.parse(options.body)); assert(!JSON.stringify(options.headers).includes("blind@example.test")); return { ok: true, json: async () => ({ id: "fixture-provider-id" }) }; }]], async () => {
      const result = await processor.processDueEmails({ tenantId, timeControlOutboxIds: [row.id] });
      assert.equal(result.sent, 1); assert.equal(result.dead_letter, 0);
    });
    assert.equal(payloads.length, 1); assert.deepEqual(payloads[0].to, [normalTo]); assert.deepEqual(payloads[0].cc, [...baseCc, "observer@example.test"]); assert.deepEqual(payloads[0].bcc, ["blind@example.test"]);
    assert(!JSON.stringify([payloads[0].subject, payloads[0].html, payloads[0].text, payloads[0].to, payloads[0].cc]).includes("blind@example.test"));
    const sent = events.find(event => event.eventType === "email_outbox.sent");
    assert.equal(sent.metadata.bcc_count, 1); assert.deepEqual(sent.metadata.mail_routing, route.snapshot);
    assert(!JSON.stringify(sent.metadata).includes("blind@example.test"));
  }
});
