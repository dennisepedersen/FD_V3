# FD V3 Doc Index

Status: current documentation index  
Scope: points to docs; does not replace them

## Current Source Of Truth

| Doc | Use For | Status |
| --- | --- | --- |
| `docs/00_MASTER.md` | First entrypoint and read order | Current |
| `docs/V3_FOUNDATION_DESIGN.md` | Tenant, auth, RBAC, project, scope, audit, sync foundation | Current source of truth |
| `docs/AI_BOOTSTRAP_CONTEXT.md` | Temporary Codex/AI governance and known foundation risks | Current bootstrap, later to be replaced |
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
| `docs/modules/restarbejde/MODULE_DEFINITION.md` | Restarbejde scope, workflows, data model, risks | Draft/proposal, not implementation spec |

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
| `backend/docs/integrations/ek/projects_v4_masterdata.md` | E-Komplet v4 project masterdata contract | Verified |
| `backend/docs/integrations/ek/projects_v3_wip.md` | E-Komplet v3 WIP enrichment contract | Verified |
| `backend/docs/integrations/ek/fitterhours.md` | Fitterhours integration contract | Current |
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
- Do not treat `audit (read only)` as active implementation guidance.
- If a doc has `verified`, `observed`, `hypothesis`, or `unclear`, preserve that evidence level.
- If a current audit says the worktree is clean, re-check `git status`; audit status may be stale.
