# FD Codex Workflow

Status: current development workflow governance
Scope: human/Codex/AI workflow from idea to release
Last updated: 2026-06-04

This document defines the workflow:

```text
IDE
  -> ANALYSE
  -> SPEC
  -> BUILD
  -> PREVIEW
  -> REVIEW
  -> RELEASE
```

No stage grants permission to skip `docs/IMPLEMENTATION_GATES.md`.

## 1. IDE

Purpose:
Capture ideas without turning them into scope, architecture, or implementation.

Input:
- Dennis request.
- User/customer need.
- `docs/IDE_BANK.md` entry.
- Observation from support, audit, or project work.

Output:
- Structured idea entry.
- Initial problem/value/risk notes.
- Status such as under vurdering, approved for analysis, wild idea, archived.

Approval responsibility:
- Dennis/product owner.

Stop criteria:
- Idea is not approved for analysis.
- Idea conflicts with current foundation rules.
- Idea lacks a clear problem or owner.

## 2. ANALYSE

Purpose:
Understand the problem, business value, affected modules, risks, data/RBAC impact, dependencies, and open questions before spec/build.

Input:
- Approved idea or concrete request.
- Current docs from `docs/DOC_INDEX.md`.
- Relevant code/audit only if needed for evidence.

Output:
- Analysis following `docs/LABS_ANALYSIS_SCHEMA.md`.
- Conflict/overlap list.
- Recommendation: reject, park, clarify, spec, or build-ready after gates.

Approval responsibility:
- Dennis or delegated product/architecture approver.

Stop criteria:
- Critical open questions remain.
- Security/tenant/data ownership is unclear.
- Required module owner or dependency is missing.
- Analysis conflicts with active decisions.

## 3. SPEC

Purpose:
Convert approved analysis into a buildable contract.

Input:
- Approved analysis.
- Existing architecture/security/data/module contracts.
- Relevant module map and project rules.

Output:
- Spec or module contract update.
- Acceptance criteria.
- Security/data/RBAC impact.
- UI/UX impact.
- Test/smoke plan.
- Docs to update.

Approval responsibility:
- Dennis/product owner for scope.
- Architecture/security owner for foundation-sensitive areas.

Stop criteria:
- Acceptance criteria are missing.
- Data ownership is unclear.
- RBAC/audit/storage/report requirements are unclear.
- Required docs are not updated.

## 4. BUILD

Purpose:
Implement the approved spec in a narrow, reviewable slice.

Input:
- Approved spec.
- Current codebase.
- Relevant contracts and decisions.

Output:
- Code/docs changes within scope.
- No unrelated rewrites.
- Local verification where available.
- Updated docs if behavior changed.

Approval responsibility:
- Codex may implement only within explicit scope.
- Human approval required for migrations, auth/RBAC/RLS, deploy/config, destructive actions, or release.

Stop criteria:
- The build requires unapproved schema, auth, tenant, RBAC, RLS, storage, or integration changes.
- Worktree contains conflicting user changes.
- Tests/smoke cannot run and risk is not documented.

## 5. PREVIEW

Purpose:
Show the built behavior safely before final review/release.

Input:
- Built slice.
- Dev server, preview environment, screenshots, smoke output, or rendered artifacts as relevant.

Output:
- Preview URL, screenshot, artifact, or evidence summary.
- Known limitations and verification notes.

Approval responsibility:
- Human reviewer/user.

Stop criteria:
- Preview cannot demonstrate the acceptance criteria.
- Security-sensitive behavior cannot be verified.
- UI is broken on mobile/desktop where relevant.

## 6. REVIEW

Purpose:
Validate that the change meets spec, preserves Fielddesk rules, and has acceptable risk.

Input:
- Diff.
- Spec/analysis.
- Test/smoke output.
- Preview evidence.
- Updated docs.

Output:
- Findings or approval.
- Residual risks.
- Required fixes or release recommendation.

Approval responsibility:
- Human reviewer.
- Security/architecture owner for sensitive changes.

Stop criteria:
- Tenant isolation, auth, RBAC, audit, data ownership, storage, or integration safety is unclear.
- Docs and behavior conflict.
- Critical tests or smoke checks are missing.

## 7. RELEASE

Purpose:
Ship approved changes through the agreed release path.

Input:
- Reviewed and approved change.
- Passing required checks.
- Release notes where relevant.
- Migration/deploy plan if applicable.

Output:
- Released artifact/deployment.
- Tagged/recorded decision if required.
- Post-release verification notes.

Approval responsibility:
- Dennis or delegated release owner.

Stop criteria:
- No explicit release approval.
- Failed checks.
- Unreviewed migrations/deploy config.
- Secrets or tenant data exposure risk.

## Codex Working Rules

- Read docs first for foundation-sensitive work.
- Do not build from idea bank alone.
- Do not commit, push, deploy, or release unless explicitly asked.
- Do not change migrations, auth, RBAC, RLS, tenant resolution, production config, or secrets without explicit approval.
- Preserve unrelated user changes.
- Update docs when behavior changes.
- Name uncertainty instead of guessing.

## Related Docs

- `docs/PROJECT_RULES.md`
- `docs/IMPLEMENTATION_GATES.md`
- `docs/LABS_ANALYSIS_SCHEMA.md`
- `docs/AI_GOVERNANCE.md`
- `docs/DOC_INDEX.md`
- `docs/DECISIONS.md`
- `docs/IDE_BANK.md`
