# Fielddesk maintenance jobs

Fielddesk maintenance jobs are manually triggered operational tasks that run on Render with the same deployed backend artifact and Render-managed environment variables as the live backend.

This document covers the phase 1 dry-run model and phase 2 admin one-project
apply model.

## Phase 1 scope

Supported jobs:

```text
project-v4-is-internal-resync
project-targeted-fitterhours-backfill
project-targeted-fitterhours-refresh-dry-run
project-targeted-fitterhours-refresh-admin
```

Supported modes:

```text
status-only
dry-run
apply
```

`project-v4-is-internal-resync` supports `status-only`, `dry-run`, and `apply`.

`project-targeted-fitterhours-backfill` supports `dry-run` and a deliberately narrow `apply` for the verified control case.

`project-targeted-fitterhours-refresh-dry-run` supports only `dry-run` for one
project. It is the phase 1 command for the permanent targeted fitterhours
refresh model.

`project-targeted-fitterhours-refresh-admin` supports `dry-run` and a guarded
one-project `apply`. It is the phase 2 admin/maintenance command. It is not a
UI, scheduler, batch, tenant-wide, dashboard, project-list, or onboarding flow.

The local trigger is intentionally not a generic shell runner. It can only request whitelisted jobs and whitelisted modes.

The remote dispatcher is also intentionally narrow. It can only dispatch to:

```text
backend/scripts/resync_projects_v4_only.js
backend/scripts/targeted_fitterhours_backfill.js
backend/scripts/project_targeted_fitterhours_refresh_dry_run.js
backend/scripts/project_targeted_fitterhours_refresh_admin.js
```

The dispatcher does not run bootstrap sync, migrations, arbitrary commands, or free-form shell input.

## Project-targeted fitterhours refresh dry-run

Phase 1 of the permanent refresh model supports pre-check/dry-run for exactly
one project through:

```text
GET /api/v4/projects/id/{EK ProjectID}
```

It does not insert, update, or delete `fitter_hour` rows. It does not run the
activity materializer, change `project_wip`, update sync-state, or change
scheduler behavior.

Command by project reference:

```powershell
node tools/render_maintenance_job.js `
  --job project-targeted-fitterhours-refresh-dry-run `
  --mode dry-run `
  --tenant hoyrup-clemmensen `
  --project-ref 13838 `
  --actor dep
```

Command by EK ProjectID plus reference guard:

```powershell
node tools/render_maintenance_job.js `
  --job project-targeted-fitterhours-refresh-dry-run `
  --mode dry-run `
  --tenant hoyrup-clemmensen `
  --ek-project-id 25000 `
  --project-ref 10889-005 `
  --actor dep
```

The dry-run reports:

- reference match and live EK reference;
- remote and mapped fitterhour row counts;
- duplicate remote `source_key` count;
- cross-project `source_key` conflict count;
- `fd_project_id` mismatch count;
- expected inserts, updates, and unchanged rows;
- size class.

Optional `--record-audit` can write only refresh status/run audit once the phase
1 migration has been applied. It still must not write `fitter_hour`,
`project_wip`, sync-state, or scheduler state.

## Project-targeted fitterhours refresh admin apply

Phase 2 supports controlled admin apply for exactly one project through:

```text
GET /api/v4/projects/id/{EK ProjectID}
```

It must not call:

```text
GET /api/v4/fitterhours?searchAttribute=ProjectID
POST /api/v4/fitterhours/query
```

Dry-run:

```powershell
node tools/render_maintenance_job.js `
  --job project-targeted-fitterhours-refresh-admin `
  --mode dry-run `
  --tenant hoyrup-clemmensen `
  --project-ref 13838 `
  --actor dep
```

Apply:

```powershell
node tools/render_maintenance_job.js `
  --job project-targeted-fitterhours-refresh-admin `
  --mode apply `
  --tenant hoyrup-clemmensen `
  --project-ref 13838 `
  --confirm APPLY:project-targeted-fitterhours-refresh-admin:hoyrup-clemmensen:13838 `
  --actor dep
```

Apply is allowed only when every gate passes:

- local FD reference matches live EK reference;
- duplicate remote `source_key` count is 0;
- cross-project `source_key` conflict count is 0;
- `fd_project_id` mismatch count is 0;
- size class is not `LARGE`;
- the project is not blocked.

Blocked outcomes write audit/status only and must not write `fitter_hour` or run
the activity materializer:

- `blocked_reference_mismatch`
- `blocked_cross_project_conflict`
- `blocked_fd_project_mismatch`
- `blocked_duplicate_source_keys`
- `blocked_large`

Successful apply uses safe upsert semantics:

- update only existing rows on the same `fd_project_id`;
- insert only when `source_key` does not already exist;
- never move or reparent a `source_key` between projects;
- never delete rows.

After successful apply, the scoped project activity materializer runs only for
the refreshed project.

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

## Project-targeted fitterhours backfill dry-run

Phase 1 supports dry-run for a single EK internal ProjectID and apply only for the verified control case.

Example control case:

```text
FD reference: 26794
EK ProjectID: 19687
```

Command:

```powershell
node tools/render_maintenance_job.js `
  --job project-targeted-fitterhours-backfill `
  --mode dry-run `
  --tenant hoyrup-clemmensen `
  --ek-project-id 19687 `
  --actor dep
```

Analyze command:

```powershell
node tools/render_maintenance_job.js `
  --job project-targeted-fitterhours-backfill `
  --mode analyze `
  --tenant hoyrup-clemmensen `
  --ek-project-id 19687 `
  --actor dep
```

Apply command:

```powershell
node tools/render_maintenance_job.js `
  --job project-targeted-fitterhours-backfill `
  --mode apply `
  --tenant hoyrup-clemmensen `
  --ek-project-id 19687 `
  --confirm APPLY:project-targeted-fitterhours-backfill:hoyrup-clemmensen:19687 `
  --actor dep
```

Remote command:

```text
node scripts/fd_maintenance_job.js
  --job project-targeted-fitterhours-backfill
  --mode dry-run
  --tenant hoyrup-clemmensen
  --ek-project-id 19687
```

The dry-run calls only:

```text
GET /api/v3.0/fitterhours?page=<n>&pageSize=1000&searchAttribute=ProjectID&search=<EK ProjectID>
```

It reports:

- EK rows fetched
- total hours
- unique employees
- matched FD project id
- existing matching rows in `fitter_hour`
- rows that would insert, update, or skip
- after apply: inserted, updated, skipped, total hours after, and unique employees after

Analyze is read-only and does not call E-Komplet. It inspects existing `fitter_hour`
rows for the resolved FD project and reports:

- all rows, candidate rows, and excluded rows
- hours and unique technicians for each group
- per-technician all/candidate/excluded hours
- per-category/londel/unit candidate status
- excluded rows with category, unit, source key, and filter reasons

Apply safety:

- only `tenant=hoyrup-clemmensen` and `EK ProjectID=19687` are accepted in this slice
- confirmation must exactly match `APPLY:project-targeted-fitterhours-backfill:hoyrup-clemmensen:19687`
- every EK row must have `ProjectID=19687`
- the FD project must resolve through `project_masterdata_v4.ek_project_id`
- no delete is performed
- no bootstrap is run
- no broad fitterhours sync is run
- no sync state is updated

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

Verified Render service facts are documented in
`backend/docs/operations/render_service.md`.

Note: the service id is verified as `srv-d6h0h8fgi27c73a99jgg`, but it is not
necessarily set in the local environment. The current local trigger expects
`FIELD_DESK_RENDER_SERVICE_ID`; configure it through approved local/ops secret
handling or look it up through the Render API before running maintenance jobs.

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
- `project-targeted-fitterhours-backfill` rejects apply unless the tenant, EK ProjectID, and confirmation match the verified control case.
- `project-targeted-fitterhours-refresh-admin` rejects apply unless a concrete
  `--project-ref` or `--project-id` and exact confirmation token are supplied.
- Tenant slugs are validated before the Render job is created.
- The remote dispatcher uses Node child process execution without shell expansion.
- The Render API key is read only from environment variables and is never printed.

## Current limitations

- Phase 1 logging is stdout-based through Render job logs.
- There is no `maintenance_job_run` database table yet.
- There is no admin UI or HTTP endpoint yet.
- Job completion polling is not implemented in the local trigger yet; the trigger returns the Render job id and queue status.

If recurring operational use grows, add a dedicated audit table before adding more job types.
