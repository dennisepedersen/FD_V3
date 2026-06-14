# EK Projects v4 Masterdata Contract

Contract status: verified
Endpoint family: /api/v4.0/projects and /api/v4/projects (discovered at runtime)
Consumer: backend/src/services/syncWorker.js

## Purpose
- Authoritative project master stream for lifecycle/open/closed state in FD.
- Drives project_core upsert and retention cleanup eligibility.
- Supplies financial WIP/IGVA signal separately from lifecycle.

## Payload Handling (verified)
- Paged fetch with query params page and pageSize.
- Optional updatedAfter in delta mode.
- Parsed by parsePagedPayload with support for:
- payload.data[0].data + payload.data[0].nextPage
- payload.data
- payload.items
- payload.result

## Verified Fields Used
| EK field | FD usage | Destination |
|---|---|---|
| reference/Reference/projectReference/ProjectReference | external project reference | project_core.external_project_ref |
| ProjectName/projectName/name/Name | project name | project_core.name |
| Status/status/ProjectStatus | status fallback | project_core.status |
| isClosed/IsClosed | authoritative close state | project_core.is_closed + closed_observed_at |
| isWorkInProgress/IsWorkInProgress | financial WIP/IGVA, not lifecycle | project_wip.is_work_in_progress / financial_wip |
| isIntern/IsInternal | project internal/external source flag | project_core.is_internal + project_masterdata_v4.is_internal |
| endDate/EndDate | planning/end date only | planning_status / display |
| Responsible*/TeamLeader* variants | role identity fields | project_core.responsible_* and team_leader_* |
| date-like fields (updatedDate/startDate/etc) | activity fallback | project_core.activity_date |

## Unclear Fields
| Field group | Why unclear |
|---|---|
| project_expected_values/project_budget subtree semantics | stored in project_masterdata_v4 JSON but business meaning is not fully documented in backend |
| worksheet_ids linkage guarantees | no enforced FK to worksheet entity in current schema |

## Relations
- project_core.project_id is FD internal primary key.
- project_masterdata_v4.ek_project_id supports joins to fitter_hour.project identifiers via text comparison in queries.

## VERIFIED Project Detail Behavior

Safe project-scoped probes verified:

- `GET /api/v4/projects/id/{EK ProjectID}` returns one project in `data[0]`.
- The id endpoint returned `data[0].fitterHours`.
- Reference `26794`, EK ProjectID `19687`, returned `data[0].fitterHours = 261`.
- Reference `80396-003`, EK ProjectID `25906`, returned `data[0].fitterHours = 269`.
- `GET /api/v4/projects/ref/{reference}` returned the same project, but without `fitterHours`.
- `includeFitterHours=true` had no observed effect on the ref endpoint in the test.

## USE

- Use the id endpoint as the verified project-scoped project-detail probe when EK ProjectID is known.
- Use it as a safer alternative to broad/full fitterhours scanning when the required field is project-detail `fitterHours`.
- Use v4 LIST for authoritative project existence, lifecycle, and masterdata.
- Use `IsClosed` / `isClosed` for lifecycle; use `IsWorkInProgress` / `isWorkInProgress` only for financial WIP/IGVA.
- Use `isIntern` / `IsInternal` as project internal/external source metadata for future fitterhours retention decisions.

## DO NOT USE

- Do not treat the ref endpoint as a `fitterHours` source.
- Do not assume `includeFitterHours=true` changes project ref endpoint payload shape.
- Do not use the project-detail `fitterHours` value as proof that Fielddesk persisted time rows are complete.
- Do not interpret `IsWorkInProgress` as active/open status.
- Do not interpret `EndDate` as closed status.
- Do not run broad/full fitterhours scans when v4 project id detail answers the required project-detail `fitterHours` question.

## OPEN QUESTIONS

- Whether `/api/v4.0/projects/id/{EK ProjectID}` behaves identically to `/api/v4/projects/id/{EK ProjectID}` across tenants.
- Whether EK documents a supported include flag for `fitterHours` on any project endpoint.
- The exact business semantics of project budget/expected-value subtrees stored in raw v4 payloads.

## Known Pitfalls
- Endpoint compatibility is probed dynamically; version path is not guaranteed.
- nextPage may be missing or inconsistent across endpoints; it must not be used as primary stop signal.
- Primary paging control is row-count vs pageSize (continue only on full page).
- `IsWorkInProgress` must not be interpreted as active/open status.
- `EndDate` must not be interpreted as closed status.
- `isIntern` / `IsInternal` is project internal/external metadata, not lifecycle. It is persisted as nullable `is_internal` source metadata for future fitterhours retention decisions.

## Allowed FD Usage
- Project bootstrap/delta sync.
- Scope=mine and project detail source enrichment through project_core/project_masterdata_v4.
- Dashboard/project active counts through `IsClosed=false`.
- Future fitterhours retention classification using project-level `is_internal`; ProjectID-targeted all-time fitterhour sync remains pending.

## Narrow v4 Project Resync Tooling

`backend/scripts/resync_projects_v4_only.js` is a tenant-scoped operational helper
for revisiting EK v4 LIST project rows without running bootstrap or other endpoint
families.

Allowed use:

- Re-read `/api/v4.0/projects` for one tenant.
- Persist `isIntern` / `IsInternal` into `project_core.is_internal` and
  `project_masterdata_v4.is_internal`.
- Show current distribution and control cases before writes.

Explicit non-goals:

- It must not call fitterhours.
- It must not run ProjectID-targeted fitterhour sync.
- It must not enqueue or reset broad bootstrap jobs.
- It must not delete project data.
