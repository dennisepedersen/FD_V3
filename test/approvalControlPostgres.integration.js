"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");

test("approval_control: actual migration, canonical mine SQL, append-only audit and concurrent idempotence", {
  skip: process.env.FIELD_DESK_APPROVAL_CONTROL_LOCAL_PG_TEST !== "1", timeout: 90000,
}, async () => {
  const url = new URL(process.env.FIELDDESK_APPROVAL_CONTROL_TEST_DATABASE_URL || "postgres://example.invalid/blocked");
  assert.equal(url.protocol, "postgres:"); assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55432"); assert.equal(url.username, "tc_validation");
  assert.equal(url.password, ""); assert.equal(url.search, ""); assert.equal(url.hash, "");
  assert.match(url.pathname, /^\/fielddesk_tc_validation_upgrade_[a-f0-9]{24}$/);
  const { Client, Pool } = require("../backend/node_modules/pg");
  const database = "fielddesk_tc_validation_upgrade_" + randomUUID().replaceAll("-", "").slice(0, 24);
  const admin = new Client({ connectionString: url.toString(), ssl: false }); await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`); await admin.end();
  url.pathname = "/" + database;
  const connectionString = url.toString(), ephemeralSigningKey = randomUUID();
  Object.assign(process.env, { NODE_ENV: "test", DATABASE_URL: connectionString,
    JWT_SECRET: ephemeralSigningKey, ROOT_DOMAIN: "example.test" });
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error("External network forbidden in PostgreSQL fixtures"); };
  const pool = new Pool({ connectionString: url.toString(), ssl: false, max: 6 });
  try {
    const runner = require("../backend/scripts/db_migrate");
    const files = runner.getMigrationFiles();
    const client = await pool.connect();
    try { await runner.ensureMigrationTable(client); await runner.runPendingMigrations(client, files, new Map()); }
    finally { client.release(); }
    assert(files.some(file => file.filename === "0062_approval_control_audit_events.sql"));
    const schema = await pool.query("SELECT current_database() AS db, current_user AS actor, inet_server_port() AS port");
    assert.deepEqual(schema.rows[0], { db: database, actor: "tc_validation", port: 55432 });
    const hc = randomUUID(), foreign = randomUUID(), user = randomUUID(), project = randomUUID(), other = randomUUID();
    await pool.query("INSERT INTO tenant(id,slug,name,status) VALUES($1,'hoyrup-clemmensen','HC fixture','active'),($2,'foreign-fixture','Foreign','active')", [hc, foreign]);
    await pool.query("INSERT INTO tenant_user(id,tenant_id,username,email,name,role,status,login_status,password_hash) VALUES($1,$2,'dep','dep@example.test','DEP fixture','tenant_admin','active','active','fixture')", [user, hc]);
    await pool.query("INSERT INTO project_core(project_id,tenant_id,external_project_ref,name,status,is_closed,has_v4,responsible_code) VALUES($1,$3,'80396-003','Mine fixture','open',false,true,'DEP'),($2,$3,'9015','Other fixture','open',false,true,'LKE')", [project, other, hc]);
    const queries = require("../backend/src/db/queries/project");
    const scope = require("../backend/src/modules/approvalControl/approvalControl.scope");
    const ctx = { tenantId: hc, userId: user, tenantSlug: "hoyrup-clemmensen" };
    assert.deepEqual((await queries.listProjectsForUser(pool, ctx)).map(row => row.project_id), [project]);
    assert.deepEqual((await scope.loadMine(pool, ctx)).projects.map(row => row.project_id), [project]);
    await assert.rejects(scope.loadMine(pool, { ...ctx, projectId: other }), /project_not_found/);
    await assert.rejects(scope.loadMine(pool, { ...ctx, tenantId: foreign }), /access_denied/);
    const audit = require("../backend/src/modules/approvalControl/approvalControl.audit");
    const a = { fingerprint: "a".repeat(64), fromDate: "2026-10-12", toDate: "2026-10-16", observed_at: new Date().toISOString(), finished_at: new Date().toISOString(), mail: { to: "dep@example.test" }, source: {}, counts: { open_rows: 1 }, pending: [{ id: "1", project_id: project }], unknown: [], approved_count: 0 };
    const record = async result => { const c = await pool.connect(); try { return await audit.record(c, ctx, result); } finally { c.release(); } };
    const [one, two] = await Promise.all([record(a), record(a)]);
    assert.equal(one.id, two.id);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_event WHERE tenant_id=$1", [hc])).rows[0].n, 1);
    await record({ ...a, fingerprint: "b".repeat(64), pending: [], counts: { open_rows: 0 } });
    const again = await record(a); assert.notEqual(again.id, one.id);
    assert.equal((await audit.latest(pool, ctx)).metadata.fingerprint, a.fingerprint);
    assert.equal(await audit.latest(pool, { ...ctx, tenantId: foreign }), null);
    await assert.rejects(pool.query("UPDATE audit_event SET metadata='{}' WHERE tenant_id=$1", [hc]), /append|immutable/i);
    await pool.query("INSERT INTO audit_event(actor_id,actor_scope,tenant_id,event_type,target_type,outcome) VALUES($1,'tenant',$2,'time_control.run_completed','fixture','success')", [user, hc]);
    const counts = (await pool.query("SELECT count(*)::int AS n FROM audit_event")).rows[0].n;
    await pool.query(fs.readFileSync("migrations/0062_approval_control_audit_events.sql", "utf8"));
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_event")).rows[0].n, counts, "repeat migration does not rewrite rows");
    await assert.rejects(pool.query("INSERT INTO audit_event(actor_id,actor_scope,event_type,target_type,outcome) VALUES('fixture','system','not_allowed','fixture','success')"), /ck_audit_event_event_type/);
    const admission = require("../backend/src/modules/approvalControl/approvalControl.admission");
    const appPool = require("../backend/src/db/pool");
    try {
      await assert.rejects(admission.read(ctx, async () => assert.fail("cooldown must prevent source read"), new Date("2026-10-22T20:00:00Z")), /preview_cooldown/);
      const foreignContext = { tenantId: foreign, userId: user };
      await admission.read(foreignContext, async () => {}, new Date("2026-10-22T20:00:00Z"));
      await assert.rejects(admission.read(foreignContext, async () => assert.fail("must respect per-attempt cooldown"), new Date("2026-10-22T20:00:00Z")), /preview_cooldown/);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_event WHERE tenant_id=$1 AND event_type='approval_control.capture_admitted'", [foreign])).rows[0].n, 1);
    }
    finally { await appPool.end(); }
  } finally { global.fetch = originalFetch; await pool.end(); }
});
