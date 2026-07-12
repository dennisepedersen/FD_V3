# PR Verification Checklist

Status: current runbook
Scope: practical pre-merge checklist for Dennis and Codex.

## Before Review

- Confirm PR number, base branch, head branch, and head commit.
- Confirm PR is open and not draft unless intentionally marked draft.
- Confirm merge state is clean or mergeable.
- List changed files and compare with expected scope.
- Confirm whether migrations are included.
- Confirm no unrelated files, generated artifacts, local env files, or secret files are included.

## Local Gate

Run:

```bash
npm test
npm run check
```

If investigating a targeted failure, run the individual command:

```bash
npm run check:syntax
npm run check:whitespace
npm run check:encoding
npm run check:secrets
npm run check:migrations
npm run check:static
```

## Security And Data Review

Check:

- tenant isolation impact
- auth/RBAC impact
- token handling and response leaks
- mail behavior and secret handling
- whether data-changing tests are needed
- whether rollback is straightforward

## Render And Runtime

Use `docs/runbooks/RENDER_VERIFICATION.md` for one-off PR-head smoke and live passive sanity.

Separate the verification type:

- static verification: source-only checks, no runtime
- runtime route smoke: PR-head code in a one-off job, no data changes
- live passive sanity: deployed main routes and headers, no data changes
- manual browser QA: human visual and workflow check
- data-changing E2E: explicit approval only

## Merge Readiness

A PR can be merge-ready when:

- head commit is verified
- expected scope is still true
- `npm test` and `npm run check` pass
- migration precheck is done if migrations exist
- runtime smoke is done when routes/UI/runtime behavior changed
- manual QA requirements are either complete or explicitly deferred
- no blockers remain