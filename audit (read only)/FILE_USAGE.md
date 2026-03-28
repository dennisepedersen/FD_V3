# FILE_USAGE.md
## Fielddesk V2 — Governance & Instruction File Inventory

**Audit type:** Read-only. No code changes.
**Purpose:** Document every governance, instruction, decision, and prompt file in this workspace — what it is, where it lives, what reads it, and whether it is actively enforced.
**Date:** 2026-03

---

## 1. Workspace Root Governance Files

| File | Location | Purpose | Status |
|------|----------|---------|--------|
| `AGENTS.md` | `AGENTS.md` | AI agent rules for this workspace — always-on rules, scope/safety, implementation workflow, Fielddesk governance guardrails, mandatory doc reading list | ACTIVE — read by Copilot agent before every response |
| `PROJECT_STRUCTURE.md` | `PROJECT_STRUCTURE.md` | Source of truth for folder structure, naming conventions, placement rules | ACTIVE — referenced by AGENTS.md |
| `FIELDESK_STATUS.md` | `FIELDESK_STATUS.md` | Runtime truth document — module status, what exists, what is placeholder | ACTIVE — AGENTS.md requires this to be read before any task |
| `pre_decisions.md` | `pre_decisions.md` | Pre-decision constraints and ordering rules — governs what can be decided and in what sequence | ACTIVE — AGENTS.md requires reading |
| `scope.md` | `scope.md` | Scope definitions for API endpoints — example queries, scope behavior | ACTIVE — used for development reference |

---

## 2. Documentation: Platform and Architecture

| File | Location | Purpose | Status |
|------|----------|---------|--------|
| Security model | `docs/platform/FIELD_DESK_SECURITY_MODEL.md` | Governing security rules — tenant isolation, fail-closed, backend as truth | ACTIVE — AGENTS.md requires reading for security/RBAC tasks |
| Tenant provisioning | `docs/platform/FIELD_DESK_TENANT_PROVISIONING.md` | Tenant onboarding and provisioning rules | ACTIVE — AGENTS.md requires reading for tenant tasks |
| Deployment model | `docs/platform/FIELD_DESK_DEPLOYMENT_MODEL.md` | Deployment architecture and environment rules | Reference |
| Support access model | `docs/platform/FIELD_DESK_SUPPORT_ACCESS_MODEL.md` | Support access rules and restrictions | Reference |
| Application architecture | `docs/FIELD_DESK_APPLICATION_ARCHITECTURE.md` | High-level application layer architecture | Reference |
| System architecture | `docs/FIELD_DESK_SYSTEM_ARCHITECTURE.md` | Physical/infra system architecture | Reference |
| Runtime flow | `docs/FIELD_DESK_RUNTIME_FLOW.md` | Runtime request flow documentation | Reference |
| RBAC | `docs/RBAC.md` | Role-based access control model documentation | Reference |
| Feature access matrix | `docs/FEATURE_ACCESS.md` | Feature-to-role access matrix | Reference |
| Spec | `docs/SPEC.md` | General feature specification | Reference |
| Temp | `docs/temp.md` | Scratch/temp notes | Non-authoritative |

---

## 3. Documentation: Decisions

| File | Location | Purpose | Status |
|------|----------|---------|--------|
| Decision catalog | `docs/decisions/DECISIONS.md` | Locked decisions — architectural choices that cannot be reversed without explicit versioning | ACTIVE — AGENTS.md requires reading |
| Time sync bootstrap | `docs/decisions/time_sync_bootstrap.md` | Decision record for time sync bootstrap approach | Reference |

---

## 4. Documentation: Security

All files in `docs/security/`:

| File | Purpose | Status |
|------|---------|--------|
| `FIELD_DESK_API_SECURITY.md` | API security rules and controls | Reference |
| `FIELD_DESK_AUDIT_LOGGING.md` | Audit logging design spec | Reference |
| `FIELD_DESK_AUTH_AND_PASSWORD_RESET_SPEC.md` | Auth and password reset specification | Reference |
| `FIELD_DESK_AUTH_DB_AND_API_CONTRACT.md` | Auth DB and API contract | Reference |
| `FIELD_DESK_BACKUP_AND_RECOVERY.md` | Backup and recovery policy | Reference |
| `FIELD_DESK_DATA_ISOLATION.md` | Data isolation rules and mechanisms | Reference |
| `FIELD_DESK_DATA_RETENTION_POLICY.md` | Data retention policy | Reference |
| `FIELD_DESK_DEVELOPMENT_SECURITY_RULES.md` | Dev-time security rules | ACTIVE — governs development practices |
| `FIELD_DESK_SECRET_HANDLING.md` | Secret and credential handling rules | ACTIVE — governs env var and secret management |
| `FIELD_DESK_SECURITY_CHECKLIST.md` | Pre-launch security checklist | Reference |
| `FIELD_DESK_SECURITY_MODEL.md` | Security model (duplicate under security/) | Reference — canonical version is in `docs/platform/` |
| `FIELD_DESK_THREAT_MODEL.md` | Threat model catalog | Reference |
| `FIELD_DESK_VENDOR_DEPENDENCIES.md` | Vendor and third-party dependency audit | Reference |

---

## 5. V3 Planning Files

| File | Location | Purpose | Status |
|------|----------|---------|--------|
| Reset master plan | `V3/V3_RESET_MASTER_PLAN.md` | V3 rebuild master plan — phases, goals, stop-gates | ACTIVE — planning document for V3 |
| Audit prompt | `V3/FD_V3_RESET_AUDIT_PROMPT.md` | The audit instruction prompt — defines this session's task, required outputs, constraints | SOURCE — this session originated from this file |

---

## 6. Audit Output Files (This Session)

All files produced by this audit session. Location: `V3/audit/`

| File | Purpose | Status |
|------|---------|--------|
| `V3/audit/DB_OVERVIEW.md` | Full database schema documentation — all 21 tables, relationships, known issues | CREATED |
| `V3/audit/API_MAP.md` | Full API endpoint catalog — all routes, method, auth, scope, purpose | CREATED |
| `V3/audit/ENV_MAP.md` | All environment variables — required/optional, security classification | CREATED |
| `V3/audit/TENANT_MAP.md` | Tenant model — table structure, known tenants, hardcoded IDs, provisioning gaps | CREATED |
| `V3/audit/AUTH_FLOW.md` | Authentication flow — token format, login paths, middleware chain, known gaps | CREATED |
| `V3/audit/SCOPE_MODEL.md` | Scope and access model — scope values, backend enforcement, feature flags, inconsistencies | CREATED |
| `V3/audit/FILE_USAGE.md` | This file — governance and instruction file inventory | CREATED |

---

## 7. AI / Copilot Instruction Files

| File | Location | Purpose | Applies to |
|------|----------|---------|-----------|
| Workspace Copilot instructions | `.github/copilot-instructions.md` | Points to AGENTS.md and PROJECT_STRUCTURE.md as primary governance; defines behavior requirements and response style | This workspace |
| Workspace agent instruction | `.github/instructions/always-read-agents.instructions.md` | Instructs agent to always read AGENTS.md before any action; stop if required docs missing | This workspace (applyTo: **) |
| Global agent instruction | `c:\Users\dep\.copilot\instructions\always-read-agents.instructions.md` | Same instruction applied globally across all workspaces | All workspaces |
| Global workspace preferences | `c:\Users\dep\AppData\Roaming\Code\User\prompts\workspace-governance.instructions.md` | Default governance model for all workspaces — scaffold AGENTS.md + PROJECT_STRUCTURE.md + copilot-instructions.md | All workspaces |

---

## 8. Backend Static/Config Files

| File | Location | Purpose | Status |
|------|----------|---------|--------|
| Role mapping | `backend/config/roleMapping.js` | EK roles → FD roles mapping; FD role priority order | ACTIVE |
| Manual identity mapping | `backend/data/identity_manual_mapping.json` | Manual overrides for username/UUID resolution per tenant | ACTIVE — loaded on each request in `/api/projects` etc. |
| Projects data | `backend/data/projects.json` | Static projects data for seed or offline reference | UNKNOWN — not confirmed to be used in production path |

---

## 9. Database Migration Files

| File | Location | Purpose | Status |
|------|----------|---------|--------|
| Base schema | `backend/db/schema.sql` | Core table definitions — base schema for initial setup | Reference |
| EK time module migration | `backend/db/migration_20260316_ek_time_module.sql` | Adds `ek_fitterhours` and `ek_fittercategories` tables | Applied (confirmed in postgres.js runtime schema) |
| Fitterhours bootstrap state | `backend/db/migration_20260316_fitterhours_bootstrap_state.sql` | Adds `tenant_fitterhours_bootstrap_state` table | Applied |
| Tenant sync state | `backend/db/migration_20260316_tenant_sync_state.sql` | Adds `tenant_sync_state` table | Applied |

---

## 10. Reports and Raw Data Files

All in `backend/reports/`:

| File type | Content | Use |
|-----------|---------|-----|
| `*.json` | Raw API responses, role/user reports, fitterhours exports | Audit/debug reference — not loaded by runtime |
| `*.md` | Analysis reports, API endpoint catalog copies | Audit reference |

---

## 11. Feature Specification Files

| File | Location | Purpose | Status |
|------|----------|---------|--------|
| Finance engine decision | `docs/Feature_md/finance_engine_backend_decision.md` | Decision record for finance engine backend approach | Reference |

---

## 12. Reading Priority Order (as defined in AGENTS.md)

When an AI agent begins any task in this workspace:

1. **Always read first:**
   - `AGENTS.md`
   - `FIELDESK_STATUS.md`
   - `docs/decisions/DECISIONS.md`
   - `docs/platform/FIELD_DESK_SECURITY_MODEL.md`
   - `docs/platform/FIELD_DESK_TENANT_PROVISIONING.md`
   - `pre_decisions.md`

2. **Read additionally if task involves:**
   - RBAC / access → `docs/RBAC.md`, `docs/FEATURE_ACCESS.md`
   - Tenant isolation → `docs/platform/FIELD_DESK_TENANT_PROVISIONING.md`
   - Audit/logging → `docs/security/FIELD_DESK_AUDIT_LOGGING.md`
   - Global admin → `docs/platform/FIELD_DESK_SECURITY_MODEL.md`
   - API design → `docs/FIELD_DESK_SYSTEM_ARCHITECTURE.md`, `API_ENDPOINT_CATALOG 1.md`
   - Auth → `docs/security/FIELD_DESK_AUTH_AND_PASSWORD_RESET_SPEC.md`

3. **Stop if any of the 6 required docs are missing**

---

## 13. Known Issues

| # | Issue | Impact |
|---|-------|--------|
| F1 | `FIELDESK_STATUS.md` references `tenant_configuration_snapshots` table — this table does NOT exist in any migration or schema.sql | CRITICAL — doc/reality mismatch |
| F2 | `docs/decisions/DECISIONS.md` requires `audit_events` table — not found in any schema or migration | CRITICAL — doc/reality mismatch |
| F3 | `schema.sql` and `postgres.js` both define schema — they are not verified to be in sync | MEDIUM — dual source of truth risk |
| F4 | `backend/data/projects.json` — unclear if this is runtime data or a development artifact | UNKNOWN |
| F5 | No `CHANGELOG.md` or version history exists — changes are not tracked in a central log | MEDIUM |

---

*This file is read-only audit output. No code changes were made.*
