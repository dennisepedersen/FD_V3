# FD Project Rules

Status: current governance constitution
Scope: canonical project-wide rules for humans, Codex, and future AI agents
Last updated: 2026-06-04

This document is the Fielddesk constitution. It does not replace detailed architecture, security, data, module, storage, report, or integration contracts. When a detailed current contract is stricter, the stricter rule wins.

## Source Priority

Use this order when rules conflict:

1. Explicit human decision from Dennis in the current task.
2. Current decision in `docs/DECISIONS.md`.
3. This document.
4. Current domain contract docs.
5. Historical/bootstrap docs.
6. Code behavior, only after the relevant docs have been checked.

If a conflict affects tenant isolation, security, data ownership, AI authority, integrations, releases, or module boundaries, stop and record the conflict before changing behavior.

## Rules

| ID | Regel | Begrundelse | Konsekvens ved brud |
| --- | --- | --- | --- |
| PR-001 | Mobile first for field-facing workflows. | Fielddesk supports operational work on site, not only office use. | UI may become unusable for technicians and project leaders in the field. |
| PR-002 | Tenant isolation first. | Fielddesk is a multi-tenant SaaS platform. | Cross-tenant leakage is a critical security failure and must block release. |
| PR-003 | Security before features. | Features are unsafe if auth, RBAC, scope, audit, secrets, and storage are unclear. | Implementation must stop until the security model is documented and approved. |
| PR-004 | Backend is source of truth. | Browser state, hidden buttons, route visibility, and cached data are not security boundaries. | Frontend-only authority is invalid and must be replaced by backend enforcement. |
| PR-005 | No implicit tenant, user, project, or allow. | Silent fallbacks create invisible access paths. | Missing context must fail closed. |
| PR-006 | Human approval required for irreversible or authority-changing actions. | AI and automation may be wrong or lack business context. | The action must not run until Dennis or the delegated human approver approves it. |
| PR-007 | Docs before build. | Future humans and AI agents need stable truth before code changes. | Build work is blocked until the relevant spec/contract/gate is updated. |
| PR-008 | AI may recommend, never decide. | AI can assist analysis, but product, security, release, and business decisions remain human-owned. | AI output must be treated as proposal until approved. |
| PR-009 | Fielddesk must work without integrations. | Integrations enrich Fielddesk but must not become the only way the platform functions. | Modules that require an integration must explicitly declare it and cannot be assumed core. |
| PR-010 | No direct third-party API calls from frontend. | Credentials, rate limits, tenant scope, audit, and errors must be backend-controlled. | Frontend direct calls to ERP, Solar, M365, AI, or similar services are forbidden. |
| PR-011 | Imported data must not silently become Fielddesk-owned truth. | External systems have different semantics and freshness. | Data ownership and source must be documented before use in decisions, reports, or automation. |
| PR-012 | Module contracts before module integration. | Modules must share tenant, project, RBAC, audit, storage, report, and registry rules. | Prototype code cannot be copied into FD as production architecture. |
| PR-013 | DB schema before API, API before UI. | UI should consume approved contracts, not invent data/security semantics. | UI-first implementation is blocked for platform and module work. |
| PR-014 | Reports and exports are sensitive outputs. | Generated files can contain tenant, project, person, financial, and audit-relevant data. | Report/export flows require permission, scope, storage, and audit planning. |
| PR-015 | Storage paths are not authorization. | File names, URLs, object keys, and hidden links can be guessed or leaked. | File access must be backend-authorized and auditable where relevant. |
| PR-016 | Secrets never enter frontend, docs, logs, screenshots, or commits. | Secret leakage can compromise tenants and integrations. | Rotate leaked secrets, remove exposure, and review history before continuing. |
| PR-017 | Evidence labels must be preserved. | Fielddesk has verified facts, observed behavior, hypotheses, and unknowns. | Unproven claims must be marked `hypothesis` or `unclear`. |
| PR-018 | No automation may skip implementation gates. | Gates preserve quality, security, and human review. | Automation that bypasses gates is invalid and must be disabled or redesigned. |
| PR-019 | Dirty worktrees must be respected. | Unrelated changes may be user work. | Do not revert, overwrite, commit, or mix unrelated changes without explicit instruction. |
| PR-020 | Ideas are not backlog, specs, or build permission. | The idea bank is an intake area, not an implementation order. | Ideas must pass analysis, spec, and approval gates before build. |

## Required Read Order For Foundation Work

Before changing architecture, security, tenant, module, data, AI, workflow, release, or Labs behavior, read:

1. `docs/00_MASTER.md`
2. `docs/DOC_INDEX.md`
3. `docs/PROJECT_RULES.md`
4. `docs/DECISIONS.md`
5. `docs/ARCHITECTURE.md`
6. `docs/SECURITY_MODEL.md`
7. Relevant domain contracts and module docs

## Related Docs

- `docs/AI_GOVERNANCE.md`
- `docs/IMPLEMENTATION_GATES.md`
- `docs/CODEX_WORKFLOW.md`
- `docs/DATA_POLICY.md`
- `docs/MODULE_CONTRACT.md`
- `docs/MODULE_REGISTRY_CONTRACT.md`
- `docs/PROJECT_CONTEXT_CONTRACT.md`
- `docs/REPORT_ENGINE_CONTRACT.md`
- `docs/STORAGE_CONTRACT.md`
- `docs/AUDIT_CONTRACT.md`
