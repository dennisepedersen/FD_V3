"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const eventType = "approval_control.scheduler_activated";
const guardName = "ck_audit_event_approval_control_activation";
const indexName = "ux_audit_approval_control_first_activation";

function copenhagenDate(timestamp) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

test("approval_control activation: database clock, tenant first-write persistence and immutable audit", {
  skip: process.env.FIELD_DESK_APPROVAL_CONTROL_LOCAL_PG_TEST !== "1", timeout: 90000,
}, async t => {
  const url = new URL(process.env.FIELDDESK_APPROVAL_CONTROL_TEST_DATABASE_URL || "postgres://example.invalid/blocked");
  assert.equal(url.protocol, "postgres:"); assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55432"); assert.equal(url.username, "tc_validation");
  assert.equal(url.password, ""); assert.equal(url.search, ""); assert.equal(url.hash, "");
  assert.match(url.pathname, /^\/fielddesk_tc_validation_upgrade_[a-f0-9]{24}$/);

  const { Client, Pool } = require("../backend/node_modules/pg");
  const database = "fielddesk_tc_validation_upgrade_" + randomUUID().replaceAll("-", "").slice(0, 24);
  const admin = new Client({ connectionString: url.toString(), ssl: false });
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally { await admin.end(); }
  url.pathname = "/" + database;
  const savedEnv = Object.fromEntries(["NODE_ENV", "DATABASE_URL", "JWT_SECRET", "ROOT_DOMAIN", "COVERAGE_FROM"]
    .map(key => [key, process.env[key]]));
  const fixtureDatabaseUrl = url.toString(), fixtureSigningKey = randomUUID();
  Object.assign(process.env, { NODE_ENV: "test", DATABASE_URL: fixtureDatabaseUrl,
    JWT_SECRET: fixtureSigningKey, ROOT_DOMAIN: "example.test", COVERAGE_FROM: "ignored-environment-date" });
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error("External network forbidden in PostgreSQL fixtures"); };
  const pool = new Pool({ connectionString: url.toString(), ssl: false, max: 8 });
  let appPool, originalConnect;
  try {
    const identity = await pool.query("SELECT current_database() AS db, current_user AS actor, inet_server_port() AS port");
    assert.deepEqual(identity.rows[0], { db: database, actor: "tc_validation", port: 55432 });
    const runner = require("../backend/scripts/db_migrate");
    const files = runner.getMigrationFiles();
    assert.equal(files.length, 65, "65 actual migrations exist; activation regression deliberately tests 0064 separately");
    const migration = files.find(file => file.filename === "0064_approval_control_scheduler_activation.sql");
    assert(migration, "the actual 0064 migration must be present");
    const client = await pool.connect();
    let previousTypes;
    try {
      await runner.ensureMigrationTable(client);
      await runner.runPendingMigrations(client, files.filter(file => file.sequence < "0064"), new Map());
      previousTypes = (await client.query(`
        SELECT DISTINCT literal[1] AS event_type FROM pg_constraint,
          LATERAL regexp_matches(pg_get_expr(conbin, conrelid), '''([^'']+)''', 'g') AS literal
        WHERE conrelid = 'audit_event'::regclass AND conname = 'ck_audit_event_event_type'
      `)).rows.map(row => row.event_type);
      assert(previousTypes.includes("approval_control.mail_run_started"));
      await runner.runPendingMigrations(client, [migration], new Map());
    } finally { client.release(); }

    const tenant = randomUUID(), foreign = randomUUID(), guardTenant = randomUUID(), rollbackTenant = randomUUID();
    const user = randomUUID(), otherUser = randomUUID(), foreignUser = randomUUID();
    await pool.query(`INSERT INTO tenant(id,slug,name,status) VALUES
      ($1,'hoyrup-clemmensen','HC activation fixture','active'),
      ($2,'foreign-activation','Foreign activation fixture','active'),
      ($3,'activation-guard','Activation guard fixture','active'),
      ($4,'activation-rollback','Activation rollback fixture','active')`, [tenant, foreign, guardTenant, rollbackTenant]);
    await pool.query(`INSERT INTO tenant_user(id,tenant_id,username,email,name,role,status,login_status,password_hash)
      VALUES($1,$2,'dep','dep@example.test','DEP fixture','tenant_admin','active','active','fixture'),
        ($3,$2,'oth','other@example.test','Other fixture','project_leader','active','active','fixture'),
        ($4,$5,'for','foreign@example.test','Foreign fixture','tenant_admin','active','active','fixture')`,
    [user, tenant, otherUser, foreignUser, foreign]);
    const context = { tenantId: tenant, userId: user };
    const otherContext = { tenantId: tenant, userId: otherUser };
    const foreignContext = { tenantId: foreign, userId: foreignUser };
    const audit = require("../backend/src/services/auditService");
    assert(audit.ALLOWED_EVENT_TYPES.includes(eventType), "MAIN must whitelist the activation event");
    appPool = require("../backend/src/db/pool");
    originalConnect = appPool.connect;
    appPool.connect = () => pool.connect();
    const modulePath = require.resolve("../backend/src/modules/approvalControl/approvalControl.activation");
    let activation = require(modulePath);
    const rawEvent = (type, data, overrides = {}) => pool.query(`
      INSERT INTO audit_event(tenant_id,actor_id,actor_scope,event_type,target_type,target_id,outcome,metadata)
      VALUES($1,$2,$3,$4,'approval_control_scheduler',$5,'success',$6::jsonb)
    `, [Object.hasOwn(overrides, "tenantId") ? overrides.tenantId : guardTenant,
      overrides.actorId || user, overrides.actorScope || "tenant", type,
      overrides.targetId || guardTenant, JSON.stringify(data)]);
    const count = async tenantId => (await pool.query(`SELECT count(*)::int AS n FROM audit_event
      WHERE tenant_id=$1 AND event_type=$2`, [tenantId, eventType])).rows[0].n;
    const snapshot = async () => (await pool.query("SELECT * FROM audit_event ORDER BY id")).rows;
    let first;

    await t.test("eight concurrent actors persist one activation from the actual database clock", async () => {
      assert.equal(await activation.get(context), null);
      assert.equal(await activation.get(otherContext), null);
      const before = (await pool.query("SELECT clock_timestamp()::text AS instant")).rows[0].instant;
      const suppliedDate = new Date(new Date(before).valueOf() - 30 * 86400000).toISOString().slice(0, 10);
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => activation.recordFirst({
        ...(i % 2 ? otherContext : context), coverage_from: suppliedDate, coverageFrom: suppliedDate,
        activated_at: suppliedDate, environment: "simulation", time_zone: "UTC",
      }, { coverage_from: suppliedDate, activated_at: suppliedDate })));
      const after = (await pool.query("SELECT clock_timestamp()::text AS instant")).rows[0].instant;
      first = results[0];
      for (const result of results) assert.deepEqual(result, first);
      assert.equal(await count(tenant), 1);
      assert.equal(first.tenant_id, tenant);
      assert.match(first.id, /^[0-9a-f-]{36}$/);
      assert.match(first.activated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
      assert.equal(first.coverage_from, copenhagenDate(first.activated_at));
      assert.notEqual(first.coverage_from, suppliedDate);
      assert.equal(first.environment, "production");
      assert.equal(first.time_zone, "Europe/Copenhagen");
      const persisted = (await pool.query(`SELECT actor_id, actor_scope, target_type, target_id, metadata,
        (metadata->>'activated_at')::timestamptz BETWEEN $2::timestamptz AND $3::timestamptz AS within_clock
        FROM audit_event WHERE tenant_id=$1 AND event_type=$4`, [tenant, before, after, eventType])).rows[0];
      assert.equal(persisted.within_clock, true);
      assert([user, otherUser].includes(persisted.actor_id));
      assert.equal(persisted.actor_scope, "tenant");
      assert.equal(persisted.target_type, "approval_control_scheduler");
      assert.equal(persisted.target_id, tenant);
      assert.equal(persisted.metadata.module_key, "approval_control");
      assert.deepEqual(first, { id: first.id, tenant_id: tenant, ...persisted.metadata });
      for (const key of ["actor_id", "userId", "email", "name"]) assert.equal(Object.hasOwn(first, key), false);
      await assert.rejects(rawEvent(eventType, persisted.metadata, { tenantId: tenant, actorId: otherUser }),
        error => error.code === "23505" && error.constraint === indexName);
    });

    await t.test("replay, actor changes and module reload retain the same first activation", async () => {
      const before = await snapshot();
      assert.deepEqual(await activation.get(otherContext), first);
      assert.deepEqual(await activation.recordFirst({ ...otherContext, status: "paused", coverage_from: "ignored" }), first);
      delete require.cache[modulePath];
      activation = require(modulePath);
      assert.deepEqual(await activation.recordFirst({ ...context, status: "active", activated_at: "ignored" }), first);
      assert.deepEqual(await activation.recordFirst({ ...context, tenantId: tenant.toUpperCase() }), first);
      assert.deepEqual(await activation.get(context), first);
      assert.deepEqual(await snapshot(), before);
    });

    await t.test("another tenant sees no activation and obtains its own independent record", async () => {
      assert.equal(await activation.get(foreignContext), null);
      assert.equal(await activation.get({ ...context, tenantId: foreign }), null);
      const elsewhere = await activation.recordFirst(foreignContext);
      assert.notEqual(elsewhere.id, first.id);
      assert.equal(elsewhere.tenant_id, foreign);
      assert.equal(elsewhere.coverage_from, copenhagenDate(elsewhere.activated_at));
      assert.deepEqual(await activation.get(foreignContext), elsewhere);
      assert.deepEqual(await activation.get(context), first);
      assert.equal(await count(tenant), 1);
      assert.equal(await count(foreign), 1);
      for (const invalid of [null, {}, { tenantId: tenant }, { userId: user },
        { ...context, tenantId: " " }, { ...context, userId: "not-a-uuid" }]) {
        await assert.rejects(activation.get(invalid), /activation_context_required/);
        await assert.rejects(activation.recordFirst(invalid), /activation_context_required/);
      }
    });

    await t.test("append-only audit prevents changing or deleting the first activation", async () => {
      await assert.rejects(pool.query("UPDATE audit_event SET metadata='{}' WHERE tenant_id=$1 AND id=$2", [tenant, first.id]), /append|immutable/i);
      await assert.rejects(pool.query("DELETE FROM audit_event WHERE tenant_id=$1 AND id=$2", [tenant, first.id]), /append|immutable/i);
      assert.deepEqual(await activation.get(context), first);
    });

    await t.test("activation guard rejects missing, invalid and mismatched metadata", async () => {
      const valid = { activated_at: first.activated_at, coverage_from: first.coverage_from,
        time_zone: first.time_zone, environment: first.environment };
      const invalid = [{}, { ...valid, environment: "simulation" }, { ...valid, environment: null },
        { ...valid, time_zone: "UTC" }, { ...valid, time_zone: null },
        { ...valid, activated_at: null }, { ...valid, activated_at: 123 },
        { ...valid, activated_at: "not-a-timestamp" }, { ...valid, activated_at: "infinity" },
        { ...valid, activated_at: first.activated_at.slice(0, 4) + "-02-30T12:00:00Z" },
        { ...valid, activated_at: first.activated_at.slice(0, -1) },
        { ...valid, coverage_from: null }, { ...valid, coverage_from: 123 },
        { ...valid, coverage_from: "not-a-date" }, { ...valid, coverage_from: first.coverage_from + " " },
        { ...valid, coverage_from: first.coverage_from.slice(0, 4) + "-13-01" },
        { ...valid, coverage_from: copenhagenDate(new Date(first.activated_at).valueOf() - 86400000) }];
      for (const key of Object.keys(valid)) {
        const absent = { ...valid }; delete absent[key]; invalid.push(absent);
      }
      const invalidError = error => (error.code === "23514" && error.constraint === guardName)
        || ["22007", "22008"].includes(error.code);
      for (const data of invalid) await assert.rejects(rawEvent(eventType, data), invalidError);
      await assert.rejects(rawEvent(eventType, valid, { tenantId: null }), invalidError);
      for (const actorScope of ["system", "global"]) {
        await assert.rejects(rawEvent(eventType, valid, { actorScope }), invalidError);
      }
      assert.equal(await count(guardTenant), 0);
    });

    await t.test("audit failure rolls back the insert, releases the client and permits retry", async () => {
      const rollbackContext = { tenantId: rollbackTenant, userId: user };
      const originalLog = audit.logAuditEvent;
      audit.logAuditEvent = async options => { await originalLog(options); throw new Error("fixture_after_insert"); };
      try { await assert.rejects(activation.recordFirst(rollbackContext), /fixture_after_insert/); }
      finally { audit.logAuditEvent = originalLog; }
      assert.equal(await activation.get(rollbackContext), null);
      assert.equal(await count(rollbackTenant), 0);
      assert.equal(pool.idleCount, pool.totalCount, "all checked-out clients are released after rollback");
      const saved = await activation.recordFirst(rollbackContext);
      assert.deepEqual(await activation.get(rollbackContext), saved);
      assert.equal(await count(rollbackTenant), 1);
    });

    await t.test("all previous event types remain accepted using their existing metadata contracts", async () => {
      assert(previousTypes.length > 100);
      for (const type of previousTypes) {
        const runId = randomUUID();
        const metadata = type.startsWith("approval_control.mail_")
          ? { run_id: runId, local_date: first.coverage_from, mode: "simulation" }
          : { activated_at: "irrelevant-invalid-timestamp", coverage_from: "irrelevant-invalid-date" };
        await rawEvent(type, metadata, { targetId: runId });
      }
      await assert.rejects(rawEvent("fixture.unknown_event", {}),
        error => error.code === "23514" && error.constraint === "ck_audit_event_event_type");
    });

    await t.test("repeating 0064 preserves rows, validated constraints and tenant uniqueness", async () => {
      const before = await snapshot();
      const sql = fs.readFileSync(path.join(__dirname, "../migrations/0064_approval_control_scheduler_activation.sql"), "utf8");
      await pool.query(sql);
      await pool.query(sql);
      assert.deepEqual(await snapshot(), before);
      const constraints = (await pool.query(`SELECT conname, convalidated FROM pg_constraint
        WHERE conrelid='audit_event'::regclass
          AND conname IN ('ck_audit_event_event_type','ck_audit_event_approval_control_activation')`)).rows;
      assert.equal(constraints.length, 2);
      assert(constraints.every(row => row.convalidated));
      const index = (await pool.query(`SELECT indexdef FROM pg_indexes
        WHERE tablename='audit_event' AND indexname=$1`, [indexName])).rows;
      assert.equal(index.length, 1);
      assert.match(index[0].indexdef, /UNIQUE INDEX.*\(tenant_id\).*approval_control\.scheduler_activated/);
      assert.deepEqual(await activation.recordFirst(otherContext), first);
      await assert.rejects(rawEvent(eventType, first, { tenantId: tenant, actorId: otherUser }),
        error => error.code === "23505" && error.constraint === indexName);
      assert.deepEqual(await snapshot(), before);
    });
  } finally {
    if (appPool) appPool.connect = originalConnect;
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try { if (appPool) await appPool.end(); }
    finally { await pool.end(); }
  }
});
