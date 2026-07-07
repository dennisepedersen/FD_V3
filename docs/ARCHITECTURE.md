# FD V3 Architecture

Status: current architecture overview  
Scope: canonical overview only; detailed decisions stay in linked docs

## 1. What Fielddesk V3 Is

Fielddesk V3 is the clean foundation for Fielddesk as a modular, multi-tenant SaaS platform.

Current:
- Node/Express backend.
- PostgreSQL schema and migrations.
- Static tenant/admin UI surfaces served by backend.
- Tenant onboarding, tenant login, portal/global admin basics.
- E-Komplet sync for project/fitter data.
- Early module structure with QA in backend code and Restarbejde as documented module draft.
- Draft/Proposed shared contracts for project context, report/export, and module registry.

Planned:
- Stronger module governance.
- Stronger RBAC/RLS enforcement.
- More formal frontend/app shell direction.

## 2. Core Platform Vs Modules

Current core platform:
- Tenant lifecycle.
- Tenant domain resolution.
- Auth and onboarding.
- Project foundation.
- Audit foundation.
- Sync foundation.
- Backend data access rules.

Current modules:
- QA exists as early backend module code.
- Restarbejde exists as module definition only.

Planned modules:
- Restarbejde.
- QA.
- CO2/ESG.
- Economy/finance.
- Planning, documents, reports, intelligence, and other tenant-enabled modules.

Rule: modules must not be mounted as routes only. They need documented purpose, owner, dependencies, permissions, data ownership, and disable behavior.

## 3. Frontend Direction

Current:
- No complete frontend build pipeline.
- Static HTML/CSS/JS tenant/admin surfaces are served by the backend.
- Frontend renders API results and must not decide permissions.

Planned:
- A shared Fielddesk app shell.
- Navigation driven by tenant features, entitlements, and backend permissions.
- Project-centered module surfaces where relevant.

Open:
- Final frontend framework/app-shell implementation.
- Final module navigation registry implementation.
- Token/session storage direction for tenant UI.

## 4. Backend Direction

Current:
- Node.js + Express backend.
- Backend is source of truth for auth, tenant, scope, RBAC, audit, and data contracts.
- E-Komplet sync worker persists imported/enriched data.
- Backend docs use evidence levels: verified, observed, hypothesis, unclear.

Planned:
- Centralized permission model instead of ad hoc role checks.
- Explicit module route contracts.
- Clearer API contracts before UI work.

Rule: DB schema is approved before API implementation; API is approved before UI implementation.

## 5. Database, Postgres, And RLS Direction

Current:
- PostgreSQL is the system database.
- Tenant-owned tables use `tenant_id`.
- Schema uses constraints, indexes, composite tenant foreign keys, and immutable-field triggers.
- RLS is not yet active as full database policy.

Planned:
- RLS as defense-in-depth.
- Tenant-aware indexes for all tenant-filtered hot paths.
- More formal data policy for owned/imported/derived/audit/file data.

Open:
- Full RLS policy design.
- Final RBAC matrix.
- Final module data ownership rules.

## 6. Tenant Isolation

Current:
- No implicit tenant.
- No default tenant.
- No fallback slug.
- No fallback user.
- Tenant resolution happens through tenant/domain records.
- Backend denies when tenant, domain, lifecycle, or token context does not match.
- Global admin is platform identity, not implicit tenant user.
- Tenant admin follows a hybrid model: tenant administration rights do not automatically grant tenant-wide access to project-owned data.

Planned:
- Database RLS to backstop application-level tenant filtering.
- Centralized RBAC/scope enforcement for all module APIs.
- Explicit capability-based tenant-wide project/resource access where needed, instead of hidden role bypasses.

Rule: frontend can hide UI, but backend and database enforce access.

## 7. Project Model

Current:
- `project_core` is the canonical project representation.
- `project_wip` is mutable work/enrichment data.
- API reads use `project_core` as baseline and `project_wip` as supplement.
- `project_assignment` defines project access for mine/team/tenant scopes.
- `docs/PROJECT_CONTEXT_CONTRACT.md` defines Draft/Proposed shared project context direction for modules.
- Verified current model: `tenant_admin` is not automatically granted access to every project-owned resource. Project-owned APIs still need explicit project scope or a later explicit capability.

E-Komplet current:
- v4 LIST is authoritative for project existence, lifecycle, and masterdata.
- v4 DETAIL is enrichment for economy, activity, and WIP detail.
- v3 is fallback/enrichment only and must not decide lifecycle.
- `IsClosed` is the active/closed lifecycle truth.
- `IsWorkInProgress` is financial WIP/IGVA, not active/open status.
- `EndDate` is planning/end date, not a closed filter.
- `isIntern` / `IsInternal` is verified as project internal/external source metadata and is persisted as nullable `project_core.is_internal` / `project_masterdata_v4.is_internal`.
- Fitterhours retention target: active external projects need all-time ProjectID-targeted sync; internal or closed projects use rolling 12 months.
- v3 failure must not fail a successful v4 bootstrap.

Known gap:
- `project_wip` is read by APIs, but production write-path/mapping is still documented as incomplete.

## 8. Module Strategy

Current:
- Module governance is started but not complete.
- `docs/MODULE_REGISTRY_CONTRACT.md` defines Draft/Proposed module registry and enablement direction.
- Restarbejde has `docs/modules/restarbejde/MODULE_DEFINITION.md` as draft module definition.
- QA has backend module code but still needs formal module documentation.
- QA status updates are currently allowed for `tenant_admin` and `project_leader`; `technician` can read/create QA threads and messages but status remains read-only in the UI and enforced by backend permission checks.
- Known QA scope limitation: `tenant_admin` project access still follows the existing project-scope checks and is not broadened in the QA status permission slice.
- QA status model v1 is manual: `NEW`, `WAITING`, `ANSWERED`, and `CLOSED` are workflow/overview statuses, not access control. `WAITING` does not identify who is being waited on and must not be used as "waiting on me" without future explicit waiting/owner fields.
- QA v2 data foundation adds `qa_thread_participants` for per-user participant/read-state and assignment metadata. This does not replace global `qa_threads.status`.
- QA participants are resolved from existing project access truths (`project_assignment`, project owner, responsible, team leader), not from fitterhour employees.

Planned:
- Tenant-level module enablement.
- Module contracts covering dependencies, permissions, data ownership, routes, audit events, file/storage needs, and disable behavior.

Open:
- Final module registry implementation.
- Which modules are core vs optional.
- Which modules must run without E-Komplet.
- Final capability names for tenant-wide module/project access, for example `project:read:tenant`, `qa:update:tenant`, and `document:read:tenant`.

## 9. File And Storage Strategy

Current:
- Fielddesk uses PostgreSQL for structured data and Azure Blob Storage for binary files.
- Storage metadata is tenant-scoped in Postgres through the shared `storage_object` foundation.
- Binary file access is backend-owned; frontend code must not hold Azure credentials or rely on public blob URLs.
- Prototype modules may use local/browser storage only outside production architecture.

Planned:
- Central file/storage service for drawings, photos, reports, and module files.
- Tenant/project scoped metadata in Postgres.
- Safe download/upload authorization through backend.

Open:
- File retention rules.
- Virus scanning, signed URL, versioning, and report snapshot policy.

## 10. Report And Export Strategy

Current:
- `docs/REPORT_ENGINE_CONTRACT.md` defines Draft/Proposed shared report/export direction.
- No implemented canonical report/export service exists yet.
- Reports/exports are recognized as audit-sensitive because they can contain tenant/project data.

Planned:
- Report/export actions must be permission-checked and audited.
- Generated reports should be reproducible or stored with metadata where required.
- Module reports should use module-owned data plus approved project context.

Open:
- Client-side vs server-side report rendering per module.
- Report archive/storage policy.
- Tenant branding strategy.
- Complete report/export implementation architecture.

## 11. Integration Strategy

Current E-Komplet:
- Primary active integration.
- Tenant-specific credentials.
- Imported data must be distinguishable from Fielddesk-owned data.
- v4 project masterdata and v3 enrichment have separate semantics.
- v4 project detail by EK ProjectID is verified as a project-scoped source for project-detail `fitterHours`.
- v4 project detail by project reference did not return `fitterHours` in the verified probe.
- v4 purchase invoice lines, purchase orders, financial posts, and worksheets have verified ProjectID-filtered read behavior, but are not yet mapped as scheduled sync sources.
- EK write-side endpoints are future options only and require separate write-back governance before use.

Integration discovery rules:
- Prefer narrow read-only project-scoped probes over broad/full scans when a project-scoped endpoint exists.
- Record verified EK API findings in docs after discovery.
- Separate verified facts, hypotheses/assumptions, future options, and do-not-use-yet findings.

Current Solar:
- Solar product data docs have started, but status is new/unclear until reviewed.

Planned:
- Solar later for product/material-related features.
- M365/SharePoint/Outlook later where module workflows need documents, mail, or calendar context.

Rule: integrations may enrich Fielddesk, but must not silently become Fielddesk-owned truth.

## 12. Deployment And Operations

Current:
- Render production service is verified as `FielddeskAI`.
- Render service id is verified as `srv-d6h0h8fgi27c73a99jgg`.
- Repo is `FD_V3`, branch is `main`.
- Auto deploy is enabled.
- Pull request previews are disabled.
- Health endpoint is `/health`.
- `RENDER_API_KEY` exists in the local/operator environment used for Render API access.
- Render service id is not necessarily set in the local environment yet.

Rule: no deploy, restart, environment, or production config changes without explicit approval.

Open:
- Formal deployment governance doc.
- Staging/preview strategy.
- Whether to configure `FIELD_DESK_RENDER_SERVICE_ID` explicitly for repeatable maintenance jobs.

## 13. Prototype To FD Migration Principle

Current:
- Prototypes may exist outside FD to prove workflow and UX.
- Prototype code is not automatically production code.

Migration rule:
- Move domain concepts first.
- Define module contract, data model, RBAC, audit, storage, and API boundaries before moving UI/code.
- Replace local/demo storage with backend-owned persistence.
- Integrate into FD app shell and project context only after backend contracts are clear.

Restarbejde example:
- Placement, PDF preview, report preview, crop concept, and photo flow can inform module design.
- LocalStorage, standalone app shell, frontend-owned scope, and dataUrl file storage are prototype-only.

## 14. Not Decided Yet

Open:
- Final governance document structure beyond phase 1.
- Full RBAC matrix.
- Full RLS policy design.
- Final module registry implementation and module enablement implementation.
- Fielddesk-native project creation/editing model.
- Permanent AI/Codex governance references replacing `docs/AI_BOOTSTRAP_CONTEXT.md` as bootstrap context everywhere.
- Complete data policy.
- Complete storage/file contract.
- Complete file/storage architecture.
- Complete report/export implementation architecture.
- Final frontend framework/app shell.

## 15. Relevant Docs

Start here:
- `docs/00_MASTER.md`
- `docs/DOC_INDEX.md`
- `docs/DECISIONS.md`
- `docs/PROJECT_CONTEXT_CONTRACT.md`
- `docs/REPORT_ENGINE_CONTRACT.md`
- `docs/MODULE_REGISTRY_CONTRACT.md`

Foundation:
- `docs/V3_FOUNDATION_DESIGN.md`
- `docs/AI_GOVERNANCE.md`
- `docs/AI_BOOTSTRAP_CONTEXT.md`
- `docs/V3_BUILD_GATECHECK.md`
- `docs/SECRET_HANDLING_RULES.md`

Backend standards and decisions:
- `backend/docs/standards/fd_implementation_rules.md`
- `backend/docs/decisions/projects_endpoint_decision.md`
- `backend/docs/decisions/sync_strategy_decision.md`
- `backend/docs/decisions/data_retention_and_filtering_decision.md`
- `backend/docs/decisions/database_indexing_decision.md`

Integrations and mappings:
- `backend/docs/integrations/ek/project_status_model.md`
- `backend/docs/integrations/ek/projects_v4_masterdata.md`
- `backend/docs/integrations/ek/projects_v3_wip.md`
- `backend/docs/integrations/ek/fitterhours.md`
- `backend/docs/integrations/ek/fitterhours_retention_model.md`
- `backend/docs/integrations/ek/project_materials_finance_v4.md`
- `backend/docs/mappings/project_core_mapping.md`
- `backend/docs/mappings/project_wip_mapping.md`
- `backend/docs/mappings/scope_rules.md`

Operations:
- `backend/docs/operations/render_service.md`
- `backend/docs/operations/maintenance_jobs.md`

Modules:
- `docs/modules/qa/QA_STATUS_MODEL.md`
- `docs/modules/restarbejde/MODULE_DEFINITION.md`
- `docs/modules/restarbejde/BACKEND_MODULE_CONTRACT.md`

Historical/reference:
- `docs/RESET_DECISION.md`
- `audit (read only)/*.md`
