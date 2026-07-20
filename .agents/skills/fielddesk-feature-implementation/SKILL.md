---
name: fielddesk-feature-implementation
description: Implement scoped Fielddesk product or platform changes while preserving existing architecture, tenant security, Danish user-facing text, tests, and validation. Use for backend, API, frontend, module, docs-plus-code, or cross-file feature tasks.
---

# Fielddesk Feature Implementation

## Overview

Use this skill to deliver the smallest complete change that satisfies a scoped Fielddesk task without accidental redesign or unrelated refactoring.

## Workflow

1. Understand context:
   - read `AGENTS.md`, `docs/00_MASTER.md`, `docs/DOC_INDEX.md`, and `docs/development/TESTING.md`.
   - read `docs/SECURITY_MODEL.md` before auth, tenant, RBAC, RLS, audit, storage, sync, file, export, or module work.
   - read relevant module, route, service, repository, mapping, decision, and UI files.
2. Bound the work:
   - identify affected files, data models, routes, UI surfaces, tests, and docs.
   - name what will not be changed.
   - if the request is ambiguous in a security-relevant way, stop and ask.
3. Plan briefly:
   - outline the minimal implementation path.
   - include migration, tenant, test, and UI regression considerations when relevant.
4. Implement:
   - follow existing backend module/service/repository patterns.
   - keep frontend changes consistent with static tenant/admin UI conventions.
   - keep user-facing product text Danish unless the local surface differs.
   - avoid unrelated redesign, formatting churn, dependency changes, and broad cleanup.
5. Add or update tests:
   - include negative tenant/auth tests when access control changes.
   - include migration/static checks when schema or invariants change.
6. Review and repair:
   - inspect the diff.
   - run the targeted checks.
   - if checks fail, diagnose and repair within scope, then rerun.
7. Validate tenant safety:
   - verify tenant context is derived server-side.
   - verify tenant-owned queries and joins are scoped by `tenant_id`.
   - verify frontend behavior does not replace backend authorization.

## Validation

Use scope-appropriate checks:

- `npm test` for the Node test suite.
- `npm run check` for the full local/CI-safe gate.
- `npm run check:migrations` for migration changes.
- `npm run check:static` when protected invariants may be affected.
- Focused manual/browser verification when UI behavior changes and tooling is available.

## Stop Conditions

- Required tenant/security behavior cannot be proven.
- The task requires a schema, deploy, production migration, external service, or credential action that was not explicitly approved.
- Docs and requested behavior conflict on a security or architecture rule.
- A complete implementation would require expanding scope beyond the request.

## Final Response

Summarize changed files, behavior, tenant/security reasoning, tests/checks with results, limitations, and residual risks. Do not claim unrun validation.
