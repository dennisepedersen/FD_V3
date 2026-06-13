# EK Fitterhours Refresh Register

Status: operational register, updated 2026-06-13
Tenant: `hoyrup-clemmensen`
Refresh path: `GET /api/v4/projects/id/{EK ProjectID}`

## Purpose

This register tracks targeted fitterhour refresh progress before the next
batch. It is meant to answer:

- what has already been refreshed;
- what is parked;
- why it is parked;
- what remains ready for future batches.

## Rules

- Do not run broad/full fitterhours sync from this register.
- Do not use `/api/v4/fitterhours` endpoints for targeted refresh batches.
- Do not change scheduler or sync-state as part of batch refresh.
- Apply must use safe upsert:
  - update only rows already attached to the same `fd_project_id`;
  - insert only when `source_key` does not exist;
  - never move rows between projects.
- A project must pass pre-check before apply:
  - no `fd_project_id` mismatch;
  - no duplicate remote `source_key`;
  - no cross-project `source_key` conflict;
  - local reference matches live EK project-detail reference.

## Classification

| Class | Count | Meaning |
|---|---:|---|
| `REFRESHED` | 11 | Already refreshed through controlled targeted batches |
| `CONFLICT` | 1 | Cross-project source-key conflict |
| `RELATED_CONFLICT` | 1 | Historical counterpart to a conflict |
| `REFERENCE_MISMATCH` | 1 | Local reference does not match live EK detail reference |
| `LARGE` | 2 | Too large for normal batch; run separately |
| `READY_DB_CLASSIFIED` | 1684 | Open projects with EK ProjectID not in the fixed parked/refreshed classes; not yet safe-to-apply |

Database scope for the READY count:

- open projects only;
- `project_core.status = open`;
- `project_core.is_closed = false`;
- `project_masterdata_v4.ek_project_id IS NOT NULL`;
- excludes the fixed `REFRESHED`, `CONFLICT`, `RELATED_CONFLICT`,
  `REFERENCE_MISMATCH`, and `LARGE` entries below.

Note: `RELATED_CONFLICT` includes `33334`, which is closed and therefore not
part of the open-project READY count.

Important: `READY_DB_CLASSIFIED` does not mean final safe-to-apply. It only
means the project is open, has an EK ProjectID, and is not already classified
as `REFRESHED`, `LARGE`, `CONFLICT`, `RELATED_CONFLICT`, or
`REFERENCE_MISMATCH`.

Before a project can move from `READY_DB_CLASSIFIED` into an apply batch, it
must pass live EK pre-check. The live pre-check must validate:

- local reference matches live EK project-detail reference;
- no duplicate remote `source_key` values;
- no `fd_project_id` mismatch;
- no cross-project `source_key` conflict;
- volume class is suitable for the intended batch size.

## REFRESHED

Batch 1:

- `35738`
- `36322`
- `36016`
- `36218`

Batch 2B:

- `36330`
- `80305-002`
- `80396-002`
- `80113-003`
- `80405-002`
- `80263`
- `80403-002`

## PARKED: CONFLICT

| Reference | Reason |
|---|---|
| `34965` | Cross-project `source_key` conflict against `33334` |

## PARKED: RELATED_CONFLICT

| Reference | Reason |
|---|---|
| `33334` | Historical counterpart to `34965`; do not refresh as part of normal batch |

## PARKED: REFERENCE_MISMATCH

| Reference | EK ProjectID | Live EK reference | Reason |
|---|---:|---|---|
| `900192-003` | `23640` | `900192-025` | Local reference and live EK project-detail reference disagree |

Rule: reference mismatch blocks targeted refresh until a separate identity
analysis verifies the correct FD project relation.

## PARKED: LARGE

| Reference | Reason |
|---|---|
| `80279-001` | Large refresh; run separately |
| `80113-002` | Large refresh; run separately |

## READY Analysis

Read-only analysis on 2026-06-13 found:

- Open projects with EK ProjectID: 1699
- Fixed refreshed/parked register entries: 15
- DB-classified READY projects: 1684

An attempted tenant-wide live scoring run hit EK rate limiting (`429`) after
the first successful project-detail responses. Because of that, the list below
is a verified probe sample, not a complete tenant-wide top-50 ranking or full
tenant-wide prioritization.

Important operational finding:

- `9002` was found as a very large READY candidate in the successful probe
  sample: 10,754 expected inserts and 920 expected updates.
- Treat `9002` as a large candidate for planning purposes until it has been
  explicitly classified.

## Verified READY Probe Sample

Sorted by refresh value among the successful live probes before EK returned
`429`.

| # | Reference | EK ProjectID | Local | Remote | Inserts | Updates | Activity now | Expected activity |
|---:|---|---:|---:|---:|---:|---:|---|---|
| 1 | `9002` | `17650` | 920 | 11674 | 10754 | 920 | `2025-08-21T10:16:11Z` | `2026-07-09T00:00:00Z` |
| 2 | `80375-002` | `27150` | 9 | 41 | 32 | 9 | `2026-04-07T12:50:25Z` | `2026-05-29T00:00:00Z` |
| 3 | `36230` | `30173` | 14 | 18 | 4 | 14 | `2026-04-01T06:33:01Z` | `2026-04-15T00:00:00Z` |
| 4 | `36011` | `29930` | 1 | 3 | 2 | 1 | `2026-03-03T10:41:15Z` | `2026-04-10T00:00:00Z` |
| 5 | `36319` | `30277` | 1 | 2 | 1 | 1 | `2026-03-24T07:05:50Z` | `2026-05-08T00:00:00Z` |
| 6 | `36935` | `31011` | 0 | 49 | 49 | 0 |  | `2026-06-12T00:00:00Z` |
| 7 | `36848` | `30916` | 0 | 12 | 12 | 0 |  | `2026-05-28T00:00:00Z` |
| 8 | `37011` | `31092` | 0 | 8 | 8 | 0 |  | `2026-06-04T00:00:00Z` |
| 9 | `80305-004` | `27407` | 19 | 19 | 0 | 19 | `2026-03-17T16:59:50Z` | `2026-03-17T16:59:50Z` |
| 10 | `900057-50` | `18543` | 0 | 5 | 5 | 0 |  | `2024-08-13T00:00:00Z` |
| 11 | `35020` | `28733` | 14 | 14 | 0 | 14 | `2026-01-26T07:21:57Z` | `2026-01-26T07:21:57Z` |
| 12 | `36402` | `30371` | 0 | 4 | 4 | 0 |  | `2026-05-07T00:00:00Z` |
| 13 | `37338` | `31448` | 0 | 4 | 4 | 0 |  | `2026-06-10T00:00:00Z` |
| 14 | `36496-001` | `30806` | 0 | 4 | 4 | 0 |  | `2026-05-05T00:00:00Z` |
| 15 | `36785` | `30840` | 0 | 4 | 4 | 0 |  | `2026-05-20T00:00:00Z` |
| 16 | `80365-002` | `27842` | 10 | 10 | 0 | 10 | `2026-03-30T08:52:22Z` | `2026-03-30T08:52:22Z` |
| 17 | `31813` | `25151` | 8 | 8 | 0 | 8 | `2025-09-01T09:08:44Z` | `2025-09-01T09:08:44Z` |
| 18 | `35633` | `29433` | 7 | 7 | 0 | 7 | `2026-02-17T13:53:22Z` | `2026-02-17T13:53:22Z` |
| 19 | `36754` | `30801` | 0 | 2 | 2 | 0 |  | `2026-05-27T00:00:00Z` |
| 20 | `37168` | `31269` | 0 | 2 | 2 | 0 |  | `2026-06-03T00:00:00Z` |
| 21 | `36169` | `30100` | 0 | 2 | 2 | 0 |  | `2026-05-19T00:00:00Z` |
| 22 | `37170` | `31271` | 0 | 2 | 2 | 0 |  | `2026-06-01T00:00:00Z` |
| 23 | `37015` | `31097` | 0 | 2 | 2 | 0 |  | `2026-06-11T00:00:00Z` |
| 24 | `900216` | `7716` | 0 | 2 | 2 | 0 |  | `2022-10-26T00:00:00Z` |
| 25 | `37246` | `31352` | 0 | 2 | 2 | 0 |  | `2026-06-04T00:00:00Z` |
| 26 | `31838` | `25179` | 5 | 5 | 0 | 5 | `2026-04-01T11:34:00Z` | `2026-04-01T11:34:00Z` |
| 27 | `36877` | `30949` | 0 | 1 | 1 | 0 |  | `2026-05-27T00:00:00Z` |
| 28 | `36778` | `30829` | 0 | 1 | 1 | 0 |  | `2026-05-04T00:00:00Z` |
| 29 | `900057-80` | `18573` | 0 | 1 | 1 | 0 |  | `2026-04-28T00:00:00Z` |
| 30 | `37074` | `31166` | 0 | 1 | 1 | 0 |  | `2026-05-25T00:00:00Z` |
| 31 | `37184` | `31286` | 0 | 1 | 1 | 0 |  | `2026-06-01T00:00:00Z` |
| 32 | `36403` | `30372` | 2 | 2 | 0 | 2 | `2026-04-07T07:18:43Z` | `2026-04-07T07:18:43Z` |
| 33 | `35678` | `29498` | 2 | 2 | 0 | 2 | `2026-02-13T08:38:49Z` | `2026-02-13T08:38:49Z` |
| 34 | `35812` | `29696` | 1 | 1 | 0 | 1 | `2026-02-23T06:56:48Z` | `2026-02-23T06:56:48Z` |
| 35 | `36231` | `30174` | 1 | 1 | 0 | 1 | `2026-03-31T07:45:32Z` | `2026-03-31T07:45:32Z` |
| 36 | `35468` | `29255` | 1 | 1 | 0 | 1 | `2026-01-28T12:53:45Z` | `2026-01-28T12:53:45Z` |
| 37 | `35583` | `29375` | 1 | 1 | 0 | 1 | `2026-02-05T06:07:16Z` | `2026-02-05T06:07:16Z` |
| 38 | `900139-002` | `22307` | 0 | 0 | 0 | 0 |  |  |
| 39 | `37199` | `31301` | 0 | 0 | 0 | 0 |  |  |
| 40 | `80533-008` | `31221` | 0 | 0 | 0 | 0 |  |  |
| 41 | `12338-027` | `30704` | 0 | 0 | 0 | 0 |  |  |
| 42 | `80222-002-013` | `20640` | 0 | 0 | 0 | 0 |  |  |
| 43 | `900163-026` | `29661` | 0 | 0 | 0 | 0 |  |  |
| 44 | `21992-014` | `24992` | 0 | 0 | 0 | 0 |  |  |
| 45 | `80547-008` | `31232` | 0 | 0 | 0 | 0 |  |  |
| 46 | `80340` | `23368` | 0 | 0 | 0 | 0 |  |  |
| 47 | `34552` | `28159` | 0 | 0 | 0 | 0 |  |  |
| 48 | `80367-015` | `25286` | 0 | 0 | 0 | 0 |  |  |
| 49 | `37283` | `31390` | 0 | 0 | 0 | 0 |  |  |
| 50 | `37154` | `31254` | 0 | 0 | 0 | 0 |  |  |

Verified probe sample totals:

- Expected inserts: 10,902
- Expected updates: 1,016

Because the tenant-wide scoring hit EK `429`, Batch 3 should not be selected
by blasting all 1684 READY projects again. Use a rate-limited planner and
promote large candidates out of normal batches.

## Recommended Batch 3 Preparation

1. Move `9002` to `LARGE` unless a separate explicit large-project run is
   approved.
2. Probe READY candidates in small windows with rate limiting.
3. Build Batch 3 only from projects with:
   - clean reference match;
   - no duplicate remote source keys;
   - no cross-project source-key conflicts;
   - manageable insert/update volume.
4. Keep high-volume projects out of normal batches.
