# Timekontrol HC Activation Plan

Status: ACTIVE; user-approved activation completed and runtime-verified
12 October 2026. Only HC's approved six-person group is active, covered from
12 October; tenant-live and both Timekontrol flags are enabled.
Target: first scheduled control Tuesday 13 October 2026 at 09:00,
Europe/Copenhagen (07:00 UTC), evaluating Monday 12 October.

## Incident And Scoped Repair (13 October 2026)

Current operational outcome: the first scheduled calculation is verified, but
its employee-mail transport failed. It is **not an end-to-end success**.
The dated activation/baseline statements below predate this incident and must
not be read as the latest run status.

`verified`: original read-only Render metadata, application logs, database
run/results, immutable capture, operational receipts, mail logs/outbox and
audit were saved before any restart, rerun, queue change or deploy. Local
credential-free evidence: `.tmp/tc_incident_20261013_original.json`,
`.tmp/tc_incident_20261013_db_original.json` and
`.tmp/tc_incident_20261013_provider_read.json`. Existing production version
was `8972b6e6efae58993d689433de4bcd13c9b71649`, live deploy
`dep-db6cssbrjlhs73for80g`, one Starter web instance. Both flags remained
true, tenant live, same active epoch and exactly the approved six fitters.
No intervening deploy was present. The process's startup and actual scheduled
completion log corroborate the active Render scheduler; there was no durable
per-minute heartbeat in the old version.

Original timeline, **Europe/Copenhagen**:

| Time | Preserved fact |
| --- | --- |
| 09:00:55.511 | Scheduled live run `b2e06989-61c9-4f49-ab92-cc2755e1c302` started for 12 October. |
| 09:00:55.648 | Fresh tenant-wide EK observation began. |
| 09:01:07.312 | Capture published: 168 distinct rows, two stable 17-page passes, 34 successful first-attempt GETs, no retries or API errors. Both terminal pages had 8 rows. |
| 09:01:07.335 | Calculation completed: Mikkel/15 and Martin/295 OK at 7.5 counted hours; Jesper/18, Patrick/208, Morten/290 and Michael/498 at 0, each missing 7.5. All six results have complete coverage. Four employee mails were queued with Dennis alone in CC. |
| 09:01:07.942 | Six valid scheduled data/evaluation receipts had been recorded for the original epoch. |
| 09:01:08.317-08.967 | Four one-attempt deliveries became terminal `provider_acceptance_unclear`; no provider IDs. Original mail-log previews still said queued, so they were not transport truth. |
| 15:07:12 | Read-only Resend `GET /emails?limit=100`: HTTP 200, 2 entries, `has_more=false`; only the two previously confirmed POC mails, no operational mail accepted today. |

`verified` code/contract defect: automatic messages used the literal template
`time_control.missing_hours.employee` as a Resend tag. Dots are invalid in
[Resend tag values](https://resend.com/docs/dashboard/emails/tags), which permit
ASCII letters, digits, underscores and dashes. POC tags used underscores and
did not exercise this defect. The old processor replaced every post-start
provider error with generic uncertainty, discarding its HTTP cause. The exact
original rejection response/status was not retained and cannot be reconstructed;
the illegal request tag is proven, the historic HTTP status is not.

No failure mail was created because calculation succeeded and diagnostics were
created during calculation, not after a dispatch failure. There was no separate
status report or watchdog. Original outbox attempts, results, receipts and POC
records must remain untouched; never resend these four employee messages.
The 60 unrelated queued absence mails retained zero attempts.

### Approved Repair And Monitoring Contract

Dennis explicitly approved this scoped repair, tests, migration/deploy, the
independent monitoring service and daily DEP-only status, including one incident
status mail. The original six-person employee-mail authorization remains valid.
No new employee group, LKE recipient, rule profile or general EK sync is allowed.

- Only Timekontrol Resend tags are normalized; template identity, content,
  recipients, idempotency keys and other mail flows stay unchanged. Parsed
  definitive 4xx rejection is now distinct from unknown acceptance. Timeouts,
  conflicts, missing receipts and 5xx remain unclear, without employee retries.
- New migration `0060_time_control_observability.sql` adds tenant-scoped
  monitoring policy, expected/executed slots, append-only execution steps and
  separately claimed status reports. HC policy starts normal monitoring on
  14 October. It does not backfill qualifying controls or change old receipts.
- Each significant step is committed independently from the evaluation:
  selection/start, committed run binding, EK request/pass/page/attempt and safe
  timing/counts, validation, calculation, mail decision, committed queue,
  dispatch/provider outcome and finish. Pre-provider trace failure fails closed;
  a post-acceptance trace failure preserves the durable outbox acceptance and
  never converts it into a new send attempt.
  Credentials, raw provider bodies and unnecessary employee data are excluded.
- Scheduler heartbeat is persisted; the separate Render cron runs only
  `node scripts/monitor_time_control.js --tenant hoyrup-clemmensen --apply`.
  It never imports the app, starts sync, calls EK or dispatches employee mail.
  Cron interval is five minutes, independent of the web scheduler process.
  [Render cron pricing](https://render.com/docs/cronjobs) has a minimum charge
  of USD 1/month per cron service, plus usage above that minimum.
  Web ticks are now aligned to wall-clock minute boundaries rather than the
  startup second (the original first control started at :55). The original
  one-minute admission window and all capture/dispatch budgets remain unchanged.
- Expected start deadline: scheduled time +2 minutes, normally detected by the
  next five-minute cron (09:05 / 12:05, plus Render startup latency).
  Calculation/pipeline deadline remains 09:15 / 12:15. Existing weekly employee
  dispatch cutoff remains Friday 14:30; it is not extended.
- A finished calculation with expected queued/unprocessed mail is flagged after
  15 minutes. The watchdog also detects a missing status report. It inspects
  bounded indexed slot/status rows, not application-log history or repeated EK
  captures. A bounded previous week remains visible after an outage.
- Exactly one locked daily status report per tenant/local report date, no CC,
  To `dep@hoyrup-clemmensen.dk`, verified Timekontrol sender and Reply-To.
  Tuesday-Thursday report due 09:20, normally processed by 09:25 including cron
  startup. Friday one combined daily/weekly report is due 12:20, normally by
  12:25, leaving more than two hours before 14:30. Reports also cover no-reminder
  success and EK/data/dispatch failures; they never create operational receipts.
- Durable claim precedes provider access. Provider accepted, pending, rejected
  and unclear are distinct, with no claim of inbox receipt. Pre-provider failure
  or explicit non-ambiguous 4xx rejection may use the same locked message/key
  after five minutes, at most three claims and within 48 hours. A lost response,
  ambiguous acceptance or abandoned sending claim is terminal unclear and is
  never blindly retried. Infrastructure failure remains visible after recovery;
  delivery is not promised during an outage.
- Tenant admins read `/api/tenant/admin/time-control/operations-status` and
  `/tenant/time-control.html#operations`: next/missing/latest slots, expandable
  timeline, employee provider status and status-report status. Historical/manual
  results and POC tests remain separate. Viewing never triggers a control/mail.

Next actual planned calculation: **Wednesday 14 October 2026 09:00 Copenhagen
(07:00 UTC), evaluating Tuesday 13 October**. No delayed 12 October employee
reminder is permitted during validation or deployment.

Friday qualification is still the existing data/evaluation rule, not a newly
invented delivery rule: all six original 12 October receipts have valid grounds,
so this week is **1/4**, not qualified yet. Mail transport was unsuccessful and
must remain labelled so. If Wednesday-Friday's three planned daily controls
and Friday's fresh weekly capture are all valid, the existing Friday gate may
qualify; a missing/invalid later day blocks it. No manual verification, status
report, incident observation or later fetch can repair a missing planned receipt.

### Incident Release Validation

Final code gate `npm run check`: 619 passed, 8 opt-in skips, no failures;
syntax 259 files, encoding/secrets 474 files, migrations 60, static 18 checks.
The skips are not database proof. Separately executed on fresh guarded local
PostgreSQL databases:

```text
node --test test/timeControlMonitorPostgres.integration.js test/timeControlOperationalPostgres.integration.js test/timeControlWeeklyPostgres.integration.js test/timeControlAutomaticPostgres.integration.js
```

28 passed, no skips/failures; all 60 actual migrations. This includes real
service capture/evaluation/queue trace, real dispatch guards, concurrent claims,
zero-row employee in a complete fixture, restart/epoch/expiry protection,
locked report content, EK/error/unclear-provider paths and no-reminder status.
Source/clock and provider receipts are simulated, never external proof.
The owned local PostgreSQL instance and local UI preview were stopped after
validation. Browser fixture QA verified desktop and 390x844 mobile layout,
expandable timelines and precise mail statuses. Production browser login was
expired, so this does not claim authenticated production-page verification.

### Completed Incident Rollout And Runtime Verification

`verified`: commit `c98f0e8f10365586a2081deef1576cf46281d525` was committed,
pushed to main and auto-deployed by Render. Web deploy
`dep-db73i3gae00c73bnhmi0` went live at `2026-10-13T13:59:40.701658Z`
(15:59:40 Copenhagen). Normal pre-deploy applied migration 0060 in 276 ms
and skipped 59 files. Read-only status subsequently verified 60 applied,
0 pending, 0 failed, 0 checksum mismatch against committed Git blobs.
An initial operator checksum check compared Windows CRLF working-copy bytes;
that false mismatch was corrected in the local verifier, not by editing or
reapplying any migration. The web process logged minute-aligned scheduler
startup at `2026-10-13T13:59:30.587Z`; persisted heartbeats confirm it runs.

Independent Render service: **`crn-db73jjrl550s73aljjo0`**, named
`fielddesk-hc-timecontrol-monitor`, Starter, Oregon, schedule `*/5 * * * *`,
auto-deploy off. Its pinned live release is the same code commit, deploy
`dep-db73jkbl550s73aljkn0`, live `2026-10-13T14:02:16.088353Z`.
The first actual scheduled cron completed at `2026-10-13T14:05:30.556Z`
(16:05:30 Copenhagen), with one future expected slot, zero abandoned reports
and no deliveries. It ran on Render, not on this laptop or a Codex session.
Only one cron was created. The local receipt parser initially expected a
`srv-` prefix; the existing `crn-` ID was verified and retained by GET, without
repeating creation. Do not create a second monitor. Future authorized code
releases must explicitly deploy this pinned cron too.

Runtime cron settings: `TIME_CONTROL_MONITOR_ENABLED=true`, both existing
Timekontrol flags true, same production DB and mail credential, verified
Reply-To. Only ten necessary env keys were copied; no EK credential, Render
operator key, general sync configuration or other mailflow configuration.
The web's protected environment digest and both existing flags are unchanged.
Only HC has an enabled monitoring policy; saved `first_schedule_on=2026-10-14`.

The one authorized incident status used job `job-db73kuvavr4c73fp55qg`, which
succeeded. It documented the existing original scheduler run without running
a new calculation/capture or issuing an operational receipt. Retrospective
execution `210d0fc5-afc5-4c41-aa55-3983fa945488` is **partial**, linked to the
original run, with 2 OK / 4 under norm / 0 blocked, four expected employee mails
and four unclear original deliveries. Its trace is explicitly retrospective,
not claimed to have been saved during the old process.

Exactly one status report `18ec07bb-b220-4e9f-9f17-d08b197d89dc`, one claim,
provider ID **`01a13594-9761-7711-8d4d-f62ffadee336`**. It was accepted at
16:04:53 Copenhagen. Read-only Resend retrieval verified To Dennis alone,
no CC, the Timekontrol sender and Reply-To, and `last_event=delivered` at
16:06:30 observation. This is provider delivery evidence, **not Dennis's
confirmation of actual Outlook inbox receipt**. No repeat is authorized/needed.

Final reads at 16:06 Copenhagen verified unchanged original six results,
six receipt IDs, four one-attempt unclear outbox records, active epoch/live
settings/exact cohort, both accepted POC provider IDs and two superseded tests.
All 60 unrelated absence mails remain queued with zero attempts. The read-only
verifier recorded zero provider/EK calls. Next saved slot is
`43674fcc-0dc0-439e-a203-0bcf0c47ef81`, planned 14 October 09:00 Copenhagen,
controlling 13 October, with no start/run/mail yet. It must not be started early.
No delayed employee reminders or test mails were sent during this repair.

Production static page returned HTTP 200 and the unauthenticated operations
API returned 401. Authenticated admin/RBAC/tenant behavior is locally tested;
production overview data was read through the same read-only service, not by
fabricating a browser session. The next actual scheduled employee transport
remains unverified until Wednesday; no current test can replace that evidence.
Final local artifacts: `.tmp/tc_postdeploy_final_20261013.json`,
`.tmp/tc_transport_final_20261013.json`, `.tmp/tc_render_runtime_20261013.json`.

## Documentation Baseline (13 October 2026)

This is the existing operational source of truth, not a new activation plan.
Read-only Render deploy metadata on 13 October confirmed deployed code
`8972b6e6efae58993d689433de4bcd13c9b71649` in live rollout
`dep-db6cssbrjlhs73for80g`. Prior documentation commit `4fd3c47` is not
the deployed application version. The saved active settings, exact cohort,
routing and startup evidence below were last runtime-verified on 12 October
at `2026-10-12T12:13:24.933Z`; they were not re-read from production in this
documentation-only task. Active operation remains authorized and unchanged.

**At this documentation baseline, the first automatic operational run was not yet verified.** Its scheduled
time is 13 October 2026 at 09:00 Europe/Copenhagen, controlling 12 October.
Activation/startup, manual dry-runs and the successful mail transport test do
not prove that this automatic run completed, qualified the week or sent mail.
The 0/4 receipts and unchanged queue counts below are dated activation
observations, not a new claim about production after that scheduled time.
No production job, manual control or mail was run for this documentation task.

## Approved Activation Execution (12 October 2026)

`verified`: preflight `job-db6coc8473hc73e1895g` succeeded at
`2026-10-12T12:02:31Z`. HC was the only active tenant with enabled Timekontrol
settings; exactly fitter IDs 15, 18, 208, 290, 295 and 498 resolved with the
approved names, emails, group and approval versions. All three routing lists
were DEP alone, with the verified Timekontrol sender and Reply-To. The global
flags are used only by Timekontrol; no generic mail worker is started by them.
The 60 unrelated queued absence mails had zero attempts. Their full-row digest
was `81099e9f03f2efa1cb007079c2b893cb245e9b18af923e48421d24cd74500fe8`.

The first read-only preflight (`job-db6cnmid0e5s73a8j2j0`) failed because
the existing identity resolver uses SELECT FOR SHARE, which PostgreSQL rejects
in a READ ONLY transaction. Repeating the same reads with ordinary transaction
locks passed; neither preflight mutated application data.

Approved operator job `job-db6cp23bc2fs73blmm90` used the established audited
operation and mode services with the server-verified active HC tenant-admin
actor. It created operation `553c1851-6061-4432-9b05-b2b370af7f84`, covered from
12 October, actually started `2026-10-12T12:03:29.936Z`, with the exact six
frozen identity hashes. The subsequent live-setting statement failed: its CASE
parameter for `live_enabled_by_user_id` was inferred as text instead of uuid.
No mail or control was run. State inspection `job-db6cq2jbc2fs73blprog`
succeeded at `2026-10-12T12:05:50Z`: one active operation, settings still
dry-run/live timestamp NULL, both automatic flags off. Do not recreate the
operation when continuing activation.

The bounded repair casts the existing actor parameter to uuid in both mode
upsert branches; no schema, rules, recipients or guard changes. The actual
PostgreSQL operational suite now exercises confirmation rejection, dry-run,
live with persisted actor UUID, repeated live preserving its timestamp, stop
clearing live fields, reactivation, and untouched other-tenant settings.
Validation: `npm run check` passed (556 tests, 7 opt-in skips), and the three
isolated PostgreSQL suites passed all eight tests with zero skips and external
provider calls. The owned local PostgreSQL server was stopped after validation.

### Completed Rollout And Saved Runtime State

`verified`: repair commit `8972b6e6efae58993d689433de4bcd13c9b71649` was
committed, pushed to main and deployed as `dep-db6cr0c9v7es739ul1h0`, live at
`2026-10-12T12:08:36.655019Z`; health HTTP 200. No new migration was required;
normal pre-deploy reported 0 applied, 59 skipped.

Job `job-db6crvid0e5s73a938q0` succeeded at `2026-10-12T12:09:49Z`.
It verified and retained the same operation (no duplicate epoch), then used
the repaired existing mode service. Saved settings: `is_enabled=true`,
`mode=live`, `live_enabled_at=2026-10-12T12:09:45.945Z`, live actor
`8eaddbc0-8fc7-414a-9c5c-064617972394`, timezone `Europe/Copenhagen`,
group external ID `61`, daily norm 7.50, freshness 180 minutes. Employee CC,
leader and internal diagnostic lists each remain exactly
`["dep@hoyrup-clemmensen.dk"]`.

Only the service's two Timekontrol environment keys were updated, using
Render's per-key endpoint: `TIME_CONTROL_SCHEDULER_ENABLED=true` and
`TIME_CONTROL_MAIL_ENABLED=true`. Full before/after comparison of all other
service environment values passed; credentials, global sender and other flags
were not changed. A subsequent flag-readback check needed corrected PowerShell
array handling; read-only inspection confirmed both values were already saved,
so the updates were not repeated. Protected non-Timekontrol environment digest:
`894b037c099078fa46b25b6c58f0ddb3821cec0f7c52d1b9d28b0a2fc3d6fe51`.

Approved configuration rollout `dep-db6cssbrjlhs73for80g` used `deploy_only`
with the same repair commit and went live at `2026-10-12T12:12:04.40108Z`.
It also reported 0 migrations applied, 59 skipped. The actual Render web
process logged at `2026-10-12T12:11:54.262039931Z`:

```text
[timeControl.scheduler] started interval=60000ms timezone=Europe/Copenhagen
```

Health remained HTTP 200. This is the paid Starter web service, one instance,
running `node src/server.js`; app startup owns the recurring timer. Neither
the laptop, one-off verification job nor a Codex session owns the schedule.
No separate local scheduler or manual future-slot tick was started.

Final runtime job `job-db6ctlm7bikc73cdlvj0` succeeded at
`2026-10-12T12:13:28Z` with marker `TC_ACTIVATION_FINAL_RUNTIME_VERIFIED`.
Its reads at `2026-10-12T12:13:24.933Z` verified:

- Both flags true in the production runtime; saved tenant-live and the same
  active epoch/coverage. The scheduler's enabled-tenant query returned HC only.
- Exact current six-person cohort and approved names/To addresses below, all
  approval version 1, with Dennis alone in CC. LKE is excluded.
- From `Fielddesk Timekontrol <timekontrol@mail.fielddesk.dk>`, Reply-To
  `admin@fielddesk.dk`; global `Fielddesk <noreply@mail.fielddesk.dk>` unchanged.
- Next actual slot calculated by the deployed schedule is
  `2026-10-13T07:00:00Z` (09:00 Copenhagen), `daily_09` of `2026-10-12`.
  The following three daily slots and Friday 12:00 weekly slot match the table.
- A tick at the actual current Monday time returned `no_scheduled_control`.
  No synthetic Tuesday tick, live control, catch-up or historical resend ran.
- Live runs 0, planned receipts 0, general sync jobs still 186. The unrelated
  outbox remains 60 queued rows with the exact preflight full-row digest above
  (including zero attempts); no Timekontrol outbox records exist.
- All four POC records are unchanged: both accepted provider IDs/timestamps
  remain as recorded in the mail runbook, and both superseded prepared tests
  remain unattempted. The test sender additionally requires scheduler=false.
- The verification job prohibited all fetch/send calls and recorded zero
  provider calls. No test, old result or collection reminder was sent.
- All six Friday gates are currently ineligible with
  `scheduled_control_missing:daily_09:2026-10-12` (0/4). Monday coverage and
  timely activation allow this week to qualify only after the four actual
  planned valid daily controls and Friday's valid weekly capture.

The first automatic operational execution is not yet verified. Check its run,
receipts, structured scheduler outcome and linked outbox/provider receipts
after Tuesday 09:00 using the monitoring procedure below; never substitute a
manual run if that slot fails. All fail-closed and no-automatic-retry guards
remain unchanged by the SQL parameter-type repair.

## Prior Readiness Release And Production Check

Code commit `d030835fa10077f75625d4ae32304c7ef9de622d` was live in Render
deploy `dep-db6c6j8ae00c73agslbg`, finished
`2026-10-12T11:24:41.665491Z`; health returned HTTP 200. Normal pre-deploy
migration procedure applied zero and skipped 59 existing files. Status reports
59 applied, 0 pending, 0 failed, 0 checksum mismatch.

Post-deploy job `job-db6c7oss728c73fvrp60` succeeded at
`2026-10-12T11:26:44Z`. A fresh 12-GET capture of 12 October contained 59 rows,
two stable six-page passes, observed at `2026-10-12T11:26:36.441Z`.
Dataset `560371f1-d639-438c-846b-76bff98e3501`, revision
`ae5aa14d13571199cee942ea0e7520ce504eef8b19ac8fe6759b7af154f1c61c`.
The source changed from the earlier 56-row capture; the new current head was
published and the older immutable capture was retained. This observed change
does not by itself prove a real deletion; correction/deletion behavior was
verified separately with isolated PostgreSQL fixtures.

The existing manual run `3f22be93-1e95-4e1c-8071-2ea59138e16e` completed as
dry-run with all six correct names/approved emails and complete coverage.
Each still had zero counted hours at this provisional Monday observation;
no claim of final missing hours or scheduled qualification is made.

Before/after: outbox 60, operational checks 0, operations 0, general sync jobs
186, POC test records 4. Both accepted POC provider IDs are unchanged. No mail
was sent or test resent. Runtime verified scheduler disabled, automatic mail
disabled/default-off, mode dry-run and live timestamp NULL; all three HC
routing lists remain DEP alone. A disabled future-slot tick skipped before
database work, and the automatic dispatch bridge skipped without claiming rows.
All six Friday gates returned ineligible (`operation_not_active`).

## Scope And Prior Readiness Evidence

- Tenant: `hoyrup-clemmensen`, `f1f51c07-2d88-4ee4-a766-78eac833a9d0`.
- Existing approved group: `bdcea2d1-14e2-4477-813b-8657de826905`, EK ID `61`.
- Render: `srv-d6h0h8fgi27c73a99jgg`, `starter`, one instance, `node src/server.js`.
- No new rule profile, general EK sync, group import or historical backfill.
- LKE excluded from all employee CC, summary and diagnostic routing.
- Mail transport passed: Dennis confirmed both Mikkel's To receipt and his CC
  for test `275bfde9-41d2-47fa-ae12-1950e1f18c68`, dated 12 October 12:38
  Copenhagen. No test resend is permitted.

Production preflight `job-db6bkejrjlhs73fkoe0g` verified six current identities,
approved addresses, the saved rules/routing, no active operation or current-week
receipts, `mode=dry_run`, `live_enabled_at=NULL` and scheduler `false`.
Only HC had enabled Timekontrol settings in this preflight; the final
activation verification above confirmed the same tenant scope.

Current-data dry-run `job-db6blevavr4c73asje20` completed with a trusted capture
of 12 October: 56 rows, two stable passes of six pages, 12 read-only EK GETs,
observed at `2026-10-12T10:47:34.068Z`. Dataset:
`640f4962-e19b-4a79-a8ea-8be1d81afee7`. All six identities classified correctly
with complete coverage and currently zero recorded hours. Monday was still
in progress: this is provisional, not a claim of a final deficit.
Outbox stayed 60, sync jobs stayed 186, operational checks stayed zero;
zero provider calls. The six generated previews cannot qualify the week.

## Approved Recipients

| Fitter | Name | Approved To address |
| --- | --- | --- |
| 18 | Jesper Sahner Kaiser | jsk@hoyrup-clemmensen.dk |
| 290 | Morten Bode | mbo@hoyrup-clemmensen.dk |
| 15 | Mikkel Hyldebo Jensen | mhj@hoyrup-clemmensen.dk |
| 498 | Michael Peter Jensen | mpj@hoyrup-clemmensen.dk |
| 295 | Martin Uth Møller | mum@hoyrup-clemmensen.dk |
| 208 | Patrick Mylord Pedersen | pep@hoyrup-clemmensen.dk |

All operational mail uses:

- From: `Fielddesk Timekontrol <timekontrol@mail.fielddesk.dk>`.
- Reply-To: `admin@fielddesk.dk`.
- Employee CC: `Dennis <dep@hoyrup-clemmensen.dk>` only.
- Weekly leader summary: To Dennis only, no CC.
- Internal diagnostic: To Dennis only, no CC.
- Other modules' sender, queues and retry policy are unchanged.

## Executed Approved Activation Procedure

The following approved procedure is now completed; actual evidence is above.
The original deadline was preferably Tuesday 13 October 08:45 Copenhagen, and
always before 09:00. A missed slot must not be fabricated or replaced by a
manual run. Recheck the final release SHA, health, six approvals and saved
DEP-only routing before proceeding.

1. As an authenticated HC tenant admin, POST
   `/api/tenant/admin/time-control/operation` on the HC tenant host:

```json
{
  "group_id": "bdcea2d1-14e2-4477-813b-8657de826905",
  "covered_from": "2026-10-12",
  "status": "active",
  "confirm": "BEKRAEFT:timekontrol-drift:hoyrup-clemmensen:active"
}
```

This explicitly records that the approved six-person cohort is covered from
Monday, and freezes its identity/mail approval hashes in a new audited epoch.

2. PATCH `/api/tenant/admin/time-control/settings`:

```json
{"mode":"live","confirm":"AKTIVER:timekontrol-live:hoyrup-clemmensen"}
```

3. Through the normal Render environment procedure, change only
   `TIME_CONTROL_SCHEDULER_ENABLED=true` and `TIME_CONTROL_MAIL_ENABLED=true`.
   The latter is new and default-off; only the literal `true` enables mail.
   Allow the resulting configuration rollout/restart after this approval.
   Preserve Resend credentials, global sender, Reply-To and every other flag.
4. Verify the active epoch, live timestamp, both flags, health and scheduler
   startup log. Do not run a manual live control or a broad outbox apply.

Readiness work did not perform these steps; the separately approved activation
above did. The operation/mode changes used the existing audited services in a
production operator job after server-side tenant/admin/identity validation,
rather than an interactive HTTP session. No auth or route behavior was changed.

## Schedule And Friday Qualification

| Actual scheduled start | Controlled date | Employee decision |
| --- | --- | --- |
| Tue 13 October 09:00 | Mon 12 October | Below 7.5 counted hours |
| Wed 14 October 09:00 | Tue 13 October | Below 7.5 counted hours |
| Thu 15 October 09:00 | Wed 14 October | Below 7.5 counted hours |
| Fri 16 October 09:00 | Thu 15 October | Below 7.5 counted hours |
| Fri 16 October 12:00 | Mon 12 through provisional Fri 16 | Below 37 counted hours, only if operational gate passes |

All times use Copenhagen, independent of Render's Oregon region. The existing
in-process scheduler ticks every 60 seconds and must start in the scheduled
minute. Completion must occur before 09:15 or 12:15. Daily dispatch ends at
09:15; weekly reminder dispatch ends at 14:30. These are completion/send
windows, not catch-up permission. Restarts in the same scheduled minute reuse
a completed live slot without recapturing or creating another notification.

**At activation verification on 12 October: 0/4 planned daily controls;
the week was not qualified. Current qualification is not re-verified here.**
Activation included Monday coverage and completed before Tuesday 09:00.
The week can qualify only if the entire approved cohort retains a valid
completed scheduled control on each of the four dates, and Friday's timely weekly control obtains
five fresh current server captures. This is four daily receipts per technician
(24 for the six-person cohort), plus Friday's current weekly receipt per
technician. Historical, manual, maintenance, dry-run and backfill runs never
issue these receipts. A missing, blocked or failed daily run leaves the week
internal-only; a Friday re-fetch cannot repair the missing scheduled receipt.

The Friday reminder is about finishing the week's registration before leaving,
not an assertion of a final deficit. No Friday day-minimum is imposed on the
37-hour weekly total. If nobody qualifies for a reminder, no employee mail or
leader summary is sent.

## Data And Sending Guards

Each control re-reads exactly the relevant day via the bounded v4 endpoint;
Friday re-observes all five dates separately. Two stable complete passes must
agree on IDs and canonical rows; pagination, totals, dates and API errors are
validated. Capture-start time, not import/sync time, establishes freshness
(currently 180 minutes). Calls are bounded to 120 seconds per day, fixed
pageSize 10 and at most three attempts per GET.

Corrections/deletions produce new immutable captures and replace the day head.
Old captures/audits remain. Head invalidation commits before re-fetching, so
failure or process interruption cannot leave old evidence sendable. Current
head, freshness, identity, routing, classification, epoch and immutable result
bindings are checked again while locks are held through the provider call.
Changes in the configured cohort block a live run rather than silently
qualifying a smaller group.

The complete current cohort is re-resolved and locked again at dispatch,
including replayed completed slots; disabling one or all approved technicians
cannot silently turn six-person approval into a smaller mail cohort. Activation
time is taken after lock waits/identity checks, and each scheduled execution
admits its active epoch IDs before capture. A later activation or epoch restart
cannot acquire the earlier execution's planned receipts.

The agreed counted/excluded pay-code rules are unchanged. The existing HC
mapping in migrations 0049, 0053 and 0055 counts references `1195`, `1199`,
`1220`, `3300`, `9000`, `9010`, `9012`, `9022`, `9200`, `9300`, `9315` and
`9320`; it excludes `1244`, `1246`, `9043`, `9070` and `9076`.
Approved absence categories count by this mapping, not by an inferred EK
manager-approval status. No fallback classification or rule-profile expansion
is authorized. Unknown/missing references, invalid hours, uncertain
completeness, stale observations or a
changed identity block employee mail. A real tenant-wide zero-day contract is
still unverified and remains blocked; an individual with no rows in a proven
complete nonempty tenant day can validly have zero counted hours.

The scheduler processes only the exact Timekontrol outbox IDs returned by its
committed run. It never sweeps the 60 unrelated fravær/absence rows. The shared
processor performs one durable claim, sends with the stable logical idempotency
key and a 15-second timeout, and never retries Timekontrol automatically.
An ambiguous provider response is terminal and visible as unclear; abandoned
`processing` attempts are not reclaimed. No POC test is part of this path.

## Known Limitations

- The first automatic calculation is now verified, but its four deliveries
  failed as described in the incident section. The next actual scheduled run
  and end-to-end employee delivery after the repair remain unverified.
- A real tenant-wide zero-day source contract is unverified and blocked. An
  individual's zero hours in a proven complete nonempty tenant day is distinct.
- Two stable bounded reads are not an EK atomic snapshot/change/deletion
  guarantee. Corrections/deletions are handled by new immutable captures and
  current-head invalidation; actual deletion behavior was tested with fixtures,
  not demonstrated by the real 56-to-59-row observation.
- The in-process Render scheduler requires the service to be running in the
  planned minute. There is no catch-up qualification or automatic retry of an
  uncertain delivery. Inspect run/receipt/outbox evidence before any action.
- Friday is provisional, not a final deficit. Four actual valid scheduled
  daily controls plus Friday's current valid weekly capture are required.
- Provider acceptance is not actual inbox receipt. The separate transport test
  was user-confirmed for Mikkel (To) and Dennis (CC), as recorded in
  [the mail runbook](MAIL_PROVIDER_VERIFICATION.md); operational delivery
  must be evidenced separately. An in-flight provider call cannot be recalled.

## Observe Success Or Failure

- Current detailed status: `/tenant/time-control.html#operations` and the
  read-only tenant-admin `operations-status` API. Check the independent cron's
  last-check timestamp as well as the web scheduler heartbeat; neither proves
  provider delivery. The linked original outbox is transport truth.
- Scheduler startup: `[timeControl.scheduler] started`.
- Per control: structured `time_control_scheduled_finished` includes tenant,
  run ID, type/date, completed/blocked status and exact mail processing counts.
  Tenant/tick exceptions are logged separately; blocked runs are not success.
- HC admin status API/UI: six results with coverage, classification, counted
  and excluded pay codes, current dataset markers and unfinished runs.
- GET `/api/tenant/admin/time-control/operation`: active epoch/cohort.
- Inspect `time_control_operational_check` tenant-scoped to verify actual
  planned receipts. Never infer Friday eligibility from previews or totals.
- Read-only command, from backend root:
  `node scripts/process_email_outbox.js --tenant hoyrup-clemmensen --status-only`.
  `unclear_time_control` lists ambiguous/abandoned one-attempt deliveries.
- `email_outbox.status='sent'` plus provider ID means provider acceptance,
  not a human-confirmed inbox receipt. A mail-log row may still say queued;
  use its linked outbox receipt for actual transport state.
- Failures: blocked/run error or data-quality reason, dead-letter error code,
  retry-disabled unclear transport result, and DEP-only diagnostic where safe.
  Inspect first; never reset attempts or resend an uncertain mail automatically.

## Stop Sending Again

1. Immediately PATCH the same settings route with `{"mode":"dry_run"}`.
   This server-side gate blocks subsequent provider calls without waiting for
   an environment rollout.
2. POST the operation route with the same group, `status="paused"` and
   `confirm="BEKRAEFT:timekontrol-drift:hoyrup-clemmensen:paused"`.
3. Set both Render flags to `false` through the normal configuration procedure,
   and suspend the independent Timekontrol cron service. Its copied environment
   does not automatically follow the web service flags, but the immediate
   database dry-run/paused gates already block its status sender too.
4. Verify dry-run, paused operation and both disabled flags. Do not drain queues.

Concrete PowerShell procedure (documentation only, NOT executed). An agent
requires Dennis's explicit written instruction before changing active operation;
read-only status inspection does not require change approval. Use an
existing authenticated HC tenant-admin access token in the operator environment;
never paste or log the token. The immediate stop does not wait for Render:

```powershell
if (-not $env:HC_TENANT_ADMIN_ACCESS_TOKEN) { throw 'Authenticated HC admin token required' }
$hc = 'https://hoyrup-clemmensen.fielddesk.dk/api/tenant/admin/time-control'
$auth = @{ Authorization = "Bearer $env:HC_TENANT_ADMIN_ACCESS_TOKEN" }
Invoke-RestMethod -Method Patch -Uri "$hc/settings" -Headers $auth -ContentType 'application/json' -Body '{"mode":"dry_run"}'
Invoke-RestMethod -Method Post -Uri "$hc/operation" -Headers $auth -ContentType 'application/json' -Body '{"group_id":"bdcea2d1-14e2-4477-813b-8657de826905","status":"paused","confirm":"BEKRAEFT:timekontrol-drift:hoyrup-clemmensen:paused"}'
Invoke-RestMethod -Uri "$hc/operation" -Headers $auth
Invoke-RestMethod -Uri "$hc/status" -Headers $auth
```

Then disable only the two Timekontrol flags and roll out the stopped config:

```powershell
if (-not $env:RENDER_API_KEY) { throw 'Render operator credential required' }
$render = 'https://api.render.com/v1/services/srv-d6h0h8fgi27c73a99jgg'
$renderAuth = @{ Authorization = "Bearer $env:RENDER_API_KEY" }
foreach ($flag in @('TIME_CONTROL_SCHEDULER_ENABLED', 'TIME_CONTROL_MAIL_ENABLED')) {
  Invoke-RestMethod -Method Put -Uri "$render/env-vars/$flag" -Headers $renderAuth -ContentType 'application/json' -Body '{"value":"false"}'
}
Invoke-RestMethod -Method Post -Uri 'https://api.render.com/v1/services/crn-db73jjrl550s73aljjo0/suspend' -Headers $renderAuth
Invoke-RestMethod -Method Post -Uri "$render/deploys" -Headers $renderAuth -ContentType 'application/json' -Body '{"deployMode":"deploy_only"}'
```

Wait for the stopped rollout to be live and verify actual dry-run settings,
paused epoch, both runtime flags false and no new outbox attempts. Do not invoke
`process_email_outbox.js --apply`, catch-up, any test sender or a manual live run.

An already started provider call cannot be recalled. Locks may make the stop
wait for that in-flight call; after stop confirmation the database gates apply.
Resuming creates a new epoch; old receipts/queues do not become a full new week.

## Approved Scope And Remaining Boundaries

The user explicitly approved activation of this plan for the existing
six-person cohort, Monday coverage, tenant-live, both flags and resulting
rollout, including the conditional daily/weekly employee mail and DEP-only
summary/diagnostics. That activation is completed above. The scoped SQL fix
was necessary to save live mode and does not change the approved behavior.
No approval covers general EK sync, other mail queues, LKE, group expansion,
rule profiles, test resends, fabricated receipts or catch-up employee messages.

The active-drift protection rule is maintained in [AGENTS.md](../../AGENTS.md).
It covers changes in shared components as well as direct Timekontrol changes;
read-only investigations/documentation and the already authorized automatic
runs remain allowed. A future general EK-sync task must assess shared tables,
locks, API rate budget, queues and data ownership before implementation. It
must preserve Timekontrol's authoritative identity/approval chain, immutable
captures/current heads, operational receipts and scheduled start windows;
general sync must not overwrite or disturb them. Any concrete behavior change
requires Dennis's explicit written approval, not approval inferred from an
unrelated task. The stop commands above are a reference, not a stop instruction
for this documentation task.

## Activation Release Validation (12 October 2026)

Final local `npm run check`: 556 passed, 7 opt-in skips, 0 failed; syntax
251 files, encoding/secrets 465 files, migrations 59 files, static 18 checks.
The skips are not evidence of a database test.

Separately executed with guarded loopback PostgreSQL 17:

```text
node --test test/timeControlOperationalPostgres.integration.js test/timeControlWeeklyPostgres.integration.js test/timeControlAutomaticPostgres.integration.js
```

Eight tests passed, no skips/failures, using fresh dedicated databases and all
59 actual migrations. Operational/weekly suites exercised real capture storage,
correction/deletion, identity/epoch/cohort guards, four scheduled days, Friday
qualification, restarts and invalidation. Automatic operational transport used
six simulated Resend acceptances (four daily plus weekly employee and summary),
with zero duplicate/provider-network calls. The exact-ID concurrency suite uses
mocked domain validation/transport but actual claims, transactions and audit;
it also verifies uncertain outcomes and untouched unrelated queues.

No external mail was sent. The owned temporary PostgreSQL server was stopped
after validation; retained databases/evidence were not deleted. No new migration
is needed and no previously deployed migration was edited.
