# FD V3 Decisions Index

Status: current decision index  
Scope: links to decisions; does not duplicate full decisions

## Foundation Decisions

| Decision | Source |
| --- | --- |
| V3 is a clean foundation, not an in-place V2 cleanup | `docs/RESET_DECISION.md` |
| V3 foundation blueprint governs tenant, auth, RBAC, project, scope, audit, and sync | `docs/V3_FOUNDATION_DESIGN.md` |
| `docs/PROJECT_RULES.md` is the current Fielddesk constitution for top-level project rules | `docs/PROJECT_RULES.md` |
| Fielddesk development follows IDE -> ANALYSE -> SPEC -> BUILD -> PREVIEW -> REVIEW -> RELEASE | `docs/CODEX_WORKFLOW.md` |
| No automation, AI agent, script, or release process may skip implementation gates | `docs/IMPLEMENTATION_GATES.md` |
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

## Module Decisions

| Decision | Source |
| --- | --- |
| Fielddesk should become modular with tenant-level module enablement | `docs/AI_BOOTSTRAP_CONTEXT.md` |
| Modules must document purpose, owner, dependencies, permissions, data ownership, and disable behavior | `docs/AI_BOOTSTRAP_CONTEXT.md` |
| `docs/MODULE_MAP.md` is the current high-level map for module purpose, owner, dependencies, data ownership, and relationships | `docs/MODULE_MAP.md` |
| Restarbejde is currently a draft standard-module definition, not an implementation spec | `docs/modules/restarbejde/MODULE_DEFINITION.md` |
| Restarbejde prototype must not be copied in as one frontend blob; backend, tenant, RBAC, audit, storage, and AppShell integration must be lifted to FD standards first | `docs/modules/restarbejde/MODULE_DEFINITION.md` |
| Shared project context contract is established as Draft/Proposed governance | `docs/PROJECT_CONTEXT_CONTRACT.md` |
| Shared report engine/export contract is established as Draft/Proposed governance | `docs/REPORT_ENGINE_CONTRACT.md` |
| Shared module registry contract is established as Draft/Proposed governance | `docs/MODULE_REGISTRY_CONTRACT.md` |
| Restarbejde backend module contract is established as a draft module reference | `docs/modules/restarbejde/BACKEND_MODULE_CONTRACT.md` |

## Security And Governance Decisions

| Decision | Source |
| --- | --- |
| Secrets must never be hardcoded or logged | `docs/SECRET_HANDLING_RULES.md` |
| Data must be classified as Fielddesk-owned, module-owned, imported, derived, audit, credential/config, file/binary artifact, or demo/sandbox | `docs/DATA_POLICY.md` |
| Imported data must not silently become Fielddesk-owned truth | `docs/DATA_POLICY.md`, `docs/PROJECT_RULES.md`, `docs/AI_BOOTSTRAP_CONTEXT.md` |
| Generated reports, exports, KPIs, CO2 calculations, and Labs analyses are derived output until explicitly approved or verified | `docs/DATA_POLICY.md`, `docs/REPORT_ENGINE_CONTRACT.md`, `docs/LABS_ANALYSIS_SCHEMA.md` |
| Docs and code must be updated together when behavior changes | `docs/AI_BOOTSTRAP_CONTEXT.md`, `backend/docs/standards/fd_implementation_rules.md` |
| Evidence labels are required where relevant: verified, observed, hypothesis, unclear | `docs/AI_BOOTSTRAP_CONTEXT.md`, `backend/docs/standards/fd_implementation_rules.md` |
| Codex may not commit, push, deploy, change migrations, auth, RBAC, RLS, schema, or production config without explicit instruction | `docs/AI_BOOTSTRAP_CONTEXT.md` |
| AI and Labs may recommend but must not decide, approve gates, release, or mutate tenant data without human-approved scope | `docs/AI_GOVERNANCE.md`, `docs/LABS_ANALYSIS_SCHEMA.md`, `docs/IMPLEMENTATION_GATES.md` |
| Fielddesk Labs analyses must use the fixed output schema before being used as gate evidence | `docs/LABS_ANALYSIS_SCHEMA.md` |
| Fielddesk Labs v0.1 scope is IDE -> ANALYSE only and stops at `approved_for_spec`; it must not generate SPEC, build tasks, code-agent calls, deploys, or previews | `docs/labs/LABS_V0_1_SPEC.md` |
| Fielddesk Labs v0.1 is global-admin-only internal platform tooling and is not tenant, customer, technician, or project-leader functionality | `docs/labs/LABS_V0_1_SPEC.md`, `docs/SECURITY_MODEL.md` |
| Fielddesk Labs v0.1 is Platform Tooling, not a Tenant Module, Registry Enabled Module, or Customer Feature | `docs/labs/LABS_V0_1_SPEC.md`, `docs/MODULE_MAP.md` |
| Fielddesk Labs v0.1 attachments are saved, shown, and audited, but attachment contents must not be used as AI context | `docs/labs/LABS_V0_1_SPEC.md` |
| Fielddesk Labs v0.1 allows only `pdf`, `png`, `jpg`, `jpeg`, `txt`, and `md` attachments, default max 10 MB per file and max 5 files per idea | `docs/labs/LABS_V0_1_SPEC.md` |
| Rejected Labs ideas may be reopened only by `global_admin`, and reopen actions must be audited | `docs/labs/LABS_V0_1_SPEC.md` |
| `approved_for_spec` requires all critical open questions to be resolved; non-critical open questions may remain when documented and accepted | `docs/labs/LABS_V0_1_SPEC.md` |
| Fielddesk Labs v0.1 Gate 2 is approved as a SPEC and may proceed to implementation prompt without changing v0.1 scope | `docs/labs/LABS_V0_1_SPEC.md` |
| Fielddesk Labs v0.1 Gate 3 is implemented as Platform Tooling on the global admin portal/API surface and stops at `approved_for_spec` | `docs/labs/LABS_V0_1_IMPLEMENTATION.md` |
| Fielddesk Labs v0.1 uses immutable analysis runs, append-only idea history, and the shared audit system | `docs/labs/LABS_V0_1_IMPLEMENTATION.md` |
| Fielddesk Labs v0.1 defaults to a deterministic local server-side analyzer; external AI provider integration is deferred | `docs/labs/LABS_V0_1_IMPLEMENTATION.md` |
| UI/UX work should follow the shared mobile-first, drawer-first, progressive-disclosure, dashboard, form, and module navigation principles | `docs/UI_UX_PRINCIPLES.md` |

## Known Open Decisions

These are not decided yet and must not be assumed:

- Final RBAC matrix.
- Full RLS policy design.
- Final module registry and module enablement implementation.
- Which modules are core versus optional.
- Which modules must work without E-Komplet.
- Fielddesk-native project creation/editing model.
- Final retention periods, GDPR/privacy deletion/anonymization, tenant export, and legal hold policy.
- Storage/file contract and implementation.
- Final AI telemetry/cost logging data model.
