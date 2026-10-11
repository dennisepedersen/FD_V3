# Mail Provider Verification Runbook

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

`--dry-run` disables provider enqueue, not database writes or on-demand sync.
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
The weekly reminder remains documentation/backlog only.

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