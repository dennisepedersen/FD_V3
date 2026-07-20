---
name: fielddesk-review-validation
description: Coordinate post-implementation review, repair, and validation for larger Fielddesk changes before merge or handoff. Use after a feature, migration, API/module change, or cross-file implementation is complete and needs scope, tenant security, authorization, API contract, migration, regression, test coverage, and repository-check validation.
---

# Fielddesk Review Validation

## Overview

Use this skill after a larger implementation is complete. It does not define new features; it reviews, repairs within the already-approved scope, and validates the completed work.

## Relationship To Other Skills

- Use `fielddesk-pr-review` for deeper finding format and PR/diff review stance.
- Use `fielddesk-feature-implementation` only for repairs that stay inside the original approved scope.
- Use `fielddesk-release-validation` for final readiness, branch/status, PR/deploy, or release gate reporting.
- Use `fielddesk-database-migration` for migration-specific risk and validation.
- Use `fielddesk-tenant-security-review` for deeper tenant/security investigation.

## Workflow

1. Reconstruct original scope:
   - identify the original request, accepted plan, changed files, intended behavior, and explicit non-goals.
   - state what was changed and what was not changed.
2. Check scope control:
   - compare the diff against the original task.
   - flag unrelated refactors, UI changes, dependency changes, architecture changes, or behavior changes.
   - stop if repair would require new scope or architecture approval.
3. Review safety and contracts:
   - tenant isolation: tenant context is server-derived and tenant-owned queries are scoped.
   - authorization: role, module permission, project/resource scope, and lifecycle gates are enforced server-side.
   - API contracts: request shape, response shape, error behavior, status codes, and backward compatibility are preserved or documented.
   - migrations: existing deployed migrations are untouched; new migrations follow naming, tenant, constraint, index, and data-risk rules.
   - regression risk: identify likely affected modules, UI surfaces, background jobs, storage, sync, exports, and integrations.
   - test coverage: confirm positive, negative, tenant/auth, migration, and regression tests are present where relevant.
4. Run relevant checks:
   - use `npm run check` for the full local/CI-safe gate when scope is broad.
   - use `npm test` and focused `npm run check:*` commands when narrower validation is enough.
   - include manual/browser or external checks only when explicitly in scope and available.
5. Review, repair, validate loop:
   - if a finding is inside the approved scope, repair it using the relevant implementation workflow.
   - rerun the failed or relevant checks.
   - repeat until checks pass or the remaining issue requires new scope, architecture approval, credentials, production access, deploy, or migration execution.
6. Decide readiness:
   - say whether the change is ready for merge: Yes or No.
   - base readiness on scope match, unresolved findings, validation results, and known limitations.

## Stop Conditions

- Stop before adding new product behavior or expanding scope.
- Stop before architecture changes unless explicitly approved.
- Stop before production deploys, restarts, production migrations, external writes, or data repair actions.
- Stop if tenant isolation or authorization cannot be proven from code, docs, tests, or schema.
- Stop if unresolved failures cannot be repaired within the original approved task.

## Final Response Format

## Scope

- What changed.
- What did not change.
- Any scope drift found or confirmed absent.

## Validation

- Checks run.
- Result of each check.
- Failed checks, repairs, and reruns if any.

## Risk

- Known limitations.
- Possible regressions.
- Tenant/security residual risk.

## Deployment Readiness

- Ready to merge: Yes or No.
- Brief reason.
