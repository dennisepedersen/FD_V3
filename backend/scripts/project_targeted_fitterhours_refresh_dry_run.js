'use strict';

/*
 * Permanent targeted fitterhours refresh model, phase 1.
 *
 * This command only runs read-only pre-check/dry-run for one project through:
 * GET /api/v4/projects/id/{EK ProjectID}
 *
 * It never writes fitter_hour rows, runs the activity materializer, updates
 * sync state, or starts scheduler/full-sync work.
 */

const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const pool = require('../src/db/pool');
const {
  resolveTenantConfig,
  preCheckProjectFitterhoursRefresh,
  recordRefreshRun,
  updateRefreshStatus,
} = require('../src/services/fitterhoursRefreshService');

const JOB_NAME = 'project-targeted-fitterhours-refresh-dry-run';

function usage() {
  return [
    'Usage:',
    '  node scripts/project_targeted_fitterhours_refresh_dry_run.js --tenant hoyrup-clemmensen --project-ref 13838',
    '  node scripts/project_targeted_fitterhours_refresh_dry_run.js --tenant hoyrup-clemmensen --ek-project-id 25000 --project-ref 10889-005',
    '  node scripts/project_targeted_fitterhours_refresh_dry_run.js --tenant hoyrup-clemmensen --project-id <uuid>',
    '',
    'Options:',
    '  --tenant <slug-or-domain-or-id>  Tenant slug, domain, or tenant id.',
    '  --ek-project-id <id>             Optional EK internal ProjectID.',
    '  --project-ref <ref>              Optional Fielddesk project reference.',
    '  --project-id <uuid>              Optional Fielddesk project id.',
    '  --record-audit                   Optional: write run/status audit only.',
    '',
    'No apply mode exists for this command.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    tenant: null,
    ekProjectId: null,
    projectRef: null,
    projectId: null,
    recordAudit: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tenant') {
      args.tenant = argv[++i] || null;
    } else if (arg === '--ek-project-id') {
      args.ekProjectId = argv[++i] || null;
    } else if (arg === '--project-ref') {
      args.projectRef = argv[++i] || null;
    } else if (arg === '--project-id') {
      args.projectId = argv[++i] || null;
    } else if (arg === '--record-audit') {
      args.recordAudit = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else if (arg === '--apply' || arg === '--confirm') {
      throw new Error(`${JOB_NAME} does not support apply or confirm arguments.`);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.tenant || !/^[a-zA-Z0-9._:-]{1,255}$/.test(String(args.tenant).trim())) {
    throw new Error('Provide --tenant as a tenant slug, domain, or id.');
  }
  if (args.ekProjectId && !/^\d+$/.test(String(args.ekProjectId).trim())) {
    throw new Error('If provided, --ek-project-id must be numeric.');
  }
  if (args.projectRef && !/^[a-zA-Z0-9._-]{1,128}$/.test(String(args.projectRef).trim())) {
    throw new Error('Project ref may only contain letters, numbers, dot, underscore, or dash.');
  }
  if (args.projectId && !/^[0-9a-fA-F-]{36}$/.test(String(args.projectId).trim())) {
    throw new Error('Project id must be a UUID.');
  }
  if (!args.ekProjectId && !args.projectRef && !args.projectId) {
    throw new Error('Provide at least one of --ek-project-id, --project-ref, or --project-id.');
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const client = await pool.connect();

  try {
    const tenantConfig = await resolveTenantConfig(client, { tenant: args.tenant });
    const preCheck = await preCheckProjectFitterhoursRefresh(client, {
      tenantConfig,
      ekProjectId: args.ekProjectId,
      projectId: args.projectId,
      projectRef: args.projectRef,
    });

    let audit = null;
    if (args.recordAudit) {
      await client.query('BEGIN');
      try {
        await updateRefreshStatus(client, {
          tenantId: tenantConfig.tenantId,
          projectId: preCheck.project.fdProjectId,
          ekProjectId: preCheck.project.ekProjectId,
          externalProjectRef: preCheck.project.externalProjectRef,
          preCheckResult: preCheck,
        });
        const runId = await recordRefreshRun(client, {
          tenantId: tenantConfig.tenantId,
          projectId: preCheck.project.fdProjectId,
          ekProjectId: preCheck.project.ekProjectId,
          externalProjectRef: preCheck.project.externalProjectRef,
          triggerType: 'maintenance',
          preCheckResult: preCheck,
          startedAt,
          finishedAt: new Date(),
        });
        await client.query('COMMIT');
        audit = { recorded: true, runId };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    console.log(JSON.stringify({
      event: 'project_targeted_fitterhours_refresh_dry_run',
      job: JOB_NAME,
      mode: 'dry-run',
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      tenant: tenantConfig.slug,
      tenant_id: tenantConfig.tenantId,
      result: preCheck.status,
      pre_check: preCheck,
      audit,
      safety: {
        endpoint_used: preCheck.endpoint,
        writes_to_fitter_hour_enabled: false,
        project_wip_activity_updates_enabled: false,
        materializer_enabled: false,
        sync_state_updates_enabled: false,
        scheduler_updates_enabled: false,
        deletes_enabled: false,
      },
    }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: 'project_targeted_fitterhours_refresh_dry_run_failed',
    job: JOB_NAME,
    error: error.message,
  }));
  process.exit(1);
});
