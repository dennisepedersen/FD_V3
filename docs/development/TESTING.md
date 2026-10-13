# Testing And Checks

Status: current developer foundation
Scope: local and CI-safe commands that do not require DB access, mail sends, sync, migrations, or tenant data changes.

## Package Layout

The repository has a root `package.json` for orchestration only. Backend runtime dependencies remain in `backend/package.json`.

Root commands:

- `npm test` - runs Node's built-in test runner.
- `npm run check` - runs the full local/CI gate.
- `npm run check:syntax` - runs `node --check` on tracked JS files outside dependencies and vendor bundles.
- `npm run check:whitespace` - checks whitespace locally and across pull request diffs in CI.
- `npm run check:encoding` - scans tracked text files for common mojibake markers.
- `npm run check:secrets` - scans tracked text files with the shared Node secret rules.
- `npm run check:migrations` - validates migration filenames, duplicate numbers, readability, and LF endings without applying anything.
- `npm run check:static` - runs cheap source assertions for critical invariants.

## What The Checks Do Not Do

They do not:

- connect to Postgres
- run migrations
- send mail
- start a public server
- create users or invitations
- queue sync
- deploy or call Render

`backend/src/app.js` imports `startSyncWorker()`. The worker itself exits early when `NODE_ENV=test`; route/runtime smoke jobs should use `NODE_ENV=test` or monkeypatch worker startup when importing app code.

## Windows Notes

Use the root commands from PowerShell or Git Bash. The PowerShell pre-commit secret hook now delegates to `node scripts/check-secrets.js`, so the rules are shared with Linux/CI.

If `node --check` fails under a restricted Windows sandbox with `EPERM` on the user directory, rerun the same command outside that sandbox. The command itself is read-only.

## Linux And CI Notes

GitHub Actions installs root and backend lockfiles, then runs `npm run check`. No Render or database secrets are used.

`check:whitespace` runs in local working-tree mode by default, using `git diff --check` and `git diff --cached --check` for tracked unstaged and staged changes; untracked files are checked after they are staged. In GitHub Actions pull requests, the workflow passes `CHECK_BASE_SHA` and `CHECK_HEAD_SHA`; the script then runs `git diff --check <base>...<head>` so committed whitespace changes in a clean checkout fail the build. If those refs are unavailable, the script falls back to clean working-tree checks and prints that mode explicitly. Newline-at-EOF is covered when Git reports it through `git diff --check` for the diffed files.

## Calendar / Absence Focused Tests

For absence request backend slices, the focused Node tests are:

- `node --test test/absenceRequestFoundation.test.js`
- `node --test test/absenceRequestEmployeeBackend.test.js`
- `node --test test/notificationOutboxFoundation.test.js`

These cover PR2 schema/static contracts, PR3 employee-own request flows, PR4 notification/outbox foundation, and PR5 manager pending/detail/approve/reject behavior. They are unit/static tests and do not connect to production, run migrations, call Render, or send mail.
## Isolated Timekontrol PostgreSQL Verification

Incident monitoring additions (13 October 2026):

- Approved daily admission regression uses 09:00 <= actual start < 09:02
  Copenhagen, one canonical 09:00 slot and an unchanged 09:15 deadline.
  Operation/automation unit tests cover boundaries/DST/shared key;
  monitor PostgreSQL tests prove cross-minute claim/restart, unbackdated
  start timestamps, genuine 09:01 receipts and concurrent mocked dispatch.
  Friday weekly admission remains only the 12:00 minute.
- `node --test test/timeControlMonitor.test.js test/timeControlTrace.test.js test/timeControlProviderIncident.test.js test/timeControlObservabilityUi.test.js`
  covers expected slots/deadlines, absent/unfinished runs, status independent of
  calculation, actual mocked Resend request tags, safe rejection/uncertainty,
  incremental trace persistence and the read-only tenant-admin UI/RBAC.
- `test/timeControlMonitorPostgres.integration.js` uses the guarded local
  opt-in below and applies all 60 actual migrations to a fresh database.
  It verifies durable/immutable trace and message bindings, cross-tenant FKs,
  epoch/start/concurrent claim guards, missed/deadline/mail watchdogs and
  separate status recovery/expiry with mocked transport only. No EK, Render,
  production database or actual mail call is permitted by this test.
- Synthetic-clock operational/weekly fixtures align the mutable database head
  invalidation timestamp with their controlled application observation clock.
  This is fixture-only; production replacement/freshness guards are unchanged.

Daily capture/startup additions:

- `node --test test\timeControlCapture.test.js test\timeControlOperation.test.js`
  covers the bounded v4 adapter with mocked requests, API errors/retries/pagination
  and controlled Copenhagen timing/startup/RBAC. No real EK reads or mails.
- `node --test test/timeControlAutomation.test.js test/timeControlAutomaticMail.test.js`
  covers default-off automatic gates, exact-run outbox selection, verified
  sender/Reply-To, current-epoch checks and terminal uncertain delivery without
  changing other modules' retries. Provider calls are mocked.
- `test/timeControlAutomaticPostgres.integration.js` uses the same opt-in and
  guarded local database URL as the operational test. It applies the current
  actual migrations and verifies exact-ID claim/concurrency and one-attempt
  persistence. Its provider and domain validation fixtures are mocked; the
  operational PostgreSQL test separately exercises real domain guards and
  the automatic bridge with four daily and two Friday simulated deliveries.
  No real EK/provider network calls occur in these isolated tests.
- Full-terminal actual-source replay uses
  `FIELDDESK_TC_TERMINAL_EVIDENCE_PATH=<retained ek_terminal_zero_20261012.json>`.
  The capture test then replays both actual September 26 passes (30 distinct
  rows, terminal page of 10) through the adapter without making EK calls.
  Without this explicit artifact the actual-source replay is skipped, not
  verified; ordinary synthetic full-terminal/false-terminal tests still run.
- `test\timeControlOperationalPostgres.integration.js` is opt-in with
  `FIELD_DESK_LOCAL_PG_TEST=1` and `FIELDDESK_TIME_CONTROL_TEST_DATABASE_URL`.
  Like weekly/October/upgrade tests it creates a fresh guarded loopback DB and
  applies all current actual migration files. Source captures and clock are
  synthetic; operational/gate/revision/dispatch persistence is real PostgreSQL.
  Local queued fixture mails are never sent. Dry-run/backfill cannot qualify.
- The legacy daily PostgreSQL test needs a **prepared HC fixture database**, not
  merely an empty admin database: apply through 0048, insert the HC tenant, then
  apply pending migrations through 0056. This preserves testing of tenant-bound
  seeds including 0055. Do not target production or reuse a completed fixture.
- October regression additionally requires both retained paths:
  `FIELDDESK_TC_OCTOBER_EVIDENCE_PATH` (all 1,294 October rows) and
  `FIELDDESK_TC_EVIDENCE_PATH` (March closed-project regression dataset).
  `FIELDDESK_TC_OCTOBER_RESULT_PATH` must name a new artifact if old result history
  is to be preserved. Six 37-hour results, MUM's 30 excluded allowance hours,
  zero previews/outbox/sync jobs and repeat/concurrent counts are asserted.

The opt-in PostgreSQL suite is not part of normal CI proof; skipped tests
must never be reported as database verification. New untracked JS files also
need explicit `node --check`, because the existing syntax gate uses tracked files.

`test/timeControlPostgres.integration.js` and
`test/timeControlWeeklyPostgres.integration.js` are opt-in and reject non-loopback or
non-dedicated database targets. The ordinary test suite skips it; that skip is
not PostgreSQL verification. It never uses the production `DATABASE_URL`.
Create a disposable local PostgreSQL database, apply the repository migrations
there, then explicitly run:

```powershell
$env:FIELD_DESK_LOCAL_PG_TEST = "1"
$env:FIELDDESK_TIME_CONTROL_TEST_DATABASE_URL = "postgres://tc_validation@127.0.0.1:55432/fielddesk_tc_validation_upgrade_<24-lowercase-hex>"
$env:FIELDDESK_TC_EVIDENCE_PATH = "<absolute-path-to-trusted-day-evidence>"
node --test test\dbMigrate.test.js test\timeControlPostgres.integration.js test\timeControlWeeklyPostgres.integration.js
```

This test writes fixture tenants, fitters, approvals, immutable datasets,
runs/results/previews and audits only to the isolated local database. Provider
calls are disabled, scheduler is not started, and no EK or Render call occurs.
Use a NEW database for each verification invocation: previous tests modify
dataset heads and must not be reused as clean fixtures. Guarded targets require
IPv4 loopback, port 55432, user `tc_validation`, no password, and the exact
`fielddesk_tc_validation_upgrade_` plus 24 lowercase hexadecimal suffix.
Apply all actual migrations to it, creating the local `hoyrup-clemmensen`
fixture tenant after migration 0048 and before 0049–0055. The upgrade and weekly tests also create their own fresh guarded databases;
they do not write to a shared fixture.
The optional evidence file tests an actual captured day; omitting it uses
synthetic test evidence and must not be reported as external source verification.
Stop only the disposable server after testing; do not restart existing services.

`test/timeControlOctoberPostgres.integration.js` additionally requires
`FIELDDESK_TC_OCTOBER_EVIDENCE_PATH` pointing to the retained actual October
5–9 capture JSON and `FIELDDESK_TC_EVIDENCE_PATH` pointing to the original
March capture JSON. It creates its own new guarded database using the
existing guarded local URL only as an admin connection. Set
`FIELDDESK_TC_OCTOBER_RESULT_PATH` to a session artifact path to preserve
the derived results. Run `node --test test\timeControlOctoberPostgres.integration.js`.
The actual-data case verifies v2 nonempty days without closed-project
controls, v1 March coverage, six weekly results, repeated/concurrent ID
stability and zero outbox/sync rows. It applies HC-only allowance rules 0055
after 0054, checks that other tenants and existing rules are unchanged, and
repeats the SQL without changing rule IDs or timestamps. All six actual
October results must be `ok`; MUM must have 37 counted and 30 excluded hours.
Use a new result artifact path, preserving earlier blocked results and
their databases. It does not fetch EK or prove live
freshness. Without the opt-in/evidence it skips, not source verification.

The approved-rules demo case executes the actual 0053 SQL for a local fixture
tenant with slug `hoyrup-clemmensen`, checks a separate tenant is unchanged,
and repeats the migration SQL to check row identity/count preservation.
With the trusted March evidence, daily and Friday snapshot controls both use
March 27's seven-hour norm: five fulfilled results and fitter 290 with six
counted hours, six excluded allowance hours and one missing hour. Repeating
the controls must preserve run/result/preview identities and create no
provider-outbox or sync jobs. Fixture identity/mail approval is local only;
it does not demonstrate that Render has been configured.

Weekly tests use synthetic complete day/zero-day evidence, not actual EK
verification. They test 37-hour totals without a Friday minimum, five immutable
tenant/date/dataset bindings, stale/null/server-capture freshness,
invalidation/replacement, weekly idempotency/concurrent PostgreSQL locks,
recipient routing and unchanged provider-linked employee/summary logs.
The weekly integration first verifies no outbox delta for dry-run, then creates
two explicitly local linked outbox fixtures to prove expiry blocks provider
calls before delivery. A separate synthetic-Friday-clock scenario captures
five day datasets, enqueues the real live-path employee/leader outbox rows once,
replays them without duplication, and invalidates their dataset evidence before
dispatch without provider calls. These weekly fixture rows are dead-lettered, not sent. A blocked late
run can still create a local internal-diagnostic outbox row; it is not dispatched.
Weekly PostgreSQL regression also checks stable result IDs/mail-log references
through invalidation and recovery, previous evaluation audit evidence, and
dispatch rejection of cross-tenant, stale and invalidated queued snapshots.

## Failure Fixture Checks

Use temporary directories outside the repo, for example under `C:\tmp` or `/tmp`, when testing failure behavior:

- Syntax: create `bad.js` with invalid JS and run `node scripts/check-syntax.js --path <temp-dir>`.
- Encoding: create a text file containing a replacement character and run `node scripts/check-encoding.js --path <temp-dir>`.
- Secrets: create a file with a dummy Render-like key and run `node scripts/check-secrets.js --path <temp-dir>`.
- Migrations: create duplicate `0099_*.sql` files and run `node scripts/check-migrations.js --path <temp-migrations-dir>`.

Clean the temp files after the check. Do not add failure fixtures to production paths.

## Known Migration Baseline

The repository has a historical applied duplicate migration number `0002`:

- `0002_onboarding_v1.sql`
- `0002_username_login.sql`

The migration checker has an exact legacy allowlist for those two filenames only. Any new duplicate migration number fails.
## Focused Calendar / Absence Checks

For special vacation window backend changes, run:

```bash
node --test test/specialWindowAdmin.test.js
node --test test/absenceRequestEmployeeBackend.test.js
node --test test/notificationOutboxFoundation.test.js
```
