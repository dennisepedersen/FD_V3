'use strict';

const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const pool = require('../src/db/pool');
const { materializeProjectActivityFromFitterHours } = require('../src/services/projectActivityMaterializer');

const JOB_NAME = 'project-activity-materialize';

function usage() {
  return [
    'Usage:',
    '  node scripts/materialize_project_activity_from_fitter_hour.js --tenant hoyrup-clemmensen --status-only',
    '  node scripts/materialize_project_activity_from_fitter_hour.js --tenant hoyrup-clemmensen --dry-run',
    '  node scripts/materialize_project_activity_from_fitter_hour.js --tenant hoyrup-clemmensen --apply --confirm APPLY:project-activity-materialize:hoyrup-clemmensen',
    '',
    'Options:',
    '  --tenant <slug-or-domain>  Tenant slug or tenant domain.',
    '  --status-only              Read current activity coverage.',
    '  --dry-run                  Materialize inside a transaction and roll back.',
    '  --apply                    Materialize activity fields in project_wip.',
    '  --confirm <token>          Required for apply.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    tenant: null,
    statusOnly: false,
    dryRun: false,
    apply: false,
    confirm: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tenant') {
      args.tenant = argv[++i] || null;
    } else if (arg === '--status-only') {
      args.statusOnly = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--apply') {
      args.apply = true;
    } else if (arg === '--confirm') {
      args.confirm = argv[++i] || null;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.tenant || !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(String(args.tenant).trim())) {
    throw new Error('Provide --tenant as a tenant slug or domain.');
  }

  const selectedModes = [args.statusOnly, args.dryRun, args.apply].filter(Boolean).length;
  if (selectedModes !== 1) {
    throw new Error(`Provide exactly one of --status-only, --dry-run, or --apply for ${JOB_NAME}.`);
  }

  if (args.apply) {
    const tenant = String(args.tenant).trim().toLowerCase();
    const expectedConfirm = `APPLY:${JOB_NAME}:${tenant}`;
    if (args.confirm !== expectedConfirm) {
      throw new Error(`Apply requires --confirm ${expectedConfirm}`);
    }
  }

  return args;
}

async function resolveTenant(client, tenantKey) {
  const key = String(tenantKey || '').trim().toLowerCase();
  const { rows } = await client.query(
    `
      SELECT id, slug
      FROM tenant
      WHERE lower(slug) = $1

      UNION

      SELECT t.id, t.slug
      FROM tenant_domain td
      INNER JOIN tenant t
        ON t.id = td.tenant_id
      WHERE lower(td.domain) = $1
      LIMIT 1
    `,
    [key]
  );

  if (!rows[0]) {
    throw new Error(`Tenant not found: ${tenantKey}`);
  }
  return rows[0];
}

async function readCoverage(client, tenantId) {
  const { rows } = await client.query(
    `
      WITH source_projects AS (
        SELECT DISTINCT fh.fd_project_id AS project_id
        FROM fitter_hour fh
        INNER JOIN project_core pc
          ON pc.tenant_id = fh.tenant_id
         AND pc.project_id = fh.fd_project_id
        WHERE fh.tenant_id = $1
          AND fh.fd_project_id IS NOT NULL
      )
      SELECT
        COUNT(*)::int AS fitter_hour_project_count,
        COUNT(*) FILTER (
          WHERE pw.last_registration IS NOT NULL
             OR pw.last_fitter_hour_date IS NOT NULL
        )::int AS projects_with_wip_activity,
        COUNT(*) FILTER (
          WHERE pw.project_id IS NULL
             OR (pw.last_registration IS NULL AND pw.last_fitter_hour_date IS NULL)
        )::int AS projects_missing_wip_activity
      FROM source_projects sp
      LEFT JOIN project_wip pw
        ON pw.tenant_id = $1
       AND pw.project_id = sp.project_id
    `,
    [tenantId]
  );
  return rows[0] || {};
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const client = await pool.connect();

  try {
    if (args.statusOnly) {
      const tenant = await resolveTenant(client, args.tenant);
      const coverage = await readCoverage(client, tenant.id);
      console.log(JSON.stringify({
        event: 'project_activity_materialize_status',
        tenant_slug: tenant.slug,
        tenant_id: tenant.id,
        ...coverage,
      }));
      return;
    }

    await client.query('BEGIN');
    const tenant = await resolveTenant(client, args.tenant);
    const before = await readCoverage(client, tenant.id);
    const result = await materializeProjectActivityFromFitterHours(client, {
      tenantId: tenant.id,
    });
    const after = await readCoverage(client, tenant.id);

    if (args.dryRun) {
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
    }

    console.log(JSON.stringify({
      event: 'project_activity_materialize_finished',
      mode: args.dryRun ? 'dry-run' : 'apply',
      tenant_slug: tenant.slug,
      tenant_id: tenant.id,
      before,
      materialize_result: result,
      after,
      committed: args.apply,
    }));
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_rollbackError) {
      // no-op
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error(JSON.stringify({
    event: 'project_activity_materialize_failed',
    error: error.message,
  }));
  process.exitCode = 1;
});
