'use strict';

/*
 * Render one-off maintenance dispatcher.
 *
 * This script is intentionally not generic. It accepts only whitelisted
 * Fielddesk maintenance jobs and maps them to fixed local scripts.
 */

const { spawn } = require('child_process');

const JOBS = {
  'project-v4-is-internal-resync': {
    script: 'scripts/resync_projects_v4_only.js',
    modes: new Set(['status-only', 'dry-run', 'apply']),
    requiresEkProjectId: false,
  },
  'project-targeted-fitterhours-backfill': {
    script: 'scripts/targeted_fitterhours_backfill.js',
    modes: new Set(['dry-run', 'analyze', 'apply']),
    requiresEkProjectId: true,
    acceptsProjectRef: false,
  },
  'project-targeted-fitterhours-refresh-v4': {
    script: 'scripts/targeted_fitterhours_refresh_v4.js',
    modes: new Set(['status-only', 'dry-run', 'apply']),
    requiresEkProjectId: true,
    acceptsProjectRef: true,
  },
  'project-activity-materialize': {
    script: 'scripts/materialize_project_activity_from_fitter_hour.js',
    modes: new Set(['status-only', 'dry-run', 'apply']),
    requiresEkProjectId: false,
    acceptsProjectRef: false,
  },
};
const TENANT_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ACTOR_PATTERN = /^[a-zA-Z0-9._@-]{1,128}$/;

function usage() {
  return [
    'Usage:',
    '  node scripts/fd_maintenance_job.js --job project-v4-is-internal-resync --mode dry-run --tenant hoyrup-clemmensen',
    '  node scripts/fd_maintenance_job.js --job project-v4-is-internal-resync --mode apply --tenant hoyrup-clemmensen --confirm APPLY:project-v4-is-internal-resync:hoyrup-clemmensen',
    '  node scripts/fd_maintenance_job.js --job project-targeted-fitterhours-backfill --mode dry-run --tenant hoyrup-clemmensen --ek-project-id 19687',
    '  node scripts/fd_maintenance_job.js --job project-targeted-fitterhours-backfill --mode analyze --tenant hoyrup-clemmensen --ek-project-id 19687',
    '  node scripts/fd_maintenance_job.js --job project-targeted-fitterhours-backfill --mode apply --tenant hoyrup-clemmensen --ek-project-id 19687 --confirm APPLY:project-targeted-fitterhours-backfill:hoyrup-clemmensen:19687',
    '  node scripts/fd_maintenance_job.js --job project-targeted-fitterhours-refresh-v4 --mode dry-run --tenant hoyrup-clemmensen --ek-project-id 25906 --project-ref 80396-003',
    '  node scripts/fd_maintenance_job.js --job project-targeted-fitterhours-refresh-v4 --mode apply --tenant hoyrup-clemmensen --ek-project-id 25906 --confirm APPLY:project-targeted-fitterhours-refresh-v4:hoyrup-clemmensen:25906',
    '  node scripts/fd_maintenance_job.js --job project-activity-materialize --mode dry-run --tenant hoyrup-clemmensen',
    '  node scripts/fd_maintenance_job.js --job project-activity-materialize --mode apply --tenant hoyrup-clemmensen --confirm APPLY:project-activity-materialize:hoyrup-clemmensen',
    '',
    'Allowed jobs:',
    '  project-v4-is-internal-resync',
    '  project-targeted-fitterhours-backfill',
    '  project-targeted-fitterhours-refresh-v4',
    '  project-activity-materialize',
    '',
    'Allowed modes:',
    '  status-only',
    '  dry-run',
    '  analyze',
    '  apply',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    job: null,
    mode: null,
    tenant: null,
    ekProjectId: null,
    projectRef: null,
    confirm: null,
    actor: process.env.FD_MAINTENANCE_ACTOR || 'unknown',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--job') {
      args.job = argv[++i] || null;
    } else if (arg === '--mode') {
      args.mode = argv[++i] || null;
    } else if (arg === '--tenant') {
      args.tenant = argv[++i] || null;
    } else if (arg === '--ek-project-id') {
      args.ekProjectId = argv[++i] || null;
    } else if (arg === '--project-ref') {
      args.projectRef = argv[++i] || null;
    } else if (arg === '--confirm') {
      args.confirm = argv[++i] || null;
    } else if (arg === '--actor') {
      args.actor = argv[++i] || null;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function validateArgs(args) {
  const job = JOBS[args.job];
  if (!job) {
    throw new Error(`Job is not allowed: ${args.job || '(missing)'}`);
  }
  if (!job.modes.has(args.mode)) {
    throw new Error(`Mode is not allowed for ${args.job}: ${args.mode || '(missing)'}`);
  }
  if (!args.tenant || !TENANT_PATTERN.test(args.tenant)) {
    throw new Error('Provide --tenant as a lower-case tenant slug.');
  }
  if (!args.actor || !ACTOR_PATTERN.test(args.actor)) {
    throw new Error('Actor may only contain letters, numbers, dot, underscore, at-sign, or dash.');
  }
  if (job.requiresEkProjectId && (!args.ekProjectId || !/^\d+$/.test(String(args.ekProjectId)))) {
    throw new Error(`${args.job} requires --ek-project-id as a numeric EK ProjectID.`);
  }
  if (!job.requiresEkProjectId && args.ekProjectId) {
    throw new Error(`${args.job} does not accept --ek-project-id.`);
  }
  if (args.projectRef && !job.acceptsProjectRef) {
    throw new Error(`${args.job} does not accept --project-ref.`);
  }
  if (args.projectRef && !/^[a-zA-Z0-9._-]{1,128}$/.test(String(args.projectRef))) {
    throw new Error('Project ref may only contain letters, numbers, dot, underscore, or dash.');
  }
  if (args.mode === 'apply') {
    const expected = job.requiresEkProjectId
      ? `APPLY:${args.job}:${args.tenant}:${args.ekProjectId}`
      : `APPLY:${args.job}:${args.tenant}`;
    if (args.confirm !== expected) {
      throw new Error(`Apply mode requires --confirm ${expected}`);
    }
  }
  return job;
}

function childArgsFor({ job, args }) {
  const childArgs = [job.script];

  childArgs.push('--tenant', args.tenant);
  if (job.requiresEkProjectId) {
    childArgs.push('--ek-project-id', args.ekProjectId);
  }
  if (job.acceptsProjectRef && args.projectRef) {
    childArgs.push('--project-ref', args.projectRef);
  }

  if (args.mode === 'status-only') {
    childArgs.push('--status-only');
  } else if (args.mode === 'dry-run') {
    childArgs.push('--dry-run');
  } else if (args.mode === 'analyze') {
    childArgs.push('--analyze');
  } else if (args.mode === 'apply') {
    childArgs.push('--apply', '--confirm', args.confirm);
  }

  return childArgs;
}

async function runChild(commandArgs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, commandArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
      shell: false,
    });

    child.on('close', (code, signal) => {
      resolve({ code, signal });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const job = validateArgs(args);
  const startedAt = new Date();
  const tenant = args.tenant;

  console.log(JSON.stringify({
    event: 'maintenance_job_started',
    at: startedAt.toISOString(),
    job: args.job,
    mode: args.mode,
    tenant,
    actor: args.actor || 'unknown',
  }));

  const result = await runChild(childArgsFor({ job, args }));
  const finishedAt = new Date();
  const status = result.code === 0 ? 'succeeded' : 'failed';

  console.log(JSON.stringify({
    event: 'maintenance_job_finished',
    at: finishedAt.toISOString(),
    job: args.job,
    mode: args.mode,
    tenant,
    actor: args.actor || 'unknown',
    status,
    exit_code: result.code,
    signal: result.signal,
    duration_ms: finishedAt.getTime() - startedAt.getTime(),
  }));

  process.exit(result.code || 0);
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: 'maintenance_job_rejected',
    at: new Date().toISOString(),
    error: error.message,
  }));
  process.exit(1);
});
