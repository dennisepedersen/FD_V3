# AI_BOOTSTRAP_CONTEXT.md

Status: temporary bootstrap memory  
Owner: Fielddesk / Dennis  
Intended reader: future Codex/AI sessions, CTO/platform architecture review  
Created: 2026-05-20  

This file is not permanent architecture.
It is a temporary foundation context for Fielddesk until the proper governance documents are created.

If this file conflicts with later active governance documents, the later active governance documents win.

---

## 1. Purpose

Fielddesk must not continue as random feature work on top of a prototype.

This file exists to preserve the current foundation direction, AI rules, known risks, and project memory across sessions until the real governance structure is established.

Codex must use this file as bootstrap context before making architecture, security, tenant, RBAC, module, data, integration, migration, or deployment recommendations.

This file does not grant permission to implement code, commit, push, deploy, change migrations, or change production configuration.

---

## 2. Current Project Status

Fielddesk V3 is a Node/Express backend with PostgreSQL schema/migrations, static tenant/admin UI surfaces, onboarding, tenant login, portal/global admin, E-Komplet sync logic, project/fitterhour views, and an early QA module.

Current stack:
- Backend: Node.js, Express.
- Database: PostgreSQL via `pg`.
- Auth: JWT-based tenant auth, portal/global admin session cookie.
- UI: static HTML/CSS/JS served by backend.
- Integrations: E-Komplet first, Solar documentation started.
- Deployment context: Render has been used/verified in prior docs, but formal deploy governance is not complete.

Important current state:
- There is no complete frontend app/build pipeline.
- There is no formal test suite, lint gate, typecheck, or CI gate.
- RLS is not yet implemented as active database policy.
- RBAC exists only as a minimal role model and ad hoc route checks.
- Module governance does not yet exist.
- Project governance documents are fragmented across top-level docs, `docs/`, `backend/docs/`, and `audit (read only)/`.
- The worktree may already contain unrelated modified/untracked files; Codex must not revert or overwrite user changes without explicit instruction.

Key existing documents to read before foundation work:
- `docs/V3_FOUNDATION_DESIGN.md`
- `docs/RESET_DECISION.md`
- `docs/SECRET_HANDLING_RULES.md`
- `docs/V3_BUILD_GATECHECK.md`
- `backend/docs/standards/fd_implementation_rules.md`
- `backend/docs/decisions/*.md`
- `backend/docs/audits/*.md`
- `backend/docs/mappings/*.md`
- `backend/docs/integrations/ek/*.md`

---

## 3. Most Important Foundation Risks

The main risks are architectural and governance-related, not just implementation details.

Critical risks:
- No active RLS policies yet.
- Tenant isolation relies too much on every application query being correct.
- RBAC is too thin for future SaaS use.
- Module enablement per tenant is not implemented.
- Module dependencies are not documented or enforced.
- Fielddesk can onboard without E-Komplet, but core product value still depends heavily on E-Komplet-derived data.
- Fielddesk-owned, imported, and derived data are not yet governed by a formal data policy.
- `schema.sql` and migrations need consistency review before further database work.
- Some product/static UI code contains hardcoded placeholders or debug traces.
- Tenant auth currently uses localStorage token storage.
- No automated test/CI/deploy safety gate exists.
- Documentation is fragmented and partially stale.

Codex must treat these as foundation blockers before recommending aggressive feature expansion.

---

## 4. Governance Rules

Fielddesk must be developed as a modular multi-tenant SaaS platform.

Standing rules:
- Backend is source of truth for auth, tenant isolation, RBAC, scope, and entitlements.
- Frontend must never be source of truth for permissions.
- No hardcoded tenants, users, project IDs, credentials, or production URLs as product logic.
- No implicit tenant.
- No default tenant.
- No fallback user.
- No default allow.
- Global admin is a platform identity, not an implicit tenant user.
- Tenant isolation must be preserved in database design, API design, queries, and UI behavior.
- Schema changes must be justified by documented product/data need.
- Docs and code must be updated together when behavior changes.
- Evidence labels should be used where relevant: `verified`, `observed`, `hypothesis`, `unclear`.

---

## 5. AI / Codex Rules

Codex must behave like a critical senior platform architect, security reviewer, and fullstack engineer.

Codex must not blindly implement requests that weaken the foundation.

Codex may without asking:
- Read files.
- Analyze code, docs, migrations, and repo state.
- Run non-destructive read-only checks.
- Propose markdown governance files.
- Draft plans, audits, and decision formats.

Codex may only do after explicit instruction:
- Change code.
- Change migrations.
- Change schema.
- Change auth/session/token behavior.
- Change RLS/RBAC.
- Change module registry or module dependencies.
- Change production deploy/config.
- Delete files or data.
- Commit.
- Push.

Codex must never do without explicit approval:
- Push to remote.
- Commit changes.
- Bypass tenant isolation.
- Bypass RBAC/RLS.
- Hardcode tenant/user/project/credential values as a solution.
- Mix E-Komplet imported data with Fielddesk-owned truth without data policy.
- Promote ideas from idea bank to backlog/spec.
- Remove audit logging for critical flows.
- Revert user changes.
- Run destructive git or filesystem commands.

---

## 6. Commit And Push Rules

Codex may not commit unless Dennis explicitly asks for a commit.

Codex may never push unless Dennis explicitly asks for a push.

Recommended future rules:
- `main` should be protected.
- Work should happen on feature/fix/foundation branches.
- Commits should be small and focused.
- Pull requests should document tenant impact, security impact, migration impact, module impact, and test results.
- Foundation/security changes require extra review.

---

## 7. Modular Direction

Fielddesk should become a modular platform where modules can be enabled or disabled per tenant.

Expected module categories:
- Core: tenant/auth, users/RBAC, projects, audit/security, module registry.
- Optional: economy, restarbejde, planning, documents, QA, time registration, CO2/ESG, FD Intelligence, timeline/snapshots.

Module rules:
- Every module must have documented purpose, owner, dependencies, permissions, data ownership, and disable/deactivation behavior.
- Modules must not be mounted merely as routes without governance.
- Module access must be separate from role access.
- Module dependencies must be explicit and enforceable.
- Some modules must be able to run without E-Komplet.
- E-Komplet may enrich modules, but must not silently define all Fielddesk truth.

---

## 8. Tenant / RBAC Direction

Tenant isolation is a core platform requirement.

Direction:
- All tenant data must be scoped by `tenant_id`.
- All API endpoints must verify tenant context and actor permissions.
- RLS should be introduced as database defense-in-depth.
- RBAC should move from ad hoc route checks to a central permission model.
- Scope should be explicit: mine, team, tenant, platform.
- Global admin must not have implicit tenant data access.

Expected future roles may include:
- global_admin
- tenant_admin
- department_manager
- project_leader
- technician
- finance
- planner
- advisor / guest

Roles and module access must be separate concepts.

---

## 9. E-Komplet Separation

E-Komplet can be a data source, but Fielddesk must not be dependent on E-Komplet to function as a platform.

Rules:
- E-Komplet credentials are tenant-specific.
- E-Komplet imported data must be distinguishable from Fielddesk-owned data.
- E-Komplet v4 project masterdata is treated differently from v3 WIP/enrichment data.
- v4 project data can be authoritative for imported project existence/status only where explicitly decided.
- v3 WIP/enrichment must not override Fielddesk-owned truth without a decision.
- Data freshness and source should be visible in backend/API semantics and eventually UI.
- Fielddesk must define native project/data behavior for tenants without E-Komplet.

---

## 10. Data Ownership Principles

Every data field/table/API response should be classifiable as one of:
- Fielddesk-owned: created or governed by Fielddesk.
- Imported: copied from an external source such as E-Komplet or Solar.
- Derived: calculated from Fielddesk-owned and/or imported data.
- Audit: append-only event or governance trace.
- Credential/config: sensitive tenant/platform configuration.
- Demo/sandbox: non-production test/demo data.

Rules:
- Imported data must not silently become Fielddesk-owned truth.
- Derived data must document source inputs and freshness.
- Credentials must never appear in logs, docs, API responses, or commits.
- Audit data should be append-only and tenant-aware.
- Demo/sandbox data must not leak into production.

---

## 11. Not Yet Decided

The following are not yet fully decided and must not be assumed:
- Final governance document structure.
- Final RBAC matrix.
- Final module registry.
- Which modules are core versus optional.
- Which modules must work without E-Komplet.
- Fielddesk-native project creation/editing model.
- Full RLS policy design.
- Token/session storage direction for tenant UI.
- Whether global admin can ever request audited support access to tenant data.
- Staging/prod/preview deployment structure.
- Versioning/release policy.
- Idea bank/backlog/spec ID formats.
- Whether Codex may commit after specific types of tasks.

Codex must ask or propose options instead of assuming these decisions.

---

## 12. Conflict Handling

If Dennis requests something that conflicts with existing foundation principles, active decisions, or security rules, Codex must stop before implementation.

Codex must then:
1. Explain the conflict.
2. Point to the rule, decision, or principle being broken.
3. Explain the consequence.
4. Suggest a compatible path that preserves the foundation.
5. Wait for explicit approval before destructive or foundation-critical changes.

Examples that require stopping:
- Hardcoding a tenant/user/project.
- Bypassing RBAC.
- Weakening tenant isolation.
- Mixing E-Komplet imported data with Fielddesk-owned truth.
- Making a module globally available without tenant enablement.
- Changing migrations/schema without decision context.
- Deploying demo/debug behavior to production.

---

## 13. Future Governance Files That Should Replace This Bootstrap

This file should eventually be replaced by proper governance documents:

- `docs/00_MASTER.md`
- `docs/DOC_INDEX.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY_MODEL.md`
- `docs/DATA_POLICY.md`
- `docs/MODULE_REGISTRY.md`
- `docs/RBAC_MATRIX.md`
- `docs/DECISIONS.md`
- `docs/IDE_BANK.md`
- `docs/BACKLOG.md`
- `docs/VERSIONING.md`
- `docs/DEPLOYMENT.md`
- `docs/DEV_WORKFLOW.md`
- `docs/AI_WORKFLOW.md`
- `docs/CHANGELOG.md`
- `docs/ARCHITECTURE_HISTORY.md`
- `docs/modules/README.md`
- `docs/audits/README.md`
- `docs/integrations/ek/README.md`
- `docs/integrations/solar/README.md`

Once these files exist and are marked active, this bootstrap file should be archived or reduced to a pointer.

---

## 14. Instruction To Future Codex Sessions

Before major work, read this file and the relevant active docs.

Do not start from scratch.

Do not treat old audits as automatically current.

Do not assume missing decisions.

Do not implement foundation-critical changes without naming risks and asking for approval.

Keep Fielddesk modular, tenant-safe, auditable, and able to function without E-Komplet as a hard dependency.
