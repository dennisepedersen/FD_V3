"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");

function guardedUrl(value) {
  const url = new URL(value);
  assert.equal(url.protocol, "postgres:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55432");
  assert.equal(url.username, "tc_validation");
  assert.equal(url.password, "");
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
  assert.match(url.pathname, /^\/fielddesk_tc_validation_upgrade_[a-f0-9]{24}$/);
  return url;
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function bounded(promise, label, timeoutMs = 2000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("fixture_timeout: " + label)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

const settled = promise => promise.then(value => ({ value }), error => ({ error }));
const json = value => JSON.parse(JSON.stringify(value));
const changed = { statusCode: 409, message: "operational_mail_routing_changed" };

test("operational routing PostgreSQL target guard rejects unsafe connection options without connecting", () => {
  const local = new URL("postgres://tc_validation@127.0.0.1:55432");
  local.pathname = "/fielddesk_tc_validation_upgrade_" + "a".repeat(24);
  assert.equal(guardedUrl(local.toString()).toString(), local.toString());
  for (const [key, value] of [
    ["protocol", "postgresql:"], ["hostname", "example.invalid"], ["hostname", "localhost"],
    ["port", "5432"], ["username", "postgres"], ["password", randomUUID()],
    ["pathname", "/postgres"], ["pathname", local.pathname + "extra"],
    ["pathname", local.pathname.toUpperCase()], ["search", "?host=example.invalid"], ["hash", "#fixture"],
  ]) {
    const unsafe = new URL(local);
    unsafe[key] = value;
    assert.throws(() => guardedUrl(unsafe.toString()), { code: "ERR_ASSERTION" });
  }
  assert.throws(() => guardedUrl("https://example.invalid"), { code: "ERR_ASSERTION" });
  assert.throws(() => guardedUrl("not-a-url"), { code: "ERR_INVALID_URL" });
});

test("operational routing: actual 0065 migration, tenant authorization, audit, queued snapshots and send/save locks", {
  skip: process.env.FIELD_DESK_APPROVAL_CONTROL_LOCAL_PG_TEST !== "1",
  timeout: 90000,
}, async t => {
  const blockedUrl = "postgres://example.invalid/blocked";
  const url = guardedUrl(process.env.FIELDDESK_APPROVAL_CONTROL_TEST_DATABASE_URL || blockedUrl);
  const { Client, Pool } = require("../backend/node_modules/pg");
  const database = "fielddesk_tc_validation_upgrade_" + randomUUID().replaceAll("-", "").slice(0, 24);
  const admin = new Client({ connectionString: url.toString(), ssl: false, connectionTimeoutMillis: 3000 });
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally { await admin.end(); }
  url.pathname = "/" + database;
  guardedUrl(url.toString());
  t.diagnostic("Fresh local fixture database: " + database);

  const savedEnv = Object.fromEntries(["NODE_ENV", "DATABASE_URL", "JWT_SECRET", "ROOT_DOMAIN"]
    .map(key => [key, process.env[key]]));
  const fixtureDatabaseUrl = url.toString(), fixtureSigningKey = randomUUID();
  Object.assign(process.env, { NODE_ENV: "test", DATABASE_URL: fixtureDatabaseUrl,
    JWT_SECRET: fixtureSigningKey, ROOT_DOMAIN: "example.test" });
  const originalFetch = global.fetch;
  let forbiddenFetches = 0;
  global.fetch = async () => {
    forbiddenFetches++;
    throw new Error("External network forbidden in operational routing PostgreSQL fixtures");
  };
  const pool = new Pool({ connectionString: url.toString(), ssl: false, max: 8,
    connectionTimeoutMillis: 3000, statement_timeout: 15000, idle_in_transaction_session_timeout: 10000 });
  let appPool, originalConnect;
  try {
    const identity = await pool.query("SELECT current_database() AS db, current_user AS actor, inet_server_port() AS port");
    assert.deepEqual(identity.rows[0], { db: database, actor: "tc_validation", port: 55432 });
    const runner = require("../backend/scripts/db_migrate");
    const files = runner.getMigrationFiles();
    assert.equal(files.length, 65, "apply all actual migration files, including the historical duplicate 0002");
    assert.equal(files.at(-1).filename, "0065_operational_mail_routing.sql");
    const migrate = async (migrations) => {
      const client = await pool.connect();
      try {
        await runner.ensureMigrationTable(client);
        await runner.runPendingMigrations(client, migrations, await runner.getAppliedMap(client));
      } finally { client.release(); }
    };
    await migrate(files.slice(0, -1));

    const tenantId = randomUUID(), foreignId = randomUUID();
    const actorId = randomUUID(), nonadminId = randomUUID(), foreignAdminId = randomUUID();
    const fixturePasswordHash = randomUUID();
    await pool.query(`INSERT INTO tenant(id,slug,name,status) VALUES
      ($1,'hoyrup-clemmensen','HC routing fixture','active'),
      ($2,'foreign-routing-fixture','Foreign routing fixture','active')`, [tenantId, foreignId]);
    await pool.query(`INSERT INTO tenant_user(id,tenant_id,username,email,name,role,status,login_status,password_hash) VALUES
      ($1,$2,'dep','dep@example.test','HC admin','tenant_admin','active','active',$6),
      ($3,$2,'wrk','worker@example.test','HC employee','technician','active','active',$6),
      ($4,$5,'frgn','foreign@example.test','Foreign admin','tenant_admin','active','active',$6)`,
    [actorId, tenantId, nonadminId, foreignAdminId, foreignId, fixturePasswordHash]);
    const context = { tenantId, actorId }, foreignContext = { tenantId: foreignId, actorId: foreignAdminId };
    const preMigration = (await pool.query("SELECT * FROM time_control_settings ORDER BY tenant_id")).rows;
    await migrate(files);
    const applied = await runner.getAppliedMap(pool);
    assert.equal(applied.size, files.length);
    for (const file of files) {
      assert.equal(applied.get(file.id).success, true);
      assert.equal(applied.get(file.id).checksum_sha256, file.checksum);
      assert.equal(applied.get(file.id).execution_mode, "applied");
    }
    assert.deepEqual((await pool.query("SELECT * FROM time_control_settings ORDER BY tenant_id")).rows, preMigration);

    appPool = require("../backend/src/db/pool");
    originalConnect = appPool.connect;
    appPool.connect = () => pool.connect();
    const routing = require("../backend/src/modules/notifications/operationalMailRouting");
    const audit = require("../backend/src/services/auditService");
    const outbox = require("../backend/src/modules/notifications/emailOutbox.repository");
    const types = ["time_control_missing_hours", "time_control_friday_status", "approval_control_summary"];
    const audits = async () => (await pool.query("SELECT * FROM audit_event ORDER BY id")).rows;
    const settings = async () => (await pool.query("SELECT * FROM tenant_operational_mail_routing ORDER BY tenant_id,mail_type")).rows;
    const current = async (mailType, ctx = context) => (await routing.list(ctx)).find(row => row.mail_type === mailType);
    const desired = (revision, cc = "", bcc = "", enabled = true) => ({ revision,
      extra_cc_enabled: enabled && Boolean(cc), extra_cc_emails: cc,
      extra_bcc_enabled: enabled && Boolean(bcc), extra_bcc_emails: bcc });
    const save = async (mailType, cc, bcc, enabled = true, ctx = context) =>
      routing.save(ctx, mailType, desired((await current(mailType, ctx)).revision, cc, bcc, enabled));
    const transaction = async (fn, rollback = false) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query(rollback ? "ROLLBACK" : "COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    };
    const validate = input => transaction(client => routing.validateQueued(client, input));
    const originalTo = "employee@example.test", originalCc = ["original.cc@example.test"];
    const compose = (mailType, ctx = context) => routing.composeWithPool({ tenantId: ctx.tenantId,
      mailType, to: originalTo, cc: originalCc });
    const queuedInput = (mailType, route, row = null) => ({ tenantId, mailType, to: originalTo, cc: originalCc,
      queuedTo: row ? row.recipient_email : route.to,
      queuedCc: row ? row.payload_json.cc_emails : route.cc,
      queuedBcc: row ? row.payload_json.bcc_emails : route.bcc,
      snapshot: row ? row.payload_json.mail_routing : route.snapshot });
    const messageLock = (route, send) => routing.withMessageLock({ tenantId, route, baseCc: originalCc,
      message: { to: route.to, cc: route.cc, bcc: route.bcc } }, send);
    const waitForWaiter = async mode => {
      const deadline = Date.now() + 1800;
      while (Date.now() < deadline) {
        const { rows } = await pool.query(`SELECT mode FROM pg_locks WHERE locktype='advisory'
          AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
          AND classid=6124 AND NOT granted AND mode=$1`, [mode]);
        if (rows.length) return;
        await delay(10);
      }
      assert.fail("routing advisory lock waiter was not observed: " + mode);
    };

    await t.test("0065 seeds no settings for existing tenants and defaults remain disabled", async () => {
      assert.deepEqual(await settings(), []);
      const beforeAudit = await audits();
      for (const ctx of [context, foreignContext]) {
        const listed = await routing.list(ctx);
        assert.deepEqual(listed.map(row => row.mail_type), types);
        for (const row of listed) assert.deepEqual(row, {
          mail_type: row.mail_type, title: routing.policy.TITLES[row.mail_type], revision: 0,
          extra_cc_enabled: false, extra_cc_emails: [], extra_bcc_enabled: false, extra_bcc_emails: [], updated_at: null,
        });
      }
      const untouched = await compose(types[0]);
      assert.deepEqual(untouched, { to: originalTo, cc: originalCc, bcc: [], snapshot: { mail_type: types[0], revision: 0 } });
      assert.equal(Object.hasOwn(routing.payload(untouched), "bcc_emails"), false);
      assert.deepEqual(await validate({ ...queuedInput(types[0], untouched), snapshot: undefined }), untouched);
      await routing.save(context, types[0], desired(0));
      assert.deepEqual(await settings(), []);
      assert.deepEqual(await audits(), beforeAudit);
    });

    await t.test("database defaults, normalized lists, invalid/empty/duplicate lists and same-tenant actor FK", async () => {
      const insert = (client, value = {}) => client.query(`INSERT INTO tenant_operational_mail_routing
        (tenant_id,mail_type,updated_by_user_id,extra_cc_enabled,extra_cc_emails,extra_bcc_enabled,extra_bcc_emails,revision)
        VALUES($1,$2,$3,$4,$5::text[],$6,$7::text[],$8) RETURNING *`,
      [value.tenantId || tenantId, value.mailType || types[0], value.actorId || actorId,
        value.ccEnabled ?? false, Object.hasOwn(value, "cc") ? value.cc : [],
        value.bccEnabled ?? false, Object.hasOwn(value, "bcc") ? value.bcc : [], value.revision ?? 1]);
      const defaults = await transaction(client => client.query(`INSERT INTO tenant_operational_mail_routing
        (tenant_id,mail_type,updated_by_user_id) VALUES($1,$2,$3) RETURNING *`, [tenantId, types[0], actorId]), true);
      assert.equal(defaults.rows[0].revision, 1);
      assert.equal(defaults.rows[0].extra_cc_enabled, false);
      assert.equal(defaults.rows[0].extra_bcc_enabled, false);
      assert.deepEqual(defaults.rows[0].extra_cc_emails, []);
      assert.deepEqual(defaults.rows[0].extra_bcc_emails, []);
      for (const values of [[], ["one@example.test"], Array.from({ length: 20 }, (_, i) => `copy${i}@example.test`)]) {
        await transaction(client => insert(client, { cc: values, bcc: values }), true);
      }
      for (const field of ["cc", "bcc"]) {
        for (const addresses of [["UPPER@example.test"], [" padded@example.test "], ["invalid"], [""], [null],
          [".leading@example.test"], ["two..dots@example.test"], ["one@example.test", "one@example.test"],
          ["a".repeat(65) + "@example.test"], ["x@" + ["a", "b", "c", "d"].map(label => label.repeat(63)).join(".")],
          Array.from({ length: 21 }, (_, i) => `copy${i}@example.test`), [["nested@example.test"]]]) {
          await assert.rejects(transaction(client => insert(client, { [field]: addresses }), true), { code: "23514" });
        }
        await assert.rejects(transaction(client => insert(client, { [field + "Enabled"]: true }), true), { code: "23514" });
        await assert.rejects(transaction(client => insert(client, { [field]: null }), true), { code: "23502" });
      }
      await assert.rejects(transaction(client => insert(client, { ccEnabled: true, bccEnabled: true,
        cc: ["same@example.test"], bcc: ["same@example.test"] }), true), { code: "23514" });
      await assert.rejects(transaction(client => insert(client, { actorId: foreignAdminId }), true), { code: "23503" });
      await assert.rejects(transaction(client => insert(client, { tenantId: foreignId }), true), { code: "23503" });
      await assert.rejects(transaction(client => insert(client, { mailType: "unsupported" }), true), { code: "23514" });
      await assert.rejects(transaction(client => insert(client, { revision: 0 }), true), { code: "23514" });
      await transaction(async client => {
        await insert(client);
        await assert.rejects(insert(client), { code: "23505" });
      }, true);
      assert.deepEqual(await settings(), []);
    });

    await t.test("real list/save reject nonadmins, foreign actors, missing contexts and inactive identities", async () => {
      const before = await settings(), beforeAudit = await audits();
      for (const ctx of [{}, { tenantId }, { tenantId, actorId: "invalid" },
        { tenantId, actorId: nonadminId }, { tenantId, actorId: nonadminId, role: "tenant_admin" },
        { tenantId, actorId: foreignAdminId },
        { tenantId: foreignId, actorId }, { tenantId: randomUUID(), actorId }]) {
        await assert.rejects(routing.list(ctx), { statusCode: 403 });
        await assert.rejects(routing.save(ctx, types[0], desired(0, "copy@example.test")), { statusCode: 403 });
      }
      for (const assignment of ["status='deactivated'", "login_status='disabled'"]) {
        await pool.query(`UPDATE tenant_user SET ${assignment} WHERE tenant_id=$1 AND id=$2`, [tenantId, actorId]);
        try {
          await assert.rejects(routing.list(context), { statusCode: 403 });
          await assert.rejects(routing.save(context, types[0], desired(0, "copy@example.test")), { statusCode: 403 });
        } finally {
          await pool.query("UPDATE tenant_user SET status='active',login_status='active' WHERE tenant_id=$1 AND id=$2", [tenantId, actorId]);
        }
      }
      await pool.query("UPDATE tenant SET status='suspended' WHERE id=$1", [tenantId]);
      try {
        await assert.rejects(routing.list(context), { statusCode: 403 });
        await assert.rejects(routing.save(context, types[0], desired(0, "copy@example.test")), { statusCode: 403 });
      } finally { await pool.query("UPDATE tenant SET status='active' WHERE id=$1", [tenantId]); }
      assert.deepEqual(await settings(), before);
      assert.deepEqual(await audits(), beforeAudit);
    });

    await t.test("real save rejects invalid, empty enabled and normalized duplicate addresses without writes", async () => {
      const before = await settings(), beforeAudit = await audits();
      for (const kind of ["cc", "bcc"]) {
        for (const value of ["invalid", "valid@example.test;", "one@example.test; ONE@EXAMPLE.TEST", "first@example.test,second@example.test"]) {
          const input = desired(0);
          input[`extra_${kind}_enabled`] = true;
          input[`extra_${kind}_emails`] = value;
          await assert.rejects(routing.save(context, types[0], input), { statusCode: 400 });
        }
        const empty = desired(0);
        empty[`extra_${kind}_enabled`] = true;
        await assert.rejects(routing.save(context, types[0], empty), { statusCode: 400, message: "operational_mail_recipients_required" });
      }
      await assert.rejects(routing.save(context, types[0], desired(0, "same@example.test", " SAME@EXAMPLE.TEST ")),
        { statusCode: 400, message: "operational_mail_recipients_duplicate" });
      await assert.rejects(routing.save(context, "unsupported", desired(0)), { statusCode: 400 });
      await assert.rejects(routing.save(context, types[0], { ...desired(0), tenant_id: foreignId }), { statusCode: 400 });
      assert.deepEqual(await settings(), before);
      assert.deepEqual(await audits(), beforeAudit);
    });

    await t.test("save normalizes addresses, audits before/after and toggles, retains disabled lists and isolates tenants", async () => {
      const mailType = types[0], before = await current(mailType);
      const enabled = await routing.save(context, mailType, desired(0,
        " Extra.One@Example.Test ; extra.two@example.test ", " Blind.One@Example.Test ; blind.two@example.test "));
      assert.equal(enabled.revision, 1);
      assert.deepEqual(enabled.extra_cc_emails, ["extra.one@example.test", "extra.two@example.test"]);
      assert.deepEqual(enabled.extra_bcc_emails, ["blind.one@example.test", "blind.two@example.test"]);
      const events = (await audits()).filter(row => row.target_type === "tenant_operational_mail_routing");
      assert.equal(events.length, 1);
      const event = events[0];
      assert.equal(event.tenant_id, tenantId);
      assert.equal(event.actor_id, actorId);
      assert.equal(event.actor_scope, "tenant");
      assert.equal(event.event_type, "tenant_config_changed");
      assert.equal(event.target_id, mailType);
      assert.equal(event.outcome, "success");
      assert.deepEqual(event.metadata, { mail_type: mailType, before: json(before), after: json(enabled),
        actor_scope: "tenant", outcome: "success", module_key: "notifications" });
      const disabled = await save(mailType, enabled.extra_cc_emails.join(";"), enabled.extra_bcc_emails.join(";"), false);
      assert.equal(disabled.revision, 2);
      assert.equal(disabled.extra_cc_enabled, false);
      assert.equal(disabled.extra_bcc_enabled, false);
      assert.deepEqual(disabled.extra_cc_emails, enabled.extra_cc_emails);
      assert.deepEqual(disabled.extra_bcc_emails, enabled.extra_bcc_emails);
      const disabledAudit = (await audits()).find(row => row.metadata.after?.revision === 2 && row.target_id === mailType);
      assert.deepEqual(disabledAudit.metadata.before, json(enabled));
      assert.deepEqual(disabledAudit.metadata.after, json(disabled));
      const beforeNoop = await audits();
      assert.deepEqual(await save(mailType, enabled.extra_cc_emails.join(";"), enabled.extra_bcc_emails.join(";"), false), disabled);
      assert.deepEqual(await audits(), beforeNoop);
      assert.deepEqual((await compose(mailType)).cc, originalCc);
      assert.deepEqual((await compose(mailType)).bcc, []);
      const hcBeforeForeignSave = await routing.list(context);
      assert.equal((await current(mailType, foreignContext)).revision, 0);
      await save(mailType, "foreign.cc@example.test", "foreign.bcc@example.test", true, foreignContext);
      assert.deepEqual(await routing.list(context), hcBeforeForeignSave);
      const foreignRoute = await compose(mailType, foreignContext);
      assert.deepEqual(foreignRoute.cc, [...originalCc, "foreign.cc@example.test"]);
      assert.deepEqual(foreignRoute.bcc, ["foreign.bcc@example.test"]);
      assert.deepEqual((await compose(mailType)).bcc, []);
      assert.equal((await settings()).find(row => row.tenant_id === tenantId && row.mail_type === mailType).updated_by_user_id, actorId);
    });

    await t.test("concurrent initial and existing-revision saves have exactly one winner and one audit", async () => {
      const mailType = types[1];
      for (let round = 0; round < 2; round++) {
        const before = await current(mailType), beforeAudit = await audits();
        const outcomes = await Promise.allSettled(Array.from({ length: 6 }, (_, index) =>
          routing.save(context, mailType, desired(before.revision, `round${round}.copy${index}@example.test`, `round${round}.blind${index}@example.test`))));
        const winners = outcomes.filter(value => value.status === "fulfilled");
        assert.equal(winners.length, 1);
        for (const loser of outcomes.filter(value => value.status === "rejected")) {
          assert.equal(loser.reason.statusCode, 409);
          assert.equal(loser.reason.message, "operational_mail_routing_conflict");
        }
        const winner = winners[0].value;
        assert.equal(winner.revision, before.revision + 1);
        assert.deepEqual(await current(mailType), winner);
        assert.equal((await audits()).length, beforeAudit.length + 1);
      }
    });

    await t.test("failed audit after insertion rolls back new and updated settings plus audit rows and releases locks", async () => {
      const originalLog = audit.logAuditEvent;
      for (const ctx of [context, foreignContext]) {
        const before = await settings(), beforeAudit = await audits();
        audit.logAuditEvent = async event => {
          await originalLog(event);
          throw new Error("fixture_audit_failure");
        };
        try {
          await assert.rejects(save(types[1], "rollback.cc@example.test", "rollback.bcc@example.test", true, ctx), /fixture_audit_failure/);
        } finally { audit.logAuditEvent = originalLog; }
        assert.deepEqual(await settings(), before);
        assert.deepEqual(await audits(), beforeAudit);
        assert.equal(pool.idleCount, pool.totalCount);
        const retry = await save(types[1], "retry.cc@example.test", "retry.bcc@example.test", true, ctx);
        assert.equal(retry.extra_bcc_enabled, true);
      }
    });

    await t.test("real outbox persists private routing; changed/disabled settings block old snapshots without rewriting recipients", async () => {
      const mailType = types[2];
      const privateBcc = ["private.bcc@example.test", "second.bcc@example.test"];
      await save(mailType, "extra.cc@example.test", privateBcc.join(";"));
      const route = await compose(mailType), inputBefore = json({ to: originalTo, cc: originalCc });
      assert.deepEqual(route.cc, [...originalCc, "extra.cc@example.test"]);
      assert.deepEqual(route.bcc, privateBcc);
      assert.equal(route.to, originalTo);
      const templateKey = "fixture.operational_routing", templateId = randomUUID();
      await pool.query(`INSERT INTO email_template(id,tenant_id,template_key,subject_template,html_template,text_template)
        VALUES($1,$2,$3,'Routing fixture','<p>Routing fixture</p>','Routing fixture')`, [templateId, tenantId, templateKey]);
      const row = await transaction(client => outbox.upsertEmail(client, { tenantId, templateId, templateKey,
        recipientTenantUserId: nonadminId, recipientEmail: route.to, subject: "Routing fixture",
        htmlBody: "<p>Routing fixture</p>", textBody: "Routing fixture", payload: routing.payload(route),
        sourceType: "routing_fixture", sourceId: randomUUID(), idempotencyKey: "routing_fixture:" + randomUUID() }));
      const stored = async () => (await pool.query("SELECT * FROM email_outbox WHERE tenant_id=$1 AND id=$2", [tenantId, row.id])).rows[0];
      const originalRow = await stored();
      assert.deepEqual(originalRow.payload_json, routing.payload(route));
      assert.equal(originalRow.status, "queued");
      assert.equal(originalRow.attempt_count, 0);
      assert.deepEqual(await validate(queuedInput(mailType, route, originalRow)), route);
      const reordered = { ...queuedInput(mailType, route, originalRow),
        queuedCc: route.cc.slice().reverse().map(address => ` ${address.toUpperCase()} `),
        queuedBcc: route.bcc.slice().reverse().map(address => ` ${address.toUpperCase()} `) };
      const beforeValidation = json(reordered);
      assert.deepEqual(await validate(reordered), route);
      assert.deepEqual(reordered, beforeValidation, "set comparison must not sort or rewrite queued arrays in place");
      for (const [key, addresses] of [["queuedCc", route.cc], ["queuedBcc", route.bcc]]) {
        await assert.rejects(validate({ ...queuedInput(mailType, route, originalRow),
          [key]: [...addresses, ` ${addresses[0].toUpperCase()} `] }),
        { statusCode: 400, message: "operational_mail_recipients_duplicate" });
      }
      for (const override of [{ snapshot: undefined }, { snapshot: { ...route.snapshot, mail_type: types[0] } },
        { queuedTo: "replaced@example.test" }, { queuedCc: originalCc }, { queuedBcc: [] },
        { tenantId: foreignId }]) {
        await assert.rejects(validate({ ...queuedInput(mailType, route, originalRow), ...override }), changed);
      }
      await save(mailType, "extra.cc@example.test", "changed.bcc@example.test");
      await assert.rejects(validate(queuedInput(mailType, route, originalRow)), changed);
      assert.deepEqual(await stored(), originalRow);
      const changedRoute = await compose(mailType);
      assert.deepEqual(changedRoute.cc, route.cc);
      assert.deepEqual(changedRoute.bcc, ["changed.bcc@example.test"]);
      await save(mailType, "extra.cc@example.test", "changed.bcc@example.test", false);
      await assert.rejects(validate(queuedInput(mailType, changedRoute)), changed);
      await assert.rejects(validate(queuedInput(mailType, route, originalRow)), changed);
      const disabledRoute = await compose(mailType);
      assert.deepEqual(disabledRoute.cc, originalCc);
      assert.deepEqual(disabledRoute.bcc, []);
      assert.equal(disabledRoute.to, originalTo);
      assert.deepEqual(await validate(queuedInput(mailType, disabledRoute)), disabledRoute);
      assert.deepEqual(await stored(), originalRow);
      await save(mailType, "extra.cc@example.test", privateBcc.join(";"));
      const restoredRoute = await compose(mailType);
      assert.deepEqual(restoredRoute.cc, route.cc);
      assert.deepEqual(restoredRoute.bcc, route.bcc);
      await assert.rejects(validate(queuedInput(mailType, route, originalRow)), changed);
      assert.deepEqual(await stored(), originalRow);
      assert.deepEqual({ to: originalTo, cc: originalCc }, inputBefore);
      assert.equal(originalRow.html_body, "<p>Routing fixture</p>");
      assert.equal(originalRow.text_body, "Routing fixture");
      for (const conflict of [originalTo, ...originalCc]) {
        await save(mailType, "", conflict);
        await assert.rejects(compose(mailType), { statusCode: 400, message: "operational_mail_recipients_duplicate" });
      }
    });

    await t.test("send holding shared lock completes before save; stale BCC cannot be sent after save succeeds", { timeout: 12000 }, async () => {
      const mailType = types[2];
      await save(mailType, "", "send.first@example.test");
      const route = await compose(mailType), entered = deferred(), release = deferred(), events = [];
      let saving;
      const sending = settled(messageLock(route, async () => {
        entered.resolve();
        await release.promise;
        events.push({ event: "send", bcc: route.bcc });
        return "local_send_only";
      }));
      try {
        await bounded(entered.promise, "send callback entered");
        saving = settled(save(mailType, "", "save.after.send@example.test").then(value => {
          events.push({ event: "saved" }); return value;
        }));
        await waitForWaiter("ExclusiveLock");
        assert.deepEqual(events, []);
      } finally {
        release.resolve();
        const sent = await sending;
        assert.ifError(sent.error);
        if (saving) assert.ifError((await saving).error);
      }
      assert.deepEqual(events, [{ event: "send", bcc: ["send.first@example.test"] }, { event: "saved" }]);
      let staleSends = 0;
      await assert.rejects(messageLock(route, async () => { staleSends++; }), changed);
      assert.equal(staleSends, 0);
    });

    await t.test("save holding exclusive lock commits before queued send revalidation and blocks stale BCC", { timeout: 12000 }, async () => {
      const mailType = types[2], route = await compose(mailType);
      const audited = deferred(), release = deferred(), originalLog = audit.logAuditEvent;
      let staleSends = 0, sending;
      audit.logAuditEvent = async event => {
        await originalLog(event);
        if (event.tenantId === tenantId && event.resourceId === mailType) {
          audited.resolve();
          await release.promise;
        }
      };
      const saving = settled(save(mailType, "", "save.first@example.test"));
      let saved, sent;
      try {
        await bounded(audited.promise, "save audit inserted before commit");
        sending = settled(messageLock(route, async () => { staleSends++; }));
        await waitForWaiter("ShareLock");
        assert.equal(staleSends, 0);
      } finally {
        release.resolve();
        saved = await saving;
        if (sending) sent = await sending;
        audit.logAuditEvent = originalLog;
      }
      assert.ifError(saved.error);
      assert.equal(saved.value.extra_bcc_emails[0], "save.first@example.test");
      assert.equal(sent.error.statusCode, changed.statusCode);
      assert.equal(sent.error.message, changed.message);
      assert.equal(staleSends, 0);
      const fresh = await compose(mailType);
      let freshSends = 0;
      await messageLock(fresh, async () => { freshSends++; });
      assert.equal(freshSends, 1);
    });

    await t.test("blocked save has bounded lock timeout, rolls back and can be retried after send releases", { timeout: 12000 }, async () => {
      const mailType = types[2], route = await compose(mailType), entered = deferred(), release = deferred();
      const before = await settings(), beforeAudit = await audits();
      const sending = settled(messageLock(route, async () => { entered.resolve(); await release.promise; }));
      try {
        await bounded(entered.promise, "shared send lock acquired");
        await bounded(assert.rejects(save(mailType, "", "timeout@example.test"), { code: "55P03" }), "3s routing lock timeout", 6000);
        assert.deepEqual(await settings(), before);
        assert.deepEqual(await audits(), beforeAudit);
      } finally {
        release.resolve();
        assert.ifError((await sending).error);
      }
      assert.equal((await save(mailType, "", "retry.after.timeout@example.test")).revision, route.snapshot.revision + 1);
      assert.equal(pool.idleCount, pool.totalCount);
    });

    assert.equal(forbiddenFetches, 0, "no provider, EK or other fetch call may even be attempted");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM email_outbox WHERE attempt_count<>0 OR provider IS NOT NULL OR sent_at IS NOT NULL")).rows[0].n, 0);
    assert.equal(pool.idleCount, pool.totalCount);
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
