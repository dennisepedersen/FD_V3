"use strict";

const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const runner = require("../backend/scripts/db_migrate");

const root = path.resolve(__dirname, "..");
const migrationId = "0049_time_control_poc";
const oldChecksum = "0ec400ce00f91654a6eb94642acd0b04887c8b58a889e476936407717809b77f";
const retry = { retryFailed: migrationId, expectedFailedChecksum: oldChecksum };
const migration = {
  id: migrationId,
  filename: `${migrationId}.sql`,
  sql: "BEGIN;\nSELECT 1;\nCOMMIT;\n",
  checksum: "a".repeat(64),
};
const failedRow = {
  id: migrationId, filename: migration.filename, checksum_sha256: oldChecksum,
  success: false, execution_mode: "failed", error_message: "original failure",
};

function auditTypes(sql) {
  return [...sql.split("event_type IN (")[1].split(")")[0].matchAll(/'([^']+)'/g)]
    .map((match) => match[1]);
}

test("failed retry arguments require exact ID and SHA-256 together, with no status/baseline bypass", () => {
  assert.equal(runner.parseArgs([]).retryFailed, null);
  assert.deepEqual(
    runner.parseArgs(["--retry-failed", migrationId, "--expected-failed-checksum", oldChecksum]),
    runner.parseArgs([`--retry-failed=${migrationId}`, `--expected-failed-checksum=${oldChecksum}`])
  );
  for (const args of [
    ["--retry-failed"],
    ["--retry-failed", migrationId],
    ["--expected-failed-checksum", oldChecksum],
    ["--retry-failed", "0049", "--expected-failed-checksum", oldChecksum],
    ["--retry-failed", `${migrationId}.sql`, "--expected-failed-checksum", oldChecksum],
    ["--retry-failed", migrationId, "--expected-failed-checksum", "bad"],
    ["--retry-failed", migrationId, "--expected-failed-checksum", "--status"],
    ["--retry-failed", migrationId, "--expected-failed-checksum", oldChecksum, "--status"],
    ["--retry-failed", migrationId, "--expected-failed-checksum", oldChecksum, "--baseline-through", "0049"],
    ["--retry-failed", migrationId, "--retry-failed", migrationId, "--expected-failed-checksum", oldChecksum],
  ]) assert.throws(() => runner.parseArgs(args));
});

test("explicit retry only authorizes the exact existing failed identity and previous checksum", () => {
  runner.validateFailedRetry([migration], new Map([[migrationId, failedRow]]), retry);
  for (const row of [
    null,
    { ...failedRow, success: true },
    { ...failedRow, execution_mode: "baseline" },
    { ...failedRow, filename: "0049_other.sql" },
    { ...failedRow, checksum_sha256: "b".repeat(64) },
  ]) {
    assert.throws(() => runner.validateFailedRetry(
      [migration], new Map(row ? [[migrationId, row]] : []), retry
    ));
  }
  assert.throws(() => runner.validateFailedRetry([], new Map([[migrationId, failedRow]]), retry));
});

test("default migration runner rejects changed failed and successful checksums before executing SQL", async () => {
  const client = { query: async () => assert.fail("must not execute SQL") };
  await assert.rejects(runner.runPendingMigrations(
    client, [migration], new Map([[migrationId, failedRow]])
  ), /Checksum mismatch for failed migration row/);
  await assert.rejects(runner.runPendingMigrations(
    client, [migration], new Map([[migrationId, { ...failedRow, success: true }]])
  ), /Checksum mismatch for already applied migration/);
  await assert.rejects(runner.runPendingMigrations(
    client, [migration], new Map([[migrationId, { ...failedRow, success: true }]]), retry
  ), /existing failed migration row/);
});

test("retry cannot authorize a second changed failed migration", async () => {
  const other = { ...migration, id: "0050_other", filename: "0050_other.sql" };
  const client = { query: async () => assert.fail("must not execute SQL") };
  await assert.rejects(runner.runPendingMigrations(client, [migration, other], new Map([
    [migrationId, failedRow],
    [other.id, { ...failedRow, id: other.id, filename: other.filename }],
  ]), retry), /0050_other.sql/);
});

test("retry revalidates the locked row and preserves original failed tracking when SQL fails", async () => {
  for (const currentRow of [failedRow, { ...failedRow, success: true }]) {
    const queries = [];
    const client = {
      query: async (sql) => {
        queries.push(sql);
        if (sql.includes("FOR UPDATE")) return { rows: [currentRow] };
        if (sql.includes("SELECT 1")) throw new Error("retry SQL failed");
        if (sql.includes("INSERT INTO schema_migration")) assert.fail("must preserve failed tracking");
        return { rows: [], rowCount: 1 };
      },
    };
    await assert.rejects(runner.runMigration(client, migration, retry));
    assert.equal(queries.at(-1), "ROLLBACK");
    if (currentRow.success) assert.equal(queries.some((sql) => sql.includes("SELECT 1")), false);
  }
});

test("successful migration history cannot be overwritten even by a racing result write", async () => {
  let query;
  await assert.rejects(runner.recordMigrationResult({
    query: async (sql) => { query = sql; return { rowCount: 0 }; },
  }, migration, { durationMs: 0, success: true, executionMode: "applied" }), /successful migration history/);
  assert.match(query, /WHERE schema_migration\.success = false/);
});

test("retry archives the original row before success in the same transaction and fails closed on archive failure", async () => {
  for (const archiveCount of [0, 1]) {
    const queries = [];
    const client = {
      query: async (sql) => {
        queries.push(sql);
        if (sql.includes("FOR UPDATE")) return { rows: [failedRow] };
        if (sql.includes("INSERT INTO schema_migration_retry_history")) return { rowCount: archiveCount };
        return { rows: [], rowCount: 1 };
      },
    };
    if (archiveCount === 0) {
      await assert.rejects(runner.runMigration(client, migration, retry), /history archive mismatch/);
      assert.equal(queries.at(-1), "ROLLBACK");
      assert.equal(queries.some((sql) => sql.includes("INSERT INTO schema_migration (")), false);
    } else {
      await runner.runMigration(client, migration, retry);
      const archiveIndex = queries.findIndex((sql) => sql.includes("INSERT INTO schema_migration_retry_history"));
      const successIndex = queries.findIndex((sql) => sql.includes("INSERT INTO schema_migration ("));
      assert.ok(archiveIndex > 0 && archiveIndex < successIndex);
      assert.equal(queries.at(-1), "COMMIT");
    }
  }
});

test("0049 and all subsequent audit allowlists preserve every event valid under 0048", () => {
  const migrations = runner.getMigrationFiles();
  let previous = auditTypes(migrations.find((item) => item.sequence === "0048").sql);
  for (const item of migrations.filter((item) => Number(item.sequence) >= 49)) {
    if (!item.sql.includes("event_type IN (")) continue;
    if (["0062", "0063", "0064"].includes(item.sequence)) {
      assert.match(item.sql, /pg_get_expr\(conbin, conrelid\)/);
      assert.match(item.sql, /CHECK \(\(%s\) OR event_type IN/);
      assert.match(item.sql, /existing_expression/);
      previous = [...previous, ...[...item.sql.matchAll(/''(approval_control\.[a-z_]+)''/g)].map(match => match[1])];
      continue;
    }
    const current = auditTypes(item.sql);
    assert.deepEqual(previous.filter((event) => !current.includes(event)), [], item.filename);
    previous = current;
  }
  for (const event of ["time_control.run_completed", "time_control.run_blocked", "time_control.mode_changed"]) {
    assert.ok(previous.includes(event));
  }
});

test("real PostgreSQL upgrade retains 0048 audits, explicitly retries failed 0049, then skips all migrations", {
  skip: process.env.FIELD_DESK_LOCAL_PG_TEST !== "1",
}, async () => {
  const connectionString = process.env.FIELDDESK_TIME_CONTROL_TEST_DATABASE_URL
    || "postgres://tc_validation@127.0.0.1:55432/fielddesk_tc_validation";
  const url = new URL(connectionString);
  assert.equal(url.protocol, "postgres:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55432");
  assert.match(url.pathname, /^\/fielddesk_tc_validation_upgrade_[a-f0-9]{24}$/);
  assert.equal(decodeURIComponent(url.username), "tc_validation");
  assert.equal(url.password, "");

  const { Client } = require("../backend/node_modules/pg");
  const admin = new Client({ connectionString, ssl: false });
  const database = `fielddesk_tc_validation_upgrade_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
  assert.match(database, /^fielddesk_tc_validation_upgrade_[a-f0-9]{24}$/);
  let client;
  await admin.connect();
  try {
    const { rows: [server] } = await admin.query(
      "SELECT current_database() AS database, host(inet_server_addr()) AS address, inet_server_port() AS port, version()"
    );
    assert.equal(server.database, url.pathname.slice(1));
    assert.equal(server.address, "127.0.0.1");
    assert.equal(server.port, 55432);
    assert.match(server.version, /^PostgreSQL 17\./);
    await admin.query(`CREATE DATABASE "${database}"`);
    url.pathname = `/${database}`;
    client = new Client({ connectionString: url.toString(), ssl: false });
    await client.connect();
    assert.equal((await client.query("SELECT current_database() AS name")).rows[0].name, database);
    await runner.ensureMigrationTable(client);
    const migrations = runner.getMigrationFiles();
    assert.equal(migrations.length, 56);
    const prior = migrations.filter((item) => Number(item.sequence) <= 48);
    await runner.runPendingMigrations(client, prior, new Map());
    const successfulBefore = [...(await runner.getAppliedMap(client)).values()];
    const { rows: [tenant] } = await client.query(
      `INSERT INTO tenant (slug, name, status)
       VALUES ('hoyrup-clemmensen', 'Disposable migration validation', 'active') RETURNING id`
    );
    const legacyTypes = auditTypes(prior.find((item) => item.sequence === "0048").sql);
    const legacyRows = [];
    for (const event of legacyTypes) {
      const { rows: [row] } = await client.query(
        `INSERT INTO audit_event (actor_id, actor_scope, tenant_id, event_type, target_type, outcome)
         VALUES ('local-upgrade-fixture', 'system', $1, $2, 'migration_validation', 'success') RETURNING *`,
        [tenant.id, event]
      );
      legacyRows.push(row);
    }
    const fixed = migrations.find((item) => item.id === migrationId);
    const oldSql = execFileSync("git", ["show", "c261a8b:migrations/0049_time_control_poc.sql"], {
      cwd: root, encoding: "utf8",
    });
    assert.equal(createHash("sha256").update(oldSql).digest("hex"), oldChecksum);
    const oldMigration = { ...fixed, sql: oldSql, checksum: oldChecksum };
    await assert.rejects(runner.runPendingMigrations(
      client, [...prior, oldMigration], await runner.getAppliedMap(client)
    ), (error) => error.code === "23514" && /ck_audit_event_event_type/.test(error.message));
    const originalFailure = (await runner.getAppliedMap(client)).get(migrationId);
    const originalFailureJson = (await client.query(
      "SELECT to_jsonb(m) AS snapshot FROM schema_migration m WHERE id = $1", [migrationId]
    )).rows[0].snapshot;
    assert.equal(originalFailure.success, false);
    assert.equal(originalFailure.checksum_sha256, oldChecksum);
    assert.equal((await client.query("SELECT to_regclass('time_control_settings') AS name")).rows[0].name, null);
    await assert.rejects(runner.runMigration(client, oldMigration, retry),
      (error) => error.code === "23514");
    assert.deepEqual((await runner.getAppliedMap(client)).get(migrationId), originalFailure);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM schema_migration_retry_history")).rows[0].count, 0);
    await client.query(`
      CREATE FUNCTION pg_temp.reject_retry_success() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'local fixture rejects success tracking'; END;
      $$;
      CREATE TRIGGER trg_test_reject_retry_success
      BEFORE UPDATE ON schema_migration FOR EACH ROW
      WHEN (NEW.success = true)
      EXECUTE FUNCTION pg_temp.reject_retry_success()
    `);
    try {
      await assert.rejects(runner.runMigration(client, fixed, retry), /local fixture rejects success tracking/);
      assert.deepEqual((await runner.getAppliedMap(client)).get(migrationId), originalFailure);
      assert.equal((await client.query("SELECT count(*)::int AS count FROM schema_migration_retry_history")).rows[0].count, 0,
        "archive insert must roll back together with rejected success tracking");
      assert.equal((await client.query("SELECT to_regclass('time_control_settings') AS name")).rows[0].name, null);
    } finally {
      await client.query("DROP TRIGGER trg_test_reject_retry_success ON schema_migration");
    }

    const invoke = (args) => spawnSync(process.execPath, [
      path.join(root, "backend", "scripts", "db_migrate.js"), ...args,
    ], {
      cwd: root, encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL:
          url.toString(),
        NODE_ENV: "test",
      },
    });
    for (const [args, error] of [
      [[], /Checksum mismatch for failed migration row/],
      [["--retry-failed", migrationId, "--expected-failed-checksum", "f".repeat(64)], /identity\/checksum mismatch/],
      [["--retry-failed", "0050_time_control_data_quality", "--expected-failed-checksum", oldChecksum], /existing failed migration row/],
      [["--retry-failed", prior[0].id, "--expected-failed-checksum", prior[0].checksum], /existing failed migration row/],
    ]) {
      const result = invoke(args);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, error);
      assert.deepEqual((await runner.getAppliedMap(client)).get(migrationId), originalFailure);
    }
    const success = invoke(["--retry-failed", migrationId, "--expected-failed-checksum", oldChecksum]);
    assert.equal(success.status, 0, success.stdout + success.stderr);
    assert.match(success.stdout, /Migration complete: 8 applied, 48 skipped/);
    const after = await runner.getAppliedMap(client);
    for (const row of successfulBefore) assert.deepEqual(after.get(row.id), row);
    assert.equal(after.size, migrations.length);
    assert.equal(after.get(migrationId).checksum_sha256, fixed.checksum);
    assert.ok([...after.values()].every((row) => row.success));
    const archived = await client.query(`
      SELECT to_jsonb(h) - 'retry_id' - 'replacement_checksum_sha256' - 'archived_at' AS snapshot,
             replacement_checksum_sha256, retry_id, archived_at
      FROM schema_migration_retry_history h ORDER BY retry_id
    `);
    assert.equal(archived.rows.length, 1);
    assert.deepEqual(archived.rows[0].snapshot, originalFailureJson,
      "archive must retain every original column including full timestamp precision and original error");
    assert.equal(archived.rows[0].replacement_checksum_sha256, fixed.checksum);
    const archiveBeforeRepeat = (await client.query("SELECT * FROM schema_migration_retry_history")).rows;
    for (const sql of [
      "UPDATE schema_migration_retry_history SET error_message = 'changed'",
      "DELETE FROM schema_migration_retry_history",
      "TRUNCATE schema_migration_retry_history",
    ]) await assert.rejects(client.query(sql), /append-only/);
    const { rows: auditsAfter } = await client.query(
      "SELECT * FROM audit_event WHERE tenant_id = $1 ORDER BY event_type", [tenant.id]
    );
    assert.deepEqual(auditsAfter, [...legacyRows].sort((a, b) => a.event_type.localeCompare(b.event_type)));
    await assert.rejects(client.query(
      `INSERT INTO audit_event (actor_id, actor_scope, tenant_id, event_type, target_type, outcome)
       VALUES ('local-upgrade-fixture', 'system', $1, 'unknown.invalid', 'migration_validation', 'success')`,
      [tenant.id]
    ), (error) => error.code === "23514" && error.constraint === "ck_audit_event_event_type");
    const repeated = invoke([]);
    assert.equal(repeated.status, 0, repeated.stdout + repeated.stderr);
    assert.match(repeated.stdout, new RegExp(`Migration complete: 0 applied, ${migrations.length} skipped`));
    assert.deepEqual(await runner.getAppliedMap(client), after);
    assert.deepEqual((await client.query("SELECT * FROM schema_migration_retry_history")).rows, archiveBeforeRepeat);
    const staleRetry = invoke(["--retry-failed", migrationId, "--expected-failed-checksum", oldChecksum]);
    assert.equal(staleRetry.status, 1);
    assert.match(staleRetry.stderr, /existing failed migration row/);
    assert.deepEqual(await runner.getAppliedMap(client), after);
    assert.deepEqual((await client.query("SELECT * FROM schema_migration_retry_history")).rows, archiveBeforeRepeat);
    console.log(JSON.stringify({
      database, retainedAuditRows: legacyRows.length, retainedIgvaRows: 3,
      successfulHistoryUnchanged: successfulBefore.length,
      archivedFailedAttempts: archived.rows.length,
      applied: 8, skipped: 48, repeatApplied: 0, repeatSkipped: migrations.length,
      oldFailedChecksum: oldChecksum, repairedChecksum: fixed.checksum,
    }));
  } finally {
    if (client) await client.end();
    await admin.end();
  }
});
