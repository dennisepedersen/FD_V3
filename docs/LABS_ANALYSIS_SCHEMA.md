# FD Labs Analysis Schema

Status: current required schema for future Fielddesk Labs analysis output
Scope: analysis output format only; no implementation by itself
Last updated: 2026-06-04

Fielddesk Labs must use this structure when analyzing ideas, specs, modules, risks, or build readiness.

Labs may recommend. Labs must not decide, build, approve, release, or bypass gates.

## Required Output Shape

```text
1. Resume
2. Problem
3. Forretningsvaerdi
4. Beroerte moduler
5. Risiko
6. Sikkerhed
7. Data/RBAC
8. UI/UX paavirkning
9. Teknisk kompleksitet
10. Afhaengigheder
11. Anbefaling
12. Analyse-score
13. Aabne spoergsmaal
```

## 1. Resume

Short neutral summary of the request or idea.

Must include:
- What is being considered.
- Whether this is idea, analysis, spec, build, review, or release scope.
- Current recommendation status.

## 2. Problem

Describe the user/business problem.

Must distinguish:
- Proven problem.
- Assumed problem.
- Nice-to-have.
- Unknowns.

## 3. Forretningsvaerdi

Describe the value if solved.

Consider:
- Time saved.
- Reduced risk.
- Better documentation/audit.
- Revenue or retention.
- Operational quality.
- Enterprise readiness.

## 4. Beroerte Moduler

List affected modules using `docs/MODULE_MAP.md`.

For each module include:
- Impact level: none, low, medium, high.
- Reason.
- Whether module owner approval is needed.

## 5. Risiko

Describe product, operational, technical, compliance, security, and rollout risk.

Use levels:
- Low.
- Medium.
- High.
- Critical.

Critical risk must stop progression until clarified or approved.

## 6. Sikkerhed

Analyze:
- Tenant isolation.
- Auth/session impact.
- RBAC/module permissions.
- RLS/database isolation.
- Secrets.
- Audit.
- Storage/files.
- Report/export sensitivity.
- Third-party integrations.

If security is unclear, mark recommendation as blocked.

## 7. Data/RBAC

Analyze:
- Data ownership class.
- Fielddesk-owned vs imported vs derived.
- Required scopes.
- Roles/permissions.
- Audit events.
- Retention/deletion/export needs.
- Whether frontend would be tempted to own truth.

Use `docs/DATA_POLICY.md`, `docs/SECURITY_MODEL.md`, and module contracts.

## 8. UI/UX Paavirkning

Analyze:
- Mobile impact.
- Dashboard impact.
- Drawer/detail flow.
- Form complexity.
- Navigation/module registry impact.
- Empty/error/loading states.
- Report/preview implications.

Use `docs/UI_UX_PRINCIPLES.md`.

## 9. Teknisk Kompleksitet

Rate complexity:
- XS: docs/config only.
- S: small isolated behavior.
- M: module slice or backend/frontend flow.
- L: shared platform behavior.
- XL: foundation/security/data/integration architecture.

Explain:
- Files/areas likely touched.
- Test/smoke needs.
- Migration or no migration.
- Integration or no integration.

## 10. Afhaengigheder

List dependencies:
- Documents/decisions.
- Modules.
- External systems.
- Data contracts.
- Human approvals.
- Existing blockers.

Mark each as:
- Ready.
- Partial.
- Missing.
- Blocked.

## 11. Anbefaling

Choose exactly one:

- Reject.
- Park in IDE_BANK.
- Needs clarification.
- Ready for SPEC.
- Ready for BUILD after Gate 2 approval.
- Ready for REVIEW.
- Ready for RELEASE after Gate 6 approval.

Include why.

## 12. Analyse-score

Use a 0-100 score for readiness.

Scoring guide:

- 0-24: reject or park.
- 25-49: significant unknowns.
- 50-69: viable but needs clarification/spec.
- 70-84: ready for spec or narrow build planning.
- 85-100: strong candidate after required gates.

Also provide sub-scores:

| Area | Score 0-100 | Note |
| --- | ---: | --- |
| Business value |  |  |
| Security clarity |  |  |
| Data/RBAC clarity |  |  |
| UX clarity |  |  |
| Technical readiness |  |  |
| Dependency readiness |  |  |

## 13. Aabne Spoergsmaal

List questions Dennis or a delegated owner must answer.

Questions must be specific enough to unblock the next gate.

## Required Metadata

Each Labs analysis should include:

- Analysis id.
- Date.
- Request/source.
- Analyst: human, Codex, Labs, or other.
- Evidence level: verified, observed, hypothesis, unclear.
- Docs read.
- Gate recommendation.

## Conflict Handling

If the request conflicts with current docs:

1. Name the conflict.
2. Link or reference the source doc.
3. Explain consequence.
4. Recommend a compatible path.
5. Mark the analysis blocked if the conflict affects security, tenant isolation, data ownership, AI authority, or release gates.

## Related Docs

- `docs/PROJECT_RULES.md`
- `docs/CODEX_WORKFLOW.md`
- `docs/IMPLEMENTATION_GATES.md`
- `docs/AI_GOVERNANCE.md`
- `docs/MODULE_MAP.md`
- `docs/DATA_POLICY.md`
- `docs/UI_UX_PRINCIPLES.md`
- `docs/DOC_INDEX.md`
- `docs/DECISIONS.md`
