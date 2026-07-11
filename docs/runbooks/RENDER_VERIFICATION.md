# Render Verification Runbook

Status: current runbook
Scope: read-only service/deploy checks, one-off PR-head smoke, and live passive sanity.

## Known Service

The production web service is documented in `backend/docs/operations/render_service.md`:

- Service ID: `srv-d6h0h8fgi27c73a99jgg`
- Live backend health: `https://fielddeskai.onrender.com/health`
- Tenant smoke host: `https://hoyrup-clemmensen.fielddesk.dk`

`RENDER_API_KEY` may exist in the operator environment. Never print it.

## CLI And API

The Render CLI is not guaranteed to be installed locally. If it is missing, use the Render REST API with the known service id. Do not list all services first when the target id is already known.

Read-only service/deploy status:

```powershell
$headers = @{ Authorization = "Bearer $env:RENDER_API_KEY"; Accept = 'application/json' }
Invoke-RestMethod -Method Get -Uri "https://api.render.com/v1/services/srv-d6h0h8fgi27c73a99jgg/deploys?limit=5" -Headers $headers
```

## One-Off PR-Head Smoke

Use a self-checking job command. A `succeeded` job is only trustworthy when the command exits nonzero on every failed assertion.

Recommended markers:

- `SMOKE_START`
- `STATIC_ASSERTIONS_PASS`
- `ROUTE_SMOKE_PASS`
- `SMOKE_PASS`

PR-head smoke should:

- download the exact PR head commit tarball
- run in a temp directory
- reuse `/opt/render/project/src/backend/node_modules` when safe
- set `NODE_ENV=test`
- avoid migrations, invites, sync, user creation, and DB writes
- use clear stdout markers
- exit nonzero on assertion failure

Render one-off working directory is often `/opt/render/project/src/backend`, but PR-head tarball jobs should not assume `origin` exists in the live checkout.


## One-Off Job Logs

One-off job stdout/stderr can be separate from ordinary service logs. Service logs alone are not necessarily enough for PR-head smoke evidence.

Concrete safe flow:

1. Create the one-off job.
2. Note the returned job id.
3. Poll the job status until it reaches a terminal state.
4. Fetch logs through the Render logs API using the job id as the resource/filter.
5. Check the expected stdout markers:
   - `SMOKE_START`
   - `STATIC_ASSERTIONS_PASS`
   - `ROUTE_SMOKE_PASS`
   - `SMOKE_PASS`
6. Treat missing markers, nonzero exit, or non-terminal/failed job status as verification failure.

Safe PowerShell shape, without printing `RENDER_API_KEY`:

```powershell
$headers = @{ Authorization = "Bearer $env:RENDER_API_KEY"; Accept = 'application/json' }
$jobId = '<job-id>'
# Use the Render logs API with the job id as resource/filter. Keep the API key only in headers.
# Then inspect the returned log lines for SMOKE_* markers and failures.
```

A job status of `succeeded` is only credible when the command is self-checking and the logs contain the expected markers.

## Worker Side Effects

`backend/src/app.js` imports and calls `startSyncWorker()`. The worker returns early when `NODE_ENV=test`. Runtime smoke jobs should set `NODE_ENV=test` or monkeypatch worker startup before importing app code.

## Live Passive Sanity

After deploy, passive sanity can check:

- `/health`
- `/api/health`
- tenant HTML routes such as `/login`, `/indstillinger`, `/accept-invite?token=invalid`
- static asset routes such as `/tenant/auth.js` and `/tenant/auth.js?v=<live-version>`
- cache headers and content type
- absence of mojibake and token/hash leak markers

Do not use live passive sanity to send invitations, create users, run sync, or apply migrations.
