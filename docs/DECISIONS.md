# FD V3 Decisions Index

Status: current decision index  
Scope: links to decisions; does not duplicate full decisions

## Foundation Decisions

| Decision | Source |
| --- | --- |
| V3 is a clean foundation, not an in-place V2 cleanup | `docs/RESET_DECISION.md` |
| V3 foundation blueprint governs tenant, auth, RBAC, project, scope, audit, and sync | `docs/V3_FOUNDATION_DESIGN.md` |
| Backend is source of truth for auth, tenant isolation, RBAC, scope, and entitlements | `docs/V3_FOUNDATION_DESIGN.md`, `docs/AI_BOOTSTRAP_CONTEXT.md` |
| No implicit tenant, no default tenant, no fallback user, no default allow | `docs/V3_FOUNDATION_DESIGN.md`, `docs/V3_BUILD_GATECHECK.md` |
| V2 is reference only, never foundation code | `docs/RESET_DECISION.md`, `docs/V3_BUILD_GATECHECK.md` |

## Backend Decisions

| Decision | Source |
| --- | --- |
| projects_v4 is authoritative for project existence and open/closed status | `backend/docs/decisions/projects_endpoint_decision.md` |
| EK project status model is v4-first: `IsClosed` is lifecycle, `IsWorkInProgress` is financial WIP | `backend/docs/integrations/ek/project_status_model.md` |
| projects_v3 is fallback/enrichment only, never lifecycle | `backend/docs/decisions/projects_endpoint_decision.md` |
| Sync uses split strategy: delta-supported, reconcile-scan, backlog-retry | `backend/docs/decisions/sync_strategy_decision.md` |
| Pagination is count-based; `nextPage` is secondary metadata | `backend/docs/decisions/sync_strategy_decision.md` |
| Project and fitterhour retention/filtering rules | `backend/docs/decisions/data_retention_and_filtering_decision.md` |
| EK fitterhours retention model: active external projects need all-time ProjectID-targeted sync; internal/closed projects use rolling 12 months | `backend/docs/integrations/ek/fitterhours_retention_model.md` |
| Indexes are based on verified query predicates, not speculation | `backend/docs/decisions/database_indexing_decision.md` |

## Integration Decisions

| Decision | Source |
| --- | --- |
| E-Komplet credentials are tenant-specific | `docs/V3_FOUNDATION_DESIGN.md`, `docs/AI_BOOTSTRAP_CONTEXT.md` |
| E-Komplet may enrich Fielddesk but must not silently define all Fielddesk truth | `docs/AI_BOOTSTRAP_CONTEXT.md` |
| projects_v4 masterdata contract is verified | `backend/docs/integrations/ek/projects_v4_masterdata.md` |
| EK project status matrix and control cases are verified | `backend/docs/integrations/ek/project_status_model.md` |
| projects_v3 WIP contract is verified as fallback/enrichment | `backend/docs/integrations/ek/projects_v3_wip.md` |
| Project-level `isIntern` is verified in EK v4 and persisted as nullable FD project metadata | `backend/docs/integrations/ek/fitterhours_retention_model.md`, `backend/docs/integrations/ek/projects_v4_masterdata.md` |
| Bootstrap/enrichment separation is implemented for project sync | `ARCHITECTURE_BOOTSTRAP_ENRICHMENT.md` |
| EK v4 project detail by EK ProjectID is the verified project-scoped source for project-detail `fitterHours`; project ref detail did not return `fitterHours` in the probe | `backend/docs/integrations/ek/projects_v4_masterdata.md`, `backend/docs/integrations/ek/fitterhours.md` |
| EK v4 fitterhours query/search endpoints are not verified as ProjectID-scoped filters and must not be used for project-scoped reads yet | `backend/docs/integrations/ek/fitterhours.md` |
| Manual fitterhours Batch 8+ is stopped as the main track; future model separates historical EK backfill, delta/incremental refresh, on-demand project refresh, and tenant onboarding history choices | `backend/docs/integrations/ek/fitterhours.md`, `backend/docs/integrations/ek/fitterhours_refresh_register.md` |
| EK v4 purchase invoice lines, purchase orders, financial posts, and worksheets have verified ProjectID-filtered read behavior, but are discovery findings until mapped/governed | `backend/docs/integrations/ek/project_materials_finance_v4.md` |

## Operations Decisions

| Decision | Source |
| --- | --- |
| Render production service identity is verified as `FielddeskAI` / `srv-d6h0h8fgi27c73a99jgg`, repo `FD_V3`, branch `main`, auto deploy enabled, PR previews disabled | `backend/docs/operations/render_service.md` |

## Module Decisions

| Decision | Source |
| --- | --- |
| Fielddesk should become modular with tenant-level module enablement | `docs/AI_BOOTSTRAP_CONTEXT.md` |
| Modules must document purpose, owner, dependencies, permissions, data ownership, and disable behavior | `docs/AI_BOOTSTRAP_CONTEXT.md` |
| Restarbejde is currently a draft standard-module definition, not an implementation spec | `docs/modules/restarbejde/MODULE_DEFINITION.md` |
| Restarbejde prototype must not be copied in as one frontend blob; backend, tenant, RBAC, audit, storage, and AppShell integration must be lifted to FD standards first | `docs/modules/restarbejde/MODULE_DEFINITION.md` |
| Shared project context contract is established as Draft/Proposed governance | `docs/PROJECT_CONTEXT_CONTRACT.md` |
| Shared report engine/export contract is established as Draft/Proposed governance | `docs/REPORT_ENGINE_CONTRACT.md` |
| Shared module registry contract is established as Draft/Proposed governance | `docs/MODULE_REGISTRY_CONTRACT.md` |
| Restarbejde backend module contract is established as a draft module reference | `docs/modules/restarbejde/BACKEND_MODULE_CONTRACT.md` |
| QA status updates are allowed for `tenant_admin` and `project_leader`; `technician` can read/create QA but status is read-only | `docs/ARCHITECTURE.md` |
| QA status model v1 is manual; `WAITING` does not identify who is being waited on and must not drive inbox/dashboard responsibility by itself | `docs/modules/qa/QA_STATUS_MODEL.md` |
| QA v2 per-user state is stored separately from global `qa_threads.status`; participants/read-state enable personal `new`, `seen`, `sent`, and `closed` metadata | `docs/modules/qa/QA_V2_DATA_FOUNDATION.md` |
| Tenant admin follows a hybrid access model: tenant administration rights do not automatically grant tenant-wide access to project-owned data | `docs/SECURITY_MODEL.md`, `docs/ARCHITECTURE.md` |

## Security And Governance Decisions

| Decision | Source |
| --- | --- |
| Secrets must never be hardcoded or logged | `docs/SECRET_HANDLING_RULES.md` |
| Docs and code must be updated together when behavior changes | `docs/AI_BOOTSTRAP_CONTEXT.md`, `backend/docs/standards/fd_implementation_rules.md` |
| Evidence labels are required where relevant: verified, observed, hypothesis, unclear | `docs/AI_BOOTSTRAP_CONTEXT.md`, `backend/docs/standards/fd_implementation_rules.md` |
| Codex may not commit, push, deploy, change migrations, auth, RBAC, RLS, schema, or production config without explicit instruction | `docs/AI_BOOTSTRAP_CONTEXT.md` |
| EK discovery must prefer narrow read-only project-scoped probes over broad/full scans when a project-scoped endpoint exists | `backend/docs/standards/fd_implementation_rules.md` |
| Verified EK API findings must be recorded in docs after discovery and separated as verified, assumption/hypothesis, future option, or do-not-use-yet | `backend/docs/standards/fd_implementation_rules.md` |

## Known Open Decisions

These are not decided yet and must not be assumed:

- Final RBAC matrix.
- Full RLS policy design.
- Final module registry and module enablement implementation.
- Final capability matrix for tenant-wide project/resource access.
- Which modules are core versus optional.
- Which modules must work without E-Komplet.
- Fielddesk-native project creation/editing model.
- Data policy for Fielddesk-owned, imported, derived, audit, credential, demo, and file data.
- Storage/file contract and implementation.
- Permanent AI/Codex governance doc replacing `docs/AI_BOOTSTRAP_CONTEXT.md` as bootstrap context in all references.
