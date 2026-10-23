"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fixtureDatabaseUrl = "postgres://example.invalid/approval_control_test";
const fixtureSigningKey = crypto.randomUUID();
Object.assign(process.env, { NODE_ENV: "test", DATABASE_URL: fixtureDatabaseUrl,
  JWT_SECRET: fixtureSigningKey, ROOT_DOMAIN: "fielddesk.test" });

const logic = require("../backend/src/modules/approvalControl/approvalControl.logic");
const scope = require("../backend/src/modules/approvalControl/approvalControl.scope");
const source = require("../backend/src/modules/approvalControl/approvalControl.source");
const service = require("../backend/src/modules/approvalControl/approvalControl.service");
const audit = require("../backend/src/modules/approvalControl/approvalControl.audit");
const auditService = require("../backend/src/services/auditService");
const admission = require("../backend/src/modules/approvalControl/approvalControl.admission");
const pool = require("../backend/src/db/pool");
const users = require("../backend/src/db/queries/user");
const projects = require("../backend/src/db/queries/project");
const refresh = require("../backend/src/services/fitterhoursRefreshService");
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const context = { tenantId: uuid(1), userId: uuid(2), tenantSlug: "hoyrup-clemmensen" };
const user = { id: uuid(2), tenant_id: uuid(1), username: "dep", status: "active", login_status: "active", email: "dep@example.test", ek_user_id: null };
const project = { project_id: uuid(3), external_project_ref: "80396-003", name: "Fixture project" };
const other = { project_id: uuid(4), external_project_ref: "9015", name: "Other project" };
const binding = { project_id: uuid(3), ek_project_id: "25906" };
const period = { fromDate: "2026-10-12", toDate: "2026-10-16" };
const input = { from_date: period.fromDate, to_date: period.toDate };
const row = (id = 1, extra = {}) => ({ id, projectID: 25906, fitterID: 18, fitterName: "Fixture technician", date: "2026-10-12T00:00:00", hours: 7.5, approvedBy: null, approvedDate: null, ...extra });
const summary = rows => logic.summarize({ ...context, ...period, projects: [project], bindings: [binding], rows });
const patches = async (items, fn) => {
  const restores = items.map(([object, key, value]) => { const previous = object[key]; object[key] = value; return () => { object[key] = previous; }; });
  try { return await fn(); } finally { restores.reverse().forEach(restore => restore()); }
};

test("HC confirmed explicit null pair is pending; approval never enters pending", () => {
  assert.equal(logic.approvalStatus(row()).status, "pending");
  const result = summary([row(), row(2, { approvedBy: "DEP", approvedDate: "2026-10-18T13:00:00" })]);
  assert.equal(result.counts.open_rows, 1);
  assert.equal(result.approved_count, 1);
});

test("missing, empty, contradictory and invalid approval fields are data clarification, never pending", () => {
  for (const extra of [{ approvedBy: "" }, { approvedDate: "" }, { approvedBy: "DEP" }, { approvedDate: "2026-10-18T12:00:00" }, { approvedBy: "DEP", approvedDate: "2026-02-30T12:00:00" }, { approvedBy: false }, { approvedDate: "not-a-date" }]) {
    const result = summary([row(1, extra)]);
    assert.equal(result.pending.length, 0);
    assert.equal(result.unknown.length, 1);
  }
  const missing = row(); delete missing.approvedBy;
  assert.equal(summary([missing]).unknown.length, 1);
  for (const extra of [{ hours: -7 }, { hours: "7" }, { fitterID: null }, { date: "2026-10-99T00:00:00" }]) assert.equal(summary([row(1, extra)]).unknown.length, 1);
});

test("9015 is excluded whenever not returned by exact mine query, regardless of fitter or historical DEP approval", () => {
  const result = summary([row(), row(2, { projectID: 17636, approvedBy: "DEP", approvedDate: "2026-10-18T12:00:00" }), row(3, { projectID: 17636 })]);
  assert.equal(result.counts.open_rows, 1);
  assert.equal(result.approved_count, 0);
  assert.doesNotMatch(JSON.stringify(result), /9015|17636|Other project/);
});

test("9015 is not hardcoded excluded if canonical mine query later includes it", () => {
  const result = logic.summarize({ ...context, ...period, projects: [other], bindings: [{ project_id: other.project_id, ek_project_id: "17636" }], rows: [row(1, { projectID: 17636 })] });
  assert.equal(result.pending[0].project_reference, "9015");
});

test("two pending lines group once; same line never doubles and conflicting duplicates fail closed", () => {
  const result = summary([row(), row(), row(2, { hours: 2.5 })]);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].rows.length, 2);
  assert.deepEqual(result.counts, { open_rows: 2, projects: 1, hours: 10, oldest_date: "2026-10-12" });
  const conflict = summary([row(), row(1, { hours: 9 }), row()]);
  assert.equal(conflict.pending.length, 0);
  assert.equal(conflict.unknown.length, 1);
});

test("later approval removes row from next preview and changes fingerprint", () => {
  const before = summary([row()]);
  const after = summary([row(1, { approvedBy: "DEP", approvedDate: "2026-10-18T13:00:00" })]);
  assert.equal(after.pending.length, 0);
  assert.notEqual(before.fingerprint, after.fingerprint);
  assert.equal(before.fingerprint, summary([row(), row()]).fingerprint);
});

test("scope directly calls the exact existing function and never requires an EK GUID", async () => {
  const calls = [];
  const client = { async query(sql, args) { assert.match(sql, /tenant_id = \$1 AND project_id = ANY\(\$2::uuid\[\]\)/); assert.deepEqual(args, [context.tenantId, [project.project_id]]); return { rows: [binding] }; } };
  await patches([
    [users, "findSessionTenantUserById", async (_client, args) => { assert.deepEqual(args, { tenantId: context.tenantId, userId: context.userId }); return user; }],
    [projects, "listProjectsForUser", async (passed, args) => { calls.push(args); assert.equal(passed, client); return [project]; }],
  ], async () => {
    const result = await scope.loadMine(client, context);
    assert.deepEqual(result.projects, [project]);
    await assert.rejects(scope.loadMine(client, { ...context, projectId: other.project_id }), /project_not_found/);
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { tenantId: context.tenantId, userId: context.userId });
});

test("POC scope denies other tenant, user or inactive login before project query", async () => {
  for (const candidate of [{ ...user, username: "other" }, { ...user, tenant_id: uuid(9) }, { ...user, status: "deactivated" }, { ...user, login_status: "inactive" }]) {
    await patches([[users, "findSessionTenantUserById", async () => candidate], [projects, "listProjectsForUser", async () => assert.fail("must not select projects")]], async () => {
      await assert.rejects(scope.loadMine({}, context), /poc_access_denied/);
    });
  }
  await patches([[users, "findSessionTenantUserById", async () => user]], async () => {
    await assert.rejects(scope.loadMine({}, { ...context, tenantSlug: "foreign" }), /poc_access_denied/);
  });
});

test("client cannot select all, another actor, tenant, routing, or a wider project list", () => {
  for (const field of ["scope", "tenant_id", "user_id", "project_ids", "to", "cc", "send", "mode", "pending_status_verified"]) assert.throws(() => service.request({ ...input, [field]: "forged" }), /preview_input_invalid/);
  assert.throws(() => service.request({ ...input, from_date: "2026-02-30" }), /date_invalid/);
  assert.throws(() => service.request({ ...input, to_date: "2026-10-20" }), /max_seven_days/);
});

function envelope(rows, total = rows.length, page = 1, nextPage = null) {
  return { hasErrors: false, errorMessage: null, validationErrors: [], modelStateErrors: {}, data: { data: rows, total, currentPage: page, nextPage, hasErrors: null } };
}
const capture = fetchImpl => source.capture({ config: { ekBaseUrl: "https://ek.example.test", ekApiKey: "fixture", siteName: "fixture" }, ...period, fetchImpl });

test("read-only reader verifies two passes and preserves missing fields as missing", async () => {
  let calls = 0;
  const missing = row(); delete missing.approvedBy;
  const result = await capture(async (url, options) => {
    calls++; assert.equal(url.pathname, "/api/v4/paginatedfitterhours"); assert.equal(options.method, "GET"); assert.equal(options.redirect, "error");
    assert.equal(url.searchParams.get("fromDate"), period.fromDate);
    return { status: 200, json: async () => envelope([missing]) };
  });
  assert.equal(calls, 2);
  assert.equal(Object.hasOwn(result.rows[0], "approvedBy"), false);
  assert.equal(summary(result.rows).unknown.length, 1);
});

test("pagination covers full terminal page, empty result, and rejects truncation, duplicates and unstable approval", async () => {
  const full = Array.from({ length: 100 }, (_, i) => row(i + 1));
  assert.equal((await capture(async () => ({ status: 200, json: async () => envelope(full) }))).rows.length, 100);
  assert.equal((await capture(async () => ({ status: 200, json: async () => envelope([], 0, 0) }))).rows.length, 0);
  for (const body of [envelope([row()], 2), envelope([row(), row()]), { ...envelope([]), hasErrors: true }]) await assert.rejects(capture(async () => ({ status: 200, json: async () => body })));
  let pass = 0;
  await assert.rejects(capture(async () => ({ status: 200, json: async () => envelope([row(1, pass++ ? { approvedBy: "DEP", approvedDate: "2026-10-18T12:00:00" } : {})]) })), /source_unstable/);
  let calls = 0;
  await assert.rejects(capture(async () => { calls++; return { status: 429 }; }), /source_http_429/);
  assert.equal(calls, 1, "no automatic retry");
  for (const body of [{ ...envelope([]), errors: ["error"] }, { ...envelope([]), errorCount: 1 }, { ...envelope([]), data: { ...envelope([]).data, hasErrors: "false" } }, { ...envelope([]), data: { ...envelope([]).data, errorCount: 1 } }]) await assert.rejects(capture(async () => ({ status: 200, json: async () => body })), /envelope_invalid/);
});

test("invalid existing project bindings are diagnosed rather than disappearing", async () => {
  await patches([[users, "findSessionTenantUserById", async () => user], [projects, "listProjectsForUser", async () => [project]]], async () => {
    const selected = await scope.loadMine({ async query() { return { rows: [{ project_id: project.project_id, ek_project_id: null }] }; } }, context);
    assert.equal(selected.projects.length, 1);
    assert.deepEqual(selected.bindings, []);
  });
});

test("preview admission protects Copenhagen daily/Friday windows including DST", () => {
  for (const time of ["2026-10-20T06:59:00Z", "2026-10-20T07:29:59Z", "2026-10-23T09:59:00Z", "2026-10-23T12:30:59Z", "2026-10-27T07:59:00Z"]) assert.equal(admission.protectedWindow(new Date(time)), true, time);
  for (const time of ["2026-10-20T06:58:59Z", "2026-10-20T07:30:00Z", "2026-10-23T12:31:00Z", "2026-10-19T07:00:00Z"]) assert.equal(admission.protectedWindow(new Date(time)), false, time);
});

test("tenant-wide preview admission denies concurrent/cooldown reads and always unlocks", async () => {
  const queries = [];
  const client = { release(discard) { assert.equal(discard, false); }, async query(sql, args) { queries.push(sql); if (sql.startsWith("SELECT")) assert.equal(args[0], context.tenantId); return { rows: sql.includes("pg_try_advisory_lock") ? [{ locked: true }] : [] }; } };
  await patches([[pool, "connect", async () => client]], async () => {
    await assert.rejects(admission.read(context, async () => { throw new Error("fixture failed"); }, new Date("2026-10-22T20:00:00Z")), /fixture failed/);
    assert(queries.some(sql => sql.includes("pg_advisory_unlock")));
    await patches([[client, "query", async sql => ({ rows: sql.includes("pg_try_advisory_lock") ? [{ locked: false }] : [] })]], async () => {
      await assert.rejects(admission.read(context, async () => assert.fail("must not read"), new Date("2026-10-22T20:00:00Z")), /preview_running/);
    });
    await patches([[client, "query", async sql => ({ rows: sql.includes("pg_try_advisory_lock") ? [{ locked: true }] : sql.includes("FROM audit_event") ? [{ found: true }] : [] })]], async () => {
      await assert.rejects(admission.read(context, async () => assert.fail("must not read"), new Date("2026-10-22T20:00:00Z")), /preview_cooldown/);
    });
  });
});

test("admission records every capture independently of duplicate results and rechecks time after waits", async () => {
  let saved = false, captures = 0, inserts = 0;
  const before = new Date("2026-10-20T06:58:50Z"), during = new Date("2026-10-20T07:00:00Z");
  const client = { release() {}, async query(sql) {
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
    if (sql.includes("FROM audit_event")) return { rows: saved ? [{ found: true }] : [] };
    if (sql.includes("INSERT INTO audit_event")) { saved = true; inserts++; }
    return { rows: [] };
  } };
  await patches([[pool, "connect", async () => client]], async () => {
    await admission.read(context, async () => { captures++; }, new Date("2026-10-22T20:00:00Z"));
    for (let i = 0; i < 2; i++) await assert.rejects(admission.read(context, async () => { captures++; }, new Date("2026-10-22T20:00:01Z")), /cooldown/);
    assert.equal(captures, 1); assert.equal(inserts, 1);
    saved = false;
    let ticks = 0;
    await assert.rejects(admission.read(context, async () => assert.fail("must not capture after wait"), () => ticks++ ? during : before), /protected_window/);
    assert.equal(inserts, 1);
  });
});

async function fixture(fn) {
  let current = { user, projects: [project], bindings: [binding] };
  let nextRows = [row()];
  const saved = new Map();
  const client = { release() {}, async query() { assert.fail("unmocked SQL"); } };
  await patches([
    [pool, "connect", async () => client],
    [scope, "loadMine", async () => current],
    [refresh, "resolveTenantConfig", async () => ({ tenantId: context.tenantId })],
    [source, "capture", async () => ({ rows: nextRows, observed_at: "2026-10-22T20:00:00Z", completed_at: "2026-10-22T20:00:01Z", requests: 2, passes: 2, endpoint: "/api/v4/paginatedfitterhours" })],
    [admission, "read", async (_tenantId, fn) => fn()],
    [audit, "record", async (_client, _context, result) => { const previous = saved.get(result.fingerprint); const record = previous || { id: uuid(9), fingerprint: result.fingerprint, provider_id: null }; saved.set(result.fingerprint, record); return { ...record, duplicate: Boolean(previous) }; }],
  ], async () => fn({ saved, setRows: rows => { nextRows = rows; }, setScope: selected => { current = selected; } }));
}

test("manual preview has no CC/send/scheduler; repeat is idempotent and subsequent approval removes line", async () => {
  await fixture(async ({ saved, setRows }) => {
    const one = await service.preview(context, input);
    const two = await service.preview(context, input);
    assert.equal(one.counts.open_rows, 1);
    assert.equal(two.audit.duplicate, true);
    assert.equal(saved.size, 1);
    assert.deepEqual(one.mail.cc, []);
    assert.equal(one.mail.delivery, "not_attempted");
    assert.equal(one.mail.sending_enabled, false);
    assert.equal(one.scheduler_enabled, false);
    setRows([row(1, { approvedBy: "DEP", approvedDate: "2026-10-22T20:00:00" })]);
    assert.equal((await service.preview(context, input)).mail.would_include, false);
  });
});

test("scope changes during EK read reject whole response before audit/data exposure", async () => {
  await fixture(async ({ saved, setScope }) => {
    await patches([[source, "capture", async () => { setScope({ user, projects: [other], bindings: [{ project_id: other.project_id, ek_project_id: "17636" }] }); return { rows: [row()] }; }]], async () => {
      await assert.rejects(service.preview(context, input), /scope_changed/);
      assert.equal(saved.size, 0);
    });
  });
});

test("audit storage serializes tenant/actor fingerprint and reuses record without inserts", async () => {
  const calls = []; let exists = false; let inserts = 0;
  let metadata;
  const client = { async query(sql, args) { calls.push([sql, args]); return { rows: /FROM audit_event/.test(sql) && exists ? [{ id: uuid(8), created_at: "2026-10-22", event_type: "approval_control.previewed", metadata }] : [] }; } };
  await patches([[auditService, "logAuditEvent", async args => { inserts++; assert.equal(args.tenantId, context.tenantId); assert.equal(args.eventType, "approval_control.previewed"); assert.equal(args.metadata.mail_attempted, false); metadata = args.metadata; exists = true; }]], async () => {
    const data = { ...summary([row()]), ...period, observed_at: "now", finished_at: "now", mail: { to: user.email }, source: {} };
    assert.equal((await audit.record(client, context, data)).duplicate, false);
    assert.equal((await audit.record(client, context, data)).duplicate, true);
    const changed = { ...data, fingerprint: "different" };
    assert.equal((await audit.record(client, context, changed)).duplicate, false);
    assert.equal((await audit.record(client, context, data)).duplicate, false, "A to B to A records latest observation, not old A");
    assert.equal((await audit.record(client, context, { ...data, observed_at: "new-source-observation" })).duplicate, false, "fresh capture has its own audit even if inventory is unchanged");
  });
  assert.equal(inserts, 4);
  assert(calls.some(([sql]) => sql.includes("pg_advisory_xact_lock(6120")));
  const find = calls.find(([sql]) => sql.includes("FROM audit_event"));
  assert.deepEqual(find[1], [context.tenantId, context.userId]);
});

test("status authorizes current mine but never exposes historical rows, totals or errors without interval preview", async () => {
  const client = { release() {}, async query(sql, args) { assert.match(sql, /tenant_id=\$1 AND actor_id=\$2/); assert.deepEqual(args, [context.tenantId, context.userId]); return { rows: [{ id: uuid(8), created_at: "2026-10-22", event_type: "approval_control.previewed", metadata: { pending: [{ project_id: project.project_id, hours: 7, date: "2026-10-12" }, { project_id: other.project_id, hours: 7, date: "2026-10-12" }], unknown: [{ project_id: other.project_id }], error_code: "historical_error" } }] }; } };
  await patches([[pool, "connect", async () => client], [scope, "loadMine", async () => ({ user, projects: [project], bindings: [binding] })]], async () => {
    const result = await service.status(context);
    assert.deepEqual(result.latest, { id: uuid(8), at: "2026-10-22", result: "preview_only" });
    assert.equal(result.mine_project_count, 1);
    assert.doesNotMatch(JSON.stringify(result), /historical_error|2026-10-12|pending|unknown|counts/);
  });
});

test("route rejects tenant mismatch and forged query before calling service, never trusts body actor", async () => {
  const express = require("../backend/node_modules/express");
  const authPath = require.resolve("../backend/src/middleware/requireAuth");
  const hostPath = require.resolve("../backend/src/middleware/requireTenantHost");
  const routePath = require.resolve("../backend/src/modules/approvalControl/approvalControl.routes");
  const originalAuth = require.cache[authPath], originalHost = require.cache[hostPath];
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: () => (_req, _res, next) => next() };
  require.cache[hostPath] = { id: hostPath, filename: hostPath, loaded: true, exports: (_req, _res, next) => next() };
  delete require.cache[routePath];
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.context = { tenant: { id: context.tenantId, slug: context.tenantSlug } }; req.auth = { sub: context.userId, tenant_id: req.headers["x-mismatch"] ? uuid(9) : context.tenantId }; next(); });
  app.use(require(routePath));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = http.createServer(app);
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/approval-control/preview`;
    await patches([[service, "preview", async (passed, body) => { assert.deepEqual(passed, context); service.request(body); return { mode: "preview" }; }]], async () => {
      const options = body => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      assert.equal((await fetch(url + "?scope=all", options(input))).status, 400);
      assert.equal((await fetch(url, { ...options(input), headers: { "Content-Type": "application/json", "x-mismatch": "true" } })).status, 403);
      assert.equal((await fetch(url, options({ ...input, user_id: uuid(7) }))).status, 400);
      assert.equal((await fetch(url, options(input))).status, 200);
    });
    const mailJob = require("../backend/src/modules/approvalControl/approvalControl.mailJob");
    await patches([[service, "status", async passed => { assert.deepEqual(passed, context); return { latest: null }; }],
      [mailJob, "status", async passed => { assert.deepEqual(passed, context); return { mail_enabled: false }; }],
      [mailJob, "getRun", async (passed, id) => { assert.deepEqual(passed, context); assert.equal(id, uuid(8)); return { id, pending: [] }; }]], async () => {
      const base = url.replace(/preview$/, "");
      assert.equal((await fetch(base + "status")).status, 200);
      assert.equal((await fetch(base + "status?scope=all")).status, 400);
      assert.equal((await fetch(base + "runs/" + uuid(8))).status, 200);
      assert.equal((await fetch(base + "runs/" + uuid(8) + "?project_id=forged")).status, 400);
      assert.equal((await fetch(base + "runs/" + uuid(8), { headers: { "x-mismatch": "true" } })).status, 403);
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (originalAuth) require.cache[authPath] = originalAuth; else delete require.cache[authPath];
    if (originalHost) require.cache[hostPath] = originalHost; else delete require.cache[hostPath];
    delete require.cache[routePath];
  }
});

test("migration only extends existing audit constraint and Timekontrol/sync/identity bytes are untouched", () => {
  const migration = fs.readFileSync("migrations/0062_approval_control_audit_events.sql", "utf8");
  assert.match(migration, /pg_get_expr\(conbin, conrelid\)/);
  assert.match(migration, /CHECK \(\(%s\) OR event_type IN/);
  assert.doesNotMatch(migration, /CREATE TABLE|UPDATE |INSERT INTO|DELETE FROM|time_control|tenant_user|fitter/i);
  for (const file of ["backend/src/services/syncWorker.js", "backend/src/services/fitterIdentityService.js", "backend/src/services/mailService.js", "backend/src/config/env.js", "backend/src/services/fielddeskEmailFrame.js", "backend/src/modules/notifications/emailOutbox.processor.js", "backend/src/modules/timeControl/timeControl.logic.js", "backend/src/modules/timeControl/timeControl.email.js", "backend/src/modules/timeControl/timeControl.scheduler.js", "backend/src/modules/timeControl/timeControl.routes.js", "backend/src/modules/timeControl/timeControl.operation.js"]) {
    const head = execFileSync("git", ["show", "HEAD:" + file]);
    const normalized = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    assert.equal(crypto.createHash("sha256").update(normalized).digest("hex"), crypto.createHash("sha256").update(head).digest("hex"), file);
  }
  const module = fs.readdirSync("backend/src/modules/approvalControl").map(name => fs.readFileSync("backend/src/modules/approvalControl/" + name, "utf8")).join("\n");
  assert.doesNotMatch(module, /timeControl\.|emailOutbox|setInterval|fetchEkProjectDetail|refreshProjectFitterhours/);
  assert.doesNotMatch(fs.readFileSync("backend/src/modules/approvalControl/approvalControl.service.js", "utf8"), /sendEmail|mailJob\.runDue/);
});
