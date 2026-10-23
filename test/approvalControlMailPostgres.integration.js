"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const mailEvents = [
  "approval_control.mail_run_started",
  "approval_control.mail_attempt_started",
  "approval_control.mail_run_completed",
];

test("approval_control mail: actual migrations, durable concurrent claims and append-only tenant isolation", {
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
  const savedEnv = Object.fromEntries(["NODE_ENV", "DATABASE_URL", "JWT_SECRET", "ROOT_DOMAIN"]
    .map(key => [key, process.env[key]]));
  const fixtureDatabaseUrl = url.toString(), fixtureSigningKey = randomUUID();
  Object.assign(process.env, { NODE_ENV: "test", DATABASE_URL: fixtureDatabaseUrl,
    JWT_SECRET: fixtureSigningKey, ROOT_DOMAIN: "example.test" });
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error("External network forbidden in PostgreSQL fixtures"); };
  const pool = new Pool({ connectionString: url.toString(), ssl: false, max: 8 });
  let appPool, originalConnect;
  try {
    const schema = await pool.query("SELECT current_database() AS db, current_user AS actor, inet_server_port() AS port");
    assert.deepEqual(schema.rows[0], { db: database, actor: "tc_validation", port: 55432 });
    const runner = require("../backend/scripts/db_migrate");
    const files = runner.getMigrationFiles();
    const migration = files.find(file => file.filename === "0063_approval_control_mail_runs.sql");
    assert(migration, "the actual 0063 migration must be present");
    const client = await pool.connect();
    try {
      await runner.ensureMigrationTable(client);
      await runner.runPendingMigrations(client, files, new Map());
    } finally { client.release(); }

    const tenant = randomUUID(), foreign = randomUUID(), user = randomUUID(), otherUser = randomUUID(), foreignUser = randomUUID();
    await pool.query(`INSERT INTO tenant(id,slug,name,status)
      VALUES($1,'hoyrup-clemmensen','HC mail fixture','active'),($2,'foreign-mail-fixture','Foreign mail fixture','active')`, [tenant, foreign]);
    await pool.query(`INSERT INTO tenant_user(id,tenant_id,username,email,name,role,status,login_status,password_hash)
      VALUES($1,$2,'dep','dep@example.test','DEP fixture','tenant_admin','active','active','fixture'),
        ($3,$2,'oth','other@example.test','Other fixture','project_leader','active','active','fixture'),
        ($4,$5,'for','foreign@example.test','Foreign fixture','tenant_admin','active','active','fixture')`,
    [user, tenant, otherUser, foreignUser, foreign]);
    const context = { tenantId: tenant, userId: user };
    const otherContext = { tenantId: tenant, userId: otherUser };
    const foreignContext = { tenantId: foreign, userId: foreignUser };
    const metadata = {
      local_date: "2026-10-23", scheduled_at: "2026-10-23T05:00:00Z", started_at: "2026-10-23T05:00:01Z",
      time_zone: "Europe/Copenhagen", coverage_from: "2026-10-19", mode: "simulation",
    };
    const audit = require("../backend/src/services/auditService");
    for (const event of mailEvents) assert(audit.ALLOWED_EVENT_TYPES.includes(event), "main must whitelist " + event);
    appPool = require("../backend/src/db/pool");
    originalConnect = appPool.connect;
    appPool.connect = () => pool.connect();
    const repositoryPath = require.resolve("../backend/src/modules/approvalControl/approvalControl.mailRepository");
    let repository = require(repositoryPath);
    const rawEvent = (eventType, runId, data, overrides = {}) => pool.query(`
      INSERT INTO audit_event(tenant_id,actor_id,actor_scope,event_type,target_type,target_id,outcome,metadata)
      VALUES($1,$2,$3,$4,'approval_control_mail_run',$5,'success',$6::jsonb)
    `, [Object.hasOwn(overrides, "tenantId") ? overrides.tenantId : tenant,
      overrides.actorId || user, overrides.actorScope || "tenant", eventType,
      Object.hasOwn(overrides, "targetId") ? overrides.targetId : runId, JSON.stringify(data)]);
    const eventCount = async (ctx, runId, eventType) => (await pool.query(`
      SELECT count(*)::int AS n FROM audit_event
      WHERE tenant_id=$1 AND actor_id=$2 AND target_id=$3 AND event_type=$4
    `, [ctx.tenantId, ctx.userId, runId, eventType])).rows[0].n;

    let run;
    await t.test("claim once per tenant, actor, date and mode, preserving the original start", async () => {
      assert.equal(await repository.latest(context), null);
      assert.equal(await repository.get(context, randomUUID()), null);
      const claims = await Promise.all(Array.from({ length: 8 }, () => repository.claim(context, { ...metadata, run_id: "ignored" })));
      assert.equal(claims.filter(value => value.claimed).length, 1);
      run = claims[0].run;
      assert.match(run.id, /^[0-9a-f-]{36}$/);
      assert.equal(run.run_id, run.id);
      for (const value of claims) assert.deepEqual(value.run, run);
      for (const [key, value] of Object.entries(metadata)) assert.equal(run[key], value);
      assert.equal(await eventCount(context, run.id, mailEvents[0]), 1);
      const replay = await repository.claim(context, { ...metadata, scheduled_at: "changed", coverage_from: "changed" });
      assert.deepEqual(replay, { claimed: false, run });
      const latest = await repository.latest(context);
      assert.deepEqual(latest, { ...run, attempt: null, result: null });
      assert.deepEqual(await repository.get(context, run.id), latest);
      await assert.rejects(rawEvent(mailEvents[0], randomUUID(), { ...metadata, run_id: "duplicate-slot" }, { targetId: "duplicate-slot" }),
        error => error.code === "23505" && error.constraint === "ux_audit_approval_control_mail_run_slot");
    });

    await t.test("attempt is durable and permitted once even across repository reload", async () => {
      const attempts = await Promise.all(Array.from({ length: 8 }, () => repository.attempt(context, run.id, {
        run_id: "changed", local_date: "2020-01-01", mode: "live", provider: "fixture",
      })));
      assert.equal(attempts.filter(Boolean).length, 1);
      assert.equal(await eventCount(context, run.id, mailEvents[1]), 1);
      const saved = await repository.get(context, run.id);
      assert.equal(saved.attempt.run_id, run.id);
      assert.equal(saved.attempt.local_date, metadata.local_date);
      assert.equal(saved.attempt.mode, metadata.mode);
      assert.equal(saved.attempt.scheduled_at, metadata.scheduled_at);
      assert.equal(saved.attempt.provider, "fixture");
      assert.equal(saved.result, null);
      delete require.cache[repositoryPath];
      repository = require(repositoryPath);
      assert.equal(await repository.attempt(context, run.id, {}), false);
      await assert.rejects(rawEvent(mailEvents[1], run.id, saved.attempt),
        error => error.code === "23505" && error.constraint === "ux_audit_approval_control_mail_attempt");
    });

    await t.test("finish records one immutable completion and returns the existing result", async () => {
      const completions = await Promise.all(Array.from({ length: 8 }, (_, i) => repository.finish(context, run.id, {
        run_id: "changed", local_date: "2020-01-01", mode: "live", status: "simulated", fixture_result: i,
      })));
      for (const result of completions) assert.deepEqual(result, completions[0]);
      assert.equal(await eventCount(context, run.id, mailEvents[2]), 1);
      const saved = await repository.get(context, run.id);
      assert.equal(saved.result.run_id, run.id);
      assert.equal(saved.result.local_date, metadata.local_date);
      assert.equal(saved.result.mode, metadata.mode);
      assert.equal(saved.result.coverage_from, metadata.coverage_from);
      assert.equal(saved.result.status, "simulated");
      for (const [key, value] of Object.entries(run)) assert.deepEqual(saved[key], value);
      assert.deepEqual(await repository.finish(context, run.id, { status: "must_not_replace" }), saved.result);
      assert.deepEqual(await repository.latest(context), saved);
      await assert.rejects(rawEvent(mailEvents[2], run.id, saved.result),
        error => error.code === "23505" && error.constraint === "ux_audit_approval_control_mail_completed");
      const terminal = await repository.claim(context, { ...metadata, local_date: "2026-10-24" });
      await repository.finish(context, terminal.run.id, { status: "no_mail" });
      assert.equal(await repository.attempt(context, terminal.run.id), false);
    });

    await t.test("different dates, modes, tenants and actors have independent slots", async () => {
      const next = await repository.claim(context, { ...metadata, local_date: "2026-10-25" });
      const live = await repository.claim(context, { ...metadata, mode: "live" });
      const other = await repository.claim(otherContext, metadata);
      const elsewhere = await repository.claim(foreignContext, metadata);
      for (const claim of [next, live, other, elsewhere]) assert.equal(claim.claimed, true);
      assert.equal(new Set([run.id, next.run.id, live.run.id, other.run.id, elsewhere.run.id]).size, 5);
      assert.equal((await repository.latest(context)).id, live.run.id);
      assert.equal((await repository.latest(otherContext)).id, other.run.id);
      assert.equal((await repository.latest(foreignContext)).id, elsewhere.run.id);
    });

    await t.test("foreign tenant or actor cannot get, attempt or finish a run", async () => {
      const before = (await pool.query("SELECT * FROM audit_event ORDER BY id")).rows;
      for (const denied of [otherContext, foreignContext, { ...context, tenantId: foreign }]) {
        assert.equal(await repository.get(denied, run.id), null);
        assert.equal(await repository.attempt(denied, run.id, {}), false);
        assert.equal(await repository.finish(denied, run.id, { status: "forbidden" }), null);
      }
      const missing = randomUUID();
      assert.equal(await repository.attempt(context, missing), false);
      assert.equal(await repository.finish(context, missing, {}), null);
      assert.equal(await repository.latest({ ...context, userId: randomUUID() }), null);
      await assert.rejects(repository.claim({}, metadata), /context_required/);
      await assert.rejects(repository.get({ tenantId: tenant }, run.id), /context_required/);
      await assert.rejects(repository.claim(context, { ...metadata, local_date: "2026-02-30" }), /slot_invalid/);
      await assert.rejects(repository.claim(context, { ...metadata, mode: "preview" }), /slot_invalid/);
      assert.deepEqual((await pool.query("SELECT * FROM audit_event ORDER BY id")).rows, before);
    });

    await t.test("database guard rejects absent or invalid mail identity metadata for all three events", async () => {
      for (const event of mailEvents) {
        const id = randomUUID();
        const valid = { ...metadata, run_id: id, local_date: "2026-11-01" };
        const invalid = [
          {}, { ...valid, run_id: null }, { ...valid, run_id: " " }, { ...valid, run_id: 123 },
          { ...valid, local_date: null }, { ...valid, local_date: "2026-1-01" },
          { ...valid, local_date: "2026-13-01" }, { ...valid, local_date: "2026-11-00" },
          { ...valid, mode: null }, { ...valid, mode: "preview" },
        ];
        for (const field of ["run_id", "local_date", "mode"]) {
          const absent = { ...valid }; delete absent[field]; invalid.push(absent);
        }
        const guardError = error => error.code === "23514" && error.constraint === "ck_audit_event_approval_control_mail_run";
        for (const data of invalid) await assert.rejects(rawEvent(event, id, data), guardError);
        await assert.rejects(rawEvent(event, id, valid, { tenantId: null }), guardError);
        await assert.rejects(rawEvent(event, id, valid, { actorScope: "system" }), guardError);
        await assert.rejects(rawEvent(event, id, valid, { targetId: null }), guardError);
        await assert.rejects(rawEvent(event, id, valid, { targetId: randomUUID() }), guardError);
      }
    });

    await t.test("actual mail job uses durable claims once across concurrent workers, replay and module reload", async () => {
      // The real lifecycle query and mail builder both require the HC POC slug.
      await pool.query(`INSERT INTO tenant_domain(tenant_id,domain,verified,active)
        VALUES($1,'hoyrup-clemmensen.example.test',true,true)`, [tenant]);
      const project = { project_id: randomUUID(), tenant_id: tenant, external_project_ref: "80396-003", name: "Own mail fixture" };
      await pool.query(`INSERT INTO project_core(project_id,tenant_id,external_project_ref,name,status,is_closed,has_v4)
        VALUES($1,$2,$3,$4,'open',false,true)`, [project.project_id, tenant, project.external_project_ref, project.name]);
      const jobContext = { ...context, tenantSlug: "hoyrup-clemmensen" };
      const selected = { user: { id: user, tenant_id: tenant, username: "dep", status: "active", login_status: "active",
        email: "dep@hoyrup-clemmensen.dk" }, projects: [project], bindings: [{ project_id: project.project_id, ek_project_id: "25906" }] };
      const now = new Date("2026-11-03T13:30:00Z"), clock = () => new Date(now);
      const first = await require("../backend/src/modules/approvalControl/approvalControl.activation").recordFirst(jobContext);
      const controlState = { enabled: true, revision: 1, changed_at: first.activated_at, enabled_at: first.activated_at,
        activation_id: first.id, coverage_from: first.coverage_from };
      await audit.logAuditEvent({ client: pool, tenantId: tenant, actorId: user, actorScope: "tenant", moduleKey: "approval_control",
        eventType: "tenant_config_changed", resourceType: "approval_control_settings", resourceId: tenant,
        outcome: "success", metadata: { revision: 1, after: controlState } });
      const policyEnv = { APPROVAL_CONTROL_FRIDAY_TIME: "14:31",
        APPROVAL_CONTROL_SCHEDULER_ENABLED: "true", APPROVAL_CONTROL_MAIL_ENABLED: "true" };
      const row = { id: 701001, projectID: 25906, date: "2026-11-03T00:00:00", hours: 7.5,
        fitterID: 18, fitterName: "Mail fixture employee", approvedBy: null, approvedDate: null };
      const rows = [row, { ...row, id: 701002 }], ids = rows.map(value => String(value.id));
      const scope = require("../backend/src/modules/approvalControl/approvalControl.scope");
      const refresh = require("../backend/src/services/fitterhoursRefreshService");
      const source = require("../backend/src/modules/approvalControl/approvalControl.source");
      const policy = require("../backend/src/modules/approvalControl/approvalControl.mailPolicy");
      const ENV = require("../backend/src/config/env");
      const jobPath = require.resolve("../backend/src/modules/approvalControl/approvalControl.mailJob");
      const savedModules = new Map([jobPath, repositoryPath].map(key => [key, require.cache[key]]));
      const savedMocks = { loadMine: scope.loadMine, resolveTenantConfig: refresh.resolveTenantConfig, capture: source.capture };
      const savedMailEnv = Object.fromEntries(["NODE_ENV", "MAIL_PROVIDER", "MAIL_FROM", "MAIL_REPLY_TO"].map(key => [key, ENV[key]]));
      const forbiddenFetch = global.fetch, providerCalls = [];
      let captures = 0;
      try {
        assert.equal(ENV.ROOT_DOMAIN, "example.test");
        Object.assign(ENV, { NODE_ENV: "production", MAIL_PROVIDER: "resend", MAIL_FROM: "Fielddesk fixture <noreply@example.test>", MAIL_REPLY_TO: "reply@example.test" });
        scope.loadMine = async (client, ctx) => {
          assert.equal(typeof client.query, "function");
          assert.deepEqual(ctx, jobContext);
          return selected;
        };
        refresh.resolveTenantConfig = async (client, input) => {
          assert.equal(typeof client.query, "function");
          assert.deepEqual(input, { tenant });
          return { tenantId: tenant };
        };
        source.capture = async input => {
          captures++;
          assert.deepEqual(input, { config: { tenantId: tenant }, fromDate: first.coverage_from, toDate: "2026-11-03" });
          return { rows, observed_at: now.toISOString(), completed_at: now.toISOString(),
            endpoint: "/api/v4/paginatedfitterhours", requests: 2, passes: 2 };
        };
        const options = { mode: "live", clock, readPolicy: (activation, control) => policy.read(policyEnv, clock(), activation, control),
          sendEmailFn: async (message, sendOptions) => {
            providerCalls.push({ message, options: sendOptions });
            const committed = await repository.latest(jobContext);
            assert.equal(committed.attempt.mail_attempted, true, "attempt must commit before provider access");
            assert.equal(committed.result, null);
            assert.deepEqual(committed.attempt.pending.map(value => value.id), ids);
            assert.equal(committed.attempt.idempotency_key, sendOptions.idempotencyKey);
            assert.equal(sendOptions.timeoutMs, 15000);
            assert.equal(global.fetch, forbiddenFetch);
            return { provider: "resend", sent: true, providerMessageId: "fixture-pg-mail-receipt" };
          } };
        const job = require(jobPath);
        const executions = await Promise.all(Array.from({ length: 4 }, () => job.runDue(jobContext, options)));
        assert.equal(executions.filter(value => value.state === "duplicate").length, 3);
        const completed = executions.find(value => value.result?.state === "provider_accepted");
        assert(completed, "one real job must complete with the simulated provider receipt");
        for (const duplicate of executions.filter(value => value.state === "duplicate")) assert.equal(duplicate.run_id, completed.id);
        assert.equal(captures, 1);
        assert.equal(providerCalls.length, 1);
        const persisted = await repository.get(jobContext, completed.id);
        assert.deepEqual(persisted, completed);
        const idempotencyKey = `approval_control:${tenant}:${user}:2026-11-03`;
        assert.equal(persisted.local_date, "2026-11-03");
        assert.equal(persisted.time_zone, "Europe/Copenhagen");
        assert.equal(persisted.scheduled_at, now.toISOString());
        assert.equal(persisted.started_at, now.toISOString());
        assert.equal(persisted.coverage_from, first.coverage_from);
        assert.equal(persisted.activation_id, first.id);
        assert.equal(persisted.activated_at, first.activated_at);
        assert.equal(persisted.mode, "live");
        for (const data of [persisted.attempt, persisted.result]) {
          assert.equal(data.run_id, persisted.id);
          assert.equal(data.local_date, persisted.local_date);
          assert.equal(data.time_zone, persisted.time_zone);
          assert.equal(data.idempotency_key, idempotencyKey);
          assert.equal(data.mail_attempted, true);
          assert.deepEqual(data.pending.map(value => value.id), ids);
          assert.deepEqual(data.groups[0].rows.map(value => value.id), ids);
          assert.deepEqual(data.counts, { open_rows: 2, projects: 1, hours: 15, oldest_date: "2026-11-03" });
          assert.deepEqual(data.unknown, []);
        }
        assert.equal(persisted.attempt.provider_id, null);
        assert.equal(persisted.attempt.attempted_at, now.toISOString());
        assert.equal(persisted.result.provider_id, "fixture-pg-mail-receipt");
        assert.equal(persisted.result.completed_at, now.toISOString());
        assert.equal(providerCalls[0].options.idempotencyKey, idempotencyKey);
        assert.equal(providerCalls[0].message.to, selected.user.email);
        assert.deepEqual(providerCalls[0].message.cc, []);
        assert.equal(providerCalls[0].message.from, ENV.MAIL_FROM);
        assert.equal(providerCalls[0].message.replyTo, ENV.MAIL_REPLY_TO);
        assert(providerCalls[0].message.text.includes(`https://hoyrup-clemmensen.example.test/tenant/approval-control.html?run_id=${persisted.id}`));
        for (const event of mailEvents) assert.equal(await eventCount(context, persisted.id, event), 1);
        const admitted = await pool.query(`SELECT metadata FROM audit_event WHERE tenant_id=$1 AND actor_id=$2
          AND event_type='approval_control.capture_admitted'`, [tenant, user]);
        assert.equal(admitted.rows.length, 1, "the actual admission must record one capture");
        assert.equal(admitted.rows[0].metadata.started_at, now.toISOString());
        const beforeReplay = (await pool.query("SELECT * FROM audit_event WHERE tenant_id=$1 AND actor_id=$2 ORDER BY id", [tenant, user])).rows;
        assert.deepEqual(await job.runDue(jobContext, options), {
          state: "duplicate", reason: executions.find(value => value.state === "duplicate").reason, run_id: persisted.id,
        });
        delete require.cache[jobPath];
        delete require.cache[repositoryPath];
        const restarted = require(jobPath);
        const replay = await restarted.runDue(jobContext, options);
        assert.equal(replay.state, "duplicate");
        assert.equal(replay.run_id, persisted.id);
        assert.equal(captures, 1);
        assert.equal(providerCalls.length, 1);
        assert.deepEqual((await pool.query("SELECT * FROM audit_event WHERE tenant_id=$1 AND actor_id=$2 ORDER BY id", [tenant, user])).rows, beforeReplay);
        assert.deepEqual(await require(repositoryPath).get(jobContext, persisted.id), persisted);
        assert.equal(global.fetch, forbiddenFetch);
      } finally {
        scope.loadMine = savedMocks.loadMine;
        refresh.resolveTenantConfig = savedMocks.resolveTenantConfig;
        source.capture = savedMocks.capture;
        Object.assign(ENV, savedMailEnv);
        for (const [key, value] of savedModules) {
          if (value === undefined) delete require.cache[key];
          else require.cache[key] = value;
        }
      }
    });

    await t.test("audit remains append-only and previous event types are still accepted", async () => {
      await assert.rejects(pool.query("UPDATE audit_event SET metadata='{}' WHERE tenant_id=$1 AND actor_id=$2 AND target_id=$3", [tenant, user, run.id]), /append|immutable/i);
      await assert.rejects(pool.query("DELETE FROM audit_event WHERE tenant_id=$1 AND actor_id=$2 AND target_id=$3", [tenant, user, run.id]), /append|immutable/i);
      const previousTypes = audit.ALLOWED_EVENT_TYPES.filter(event => !mailEvents.includes(event) && event !== "approval_control.scheduler_activated");
      assert(previousTypes.includes("time_control.run_completed"));
      assert(previousTypes.includes("approval_control.previewed"));
      for (const event of previousTypes) await rawEvent(event, null, {});
      await assert.rejects(rawEvent("not_allowed", null, {}),
        error => error.code === "23514" && error.constraint === "ck_audit_event_event_type");
      const stored = await pool.query("SELECT DISTINCT event_type FROM audit_event WHERE tenant_id=$1 AND actor_id=$2", [tenant, user]);
      for (const event of previousTypes) assert(stored.rows.some(row => row.event_type === event));
      assert(stored.rows.some(row => row.event_type === "approval_control.scheduler_activated"));
    });

    await t.test("failed audit writes roll back each mutation and release the connection and lock", async () => {
      const failAfterWrite = async fn => {
        const originalLog = audit.logAuditEvent;
        audit.logAuditEvent = async event => {
          await originalLog(event);
          throw new Error("fixture_audit_failure");
        };
        try { await assert.rejects(fn(), /fixture_audit_failure/); }
        finally { audit.logAuditEvent = originalLog; }
        assert.equal(pool.idleCount, pool.totalCount, "all checked-out clients must be released");
      };
      const slot = { ...metadata, local_date: "2026-11-02" };
      const before = (await pool.query("SELECT * FROM audit_event ORDER BY id")).rows;
      await failAfterWrite(() => repository.claim(context, slot));
      assert.deepEqual((await pool.query("SELECT * FROM audit_event ORDER BY id")).rows, before);
      const claimed = await repository.claim(context, slot);
      assert.equal(claimed.claimed, true);
      await failAfterWrite(() => repository.attempt(context, claimed.run.id));
      assert.equal((await repository.get(context, claimed.run.id)).attempt, null);
      assert.equal(await repository.attempt(context, claimed.run.id), true);
      await failAfterWrite(() => repository.finish(context, claimed.run.id, { status: "failed_write" }));
      assert.equal((await repository.get(context, claimed.run.id)).result, null);
      assert.equal((await repository.finish(context, claimed.run.id, { status: "saved" })).status, "saved");
    });

    await t.test("repeating 0063 preserves every row, constraint and index and still prevents duplicates", async () => {
      const before = (await pool.query("SELECT * FROM audit_event ORDER BY id")).rows;
      const sql = fs.readFileSync(path.join(__dirname, "../migrations/0063_approval_control_mail_runs.sql"), "utf8");
      await pool.query(sql);
      await pool.query(sql);
      assert.deepEqual((await pool.query("SELECT * FROM audit_event ORDER BY id")).rows, before);
      const constraints = await pool.query(`SELECT conname, convalidated FROM pg_constraint
        WHERE conrelid='audit_event'::regclass
          AND conname IN ('ck_audit_event_event_type','ck_audit_event_approval_control_mail_run')`);
      assert.equal(constraints.rows.length, 2);
      assert(constraints.rows.every(row => row.convalidated));
      const indexes = await pool.query(`SELECT indexname FROM pg_indexes WHERE tablename='audit_event'
        AND indexname IN ('ux_audit_approval_control_mail_run_slot','ux_audit_approval_control_mail_attempt','ux_audit_approval_control_mail_completed')`);
      assert.equal(indexes.rows.length, 3);
      assert.deepEqual(await repository.claim(context, metadata), { claimed: false, run });
      assert.equal(await repository.attempt(context, run.id), false);
      assert.deepEqual(await repository.finish(context, run.id, { status: "changed" }), (await repository.get(context, run.id)).result);
      assert.deepEqual((await pool.query("SELECT * FROM audit_event ORDER BY id")).rows, before);
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
