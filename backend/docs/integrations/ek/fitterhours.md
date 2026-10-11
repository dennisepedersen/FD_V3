# EK Fitterhours Contract

Contract status: verified / retention update pending implementation
Endpoint family: /api/v3.0/fitterhours (+ v3/v4 variants)
Consumer: backend/src/services/syncWorker.js, backend/src/db/queries/fitterHour.js, backend/src/db/queries/fitterBusiness.js

## Purpose
- Store time rows for active projects into fitter_hour.
- Power project drawer summary/breakdown and /api/fitterhours endpoint.

## Timekontrol Period Coverage (Local Inspection 2026-10-11)

verified: the canonical local OpenAPI describes
`GET /api/v4/fitterhours` and `GET /api/v4/paginatedfitterhours` with explicit
`fromDate`, inclusive `toDate`, 1-based `page`, `pageSize`, `getAggregates` and
`updatedAfter`. It describes no fitter-ID or project-lifecycle filter for those
GET actions; `id`, `searchAttribute` and `search` are reserved. Their payload is
`data.data[]`, with `data.total`, `currentPage`, `nextPage` and error flags.
Rows include `id`, `date`, `hours`, `fitterID`, `categoryID`,
`categoryReference`, `projectID` and `projectReference`.

unclear: date boundary/timezone semantics, pagination snapshot stability and
complete-period inclusion of closed-project rows have not been verified.
Earlier probes in this document found empty v4 results. The bounded results
below are positive evidence that the date parameters are honored for the tested
day and empty future day, but do not certify a complete period.

Bounded live-source checks, 2026-10-11: the EK credential was decrypted in
memory using `JWT_SECRET` from `backend/.env.production`, the same source loaded
by existing EK probe scripts. The root `.env.production` has a different
`JWT_SECRET` and fails AES-GCM authentication; this was a key-source mismatch,
not a helper import-order issue. Credential values were not printed.

- One tenant-config `SELECT` in `BEGIN READ ONLY` / `COMMIT` loaded the
  `hoyrup-clemmensen` EK settings from the configured Render database.
- `GET /api/v4/paginatedfitterhours` was called for June 12, 2026, pages 1–5,
  with fixed `pageSize=10`: all 5 returned HTTP 200, 10 rows, and no errors;
  source `total=294`. Among those 50 rows was fitter 18, Jesper Sahner Kaiser,
  on `2026-06-12T00:00:00`, 7 hours, category ID 256 / reference 1220, project
  ID 25906 / reference `80396-003`. This verifies that row, not full-period
  coverage.
- `GET /api/v4/fittercategories/256` returned HTTP 200 with ID 256, reference
  1220, and name `Servicetekniker Sikring`.
- Independent `GET /api/v4/projects/id/25906` returned HTTP 200 for reference
  `80396-003`, `isClosed=false`, `isIntern=false`, and a project-detail
  `fitterHours` array of 755 rows. This is not proof of closed-project coverage.
- Follow-up read-only Render candidate reads: an initial June 2026 query found
  no stored closed-project fitter-hour. A second, bounded query over
  2025-10-01 through 2026-06-30 found a one-row closed-project day:
  EK ProjectID 23050, project reference `12325-026`, `is_closed=true`, fitter
  24, source key / fitter-hour ID `id:318942` / `318942`, local hours 3, raw
  EK date `2026-03-27T00:00:00`.
- `GET /api/v4/paginatedfitterhours?fromDate=2026-03-27&toDate=2026-03-27&page=1&pageSize=10`
  returned HTTP 200, 10 rows, `total=301`, `currentPage=1`,
  `nextPage=2`, no errors. All 10 page-one row dates were 2026-03-27
  (`min=max`; 0 out of range). The known stored ID 318942 was not on page 1.
- The comparison
  `GET /api/v4/paginatedfitterhours?fromDate=2099-01-01&toDate=2099-01-01&page=1&pageSize=10`
  returned HTTP 200, 0 rows, `total=0`, `currentPage=0`,
  `nextPage=null`, no errors. Together with the March 27 page, this is
  evidence the tested v4 date filter is not simply ignored; the full 301-row
  March 27 result was not paged through.
- Independent closed-project
  `GET /api/v4/projects/id/23050` returned HTTP 200, one project, reference
  `12325-026`, `isClosed=true`, and one `fitterHours` row. That row matched
  fitter-hour ID 318942, date 2026-03-27, fitter 24, project ID 23050, and
  `hourSpent=3`, exactly matching the stored raw hours value 3. It was not
  present on the period endpoint's first page.
- A complete-period follow-up fetched all March 27 pages twice from
  `GET /api/v4/paginatedfitterhours?fromDate=2026-03-27&toDate=2026-03-27&page=N&pageSize=10`.
  Each pass made 31 sequential GETs (pages 1–31): every response was HTTP 200,
  had no API error flags/errors, retained `total=301`, and reported the expected
  `currentPage` and `nextPage`. Pages 1–30 each had 10 rows; page 31 had one row
  and `nextPage=null`. Each pass contained 301 rows with 301 distinct nonempty
  IDs, zero duplicates, and zero dates outside March 27. Both passes included
  ID 318942 with date March 27, fitter 24, project 23050 / `12325-026`, and
  three hours; the two complete projected row sets and ordered ID sequences
  matched exactly. This is verified stable evidence across two reads, not a
  guarantee that EK cannot change after the observation.
- The credential-free projected dataset and per-page evidence are preserved at
  `C:\Users\dep\.copilot\session-state\b0b6f030-b3bf-42aa-ab98-af042fa1bd82\files\ek_fitterhours_2026-03-27.json`.
  It contains one 301-row dataset plus both pass summaries/page records; no
  credential fields are present.
- One additional `BEGIN READ ONLY` / `COMMIT` Render `SELECT` found the exact
  stored June 12 row: source key / ID `id:333303` / `333303`, fitter 18,
  7 hours, project 25906 / `80396-003`, date June 12. This matches the earlier
  bounded period v4 row's registration identity fields: ID, fitter, date,
  hours and project match. The stored normalized category ID/reference columns
  were null, and all queried raw category keys (`categoryID`, `CategoryID`,
  `FitterCategoryID`, `categoryReference`, `CategoryReference`,
  `FitterCategoryReference`) were also null. One `GET
  /api/v4/projects/id/25906` returned the exact same ID 333303, with date
  `2026-06-12T00:00:00`, fitter 18, hours 7 and project ID 25906; its category
  ID/reference fields were null/absent. The bounded period response had category
  ID 256 / reference 1220. Therefore this is the same registration by its
  matching source identity fields, while category metadata differs/is absent
  in the stored/project-detail evidence. Cause is unclear; no later-change
  claim is supported because no category change timestamp or version evidence
  was obtained. An earlier category-0 mention is not confirmed by the stored
  raw payload, which had no value under the queried category keys.
- The March 27 artifact is bound to the exact tenant UUID resolved by the
  approved Render tenant-config query (`tenantId`), not only its slug. Its
  `saved_at` records when artifact metadata was written, not when either EK
  extraction pass ran; extraction start/end timestamps were not retained and
  are not represented as verified times.
- The artifact also carries
  `evidence.closedProjectControl={id:"318942",fitterId:24,projectId:23050,
  hours:3,isClosed:true}`, labelled as an independent prior project-detail
  observation. This records the earlier project-detail response and is not a
  claim about the project's current status.
- Recompute artifact hashes in Node as follows. For each EK row, first project
  fields in this exact insertion order into an object:
  `{id: String(row.id), date, hours, fitterId, categoryId, categoryReference,
  projectId, projectReference}` using the corresponding row values as stored
  (the saved artifact already contains these compact projected objects).
  `orderedIdsHash` is lowercase hex SHA-256 of UTF-8
  `JSON.stringify(rows.map(row => row.id))` in original page/row order.
  `canonicalRowsHash` is lowercase hex SHA-256 of UTF-8
  `JSON.stringify(rows.slice().sort((a, b) =>
  a.id.localeCompare(b.id, undefined, { numeric: true })))`. `JSON.stringify`
  uses its compact default form; do not sort object keys or add whitespace.
  The verified hashes for both passes are `orderedIdsHash`:
  `31d5c2a0801cb1f8ea91dcac936cc72ab9d2fbdbb33efebca8b2c6b13df9ebb1`
  and `canonicalRowsHash`:
  `b9af628da811136f7ebfac202c01219cf07328199bc1737ee7a7ba630a061138`.
- The full-period read again demonstrates inclusion of a closed-project row:
  ID 318942 was present in the period pages and independently matched the
  project-detail response previously recorded above. No v3 period request was
  needed for the bounded question; no v3 comparison was made.
- This follow-up used three additional read-only Render `SELECT`s (the June
  source-row/config read, the tenant-config read for the full-page EK requests,
  and the exact June source-row comparison) and 63 additional EK GETs (31 pages
  repeated twice and one project-detail comparison). Across the previously
  documented and follow-up checks, six read-only Render `SELECT` statements
  have been used for this evidence. No Timekontrol database was queried or
  run; no import, sync, write, or mail action was performed.
- No Timekontrol database was queried or run; no import, sync, write, or mail
  action was performed.

The CalendarEvents date-filter behavior is recorded in
`tenant_admin_fitters_resource_groups.md`; those calls did not provide a
bounded June 12 calendar result. The separate user-provided Network Admin
observation records an EK group display label beginning `183` but a reported
EK group ID of `61`; it is not a verified source for changing the selected
Timekontrol control cohort (`15, 295, 18, 208, 290, 498`). The one later
CalendarEvents detail request returned HTTP 200 but its bounded response
projection did not extract event 147572's fitter/group data, so it adds no
verified hour-cohort or membership evidence. The user has since approved the
reported Network Admin eight-member observation as a one-time demo-source
basis only, not ongoing import. A tenant-scoped read-only Render preview found
the existing target group unbound (null EK source/ID), no `(ekomplet, 61)`
conflict, and only fitter 18 already in its membership. Five selected fitters
are therefore potential demo additions; no change was made. The user
subsequently explicitly approved the six exact fitter/email mappings and
uppercase-normalized DEP/LKE routing, as documented in
`tenant_admin_fitters_resource_groups.md`. This is user-supplied approval, not
approval persisted in `time_control_employee_config`; no live table/approval
rows were available in the inspected Render schema.

The current local artifact-backed producer/storage path (implementation
reported locally; database-backed testing is pending) now:

- stores source rows and proof JSONB in the immutable TimeControl hours-dataset
  table and binds tenant/day dataset heads; a newly stored UUID supersedes the
  previous head for that tenant/day;
- revalidates both ordered-ID and canonical numeric-ID-sort hashes when loading
  a dataset, and records the dataset foreign key on run/result;
- checks freshness from `observed_at` (not artifact `saved_at` or an import
  timestamp), with a 180-minute window for normal use;
- requires a stored dataset UUID plus explicit
  `--historical-snapshot --dry-run` for an artifact whose observation time is
  null; and
- replaces a dataset as a whole rather than merging corrections/deletions into
  old rows. On failed apply validation it commits head invalidation/audit and
  then returns an error; empty evidence or missing closed-project control rows
  remains blocked.

The documented implementation is storage/evidence handling, not a guarantee
that EK pagination is atomic or immutable while extracted. The artifact's
historical null `observed_at` does not become fresh merely because it was saved
recently. Parent-reported implementation and pending local PostgreSQL tests are
not independently validated here.

Requirements for source/API assurance beyond the local producer:

1. Read the whole tenant's explicitly bounded work-date period from the v4
   period endpoint, without active-project filtering, project joins, retention
   cutoffs or `updatedAfter`. For the tested March 27, 2026 date, `total=301`
   and `pageSize=10` imply 31 pages if the total remains stable (30 full pages
   plus the terminal short page). Fetch through the short page, checking page
   markers, stable total, row dates, distinct source IDs and duplicates; compare
   the final unique count with the source total. Select intended exact fitter
   IDs locally; a fitter with no rows is only a valid zero after the whole
   period is proven.
2. Validate the actual work-date and timezone semantics with boundary rows and
   a known row on a closed project. Do not use deletion timestamps as work dates.
3. Use the existing count-based page rule with a fixed page size: start at 1,
   continue after full pages, fetch the terminal short/empty page. Record page
   numbers, row counts, errors and distinct source IDs. `nextPage=null` alone
   is not a completeness certificate.
4. Reject repeated pages/IDs, unexpected page numbers, changed/missing total,
   malformed dates/identities, rows outside the requested period, unresolved
   retries and skipped pages. Reconcile the distinct fetched count with the
   verified source total. Explicitly retain rows on closed/unmapped projects.
5. On a page-size fallback, restart a bounded pass with the new fixed size;
   do not change offset pagination size midway and certify the mixed pass.
6. Verify the source's snapshot/ordering guarantees. If pagination can shift
   while rows change, a single pass is insufficient. Reconcile repeated bounded
   passes and deletions/corrections under an approved cutoff policy; remain
   incomplete if the source cannot support a defensible coverage claim.
7. Keep persistence atomic and bind proof to source contract version, dates,
   fetched source IDs/counts, page evidence and dataset revision; invalidate it
   on later mutations or failed refresh. The local database stores and
   revalidates the supplied artifact, but this alone does not establish an
   atomic EK source snapshot. A sync timestamp, endpoint `success`, or local
   sum cannot create source completeness proof.

The existing v3 ProjectID-targeted flow is useful for narrow verification, but
does not by itself enumerate every project on which an employee worked. Project
detail refresh and the global active-project importer therefore cannot certify
an employee's complete period, including closed projects.

verified: local Timekontrol now records `data_incomplete` separately from
`missing_hours`, and persists unclassified rows/hours separately from explicitly
excluded salary codes. Missing/unknown codes, invalid/negative hour values and
missing period proof block normal employee and Friday missing-hours messages.
Uncertain `missing_hours` is SQL NULL, not an inferred deficit. An internal
diagnostic is recorded instead. The status API exposes these result fields.

The legacy `getHoursPeriodCoverage` path still deliberately returns `incomplete`:
it reflects synced rows that may be active-project filtered and does not certify
period coverage. The pure `createHoursDataset` evidence adapter validates a
supplied bounded EK artifact, including its page totals and metadata plus
independently recomputed ordered-ID and canonical-row hashes, before
constructing an immutable private dataset bound to one tenant and day. It does
not fetch from EK or turn the legacy database into a complete source.

The service rejects an in-memory `hoursDataset` with
`time_control_dataset_must_be_stored`; this prevents evaluating a proof that
has not been persisted. Snapshot evaluation loads only a stored dataset UUID
via `hoursDatasetId` (CLI: `--hours-dataset-id`) and requires `dryRun=true`.
That evaluation reads the stored vetted snapshot rather than `legacyDB`, and
bypasses the on-demand sync only for that stored snapshot. The pure coverage
evaluation helper may still evaluate rows in memory; those results cannot be
passed to the service as a trusted stored snapshot. Without a stored dataset
UUID the existing incomplete-coverage path remains unchanged. There is no
API/CLI `assume_complete` switch. The local implementation persists the proof in
`result.identity_snapshot.hours_dataset`, with the dataset UUID also bound to
the run/result by the new dataset storage schema. No database-backed test is
claimed here; real PostgreSQL implementation testing remains pending.

Observed local in-memory evaluation of the 301-row March 27 artifact passed
validation. The supplied `canonicalRowsHash` was
`b9af628da811136f7ebfac202c01219cf07328199bc1737ee7a7ba630a061138`; the
validated dataset revision was
`a55ea02224788504dd39000733e08bc228b77a86ea4abbb361dce473307f0f12`.
The initial rule evaluation recorded below was superseded by a later
user-reported local pure re-evaluation using the same 301-row dataset and
canonical hash. The currently approved valid category references are
`9000, 1195, 9315, 9200, 9300, 9320, 1199, 9022`, plus existing
`3300, 1220, 9010, 9012`; excluded references are `9070, 1244`, plus existing
`1246`. Approval of these mappings is reported by the user; it does not mean
the parent-owned local migration/seed has been executed.

In the later re-evaluation the six selected fitters had no unclassified
category references: fitter 15 had 7 valid hours at 1220; fitter 295 had 7
valid hours at 3300; fitter 18 had 7 valid hours at 1220; fitter 208 had 7
valid hours at 9000; fitter 290 had 6 valid hours at 3300 and 6 hours at
excluded reference 9070, leaving a one-hour shortfall; fitter 498 had 7 valid
hours at 3300. No reminder outcome should be inferred from this documentation
alone. Fitter 24 remains uncertain: references 1236 and 1258 remain unknown,
and row 318948 is still a negative-hour row with reference 1280, which remains
unknown. It is not counted as valid or excluded salary-code time. This later
result is a reported local pure evaluation, not a database-backed test result.

Friday mode evaluates only the controlled Friday date's dataset. Its 7-hour
Friday result does not establish a weekly period total; any manager aggregate
is over employees, not a week. A single-Friday dataset is not weekly coverage
proof.

These local evaluations do not prove EK atomic snapshot semantics or future
source stability. Artifact `saved_at` is metadata-write time, not extraction
time, and the two EK passes did not retain start/end timestamps. The artifact's
null `observed_at` requires explicit historical-snapshot dry-run handling and
is not eligible for normal fresh-dataset use.
Normal reminders remain blocked whenever evaluation is uncertain, including
unclassified codes or invalid rows.
The parent-reported tenant-scoped category-rules seed in local migration 0053
was not executed in this evidence task; earlier migration 0049 remains
unchanged. The dataset-storage migration was likewise not executed here.
Database-backed tests for these paths are pending.

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

## Permanent Refresh Model: Phase 2

Phase 2 adds controlled admin/maintenance apply for one project at a time.

Allowed source:

```text
GET /api/v4/projects/id/{EK ProjectID}
```

Disallowed sources:

```text
GET /api/v4/fitterhours?searchAttribute=ProjectID
POST /api/v4/fitterhours/query
```

Scope:

- one tenant;
- one concrete project, selected by `--project-ref` or `--project-id`;
- optional EK ProjectID as an additional resolver/guard;
- no batch mode;
- no tenant-wide refresh;
- no scheduler, cron, UI, project-list, dashboard, or onboarding flow.

Apply is allowed only when all pre-check gates pass:

- local FD reference matches live EK reference;
- duplicate remote `source_key` count is 0;
- cross-project `source_key` conflict count is 0;
- `fd_project_id` mismatch count is 0;
- size class is not `LARGE`;
- project is not already blocked.

Blocked outcomes:

- `blocked_reference_mismatch`
- `blocked_cross_project_conflict`
- `blocked_fd_project_mismatch`
- `blocked_duplicate_source_keys`
- `blocked_large`

Blocked outcomes may write run/status audit, but must not write `fitter_hour`
and must not run the project activity materializer.

Safe upsert rule:

- update only existing `fitter_hour` rows where `tenant_id`, `source_key`, and
  `fd_project_id` match the resolved project;
- insert only when the incoming `source_key` does not already exist;
- if an incoming `source_key` exists on another `fd_project_id`, block before
  apply;
- never reparent or move existing rows between projects;
- never delete rows.

After successful apply, the project activity materializer runs only for the one
refreshed project.

Admin command:

```text
project-targeted-fitterhours-refresh-admin
```

Example:

```powershell
node scripts/fd_maintenance_job.js `
  --job project-targeted-fitterhours-refresh-admin `
  --mode apply `
  --tenant hoyrup-clemmensen `
  --project-ref 13838 `
  --confirm APPLY:project-targeted-fitterhours-refresh-admin:hoyrup-clemmensen:13838
```

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
