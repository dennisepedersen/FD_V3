# FD Implementation Gates

Status: current governance gates
Scope: required gates between analysis, spec, build, preview, review, and release
Last updated: 2026-06-04

No human, Codex session, AI agent, script, automation, CI job, or deployment process may skip these gates.

## Gate Summary

| Gate | Name | Required Approval | Minimum Evidence | Blocks |
| --- | --- | --- | --- | --- |
| Gate 1 | Analysis approved | Dennis/product or delegated architecture owner | Labs-style analysis, affected modules, risk, open questions | Spec work |
| Gate 2 | Spec approved | Product + architecture/security where relevant | Buildable spec, acceptance criteria, data/RBAC/audit/storage impact | Build work |
| Gate 3 | Build verified | Implementer + local verification evidence | Tests/smoke/build output, scoped diff, docs updated | Preview |
| Gate 4 | Preview approved | Human reviewer/user | URL/screenshot/artifact/evidence, known limitations | Review completion |
| Gate 5 | Review approved | Human reviewer + security/architecture if needed | Review findings resolved or accepted | Release |
| Gate 6 | Release approved | Dennis/release owner | Final checks, release plan, rollback notes where relevant | Deployment/release |

## Gate 1: Analysis Approved

Purpose:
Prove that the problem, value, risk, affected modules, and unknowns are understood before specification.

Required input:
- Approved idea/request.
- Current docs reviewed.
- Overlap/conflict check.

Required output:
- Analysis following `docs/LABS_ANALYSIS_SCHEMA.md`.
- Recommendation.
- Open questions.

Stop criteria:
- Tenant/data/RBAC/security impact is unclear.
- The idea conflicts with current decisions.
- Business value or owner is unclear.

## Gate 2: Spec Approved

Purpose:
Convert approved analysis into a buildable, bounded contract.

Required input:
- Gate 1 output.
- Relevant docs and decisions.

Required output:
- Scope.
- Acceptance criteria.
- Data ownership.
- RBAC/audit/storage/report/integration impact.
- UI/UX impact where relevant.
- Verification plan.

Stop criteria:
- Acceptance criteria are missing.
- Spec requires unapproved foundation decisions.
- Required docs are not updated.

## Gate 3: Build Verified

Purpose:
Show that implementation matches spec and does not broaden scope.

Required input:
- Approved spec.
- Clean understanding of worktree state.

Required output:
- Scoped implementation.
- Verification output.
- Docs updated where behavior changed.
- Known residual risks.

Stop criteria:
- Code changes go beyond approved scope.
- Tests/smoke/build cannot run and risk is high.
- Security-sensitive behavior cannot be verified.
- Unrelated user changes would be overwritten or mixed.

## Gate 4: Preview Approved

Purpose:
Let a human inspect behavior or artifact before review/release.

Required input:
- Gate 3 verified build.
- Dev/preview environment or rendered artifact where relevant.

Required output:
- Preview evidence.
- Known limitations.
- Human approval or requested changes.

Stop criteria:
- Preview does not demonstrate acceptance criteria.
- UI is unusable on required devices.
- Sensitive behavior cannot be inspected safely.

## Gate 5: Review Approved

Purpose:
Validate behavior, security, docs, and residual risk.

Required input:
- Diff.
- Spec.
- Verification evidence.
- Preview evidence.

Required output:
- Review result.
- Findings resolved or explicitly accepted.
- Release recommendation.

Stop criteria:
- Critical findings remain.
- Docs conflict with implementation.
- Tenant isolation/auth/RBAC/audit/storage/data risk remains unclear.

## Gate 6: Release Approved

Purpose:
Ship only reviewed and approved changes.

Required input:
- Gate 5 approval.
- Required checks.
- Release plan if needed.

Required output:
- Release/deploy record.
- Post-release verification.
- Decision/doc update if behavior changed.

Stop criteria:
- No explicit release approval.
- Failed checks.
- Missing rollback/mitigation for risky changes.
- Secrets, tenant data, or production config risk is unresolved.

## Special Foundation Gates

The following require explicit human approval before implementation:

- Auth/session/token behavior.
- Tenant resolution.
- RBAC/permissions.
- RLS.
- Schema/migrations.
- Production config/deploy.
- Secrets/integration credentials.
- Data retention/deletion/export.
- Direct third-party integration behavior.
- AI autonomy or data-changing AI actions.

## Related Docs

- `docs/CODEX_WORKFLOW.md`
- `docs/PROJECT_RULES.md`
- `docs/AI_GOVERNANCE.md`
- `docs/SECURITY_MODEL.md`
- `docs/DATA_POLICY.md`
- `docs/V3_BUILD_GATECHECK.md`
