'use strict';

/*
 * User-scoped project fitterhours refresh.
 *
 * Dry-run is read-only and uses GET /api/v4/projects/id/{EK ProjectID} per
 * active project the user can already see. Apply is guarded and still never
 * creates project access from fitterhours.
 */

const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const pool = require('../src/db/pool');
const {
  PROJECT_DETAIL_ENDPOINT,
  resolveTenantConfig,
  preCheckUserProjectsFitterhoursRefresh,
  refreshUserProjectsFitterhours,
} = require('../src/services/fitterhoursRefreshService');

const JOB_NAME = 'user-project-fitterhours-refresh';

function usage() {
  return [
    'Usage:',
    '  node scripts/user_project_fitterhours_refresh.js --tenant hoyrup-clemmensen --user-code DEP --dry-run',
    '  node scripts/user_project_fitterhours_refresh.js --tenant hoyrup-clemmensen --user-id <uuid> --dry-run',
    '  node scripts/user_project_fitterhours_refresh.js --tenant hoyrup-clemmensen --user-code DEP --apply --confirm APPLY:user-project-fitterhours-refresh:hoyrup-clemmensen:DEP',
    '',
    'Options:',
    '  --tenant <slug-or-domain-or-id>  Tenant slug, domain, or tenant id.',
    '  --user-code <code>               Tenant user username/short code, e.g. DEP.',
    '  --user-id <uuid>                 Tenant user id.',
    '  --limit <n>                      Max projects, default 500.',
    '  --dry-run                        Fetch and gate-check without writes.',
    '  --apply                          Apply safe per-project refresh.',
    '  --confirm <token>                Required for apply.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    tenant: null,
    userCode: null,
    userId: null,
    limit: 500,
    dryRun: false,
    apply: false,
    confirm: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tenant') args.tenant = argv[++i] || null;
    else if (arg === '--user-code') args.userCode = argv[++i] || null;
    else if (arg === '--user-id') args.userId = argv[++i] || null;
    else if (arg === '--limit') args.limit = Number(argv[++i] || 0);
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--confirm') args.confirm = argv[++i] || null;
    else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.tenant || !/^[a-zA-Z0-9._:-]{1,255}$/.test(String(args.tenant).trim())) {
    throw new Error('Provide --tenant as a tenant slug, domain, or id.');
  }
  if (args.userCode && !/^[a-zA-Z0-9._-]{1,64}$/.test(String(args.userCode).trim())) {
    throw new Error('User code may only contain letters, numbers, dot, underscore, or dash.');
  }
  if (args.userId && !/^[0-9a-fA-F-]{36}$/.test(String(args.userId).trim())) {
    throw new Error('User id must be a UUID.');
  }
  if (!args.userCode && !args.userId) {
    throw new Error('Provide --user-code or --user-id.');
  }
  if ([args.dryRun, args.apply].filter(Boolean).length !== 1) {
    throw new Error(`Provide exactly one of --dry-run or --apply for ${JOB_NAME}.`);
  }
  if (!Number.isFinite(args.limit) || args.limit < 1 || args.limit > 2000) {
    throw new Error('--limit must be between 1 and 2000.');
  }
  if (args.apply) {
    const target = args.userCode || args.userId;
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
    const runner = args.dryRun
      ? preCheckUserProjectsFitterhoursRefresh
      : refreshUserProjectsFitterhours;
    const result = await runner(client, {
      tenantConfig,
      userId: args.userId,
      userCode: args.userCode,
      limit: args.limit,
      triggerType: 'maintenance',
    });

    console.log(JSON.stringify({
      event: args.dryRun
        ? 'user_project_fitterhours_refresh_dry_run'
        : 'user_project_fitterhours_refresh_apply',
      job: JOB_NAME,
      mode: args.dryRun ? 'dry-run' : 'apply',
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      tenant: tenantConfig.slug,
      tenant_id: tenantConfig.tenantId,
      user: result.user,
      endpoint: PROJECT_DETAIL_ENDPOINT,
      projects_considered: result.projectsConsidered,
      summary: result.summary,
      results: result.results,
      safety: {
        ...result.safety,
        calendar_assignment_enabled: false,
        resource_group_assignment_enabled: false,
        tenant_wide_refresh_enabled: false,
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
    event: 'user_project_fitterhours_refresh_failed',
    job: JOB_NAME,
    error: error.message,
  }));
  process.exit(1);
});
