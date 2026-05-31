# Fielddesk maintenance jobs

Fielddesk maintenance jobs are manually triggered operational tasks that run on Render with the same deployed backend artifact and Render-managed environment variables as the live backend.

This document covers the phase 1 model only.

## Phase 1 scope

Supported job:

```text
project-v4-is-internal-resync
```

Supported modes:

```text
status-only
dry-run
apply
```

The local trigger is intentionally not a generic shell runner. It can only request this whitelisted job and these whitelisted modes.

The remote dispatcher is also intentionally narrow. It can only dispatch to:

```text
backend/scripts/resync_projects_v4_only.js
```

The dispatcher does not run fitterhours sync, bootstrap sync, migrations, arbitrary commands, or free-form shell input.

## Flow

```text
VS Code / Codex
  |
  | node tools/render_maintenance_job.js
  |   --job project-v4-is-internal-resync
  |   --mode dry-run
  |   --tenant hoyrup-clemmensen
  |
  v
Render API one-off job
  |
  v
node backend/scripts/fd_maintenance_job.js
  --job project-v4-is-internal-resync
  --mode dry-run
  --tenant hoyrup-clemmensen
  |
  v
node backend/scripts/resync_projects_v4_only.js
  --tenant hoyrup-clemmensen
  --dry-run
```

## Required local environment

The local trigger reads these values from environment variables:

```text
RENDER_API_KEY
FIELD_DESK_RENDER_SERVICE_ID
```

Optional:

```text
FD_MAINTENANCE_ACTOR
```

`RENDER_API_KEY` must never be committed, echoed, or logged. It should live only in a local secret store, shell environment, or approved CI/ops secret configuration.

## Status-only

```powershell
node tools/render_maintenance_job.js `
  --job project-v4-is-internal-resync `
  --mode status-only `
  --tenant hoyrup-clemmensen `
  --actor dep
```

## Dry-run

```powershell
node tools/render_maintenance_job.js `
  --job project-v4-is-internal-resync `
  --mode dry-run `
  --tenant hoyrup-clemmensen `
  --actor dep
```

## Apply

Apply requires an explicit confirmation string that includes the job name and tenant.

```powershell
node tools/render_maintenance_job.js `
  --job project-v4-is-internal-resync `
  --mode apply `
  --tenant hoyrup-clemmensen `
  --confirm APPLY:project-v4-is-internal-resync:hoyrup-clemmensen `
  --actor dep
```

## Safety rules

- No generic command input is accepted.
- Unknown jobs are rejected locally and remotely.
- Unknown modes are rejected locally and remotely.
- Apply mode is rejected unless the exact confirmation string is supplied.
- Tenant slugs are validated before the Render job is created.
- The remote dispatcher uses Node child process execution without shell expansion.
- The Render API key is read only from environment variables and is never printed.

## Current limitations

- Phase 1 logging is stdout-based through Render job logs.
- There is no `maintenance_job_run` database table yet.
- There is no admin UI or HTTP endpoint yet.
- Job completion polling is not implemented in the local trigger yet; the trigger returns the Render job id and queue status.

If recurring operational use grows, add a dedicated audit table before adding more job types.
