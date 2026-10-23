"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");

const DATABASE_NAME = /^fielddesk_tc_validation_upgrade_[a-f0-9]{24}$/;
const FIRST = "approval_control.scheduler_activated";
const CONFIG = "approval_control_settings";
const failure = suffix => ({ statusCode: 409, message: "approval_control_" + suffix });

function localEndpoint(value) {
  const url = new URL(value);
  assert.equal(url.protocol, "postgres:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55432");
  assert.equal(url.username, "tc_validation");
  assert.equal(url.password, "");
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
  return url;
}
function templateUrl(value) {
  const url = localEndpoint(value);
  assert.match(url.pathname.slice(1), DATABASE_NAME);
  return url;
}
function quotedDatabase(value) {
  assert.match(value, DATABASE_NAME);
  return '"' + value + '"';
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const settled = promise => promise.then(value => ({ value }), error => ({ error }));
async function bounded(promise, label, timeoutMs = 2000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("fixture_timeout: " + label)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

test("approval admin PG target guard is pure and rejects unsafe targets", () => {
  const url = new URL("postgres://tc_validation@127.0.0.1:55432");
  url.pathname = "/fielddesk_tc_validation_upgrade_" + "a".repeat(24);
  assert.equal(templateUrl(url.toString()).toString(), url.toString());
  for (const [key, value] of [["protocol", "postgresql:"], ["hostname", "example.invalid"],
    ["hostname", "localhost"], ["port", "5432"], ["username", "postgres"], ["password", randomUUID()],
    ["search", "?host=example.invalid"], ["hash", "#fixture"], ["pathname", "/postgres"],
    ["pathname", url.pathname + "extra"]]) {
    const invalid = new URL(url);
    invalid[key] = value;
    assert.throws(() => templateUrl(invalid.toString()), { code: "ERR_ASSERTION" });
  }
  assert.throws(() => quotedDatabase('unsafe"name'), { code: "ERR_ASSERTION" });
  assert.throws(() => templateUrl(undefined));
});

// Clone an already migrated, quiescent LOCAL template. Never import a migration
// runner, read migration SQL, apply schema SQL, or start app/scheduler/collectors.
test("approval admin PG: existing-template clone, atomic control audit and actual send/pause locks", {
  skip: process.env.FIELD_DESK_APPROVAL_CONTROL_ADMIN_LOCAL_PG_TEST !== "1",
  timeout: 90000,
}, async t => {
  const sourceUrl = templateUrl(process.env.FIELDDESK_APPROVAL_CONTROL_TEST_DATABASE_URL);
  const sourceName = sourceUrl.pathname.slice(1);
  const { Client, Pool } = require("../backend/node_modules/pg");
  const connection = url => ({ connectionString: url.toString(), password: "", ssl: false,
    connectionTimeoutMillis: 3000, statement_timeout: 15000 });
  const protectedSnapshot = async client => {
    const { rows } = await client.query(`SELECT c.relname AS name FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND (c.relname ~ '^time_control_[a-z0-9_]+$' OR c.relname IN ('email_outbox','sync_job')) ORDER BY c.relname`);
    const snapshot = {};
    for (const { name } of rows) {
      assert.match(name, /^[a-z][a-z0-9_]*$/);
      snapshot[name] = (await client.query(`SELECT count(*)::int AS count,
        md5(coalesce(jsonb_agg(to_jsonb(fixture_row) ORDER BY to_jsonb(fixture_row)::text),'[]'::jsonb)::text) AS digest
        FROM public."${name}" AS fixture_row`)).rows[0];
    }
    assert.ok(Object.hasOwn(snapshot, "time_control_settings"));
    assert.ok(Object.hasOwn(snapshot, "email_outbox"));
    return snapshot;
  };
  const inspectSource = async () => {
    const client = new Client({ ...connection(sourceUrl), options: "-c default_transaction_read_only=on" });
    try {
      await client.connect();
      await client.query("BEGIN READ ONLY");
      assert.equal((await client.query("SHOW transaction_read_only")).rows[0].transaction_read_only, "on");
      const identity = await client.query("SELECT current_database() AS db,current_user AS actor,inet_server_port() AS port");
      assert.deepEqual(identity.rows[0], { db: sourceName, actor: "tc_validation", port: 55432 });
      const migrations = (await client.query("SELECT id,filename,checksum_sha256,success FROM schema_migration ORDER BY id")).rows;
      assert.equal(migrations.length, 65, "template must already contain all 65 successful migrations");
      assert.ok(migrations.every(row => row.success === true));
      assert.ok(migrations.some(row => row.id === "0065_operational_mail_routing"));
      assert.equal((await client.query("SELECT count(*)::int AS n FROM tenant WHERE lower(slug)='hoyrup-clemmensen'")).rows[0].n,
        0, "template contains HC: stop without altering the template or creating a clone");
      const protectedData = await protectedSnapshot(client);
      await client.query("COMMIT");
      return { migrations, protectedData };
    } finally { await client.end(); }
  };
  // inspectSource closes its template connection before CREATE DATABASE TEMPLATE.
  const sourceBefore = await inspectSource();
  const database = "fielddesk_tc_validation_upgrade_" + randomUUID().replaceAll("-", "").slice(0, 24);
  const adminUrl = localEndpoint(sourceUrl.toString());
  adminUrl.pathname = "/postgres";
  localEndpoint(adminUrl.toString());
  const admin = new Client(connection(adminUrl));
  try {
    await admin.connect();
    const identity = await admin.query("SELECT current_database() AS db,current_user AS actor,inet_server_port() AS port");
    assert.deepEqual(identity.rows[0], { db: "postgres", actor: "tc_validation", port: 55432 });
    await admin.query(`CREATE DATABASE ${quotedDatabase(database)} TEMPLATE ${quotedDatabase(sourceName)}`);
  } finally { await admin.end(); }
  const cloneUrl = new URL(sourceUrl);
  cloneUrl.pathname = "/" + database;
  templateUrl(cloneUrl.toString());
  t.diagnostic("Existing schema/data cloned without migration execution into " + database);

  const envKeys = ["NODE_ENV", "DATABASE_URL", "JWT_SECRET", "ROOT_DOMAIN", "MAIL_PROVIDER", "MAIL_FROM", "MAIL_REPLY_TO", "MAIL_API_KEY",
    "APPROVAL_CONTROL_SCHEDULER_ENABLED", "APPROVAL_CONTROL_MAIL_ENABLED", "APPROVAL_CONTROL_COVERAGE_FROM", "APPROVAL_CONTROL_FRIDAY_TIME"];
  const savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const fixtureDatabaseUrl = cloneUrl.toString(), fixtureSigningKey = randomUUID(), fixtureProviderKey = randomUUID();
  for (const key of envKeys.filter(key => key.startsWith("APPROVAL_CONTROL_"))) delete process.env[key];
  Object.assign(process.env, { NODE_ENV: "production", DATABASE_URL: fixtureDatabaseUrl, JWT_SECRET: fixtureSigningKey,
    ROOT_DOMAIN: "example.test", MAIL_PROVIDER: "resend", MAIL_FROM: "Fielddesk fixture <mail@example.test>",
    MAIL_REPLY_TO: "reply@example.test", MAIL_API_KEY: fixtureProviderKey });
  const originalFetch = global.fetch, originalDev = global.__DEV__;
  let forbiddenFetches = 0, forbiddenMail = 0;
  global.fetch = async () => { forbiddenFetches++; throw new Error("admin_pg_external_fetch_forbidden"); };
  const pool = new Pool({ ...connection(cloneUrl), max: 12, idle_in_transaction_session_timeout: 15000 });
  const restore = [];
  const patch = (object, key, value) => {
    const previous = object[key];
    restore.push(() => { object[key] = previous; });
    object[key] = value;
  };
  let appPool, ENV, savedConfig;
  try {
    assert.deepEqual((await pool.query("SELECT current_database() AS db,current_user AS actor,inet_server_port() AS port")).rows[0],
      { db: database, actor: "tc_validation", port: 55432 });
    assert.deepEqual(await protectedSnapshot(pool), sourceBefore.protectedData);
    assert.deepEqual((await pool.query("SELECT id,filename,checksum_sha256,success FROM schema_migration ORDER BY id")).rows, sourceBefore.migrations);
    ENV = require("../backend/src/config/env");
    savedConfig = { ...ENV };
    Object.assign(ENV, { NODE_ENV: "production", MAIL_PROVIDER: "resend", MAIL_FROM: process.env.MAIL_FROM,
      MAIL_REPLY_TO: process.env.MAIL_REPLY_TO, MAIL_API_KEY: fixtureProviderKey });
    appPool = require("../backend/src/db/pool");
    patch(appPool, "connect", () => pool.connect());
    const mail = require("../backend/src/services/mailService");
    patch(mail, "sendEmail", async () => { forbiddenMail++; throw new Error("admin_pg_provider_forbidden"); });
    const control = require("../backend/src/modules/approvalControl/approvalControl.control");
    const activation = require("../backend/src/modules/approvalControl/approvalControl.activation");
    const policy = require("../backend/src/modules/approvalControl/approvalControl.mailPolicy");
    const routing = require("../backend/src/modules/notifications/operationalMailRouting");
    const audit = require("../backend/src/services/auditService");
    const tenantId = randomUUID(), adminId = randomUUID(), depId = randomUUID(), foreignId = randomUUID(), foreignUserId = randomUUID();
    const fixturePasswordHash = randomUUID(), foreignSlug = "admin-foreign-" + randomUUID().slice(0, 8);
    await pool.query(`INSERT INTO tenant(id,slug,name,status) VALUES
      ($1,'hoyrup-clemmensen','HC admin fixture','active'),($2,$3,'Foreign admin fixture','active')`, [tenantId, foreignId, foreignSlug]);
    await pool.query(`INSERT INTO tenant_user(id,tenant_id,username,email,name,role,status,login_status,password_hash) VALUES
      ($1,$2,'adm','admin.fixture@example.test','Admin fixture','tenant_admin','active','active',$6),
      ($3,$2,'DEP','dep@hoyrup-clemmensen.dk','Existing DEP fixture','project_leader','active','active',$6),
      ($4,$5,'frgn','foreign@example.test','Foreign fixture','tenant_admin','active','active',$6)`,
    [adminId, tenantId, depId, foreignUserId, foreignId, fixturePasswordHash]);
    const actor = { tenantId, userId: adminId, tenantSlug: "hoyrup-clemmensen" };
    const dep = { ...actor, userId: depId };
    const events = async () => (await pool.query("SELECT * FROM audit_event WHERE tenant_id=$1 ORDER BY id", [tenantId])).rows;
    const configs = rows => rows.filter(row => row.event_type === "tenant_config_changed" && row.target_type === CONFIG);
    const request = (status, action = "activate", extra = {}) => ({ action, revision: status.revision,
      expected_local_date: status.today, mail_routing_revision: status.mail_routing_revision,
      confirm: action === "activate" ? "ACTIVATE:approval_control" : "PAUSE:approval_control", ...extra });
    const change = async action => control.change(actor, request(await control.status(actor), action));
    const futurePlan = (state, first) => {
      const now = new Date(Math.max(Date.now(), Date.parse(state.enabled_at) + 1000));
      const settings = policy.read(process.env, now, first, state);
      assert.equal(settings.configuration_valid, true);
      assert.equal(settings.schedule_valid, true);
      const at = policy.next(now, settings);
      assert.ok(at);
      const planned = policy.slot(new Date(at), settings);
      assert.ok(planned);
      assert.ok(Date.parse(planned.scheduled_at) > Date.parse(state.enabled_at));
      return planned;
    };
    const waitForWaiter = async mode => {
      const deadline = Date.now() + 1800;
      while (Date.now() < deadline) {
        const { rows } = await pool.query(`SELECT mode FROM pg_locks WHERE locktype='advisory'
          AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
          AND classid=6125 AND NOT granted AND mode=$1`, [mode]);
        if (rows.length) return;
        await delay(10);
      }
      assert.fail("6125 waiter not observed: " + mode);
    };
    let first;

    await t.test("inactive status, DB role/tenant isolation and transport preflight without first-date writes", async () => {
      const status = await control.status(actor);
      assert.equal(status.status, "inactive");
      assert.equal(status.revision, 0);
      assert.equal(status.coverage_from, null);
      assert.deepEqual(status.configuration_blockers, []);
      assert.deepEqual(status.recipients.to, ["dep@hoyrup-clemmensen.dk"]);
      assert.deepEqual(await control.change(actor, request(status, "pause")), status);
      for (const denied of [dep, { ...actor, userId: foreignUserId },
        { tenantId: foreignId, userId: foreignUserId, tenantSlug: foreignSlug },
        { tenantId: foreignId, userId: foreignUserId, tenantSlug: actor.tenantSlug }]) {
        await assert.rejects(control.status(denied), { statusCode: 403, message: "approval_control_control_access_denied" });
        await assert.rejects(control.change(denied, request(status)), { statusCode: 403 });
      }
      for (const key of ["MAIL_PROVIDER", "MAIL_FROM", "MAIL_REPLY_TO", "MAIL_API_KEY"]) {
        const previous = ENV[key];
        ENV[key] = null;
        try {
          const blocked = await control.status(actor);
          assert.ok(blocked.configuration_blockers.length > 0);
          assert.equal(JSON.stringify(blocked).includes(fixtureProviderKey), false);
          await assert.rejects(control.change(actor, request(blocked)), failure("control_configuration_blocked"));
        } finally { ENV[key] = previous; }
      }
      assert.equal(await activation.get(actor), null);
      assert.deepEqual(await events(), []);
    });

    await t.test("config audit failure rolls back the real first-activation and state inserts atomically", async () => {
      const originalLog = audit.logAuditEvent;
      let observedBoth = false;
      audit.logAuditEvent = async event => {
        await originalLog(event);
        if (event.tenantId === tenantId && event.resourceType === CONFIG) {
          const inside = await event.client.query("SELECT event_type,target_type FROM audit_event WHERE tenant_id=$1", [tenantId]);
          assert.equal(inside.rows.filter(row => row.event_type === FIRST).length, 1);
          assert.equal(inside.rows.filter(row => row.target_type === CONFIG).length, 1);
          observedBoth = true;
          throw new Error("fixture_config_audit_failure");
        }
      };
      try { await assert.rejects(change("activate"), /fixture_config_audit_failure/); }
      finally { audit.logAuditEvent = originalLog; }
      assert.equal(observedBoth, true);
      assert.equal(await activation.get(actor), null);
      assert.deepEqual(await events(), []);
      assert.equal((await control.status(actor)).status, "inactive");
      assert.equal(pool.idleCount, pool.totalCount);
    });

    await t.test("eight first-activation requests have one winner, one immutable DB-dated first and one state; noop preserves revision", async () => {
      const before = await control.status(actor), body = request(before);
      const earliest = (await pool.query("SELECT clock_timestamp()::text AS at")).rows[0].at;
      const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () => control.change(actor, body)));
      const latest = (await pool.query("SELECT clock_timestamp()::text AS at")).rows[0].at;
      assert.equal(outcomes.filter(value => value.status === "fulfilled").length, 1);
      for (const loser of outcomes.filter(value => value.status === "rejected")) {
        assert.equal(loser.reason.statusCode, 409);
        assert.equal(loser.reason.message, "approval_control_control_conflict");
      }
      const saved = await control.status(actor), state = await control.get(dep);
      first = await activation.get(actor);
      assert.equal(saved.status, "active");
      assert.equal(saved.revision, 1);
      assert.equal(saved.effective_active, true);
      assert.equal(state.activation_id, first.id);
      assert.equal(state.coverage_from, first.coverage_from);
      assert.equal(state.changed_at, state.enabled_at);
      const clockProof = (await pool.query(`SELECT $1::timestamptz BETWEEN $2::timestamptz AND $3::timestamptz AS bounded,
        to_char($1::timestamptz AT TIME ZONE 'Europe/Copenhagen','YYYY-MM-DD') AS day`, [first.activated_at, earliest, latest])).rows[0];
      assert.equal(clockProof.bounded, true);
      assert.equal(first.coverage_from, clockProof.day);
      const committed = await events();
      assert.equal(committed.filter(row => row.event_type === FIRST).length, 1);
      assert.equal(configs(committed).length, 1);
      const event = configs(committed)[0];
      assert.equal(event.actor_id, adminId);
      assert.equal(event.target_id, tenantId);
      assert.equal(event.metadata.module_key, "approval_control");
      assert.equal(event.metadata.before.revision, 0);
      assert.deepEqual(event.metadata.after, state);
      const noop = await control.change(actor, request(saved));
      assert.equal(noop.revision, saved.revision);
      assert.deepEqual(await control.get(actor), state);
      assert.deepEqual(await events(), committed);
      assert.deepEqual(await activation.get(actor), first);
    });

    await t.test("stale day/routing/control guards reject; pause works with blockers and resume preserves first date", async () => {
      const status = await control.status(actor), before = await events();
      for (const extra of [{ expected_local_date: "2000-01-01" }, { mail_routing_revision: status.mail_routing_revision + 1 }]) {
        await assert.rejects(control.change(actor, request(status, "pause", extra)), failure("control_confirmation_changed"));
      }
      await assert.rejects(control.change(actor, request(status, "pause", { revision: status.revision - 1 })), failure("control_conflict"));
      assert.deepEqual(await events(), before);
      await routing.save({ tenantId, actorId: adminId }, "approval_control_summary", { revision: status.mail_routing_revision,
        extra_cc_enabled: true, extra_cc_emails: "observer@example.test", extra_bcc_enabled: false, extra_bcc_emails: "" });
      const afterRouting = await events();
      await assert.rejects(control.change(actor, request(status, "pause")), failure("control_confirmation_changed"));
      assert.deepEqual(await events(), afterRouting);
      const previous = ENV.MAIL_API_KEY;
      ENV.MAIL_API_KEY = null;
      let paused;
      try {
        paused = await change("pause");
        assert.equal(paused.status, "paused");
        assert.ok(paused.configuration_blockers.length > 0);
        await assert.rejects(control.change(actor, request(paused)), failure("control_configuration_blocked"));
        assert.equal((await control.change(actor, request(paused, "pause"))).revision, paused.revision);
      } finally { ENV.MAIL_API_KEY = previous; }
      const resumed = await change("activate");
      assert.equal(resumed.revision, paused.revision + 1);
      assert.equal(resumed.coverage_from, first.coverage_from);
      assert.equal(resumed.activation_id, first.id);
      assert.deepEqual(await activation.get(actor), first);
    });

    await t.test("shared send lock spans callback await; pause times out with 409/no audit then succeeds after release", { timeout: 14000 }, async () => {
      const state = await control.get(dep), planned = futurePlan(state, first);
      const body = request(await control.status(actor), "pause"), before = await events();
      const entered = deferred(), release = deferred();
      let simulatedSends = 0, pausing;
      const sending = settled(control.withSendLock(dep, state, planned, first, async () => {
        entered.resolve();
        await release.promise;
        simulatedSends++;
        return "simulated_callback_only";
      }));
      let pauseResult;
      try {
        await bounded(entered.promise, "shared send callback entered");
        pausing = settled(control.change(actor, body));
        await waitForWaiter("ExclusiveLock");
        assert.equal(simulatedSends, 0);
        pauseResult = await bounded(pausing, "pause lock timeout", 6000);
        assert.equal(pauseResult.error?.statusCode, 409);
        assert.equal(pauseResult.error?.message, "approval_control_control_busy");
        assert.deepEqual(await events(), before);
        assert.deepEqual(await control.get(dep), state);
      } finally {
        release.resolve();
        const outcomes = await Promise.all([sending, ...(pausing ? [pausing] : [])]);
        assert.ifError(outcomes[0].error);
      }
      assert.equal(simulatedSends, 1);
      const paused = await change("pause");
      assert.equal(paused.revision, state.revision + 1);
      assert.equal(paused.status, "paused");
      assert.deepEqual(await activation.get(actor), first);
    });

    await t.test("exclusive pause blocks stale send before callback; resume never revives old generation but admits a new future slot", { timeout: 14000 }, async () => {
      await change("activate");
      const old = await control.get(dep), planned = futurePlan(old, first);
      const body = request(await control.status(actor), "pause"), before = await events();
      const written = deferred(), release = deferred(), originalLog = audit.logAuditEvent;
      let attempted = 0, sending;
      audit.logAuditEvent = async event => {
        await originalLog(event);
        if (event.tenantId === tenantId && event.resourceType === CONFIG && event.metadata.action === "pause") {
          written.resolve();
          await release.promise;
        }
      };
      const pausing = settled(control.change(actor, body));
      let pauseResult, sendResult;
      try {
        await bounded(written.promise, "pause audit inserted before commit");
        assert.deepEqual(await events(), before, "uncommitted pause audit must not be visible outside its transaction");
        sending = settled(control.withSendLock(dep, old, planned, first, async () => { attempted++; }));
        await waitForWaiter("ShareLock");
        assert.equal(attempted, 0);
      } finally {
        release.resolve();
        pauseResult = await pausing;
        if (sending) sendResult = await sending;
        audit.logAuditEvent = originalLog;
      }
      assert.ifError(pauseResult.error);
      assert.equal(pauseResult.value.status, "paused");
      assert.equal(sendResult.error?.message, "approval_control_control_changed");
      assert.equal(sendResult.error?.statusCode, 409);
      const resumed = await change("activate"), fresh = await control.get(dep);
      assert.ok(resumed.revision > old.revision);
      assert.deepEqual(await activation.get(actor), first);
      await assert.rejects(control.withSendLock(dep, old, planned, first, async () => { attempted++; }), failure("control_changed"));
      assert.equal(attempted, 0);
      await control.withSendLock(dep, fresh, futurePlan(fresh, first), first, async () => { attempted++; });
      assert.equal(attempted, 1);
      assert.equal(fresh.coverage_from, first.coverage_from);
      assert.equal((await events()).filter(row => row.event_type === FIRST).length, 1);
    });

    assert.equal(forbiddenFetches, 0);
    assert.equal(forbiddenMail, 0);
    assert.equal(pool.idleCount, pool.totalCount);
    assert.deepEqual(await protectedSnapshot(pool), sourceBefore.protectedData, "copied Timekontrol/outbox/sync data must remain untouched");
    assert.deepEqual((await pool.query("SELECT id,filename,checksum_sha256,success FROM schema_migration ORDER BY id")).rows, sourceBefore.migrations);
    assert.deepEqual(await inspectSource(), sourceBefore, "read-only template data/metadata must remain unchanged");
  } finally {
    restore.reverse().forEach(fn => fn());
    global.fetch = originalFetch;
    global.__DEV__ = originalDev;
    if (ENV && savedConfig) Object.assign(ENV, savedConfig);
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try { if (appPool) await appPool.end(); }
    finally { await pool.end(); }
  }
  // Keep the fresh clone for inspection, like the existing local integration fixtures.
});
