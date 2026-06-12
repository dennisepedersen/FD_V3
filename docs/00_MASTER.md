# FD V3 Master

Status: current governance entrypoint  
Scope: navigation only, not a replacement for detailed docs

## What FD V3 Is

Fielddesk V3 is the clean foundation for Fielddesk as a modular, multi-tenant SaaS platform.

Current foundation:
- Node/Express backend.
- PostgreSQL schema and migrations.
- Static tenant/admin UI surfaces.
- Tenant onboarding and login.
- E-Komplet sync for project/fitter data.
- Early module work, currently QA and Restarbejde documentation.

## How To Read This Repo

Start with this file, then use `docs/DOC_INDEX.md`.

Use active docs as source of truth. Treat old audits, reset notes, and read-only folders as context only unless an active doc points to them.

Do not infer architecture from code alone when a governance doc exists. If code and docs disagree, record the mismatch before changing anything.

## Canonical Docs

Current source-of-truth docs:
- `docs/V3_FOUNDATION_DESIGN.md` - foundation blueprint for tenant, auth, RBAC, project, scope, audit, and sync.
- `docs/AI_GOVERNANCE.md` - canonical AI/Codex governance and working rules.
- `docs/AI_BOOTSTRAP_CONTEXT.md` - bootstrap/historical transition context; not the permanent canonical AI governance source.
- `docs/V3_BUILD_GATECHECK.md` - build gate principles.
- `docs/SECRET_HANDLING_RULES.md` - secret handling and commit safety.
- `backend/docs/standards/fd_implementation_rules.md` - backend implementation and evidence rules.
- `docs/PROJECT_CONTEXT_CONTRACT.md` - shared project context contract for modules.
- `docs/REPORT_ENGINE_CONTRACT.md` - shared report/export contract for modules.
- `docs/MODULE_REGISTRY_CONTRACT.md` - shared module registry/enablement contract.
- `backend/docs/decisions/` - verified backend decisions.
- `backend/docs/integrations/ek/` - current E-Komplet integration contracts.
- `backend/docs/operations/` - current operational notes, including Render service facts.
- `backend/docs/mappings/` - current backend mapping notes.

Module docs:
- `docs/modules/restarbejde/MODULE_DEFINITION.md` - Restarbejde module definition draft.
- `docs/modules/restarbejde/BACKEND_MODULE_CONTRACT.md` - Restarbejde backend/module contract draft.

## Codex Read Order

Before foundation, security, tenant, module, backend, sync, or integration work, Codex should read:

1. `docs/00_MASTER.md`
2. `docs/DOC_INDEX.md`
3. `docs/V3_FOUNDATION_DESIGN.md`
4. `docs/AI_GOVERNANCE.md`
5. Relevant shared contracts: `docs/PROJECT_CONTEXT_CONTRACT.md`, `docs/REPORT_ENGINE_CONTRACT.md`, `docs/MODULE_REGISTRY_CONTRACT.md`
6. `docs/AI_BOOTSTRAP_CONTEXT.md` when bootstrap/historical context is needed
7. `backend/docs/standards/fd_implementation_rules.md`
8. Relevant `backend/docs/decisions/*`
9. Relevant module or integration docs

## Hard Rules

- No code changes from governance tasks unless explicitly requested.
- No schema, migration, auth, RBAC, RLS, tenant, or deploy changes without explicit scope.
- Backend is source of truth for tenant, scope, auth, RBAC, and audit.
- Frontend must never be source of truth for permissions.
- V2 and `audit (read only)` are references, not implementation sources.
