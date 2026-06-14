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

## Strategic Decision After Batch 7

Manual Batch 8+ is stopped as the main track. The next implementation track is
the permanent targeted fitterhours refresh model:

- one-project pre-check/dry-run first;
- no tenant-wide refresh;
- no scheduler changes in phase 1;
- no `fitter_hour` apply in phase 1;
- no project activity materializer in phase 1;
- future apply/on-demand/UI/scheduler phases must reuse the same reference,
  duplicate-key, cross-project conflict, and `fd_project_id` mismatch gates.

## Classification

| Class | Count | Meaning |
|---|---:|---|
| `REFRESHED` | 161 | Already refreshed through controlled targeted batches |
| `CONFLICT` | 1 | Cross-project source-key conflict |
| `RELATED_CONFLICT` | 1 | Historical counterpart to a conflict |
| `REFERENCE_MISMATCH` | 4 | Local reference does not match live EK detail reference |
| `LARGE` | 14 | Too large for normal batch; run separately |
| `READY_DB_CLASSIFIED` | 1519 | Open projects with EK ProjectID not in the fixed parked/refreshed classes; not yet safe-to-apply |

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

Batch 3A:

- `80279-002`
- `80288-003`
- `80367`
- `80288-001-001`
- `80375`
- `80305-003`
- `33023-001`
- `80340-003`
- `80344`
- `80438`
- `80365`
- `80447`
- `80327`
- `80399`
- `80279-003`
- `80406`
- `80488`
- `80444-001`
- `80403-005`
- `80403-008`
- `80365-004`
- `80300`
- `900064`
- `33023-008`
- `80403-006`

Batch 3B:

- `80484-001`
- `80355`
- `80365-003`
- `80256-001-002`
- `80356`
- `80403-010`
- `80403-009`
- `80404`
- `32290`
- `80288-003-008`
- `33023-006`
- `80256-001-005`
- `35162`
- `80259`
- `80403-007`
- `80481`
- `80246`
- `80342`
- `80494`
- `80113-004`
- `29572`
- `34544`
- `29907`
- `80405-008`
- `33023-003`

Batch 4:

- `10255`
- `10482-027`
- `10516`
- `10637`
- `10637-027`
- `10889-027`
- `10889-028`
- `10889-029`
- `10889-030`
- `12017`
- `12021`
- `12023`
- `12024-027`
- `12025`
- `12026`
- `12068`
- `12071`
- `12072-027`
- `12074`
- `12075`
- `12078`
- `12078-026`
- `12149`
- `12276`
- `12279`

Batch 5:

- `12280`
- `12283`
- `12285`
- `12286`
- `12288`
- `12291`
- `12292`
- `12293`
- `12296`
- `12297`
- `12298`
- `12299`
- `12299-027`
- `12300`
- `12300-027`
- `12301`
- `12302`
- `12304`
- `12306`
- `12307`
- `12307-027`
- `12310-027`
- `12312`
- `12312-027`
- `12315-027`

Batch 6:

- `12318`
- `12320`
- `12322`
- `12323`
- `12325-027`
- `12329`
- `12329-026`
- `12331`
- `12335`
- `12335-026`
- `12336-026`
- `12336-027`
- `12337`
- `12338-027`
- `12339-026`
- `12339-027`
- `12341-027`
- `12342`
- `12343`
- `12344`
- `12344-027`
- `12346`
- `12347`
- `12348`
- `12553`

Batch 7:

- `12553-026`
- `12553-027`
- `12555`
- `12644`
- `12793`
- `12802`
- `12848-027`
- `13121`
- `13386`
- `13386-027`
- `13838`
- `13838-027`
- `13896-027`
- `13935-004`
- `13936-005`
- `13940-027`
- `13943-003`
- `14222-027`
- `14364-003`
- `14460-003`
- `14489-027`
- `14511-005`
- `14512-004`
- `14515-027`
- `14516-027`

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
| `10889-005` | `25000` | `10889-026` | Found during Batch 4 live pre-check; do not refresh until the cause is clarified |
| `13961-004` | `28570` | `13961-026` | Found during Batch 7 live pre-check; do not refresh until the cause is clarified |
| `14488-004` | `28563` | `14488-026` | Found during Batch 7 live pre-check; do not refresh until the cause is clarified |

Rule: reference mismatch blocks targeted refresh until a separate identity
analysis verifies the correct FD project relation.

## PARKED: LARGE

| Reference | Reason |
|---|---|
| `80279-001` | Large refresh; run separately |
| `80113-002` | Large refresh; run separately |
| `9002` | Large refresh; run separately |
| `80396-001` | Large refresh; run separately |
| `80288-001` | Large refresh; run separately |
| `9015` | Large refresh; run separately |
| `21992` | Large refresh; run separately |
| `80256-002` | Large refresh; run separately |
| `9041` | Large refresh; run separately |
| `9101` | Large refresh; run separately |
| `9001` | Large refresh; run separately |
| `80256-001` | Large refresh; run separately |
| `9044` | Large refresh; run separately |
| `9043` | Large refresh; run separately |

## Batch Status

Verified controlled targeted refresh batches for tenant
`hoyrup-clemmensen`:

| Batch | Projects | Inserts | Updates | Deletes | Cross-project moves | Conflicts | Reference mismatches |
|---|---:|---:|---:|---:|---:|---:|---:|
| Batch 1 | 4 | 28 | 47 | 0 | 0 | 0 | 0 |
| Batch 2B | 7 | 424 | 1951 | 0 | 0 | 0 | 0 |
| Batch 3A | 25 | 2862 | 8194 | 0 | 0 | 0 | 0 |
| Batch 3B | 25 | 1263 | 2650 | 0 | 0 | 0 | 0 |
| Batch 4 | 25 | 38 | 0 | 0 | 0 | 0 | 1 |
| Batch 5 | 25 | 28 | 0 | 0 | 0 | 0 | 0 |
| Batch 6 | 25 | 25 | 0 | 0 | 0 | 0 | 0 |
| Batch 7 | 25 | 15 | 0 | 0 | 0 | 0 | 2 |
| Total | 161 | 4683 | 12842 | 0 | 0 | 0 | 3 |

Batch 3A and 3B were applied through `GET /api/v4/projects/id/{EK ProjectID}`
only. No `/api/v4/fitterhours` endpoints, full sync, scheduler changes,
sync-state changes, tenant-wide refresh, deletes, or cross-project moves were
used.

Batch 3A:

- Projects: 25
- Inserts: 2862
- Updates: 8194
- Unchanged: 0
- Activity materializer: 25 of 25 scoped projects.

Batch 3B:

- Projects: 25
- Inserts: 1263
- Updates: 2650
- Unchanged: 0
- Activity materializer: 25 of 25 scoped projects.

Batch 4:

- Projects: 25
- Inserts: 38
- Updates: 0
- Unchanged: 0
- Deletes: 0
- Cross-project moves: 0
- Conflicts: 0
- Reference mismatches during pre-check: 1 (`10889-005`, EK ProjectID `25000`,
  live EK reference `10889-026`)

Batch 5:

- Projects: 25
- Inserts: 28
- Updates: 0
- Unchanged: 0
- Deletes: 0
- Cross-project moves: 0
- Conflicts: 0
- Reference mismatches: 0
- Activity materializer: 18 of 18 scoped projects with fitterhour rows.

Batch 6:

- Projects: 25
- Inserts: 25
- Updates: 0
- Unchanged: 0
- Deletes: 0
- Cross-project moves: 0
- Conflicts: 0
- Reference mismatches: 0
- Activity materializer: 16 of 16 scoped projects with fitterhour rows.

Batch 7:

- Projects: 25
- Inserts: 15
- Updates: 0
- Unchanged: 0
- Deletes: 0
- Cross-project moves: 0
- Conflicts: 0
- Reference mismatches during pre-check: 2 (`13961-004`, EK ProjectID
  `28570`, live EK reference `13961-026`; `14488-004`, EK ProjectID `28563`,
  live EK reference `14488-026`)
- Replacement candidates used: `14515-027`, `14516-027`
- Activity materializer: 7 of 7 scoped projects with fitterhour rows.

Read-only post-check after Batch 7 confirmed the parked, mismatch, and LARGE projects
remained classified and were not part of the apply batches.

## READY Analysis

Read-only analysis on 2026-06-13 found:

- Open projects with EK ProjectID: 1699
- Open refreshed entries: 161
- Open conflict entries: 1
- Open related-conflict entries: 0 (`33334` is closed)
- Open reference-mismatch entries: 4
- Open large entries: 14
- DB-classified READY projects: 1519

An attempted tenant-wide live scoring run hit EK rate limiting (`429`) after
the first successful project-detail responses. Because of that, the list below
is a verified probe sample, not a complete tenant-wide top-50 ranking or full
tenant-wide prioritization.

Important operational finding:

- `9002` was found as a very large READY candidate in the successful probe
  sample: 10,754 expected inserts and 920 expected updates.
- `9002` is now classified as `LARGE` and must be handled outside normal
  green batches.

## Remaining READY_DB_CLASSIFIED Candidates

The current `READY_DB_CLASSIFIED` count is 1519. This is a DB classification,
not a live-green queue. None of these projects should be applied until they
pass the normal live EK pre-check:

- local reference matches live EK project-detail reference;
- no duplicate remote `source_key` values;
- no `fd_project_id` mismatch;
- no cross-project `source_key` conflict;
- volume class is acceptable for the intended batch.

The following DB-only candidates were identified as a possible Batch 4
pre-check window. They are sorted by missing/null activity first. Expected
remote inserts and updates are unknown until live EK pre-check has been run.

| # | Reference | EK ProjectID | Classification | Activity | Expected size |
|---:|---|---:|---|---|---|
| 1 | `10255` | `704` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 2 | `10482-027` | `30694` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 3 | `10516` | `1000` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 4 | `10637` | `1122` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 5 | `10637-027` | `30953` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 6 | `10889-005` | `25000` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 7 | `10889-027` | `30697` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 8 | `10889-028` | `31134` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 9 | `10889-029` | `31148` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 10 | `10889-030` | `31149` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 11 | `12017` | `2658` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 12 | `12021` | `2663` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 13 | `12023` | `2665` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 14 | `12024-027` | `30148` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 15 | `12025` | `2667` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 16 | `12026` | `2668` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 17 | `12068` | `2711` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 18 | `12071` | `2714` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 19 | `12072-027` | `30369` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 20 | `12074` | `2717` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 21 | `12075` | `2719` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 22 | `12078` | `2722` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 23 | `12078-026` | `30650` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 24 | `12149` | `2802` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 25 | `12276` | `2935` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 26 | `12279` | `2938` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 27 | `12280` | `2939` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 28 | `12283` | `2942` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 29 | `12285` | `2944` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |
| 30 | `12286` | `2945` | `READY_DB_CLASSIFIED` | null | very small DB-local volume; live size unknown |

Recommended next action:

- Do not run Batch 4 apply directly from this DB-only list.
- Run a read-only live EK pre-check for a small Batch 4 candidate window.
- Keep the next normal green apply batch at 25 projects unless the pre-check
  shows very small volumes and no rate limiting.
- Continue handling `LARGE`, `CONFLICT`, `RELATED_CONFLICT`, and
  `REFERENCE_MISMATCH` outside normal batches.

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
