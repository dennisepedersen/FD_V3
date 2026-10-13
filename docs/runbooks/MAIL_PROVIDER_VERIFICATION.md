# Mail Provider Verification Runbook

## HC automatic operation activated and verified (2026-10-12)

`verified`: the separately approved six-person HC operation is now active
from 12 October, tenant-live and both Timekontrol flags are true. Repair code
`8972b6e6efae58993d689433de4bcd13c9b71649` is live in configuration rollout
`dep-db6cssbrjlhs73for80g`; the Render web process logged scheduler startup.
Final verification `job-db6ctlm7bikc73cdlvj0` passed with the exact approved
names/routing/sender, no new mail attempts and all four POC records unchanged.
First planned control: 13 October 09:00 Copenhagen for 12 October. As of this
documentation update on 13 October, the first automatic operational run is
not yet verified; the activation counts below are observations from 12 October,
not a new post-schedule production check. Mail transport is passed: the user
confirmed Mikkel's actual To receipt and Dennis's actual leader CC receipt for
the locked test dated 12 October 12:38 Copenhagen. No resend is permitted.
LKE remains excluded. See the actual saved settings,
Friday gate and exact stop commands in the
[activation runbook](TIME_CONTROL_ACTIVATION.md).

## Prior mail transport and readiness evidence (2026-10-12)

`observed` (user-confirmed): Dennis explicitly confirmed both actual inbox
receipts for test `275bfde9-41d2-47fa-ae12-1950e1f18c68`: Mikkel received
the To message and Dennis received the CC. The message is dated 12 October
2026 at 12:38 Europe/Copenhagen (10:38 UTC, minute precision). This records
the user's confirmation, not an independent inspection of either mailbox.

The bounded mail transport test is passed: provider acceptance and actual
receipt at both intended recipients are now documented. No test resend is
authorized or needed. At that historical stage, the approved next work was
readiness implementation, tests/deploy and current-data verification without
employee mail; automatic sending was held pending separate activation approval.
That approval and activation are completed as recorded above. Do not restore
the historical disabled state as a side effect. LKE stays excluded; no general
EK-sync or rule-profile extension is authorized by the transport test.

The active-drift approval boundaries, six-person routing, first Tuesday slot,
Friday eligibility conditions, observation and stop procedures are maintained
in [Timekontrol HC Activation Plan](TIME_CONTROL_ACTIVATION.md). Current-data
preflight and dry-run evidence are recorded there; neither qualifies the week.

`verified` (historical): readiness code
`d030835fa10077f75625d4ae32304c7ef9de622d` was live as Render deploy
`dep-db6c6j8ae00c73agslbg`; post-deploy verification
`job-db6c7oss728c73fvrp60` succeeded with a fresh 59-row/two-pass Monday
capture and six dry-run results. Zero provider calls, new POC tests, operational
receipts or general sync jobs. Scheduler/mail gates were off, tenant was
dry-run and LKE remained excluded. At that stage the linked activation plan
was ready for separate approval; no activation had occurred. Local validation:
556 passed, 7 opt-in skips, all checks green, plus 8 separately passed isolated PostgreSQL
tests using 59 actual migrations and no external provider calls.

## Historical Mikkel acceptance before inbox confirmations (2026-10-12)

`verified`: after explicit user approval for one send, the documented Mikkel
send command ran once in Render job `job-db6bhavlot8c739jbh10` (succeeded).
It used the existing locked test `275bfde9-41d2-47fa-ae12-1950e1f18c68`;
no new test was prepared. Resend accepted the message with provider ID
`01a12fb1-81f8-7cdb-abbe-050b0f33480e`.

Read-only post-send job `job-db6bhs0473hc73dsvta0` succeeded and verified:

- Durable status: `accepted`.
- Attempt started: `2026-10-12T10:38:44.522Z`.
- Completed: `2026-10-12T10:38:44.834Z` (12:38:44 Europe/Copenhagen).
- To: `mhj@hoyrup-clemmensen.dk`; CC: `dep@hoyrup-clemmensen.dk` only.
- From/Reply-To and locked content hash unchanged from the approved record.
- Exactly one Mikkel record; four total POC records remain.
- Original DEP acceptance timestamps, hash and provider ID unchanged; no DEP
  resend. Both historical DEP records remain unattempted.
- Scheduler `false`, tenant `mode=dry_run`, `live_enabled_at=NULL`; saved
  manager recipients/employee CC remain DEP alone. LKE remains excluded.
- Existing outbox remains 60 queued rows; no outbox apply or dispatch occurred.

Provider acceptance is NOT actual inbox receipt. At this stage confirmation
was pending from both Mikkel (To) and Dennis (CC); both were subsequently
user-confirmed as recorded above. No automatic resend is allowed, including
for an uncertain result. Do not run the historical send command below again.
No code, schema, deployment or production configuration was changed in this
send operation. The post-send check ran inside `BEGIN READ ONLY`.

## Historical Mikkel preparation before the authorized send (2026-10-12)

`verified`: commit `e2a00f75fe1bcc4f6aeff911ff154a5ed7bd9e6c` was pushed
and deployed by Render as `dep-db69s6favr4c73fqprk0`, live at
`2026-10-12T08:46:24.196403Z`. Health returned HTTP 200 with `{"ok":true}`.
The existing `npm run db:migrate` pre-deploy procedure applied only
`0059_time_control_poc_mhj_mail_test.sql` (7 ms); 58 existing migrations were
skipped. No environment configuration, scheduler or live-mode change occurred.

`verified`: prepare job `job-db69svid0e5s739urgig` succeeded at
`2026-10-12T08:47:08Z` using the new explicit prepare operator. Its durable
record is:

- Test ID: `275bfde9-41d2-47fa-ae12-1950e1f18c68`.
- Status: `prepared`; no provider message or send attempt.
- Prepared at: `2026-10-12T08:47:04.635Z`.
- Key: `time_control_poc_mail:v1:f1f51c07-2d88-4ee4-a766-78eac833a9d0:7aac3ac3-a4cf-4f2c-bddf-491bcb2b4f45:mhj_delivery:f17ba1b9eb99`.
- Locked SHA-256: `e1680d016568f8288a62e9c4e0c80d51772fac19f9b9d9ad201609a032024114`.
- To: `Mikkel Hyldebo Jensen <mhj@hoyrup-clemmensen.dk>`.
- CC: `Dennis <dep@hoyrup-clemmensen.dk>`.
- From: `Fielddesk Timekontrol <timekontrol@mail.fielddesk.dk>`.
- Reply-To: `admin@fielddesk.dk`.
- Subject/body: exactly the approved Mikkel mail below, with no action required.

The following command was presented for separate approval, then executed once
as recorded above. It is retained as history, NOT a command to run again.
Do not create another test or reuse the DEP send command.

```sh
TIME_CONTROL_POC_APPROVED_ACTOR_ID=8eaddbc0-8fc7-414a-9c5c-064617972394 node scripts/time_control_poc_mhj.js send 275bfde9-41d2-47fa-ae12-1950e1f18c68 SEND:timekontrol-poc-mhj:275bfde9-41d2-47fa-ae12-1950e1f18c68
```

The final staged `npm run check` passed: 519 tests, 6 opt-in skips, 0 failures;
247 syntax files, 460 encoding/secrets files, 59 migration files and 18 static
assertions. `git diff --cached --check` passed. No isolated local PostgreSQL
integration suite was run in this change; the opt-in skips are not DB proof.

`verified`: production job `job-db69tom7bikc73c3k6tg` succeeded at
`2026-10-12T08:48:49Z`. The normal status runner reports 59 applied, 0 pending,
0 failed, 0 checksum mismatch. There is exactly one Mikkel record and four
total POC records. Only the already accepted DEP record has an attempt;
its locked hash and provider ID are unchanged. Both older DEP records fail
with `time_control_poc_locked_message_superseded` before claim.

The deployed Mikkel sender passed all real database/current-plan/content
checks up to the claim, with that UPDATE intercepted and rejected before
execution. All other non-SELECT statements were blocked in this validation;
the surrounding transaction rolled back. No send attempt was recorded.
The actual shared mail adapter was separately exercised with `global.fetch`
replaced by a capture-only stub: From, To, CC, Reply-To, subject and text
matched the locked message; zero external provider calls occurred. Complete
before/after snapshots of POC records and outbox counts were identical.
The existing 60 queued tenant outbox rows were not applied or dispatched.

Scheduler remains `false`, tenant mode `dry_run`, `live_enabled_at=NULL`,
employee CC and manager recipients remain DEP alone, and global `MAIL_FROM`
is unchanged. LKE remains excluded. No mail was sent or DEP test resent.
Next boundary: explicit approval to execute the exact Mikkel send command
above once. Uncertain results must never be retried automatically.

## DEP inbox confirmed; Mikkel content approved (2026-10-12)

`observed` (user-confirmed): Dennis confirmed actual receipt of the DEP test
in Outlook on 12 October 2026 at 10:19 Europe/Copenhagen (08:19 UTC, minute
precision). This is the user's explicit inbox confirmation, not an independent
mailbox inspection. It is distinct from provider acceptance.

`verified`: the authorized DEP command ran once in Render job
`job-db69g7bbc2fs73balo00`. Test `698712b3-1aec-462f-a256-f5921e4fbe7f`
is `accepted`, completed at `2026-10-12T08:19:54.355Z`, with Resend message ID
`01a12f32-64fd-7ba0-8229-08a5400b633c`. Post-send job
`job-db69glrbc2fs73ban3b0` verified the durable receipt, unchanged locked hash,
three total records and exactly one attempted record. No resend is authorized
or needed. The historical prepared DEP records remain blocked.

`verified`: read-only Render job `job-db69jdh42hec73be21r0` rechecked the
accepted DEP receipt and authoritative Mikkel preview. Mikkel Hyldebo Jensen
is To `mhj@hoyrup-clemmensen.dk`; Dennis is CC `dep@hoyrup-clemmensen.dk`.
From is `Fielddesk Timekontrol <timekontrol@mail.fielddesk.dk>` and Reply-To
is `admin@fielddesk.dk`. Tenant `mode=dry_run`, `live_enabled_at=NULL`,
scheduler `false`, and DEP-only manager recipients/employee CC were verified.
No record was created and no mail was sent by this check; total records remain
three. LKE remains excluded, and the leader overview remains preview-only.

### One approved Mikkel mail

Status: the user approved the exact content below and separately authorized
implementation, commit/push/deploy, necessary migration and preparation of
exactly one locked Mikkel record. Sending is NOT authorized. The implementation
updates the Mikkel preview to this no-action text; DEP content is unchanged.

- To: `Mikkel Hyldebo Jensen <mhj@hoyrup-clemmensen.dk>`.
- CC: `Dennis <dep@hoyrup-clemmensen.dk>`.
- From: `Fielddesk Timekontrol <timekontrol@mail.fielddesk.dk>`.
- Reply-To: `admin@fielddesk.dk`.
- Subject: `[POC-TEST - ingen handling] Fielddesk Timekontrol: mailtest til Mikkel Hyldebo Jensen`.

```text
Hej Mikkel

Dette er en aftalt testmail fra Fielddesk Timekontrol med Dennis i kopi.

Mailen er kun en test af afsendelse og modtagelse. Den er ikke en rigtig timekontrol eller en påmindelse om manglende timer, og den kræver ingen handling fra dig.

Du skal ikke ændre din timeregistrering på grund af denne mail. Ingen EK-timer er ændret, og testen aktiverer ikke live-mode eller scheduler.

Venlig hilsen
Fielddesk Timekontrol
```

The Mikkel delivery key now includes a deterministic content signature, as for
DEP. The immutable message also records the user-confirmed DEP receipt (test ID,
provider ID and Copenhagen receipt minute). Preparation and sending both verify
that exact DEP acceptance record in the same tenant/campaign.

### Approval and sending plan

1. Content and implementation/preparation approval received; no send approval.
2. Migration `0059_time_control_poc_mhj_mail_test.sql` extends only the existing
   test-key constraint to signed Mikkel keys. No old migration, record, trigger,
   sender configuration or routing is rewritten. The shared sender retains
   the committed single-attempt claim, provider idempotency and no-retry rule.
3. After checks/deploy/migration verification, run the active-tenant-admin-only
   `scripts/time_control_poc_mhj.js prepare <batch-id> PREPARE:timekontrol-poc-mhj:<batch-id>`.
   Preparation is idempotent and creates no outbox/provider message. Show the
   persisted test ID and exact locked content before requesting send approval.
4. Only after separate explicit send approval, run
   `scripts/time_control_poc_mhj.js send <test-id> SEND:timekontrol-poc-mhj:<test-id>`
   with `TIME_CONTROL_POC_APPROVED_ACTOR_ID` set to the authorized tenant admin.
   An uncertain provider
   outcome must not trigger an automatic retry. Distinguish provider acceptance
   from Mikkel's actual inbox receipt and Dennis's receipt of the CC.

Do not execute the Mikkel send command without separate approval or reuse the
DEP command. No DEP resend, LKE routing, outbox apply or scheduler/live
activation is authorized. All sender guards remain fail-closed.

### Implementation validation

The extension uses the existing table, immutable trigger, tenant-scoped unique
key, sender and durable claim. Only the Mikkel operator exposes the new stage;
no UI send button, scheduler or general outbox path was added. Both stages
resolve identities/routing inside the preparation transaction and reject a
non-null `live_enabled_at`. The DEP subject/body and signed key are preserved.

Focused checks: `node --test test/timeControl.test.js test/timeControlPocMhj.test.js test/mailService.test.js`
passed 103 tests before the final two negative cases were added. Full
`npm run check` then passed 519 tests, 6 opt-in skips, 0 failures, 59 migration
files and 18 static assertions. The skipped tests are not PostgreSQL proof.
After staging, the secrets scan flagged two literal dummy test assignments;
these were changed to the repository's existing environment-default pattern
before final validation. Render's verified existing pre-deploy command is
`npm run db:migrate`; no production configuration change is needed.

## Timekontrol verified-subdomain sender replacement (2026-10-12)

The user approved changing only Timekontrol's sender to
`Fielddesk Timekontrol <timekontrol@mail.fielddesk.dk>`, retaining
Reply-To `admin@fielddesk.dk`. The module's shared `SENDER` constant supplies
POC plans and Timekontrol outbox payloads; the POC sender validates and sends
that same locked From value. Global `MAIL_FROM`, the shared mail adapter and
other modules are unchanged. No new migration is needed.

The established content-signature replacement key includes From. Preparing
the existing batch therefore creates or reuses one new current test without
rewriting the two previous immutable records. The send guard revalidates the
current plan and rejects both previous keys before claiming a send. Tests
cover sender-key replacement, legacy/signed supersession, sender/Reply-To
forwarding and preservation of the generic mail adapter's default sender.

The production record and command in the older sections below are historical.
Their former sender-domain blocker is resolved by the verified replacement
below. No send, scheduler/live activation,
outbox apply, EK write, DNS or global mail configuration change is authorized.

`verified` locally: `node --test test/timeControl.test.js test/mailService.test.js`
passed 78/78; `npm run check` passed with 492 tests passed, 6 opt-in tests
skipped and 0 failures, plus syntax, whitespace, encoding, secrets, 58
migrations and 18 static assertions. `git diff --check` passed.
Read-only production preflight reverified `mail.fielddesk.dk` as `verified`
with sending `enabled`; scheduler `false`, Reply-To `admin@fielddesk.dk`,
and global From `Fielddesk <noreply@mail.fielddesk.dk>`. No active jobs appeared
in the 20 most recent service jobs.

### Historical preparation before the authorized DEP send

`verified`: commit `cda1b4fad2a1c7c12688c72ddb71cd5ba4269ecf` is live in
Render deploy `dep-db699mavcj2c73fcmeug`, finished
`2026-10-12T08:06:49.976Z`. Backend health returned HTTP 200. The authenticated
production admin UI preview showed the new sender for all three POC stages.
The UI then prepared one new test in existing batch
`7aac3ac3-a4cf-4f2c-bddf-491bcb2b4f45` at `2026-10-12T08:07:54.042Z`.

- Current test ID: `698712b3-1aec-462f-a256-f5921e4fbe7f`.
- Current test key:
  `time_control_poc_mail:v1:f1f51c07-2d88-4ee4-a766-78eac833a9d0:7aac3ac3-a4cf-4f2c-bddf-491bcb2b4f45:dep_delivery:d0ca1acbd128`.
- Content hash:
  `b228431c93128f05b1a9f043efee4864443bf23c7e0349e6a0b14576430e8359`.
- Status `prepared`; `attempt_started_at=NULL`; `provider_message_id=NULL`.
- From `Fielddesk Timekontrol <timekontrol@mail.fielddesk.dk>`; To
  `Dennis <dep@hoyrup-clemmensen.dk>`; no CC;
  Reply-To `admin@fielddesk.dk`.
- Subject `[POC-TEST - ingen handling] Fielddesk Timekontrol: mailtest til Dennis`.
- The locked body greets Dennis, explains that this is only a mail test with
  no hour-registration action, and asks for inbox confirmation before the test
  to Mikkel Hyldebo Jensen.

`verified`: Render job `job-db69b4favr4c73akp8ng` succeeded with exactly one
current test and three total tenant-scoped historical/current records. Both
previous records (`a331f1cb-dd8b-4c9f-a93b-dd4e30f3aa15` and
`6f056355-599e-44f4-9aff-f0d89ddb3757`) retain their recorded hashes and
unsent prepared states. Both were rejected by the deployed sender with
`time_control_poc_locked_message_superseded` before claim. The current test
passed the sender's validation up to the explicit
`validated_before_claim_no_write` sentinel; all mutations were blocked and
the transaction rolled back. Provider sends: 0.

The job also exercised the deployed shared mail adapter with its network
transport replaced by a capture-only stub. The resulting Resend request From,
To, CC, Reply-To, subject and text matched the current plan/locked record.
No request was sent to Resend's email endpoint. Global From remains
`Fielddesk <noreply@mail.fielddesk.dk>`. Tenant `mode=dry_run`,
`live_enabled_at=NULL`, scheduler `false`, employee CC DEP alone and manager
recipients DEP alone were reverified. LKE remains excluded. No migrations,
outbox apply, EK writes or production configuration changes ran.

Reuse this test; do not create another batch. After explicit approval for
this one send, the exact Render/Linux action from the service's `backend`
root is:

```sh
TIME_CONTROL_POC_APPROVED_ACTOR_ID=8eaddbc0-8fc7-414a-9c5c-064617972394 node scripts/send_time_control_poc_dep.js 698712b3-1aec-462f-a256-f5921e4fbe7f SEND:timekontrol-poc-dep:698712b3-1aec-462f-a256-f5921e4fbe7f
```

The command above subsequently ran once with explicit approval; provider
acceptance and Dennis's later Outlook confirmation are recorded at the top
of this runbook. Do not run it again. Mikkel's draft still requires its own
approval and locked-test support; the leader overview remains preview-only.

## Production migration and pre-send validation (2026-10-12)

`verified`: Render/Linux status job `job-db68al0473hc73dhbfog` ran
`node scripts/db_migrate.js --status` successfully: 58 applied, 0 pending,
0 failed, 0 checksum mismatch. Migration 0058 was already applied at
`2026-10-12T06:23:51.852Z`; no migration rerun was needed. The replacement-key
constraint exists and is validated. Tenant `hoyrup-clemmensen` remains in
`dry_run`, with employee CC and manager recipients both DEP alone, and
`TIME_CONTROL_SCHEDULER_ENABLED=false`.

`verified`: job `job-db68c5g473hc73dhgtl0` exercised the deployed sender's
validation against old test `a331f1cb-dd8b-4c9f-a93b-dd4e30f3aa15`, with
all database writes and provider calls blocked and the transaction rolled back.
It rejected the old test with `time_control_poc_locked_message_superseded`,
with 0 provider calls. The old locked record remains historical and unsent.

The same production check found that raw `JSON.stringify` hashing changed
after a PostgreSQL JSONB roundtrip because object key order changed. This
would reject a newly prepared test at send validation. The narrow repair
sorts object keys when hashing, preserves array order and all message fields,
and leaves the replacement key and old immutable rows untouched. A regression
checks reordered stored content through the sender and detects changed fields.
The repair is live at commit `7725ba47513301e18ab66e0c8bb461d7cd99cfe8`,
Render deploy `dep-db68dlou01pc73fbcn8g`, finished
`2026-10-12T07:06:54.990Z`. Backend health returned HTTP 200 afterward.
No mail, scheduler activation or live-mode change is authorized by preparation.

Local validation of the repair: `node --test test/timeControl.test.js` passed
69/69. `npm run check` passed all gates: 491 tests passed, 6 opt-in tests
skipped, 0 failed; 58 migrations and 18 static assertions passed. The initial
sandboxed focused test hit the known Windows `EPERM`; the checks above ran
successfully outside that sandbox. `git diff --check` passed.

### One prepared replacement, no send

`verified`: the authenticated production admin UI prepared exactly one new
DEP test in the existing batch at `2026-10-12T07:07:38.175Z`. No replacement
existed at preflight. The old record remains unchanged as history.

- Test ID: `6f056355-599e-44f4-9aff-f0d89ddb3757`.
- Test key:
  `time_control_poc_mail:v1:f1f51c07-2d88-4ee4-a766-78eac833a9d0:7aac3ac3-a4cf-4f2c-bddf-491bcb2b4f45:dep_delivery:45addff13cfa`.
- Canonical content hash:
  `89331006cfa06a0f8f211d3ac23855680e8e69a3ddb7db65a4eaee199c127a81`.
- Status `prepared`; `attempt_started_at=NULL`; `provider_message_id=NULL`.
- From `Fielddesk Timekontrol <timekontrol@fielddesk.dk>`; To
  `Dennis <dep@hoyrup-clemmensen.dk>`; no CC;
  Reply-To `admin@fielddesk.dk`.
- Subject `[POC-TEST - ingen handling] Fielddesk Timekontrol: mailtest til Dennis`.
- Body greets Dennis and names Mikkel Hyldebo Jensen instead of initials.
  `Dennis` is the current authoritative tenant-user display name.

`verified`: Render job `job-db68f7tckfvc73chf5c0` confirmed one replacement
and two total POC test records for this tenant. The stored JSONB hash matches.
It exercised the actual deployed sender with database writes blocked and a
provider stub: the old test failed with
`time_control_poc_locked_message_superseded`; the new test passed validation up
to the claim, where the explicit `validated_before_claim_no_write` sentinel
prevented any mutation. Provider send calls: 0. The validation transaction was
rolled back. Tenant settings remained `mode=dry_run`, `live_enabled_at=NULL`,
DEP-only employee CC and manager recipients, scheduler `false`.
`MAIL_PROVIDER=resend` and a mail API key are present; no secrets were printed.

### Concrete sender-domain blocker

`verified`: read-only `GET https://api.resend.com/domains?limit=100` using the
production mail credential returned HTTP 200, `has_more=false`, and exactly
one domain: `mail.fielddesk.dk`, status `verified`, sending `enabled`.
The locked sender uses `fielddesk.dk`, which is absent from that account.
[Resend's error contract](https://resend.com/docs/api-reference/errors)
requires the From domain to match a verified domain. Treat the current sender
as blocked for real delivery; no send request was made to probe rejection.

Do not silently change the locked sender, existing records, global mail
configuration or DNS. Preserve the one prepared replacement. Before sending,
obtain approval for the sender-domain resolution, verify `fielddesk.dk` in the
same Resend account if the agreed From address is retained, and recheck the
locked content/gates. Then obtain explicit approval for this one send only.
The concrete future Render/Linux command, from the service's `backend` root,
is:

```sh
TIME_CONTROL_POC_APPROVED_ACTOR_ID=8eaddbc0-8fc7-414a-9c5c-064617972394 node scripts/send_time_control_poc_dep.js 6f056355-599e-44f4-9aff-f0d89ddb3757 SEND:timekontrol-poc-dep:6f056355-599e-44f4-9aff-f0d89ddb3757
```

This command has not run. No automatic retry is allowed. Provider acceptance
would still require Dennis's separate inbox confirmation before any test to
Mikkel; the leader overview remains preview-only.

## Timekontrol POC name-safe mail replacement (deployed, 2026-10-12)

`verified`: Render service `srv-d6h0h8fgi27c73a99jgg` reports live deploy
`dep-db67pmek1f9s73f1noeg` at commit
`a6571b0f1b0e4712b8228701f629b0f4c573df74`, finished
`2026-10-12T06:24:16Z`. Backend `/health` returned HTTP 200, and
`https://hoyrup-clemmensen.fielddesk.dk/tenant/time-control.html` returned HTTP
200 after deploy with the new Timekontrol filter UI present. Selected Render
environment gates were read without printing secrets:
`TIME_CONTROL_SCHEDULER_ENABLED=false`, `MAIL_PROVIDER=resend`,
`MAIL_REPLY_TO=admin@fielddesk.dk`. The dedicated POC sender still uses the
code-owned sender
`Fielddesk Timekontrol <timekontrol@fielddesk.dk>`.

`observed`: commit, push and deploy were completed. No mail was sent, scheduler
or live mode was not activated, outbox apply was not executed, and no EK writes
were run from this verification.

`observed`: production browser verification as authorized tenant admin loaded
the deployed page and clicked only `Vis testmailplan - afsender ikke`. The
preview returned without creating a prepared send row and displayed no
initial-based DEP/MHJ/LKE wording in the POC plan. It rendered
`Dennis <dep@hoyrup-clemmensen.dk>` for the first/manager preview recipient and
`Mikkel Hyldebo Jensen <mhj@hoyrup-clemmensen.dk>` with
`Dennis <dep@hoyrup-clemmensen.dk>` in CC for the employee preview. The
production tenant-user display name currently available for DEP is `Dennis`;
do not rewrite it to a longer name without an approved identity-data change.

Changes deployed:

- POC mail previews now derive display names from tenant/fitter identity instead
  of rendering initials in subjects, greetings, recipient display names or body
  text. The first real test remains To `dep@hoyrup-clemmensen.dk`, no CC. The
  employee test remains To `mhj@hoyrup-clemmensen.dk`, CC
  `dep@hoyrup-clemmensen.dk`, and is only preview until DEP confirms inbox
  receipt and Dennis explicitly continues.
- The existing locked DEP test with old initial-based content is not rewritten.
  A new deterministic replacement test key is generated from the corrected
  locked content. Repeating prepare for the same corrected content returns the
  same row; it does not create a new batch on every click. The send path
  revalidates the current verified plan and rejects an old prepared record whose
  key/content no longer matches.
- Migration `0058_time_control_poc_mail_test_replacement_key.sql` only relaxes
  the POC DEP test-key check to allow a content-signature suffix. It does not
  alter existing 0057 rows, status transitions, message immutability or mail
  sending behavior.
- The Timekontrol admin overview is locally changed from repeated large result
  rows to compact groups by controlled day/week, newest first, with counts for
  norm fulfilled, under norm and uncertain data. Expanded rows show employee
  name, counted hours/norm, status and mail status; technical IDs/control types
  stay under details. It also adds employee filtering and an attention-only
  filter, and renders Danish date and decimal formats.

Validated locally:

```powershell
node --test test\timeControl.test.js
npm run check:migrations
node --check backend\src\modules\timeControl\timeControl.mailTest.js
node --check backend\src\modules\timeControl\timeControl.mailTestSender.js
node --check backend\src\public\tenant\auth.js
npm run check
```

Results: focused Timekontrol `68/68`; full local gate `490 passed / 6 opt-in
skipped / 0 failed (496 total)`, with syntax, whitespace, encoding, secrets,
migrations and static assertions passing. The first sandboxed Node test attempt
hit the documented Windows `EPERM` on `C:\Users\dep`; the same read-only checks
were rerun outside the sandbox.

Browser evidence: a local-only mock harness served the actual `time-control.html`
and `auth.js` with mocked authenticated Timekontrol API responses. Desktop view
showed the corrected mail preview cards with full names in Til/CC, subject and
body. Mobile viewport `390x844` showed the compact control groups in one column
with no measured horizontal overflow for control rows, mail cards or buttons.
This did not contact production APIs or send mail.

Open before real mail:

1. Migration 0058 is verified applied with no checksum mismatch; see the
   production validation section above. Do not rerun it.
2. Reuse prepared test `6f056355-599e-44f4-9aff-f0d89ddb3757`; its test key
   and locked content are recorded above. Do not create another batch.
3. Resolve the verified sender-domain blocker above with explicit approval,
   then recheck readiness without sending. Provider acceptance is not inbox
   receipt.
4. Send only the DEP test after explicit send action:
   `node backend/scripts/send_time_control_poc_dep.js <test-id> SEND:timekontrol-poc-dep:<test-id>`.
5. Wait for Dennis to confirm actual inbox receipt before any MHJ test. LKE
   remains fravalgt, and the leader overview remains preview-only.

## Admin UI and bounded POC mail preparation (2026-10-12)

Release `b17cfa0f03ac04dfdb8b640f98494990b711974d` is deployed; migrations
0054–0056 and the repeated historical Render runtime test were verified.
The admin additions described in this section are local only and need a new
approved deploy. No mail, production recipient update or scheduler/live change
was performed during this preparation.

### Browser evidence and exact paths

- `observed`: the deployed navigation target `/tenant/time-control.html`
  returned HTTP 404 in the integrated browser. `/time-control` also returned
  404; it is not the canonical navigation target.
- The local fix adds an explicit tenant-host HTML route for the existing link:
  tenant login -> `/app` -> admin navigation -> **Timekontrol**.
- Local browser testing uses loopback-only mocked API data. It verifies rendering,
  the **Klargør DEP alene (gemmer ikke)** -> reason -> **Gem ledermodtagere**
  interaction, and **Vis testmailplan – afsender ikke**. It is not an
  authenticated production admin verification or proof of a production audit.
- After approved deploy, log in as an authorized tenant admin, open Timekontrol,
  check six mappings and EK group ID **61** (not name prefix 183), inspect the
  rules and current recipients, then save `dep@hoyrup-clemmensen.dk` alone with
  reason `POC-test: DEP alene, LKE fravalgt`. Reload and confirm one address.
  Do not click weekly dry-run merely to inspect recipients.
- Under **Kontrolgruppe, normer og regler**, approved email can be reapproved
  using the existing fitter/group mapping and reason. This UI uses an explicit
  `admin_override`, optimistic approval version and existing audit. It cannot
  reassign an already approved fitter or create membership/mappings.
- The existing resource-group admin entry is `/app#resource-groups`:
  **Admin / Ressourcegrupper** -> **Tenant admin** -> employees/groups.
  This is not a dedicated Timekontrol control-cohort editor. Group membership
  remains in the existing tenant resource-group administration;
  imported EK membership completeness is still unresolved. This preparation does
  not add manual membership, import groups, or change the approved cohort.
- Daily norms (7.5 Monday–Thursday, historical Friday daily norm 7), weekly norm
  37, Copenhagen schedules and timeart rules are displayed read-only. This UI
  cannot edit them; rule profiles and norm/time configuration are out of scope.
- **Lederoversigtens modtagere**: first address is To, remaining addresses are CC.
  Removing LKE removes that address from future leader routing. Employee To/DEP
  CC and internal-error recipients are unchanged. Existing historical previews
  are not rewritten. Dispatch already rejects queued routing changes.
- The recipient PATCH is tenant-admin protected, locks existing tenant settings,
  compares the expected old ordered addresses, validates/normalizes/deduplicates
  emails and audits old/new values via existing `tenant_config_changed`.
  It changes only `friday_manager_emails`; no migration is needed.

### Preview-only test campaign

Use batch UUID `7aac3ac3-a4cf-4f2c-bddf-491bcb2b4f45`, preserving it across reruns.
`GET /api/tenant/admin/time-control/mail-test-preview?batch_id=<UUID>` reads
the current tenant's settings and the authoritative approved MHJ mapping. It
fails closed for a changed/missing MHJ identity/email or employee CC other than
DEP alone. DEP is the only allowed leader-test recipient; LKE is never addressed.
`manager_routing_saved=false` explicitly diagnoses an unsaved DEP-only setting.

Exact subjects and full Danish bodies live in
`backend/src/modules/timeControl/timeControl.mailTest.js` and are displayed in
the admin preview. All subjects begin `[POC-TEST`; the leader subject explicitly
says `kun preview`. Sender is the existing service sender:
`Fielddesk Timekontrol <timekontrol@fielddesk.dk>`.

| Stage | To | CC | Action |
| --- | --- | --- | --- |
| `dep_delivery` | dep@hoyrup-clemmensen.dk | none | Send only after separate approval |
| `mhj_delivery` | mhj@hoyrup-clemmensen.dk | DEP | Only after DEP confirms stage 1 and separate send approval |
| `manager_preview` | DEP | none | Preview only; do not send |

Keys are `time_control_poc_mail:v1:<server-tenant-id>:<batch-uuid>:<stage>`.
They are deterministic on preview rerun, distinct from real control keys and
from one another. Preview creates no control/result/receipt/mail-log/outbox row.
There is deliberately no send endpoint or automatic provider call.

**Do not claim persistent send deduplication from deterministic preview keys.**
The current implementation separates preview and send:

- `POST /api/tenant/admin/time-control/mail-tests/prepare` creates the locked
  DEP test record and preview plan.
- A dedicated operator script `backend/scripts/send_time_control_poc_dep.js`
  can later send the locked DEP test only after explicit confirmation.
- The locked test record carries a durable test key and immutable recipient /
  content binding; the broad outbox processor and the normal control run are
  still not used for this POC path.

Provider idempotency, uncertain acceptance after timeout/crash, and
restart/rerun behavior must still be tested before any real approval flow is
considered complete. Automatic retry after unknown acceptance must not resend
blindly. Provider/sender-domain verification and explicit send approval are
also required. Provider acceptance is not mailbox receipt: DEP and MHJ must
confirm their inboxes. Scheduler stays false and tenant stays dry_run during
this test.

### Transport margin assessment

`observed`: historical Render captures had 628 successful page calls and 24
transport-error attempts. Every transport failure lasted about 15,000 ms, the
configured request timeout. Failures occurred in pairs; the first five-day
capture's Monday took 105.358 seconds, leaving 14.642 seconds of the 120-second
date budget. This cannot absorb another full 15-second timeout safely.
No HTTP 429 was evidenced; current safe attempt logs do not preserve the
underlying transport cause, so a root cause is not verified.

The first 50-page daily capture had no error. Subsequent timeout pairs align
with roughly each next 50 successful requests. `hypothesis`: a request-window,
gateway or reused-connection limit. It is not proof of EK's rate-limit contract.

Recommended next bounded change/experiment, not implemented here:

1. Record sanitized error name/cause code and whether the request's AbortController
   fired; never log URL headers, credentials or arbitrary provider error text.
2. Measure a paced sequential capture against the same explicit day, preferably
   with an EK-confirmed request-rate budget. A conservative experimental ceiling
   of 50 attempts/minute including retries (not a claimed EK contract) implies
   about 60–70 seconds minimum for 50–56 logical pages, plus actual network time.
   Check the actual 120-second deadline and five-day scheduling window.
3. If controlled evidence instead proves connection reuse is responsible, change
   only this adapter's transport lifecycle and test abort/cleanup/retry behavior.
4. Preserve two stable passes, all rows/IDs/date/total/terminal checks, Retry-After,
   max attempts, committed invalidation and dispatch freshness. Do not raise
   `complete`, discard slow pages or silently use a previous head.

Do not enable live based on a single successful 105/120-second capture.
Any timeout/rate/total-budget adjustment requires measured validation and an
explicit scheduling-budget decision rather than a completeness relaxation.

## Daily EK capture and operational-week gate (local, not deployed)

This section supersedes earlier rollout gaps concerning on-demand full-resync
and the missing startup gate; historical March demo evidence below is unchanged.
The local implementation uses migration 0056 in addition to 0054 and HC's 0055.
No production migration, deployment, real mail, scheduler activation or EK write
is authorized by local validation.

- Tuesday-Friday 09:00 Copenhagen: capture the previous workday, all tenant
  FitterHours, with no project-status/fitter filter; evaluate only approved fitters.
- Friday 12:00: recapture Monday-Friday individually, then evaluate
  `friday_weekly_v1`. All five source observations must be fresh both at evaluation
  and dispatch. Friday's counted total is provisional, never a final deficit.
- Invalidate the current head in a committed transaction before reobservation.
  Failure/process interruption leaves it invalid. New complete stable captures
  publish a new immutable revision; previous datasets/results/audit remain.
- Manual CLI/API controls are dry-run. Explicit historical datasets still work
  without a scheduler. Catch-up is internal evaluation, never delayed employee
  mail or a qualifying planned control.
- Only live/scheduler controls started in the planned minute and completed before
  09:15/12:15 issue immutable operational receipts. Daily provider dispatch stops
  at 09:15; weekly dispatch stops at 14:30.
- Receipt admission requires a completed run; mixed configuration/data failures
  block the whole run's receipts. Gate lookup also checks the referenced run is
  still completed. Scheduler fanout is bounded to four concurrent tenants;
  queued tenants missing the actual start minute fail explicitly rather than
  being backdated. Measure pool capacity/start latency before expanding rollout
  beyond the HC tenant.
- Friday's gate requires the current active group epoch, unchanged approved
  identity, four planned daily receipts and a Friday receipt for the **current**
  weekly snapshot. Repeat calls retain tenant/fitter/week/mailtype deduplication.
  Every prior mutable evaluation is archived in audit before reevaluation.
- Employee To/CC remains fitter/DEP; Friday summary To/CC remains DEP/LKE.
- Dispatch compares the whole normalized queued To/CC route with current locked
  settings and verifies immutable enqueue-time dataset/evaluation/approval
  bindings. A stale daily notification cannot borrow a rerun's mutable result.
  Weekly summaries retain and validate their exact eligible result subset.
  Changed routing/evaluation rejects rather than rewriting a queued mail or
  generating another deduplication key. Global provider behavior is unchanged;
  queue uniqueness tests do not prove exactly-once delivery across a provider
  acceptance/process-crash boundary.
- Actual EK zero-day behavior is still unverified: the adapter blocks zero rows.
  Synthetic empty-day tests are not external evidence.

### Administrative startup and controlled rollout (requires separate approval)

The complete local, uncommitted delivery manifest (38 files, including previous
weekly/capture work; not just the final review repairs) is:

```text
backend/docs/integrations/ek/fitterhours.md
backend/scripts/fd_maintenance_job.js
backend/scripts/run_time_control.js
backend/src/modules/notifications/emailOutbox.processor.js
backend/src/modules/timeControl/timeControl.capture.js
backend/src/modules/timeControl/timeControl.coverage.js
backend/src/modules/timeControl/timeControl.dataset.js
backend/src/modules/timeControl/timeControl.dates.js
backend/src/modules/timeControl/timeControl.dispatch.js
backend/src/modules/timeControl/timeControl.operation.js
backend/src/modules/timeControl/timeControl.orchestration.js
backend/src/modules/timeControl/timeControl.repository.js
backend/src/modules/timeControl/timeControl.routes.js
backend/src/modules/timeControl/timeControl.scheduler.js
backend/src/modules/timeControl/timeControl.service.js
backend/src/modules/timeControl/timeControl.weekly.js
backend/src/public/tenant/app.html
backend/src/public/tenant/auth.js
backend/src/public/tenant/time-control.html
docs/DECISIONS.md
docs/development/TESTING.md
docs/DOC_INDEX.md
docs/modules/time-control/evidence/FITTERHOURS_2026-10-05_2026-10-09.md
docs/modules/time-control/TIME_CONTROL_WEEKLY_REMINDER.md
docs/runbooks/MAIL_PROVIDER_VERIFICATION.md
migrations/0054_time_control_weekly_snapshot.sql
migrations/0055_time_control_hc_excluded_allowances.sql
migrations/0056_time_control_operational_capture.sql
test/dbMigrate.test.js
test/notificationOutboxFoundation.test.js
test/timeControl.test.js
test/timeControlCapture.test.js
test/timeControlOctoberPostgres.integration.js
test/timeControlOperation.test.js
test/timeControlOperationalPostgres.integration.js
test/timeControlPostgres.integration.js
test/timeControlWeekly.test.js
test/timeControlWeeklyPostgres.integration.js
```

1. Obtain approval for commit/push/deploy and the actual pending migrations.
   Inspect production migration history first; use the normal runner, never
   edit applied migrations or delete history/audit. Keep
   `TIME_CONTROL_SCHEDULER_ENABLED=false`, tenant mode `dry_run` and
   `MAIL_PROVIDER=disabled`; do not execute outbox apply.
2. Check `GET /api/tenant/admin/time-control/operation` on the correct tenant
   host. Validate group/approved fitter/email configuration using existing admin
   authorization. No body-supplied tenant/actor is authoritative.
3. Approve one bounded runtime dry-run with an explicit current workday:
   `node backend\scripts\run_time_control.js --tenant hoyrup-clemmensen --date <YYYY-MM-DD> --control-type daily_09 --dry-run`.
   This performs authorized EK reads **and local tenant dataset/control writes**,
   not general sync. An approved Friday test may instead select
   `--control-type friday_weekly_v1`; it performs five captures.
4. Inspect actual source totals/distinct IDs/two stable passes, current heads,
   observation times/freshness, statuses, To/CC and audit. Repeat the same control
   key and compare notification IDs/counts; newer captures themselves are legitimate
   immutable observations. Verify zero added provider-outbox/sync-job rows.
5. Only after separate startup approval, POST
   `/api/tenant/admin/time-control/operation` with
   `{group_id, status:"active", covered_from:"YYYY-MM-DD",
   confirm:"BEKRAEFT:timekontrol-drift:<tenant-slug>:active"}`.
   `covered_from` must be in the current week and not after today. Actual start
   time and cohort are server-recorded. Monday coverage plus startup before
   Tuesday 09 may qualify; later startup cannot qualify that first partial week.
   Pausing uses `status:"paused"` and the corresponding explicit confirmation.
6. Provider credentials/sender-domain/recipient delivery tests and any scheduler/
   live activation need separate approval. Dry-run receipts cannot qualify real
   dispatch: four actual planned operational controls followed by Friday's valid
   capture/control are required. A later complete week can qualify after a partial
   week. Do not enable the historical full import or clean the old general running
   job as part of this rollout. Runbook

### Read-call budget

For the verified positive-day shape with pageSize 10, a normal daily control
uses two complete passes: `2 * ceil(dayRows / 10)` successful page calls.
Friday noon uses the sum for five days, sequentially. With the retained October
counts this is 56/54/54/50/50 calls per captured day and **264** calls at Friday
noon, excluding retries. Friday's separate 09:00 Thursday control adds 50:
314 total Friday calls for that example, not a guaranteed future row count.

Bounds: 1,000 pages per pass, 2,000 successful logical pages per date,
at most three attempts per page, and 120 seconds overall per date including
retry waits. Five dates therefore have at most 600 seconds of capture time.
Each request timeout is at most 15 seconds and never exceeds the remaining
date deadline. Coverage v3 also accepts an actually verified full terminal page
(September 26: 30 distinct rows, two stable three-page passes, last page 10 rows,
nextPage=null). Historical v1/v2 retain their original contracts. Tenant-wide
zero-day behavior remains unverified and blocks explicitly.
The theoretical attempt caps are 6,000/date and 30,000/five dates, but the
deadline/rate-limit waits normally bind first. At the October page counts the
retry upper limits are 168/162/162/150/150 per date and 792 for Friday noon.

Full-terminal evidence artifact SHA-256:
`0e101bdba4a491c0b40cdea1b308199a21bb9da366014da47dfdba4be5fdb489`.

### Runtime estimate and freshness admission

The actual six-page September source capture took 1.024 seconds (about 0.17
seconds/request). Extrapolating that small sample to October's 264 calls suggests
about 45 seconds of network work for Friday; allow roughly 1-5 minutes plus
database/evaluation and queue delay. This is an estimate, not measured Render
runtime or a latency guarantee. The hard capture bound is 10 minutes for five
dates, before database/evaluation time; planned receipts must finish before
12:15. Rate limits/errors can therefore block the run instead of sending late.

With the default 180-minute freshness, sequential five-date capture fits the
capture bound comfortably. A smaller tenant threshold must exceed the oldest
capture's actual age at evaluation **and dispatch**, including database and
queue delay. Freshness is checked on all five heads twice; dispatch near 14:30
may require reobservation if a tighter threshold is configured. The runtime
dry-run must measure real pass durations/head ages and queue delay before any
live approval. Do not claim Friday freshness solely from the 45-second estimate.

### Final local review evidence (2026-10-12, not deployed)

All five review findings were repaired with targeted regressions: changed
To/CC, obsolete daily enqueue binding, blocked-run operational receipts,
eligible-only weekly summary subset, and serial tenant scheduler starts.
No general-sync implementation or global mail adapter was changed.
Migrations 0054-0056 were preserved; no additional schema migration was needed.

Executed from repository root:

```powershell
# Set retained FIELDDESK_TC_TERMINAL_EVIDENCE_PATH for the actual-source replay.
node --test test\mailService.test.js test\timeControl.test.js test\timeControlCapture.test.js test\timeControlOperation.test.js test\timeControlWeekly.test.js test\notificationOutboxFoundation.test.js test\tenantUserInvitationEmail.test.js
# Set FIELD_DESK_LOCAL_PG_TEST=1, guarded loopback test URL and retained March/October paths.
node --test test\timeControlOctoberPostgres.integration.js test\timeControlOperationalPostgres.integration.js test\timeControlWeeklyPostgres.integration.js test\dbMigrate.test.js test\timeControlOperation.test.js
npm run check
git diff --check
git diff --cached --check
```

Final results: focused **122/122**, isolated PostgreSQL **18/18**, full gate
**480 passed / 6 opt-in skipped / 0 failed (486 total)**. The separate focused
replay and PostgreSQL executions establish the opt-in evidence; skips in the
ordinary gate do not. Explicit `node --check` passed all eight new untracked JS
files; editor diagnostics reported no errors on the changed execution paths.
Whitespace passed, with Git CRLF-to-LF informational warnings only.

PostgreSQL tested full-terminal v3 publication/restore/weekly dispatch with
controlled synthetic rows, while the adapter replay used the actual retained
September source. Upgrade regression preserved 101 audit events including
three IGVA events and all 48 successful old migration histories; repeated
upgrade applied zero migrations. October reused all 1,294 actual retained rows:
six 37-hour OK results, MUM's 30 excluded hours, no reminders, provider-outbox
rows or sync jobs. Repeat/concurrent/restart queue identity remained stable.

An intermediate PostgreSQL fixture failed because a tampered recipient now
correctly returns `time_control_weekly_dispatch_routing_changed`, while the old
assertion expected `/dispatch_identity_changed/`; the assertion was updated
and the complete PostgreSQL suite then passed. Initial `pg_ctl start` without
explicit test-port options failed to bind localhost (`Permission denied`).
Starting the same isolated cluster with `-p 55432 -h 127.0.0.1` succeeded;
no Windows security configuration was changed. The test cluster is stopped
again, with its databases/evidence retained.
Retry-After and capped retry waits never extend the deadline. Publication is
all-or-nothing per date; reaching a bound is a diagnostic, not completeness. Runbook

## Local weekly-control v1 boundary (2026-10-11)

`friday_weekly_v1` is now implemented locally, with new migration
`0054_time_control_weekly_snapshot.sql`. No Render operation, EK request,
production migration, deploy, live/scheduler activation or real mail was
performed for this implementation. Existing `friday_12` day-runs and their
previews/evidence remain day-based; the historical outcomes below are not
weekly proof.

The new Friday scheduler selection is weekly at 12:00 Copenhagen, but its
enabled gate remains false. Before any separately approved activation:

1. Review/apply 0054 through the normal migration runner; never modify deployed
   SQL or relax the existing 101+Timekontrol audit allowlist.
2. Supply five immutable current tenant/day datasets for Monday–Friday.
   A continuous all-project EK reader must be connected to the server-side
   two-pass capture, publication and invalidation contract. Legacy sync
   freshness and a March 27 dataset alone cannot authorize employee reminders.
3. Source observation comes from the server capture reader, not artifact
   save/import time or `--observed-at`. Historical opt-in dry-run always labels
   evidence historical and never sends provider mail.
4. Validate endpoint-specific empty-day evidence: request page 1, response
   `currentPage=0`, `total=0`, `nextPage=null`, zero rows/errors, identical
   two-pass hashes and explicit documented all-project/date-filter scope.
   Existing one-pass future-day evidence is not itself complete-day proof.
5. Keep To employee/CC DEP and To DEP/CC LKE leader routing. Under 37 hours is
   midday registration guidance, not a confirmed difference/missing-hours claim.
6. Review the known scheduler minute-dedupe, tenant-status, retry/catch-up gaps
   before activation. Live enqueue and dispatch already fail closed outside
   Friday 12:00–14:30; expired reminders dead-letter without a provider call.
   These guards do not approve catch-up operation.

The local PostgreSQL upgrade test uses actual first-48 migrations plus 0049–0054,
retains all 101 baseline audit rows and all 48 successful history rows, archives
the original failed 0049 retry evidence, and verifies a repeat skips all 54.
The new weekly integration uses synthetic local fixtures to verify five-day
bindings, exact/over/under norm, absence/exclusions/unknown codes, complete zero
days, stale/null observations, invalidation/replacement, concurrent run locks,
one logical reminder, provider-linked employee/summary log preservation and
expired dispatch with zero provider calls. These are local runtime checks,
not EK dataset or production verification.

See [weekly contract and local CLI/admin usage](../modules/time-control/TIME_CONTROL_WEEKLY_REMINDER.md). Runbook

Status: current runbook
Scope: verifying Fielddesk invitation mail behavior without leaking secrets or sending accidental mail.

## Providers

The mail service is provider-agnostic and supports disabled mode plus configured providers such as Resend and Postmark.

Relevant environment variables:

- `MAIL_PROVIDER`
- `MAIL_FROM`
- `MAIL_REPLY_TO`
- `MAIL_API_KEY` or provider-specific key
- `MAIL_STREAM` when the provider uses it
- `TENANT_INVITE_BASE_URL`

Never print API keys or raw invitation tokens.

## Disabled Mode

`MAIL_PROVIDER=disabled` must fail clearly. It must not report a fake successful send.

## Recipients And Timekontrol POC

verified: `sendEmail` uses an explicit backend `from` when supplied, otherwise
`MAIL_FROM`. Existing reply-to and provider stream configuration are unchanged.
To and optional CC addresses share normalization (trim/lowercase) and validation.
CC accepts one address or an array, removes duplicates, and rejects unusable
entries before a provider call. Resend receives a `cc` array; Postmark receives
a comma-separated `Cc` string.

verified: the outbox validates `payload.cc_emails` when enqueueing and stores
unusable CC as an explicit dead-letter failure. The processor forwards
`payload_json.cc_emails` and the backend-supplied sender.

Timekontrol recipient routing:

- Employee missing-hours mail: employee as To, configured DEP address as CC.
- Friday manager summary: configured DEP address as To, LKE and any remaining
  configured manager addresses as CC.
- Internal error mail: first configured internal recipient as To, remaining
  internal recipients as CC.

verified: the POC defaults to `dry_run`, which records `would_send` mail logs
without enqueueing provider mail. CLI `--dry-run` forces that mode for the run
even if tenant settings specify live; it does not change tenant settings.
Scheduler enablement is opt-in. Switching settings to live requires the exact
tenant confirmation `AKTIVER:timekontrol-live:<tenant-slug>`.
Do not activate live, enable the scheduler, or execute outbox `apply` as part
of local validation. Database/production settings are not verified by unit tests.

Safe focused validation from the repository root (mocked DB/provider only):

```powershell
node --test test\mailService.test.js test\timeControl.test.js test\notificationOutboxFoundation.test.js test\tenantUserInvitationEmail.test.js
```

### Database-based Timekontrol preconditions

`--dry-run` disables provider enqueue, not dataset/control database writes or
the bounded single-day capture (five single days for the new weekly control).
Timekontrol no longer queues the general on-demand full-resync.
Do not run the CLI during a read-only preflight. It can persist runs, results,
mail previews and audit events, and queue an EK read/import job when local hours
are stale. `--no-wait-sync` still queues that job.

The pool runner commits run/job preparation before polling sync state. The worker
claims jobs through its own pool transaction, so an uncommitted job cannot be
claimed. No control transaction remains open during the wait; results, mail logs,
outbox enqueue (live only) and completion audit use a new transaction afterwards.
If evaluation fails, preparation and the sync job remain committed while result
writes roll back. Recheck the run and job before retrying; do not assume a failed
CLI invocation undid the import request. The client-level `runTimeControl` helper
does not own transactions; production callers must use `runTimeControlWithPool`.

Before approving a database-based dry-run:

- Verify migrations 0049, 0050, 0051, 0052 and 0053 and the tenant seed have been
  applied under separate approval, then inspect settings rather than assuming
  the seed is current.
- Keep Timekontrol mode `dry_run`, `TIME_CONTROL_SCHEDULER_ENABLED=false` and
  `MAIL_PROVIDER=disabled`; do not execute outbox apply.
- Resolve the intended group by an explicit, approved external identity, not its
  display name. The current fitter import does not call its resource-group
  upsert helper. Simply wiring that helper can create a second group instead of
  adopting a manual group; source payload group IDs are also optional.
- Configure an exact `fitter_id`, an approved authoritative group UUID and an
  administrator-approved recipient using the local 0051 contract below.
  Fielddesk login is optional; initials/email prefixes never establish identity.
- Verify fresh FitterHours cover the intended employees, dates and project scope.
  The global importer filters active projects and is not evidence of a complete
  all-project employee hours ledger. A historical date alone does not bypass the
  sync freshness requirement.
- Check category metadata and unresolved pay codes. Timekontrol uses a recorded
  category reference, otherwise resolves category ID through the same-tenant
  `fitter_category` lookup. Category IDs are never themselves salary references.
  Missing/zero IDs without a reference remain unclassified; they must not be
  guessed as ordinary working hours.
- After the approved run, inspect results, `would_send` logs and recipient
  routing, and verify no new Timekontrol provider-outbox entries were created.

### Local Data-Quality And Recovery Gate

The legacy database coverage adapter still returns `incomplete`; neither sync
success nor freshness overrides that. A local, internal-only coverage producer
now validates a separately fetched single-day dataset against two complete
page passes and an independent closed-project control. This is observed
two-pass snapshot coverage, not an EK-guaranteed atomic snapshot.
The result records `coverage_status`, `data_quality_reason`,
`unclassified_hours` and source-key/category diagnostics in `unclassified_rows`.
`data_incomplete` and `unclassified_hours` have no asserted missing-hours amount
(`missing_hours = NULL`). No ordinary employee reminder or missing-hours Friday
summary is generated for those results, even with live settings in unit tests.
Explicitly excluded known codes remain different from unknown codes.

These fields require local migration `0050_time_control_data_quality.sql` after
0049. It changes only the tenant-owned result table; existing rows default to
incomplete coverage. It does not retroactively classify old rows or prove old
`missing_hours` results. Local PostgreSQL execution is recorded separately
below; no Render migration has been run.
The source verification and local coverage producer are described in
`backend/docs/integrations/ek/fitterhours.md`.

`timeControl.coverage.createHoursDataset` requires exact server-resolved tenant
UUID/day/source, fixed page size, stable totals, page progression, terminal
short page, HTTP/error evidence, distinct valid row IDs/dates/identities, two
matching ordered-ID/canonical-row hashes and the matching closed-project
control. Invalid evidence throws; it never returns success-shaped coverage.
The validated row projection is immutable and held privately. Tenant/day checks
apply whenever it is consumed; a plain JSON `status=complete` object is rejected.

`runTimeControl` and `runTimeControlWithPool` require a persisted dataset UUID
for snapshot evaluation; an in-memory dataset is rejected before writes.
The manual CLI can select an already stored dataset UUID with
`--hours-dataset-id`, also requiring `--dry-run`. No HTTP body, settings update
or scheduled run can supply a dataset. This path evaluates
the exact snapshot rows, does not query legacy `fitter_hour` or queue on-demand
sync, and snapshots the coverage/hash/revision in result `identity_snapshot`.
It still writes run/results/previews/audit if deliberately executed with a real
DB client. Render execution has not been performed. Creating/evaluating the pure
dataset in memory writes nothing to a database and sends no mail.

Producing a dataset does not change coverage for old Render rows. Local migration
0052 and `timeControl.dataset` implement atomic storage of the evidence, exact
rows, proof, row hash and revision in an immutable dataset record. UPDATE/DELETE
are rejected by a database trigger. Tenant/day current-head publication and
same-tenant/day foreign keys bind the selected dataset to the run; result
foreign keys bind the exact dataset to each result. Stored JSON is revalidated
through the coverage producer before evaluation, not trusted for `status`.
Repeated imports of the same revision and observation reuse one capture.
A different/newer observation creates a new immutable capture and supersedes
the current head. Old IDs cannot be selected after supersession. Evaluation
holds a shared head lock so publication cannot change the selected revision
mid-transaction. Old results remain historical; the overview exposes
`dataset_is_current`, not a claim that they describe the new head.

Freshness uses the actual completed source-observation timestamp, never
`imported_at` or the artifact save time. Normal consumption requires the
configured freshness window (180 minutes by default). The March artifact has
no retained extraction timestamp and is therefore not claimed fresh. An
explicit `--historical-snapshot` together with `--dry-run` and a stored UUID
allows a historical demo and records `explicit_historical_demo` in the result
proof. It bypasses freshness only, not tenant/day/hash/current-head checks or
classification. It is not allowed in live or scheduled operation.

Later corrections/deletions require a complete replacement fetch of the day,
not appending/upserting legacy hour rows. Changed or removed rows change the
revision. A failed evidence-validation import commits a head invalidation and
`sync_fail` audit, then throws the actual error; old evidence is not a fallback.
Incomplete fetches or known external corrections should also call
`invalidateHoursDataset` in a transaction. An invalidated head can only be
replaced by a genuinely newer observation, not replayed old evidence. A day
that becomes empty or loses the independent control row cannot pass this
limited producer and remains blocked. There is no continuous EK importer,
webhook/deletion feed or atomic-snapshot guarantee in this change.
Before reevaluating a stored dry-run, earlier unsent `would_send` previews for
that run become `skipped`; current previews are upserted under the existing
stable keys. Thus a corrected day cannot leave an old reminder actionable.

The local evidence file is not a signed
certificate and must come from trusted server-side reads, never a client upload.
Re-fetch/revalidate before a later demo; repeat-pass stability does not establish
EK's concurrent-update/deletion guarantees or present-day freshness.

### Manual Dataset Commands (Later Separately Approved Render Writes)

Use a trusted server-read evidence file, not an uploaded client payload.
Configure the intended database explicitly and keep provider/scheduler disabled.
Preview does only a tenant lookup and pure validation:

```powershell
node backend\scripts\store_time_control_dataset.js --tenant hoyrup-clemmensen --date 2026-03-27 --file "<trusted-evidence-file>"
```

Storage below writes dataset/head/audit. Do not invent `--observed-at`: omit it
for the historical artifact; use it only for a retained actual fetch timestamp.
Failed validation in apply mode also writes a head invalidation and audit.

```powershell
node backend\scripts\store_time_control_dataset.js --tenant hoyrup-clemmensen --date 2026-03-27 --file "<trusted-evidence-file>" --apply --confirm GEM:timekontrol-dataset:hoyrup-clemmensen:2026-03-27
node backend\scripts\run_time_control.js --tenant hoyrup-clemmensen --date 2026-03-27 --control-type daily_09 --dry-run --hours-dataset-id "<stored-uuid>" --historical-snapshot
node backend\scripts\run_time_control.js --tenant hoyrup-clemmensen --date 2026-03-27 --control-type friday_12 --dry-run --hours-dataset-id "<stored-uuid>" --historical-snapshot
```

These run commands write runs/results/previews/audit, but never queue sync or
provider mail for the selected stored dataset. No Render command above has run.

Local PostgreSQL verification: all 52 repository migrations applied to a
disposable PostgreSQL 17 database on loopback. The opt-in integration test
passed with the actual 301-row artifact: stored loading/revalidation, freshness
and explicit historical mode, immutable captures, supersession/invalidation,
tenant/day and deferred run/result dataset constraints, login-free identity,
recipient approval/audit, retry idempotency, dry-run with zero provider outbox
rows and advisory-lock release. The CLI-equivalent no-user import/invalidation
uses named system actor `system:time_control_dataset`, not a fallback user.
The disposable server was stopped afterwards. These are local database facts,
not verification of Render migrations, settings or production operation.

### Fitter 24 Classification In The Observed March Dataset

`unknown_pay_code` means a supplied reference has no configured POC rule; it
does not establish that the salary reference is invalid in EK.

| Source row | Category ID | Salary reference | Hours | Classification |
| --- | --- | --- | --- | --- |
| 318939 | 299 | 1258 | 64 | No configured rule |
| 318941 | 291 | 1236 | 3 | No configured rule |
| 318942 | 291 | 1236 | 3 | No configured rule |
| 318943 | 291 | 1236 | 2.5 | No configured rule |
| 318948 | 261 | 1280 | -1.5 | Negative hours: `invalid_hours`; reference also has no POC rule |

All five rows supply a category ID and reference; none is `missing_pay_code`.
The negative entry may be a legitimate EK correction, but the POC does not yet
have an approved netting policy and does not guess one. Unclassified positive
hours total 72.5; the negative amount is preserved in the immutable source
dataset, not silently netted or counted as zero valid work.
Explicitly excluded references 1244/1246 are a separate known-rule state and
do not occur in these fitter-24 rows. Rules 3300/1220/9010/9012/9022 remain
approved; the subsequently approved extra references below do not classify
1236/1258 or change the negative-hours policy. Result: `unclassified_hours`,
`missing_hours=NULL`, no ordinary
employee reminder. Fitter 24 is the closed-project control, not a member of
the six-person demo selection.

### Approved References And Recipients (2026-10-11)

Dennis Espersen Pedersen explicitly approved these salary *references*, not EK
category IDs. Local migration 0053 adds/updates them only for
`hoyrup-clemmensen`; local PostgreSQL execution is recorded separately below.
Earlier migrations remain
unchanged, and all other previous rules are preserved.

| Reference | Counts | Approved description |
| --- | --- | --- |
| 9000 | Yes | Barsel/forældreorlov |
| 1195 | Yes | Ferie |
| 9315 | Yes | Ferie (timer) Funk. lignende |
| 9200 | Yes | SH-penge m/maximum |
| 9300 | Yes | SH-penge m/maximum. Funk. lignende |
| 9320 | Yes | SH-penge m/maximum. Funk. lignende |
| 1199 | Yes | Ufakturerbar timer |
| 9022 | Yes | Sygdom uden løn |
| 9070 | No | Stedtillæg 1 - Kalundborg |
| 1244 | No | Formandstillæg |

3300/1220/9010/9012 remain valid; 1246 remains explicitly excluded.
9300/9320 are separate keys even with identical descriptions. Unknown
references still block; they do not automatically become excluded allowances.
Configured database rules remain authoritative: updating local defaults does
not update an existing database rule set. Apply 0053 to Render later only with
separate write approval.

The user subsequently explicitly approved all six addresses, superseding the
earlier candidate-only status. These are fixed mappings for later audited
configuration, not inferred from initials or automatically refreshed master
email addresses:

| Fitter | Reference label | Approved email |
| --- | --- | --- |
| 15 | MHJ | mhj@hoyrup-clemmensen.dk |
| 295 | MUM | mum@hoyrup-clemmensen.dk |
| 18 | JSK | jsk@hoyrup-clemmensen.dk |
| 208 | PEP | pep@hoyrup-clemmensen.dk |
| 290 | MBO | mbo@hoyrup-clemmensen.dk |
| 498 | MPJ | mpj@hoyrup-clemmensen.dk |

DEP@hoyrup-clemmensen.dk and LKE@hoyrup-clemmensen.dk routing was also
approved; existing mail normalization lowercases both. Later recipient
configuration should use `admin_override` with these exact approved addresses
and an audited reason so imported master-address changes do not replace them.
Approving addresses is not permission to write Render or send mail.
Read-only verification in tenant `f1f51c07-2d88-4ee4-a766-78eac833a9d0`
resolved fitter 17's exact `tenant_user_id` link to active `tenant_admin`
`8eaddbc0-8fc7-414a-9c5c-064617972394`, email
`dep@hoyrup-clemmensen.dk`. The login's stored name is `Dennis`; the fitter's
name is Dennis Espersen Pedersen. Full-name login lookup returned no row;
identity was established by the explicit same-tenant link, not a name prefix.
Use that tenant-user UUID as the approver, never fitter ID 17, and recheck
active administrator status before a separately approved write.
Neither Dennis nor Ferhat joins the control cohort.

Pure reevaluation of the same immutable March dataset with these rules:

| Fitter | Counted hours/reference | Excluded hours/reference | Missing hours | Status |
| --- | --- | --- | --- | --- |
| 15 | 7 / 1220 | None | 0 | ok |
| 295 | 7 / 3300 | None | 0 | ok |
| 18 | 7 / 1220 | None | 0 | ok |
| 208 | 7 / 9000 | None | 0 | ok |
| 290 | 6 / 3300 | 6 / 9070 | 1 | missing_hours |
| 498 | 7 / 3300 | None | 0 | ok |

There are no unclassified rows among the selected six after this explicit
approval. MBO's 6 allowance hours do not fill the one-hour work deficit.
No database control or provider mail was run for this reevaluation.

### Friday Period Contract

Next-version decision, approved 2026-10-11: Friday at 12:00 will evaluate
Monday-Friday approved hours against 37 hours and, below that norm, send one
reminder to finish registration before 14:30 without asserting a final deficit.
See the [reglement, decision and backlog](../modules/time-control/TIME_CONTROL_WEEKLY_REMINDER.md)
for complete-period coverage and tenant/fitter/week/mail-type idempotency.
This is not implemented and does not change the current day-based POC/demo
or authorize a weekly-control deploy.

Verified from current scheduler, service and hour query: `friday_12` evaluates
the single `controlled_date`, scheduled as the current Friday at 12:00
Europe/Copenhagen. The required amount is 7 hours for that Friday, not a
weekly total. The leader summary aggregates the employees with a deficit from
that run, not historical daily results. The March 27 dataset therefore covers
the actual Friday-day control, not the March 23-27 work week.
A weekly control would require a separate approved contract and coverage for
every evaluated day; one day's proof must never be described as weekly proof.

The pool runner holds a non-blocking session advisory lock for
tenant/control-type/date across both transactions. A concurrent same-key run
is rejected; different keys do not share ownership. The lock is released when
the backend connection ends, including actual process loss. An unlock failure
destroys the pooled connection rather than returning a locked session for reuse.
Unlock always uses the same checked-out client. Acquisition response uncertainty
or failed rollback also destroys that client, even if an unlock subsequently
succeeds. Cleanup failures retain the original failure in an aggregate error;
they are not silently swallowed.

Timeout and a failed tenant-scoped sync job produce a blocked run/internal
diagnostic, not employee mail. Endpoint `partial`/`running`, pending work and
future timestamps do not qualify as fresh. After abrupt loss following the
first commit, the stored run remains `running` with `finished_at=NULL` and its
sync-job ID; `unfinished_runs` exposes these independently of the latest ten
runs. This is unfinished, not automatically proven abandoned. Verify process/
connection ownership and the job before retrying.

A rerun reuses the run's tenant/control/date unique key, the result's
run/config unique key and each mail's tenant/idempotency unique key. Result/mail
writes remain atomic. Outbox conflict handling does not reset sent status,
attempt count or retry scheduling. A retry does not retract an earlier queued
mail or undo the committed sync request; do not execute outbox apply here.
Process-loss tests simulate the interruption with mocks, not a killed live
process or a production database experiment.

### Local Technician Identity Contract (0051, Not Deployed)

- Identity is exact `(server-derived tenant_id, fitter_id)`. Require a
  definitely active fitter in that tenant and membership of the explicitly
  approved authoritative group UUID/external ID. No name, email-prefix,
  initial or login fallback establishes identity. `tenant_user_id` is optional
  enrichment and never creates access permissions or an account.
- Notification email is a separately approved normalized address. A tenant
  administrator selects an exact fitter master email or an explicit override;
  persist the approved value, source, source revision, approving actor and
  approval time. Importing a new fitter email never changes the approved
  recipient. For `fitter_master`, a changed normalized source email blocks the
  reminder until reapproval. `admin_override` remains the explicitly approved
  address independently of master-email changes. Missing/invalid/unapproved
  email is a configuration error.
- The approval/update operation requires server-side tenant-admin/module
  authorization and a same-tenant active fitter/group check. Persist the
  approval and audit atomically with old/new value, fitter ID, approval reason
  and version. Do not create login users or send invitations.
- Snapshot fitter ID, group UUID/external ID, email/source, approval version,
  approver and timestamp onto `identity_snapshot`; name is the fitter name on
  the result. The resolver holds shared locks on config/fitter/group/member
  until result/mail transaction completion, preventing concurrent reapproval
  or membership removal during enqueue. Dataset coverage remains separately
  fail-closed: there is still no verified dataset-revision producer.
- Idempotency is a bounded deterministic key such as
  `time_control:v2:<sha256(canonical tenant/control/date/fitter/mail-type)>`.
  Login ID, initials, display name and email are not key components. Address
  reapproval does not create a second reminder for the same event; any deliberate
  resend requires a distinct authorized action/audit, not automatic key rotation.
- Result/outbox foreign keys may keep an optional same-tenant user relation,
  but its absence must not block technician mail or grant UI access.
  Employee outbox recipients use the approved email and a NULL user reference,
  so inactive or absent login does not redirect or block technician mail.

The local tenant-admin endpoint is
`PATCH /api/tenant/admin/time-control/employees/:configId/recipient`.
It requires tenant host/auth tenant agreement and `tenant_admin:update` access.
Body: exact `fitter_id` (string), `group_id` (UUID), `email`,
`email_source` (`fitter_master` or `admin_override`), nonblank `reason` and
integer `expected_version` (0 for the first approval). The existing config
provides the external group ID; the endpoint verifies an active fitter, active
EK-linked group and existing same-tenant member before approving the binding.
This approves use of existing membership; it does not establish EK currentness,
adopt a group, add members, create users or send mail.

Approval updates and audit are atomic, with optimistic version checks. The
fitter cannot be reassigned after first approval; a partial unique index also
prevents two configs for the same tenant/fitter. Existing configs remain
unapproved after 0051; no email or group backfill is performed.

Once an employee mail has a provider-outbox ID, a rerun reuses that log rather
than rewriting its queued/sent recipient. Address reapproval neither retracts
old queued mail nor authorizes a resend. Explicit review of any old queue is
required before eventual outbox apply. Old pre-v2 keys need reconciliation
before live use; current Render has not received this POC.

0051 also extends the database audit-event allowlist and the service allowlist.
Applying it may fail if duplicate tenant/fitter configs exist; inspect those
before approval. It takes schema/index/constraint-validation locks; it has
been exercised on isolated local PostgreSQL, not Render.

### Isolated PostgreSQL Demo Verification (2026-10-11)

verified: the disposable PostgreSQL 17 database
`fielddesk_tc_validation` on `127.0.0.1:55432` executed the actual 0053 SQL
twice with a local `hoyrup-clemmensen` fixture tenant present. Its ten rules
and five preserved legacy rules give 12 counted and 3 excluded references.
9300 and 9320 remain distinct. A separate tenant's existing conflicting rule
and complete rule set were unchanged. SQL rerun preserved rule IDs/counts.
Migration tracking reported 53 successful, zero failed; normal runner reruns
reported zero applied and 53 skipped.

verified: the real database service and CLI evaluated the trusted 301-row
March 27 snapshot for all six selected fitters, using approved local fixture
addresses and database rules rather than defaults. Daily and Friday each
produced five `ok` results and MBO with 6 counted hours, 6 excluded 9070
hours and 1 missing hour. Both use that Friday's norm 7, not a weekly norm.
Repeated controls preserved run/result/preview IDs. Daily had one employee
preview with DEP copy; Friday had employee and DEP/LKE summary previews.
The isolated database contained zero provider-outbox rows. The dedicated
cluster was stopped after verification; no production runtime was tested.

### Decisions And Next Approved Sequence

This is a proposed Render write/deploy plan, not execution permission.
The user has approved the supplied group-61 eight-member observation for this
demo and the six fixed email mappings. Neither approval authorizes Render
mutation. No recurring group import, EK read or fresh-hours sync is needed for
this historical snapshot demo.

1. Freeze the tested dirty-worktree content based on HEAD
   `d866c69e3391042ef6b118666dc8b9a7c392649d`. This HEAD alone does not
   include Timekontrol. Before an approved commit/push, record the complete
   changed-file manifest/hash; after commit, bind deploy approval to that
   exact new commit SHA. Do not deploy the old HEAD as the POC version.
   The documented Render target is `FielddeskAI`,
   `srv-d6h0h8fgi27c73a99jgg`, branch `main`, with auto-deploy documented
   enabled. Recheck current settings before publishing; a push to main can
   already initiate deployment.
2. Before deploy, inspect the actual web-service environment and any external
   cron/one-off dispatcher. Require `TIME_CONTROL_SCHEDULER_ENABLED=false`
   on the web service and no scheduled Timekontrol/outbox-apply command.
   The scheduler's default/unset/false gate returns before timer or DB access;
   app startup itself does not run migrations. Use `MAIL_PROVIDER=disabled`
   for the demo one-offs, not an unreviewed global provider change that could
   disrupt existing invitations. The existing general sync worker still starts
   in the production web process independently of Timekontrol; disabling this
   scheduler does not promise zero unrelated sync writes. Existing job backlog
   and runtime environment have not been reverified by these local tests.
3. Recheck Render migration history/checksums and tenant state read-only. The
   earlier observation ended at 0048; do not assume it remains current.
   After approval, apply only the pending migration set 0049 through 0053 in
   order with the normal migration runner. Stop on unexpected earlier pending
   migrations, checksum mismatch or duplicate fitter configs. Verify tables,
   constraints, dataset FKs, optional-login approval columns and exactly 15
   target-tenant rules (12 counted, 3 excluded). Verify other tenants unchanged.
   Inspect `mode=dry_run` and `live_enabled_at=NULL` rather than trusting
   seed defaults; 0049's existing-row conflict path does not reset settings.
4. In an audited, locked transaction adopt existing group UUID
   `bdcea2d1-14e2-4477-813b-8657de826905` for tenant
   `f1f51c07-2d88-4ee4-a766-78eac833a9d0` as external `(ekomplet,61)`.
   Reject another group bound to 61, tenant mismatch, unexpected binding or
   inactive/ambiguous fitter identities. Retain current member 18 and add
   15,17,208,290,295,498,576 if still missing. Preserve managers, unrelated
   memberships and UUID; no inferred removal, duplicate group or ownership
   transfer to a recurring importer. Audit the supplied one-time source,
   exact diff and approval. Reread one group 61 and the eight intended members.
5. Configure only six controls: MHJ/15, MUM/295, JSK/18, PEP/208, MBO/290,
   MPJ/498; use the explicit approved addresses above with `admin_override`.
   Login is optional. Recheck approver
   `8eaddbc0-8fc7-414a-9c5c-064617972394` as active same-tenant administrator.
   Use the existing approval service with expected approval version, exact
   fitter/group checks and atomic audit. Configure employee CC DEP, internal
   To DEP and Friday To DEP/CC LKE, mode dry_run and Friday norm 7.
   Idempotent rerun must skip already-identical approvals, not increase versions
   merely because the maintenance step was repeated.
6. Transfer the exact trusted historical evidence to a private one-off-readable
   path and verify file SHA-256
   `c64c07241480690a017350fc0554ad0b7d0953a0ecefdedbdb26d9bd5cfe2f24`
   against the local artifact. This file checksum is distinct from the
   canonical row hash and dataset revision below. Preview and store it:
   `node backend/scripts/store_time_control_dataset.js --tenant hoyrup-clemmensen --date 2026-03-27 --file <evidence-path>`
   then repeat with
   `--apply --confirm GEM:timekontrol-dataset:hoyrup-clemmensen:2026-03-27`.
   Do not invent an observation timestamp or use upload time as source freshness.
   Expect 301 rows, row hash
   `b9af628da811136f7ebfac202c01219cf07328199bc1737ee7a7ba630a061138`
   and revision
   `a55ea02224788504dd39000733e08bc228b77a86ea4abbb361dce473307f0f12`.
   Capture the returned dataset UUID and verify current head/proof/tenant/day.
   This stores a historical snapshot, not legacy `fitter_hour` completeness.
7. From repository root, run the exact CLI commands below in one-offs with
   `MAIL_PROVIDER=disabled` and `TIME_CONTROL_SCHEDULER_ENABLED=false`:

   ```text
   node backend/scripts/run_time_control.js --tenant hoyrup-clemmensen --date 2026-03-27 --control-type daily_09 --dry-run --hours-dataset-id <dataset-uuid> --historical-snapshot
   node backend/scripts/run_time_control.js --tenant hoyrup-clemmensen --date 2026-03-27 --control-type friday_12 --dry-run --hours-dataset-id <dataset-uuid> --historical-snapshot
   ```

   Resolve actual working directory explicitly: if it is backend, use
   `node scripts/...` instead. Do not use the generic maintenance wrapper,
   which does not forward stored-dataset/historical flags, or the HTTP test-run
   endpoint, which does not select this snapshot or force dry-run.
   This stored-dataset path never requests on-demand sync.
8. Both controls evaluate March 27 with its Friday norm 7: five `ok`,
   MBO 6 valid hours + 6 excluded 9070 hours, `missing_hours=1`. Daily
   preview: one employee/DEP-copy log. Friday preview: employee/DEP-copy plus
   DEP/LKE summary. Rerun both and verify two run IDs, 12 result IDs, three
   preview IDs unchanged and no new provider-outbox or sync-job rows.
   Existing unrelated outbox rows need not be zero on Render; verify no
   Timekontrol rows and no outbox delta rather than silently deleting a queue.
9. On any failed gate stop before the next write. Migration runner rolls back
   the failing migration but earlier migrations remain applied. Group/config
   transactions roll back their own writes. Invalid dataset evidence can
   persist an invalidation/audit before throwing; inspect current head before
   retry. A failed control after preparation can leave an unfinished run;
   inspect the key, dataset and connection/lock state, then retry the same key
   only after diagnosis. Do not disable coverage/identity guards, auto-delete
   records, switch live, execute outbox apply, sync/import EK or send real mail.

## Render Migration Failure and Controlled Retry

observed: deploy `dep-db5t4ec9v7es739f55jg` for commit
`c261a8bf678f93bedfc96eac0bbfe74279fd9cea` failed in pre-deploy on 0049:
`check constraint "ck_audit_event_event_type" of relation "audit_event" is violated by some row`.
The migration transaction rolled back. A subsequent read found 48 successful
migrations and one failed 0049 tracking row; 0050-0053 had not run. Existing
IGVA audit events were retained (3 manager completion, 151 summary refreshed,
1 summary refresh failed). No demo group, recipient, dataset or control writes
had been performed. The web service still served the previous version.

The failed 0049 checksum recorded by Render is
`0ec400ce00f91654a6eb94642acd0b04887c8b58a889e476936407717809b77f`.
Do not delete that row, change successful migration checksums, remove existing
audit events or relax the database allowlist to arbitrary event types.
The repair must retain every valid baseline event type, including IGVA and
`restarbejde.placement_restored`, through both 0049 and 0051.

Before a corrected migration is retried, test the real PostgreSQL upgrade from
0048 with existing valid audit events and the original failed checksum. Normal
checksum rejection must remain fail-closed; any authorized retry must identify
the exact failed migration and previous checksum and retain the failed-attempt
evidence. Restore the ordinary pre-deploy command after the successful retry.
Keep `TIME_CONTROL_SCHEDULER_ENABLED=false` before the new web process starts.
At the historical retry checkpoint, the weekly reminder remained
documentation/backlog only. A subsequent separately approved implementation is
local only; see the versioned weekly-control section below. This does not change
the historical migration/proof outcomes recorded here.

verified locally: PostgreSQL 17 upgraded from the actual first 48 migrations
with one existing audit row for each of the 101 baseline event types. The
original 0049 failed, the normal retry and incorrect explicit checksum were
rejected, and the corrected explicit retry applied five migrations. All 48
successful tracking rows and all baseline audit rows were unchanged.
The exact failed row was archived atomically into append-only
`schema_migration_retry_history`; failed retry and failed success-tracking
transactions left neither archive nor partial schema changes. Normal rerun
applied zero migrations and skipped 53; the archive remained unchanged.
The real 301-row six-person integration also passed with no provider-outbox
or sync-job rows.

The authorized one-time pre-deploy command, from Render's backend root, is:

```text
node scripts/db_migrate.js --retry-failed 0049_time_control_poc --expected-failed-checksum 0ec400ce00f91654a6eb94642acd0b04887c8b58a889e476936407717809b77f
```

Bind the deploy to the reviewed commit SHA. After migration success, verify
53 successful tracking rows, the retained original failed row in the archive,
unchanged earlier checksums and existing audit rows; then restore
`npm run db:migrate` as the service pre-deploy command. A second deploy with
the explicit retry command will intentionally fail because 0049 is no longer
failed. Do not leave this temporary command configured.

## Template Verification Without Sending Mail

### Friday Preview Routing and Existing Demo Logs

Friday manager previews and provider-backed logs must record the first
normalized manager as To and the remaining managers as CC, matching the
provider payload. Employee To/CC remains unchanged.

Rerunning the same tenant/control/date and historical dataset uses the
existing mail-log idempotency key and upsert, so it repairs an unsent
`dry_run` Friday preview in place (`would_send`, or `skipped` by the run's
preview reset before reevaluation). When routing differs,
the same evaluation transaction records `tenant_config_changed` with reason
`preview_recipient_routing_corrected`, the log/run/dataset IDs, key,
previous update timestamp and old/new To/CC before updating the preview.
If audit fails, the evaluation transaction rolls back. Repeating the corrected
run does not create another correction audit. No deletion or new preview key
is needed. Provider-linked or sent Friday logs are returned unchanged and do
not trigger enqueue or recipient rewriting.

Verify the existing Render demo rather than merely checking new previews:
the two run IDs, twelve result IDs and three preview IDs must remain unchanged,
with employee To MBO/CC DEP and manager To DEP/CC LKE, and no new outbox or
sync-job IDs. This correction does not implement the weekly reminder.

Render the pure helper with dummy data:

- subject is `Opret din Fielddesk-adgang`
- HTML contains tenant-origin logo URL
- logo URL has no token or query token
- `alt="Fielddesk"` exists
- CTA exists
- text/plain fallback exists
- Danish text renders correctly

Redact any invite URL before pasting output. Use `token=<redacted>`.

## Controlled Real Mail Test

Only run after explicit approval and with one controlled test user/email.

Verify:

- exactly one invitation is sent
- API response does not include raw token, token hash, or accept URL
- provider status is queued/sent/delivered as available
- mailbox receives the mail
- accept link opens the correct tenant host
- token cannot be reused after setup

## Partial Failure

If provider send fails, the invitation flow should preserve the created user and show a clear partial-failure message. Store failures without logging or returning raw token values.
