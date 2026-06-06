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
- `docs/PROJECT_RULES.md` - Fielddesk constitution and top-level project rules.
- `docs/V3_FOUNDATION_DESIGN.md` - foundation blueprint for tenant, auth, RBAC, project, scope, audit, and sync.
- `docs/AI_GOVERNANCE.md` - canonical AI/Codex governance and working rules.
- `docs/AI_BOOTSTRAP_CONTEXT.md` - bootstrap/historical transition context; not the permanent canonical AI governance source.
- `docs/CODEX_WORKFLOW.md` - IDE -> Analyse -> Spec -> Build -> Preview -> Review -> Release workflow.
- `docs/IMPLEMENTATION_GATES.md` - required approval gates between workflow stages.
- `docs/LABS_ANALYSIS_SCHEMA.md` - required analysis output schema for future Fielddesk Labs.
- `docs/labs/LABS_V0_1_SPEC.md` - Gate 2 approved SPEC for Fielddesk Labs v0.1, limited to IDE -> ANALYSE.
- `docs/labs/LABS_V0_1_IMPLEMENTATION.md` - Gate 3 implementation reference for Fielddesk Labs v0.1.
- `docs/DATA_POLICY.md` - shared data ownership and source policy.
- `docs/MODULE_MAP.md` - high-level module ownership, dependencies, data ownership, and relationships.
- `docs/UI_UX_PRINCIPLES.md` - shared UI/UX principles.
- `docs/V3_BUILD_GATECHECK.md` - build gate principles.
- `docs/SECRET_HANDLING_RULES.md` - secret handling and commit safety.
- `backend/docs/standards/fd_implementation_rules.md` - backend implementation and evidence rules.
- `docs/PROJECT_CONTEXT_CONTRACT.md` - shared project context contract for modules.
- `docs/REPORT_ENGINE_CONTRACT.md` - shared report/export contract for modules.
- `docs/MODULE_REGISTRY_CONTRACT.md` - shared module registry/enablement contract.
- `backend/docs/decisions/` - verified backend decisions.
- `backend/docs/integrations/ek/` - current E-Komplet integration contracts.
- `backend/docs/mappings/` - current backend mapping notes.

Module docs:
- `docs/modules/restarbejde/MODULE_DEFINITION.md` - Restarbejde module definition draft.
- `docs/modules/restarbejde/BACKEND_MODULE_CONTRACT.md` - Restarbejde backend/module contract draft.

## Codex Read Order

Before foundation, security, tenant, module, backend, sync, or integration work, Codex should read:

1. `docs/00_MASTER.md`
2. `docs/DOC_INDEX.md`
3. `docs/PROJECT_RULES.md`
4. `docs/DECISIONS.md`
5. `docs/V3_FOUNDATION_DESIGN.md`
6. `docs/AI_GOVERNANCE.md`
7. `docs/CODEX_WORKFLOW.md` and `docs/IMPLEMENTATION_GATES.md`
8. Relevant shared contracts: `docs/DATA_POLICY.md`, `docs/PROJECT_CONTEXT_CONTRACT.md`, `docs/REPORT_ENGINE_CONTRACT.md`, `docs/MODULE_REGISTRY_CONTRACT.md`
9. `docs/labs/LABS_V0_1_SPEC.md` for Labs v0.1 scope and constraints
10. `docs/labs/LABS_V0_1_IMPLEMENTATION.md` for Labs v0.1 runtime implementation reference
11. `docs/AI_BOOTSTRAP_CONTEXT.md` when bootstrap/historical context is needed
12. `backend/docs/standards/fd_implementation_rules.md`
13. Relevant `backend/docs/decisions/*`
14. Relevant module or integration docs

## Hard Rules

- No code changes from governance tasks unless explicitly requested.
- No schema, migration, auth, RBAC, RLS, tenant, or deploy changes without explicit scope.
- Backend is source of truth for tenant, scope, auth, RBAC, and audit.
- Frontend must never be source of truth for permissions.
- V2 and `audit (read only)` are references, not implementation sources.
- AI and Labs may recommend, but not decide, approve, release, or bypass gates.
- Ideas are not build permission.
