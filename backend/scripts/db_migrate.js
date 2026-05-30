const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const dotenv = require("dotenv");

const backendRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(__dirname, "../..");
const migrationsDir = path.join(repoRoot, "migrations");

function parseArgs(argv) {
  const options = {
    mode: "migrate",
    baselineThrough: null,
    envFile: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--status") {
      options.mode = "status";
      continue;
    }
    if (arg === "--baseline-through") {
      options.baselineThrough = argv[index + 1] || null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--baseline-through=")) {
      options.baselineThrough = arg.slice("--baseline-through=".length);
      continue;
    }
    if (arg === "--env-file") {
      options.envFile = argv[index + 1] || null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--env-file=")) {
      options.envFile = arg.slice("--env-file=".length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.baselineThrough) {
    options.mode = "baseline";
  }

  return options;
}

function printHelp() {
  console.log(`Fielddesk database migration runner

Usage:
  node scripts/db_migrate.js
  node scripts/db_migrate.js --status
  node scripts/db_migrate.js --baseline-through 0019
  node scripts/db_migrate.js --env-file ./path/to/.env

Notes:
  - Reads DATABASE_URL from the current environment or backend/.env.
  - Does not log DATABASE_URL or secrets.
  - Does not run automatically at app startup.`);
}

function loadEnv(options) {
  if (options.envFile) {
    dotenv.config({ path: path.resolve(process.cwd(), options.envFile), quiet: true });
    return;
  }

  dotenv.config({ path: path.join(backendRoot, ".env"), quiet: true });
}

function ensureDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }
}

function getSslConfig() {
  const url = String(process.env.DATABASE_URL || "");
  if (/localhost|127\.0\.0\.1/i.test(url)) {
    return false;
  }
  return { rejectUnauthorized: false };
}

function getMigrationFiles() {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }

  return fs.readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b))
    .map((filename) => {
      const filePath = path.join(migrationsDir, filename);
      const sql = fs.readFileSync(filePath, "utf8");
      return {
        id: filename.replace(/\.sql$/i, ""),
        filename,
        filePath,
        sql,
        checksum: crypto.createHash("sha256").update(sql).digest("hex"),
        sequence: getMigrationSequence(filename),
      };
    });
}

function getMigrationSequence(filename) {
  const match = String(filename || "").match(/^(\d+)/);
  return match ? match[1] : null;
}

function stripOuterTransaction(sql) {
  return String(sql || "")
    .replace(/^\s*BEGIN\s*;\s*$/im, "")
    .replace(/^\s*COMMIT\s*;\s*$/im, "");
}

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      id text PRIMARY KEY,
      filename text NOT NULL UNIQUE,
      checksum_sha256 text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      duration_ms integer NOT NULL DEFAULT 0,
      success boolean NOT NULL DEFAULT true,
      error_message text NULL,
      execution_mode text NOT NULL DEFAULT 'applied',
      CONSTRAINT ck_schema_migration_id_not_empty CHECK (btrim(id) <> ''),
      CONSTRAINT ck_schema_migration_execution_mode CHECK (execution_mode IN ('applied', 'baseline', 'failed'))
    )
  `);
}

async function getAppliedMap(client) {
  const { rows } = await client.query(`
    SELECT id, filename, checksum_sha256, applied_at, duration_ms, success, error_message, execution_mode
    FROM schema_migration
    ORDER BY filename
  `);
  return new Map(rows.map((row) => [row.id, row]));
}

function getChecksumMismatches(migrations, appliedMap) {
  return migrations
    .map((migration) => {
      const row = appliedMap.get(migration.id);
      if (!row || row.checksum_sha256 === migration.checksum) {
        return null;
      }
      return {
        id: migration.id,
        filename: migration.filename,
        appliedChecksum: row.checksum_sha256,
        currentChecksum: migration.checksum,
      };
    })
    .filter(Boolean);
}

function printStatus(migrations, appliedMap) {
  const mismatches = getChecksumMismatches(migrations, appliedMap);
  const applied = [];
  const pending = [];
  const failed = [];

  migrations.forEach((migration) => {
    const row = appliedMap.get(migration.id);
    if (!row) {
      pending.push(migration);
      return;
    }
    if (row.success) {
      applied.push({ migration, row });
      return;
    }
    failed.push({ migration, row });
  });

  console.log(`schema_migration status: ${applied.length} applied, ${pending.length} pending, ${failed.length} failed, ${mismatches.length} checksum mismatch`);

  if (applied.length > 0) {
    console.log("\nApplied:");
    applied.forEach(({ migration, row }) => {
      console.log(`  - ${migration.filename} (${row.execution_mode}, ${row.applied_at.toISOString ? row.applied_at.toISOString() : row.applied_at})`);
    });
  }

  if (pending.length > 0) {
    console.log("\nPending:");
    pending.forEach((migration) => {
      console.log(`  - ${migration.filename}`);
    });
  }

  if (failed.length > 0) {
    console.log("\nFailed:");
    failed.forEach(({ migration, row }) => {
      console.log(`  - ${migration.filename}: ${row.error_message || "unknown error"}`);
    });
  }

  if (mismatches.length > 0) {
    console.log("\nChecksum mismatches:");
    mismatches.forEach((mismatch) => {
      console.log(`  - ${mismatch.filename}`);
    });
  }
}

async function recordMigrationResult(client, migration, result) {
  await client.query(`
    INSERT INTO schema_migration (
      id,
      filename,
      checksum_sha256,
      applied_at,
      duration_ms,
      success,
      error_message,
      execution_mode
    )
    VALUES ($1, $2, $3, now(), $4, $5, $6, $7)
    ON CONFLICT (id) DO UPDATE SET
      filename = EXCLUDED.filename,
      checksum_sha256 = EXCLUDED.checksum_sha256,
      applied_at = EXCLUDED.applied_at,
      duration_ms = EXCLUDED.duration_ms,
      success = EXCLUDED.success,
      error_message = EXCLUDED.error_message,
      execution_mode = EXCLUDED.execution_mode
  `, [
    migration.id,
    migration.filename,
    migration.checksum,
    result.durationMs,
    result.success,
    result.errorMessage || null,
    result.executionMode,
  ]);
}

async function baselineThrough(client, migrations, appliedMap, sequence) {
  const normalizedSequence = String(sequence || "").trim();
  if (!/^\d+$/.test(normalizedSequence)) {
    throw new Error("--baseline-through must be a numeric migration prefix, for example 0019");
  }

  const target = Number(normalizedSequence);
  const candidates = migrations.filter((migration) => {
    if (!migration.sequence) {
      return false;
    }
    return Number(migration.sequence) <= target;
  });

  if (candidates.length === 0) {
    throw new Error(`No migrations found through ${normalizedSequence}`);
  }

  const mismatches = getChecksumMismatches(candidates, appliedMap);
  if (mismatches.length > 0) {
    throw new Error(`Checksum mismatch for already tracked migration: ${mismatches.map((item) => item.filename).join(", ")}`);
  }

  console.log(`Baselining ${candidates.length} migration(s) through ${normalizedSequence}. SQL will not be executed.`);

  for (const migration of candidates) {
    const row = appliedMap.get(migration.id);
    if (row && row.success) {
      console.log(`skip baseline ${migration.filename} (already tracked)`);
      continue;
    }
    if (row && !row.success) {
      throw new Error(`Cannot baseline failed migration row: ${migration.filename}`);
    }

    await recordMigrationResult(client, migration, {
      durationMs: 0,
      success: true,
      errorMessage: null,
      executionMode: "baseline",
    });
    console.log(`baselined ${migration.filename}`);
  }
}

async function runMigration(client, migration) {
  const startedAt = Date.now();
  const executableSql = stripOuterTransaction(migration.sql);

  try {
    await client.query("BEGIN");
    await client.query(executableSql);
    await recordMigrationResult(client, migration, {
      durationMs: Date.now() - startedAt,
      success: true,
      errorMessage: null,
      executionMode: "applied",
    });
    await client.query("COMMIT");

    console.log(`applied ${migration.filename} (${Date.now() - startedAt}ms)`);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_rollbackError) {
      // Preserve the original migration error.
    }

    const message = error && error.message ? String(error.message) : "migration_failed";
    await recordMigrationResult(client, migration, {
      durationMs: Date.now() - startedAt,
      success: false,
      errorMessage: message.slice(0, 1000),
      executionMode: "failed",
    });
    throw error;
  }
}

async function runPendingMigrations(client, migrations, appliedMap) {
  const mismatches = getChecksumMismatches(migrations, appliedMap)
    .filter((mismatch) => {
      const row = appliedMap.get(mismatch.id);
      return row && row.success;
    });

  if (mismatches.length > 0) {
    throw new Error(`Checksum mismatch for already applied migration: ${mismatches.map((item) => item.filename).join(", ")}`);
  }

  let appliedCount = 0;
  let skippedCount = 0;

  for (const migration of migrations) {
    const row = appliedMap.get(migration.id);
    if (row && row.success) {
      skippedCount += 1;
      console.log(`skip ${migration.filename} (${row.execution_mode})`);
      continue;
    }
    if (row && !row.success && row.checksum_sha256 !== migration.checksum) {
      throw new Error(`Checksum mismatch for failed migration row: ${migration.filename}`);
    }

    await runMigration(client, migration);
    appliedCount += 1;
  }

  console.log(`Migration complete: ${appliedCount} applied, ${skippedCount} skipped`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  loadEnv(options);
  ensureDatabaseUrl();

  const migrations = getMigrationFiles();
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: getSslConfig(),
  });

  await client.connect();
  try {
    await ensureMigrationTable(client);
    const appliedMap = await getAppliedMap(client);

    if (options.mode === "status") {
      printStatus(migrations, appliedMap);
      return;
    }

    if (options.mode === "baseline") {
      await baselineThrough(client, migrations, appliedMap, options.baselineThrough);
      return;
    }

    await runPendingMigrations(client, migrations, appliedMap);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  const message = error && error.message ? error.message : "migration_runner_failed";
  console.error(`migration failed: ${message}`);
  process.exit(1);
});
