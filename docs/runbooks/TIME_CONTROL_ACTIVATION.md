# Timekontrol HC Activation Plan

Status: activation explicitly approved on 12 October 2026; rollout in progress.
The six-person operation is active; tenant-live and automatic flags remain off
until the narrow live-setting SQL fix below is deployed and verified.
Target: first scheduled control Tuesday 13 October 2026 at 09:00,
Europe/Copenhagen (07:00 UTC), evaluating Monday 12 October.

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
provider calls. Deployment and final activation evidence follow after rollout.

## Verified Release And Final Production Check

Code commit `d030835fa10077f75625d4ae32304c7ef9de622d` is live in Render
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

## Scope And Current Evidence

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
Only HC currently has enabled Timekontrol settings.

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

## What To Activate After Approval

Finish activation preferably by Tuesday 13 October 08:45 Copenhagen, and
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

No part of these activation steps has been performed by readiness work.

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

**This week is NOT qualified now: 0/4 planned daily controls are complete.**
It can qualify only if activation includes Monday coverage and starts before
Tuesday 09:00, the entire approved cohort retains a valid completed scheduled
control on each of the four dates, and Friday's timely weekly control obtains
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

The agreed counted/excluded pay-code rules are unchanged. Unknown/missing
references, invalid hours, uncertain completeness, stale observations or a
changed identity block employee mail. A real tenant-wide zero-day contract is
still unverified and remains blocked; an individual with no rows in a proven
complete nonempty tenant day can validly have zero counted hours.

The scheduler processes only the exact Timekontrol outbox IDs returned by its
committed run. It never sweeps the 60 unrelated fravær/absence rows. The shared
processor performs one durable claim, sends with the stable logical idempotency
key and a 15-second timeout, and never retries Timekontrol automatically.
An ambiguous provider response is terminal and visible as unclear; abandoned
`processing` attempts are not reclaimed. No POC test is part of this path.

## Observe Success Or Failure

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
3. Set both Render flags to `false` through the normal configuration procedure.
4. Verify dry-run, paused operation and both disabled flags. Do not drain queues.

An already started provider call cannot be recalled. Locks may make the stop
wait for that in-flight call; after stop confirmation the database gates apply.
Resuming creates a new epoch; old receipts/queues do not become a full new week.

## Approval Boundary

The next user approval must cover only activation of this deployed, verified
plan: the existing six-person cohort, explicit Monday coverage, live mode,
the two Timekontrol flags and resulting rollout before the first Tuesday slot.
It does not authorize general EK sync, other mail queues, LKE, rule profiles,
test resends, fabricated historical receipts or catch-up employee messages.

## Release Validation

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
