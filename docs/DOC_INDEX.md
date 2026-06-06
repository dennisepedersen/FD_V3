# FD V3 Doc Index

Status: current documentation index  
Scope: points to docs; does not replace them

## Current Source Of Truth

| Doc | Use For | Status |
| --- | --- | --- |
| `docs/00_MASTER.md` | First entrypoint and read order | Current |
| `docs/PROJECT_RULES.md` | Fielddesk constitution and highest-level project rules | Current |
| `docs/V3_FOUNDATION_DESIGN.md` | Tenant, auth, RBAC, project, scope, audit, sync foundation | Current source of truth |
| `docs/AI_GOVERNANCE.md` | Canonical AI/Codex governance and working rules | Current |
| `docs/AI_BOOTSTRAP_CONTEXT.md` | Bootstrap/historical transition context and known foundation risks | Context, not permanent canonical AI governance |
| `docs/CODEX_WORKFLOW.md` | IDE -> Analyse -> Spec -> Build -> Preview -> Review -> Release workflow | Current |
| `docs/IMPLEMENTATION_GATES.md` | Required approval gates between workflow stages | Current |
| `docs/LABS_ANALYSIS_SCHEMA.md` | Required Fielddesk Labs analysis output schema | Current |
| `docs/labs/LABS_V0_1_SPEC.md` | Fielddesk Labs v0.1 SPEC for IDE -> ANALYSE only | Gate 2 approved SPEC |
| `docs/labs/LABS_V0_1_IMPLEMENTATION.md` | Fielddesk Labs v0.1 Gate 3 implementation reference | Gate 3 implementation reference |
| `docs/MODULE_MAP.md` | High-level module ownership, dependencies, data ownership, and relationships | Current |
| `docs/UI_UX_PRINCIPLES.md` | Shared UI/UX principles for current and future surfaces | Current |
| `docs/DATA_POLICY.md` | Shared data ownership, source, derived data, audit, credential, file, and AI data policy | Current baseline |
| `docs/PROJECT_CONTEXT_CONTRACT.md` | Shared project context contract for modules | Draft/Proposed contract |
| `docs/REPORT_ENGINE_CONTRACT.md` | Shared report/export contract for modules | Draft/Proposed contract |
| `docs/MODULE_REGISTRY_CONTRACT.md` | Shared module registry, enablement and discovery contract | Draft/Proposed contract |
| `docs/STORAGE_CONTRACT.md` | Shared storage/file governance contract | Draft/Proposed contract |
| `docs/AUDIT_CONTRACT.md` | Shared audit/event governance contract | Draft/Proposed contract |
| `docs/V3_BUILD_GATECHECK.md` | Build gate rules before implementation | Current |
| `docs/SECRET_HANDLING_RULES.md` | Secret handling and commit checks | Current |
| `backend/docs/standards/fd_implementation_rules.md` | Backend evidence, mapping, tenant filtering, no-guessing rules | Current |
| `backend/docs/decisions/*.md` | Verified backend decisions | Current |
| `backend/docs/integrations/ek/*.md` | E-Komplet endpoint contracts | Current |
| `backend/docs/mappings/*.md` | Mapping and scope notes | Current, some gaps documented |
| `backend/docs/audits/*.md` | Current audits and known mismatches | Current but time-sensitive |

## Module Docs

| Doc | Use For | Status |
| --- | --- | --- |
| `docs/MODULE_CONTRACT.md` | Minimum requirements and runtime rules for FD modules | Current |
| `docs/MODULE_MAP.md` | Cross-module map and dependency/data ownership overview | Current |
| `docs/modules/qa/QA_STATUS_MODEL.md` | Manual QA status model v1 and future v2 responsibility direction | Current decision |
| `docs/modules/restarbejde/MODULE_DEFINITION.md` | Restarbejde scope, workflows, data model, risks | Draft/proposal, not implementation spec |
| `docs/modules/restarbejde/BACKEND_MODULE_CONTRACT.md` | Restarbejde backend/module contract for future FD integration | Draft/Proposed module contract |

## AI, Labs, And Workflow Docs

| Doc | Use For | Status |
| --- | --- | --- |
| `docs/AI_GOVERNANCE.md` | AI/Codex authority, conflict handling, and Labs boundaries | Current |
| `docs/CODEX_WORKFLOW.md` | Human/Codex workflow stages from idea to release | Current |
| `docs/IMPLEMENTATION_GATES.md` | Required approvals and stop criteria between workflow stages | Current |
| `docs/LABS_ANALYSIS_SCHEMA.md` | Labs output contract for future analyses | Current |
| `docs/labs/LABS_V0_1_SPEC.md` | Labs v0.1 scope, access, persistence, UI flow, status, audit, and AI limitations | Gate 2 approved SPEC |
| `docs/labs/LABS_V0_1_IMPLEMENTATION.md` | Labs v0.1 implemented runtime surface, tables, endpoints, access, audit, and limitations | Gate 3 implementation reference |
| `docs/IDE_BANK.md` | Idea intake bank; not build permission | Current |

## Labs Docs

| Doc | Use For | Status |
| --- | --- | --- |
| `docs/LABS_ANALYSIS_SCHEMA.md` | Required analysis output shape for Labs | Current |
| `docs/labs/LABS_V0_1_SPEC.md` | v0.1 product/technical SPEC for global-admin-only IDE -> ANALYSE workflow | Gate 2 approved SPEC |
| `docs/labs/LABS_V0_1_IMPLEMENTATION.md` | v0.1 implementation reference for global-admin-only Labs runtime | Gate 3 implementation reference |

## Product And UI Docs

| Doc | Use For | Status |
| --- | --- | --- |
| `docs/UI_UX_PRINCIPLES.md` | Shared UI/UX principles, dashboard/form/navigation rules | Current |
| `docs/PROJECT_RULES.md` | Top-level product and governance principles | Current |

## Backend Decision Docs

| Doc | Use For | Status |
| --- | --- | --- |
| `backend/docs/decisions/projects_endpoint_decision.md` | projects_v4 as authoritative project source, projects_v3 as enrichment | Verified decision |
| `backend/docs/decisions/sync_strategy_decision.md` | Sync modes, backlog retry, pagination rules | Verified decision |
| `backend/docs/decisions/data_retention_and_filtering_decision.md` | Project and fitterhour retention/filtering | Verified + observed |
| `backend/docs/decisions/database_indexing_decision.md` | Index decisions based on real query predicates | Verified decision |

## Integration Docs

| Doc | Use For | Status |
| --- | --- | --- |
| `backend/docs/integrations/ek/project_status_model.md` | Canonical EK project lifecycle/WIP status truth | Verified |
| `backend/docs/integrations/ek/projects_v4_masterdata.md` | E-Komplet v4 project masterdata contract | Verified |
| `backend/docs/integrations/ek/projects_v3_wip.md` | E-Komplet v3 WIP enrichment contract | Verified |
| `backend/docs/integrations/ek/fitterhours.md` | Fitterhours integration contract | Current |
| `backend/docs/integrations/ek/fitterhours_retention_model.md` | Verified fitterhours retention/scope model and pending implementation plan | Verified decision / implementation pending |
| `backend/docs/integrations/ek/users.md` | E-Komplet users integration notes | Current |
| `backend/docs/integrations/solar/solar_product_data.md` | Solar product data notes | New/unclear until reviewed |

## Historical Or Context Docs

| Doc | Use For | Status |
| --- | --- | --- |
| `docs/RESET_DECISION.md` | Why V3 was created as clean workspace | Historical decision, still relevant |
| `audit (read only)/*.md` | V2 audit source material | Read-only reference, not current V3 truth |
| `ARCHITECTURE_BOOTSTRAP_ENRICHMENT.md` | Bootstrap/enrichment decision context | Active decision content, should later move/index under decisions |
| `V3_AUTH_AND_ONBOARDING_PLAN.md` | Auth/onboarding plan | Plan/reference |
| `V3_BACKEND_AUTH_IMPLEMENTATION_PLAN.md` | Auth implementation plan | Historical/implementation reference |
| `V3_BACKEND_AUTH_VERIFICATION.md` | Auth verification findings | Current audit/reference |
| `V3_DB_SCHEMA_PLAN.md` | Phase-1 schema blueprint | Plan/reference |
| `TENANT_DOMAIN_VERIFICATION.md` | Tenant-domain production diagnosis | Situational audit |
| `docs/V3_LOCAL_VERIFICATION_STATUS.md` | Local verification notes | Time-sensitive |
| `docs/V3_LOGIN_SURFACE_COMPLETE.md` | Login surface completion note | Time-sensitive |

## Notes For Codex

- Prefer current source-of-truth docs over historical docs.
- Read `docs/PROJECT_RULES.md`, `docs/CODEX_WORKFLOW.md`, and `docs/IMPLEMENTATION_GATES.md` before foundation-sensitive work.
- Use `docs/LABS_ANALYSIS_SCHEMA.md` for future Labs-style analyses.
- Do not treat `audit (read only)` as active implementation guidance.
- If a doc has `verified`, `observed`, `hypothesis`, or `unclear`, preserve that evidence level.
- If a current audit says the worktree is clean, re-check `git status`; audit status may be stale.
