# EK Fitterhours Contract

Contract status: verified / retention update pending implementation
Endpoint family: /api/v3.0/fitterhours (+ v3/v4 variants)
Consumer: backend/src/services/syncWorker.js, backend/src/db/queries/fitterHour.js, backend/src/db/queries/fitterBusiness.js

## Purpose
- Store time rows for active projects into fitter_hour.
- Power project drawer summary/breakdown and /api/fitterhours endpoint.

## Verified Ingestion Rules
- pageSize starts at 50 for read endpoints; fallback to 25 on 429.
- Current FD sync maps and filters rows before persist.
- Current implemented sync uses a 12-month cutoff for fitterhours.
- Current implemented sync should be treated as `synced_rows_only`, not guaranteed all EK hours.
- Future retention behavior is documented in `backend/docs/integrations/ek/fitterhours_retention_model.md`.

## VERIFIED Endpoint Behavior

- `/api/v3.0/fitterhours` returns data for tenant `hoyrup-clemmensen`.
- `/api/v4.0/fitterhours` returned 0 rows in the verification test.
- Direct query parameters such as `ProjectID=<id>` and `ProjectReference=<ref>` did not filter the response.
- `searchAttribute=ProjectID&search=<EK ProjectID>` works for project-targeted reads.
- `searchAttribute=ProjectReference&search=<reference>` returned an EK-side error in the verification test.

## VERIFIED v4 Project Detail Fitterhours Behavior

Safe project-scoped probes verified:

- `GET /api/v4/projects/id/{EK ProjectID}` returns one project in `data[0]` with a `fitterHours` field.
- Reference `26794`, EK ProjectID `19687`, returned `data[0].fitterHours = 261`.
- Reference `80396-003`, EK ProjectID `25906`, returned `data[0].fitterHours = 269`.
- `GET /api/v4/projects/ref/{reference}` returned the same project, but without `fitterHours`.
- `includeFitterHours=true` had no observed effect on the ref endpoint in the test.

## VERIFIED Targeted Refresh Pilot

Verified 2026-06-13 for tenant `hoyrup-clemmensen`:

- PR #11 targeted refresh tooling was already merged and live.
- A controlled apply pilot was run for 4 safe projects through
  `GET /api/v4/projects/id/{EK ProjectID}` only.
- `/api/v4/fitterhours` endpoints were not used.
- `fitterhours` endpoint selection remained disabled.
- No scheduler, sync-state, full-sync, or tenant-wide changes were made.

Pilot projects:

| Reference | EK ProjectID | Result |
|---|---:|---|
| `35738` | `29593` | 6 inserts, 3 updates |
| `36322` | `30280` | 7 inserts, 4 updates |
| `36016` | `29935` | 3 inserts, 9 updates |
| `36218` | `30161` | 12 inserts, 31 updates |

Pilot totals:

- Inserts: 28
- Updates: 47
- Deletes: 0
- Cross-project moves: 0
- Activity materializer updated 4 projects.

Post-verify:

- `35738`: `fitter_hour` count 9, activity `2026-04-22T00:00:00Z`.
- `36322`: `fitter_hour` count 11, activity `2026-04-29T00:00:00Z`.
- `36016`: `fitter_hour` count 12, activity `2026-04-13T00:00:00Z`.
- `36218`: `fitter_hour` count 43, activity `2026-04-30T00:00:00Z`.
- All 4 projects remained `status = open` and `is_closed = false`.
- Activity values were not null after apply.
- `34965` was explicitly excluded because dry-run found cross-project
  `source_key` conflicts against `33334`.
- `34965` and `33334` were unchanged after the apply pilot.

Operational findings:

- The v4 project-detail flow can lift project activity through
  `project_wip.last_fitter_hour_date`.
- `registration_date` does not improve in this flow because v4 project-detail
  `fitterHours` does not provide a verified registration-date field for
  persisted rows.
- Existing WIP/economy fields such as ready-to-bill, margin, costs, ongoing,
  billed, coverage, budget, and WIP flags are not part of the targeted
  activity materialization and must not be overwritten by this flow.

Production schema finding:

- Production schema did not match the implementation expectation that
  `ON CONFLICT (tenant_id, source_key)` and `ON CONFLICT (tenant_id, project_id)`
  are valid for the relevant upserts.
- The final pilot apply used manual safe upsert semantics:
  - update only rows already attached to the same `fd_project_id`;
  - insert only when `source_key` does not exist;
  - never move an existing row from another project.

Requirement for future batch-refresh applies:

- Future applies must either use the same safe-upsert principle, or first verify
  production constraints/schema and check for cross-project `source_key`
  conflicts before writes.

## VERIFIED Targeted Refresh Batch 2B

Verified 2026-06-13 for tenant `hoyrup-clemmensen`:

- Batch 2B was run for 7 safe projects through
  `GET /api/v4/projects/id/{EK ProjectID}` only.
- `/api/v4/fitterhours` endpoints were not used.
- No scheduler, sync-state, full-sync, or tenant-wide changes were made.

Batch 2B projects:

| Reference | EK ProjectID | Inserts | Updates | Activity result |
|---|---:|---:|---:|---|
| `36330` | `30289` | 2 | 13 | unchanged at `2026-04-08T09:16:57Z` |
| `80305-002` | `22167` | 42 | 114 | `2026-04-08T08:57:47Z` -> `2026-06-12T00:00:00Z` |
| `80396-002` | `25905` | 205 | 866 | `2026-04-08T08:54:19Z` -> `2026-06-12T00:00:00Z` |
| `80113-003` | `21457` | 79 | 227 | `2026-04-08T08:31:19Z` -> `2026-06-12T00:00:00Z` |
| `80405-002` | `26303` | 2 | 443 | `2026-04-08T08:04:13Z` -> `2026-04-10T00:00:00Z` |
| `80263` | `19791` | 72 | 174 | `2026-04-08T07:24:36Z` -> `2026-06-09T00:00:00Z` |
| `80403-002` | `26210` | 22 | 114 | `2026-04-08T07:04:12Z` -> `2026-06-12T00:00:00Z` |

Batch 2B pre-check gates:

- no `fd_project_id` mismatch;
- no duplicate remote `source_key` values;
- no cross-project `source_key` conflicts;
- local project reference matched live EK project-detail reference.

Batch 2B apply semantics:

- update only rows already attached to the same `fd_project_id`;
- insert only when `source_key` does not exist;
- never move an existing row between projects.

Batch 2B totals:

- Inserts: 424
- Updates: 1951
- Unchanged: 0
- Deletes: 0
- Cross-project moves: 0
- Activity materializer updated 7 of 7 scoped projects.

Post-verify:

- All 7 projects remained `status = open` and `is_closed = false`.
- No cross-project rows were found after apply.
- Excluded projects were unchanged: `900192-003`, `80279-001`,
  `80113-002`, `34965`, and `33334`.

## VERIFIED Reference / Identity Mismatch

Verified 2026-06-13 for tenant `hoyrup-clemmensen`:

- Reference `900192-003`, EK ProjectID `23640`, was excluded from Batch 2B.
- The local project reference was `900192-003`.
- Live EK project detail for EK ProjectID `23640` returned reference
  `900192-025`.
- This is a reference / identity mismatch and must block targeted refresh apply
  until a separate identity analysis has verified the correct FD project
  relation.

Permanent operational truth:

- Targeted refresh must not apply when the local reference and live EK
  project-detail reference disagree.
- Such cases should be logged and reviewed as a separate identity issue before
  any fitterhour rows are inserted or updated.

## Permanent Refresh Model: Phase 1

Implementation started after controlled manual backfill through Batch 7.
Manual Batch 8+ is stopped as the main track.

Phase 1 scope:

- add refresh status and run-audit tables;
- extract a reusable fitterhours refresh service;
- support read-only pre-check/dry-run for one project;
- use only `GET /api/v4/projects/id/{EK ProjectID}`;
- block reference mismatches;
- detect duplicate remote `source_key` values;
- detect cross-project `source_key` conflicts;
- detect `fd_project_id` mismatches;
- classify expected insert volume.

Phase 1 does not:

- insert, update, or delete `fitter_hour` rows;
- run project activity materialization;
- change `project_wip` activity;
- change sync-state;
- change scheduler behavior;
- run tenant-wide refresh;
- use `/api/v4/fitterhours` endpoints.

New maintenance command:

```text
project-targeted-fitterhours-refresh-dry-run
```

Example:

```text
node scripts/fd_maintenance_job.js
  --job project-targeted-fitterhours-refresh-dry-run
  --mode dry-run
  --tenant hoyrup-clemmensen
  --project-ref 13838
```

Apply, project-detail on-demand refresh, UI status, and scheduler selection are
later phases and must reuse the same pre-check gates and safe-upsert rules.

## Product Decision: Future Fitterhours Refresh Strategy

Decision status: product owner decision, documented 2026-06-13.

Fielddesk should eventually use fitterhours to support:

- project activity;
- KPIs and dashboards;
- missing time-registration checks;
- economy and forecasting;
- general project insight.

The product model must separate four different concerns:

1. Historical EK backfill.
2. Ongoing delta/incremental refresh.
3. On-demand project refresh.
4. Tenant onboarding choices.

Manual Batch 8+ does not continue as the main track. Historical EK backfill may
continue quietly as a controlled background/onboarding flow, especially for open
projects, but Fielddesk should not manually walk through every historical
project now.

Future new or changed time registrations should be handled automatically by
delta/incremental refresh or targeted project refresh. Broad full sync must not
be the default path, and broad `/api/v4/fitterhours` endpoints must not be used
as the default project-scoped refresh mechanism.

For new tenants with EK enabled, tenant admin must choose the historical import
level during onboarding. The initial options should be:

1. no history;
2. open projects only;
3. open projects plus the latest X months;
4. full history as a slow background process.

The onboarding and UI copy must make it clear that historical import can take
time and runs alongside normal Fielddesk usage.

Reference mismatch, cross-project `source_key` conflict, and `LARGE` projects
must not be repaired automatically. No automatic reparenting is allowed.
Mismatch/conflict cases require separate review with audit before any future
reparenting or correction flow.

Tenant isolation is an absolute requirement. Any future scheduler, onboarding
backfill, or admin-triggered refresh must be tenant-scoped and must not allow
one tenant's EK data quality issues to affect another tenant.

Minimum good enough before inviting 4-5 users:

- project activity can be refreshed safely for one project;
- the refresh path has dry-run/pre-check gates;
- reference mismatch and cross-project conflicts block writes;
- stale or missing activity can be identified;
- no broad full sync or tenant-wide refresh is required for normal use.

Later phases:

- implement safe apply for one project;
- add admin/on-demand project refresh;
- expose simple freshness/blocked status in project UI;
- design a small tenant-scoped scheduler;
- add tenant onboarding history selection and slow background backfill.

## VERIFIED Cross-Project Source Key Conflict

Verified 2026-06-13 for tenant `hoyrup-clemmensen`:

Project A:

- Reference: `34965`
- EK ProjectID: `28674`
- Status: open
- Live EK project detail returned 46 `fitterHours`.
- 19 of those `fitterHourID` / `source_key` values already existed locally on
  project `33334`.

Project B:

- Reference: `33334`
- EK ProjectID: `26805`
- Status: closed
- Live EK project detail returned 0 `fitterHours`.
- Locally, the project still had the 19 historical `fitter_hour` rows.

Conflict facts:

- The 19 `source_key` values existed locally only on `33334`.
- The same 19 values appeared live in EK under `34965`.
- The same 19 values did not appear live in EK under `33334`.
- Work dates covered a continuous period from 2025-08-21 to 2025-11-14.
- The rows primarily used fitter `35`, with some rows from fitter `31`.
- No parent/child relation was verified between `34965` and `33334`.
- Both projects were non-subprojects in the verified metadata.
- Both projects shared associated address data, but had different worksheet IDs.

Likely cause:

- EK hours were probably moved or reparented from `33334` / EK `26805` to
  `34965` / EK `28674` after the local historical sync.

Risk:

- A naive source-key upsert can move existing rows from one FD project to
  another.
- This can change history on a closed project.
- This can hide the fact that EK data has been reparented.

Permanent operational truth:

- Targeted refresh must never automatically move an existing `source_key`
  between `fd_project_id` values.
- If an incoming `source_key` already exists on another `fd_project_id`, it must
  be blocked, skipped, and logged as `cross_project_source_key_conflict`.
- Any reparenting must be handled in a separate review/reparent flow with audit.

Recommended rule:

- Batch refresh should keep the existing relation and skip the conflict.
- A future reparent flow may evaluate and move hours only when:
  - live EK detail shows the `source_key` on the new project;
  - live EK detail does not show the `source_key` on the old project;
  - old and new project metadata are documented;
  - the change is audited.

## USE

- Use `GET /api/v4/projects/id/{EK ProjectID}` for targeted refresh of the project-detail `fitterHours` value when EK ProjectID is known.
- Use the v4 project id detail endpoint instead of broad/full fitterhours scanning when the required fact is only the project-detail `fitterHours` value.
- Use the v3 project-targeted fitterhours pattern below when FD needs actual persisted time rows, employee/category breakdown, or row-level all-time backfill.

Verified row-level project-targeted pattern:

```text
GET /api/v3.0/fitterhours?page=1&pageSize=1000&searchAttribute=ProjectID&search=<EK ProjectID>
```

## DO NOT USE

- Do not treat `GET /api/v4/projects/ref/{reference}` as a source for `fitterHours`.
- Do not assume `includeFitterHours=true` activates `fitterHours` on the ref endpoint.
- Do not use this project detail value as proof that persisted `fitter_hour` rows are complete; it verifies a project-scoped EK detail field, not FD row coverage.
- Do not use `GET /api/v4/fitterhours?searchAttribute=ProjectID&search=<id>` as a project-scoped filter.
- Do not use `POST /api/v4/fitterhours/query` as a project-scoped fitterhours source.
- Do not confuse `POST /api/v4/fitterhours` with search; it creates fitterhour registrations.
- Do not run broad/full fitterhours scans when a project-scoped endpoint answers the needed question.
- Do not run targeted batch-refresh apply for a project if dry-run finds
  cross-project `source_key` conflicts.
- Do not run targeted batch-refresh apply for a project if live EK project
  detail returns a reference that does not match the local FD project reference.
- Do not use an `ON CONFLICT` upsert in production without first verifying the
  exact production constraint/index shape for the target table.
- Do not automatically reparent or move `fitter_hour` rows between projects in a
  targeted refresh batch.

## OPEN QUESTIONS

- Whether `data[0].fitterHours` is always a count of EK time rows, a summarized project field, or another EK-defined measure.
- Whether `/api/v4.0/projects/id/{EK ProjectID}` behaves identically to `/api/v4/projects/id/{EK ProjectID}` across tenants.
- Whether EK documents a supported include flag for `fitterHours` on any project endpoint.

## DO NOT USE: v4 Project-Scoped Search

Verified 2026-06-12:

- `GET /api/v4/fitterhours?searchAttribute=ProjectID&search=<id>` must not be used as a project-scoped filter.
- The v4 OpenAPI marks `searchAttribute` and `search` as reserved / not currently used.
- The probe showed the filter is ignored.
- `POST /api/v4/fitterhours/query` is documented as search, but ProjectID filtering is not verified usable. The probe produced an EK-side error and 0 rows.
- `POST /api/v4/fitterhours` creates fitterhour registrations and must not be confused with search.

## FUTURE POSSIBILITY

- `POST /api/v4/fitterhours` may later be investigated for write-back of time registrations, but only under explicit write-back governance, RBAC, audit, change-note, tenant-isolation, and approval flow.

## Verified Fields Used
| EK field | FD field | Table column |
|---|---|---|
| FitterHourID | fitter_hour_id | fitter_hour.fitter_hour_id |
| ProjectID/ProjectReference | external_project_ref/project_id | fitter_hour.external_project_ref / fitter_hour.project_id |
| ProjectID resolved against v4 masterdata | resolved FD project relation | fitter_hour.fd_project_id |
| FitterID | fitter identity | fitter_hour.fitter_id |
| FitterCategoryID/Reference | category identity | fitter_hour.fitter_category_id / fitter_category_reference |
| Date/WorkDate/RegistrationDate | work/registration date | fitter_hour.work_date / registration_date |
| Hours/Quantity | numeric hours | fitter_hour.hours / quantity |
| Note/Description | text details | fitter_hour.note / description |

## Unclear Fields
| Field | Why unclear |
|---|---|
| v4 fitterhours behavior | v4 endpoint returned 0 rows in verification; keep v3 as source until EK confirms otherwise |
| ProjectReference filtering | direct ProjectReference parameters did not filter, and searchAttribute=ProjectReference errored in verification |

## Relation Strategy

- Current resolved project relation is `fitter_hour.fd_project_id`.
- Source payload keeps both `ProjectID` and `ProjectReference`.
- `ProjectID` must resolve only against `project_masterdata_v4.ek_project_id`.
- `ProjectReference` must resolve only against `project_core.external_project_ref`.
- Runtime cross-matching between EK ProjectID and human project reference is not allowed.

## Known Pitfalls
- FD does not yet persist project-level `is_internal`, so the new internal/external retention model is not implemented yet.
- Existing synced project-hour values may be 12-month scoped and must not be presented as all EK hours.
- Project-targeted all-time reads should use EK ProjectID, not ProjectReference, based on verification.
- Prefer project-scoped EK probes over broad/full fitterhours scans whenever a project-scoped endpoint exists.
