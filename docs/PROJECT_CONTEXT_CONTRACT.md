# FD Project Context Contract

Status: Draft / Proposed  
Scope: Shared platform contract for project context across FD modules  
Last updated: 2026-05-23

This document defines how current and future FD modules understand, consume, and extend project context.

It is governance-light and implementation-light. It does not define React code, Node handlers, database migrations, or API implementation details.

## 1. Purpose

The project context contract exists to prevent each FD module from inventing its own project model.

It should guide modules such as:

- Restarbejde
- QA
- CO2/ESG
- Economy/finance
- Documents
- Planning
- future FD modules

The contract defines shared project context, ownership boundaries, security direction, and integration principles.

## 2. Core Principle

FD Core owns project context.

Modules consume project context.

Integrations enrich project context.

Frontend renders and may cache project context temporarily, but does not own project truth.

Rules:

- Modules must not own project masterdata.
- Modules must not redefine project identity.
- Integrations may enrich context but must not own FD project identity.
- Frontend must not become the source of truth for project context, permissions, tenant scope, or module entitlements.

## 3. Minimum Shared Context

A normalized FD project context should include, at minimum:

- `tenant_id`
- `project_id`
- project reference
- project name/title
- project status
- project permissions for the current actor
- module entitlements for the current tenant/project
- `project_core`
- optional `project_wip`
- actor/project scope metadata where needed

The exact response shape is an implementation detail, but all modules should rely on the same normalized meaning.

## 4. `project_core` Vs `project_wip`

### `project_core`

`project_core` is the stable, canonical FD project identity.

It represents:

- project masterdata
- project structure
- base project identity
- project reference
- project name/title
- canonical project status
- tenant-owned project relationship

Modules should treat `project_core` as the baseline for identifying and scoping a project.

### `project_wip`

`project_wip` is optional enrichment and operational context.

It may represent:

- economy/financial context
- Work In Progress data
- activity/drift data
- ERP-derived operational fields
- mutable enrichment that can be incomplete or stale

Modules must not assume `project_wip` is always present, complete, fresh, or required for basic module operation unless a later module-specific decision says so.

Current direction from E-Komplet decisions:

- `project_core` = masterdata, structure, base identity.
- `project_wip` = economy, activity, operations, enrichment.

## 5. Ownership

FD Core owns:

- project identity
- tenant/project relationship
- project access model
- project permissions
- module entitlement context
- normalized project context contract

Integration layer owns:

- integration fetch/sync behavior
- imported/enriched context from ERP or external systems
- integration metadata and sync status

Modules own:

- module-specific domain data
- module-specific summaries and KPIs
- module-specific warnings or health indicators
- module-specific reports/exports where approved

Frontend owns:

- presentation state
- temporary UI state
- local cache where allowed
- selected project view state

Frontend does not own:

- project truth
- tenant scope
- permissions
- module entitlements
- integration truth

## 6. Module Interaction Rules

Modules must consume FD project context rather than create their own shadow project model.

Rules:

- Modules must not duplicate project masterdata as module-owned truth.
- Modules must not redefine project identity.
- Modules may store `project_id` references for module-owned records.
- Modules may cache project context temporarily for UX/performance.
- Modules must not treat cached context as authorization truth.
- Modules must not implicitly resolve tenant.
- Modules must not trust `project_id` alone.
- Modules should read normalized FD context rather than call ERP systems directly.
- Modules should tolerate missing optional enrichment where practical.

If a module needs project-specific extensions, they should be module-owned additions, not replacements for project identity.

## 7. Tenant And Security Direction

Project context is tenant-aware everywhere.

Security rules:

- Project access must always be verified by backend.
- `project_id` is not a security boundary.
- `tenant_id + project_id + actor context` must be considered together.
- Paths, slugs, URLs, and route params are not authorization.
- Frontend must not assemble security-sensitive context from multiple raw sources.
- Module APIs must use backend-verified tenant and project context.
- Module permissions and module entitlements must be evaluated with project context where relevant.

Frontend may hide or show UI, but backend and database rules enforce access.

## 8. Module Extensibility

Modules may extend project context with module-owned contributions without changing core project identity.

Examples:

- badges
- KPIs
- module summaries
- warnings
- project health indicators
- counts
- status rollups
- unresolved issue indicators
- report/export availability indicators

Rules:

- Module contributions must be clearly module-owned or derived.
- Module contributions must not mutate `project_core` identity.
- Module contributions must respect tenant/project/RBAC scope.
- Expensive module summaries should be lazy, cached, or separated if needed.
- Shared project context must not become an unbounded payload.

A future module context contribution registry may define how modules attach summaries or badges to project views.

## 9. API Direction

This document does not define implementation-specific endpoints.

Platform direction:

- FD should expose a shared normalized project context contract.
- Project context should be resolved by backend using authenticated tenant and actor context.
- Module APIs should receive or resolve verified project context through FD core patterns.
- Modules should read FD project context rather than direct ERP calls.
- Frontend should avoid assembling security-sensitive context from raw project, permission, entitlement, and integration endpoints.

Possible future shape:

- shared project context endpoint
- normalized project contract
- module entitlement summary
- project permission summary
- optional enrichment blocks such as `project_wip`
- optional module summary blocks

Exact endpoint names, caching behavior, and payload shape are deferred.

## 10. Integration Strategy

E-Komplet enriches FD project context, but does not own FD project context.

Current direction:

- FD owns normalized project identity.
- E-Komplet can provide imported project masterdata and WIP enrichment.
- Integration data must be distinguishable from FD-owned truth.
- FD should continue to function when an integration is temporarily unavailable.
- Modules should consume FD-normalized context instead of coupling directly to ERP payloads.

Future direction:

- FD must be able to support manual/internal projects later.
- Future integrations such as Solar or M365 may enrich context for specific workflows.
- Integration downtime should not invalidate FD-owned project identity.

## 11. Deferred Decisions

Not decided in this contract:

- final project context endpoint shape
- realtime updates
- websocket/live subscriptions
- caching strategy
- cache invalidation
- offline sync
- cross-tenant project visibility rules
- global search indexing
- project context versioning
- stale WIP indicators
- module context contribution registry
- whether module summaries are embedded, lazy-loaded, or queried separately
- exact manual/internal project creation model

Do not assume these are solved until a current governance or implementation document says so.

## 12. Risks

Known risks:

- project model drift between modules
- ERP coupling if modules depend directly on E-Komplet payloads
- duplicate shadow project models
- tenant leakage through `project_id`-only lookups
- stale WIP data shown as current truth
- modules treating optional enrichment as required project identity
- overfetching large project context payloads
- frontend assembling security-sensitive context from raw sources
- module summaries making shared context slow or unstable
- unclear ownership between FD-owned, imported, derived, and module-owned project data

## Relevant Docs

- `docs/00_MASTER.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY_MODEL.md`
- `docs/MODULE_CONTRACT.md`
- `docs/AI_GOVERNANCE.md`
- `docs/DECISIONS.md`
- `docs/modules/restarbejde/BACKEND_MODULE_CONTRACT.md`
