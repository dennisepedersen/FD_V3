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

`test/timeControlPostgres.integration.js` is opt-in and rejects non-loopback or
non-dedicated database targets. The ordinary test suite skips it; that skip is
not PostgreSQL verification. It never uses the production `DATABASE_URL`.
Create a disposable local PostgreSQL database, apply the repository migrations
there, then explicitly run:

```powershell
$env:FIELD_DESK_LOCAL_PG_TEST = "1"
$env:FIELDDESK_TIME_CONTROL_TEST_DATABASE_URL = "postgres://tc_validation@127.0.0.1:55432/fielddesk_tc_validation"
$env:FIELDDESK_TC_EVIDENCE_PATH = "<absolute-path-to-trusted-day-evidence>"
node --test test\timeControlPostgres.integration.js
```

This test writes fixture tenants, fitters, approvals, immutable datasets,
runs/results/previews and audits only to the isolated local database. Provider
enqueue is blocked, scheduler is not started, and no EK or Render call occurs.
The optional evidence file tests an actual captured day; omitting it uses
synthetic test evidence and must not be reported as external source verification.
Stop only the disposable server after testing; do not restart existing services.

The approved-rules demo case executes the actual 0053 SQL for a local fixture
tenant with slug `hoyrup-clemmensen`, checks a separate tenant is unchanged,
and repeats the migration SQL to check row identity/count preservation.
With the trusted March evidence, daily and Friday snapshot controls both use
March 27's seven-hour norm: five fulfilled results and fitter 290 with six
counted hours, six excluded allowance hours and one missing hour. Repeating
the controls must preserve run/result/preview identities and create no
provider-outbox or sync jobs. Fixture identity/mail approval is local only;
it does not demonstrate that Render has been configured.

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