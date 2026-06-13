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
- Do not use an `ON CONFLICT` upsert in production without first verifying the
  exact production constraint/index shape for the target table.

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
