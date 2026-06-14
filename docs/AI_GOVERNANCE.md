# FD V3 AI Governance

Status: current AI/Codex working rules  
Scope: development governance only; no implementation by itself

## 1. AI Role In FD

Current:
- AI assists development, analysis, documentation, reviews, and implementation work.
- AI does not own the architecture.
- Human decisions are authoritative.
- Current governance docs are source of truth.
- If docs and a prompt conflict, stop and name the conflict before implementing.

Rules:
- AI must not invent auth, tenant, RBAC, audit, storage, or integration behavior.
- AI must distinguish `verified`, `observed`, `hypothesis`, and `unclear` where relevant.
- AI must keep Fielddesk modular, tenant-safe, auditable, and backend-owned.

## 2. ChatGPT Vs Codex Roles

ChatGPT is best used for:
- Strategy.
- Governance.
- Architecture discussion.
- Module definitions.
- Reviews.
- Prompt design.
- Analysis.
- Workflow design.

Codex is best used for:
- Repo analysis.
- Implementation.
- Code changes.
- Documentation creation.
- Audits.
- Refactors.
- Build/test flows.
- Small, scoped commits when explicitly requested.

Rule:
- ChatGPT can shape direction. Codex changes files only inside clear scope and after reading relevant docs.

## 3. Prompt Rules

Current:
- Work should be split into small scoped batches.
- One concern per batch is preferred.
- Read-only analysis should happen before major architecture, security, migration, or module work.

Prompt rules:
- Say exactly which files or areas may be changed.
- Say what must not be changed.
- Avoid massive uncontrolled rewrites.
- Do not mix backend, frontend, migrations, docs, and deploy changes unless deliberately scoped.
- Run build/tests after technical code changes when the repo supports it.
- Do documentation/governance before large migrations or module integration.

Planned:
- Reusable prompt templates for audits, module intake, security review, and implementation batches.

## 4. Commit Rules

Current:
- Codex may not commit unless explicitly asked.
- Codex may never push unless explicitly asked.
- Dirty worktrees are normal; unrelated changes must not be reverted or included.

Commit rules:
- Small commits.
- One concern per commit.
- No mixed governance + code commits unless explicitly approved.
- No mixed frontend + backend + migration commits unless deliberately scoped.
- Commit only named files when requested.
- Check staged files before commit.
- Show short status after commit.

Commit message convention:
- `docs: ...` for documentation/governance.
- `feat: ...` for new product behavior.
- `fix: ...` for corrections.
- `chore: ...` for maintenance.
- `refactor: ...` for behavior-preserving structure changes.

## 5. Documentation Rules

Current:
- Canonical docs come first.
- `docs/00_MASTER.md`, `docs/DOC_INDEX.md`, `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY_MODEL.md`, and `docs/MODULE_CONTRACT.md` guide future work.
- Historical docs must be treated as context unless marked current.

Rules:
- Docs before large features.
- Module definition before module integration.
- Security/data/module governance before migrations.
- Update docs when behavior changes.
- Do not let stale docs silently override current docs.
- Mark old, historical, or time-sensitive docs clearly.

Planned:
- `DATA_POLICY.md`, module registry docs, and deeper RBAC docs later.

## 6. Prototype Rules

Current:
- Prototypes may be fast and isolated.
- Prototypes may use localStorage/demo flows when explicitly scoped as prototype behavior.
- Prototype behavior is not automatically production architecture.

Rules:
- Before FD integration, a prototype needs module definition, migration assessment, data model, RBAC/audit/storage plan, and FD shell/API plan.
- LocalStorage, dataUrl/base64, demo project state, and frontend-owned security are prototype-only.
- Production modules must follow `docs/MODULE_CONTRACT.md`.

Restarbejde example:
- Prototype workflows can inform FD module behavior.
- Storage, backend, RBAC, tenant scope, audit, reports, and app-shell integration must be redesigned for FD before production.

## 7. Security Rules For AI Work

Current:
- Secrets must not be hardcoded, logged, committed, or pasted into prompts.
- Security is backend-owned.
- Tenant isolation is first priority.

Rules:
- No secrets in prompts.
- No API keys, tokens, cookies, passwords, or connection strings in docs or screenshots.
- No screenshots with credentials unless redacted.
- No tokens in frontend code as a design solution.
- Codex must not invent or bypass auth/security.
- If a task affects auth, RBAC, RLS, tenant resolution, audit, secrets, or storage security, read `docs/SECURITY_MODEL.md` first.

## 8. Architecture Rules

Current:
- Backend owns truth.
- Frontend must not own security.
- Tenant isolation first.
- Integrations may enrich FD but must not own FD state.
- Modules must follow `docs/MODULE_CONTRACT.md`.

Rules:
- No fallback tenant.
- No implicit access.
- No default allow.
- No duplicate core entities inside modules.
- No integration-owned Fielddesk truth without documented decision.
- No schema/migration changes without documented data need.
- No UI-first architecture for security or data contracts.

## 9. Open Questions

Open:
- Automated AI audits.
- Prompt registry or prompt library.
- Whether AI-generated migrations need a special approval flow.
- AI review workflow before merge.
- CI integration for docs/security checks.
- Required PR template for AI-generated changes.
- Whether Codex may commit after specific task types by default.

Do not assume these are solved until a current doc says so.

## 10. Windows Sandbox And GitHub CLI

Current:
- On Windows, sandboxed commands can fail because the sandbox cannot access the
  same network, keyring, spawn behavior, or GitHub CLI credential context as the
  normal Windows session.
- `gh` can fail inside the sandbox while still working outside the sandbox via
  Windows keyring.

Rules:
- It is acceptable to try a read-only or approved `gh` command in the sandbox
  first.
- If a Windows sandboxed command fails due to auth, keyring, network, spawn, or
  GitHub CLI access, Codex must retry the same approved command with
  `require_escalated` / non-sandbox Windows context and a short reason.
- This applies especially to:
  - `gh auth status`
  - `gh repo view`
  - `gh pr list`
  - `gh pr create`
  - `gh pr view`
  - `gh pr merge`
- When `gh` works outside the sandbox, PR flow should use GitHub CLI.
- Do not switch to the GitHub connector for PR creation as a fallback unless
  Dennis explicitly asks for it.

## 11. Relevant Docs

Start here:
- `docs/00_MASTER.md`
- `docs/DOC_INDEX.md`
- `docs/DECISIONS.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY_MODEL.md`
- `docs/MODULE_CONTRACT.md`

Foundation:
- `docs/V3_FOUNDATION_DESIGN.md`
- `docs/AI_BOOTSTRAP_CONTEXT.md`
- `docs/V3_BUILD_GATECHECK.md`
- `docs/SECRET_HANDLING_RULES.md`

Backend standards:
- `backend/docs/standards/fd_implementation_rules.md`
