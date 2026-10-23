"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const http = require("node:http");

const fixtureDatabaseUrl = "postgres://example.invalid/approval_control_admin_test";
const fixtureSigningKey = randomUUID();
const fixtureProviderKey = randomUUID();
Object.assign(process.env, { NODE_ENV: "test", DATABASE_URL: fixtureDatabaseUrl,
  JWT_SECRET: fixtureSigningKey, ROOT_DOMAIN: "fielddesk.test", MAIL_PROVIDER: "disabled" });

const ENV = require("../backend/src/config/env");
const pool = require("../backend/src/db/pool");
const audit = require("../backend/src/services/auditService");
const control = require("../backend/src/modules/approvalControl/approvalControl.control");
const activation = require("../backend/src/modules/approvalControl/approvalControl.activation");
const routing = require("../backend/src/modules/notifications/operationalMailRouting");
const jwt = require("../backend/src/services/jwtService");
const { errorHandler } = require("../backend/src/middleware/errorHandler");

const actor = { tenantId: randomUUID(), userId: randomUUID(), tenantSlug: "hoyrup-clemmensen" };
const foreignActor = { tenantId: randomUUID(), userId: randomUUID(), tenantSlug: "foreign-fixture" };
const depId = randomUUID(), workerId = randomUUID();
const FIRST = "approval_control.scheduler_activated";
const CONFIG = "tenant_config_changed";
const clone = value => structuredClone(value);
const localDay = at => new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(at));
const changeInput = (extra = {}) => ({ action: "activate", revision: 0,
  expected_local_date: "2026-10-22", mail_routing_revision: 0,
  confirm: "ACTIVATE:approval_control", ...extra });
const failure = (statusCode, suffix) => ({ statusCode, message: "approval_control_" + suffix });

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

async function patches(items, fn) {
  const undo = items.map(([object, key, value]) => {
    const before = object[key];
    object[key] = value;
    return () => { object[key] = before; };
  });
  try { return await fn(); }
  finally { undo.reverse().forEach(restore => restore()); }
}

// This models transaction rollback and scoped reads, not PostgreSQL lock scheduling.
async function fixture(fn) {
  const tenants = [
    { id: actor.tenantId, slug: actor.tenantSlug, status: "active" },
    { id: foreignActor.tenantId, slug: foreignActor.tenantSlug, status: "active" },
  ];
  const user = (id, tenantId, role, username, email) => ({ id, tenant_id: tenantId, role,
    username, email, status: "active", login_status: "active", session_version: 0 });
  const users = [
    user(actor.userId, actor.tenantId, "tenant_admin", "admin", "admin@example.test"),
    user(depId, actor.tenantId, "project_leader", "DEP", "dep@hoyrup-clemmensen.dk"),
    user(workerId, actor.tenantId, "project_leader", "worker", "worker@example.test"),
    user(foreignActor.userId, foreignActor.tenantId, "tenant_admin", "foreign", "foreign@example.test"),
  ];
  const state = { events: [], queries: [], audits: [], now: "2026-10-22T10:00:00.000Z",
    clocks: [], clients: [], activeTransactions: 0, auditFailure: null, lockFailure: null,
    routing: routing.policy.defaults("approval_control_summary"), allowedPort: null };
  const envKeys = ["APPROVAL_CONTROL_SCHEDULER_ENABLED", "APPROVAL_CONTROL_MAIL_ENABLED",
    "APPROVAL_CONTROL_COVERAGE_FROM", "APPROVAL_CONTROL_FRIDAY_TIME"];
  const originalEnv = envKeys.map(key => [key, process.env[key]]);
  envKeys.forEach(key => { delete process.env[key]; });
  const connect = async () => {
    const clientId = randomUUID();
    let transaction = null;
    const client = {
      get inTransaction() { return transaction !== null; },
      get transactionId() { return transaction?.id; },
      id: clientId,
      release() { assert.equal(transaction, null, "a client must not be released inside a transaction"); },
      async query(text, params = []) {
        const sql = text.replace(/\s+/g, " ").trim();
        state.queries.push({ sql, params: clone(params), clientId, transactionId: transaction?.id });
        if (sql === "BEGIN") {
          assert.equal(transaction, null, "nested transactions are not atomic");
          assert.equal(state.activeTransactions, 0, "fixture does not simulate concurrent PostgreSQL transactions");
          transaction = { id: randomUUID(), snapshot: state.events.slice() };
          state.activeTransactions++;
          return { rows: [] };
        }
        if (sql === "COMMIT" || sql === "ROLLBACK") {
          assert.ok(transaction);
          if (sql === "ROLLBACK") state.events = transaction.snapshot;
          transaction = null;
          state.activeTransactions--;
          return { rows: [] };
        }
        if (/^SET LOCAL (?:lock_timeout|statement_timeout)/.test(sql)) {
          assert.ok(transaction);
          return { rows: [] };
        }
        if (sql.includes("pg_advisory_xact_lock")) {
          assert.ok(transaction);
          const namespace = Number(sql.match(/\((612[345]),/)[1]);
          assert.deepEqual(params, [namespace === 6124 ? actor.tenantId + ":approval_control_summary" : actor.tenantId]);
          if (state.lockFailure === namespace) throw Object.assign(new Error("fixture_lock_timeout"), { code: "55P03" });
          return { rows: [] };
        }
        if (sql.includes("clock_timestamp()")) {
          assert.ok(transaction);
          assert.match(sql, /AS MATERIALIZED/);
          assert.match(sql, /AT TIME ZONE 'UTC'/);
          assert.match(sql, /AT TIME ZONE 'Europe\/Copenhagen'/);
          if (state.clocks.length) state.now = state.clocks.shift();
          const at = new Date(state.now).toISOString(), today = localDay(at);
          return { rows: [sql.includes("AS activated_at") ? { activated_at: at, coverage_from: today } : { at, today }] };
        }
        if (/^SELECT u\.id FROM tenant_user u JOIN tenant t/.test(sql)) {
          assert.ok(transaction);
          assert.match(sql, /u\.tenant_id=\$1 AND u\.id=\$2 AND t\.slug=\$3 AND t\.status='active'/);
          assert.match(sql, /u\.role='tenant_admin' AND u\.status='active' AND u\.login_status='active' FOR SHARE OF u,t/);
          const tenant = tenants.find(t => t.id === params[0] && t.slug === params[2] && t.status === "active");
          return { rows: tenant ? users.filter(u => u.tenant_id === tenant.id && u.id === params[1]
            && u.role === "tenant_admin" && u.status === "active" && u.login_status === "active").map(u => ({ id: u.id })) : [] };
        }
        if (/^SELECT u\.id,u\.tenant_id,u\.email/.test(sql)) {
          assert.match(sql, /u\.tenant_id=\$1 AND t\.slug=\$2 AND t\.status='active'/);
          assert.match(sql, /lower\(u\.username\)='dep'/);
          assert.match(sql, /lower\(u\.email\)='dep@hoyrup-clemmensen\.dk'/);
          assert.match(sql, /u\.status='active' AND u\.login_status='active'/);
          const tenant = tenants.find(t => t.id === params[0] && t.slug === params[1] && t.status === "active");
          return { rows: tenant ? clone(users.filter(u => u.tenant_id === tenant.id && u.username.toLowerCase() === "dep"
            && u.email.toLowerCase() === "dep@hoyrup-clemmensen.dk" && u.status === "active" && u.login_status === "active")) : [] };
        }
        if (sql.includes("FROM tenant_user") && sql.includes("session_version")) {
          assert.match(sql, /WHERE tenant_id = \$1 AND id = \$2/);
          return { rows: clone(users.filter(u => u.tenant_id === params[0] && u.id === params[1])) };
        }
        if (sql.includes("FROM tenant_operational_mail_routing")) {
          assert.match(sql, /WHERE tenant_id=\$1 AND mail_type=\$2/);
          assert.deepEqual(params, [actor.tenantId, "approval_control_summary"]);
          return { rows: [clone(state.routing)] };
        }
        if (sql.includes("FROM audit_event")) {
          assert.match(sql, /WHERE tenant_id\s*=\s*\$1/);
          if (sql.includes("event_type='tenant_config_changed'")) {
            assert.match(sql, /target_type='approval_control_settings' AND target_id=\$1::text/);
            assert.match(sql, /metadata->>'module_key'='approval_control'/);
            assert.match(sql, /ORDER BY \(metadata->>'revision'\)::bigint DESC/);
            const events = state.events.filter(row => row.tenant_id === params[0] && row.event_type === CONFIG
              && row.target_type === "approval_control_settings" && row.target_id === params[0]
              && row.metadata.module_key === "approval_control").sort((a, b) => b.metadata.revision - a.metadata.revision);
            return { rows: clone(events.slice(0, 1).map(row => ({ metadata: row.metadata }))) };
          }
          assert.match(sql, /event_type = 'approval_control\.scheduler_activated'/);
          return { rows: clone(state.events.filter(row => row.tenant_id === params[0] && row.event_type === FIRST).slice(0, 1)) };
        }
        assert.fail("Unexpected fixture SQL: " + sql);
      },
    };
    state.clients.push(client);
    return client;
  };
  const logAuditEvent = async event => {
    assert.ok(event.client.inTransaction, "all writes must use the caller's transaction");
    assert.equal(event.tenantId, actor.tenantId);
    assert.equal(event.actorId, actor.userId);
    assert.equal(event.actorScope, "tenant");
    assert.equal(event.moduleKey, "approval_control");
    assert.ok([FIRST, CONFIG].includes(event.eventType));
    state.audits.push({ eventType: event.eventType, clientId: event.client.id, transactionId: event.client.transactionId });
    const fail = state.auditFailure?.eventType === event.eventType;
    if (fail && !state.auditFailure.afterAppend) throw new Error("fixture_audit_failed");
    if (event.eventType === FIRST) assert.ok(!state.events.some(row => row.tenant_id === event.tenantId && row.event_type === FIRST));
    state.events.push(freeze({ id: randomUUID(), tenant_id: event.tenantId, event_type: event.eventType,
      target_type: event.resourceType, target_id: event.resourceId,
      metadata: clone({ ...event.metadata, module_key: event.moduleKey }) }));
    if (fail) throw new Error("fixture_audit_failed");
  };
  const api = {
    state, users, tenants,
    get events() { return clone(state.events); },
    setNow(at) { state.now = at; },
    body(action = "activate", revision = 0) { return changeInput({ action, revision,
      expected_local_date: localDay(state.now), mail_routing_revision: state.routing.revision,
      confirm: action === "activate" ? "ACTIVATE:approval_control" : "PAUSE:approval_control" }); },
    token(id = actor.userId, overrides = {}) {
      const found = users.find(u => u.id === id);
      return jwt.issueAccessToken({ userId: id, tenantId: found.tenant_id, role: found.role,
        email: found.email, sessionVersion: found.session_version, ...overrides });
    },
    async server(fn) {
      const express = require("../backend/node_modules/express");
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        const tenant = tenants.find(t => req.get("host") === t.slug + ".fielddesk.test");
        req.context = tenant ? { domainScope: "tenant", tenant: clone(tenant) } : { domainScope: "root" };
        next();
      });
      app.use(require("../backend/src/modules/approvalControl/approvalControl.routes"));
      app.use(errorHandler);
      const server = http.createServer(app);
      try {
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        state.allowedPort = String(server.address().port);
        const endpoint = `http://127.0.0.1:${state.allowedPort}/api/approval-control/admin/control`;
        await fn(async ({ method = "GET", token = api.token(), host = actor.tenantSlug + ".fielddesk.test", query = "", body } = {}) => {
          return new Promise((resolve, reject) => {
            const request = http.request(endpoint + query, { method, headers: { Host: host,
              ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) } }, response => {
              let text = "";
              response.setEncoding("utf8");
              response.on("data", chunk => { text += chunk; });
              response.on("error", reject);
              response.on("end", () => {
                try { resolve({ status: response.statusCode, cache: response.headers["cache-control"], data: JSON.parse(text) }); }
                catch (error) { reject(error); }
              });
            });
            request.on("error", reject);
            request.setTimeout(2000, () => request.destroy(new Error("fixture_loopback_timeout")));
            request.end(body ? JSON.stringify(body) : undefined);
          });
        });
      } finally {
        await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
        state.allowedPort = null;
      }
    },
  };
  try {
    return await patches([[pool, "connect", connect], [audit, "logAuditEvent", logAuditEvent],
      [global, "fetch", async () => assert.fail("fetch/EK/provider access is forbidden in admin fixtures")],
      [ENV, "MAIL_PROVIDER", "resend"], [ENV, "MAIL_FROM", "Fielddesk <mail@example.test>"],
      [ENV, "MAIL_REPLY_TO", "reply@example.test"], [ENV, "MAIL_API_KEY", fixtureProviderKey],
      [ENV, "NODE_ENV", "production"]], async () => {
      try { return await fn(api); }
      finally { assert.equal(state.activeTransactions, 0); }
    });
  } finally {
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test("admin GET is inactive without state even with true runtime flags and never creates an activation", async () => fixture(async f => {
  for (const flag of [undefined, "true"]) {
    for (const name of ["APPROVAL_CONTROL_SCHEDULER_ENABLED", "APPROVAL_CONTROL_MAIL_ENABLED"]) {
      if (flag === undefined) delete process.env[name]; else process.env[name] = flag;
    }
    const result = await control.status(actor);
    assert.equal(result.status, "inactive");
    assert.equal(result.revision, 0);
    assert.equal(result.effective_active, false);
    assert.equal(result.coverage_from, null);
    assert.equal(result.activated_at, null);
    assert.equal(result.activation_id, null);
    assert.equal(result.next_scheduled_at, null);
    assert.deepEqual(result.recipients.to, ["dep@hoyrup-clemmensen.dk"]);
  }
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.state.audits, []);
  assert.equal(await activation.get(actor), null);
}));

test("status and change apply both transaction-local timeouts before the authorization query", async () => fixture(async f => {
  for (const request of [() => control.status(actor), () => control.change(actor, f.body())]) {
    const start = f.state.queries.length;
    await request();
    const queries = f.state.queries.slice(start);
    const authorizationIndex = queries.findIndex(q => /^SELECT u\.id FROM tenant_user u JOIN tenant t/.test(q.sql));
    assert.ok(authorizationIndex > 0);
    const beforeAuthorization = queries.slice(0, authorizationIndex);
    assert.equal(beforeAuthorization[0].sql, "BEGIN");
    assert.ok(beforeAuthorization.some(q => q.sql === "SET LOCAL lock_timeout = '3s'"));
    assert.ok(beforeAuthorization.some(q => q.sql === "SET LOCAL statement_timeout = '15s'"));
    assert.ok(!beforeAuthorization.some(q => q.sql.startsWith("SELECT")));
    assert.equal(new Set(queries.map(q => q.clientId)).size, 1);
    for (const query of beforeAuthorization.filter(q => q.sql.startsWith("SET LOCAL"))) {
      assert.equal(query.transactionId, queries[authorizationIndex].transactionId);
    }
  }
}));

test("admin service rechecks active tenant, actual role, user and login and denies foreign contexts", async () => fixture(async f => {
  const admin = f.users.find(u => u.id === actor.userId), tenant = f.tenants[0];
  for (const context of [null, {}, { ...actor, tenantId: "invalid" }, { ...actor, userId: "invalid" },
    { ...actor, userId: foreignActor.userId }, { ...actor, tenantId: foreignActor.tenantId }, foreignActor,
    { ...actor, tenantSlug: "other" }, { ...actor, userId: workerId, role: "tenant_admin" }]) {
    await assert.rejects(control.status(context), failure(403, "control_access_denied"));
    await assert.rejects(control.change(context, f.body()), failure(403, "control_access_denied"));
  }
  for (const [object, key, value] of [[tenant, "status", "suspended"], [admin, "status", "deactivated"],
    [admin, "login_status", "disabled"], [admin, "role", "project_leader"], [admin, "role", "technician"]]) {
    const before = object[key]; object[key] = value;
    try {
      await assert.rejects(control.status(actor), failure(403, "control_access_denied"));
      await assert.rejects(control.change(actor, f.body()), failure(403, "control_access_denied"));
    } finally { object[key] = before; }
  }
  assert.deepEqual(f.events, []);
}));

test("admin inputs reject injected dates, tenants, actors, roles, invalid revisions and missing confirmations before SQL", async () => fixture(async f => {
  const valid = f.body(), missing = { ...valid }; delete missing.confirm;
  for (const body of [null, [], {}, missing, ...["coverage_from", "activated_at", "enabled_at", "tenant_id", "user_id", "role", "enabled", "scope"].map(key => ({ ...valid, [key]: "injected" })),
    { ...valid, action: "resume" }, { ...valid, confirm: "ACTIVATE:approval_control:hoyrup-clemmensen" },
    { ...valid, revision: -1 }, { ...valid, revision: "0" }, { ...valid, revision: 1.5 },
    { ...valid, mail_routing_revision: -1 }, { ...valid, mail_routing_revision: "0" },
    { ...valid, expected_local_date: "2026-1-1" }]) {
    await assert.rejects(control.change(actor, body), failure(400, "control_input_invalid"));
  }
  assert.deepEqual(f.state.queries, []);
  assert.deepEqual(f.events, []);
}));

test("first activation and control generation use the actual activation helper in one transaction", async () => fixture(async f => {
  const result = await control.change(actor, f.body());
  assert.equal(result.status, "active");
  assert.equal(result.effective_active, true);
  assert.equal(result.revision, 1);
  assert.equal(result.coverage_from, "2026-10-22");
  assert.equal(result.activated_at, f.state.now);
  assert.equal(result.next_scheduled_at, "2026-10-22T12:30:00.000Z");
  assert.deepEqual(f.events.map(row => row.event_type), [FIRST, CONFIG]);
  assert.equal(new Set(f.state.audits.map(row => row.clientId)).size, 1);
  assert.equal(new Set(f.state.audits.map(row => row.transactionId)).size, 1);
  assert.equal(f.state.queries.filter(q => q.sql === "BEGIN").length, 1);
  assert.equal(f.state.queries.filter(q => q.sql === "COMMIT").length, 1);
  assert.ok(f.state.queries.some(q => q.sql.includes("pg_advisory_xact_lock(6123")));
  assert.ok(f.state.queries.some(q => q.sql.includes("pg_advisory_xact_lock(6125")));
  assert.ok(f.state.queries.some(q => q.sql.includes("pg_advisory_xact_lock_shared(6124")));
  const saved = await control.get(actor), first = await activation.get(actor);
  assert.equal(saved.activation_id, first.id);
  assert.equal(saved.enabled_at, f.state.now);
  assert.equal(first.coverage_from, saved.coverage_from);
  assert.equal(f.events[1].metadata.before.revision, 0);
  assert.equal(f.events[1].metadata.after.revision, 1);
}));

test("activation and state both roll back when either audit write fails, including failure after append", async () => {
  for (const eventType of [FIRST, CONFIG]) for (const afterAppend of [false, true]) await fixture(async f => {
    f.state.auditFailure = { eventType, afterAppend };
    await assert.rejects(control.change(actor, f.body()), /fixture_audit_failed/);
    assert.deepEqual(f.events, []);
    assert.equal(f.state.queries.filter(q => q.sql === "ROLLBACK").length, 1);
    assert.equal(f.state.queries.filter(q => q.sql === "COMMIT").length, 0);
    assert.equal(await activation.get(actor), null);
    assert.equal((await control.get(actor)).revision, 0);
    f.state.auditFailure = null;
    assert.equal((await control.change(actor, f.body())).status, "active");
    assert.deepEqual(f.events.map(row => row.event_type), [FIRST, CONFIG]);
  });
});

test("first coverage is the Copenhagen database date, never the UTC date or client-selected history", async () => fixture(async f => {
  f.setNow("2031-03-30T22:05:00.000Z");
  const shown = await control.status(actor);
  assert.equal(shown.today, "2031-03-31");
  await assert.rejects(control.change(actor, changeInput({ expected_local_date: "2031-03-30" })), failure(409, "control_confirmation_changed"));
  assert.deepEqual(f.events, []);
  const result = await control.change(actor, f.body());
  assert.equal(result.coverage_from, "2031-03-31");
  assert.equal(result.activated_at, "2031-03-30T22:05:00.000Z");
}));

test("midnight during activation-clock sampling or before state audit rolls the entire activation back", async () => {
  const before = "2026-10-22T21:59:59.900Z", after = "2026-10-22T22:00:00.100Z";
  for (const clocks of [[before, after, after], [before, before, after]]) await fixture(async f => {
    f.setNow(before);
    const body = f.body();
    f.state.clocks = clocks.slice();
    await assert.rejects(control.change(actor, body), failure(409, "control_confirmation_changed"));
    assert.ok(f.state.audits.some(row => row.eventType === FIRST), "first write was attempted before rollback");
    assert.deepEqual(f.events, []);
    assert.equal(await activation.get(actor), null);
  });
});

test("confirmation binds routing revision, current server day and current control revision", async () => fixture(async f => {
  for (const overrides of [{ expected_local_date: "2026-10-21" }, { expected_local_date: "2026-02-30" }, { mail_routing_revision: 1 }]) {
    await assert.rejects(control.change(actor, { ...f.body(), ...overrides }), failure(409, "control_confirmation_changed"));
  }
  await assert.rejects(control.change(actor, f.body("activate", 1)), failure(409, "control_conflict"));
  assert.deepEqual(f.events, []);
  f.state.routing.revision = 2;
  await assert.rejects(control.change(actor, { ...f.body(), mail_routing_revision: 0 }), failure(409, "control_confirmation_changed"));
  assert.deepEqual(f.events, []);
}));

test("no-op requests do not append audits and stale revisions cannot replay the first activation", async () => fixture(async f => {
  assert.equal((await control.change(actor, f.body("pause"))).status, "inactive");
  assert.deepEqual(f.events, []);
  const original = f.body();
  await control.change(actor, original);
  const before = f.events;
  await assert.rejects(control.change(actor, original), failure(409, "control_conflict"));
  assert.equal((await control.change(actor, f.body("activate", 1))).revision, 1);
  assert.deepEqual(f.events, before);
  await control.change(actor, f.body("pause", 1));
  const paused = f.events;
  assert.equal((await control.change(actor, f.body("pause", 2))).status, "paused");
  assert.deepEqual(f.events, paused);
}));

test("pause/resume advances the generation while retaining the original immutable first date", async () => fixture(async f => {
  await control.change(actor, f.body());
  const first = await activation.get(actor), initial = await control.get(actor);
  f.setNow("2026-10-23T13:00:00.000Z");
  assert.equal((await control.change(actor, f.body("pause", 1))).status, "paused");
  const paused = await control.get(actor);
  assert.equal(paused.enabled_at, initial.enabled_at);
  f.setNow("2026-10-26T10:00:00.000Z");
  const resumed = await control.change(actor, f.body("activate", 2));
  assert.equal(resumed.revision, 3);
  assert.equal(resumed.coverage_from, "2026-10-22");
  assert.equal(resumed.activated_at, first.activated_at);
  assert.deepEqual(await activation.get(actor), first);
  assert.equal((await control.get(actor)).enabled_at, f.state.now);
  assert.equal(f.events.filter(row => row.event_type === FIRST).length, 1);
  assert.deepEqual(f.events.filter(row => row.event_type === CONFIG).map(row => row.metadata.revision), [1, 2, 3]);
}));

test("failed pause/resume audit preserves the previous generation and the first activation", async () => fixture(async f => {
  await control.change(actor, f.body());
  const first = await activation.get(actor);
  for (const [action, revision, expectedStatus] of [["pause", 1, "active"], ["activate", 2, "paused"]]) {
    const before = f.events, state = await control.get(actor);
    f.state.auditFailure = { eventType: CONFIG, afterAppend: true };
    await assert.rejects(control.change(actor, f.body(action, revision)), /fixture_audit_failed/);
    assert.deepEqual(f.events, before);
    assert.deepEqual(await control.get(actor), state);
    assert.deepEqual(await activation.get(actor), first);
    assert.equal((await control.status(actor)).status, expectedStatus);
    f.state.auditFailure = null;
    assert.equal((await control.change(actor, f.body(action, revision))).revision, revision + 1);
  }
}));

test("legacy first activation without control state is paused at revision zero and resumes with the original date", async () => fixture(async f => {
  const first = await activation.recordFirst(actor);
  assert.equal((await control.get(actor)).revision, 0);
  f.setNow("2026-10-26T10:00:00.000Z");
  const before = await control.status(actor);
  assert.equal(before.status, "paused");
  assert.equal(before.revision, 0);
  assert.equal(before.effective_active, false);
  assert.equal(before.next_scheduled_at, null);
  assert.equal(before.coverage_from, "2026-10-22");
  assert.equal(before.activation_id, first.id);
  const resumed = await control.change(actor, f.body());
  assert.equal(resumed.status, "active");
  assert.equal(resumed.revision, 1);
  assert.equal(resumed.coverage_from, first.coverage_from);
  assert.equal(resumed.activated_at, first.activated_at);
  assert.deepEqual(await activation.get(actor), first);
  assert.equal(f.events.filter(row => row.event_type === FIRST).length, 1);
  assert.equal((await control.get(actor)).enabled_at, f.state.now);
}));

test("next slot is strictly after enabling, including exact slot, mid-minute and Friday weekend/DST", async () => {
  for (const [now, next] of [
    ["2026-10-22T12:29:59.999Z", "2026-10-22T12:30:00.000Z"],
    ["2026-10-22T12:30:00.000Z", "2026-10-23T12:31:00.000Z"],
    ["2026-10-22T12:30:30.000Z", "2026-10-23T12:31:00.000Z"],
    ["2026-10-23T12:31:00.000Z", "2026-10-26T13:30:00.000Z"],
  ]) await fixture(async f => {
    f.setNow(now);
    const result = await control.change(actor, f.body());
    assert.equal(result.next_scheduled_at, next);
    assert.ok(Date.parse(result.next_scheduled_at) > Date.parse((await control.get(actor)).enabled_at));
  });
});

test("environment, explicit false emergency flags and invalid policy block activation without writes", async () => {
  for (const [key, value] of [["NODE_ENV", "test"], ["APPROVAL_CONTROL_SCHEDULER_ENABLED", "false"],
    ["APPROVAL_CONTROL_MAIL_ENABLED", "false"], ["APPROVAL_CONTROL_MAIL_ENABLED", "invalid"],
    ["APPROVAL_CONTROL_FRIDAY_TIME", "14:30"], ["APPROVAL_CONTROL_COVERAGE_FROM", "2020-01-01"]]) await fixture(async f => {
    if (key === "NODE_ENV") ENV.NODE_ENV = value; else process.env[key] = value;
    const shown = await control.status(actor);
    assert.ok(shown.configuration_blockers.length);
    assert.equal(shown.activation_next_scheduled_at, null);
    await assert.rejects(control.change(actor, f.body()), failure(409, "control_configuration_blocked"));
    assert.deepEqual(f.events, []);
  });
});

test("unconfigured transport blocks activation before any audit but still permits pause after transport loss", async () => {
  for (const [key, value] of [["MAIL_PROVIDER", "disabled"], ["MAIL_PROVIDER", "postmark"],
    ["MAIL_FROM", null], ["MAIL_REPLY_TO", ""], ["MAIL_API_KEY", null]]) await fixture(async f => {
    const configured = ENV[key];
    ENV[key] = value;
    const shown = await control.status(actor);
    assert.equal(shown.status, "inactive");
    assert.equal(shown.activation_next_scheduled_at, null);
    assert.ok(shown.configuration_blockers.some(reason => reason.includes("mailtransport")));
    await assert.rejects(control.change(actor, f.body()), failure(409, "control_configuration_blocked"));
    assert.deepEqual(f.events, []);
    assert.deepEqual(f.state.audits, []);
    assert.equal(await activation.get(actor), null);
    ENV[key] = configured;
    await control.change(actor, f.body());
    const first = await activation.get(actor);
    ENV[key] = value;
    const blocked = await control.status(actor);
    assert.equal(blocked.effective_active, false);
    assert.equal(blocked.next_scheduled_at, null);
    assert.equal(blocked.activation_next_scheduled_at, null);
    const paused = await control.change(actor, f.body("pause", 1));
    assert.equal(paused.status, "paused");
    assert.equal(paused.revision, 2);
    assert.equal(paused.activation_next_scheduled_at, null);
    assert.deepEqual(await activation.get(actor), first);
    await assert.rejects(control.change(actor, f.body("activate", 2)), failure(409, "control_configuration_blocked"));
    assert.equal((await control.get(actor)).revision, 2);
  });
});

test("bad routing or missing DEP blocks activation but still permits pausing an active generation", async () => {
  for (const problem of ["routing", "recipient"]) await fixture(async f => {
    await control.change(actor, f.body());
    if (problem === "routing") Object.assign(f.state.routing, { revision: 1,
      extra_cc_enabled: true, extra_cc_emails: ["dep@hoyrup-clemmensen.dk"] });
    else f.users.find(u => u.id === depId).login_status = "disabled";
    const shown = await control.status(actor);
    assert.equal(shown.effective_active, false);
    assert.equal(shown.next_scheduled_at, null);
    assert.equal(shown.activation_next_scheduled_at, null);
    assert.ok(shown.configuration_blockers.length);
    if (problem === "recipient") assert.deepEqual(shown.recipients.to, []);
    const paused = await control.change(actor, f.body("pause", 1));
    assert.equal(paused.status, "paused");
    assert.equal(paused.revision, 2);
    assert.equal(paused.activation_next_scheduled_at, null);
    await assert.rejects(control.change(actor, f.body("activate", 2)), failure(409, "control_configuration_blocked"));
    assert.equal((await control.get(actor)).revision, 2);
    assert.equal(f.events.filter(row => row.event_type === FIRST).length, 1);
  });
});

test("shared send lock spans the awaited callback and commits only after the local callback settles", { timeout: 3000 }, async () => fixture(async f => {
  await control.change(actor, f.body());
  const state = await control.get(actor), first = await activation.get(actor);
  const planned = { scheduled_at: "2026-10-22T12:30:00.000Z" };
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const start = f.state.queries.length;
  const sending = control.withSendLock(actor, state, planned, first, async () => {
    assert.equal(f.state.activeTransactions, 1);
    assert.ok(f.state.queries.slice(start).some(q => q.sql.includes("pg_advisory_xact_lock_shared(6125")));
    enter(); await held;
    return "local callback only";
  });
  try {
    await Promise.race([entered, sending.then(() => assert.fail("send callback was skipped"))]);
    assert.ok(!f.state.queries.slice(start).some(q => q.sql === "COMMIT"));
  } finally { release(); }
  assert.equal(await sending, "local callback only");
  assert.equal(f.state.queries.slice(start).filter(q => q.sql === "COMMIT").length, 1);
}));

test("send guards reject stale revision, wrong first identity/coverage, nonfuture slot and runtime stop", async () => fixture(async f => {
  await control.change(actor, f.body());
  const state = await control.get(actor), first = await activation.get(actor);
  const planned = { scheduled_at: "2026-10-22T12:30:00.000Z" };
  let calls = 0;
  const send = async () => { calls++; };
  for (const [expected, slot, origin] of [[{ revision: 0 }, planned, first],
    [state, planned, null], [state, planned, { ...first, id: randomUUID() }],
    [state, planned, { ...first, coverage_from: "2026-10-21" }],
    [state, { scheduled_at: state.enabled_at }, first], [state, { scheduled_at: "2026-10-21T12:30:00Z" }, first]]) {
    await assert.rejects(control.withSendLock(actor, expected, slot, origin, send), failure(409, "control_changed"));
  }
  process.env.APPROVAL_CONTROL_MAIL_ENABLED = "false";
  await assert.rejects(control.withSendLock(actor, state, planned, first, send), failure(409, "control_changed"));
  delete process.env.APPROVAL_CONTROL_MAIL_ENABLED;
  f.setNow("2026-10-26T10:00:00.000Z");
  await control.change(actor, f.body("pause", 1));
  await assert.rejects(control.withSendLock(actor, { revision: 2 }, planned, first, send), failure(409, "control_changed"));
  await control.change(actor, f.body("activate", 2));
  await assert.rejects(control.withSendLock(actor, state, planned, first, send), failure(409, "control_changed"));
  await assert.rejects(control.withSendLock(actor, { revision: 3 }, planned, first, send), failure(409, "control_changed"));
  assert.equal(calls, 0);
}));

test("missing control state cannot send and lock timeout cannot produce a successful control change", async () => fixture(async f => {
  await assert.rejects(control.withSendLock(actor, { revision: 0 }, { scheduled_at: "2026-10-22T12:30:00Z" }, null,
    async () => assert.fail("inactive control must not send")), failure(409, "control_changed"));
  f.state.lockFailure = 6125;
  await assert.rejects(control.change(actor, f.body()), failure(409, "control_busy"));
  assert.deepEqual(f.events, []);
}));

test("real GET/POST route middleware rejects missing/invalid/revoked sessions, nonadmins and foreign tenant hosts", async () => fixture(async f => {
  await f.server(async request => {
    for (const method of ["GET", "POST"]) {
      for (const options of [{ token: null, expected: 401 }, { token: "invalid", expected: 401 },
        { token: f.token(workerId), expected: 403 }, { token: f.token(workerId, { role: "tenant_admin" }), expected: 403 },
        { token: f.token(foreignActor.userId), expected: 403 }, { host: "portal.fielddesk.test", expected: 403 },
        { host: foreignActor.tenantSlug + ".fielddesk.test", expected: 403 },
        { host: foreignActor.tenantSlug + ".fielddesk.test", token: f.token(foreignActor.userId), expected: 403 }]) {
        const result = await request({ method, ...(method === "POST" ? { body: f.body() } : {}), ...options });
        assert.equal(result.status, options.expected, JSON.stringify(result.data));
      }
      const stale = f.token();
      const admin = f.users.find(u => u.id === actor.userId);
      admin.session_version++;
      assert.equal((await request({ method, token: stale, ...(method === "POST" ? { body: f.body() } : {}) })).status, 401);
      admin.session_version--;
      for (const key of ["status", "login_status"]) {
        const previous = admin[key]; admin[key] = "deactivated";
        assert.equal((await request({ method, ...(method === "POST" ? { body: f.body() } : {}) })).status, 401);
        admin[key] = previous;
      }
    }
    assert.deepEqual(f.events, []);
  });
}));

test("loopback admin GET is inert; query/body tenant/date forgery is rejected before real activation", async () => fixture(async f => {
  await f.server(async request => {
    const initial = await request();
    assert.equal(initial.status, 200, JSON.stringify(initial.data));
    assert.equal(initial.cache, "no-store");
    assert.equal(initial.data.control.status, "inactive");
    assert.deepEqual(f.events, []);
    for (const query of ["?tenant_id=" + foreignActor.tenantId, "?scope=all", "?coverage_from=2020-01-01"]) {
      for (const method of ["GET", "POST"]) assert.equal((await request({ method, query,
        ...(method === "POST" ? { body: f.body() } : {}) })).status, 400);
    }
    for (const field of ["tenant_id", "user_id", "role", "coverage_from", "activated_at", "enabled_at"]) {
      assert.equal((await request({ method: "POST", body: { ...f.body(), [field]: "forged" } })).status, 400);
    }
    assert.deepEqual(f.events, []);
    const activated = await request({ method: "POST", body: f.body() });
    assert.equal(activated.status, 200);
    assert.equal(activated.cache, "no-store");
    assert.equal(activated.data.control.status, "active");
    assert.equal((await request({ method: "POST", body: f.body() })).status, 409);
    assert.equal((await request()).data.control.revision, 1);
    assert.deepEqual(f.events.map(row => row.event_type), [FIRST, CONFIG]);
  });
}));
