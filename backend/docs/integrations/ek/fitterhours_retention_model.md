# EK Fitterhours Retention Model

Status: verified decision / implementation pending
Date: 2026-05-31
Evidence: read-only live EK and FD database verification for tenant `hoyrup-clemmensen`

## Verified Source Fields

E-Komplet exposes project internal/external state separately from project lifecycle:

| Source | Field | Type | Meaning | FD persistence today |
|---|---|---|---|---|
| v4 LIST `/api/v4.0/projects` | `isIntern` | boolean | Project is internal | Not persisted |
| v4 DETAIL `/api/v4.0/projects/:id` | `IsInternal` | boolean | Project is internal | Not persisted |
| v4 LIST `/api/v4.0/projects` | `isClosed` | boolean | Project lifecycle closed/open | Persisted as `project_core.is_closed` / `project_masterdata_v4.is_closed` |
| v4 LIST `/api/v4.0/projects` | `isWorkInProgress` | boolean | Financial WIP / IGVA | Persisted separately as financial WIP where mapped |

Important: `fitter_category.is_only_for_internal_projects` is category metadata and must not be used as the project-level `Intern sag` truth.

## Lifecycle Truth

The existing EK project lifecycle decision still applies:

- v4 LIST is lifecycle truth.
- `IsClosed=false` / `isClosed=false` means open/active.
- `IsClosed=true` / `isClosed=true` means closed.
- `IsWorkInProgress` / `isWorkInProgress` must not be used for active project counts.
- v3 project data does not provide lifecycle truth.

## Verified Fitterhours Endpoint Behavior

Observed behavior:

- `/api/v3.0/fitterhours` returns time rows.
- `/api/v4.0/fitterhours` returned 0 rows in the verification test.
- Direct query parameters such as `ProjectID=<id>` and `ProjectReference=<ref>` did not filter the result set.
- `searchAttribute=ProjectReference&search=<reference>` returned an EK-side error in the verification test.
- `searchAttribute=ProjectID&search=<EK ProjectID>` works for project-targeted fitterhour reads.

Verified project-targeted pattern:

```text
GET /api/v3.0/fitterhours?page=1&pageSize=1000&searchAttribute=ProjectID&search=<EK ProjectID>
```

## Control Case: Project 26794

Verified source facts:

| Field | Value |
|---|---|
| FD reference | `26794` |
| EK ProjectID | `19687` |
| v4 LIST `isClosed` | `false` |
| v4 LIST `isIntern` | `false` |

Verified fitterhours reads:

| Scope | Rows | Hours | Fitters | Date range |
|---|---:|---:|---:|---|
| EK ProjectID all-time targeted read | 261 | 1688.5 | 10 | 2024-05-31 to 2025-12-08 |
| Current 12-month window from 2025-05-31 | 3 | 22.5 | 3 | 2025-10-20 to 2025-12-08 |

Interpretation:

- FD currently shows 22.5 hours because the current sync/data set has a rolling 12-month scope.
- For an active external project, 22.5 is not the correct future all-time project-hour basis.
- FD must not claim the current 22.5 value is all EK hours.

## Retention Decision

Target fitterhours retention/sync scope:

```text
isClosed=false AND isIntern=false
  => all_time_external_active
  => no 12-month cutoff

all other combinations
  => rolling_12_months_internal_or_closed
  => 12-month scope
```

Important: `all_time_external_active` is a coverage target, not an instruction
to fetch the full historical dataset on every scheduled sync. FD should reach
full project-hour history through controlled project-targeted backfill/resync
and then keep that history current through incremental sync.

Specifically:

- Active external projects (`isClosed=false`, `isIntern=false`): sync and show all project hours.
- Active internal projects (`isClosed=false`, `isIntern=true`): sync and show rolling 12 months.
- Closed projects (`isClosed=true`, any `isIntern`): sync and show rolling 12 months.

## Implementation Status

Not implemented yet:

- FD does not persist project-level `is_internal` / `isIntern`.
- FD does not yet use project-targeted all-time fitterhour sync for active external projects.
- FD does not yet expose final retention scope metadata for project hour values.

Already implemented foundation:

- `fitter_hour.fd_project_id` exists for resolved FD project relation.
- Drawer/detail project hour queries can use resolved FD relation for persisted rows.
- Current UI labels should describe these values as synced Fielddesk hours unless/until all-time scope is verified for a project.

## Next Safe Implementation Slice

1. Persist project-level `is_internal` from v4 LIST `isIntern`.
2. Adjust fitterhours sync targets to use EK `ProjectID` based reads.
3. Add explicit hour scope metadata, for example:
   - `all_time_external_active`
   - `rolling_12_months_internal_or_closed`
   - `synced_rows_only`
4. Backfill/resync project 26794 and equivalent active external projects through project-targeted fitterhours reads.
5. Only after verified sync coverage should UI display project hours as all-time.

## Risks And Follow-up

- Project-targeted all-time reads can increase EK request volume; sync must be rate-limited and resumable.
- Closed/internal 12-month reads still need clear UI/API scope labeling.
- `isIntern` must be treated as tenant-specific EK source data and must not become a hard dependency for Fielddesk-native projects.
