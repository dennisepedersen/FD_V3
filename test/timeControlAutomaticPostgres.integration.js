"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const enabled = process.env.FIELD_DESK_LOCAL_PG_TEST === "1";

function safeUrl() {
  const url = new URL(process.env.FIELDDESK_TIME_CONTROL_TEST_DATABASE_URL || "postgres://example.invalid/blocked");
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

test("automatic outbox: real PostgreSQL claims, concurrency, audit and transactions; mocked domain guards and transport", {
  skip: !enabled,
  timeout: 120000,
}, async t => {
  const { Client, Pool } = require("../backend/node_modules/pg");
  const url = safeUrl();
  const database = `fielddesk_tc_validation_upgrade_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
  assert.match(database, /^fielddesk_tc_validation_upgrade_[a-f0-9]{24}$/);
  const admin = new Client({ connectionString: url.toString(), ssl: false, connectionTimeoutMillis: 5000 });
  await admin.connect();
  try { await admin.query(`CREATE DATABASE "${database}"`); }
  finally { await admin.end(); }
  url.pathname = `/${database}`;
  const connectionString = url.toString();

  const envKeys = ["DATABASE_URL", "NODE_ENV", "JWT_SECRET", "ROOT_DOMAIN", "MAIL_PROVIDER", "MAIL_API_KEY",
    "TIME_CONTROL_SCHEDULER_ENABLED", "TIME_CONTROL_MAIL_ENABLED"];
  const originalEnv = new Map(envKeys.map(key => [key, process.env[key]]));
  process.env.DATABASE_URL = connectionString;
  process.env.NODE_ENV = "test";
  const ephemeralSigningKey = randomUUID();
  process.env.JWT_SECRET = ephemeralSigningKey;
  process.env.ROOT_DOMAIN = "example.test";
  process.env.MAIL_PROVIDER = "disabled";
  process.env.MAIL_API_KEY = "";
  process.env.TIME_CONTROL_SCHEDULER_ENABLED = "false";
  process.env.TIME_CONTROL_MAIL_ENABLED = "false";

  const pool = new Pool({ connectionString, ssl: false, max: 6, connectionTimeoutMillis: 5000 });
  let appPool;
  const restore = [];
  function patch(target, key, value) {
    const previous = target[key];
    target[key] = value;
    restore.push(() => { target[key] = previous; });
  }
  async function tx(fn) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const value = await fn(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  try {
    const runner = require("../backend/scripts/db_migrate");
    const files = runner.getMigrationFiles();
    assert.equal(files.length, 65, "This proof must apply all 65 existing migration files.");
    const migrationClient = await pool.connect();
    const originalLog = console.log;
    try {
      console.log = () => {};
      await runner.ensureMigrationTable(migrationClient);
      await runner.runPendingMigrations(migrationClient, files, new Map());
    } finally {
      console.log = originalLog;
      migrationClient.release();
    }
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM schema_migration WHERE success")).rows[0].n, 65);
    const server = (await pool.query("SELECT current_database() AS name, inet_server_port() AS port")).rows[0];
    assert.equal(server.name, database);
    assert.equal(server.port, 55432);

    appPool = require("../backend/src/db/pool");
    const repository = require("../backend/src/modules/notifications/emailOutbox.repository");
    const processor = require("../backend/src/modules/notifications/emailOutbox.processor");
    const dispatch = require("../backend/src/modules/timeControl/timeControl.dispatch");
    const weekly = require("../backend/src/modules/timeControl/timeControl.weekly");
    const automation = require("../backend/src/modules/timeControl/timeControl.automation");
    const mailService = require("../backend/src/services/mailService");
    patch(global, "fetch", async () => { throw new Error("integration_real_network_forbidden"); });
    patch(mailService, "sendEmail", async () => { throw new Error("integration_real_provider_forbidden"); });

    const dailyTemplate = "time_control.missing_hours.employee";
    const diagnosticTemplate = "time_control.internal_error";
    const absenceTemplate = "absence_request.submitted.employee";
    const templateRows = (await pool.query(
      "SELECT id,template_key FROM email_template WHERE tenant_id IS NULL AND is_active AND locale='da-DK'")).rows;
    const templates = new Map(templateRows.map(row => [row.template_key, row.id]));
    const tenantId = randomUUID();
    const otherTenantId = randomUUID();
    const genericTenantId = randomUUID();
    for (const id of [tenantId, otherTenantId, genericTenantId]) {
      await pool.query("INSERT INTO tenant(id,slug,name,status) VALUES($1,$2,'Automatic outbox local fixture','active')",
        [id, `automatic-${id.slice(0, 8)}`]);
    }

    async function fixture({ owner = tenantId, template = dailyTemplate, source = "time_control",
      status = "queued", attempts = 0 } = {}) {
      const id = randomUUID();
      assert.ok(templates.has(template), `Missing migrated template ${template}`);
      return (await pool.query(
        `INSERT INTO email_outbox(id,tenant_id,template_id,template_key,recipient_email,subject,html_body,text_body,
         payload_json,status,attempt_count,last_attempt_at,next_attempt_at,source_type,source_id,idempotency_key)
         VALUES($1,$2,$3,$4,'employee@example.test','Local fixture','<p>Local fixture</p>','Local fixture',
         $5::jsonb,$6,$7,now()-interval '1 day',now()-interval '1 day',$8,$9,$10) RETURNING *`,
        [id, owner, templates.get(template), template,
          JSON.stringify({ sender: "Fielddesk Timekontrol <timekontrol@mail.fielddesk.dk>", reply_to: "admin@fielddesk.dk",
            cc_emails: ["dep@example.test"], run_id: randomUUID() }),
          status, attempts, source, randomUUID(), `time_control:local-fixture:${id}`])).rows[0];
    }
    async function state(row) {
      return (await pool.query("SELECT * FROM email_outbox WHERE tenant_id=$1 AND id=$2", [row.tenant_id, row.id])).rows[0];
    }

    let abandoned;
    const terminalUncertain = [];
    let verifiedSubtests = 0;
    await t.test("concurrent exact-ID claims each eligible row once and leave all excluded rows unchanged", async () => {
      const first = await fixture();
      const second = await fixture({ template: diagnosticTemplate });
      const unrequested = await fixture();
      const excluded = [
        await fixture({ owner: otherTenantId }),
        await fixture({ template: absenceTemplate, source: "absence_request" }),
        await fixture({ template: "time_control.friday_manager_summary" }),
        await fixture({ status: "processing", attempts: 1 }),
        await fixture({ status: "retry", attempts: 1 }),
        await fixture({ status: "queued", attempts: 1 }),
        await fixture({ source: "absence_request" }),
      ];
      abandoned = excluded[3];
      const ids = [first, second, ...excluded].map(row => row.id);
      const left = await pool.connect();
      const right = await pool.connect();
      try {
        await left.query("BEGIN");
        await right.query("BEGIN");
        const batches = await Promise.all([
          repository.claimTimeControlBatch(left, { tenantId, outboxIds: ids }),
          repository.claimTimeControlBatch(right, { tenantId, outboxIds: ids }),
        ]);
        const claimed = batches.flat();
        assert.deepEqual(claimed.map(row => row.id).sort(), [first.id, second.id].sort());
        assert.equal(new Set(claimed.map(row => row.id)).size, 2);
        assert.ok(claimed.every(row => row.tenant_id === tenantId && row.status === "processing" && row.attempt_count === 1));
        await left.query("COMMIT");
        await right.query("COMMIT");
      } finally {
        await left.query("ROLLBACK");
        await right.query("ROLLBACK");
        left.release();
        right.release();
      }
      const repeats = await Promise.all([1, 2].map(() => tx(client =>
        repository.claimTimeControlBatch(client, { tenantId, outboxIds: ids }))));
      assert.deepEqual(repeats, [[], []]);
      assert.deepEqual(await tx(client => repository.claimTimeControlBatch(client, {
        tenantId: otherTenantId, outboxIds: [first.id, second.id] })), []);
      assert.deepEqual(await tx(client => repository.claimTimeControlBatch(client, { tenantId, outboxIds: [] })), []);
      for (const row of [...excluded, unrequested]) assert.deepEqual(await state(row), row);
      assert.equal((await state(first)).attempt_count, 1);
      assert.equal((await state(second)).attempt_count, 1);
      verifiedSubtests++;
    });

    let automaticGuards = 0;
    // Domain eligibility is intentionally mocked; SQL claims, transactions and processor audit are real.
    patch(dispatch, "validateAutomatic", async (client, { tenantId: owner }) => {
      automaticGuards++;
      await client.query("SELECT id FROM tenant WHERE id=$1 FOR SHARE", [owner]);
    });
    patch(dispatch, "validateDaily", async () => {});
    patch(weekly, "validateDispatchSnapshot", async () => {});
    patch(automation, "requireSendingEnabled", () => {});

    await t.test("processor uses real transactions and idempotency with mocked domain guards and successful transport", async () => {
      const row = await fixture({ template: diagnosticTemplate });
      let calls = 0;
      const result = await processor.processDueEmails({ tenantId, timeControlOutboxIds: [row.id],
        sendEmailFn: async (message, options) => {
          calls++;
          assert.deepEqual(options, { idempotencyKey: row.idempotency_key, timeoutMs: 15000 });
          assert.equal(message.from, row.payload_json.sender);
          assert.equal(message.replyTo, row.payload_json.reply_to);
          assert.deepEqual(message.cc, row.payload_json.cc_emails);
          const observed = await state(row);
          assert.equal(observed.status, "processing", "Claim is durable before transport starts.");
          assert.equal(observed.attempt_count, 1);
          const competing = await pool.connect();
          try {
            await competing.query("BEGIN");
            await assert.rejects(competing.query("SELECT id FROM tenant WHERE id=$1 FOR UPDATE NOWAIT", [tenantId]),
              error => error.code === "55P03");
          } finally { await competing.query("ROLLBACK"); competing.release(); }
          return { provider: "resend", providerMessageId: "mock-accepted-local-only" };
        } });
      assert.equal(result.sent, 1);
      assert.equal(result.retry, 0);
      assert.equal(calls, 1);
      const stored = await state(row);
      assert.equal(stored.status, "sent");
      assert.equal(stored.provider_message_id, "mock-accepted-local-only");
      assert.equal((await pool.query(
        "SELECT count(*)::int AS n FROM audit_event WHERE tenant_id=$1 AND target_id=$2 AND event_type='email_outbox.sent'",
        [tenantId, row.id])).rows[0].n, 1);
      assert.deepEqual(await tx(client => repository.claimTimeControlBatch(client, { tenantId, outboxIds: [row.id] })), []);
      verifiedSubtests++;
    });

    await t.test("mocked transport timeout and missing receipt persist uncertain terminal state and never retry", async () => {
      for (const outcome of ["timeout", "missing_receipt"]) {
        const row = await fixture({ template: diagnosticTemplate });
        let calls = 0;
        const sendEmailFn = async (_message, options) => {
          calls++;
          assert.deepEqual(options, { idempotencyKey: row.idempotency_key, timeoutMs: 15000 });
          if (outcome === "timeout") throw new Error("simulated_provider_timeout");
          return { provider: "resend" };
        };
        const result = await processor.processDueEmails({ tenantId, timeControlOutboxIds: [row.id], sendEmailFn });
        assert.equal(result.sent, 0);
        assert.equal(result.retry, 0);
        assert.equal(result.dead_letter, 1);
        assert.equal(result.failures[0].delivery_state, "unclear");
        const stored = await state(row);
        assert.equal(stored.status, "dead_letter");
        assert.equal(stored.attempt_count, 1);
        assert.equal(stored.last_error_code, "provider_acceptance_unclear");
        assert.ok(stored.dead_lettered_at);
        terminalUncertain.push(row);
        const repeated = await processor.processDueEmails({ tenantId, timeControlOutboxIds: [row.id], sendEmailFn });
        assert.equal(repeated.claimed, 0);
        assert.equal(calls, 1);
        assert.equal((await pool.query(
          "SELECT count(*)::int AS n FROM audit_event WHERE tenant_id=$1 AND target_id=$2 AND event_type='email_outbox.retry_scheduled'",
          [tenantId, row.id])).rows[0].n, 0);
      }
      verifiedSubtests++;
    });

    await t.test("generic claim excludes attempted Timekontrol but preserves generic retries and stale processing recovery", async () => {
      const excluded = [
        await fixture({ owner: genericTenantId, status: "processing", attempts: 1 }),
        await fixture({ owner: genericTenantId, status: "retry", attempts: 1 }),
        await fixture({ owner: genericTenantId, status: "queued", attempts: 1 }),
        await fixture({ owner: genericTenantId, source: "absence_request", status: "processing", attempts: 1 }),
        await fixture({ owner: genericTenantId, source: "time_control", template: absenceTemplate, status: "retry", attempts: 1 }),
      ];
      const generic = [
        await fixture({ owner: genericTenantId, template: absenceTemplate, source: "absence_request", status: "retry", attempts: 1 }),
        await fixture({ owner: genericTenantId, template: absenceTemplate, source: "absence_request", status: "processing", attempts: 1 }),
        await fixture({ owner: genericTenantId, template: absenceTemplate, source: "absence_request" }),
      ];
      const claimed = await tx(client => repository.claimDueBatch(client, { tenantId: genericTenantId, limit: 100 }));
      assert.deepEqual(claimed.map(row => row.id).sort(), generic.map(row => row.id).sort());
      for (const row of excluded) {
        assert.deepEqual(await state(row), row);
        assert.equal(await tx(client => repository.markRetry(client, {
          tenantId: genericTenantId, id: row.id, nextAttemptAt: new Date(), errorCode: "fixture", errorMessage: "fixture" })), null);
        assert.deepEqual(await state(row), row);
      }
      const retried = await tx(client => repository.markRetry(client, {
        tenantId: genericTenantId, id: generic[0].id, nextAttemptAt: new Date(Date.now() - 1000),
        errorCode: "fixture", errorMessage: "fixture" }));
      assert.equal(retried.status, "retry");
      const beforeGuards = automaticGuards;
      const result = await processor.processDueEmails({ tenantId: genericTenantId,
        sendEmailFn: async (...args) => {
          assert.equal(args.length, 1);
          throw new Error("simulated_generic_transient_error");
        } });
      assert.equal(result.claimed, 1);
      assert.equal(result.retry, 1);
      assert.equal(automaticGuards, beforeGuards);
      const stored = await state(generic[0]);
      assert.equal(stored.status, "retry");
      assert.equal(stored.attempt_count, 3);
      assert.equal(stored.last_error_code, "simulated_generic_transient_error");
      verifiedSubtests++;
    });

    await t.test("statusOnly reports abandoned processing and terminal provider uncertainty without changing rows", async () => {
      const uncertainRows = [abandoned, ...terminalUncertain];
      const before = await Promise.all(uncertainRows.map(state));
      const summary = await processor.statusOnly({ tenantId });
      assert.equal(terminalUncertain.length, 2);
      for (const expected of uncertainRows) {
        assert.ok(summary.unclear_time_control.some(row => row.id === expected.id && row.delivery_state === "unclear"));
      }
      assert.deepEqual(await Promise.all(uncertainRows.map(state)), before);
      const other = await processor.statusOnly({ tenantId: otherTenantId });
      assert.equal(other.unclear_time_control.some(row => uncertainRows.some(expected => expected.id === row.id)), false);
      verifiedSubtests++;
    });

    assert.equal(verifiedSubtests, 5);
    console.log(JSON.stringify({ database, migrations: files.length, concurrentExactClaimsVerified: true,
      genericRetryPreserved: true, uncertainDeliveryTerminal: true, mockedDomainGuards: true, realProviderCalls: 0 }));
  } finally {
    for (const undo of restore.reverse()) undo();
    if (appPool) await appPool.end();
    await pool.end();
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
