'use strict';

const JOB_NAME = 'project-v4-is-internal-resync';
const MODES = new Set(['status-only', 'dry-run', 'apply']);
const TENANT_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ACTOR_PATTERN = /^[a-zA-Z0-9._@-]{1,128}$/;
const WORKDIR_PATTERN = /^[a-zA-Z0-9._/-]+$/;

function usage() {
  return [
    'Usage:',
    `  node tools/render_maintenance_job.js --job ${JOB_NAME} --mode status-only --tenant <tenant> [--actor <actor>]`,
    `  node tools/render_maintenance_job.js --job ${JOB_NAME} --mode dry-run --tenant <tenant> [--actor <actor>]`,
    `  node tools/render_maintenance_job.js --job ${JOB_NAME} --mode apply --tenant <tenant> --confirm APPLY:${JOB_NAME}:<tenant> [--actor <actor>]`,
    '',
    'Environment:',
    '  RENDER_API_KEY                  Required. Never logged.',
    '  FIELD_DESK_RENDER_SERVICE_ID    Required unless --service-id is passed.',
    '  FD_MAINTENANCE_ACTOR            Optional default actor.',
    '  FD_RENDER_JOB_WORKDIR           Optional explicit remote working directory.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    actor: process.env.FD_MAINTENANCE_ACTOR || process.env.USERNAME || process.env.USER || 'unknown',
    serviceId: process.env.FIELD_DESK_RENDER_SERVICE_ID || process.env.RENDER_SERVICE_ID || '',
    remoteWorkdir: process.env.FD_RENDER_JOB_WORKDIR || '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }

    if (!token.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }

    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    i += 1;

    if (key === 'job') args.job = value;
    else if (key === 'mode') args.mode = value;
    else if (key === 'tenant') args.tenant = value;
    else if (key === 'confirm') args.confirm = value;
    else if (key === 'actor') args.actor = value;
    else if (key === 'service-id') args.serviceId = value;
    else if (key === 'remote-workdir') args.remoteWorkdir = value;
    else throw new Error(`Unknown argument: --${key}`);
  }

  return args;
}

function validateArgs(args) {
  if (args.help) return;
  if (args.job !== JOB_NAME) {
    throw new Error(`Unsupported job: ${args.job || '(missing)'}`);
  }
  if (!MODES.has(args.mode)) {
    throw new Error(`Unsupported mode: ${args.mode || '(missing)'}`);
  }
  if (!args.tenant || !TENANT_PATTERN.test(args.tenant)) {
    throw new Error('Tenant must be a lower-case slug, for example "hoyrup-clemmensen".');
  }
  if (!args.actor || !ACTOR_PATTERN.test(args.actor)) {
    throw new Error('Actor may only contain letters, numbers, dot, underscore, at-sign, or dash.');
  }
  if (!args.serviceId) {
    throw new Error('Missing Render service id. Set FIELD_DESK_RENDER_SERVICE_ID or pass --service-id.');
  }
  if (!process.env.RENDER_API_KEY) {
    throw new Error('Missing RENDER_API_KEY.');
  }
  if (args.remoteWorkdir && !WORKDIR_PATTERN.test(args.remoteWorkdir)) {
    throw new Error('Remote working directory contains unsupported characters.');
  }
  if (args.mode === 'apply') {
    const expected = `APPLY:${JOB_NAME}:${args.tenant}`;
    if (args.confirm !== expected) {
      throw new Error(`Apply requires --confirm ${expected}`);
    }
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function buildRenderCommand(args) {
  const remoteArgs = [
    'scripts/fd_maintenance_job.js',
    '--job',
    args.job,
    '--mode',
    args.mode,
    '--tenant',
    args.tenant,
    '--actor',
    args.actor,
  ];

  if (args.mode === 'apply') {
    remoteArgs.push('--confirm', args.confirm);
  }

  const nodeCommand = `node ${remoteArgs.map(shellQuote).join(' ')}`;
  if (!args.remoteWorkdir) {
    return nodeCommand;
  }
  return `cd ${shellQuote(args.remoteWorkdir)} && ${nodeCommand}`;
}

async function createRenderJob(args) {
  const encodedServiceId = encodeURIComponent(args.serviceId);
  const endpoint = ['https://api.render.com/v1/services', encodedServiceId, 'jobs'].join('/');
  const body = {
    startCommand: buildRenderCommand(args),
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RENDER_API_KEY}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  let payload = null;
  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch (_error) {
      payload = { raw: responseText.slice(0, 1000) };
    }
  }

  if (!response.ok) {
    const message = payload?.message || payload?.error || response.statusText || 'Render API request failed';
    const error = new Error(`Render API returned ${response.status}: ${message}`);
    error.payload = payload;
    throw error;
  }

  return payload || {};
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  validateArgs(args);

  const startedAt = new Date().toISOString();
  console.log(JSON.stringify({
    event: 'render_maintenance_job_request',
    job: args.job,
    mode: args.mode,
    tenant: args.tenant,
    actor: args.actor,
    service_id: args.serviceId,
    started_at: startedAt,
  }));

  const payload = await createRenderJob(args);
  const job = payload.job || payload;
  const renderJobId = job.id || payload.id || null;

  console.log(JSON.stringify({
    event: 'render_maintenance_job_queued',
    job: args.job,
    mode: args.mode,
    tenant: args.tenant,
    actor: args.actor,
    service_id: args.serviceId,
    render_job_id: renderJobId,
    status: job.status || payload.status || 'queued',
    started_at: startedAt,
    queued_at: new Date().toISOString(),
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: 'render_maintenance_job_failed',
    message: error.message,
  }));
  process.exitCode = 1;
});
