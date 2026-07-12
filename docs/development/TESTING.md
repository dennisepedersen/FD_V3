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
