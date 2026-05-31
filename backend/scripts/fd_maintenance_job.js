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
  },
};
const TENANT_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ACTOR_PATTERN = /^[a-zA-Z0-9._@-]{1,128}$/;

function usage() {
  return [
    'Usage:',
    '  node scripts/fd_maintenance_job.js --job project-v4-is-internal-resync --mode dry-run --tenant hoyrup-clemmensen',
    '  node scripts/fd_maintenance_job.js --job project-v4-is-internal-resync --mode apply --tenant hoyrup-clemmensen --confirm APPLY:project-v4-is-internal-resync:hoyrup-clemmensen',
    '',
    'Allowed jobs:',
    '  project-v4-is-internal-resync',
    '',
    'Allowed modes:',
    '  status-only',
    '  dry-run',
    '  apply',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    job: null,
    mode: null,
    tenant: null,
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
  if (args.mode === 'apply') {
    const expected = `APPLY:${args.job}:${args.tenant}`;
    if (args.confirm !== expected) {
      throw new Error(`Apply mode requires --confirm ${expected}`);
    }
  }
  return job;
}

function childArgsFor({ job, args }) {
  const childArgs = [job.script];

  childArgs.push('--tenant', args.tenant);

  if (args.mode === 'status-only') {
    childArgs.push('--status-only');
  } else if (args.mode === 'dry-run') {
    childArgs.push('--dry-run');
  } else if (args.mode === 'apply') {
    childArgs.push('--apply');
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
