'use strict';

/*
 * Permanent targeted fitterhours refresh model, phase 2.
 *
 * Admin/maintenance command for one project at a time through:
 * GET /api/v4/projects/id/{EK ProjectID}
 *
 * Apply is intentionally narrow: it requires a concrete tenant, one concrete
 * project reference or project id, and an exact confirmation token.
 */

const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const pool = require('../src/db/pool');
const {
  PROJECT_DETAIL_ENDPOINT,
  resolveTenantConfig,
  preCheckProjectFitterhoursRefresh,
  refreshProjectFitterhours,
} = require('../src/services/fitterhoursRefreshService');

const JOB_NAME = 'project-targeted-fitterhours-refresh-admin';

function usage() {
  return [
    'Usage:',
    '  node scripts/project_targeted_fitterhours_refresh_admin.js --tenant hoyrup-clemmensen --project-ref 13838 --dry-run',
    '  node scripts/project_targeted_fitterhours_refresh_admin.js --tenant hoyrup-clemmensen --project-ref 13838 --apply --confirm APPLY:project-targeted-fitterhours-refresh-admin:hoyrup-clemmensen:13838',
    '  node scripts/project_targeted_fitterhours_refresh_admin.js --tenant hoyrup-clemmensen --project-id <uuid> --apply --confirm APPLY:project-targeted-fitterhours-refresh-admin:hoyrup-clemmensen:<uuid>',
    '',
    'Options:',
    '  --tenant <slug-or-domain-or-id>  Tenant slug, domain, or tenant id.',
    '  --ek-project-id <id>             Optional EK internal ProjectID.',
    '  --project-ref <ref>              Fielddesk project reference.',
    '  --project-id <uuid>              Fielddesk project id.',
    '  --dry-run                        Fetch and gate-check without writes.',
    '  --apply                          Apply safe upsert and scoped activity materializer.',
    '  --confirm <token>                Required for apply.',
    '',
    'Apply requires --project-ref or --project-id. No batch or tenant-wide mode exists.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    tenant: null,
    ekProjectId: null,
    projectRef: null,
    projectId: null,
    dryRun: false,
    apply: false,
    confirm: null,
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
  if ([args.dryRun, args.apply].filter(Boolean).length !== 1) {
    throw new Error(`Provide exactly one of --dry-run or --apply for ${JOB_NAME}.`);
  }
  if (args.apply && !args.projectRef && !args.projectId) {
    throw new Error('Apply requires --project-ref or --project-id so the target is concrete.');
  }
  if (args.apply) {
    const target = args.projectRef || args.projectId;
    const expected = `APPLY:${JOB_NAME}:${String(args.tenant).trim().toLowerCase()}:${target}`;
    if (args.confirm !== expected) {
      throw new Error(`Apply requires --confirm ${expected}`);
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const client = await pool.connect();

  try {
    const tenantConfig = await resolveTenantConfig(client, { tenant: args.tenant });
    if (args.dryRun) {
      const preCheck = await preCheckProjectFitterhoursRefresh(client, {
        tenantConfig,
        ekProjectId: args.ekProjectId,
        projectId: args.projectId,
        projectRef: args.projectRef,
      });

      console.log(JSON.stringify({
        event: 'project_targeted_fitterhours_refresh_admin_dry_run',
        job: JOB_NAME,
        mode: 'dry-run',
        started_at: startedAt.toISOString(),
        finished_at: new Date().toISOString(),
        tenant: tenantConfig.slug,
        tenant_id: tenantConfig.tenantId,
        result: preCheck.status,
        pre_check: preCheck,
        safety: {
          endpoint_used: PROJECT_DETAIL_ENDPOINT,
          writes_to_fitter_hour_enabled: false,
          project_wip_activity_updates_enabled: false,
          materializer_enabled: false,
          sync_state_updates_enabled: false,
          scheduler_updates_enabled: false,
          tenant_wide_refresh_enabled: false,
          deletes_enabled: false,
        },
      }, null, 2));
      return;
    }

    const result = await refreshProjectFitterhours(client, {
      tenantConfig,
      ekProjectId: args.ekProjectId,
      projectId: args.projectId,
      projectRef: args.projectRef,
      triggerType: 'admin',
    });

    console.log(JSON.stringify({
      event: 'project_targeted_fitterhours_refresh_admin_apply',
      job: JOB_NAME,
      mode: 'apply',
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      tenant: tenantConfig.slug,
      tenant_id: tenantConfig.tenantId,
      result: result.status,
      run_id: result.runId,
      pre_check: result.preCheck,
      apply_result: result.applyResult,
      activity_result: result.activityResult,
      safety: {
        endpoint_used: PROJECT_DETAIL_ENDPOINT,
        writes_to_fitter_hour_enabled: result.status === 'success',
        project_wip_activity_updates_enabled: result.status === 'success',
        materializer_enabled: result.status === 'success',
        sync_state_updates_enabled: false,
        scheduler_updates_enabled: false,
        tenant_wide_refresh_enabled: false,
        deletes_enabled: false,
        broad_fitterhours_endpoint_used: false,
        fitterhours_query_endpoint_used: false,
      },
    }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: 'project_targeted_fitterhours_refresh_admin_failed',
    job: JOB_NAME,
    error: error.message,
  }));
  process.exit(1);
});
