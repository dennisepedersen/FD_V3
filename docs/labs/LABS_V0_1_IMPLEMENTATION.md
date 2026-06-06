# Fielddesk Labs v0.1 Implementation Note

Status: Gate 3 implementation reference
Scope: Fielddesk Labs v0.1 only: IDE -> ANALYSE -> approved_for_spec
Last updated: 2026-06-04
Owner: Dennis / Fielddesk platform governance

This document records the implemented v0.1 slice. It does not expand scope beyond `docs/labs/LABS_V0_1_SPEC.md`.

## 1. Implemented Scope

Implemented:

- Global-admin-only Labs portal page at `/labs`.
- Platform API under `/v1/labs`.
- Idea create, list, read, edit, reject, park, reopen, analyze, and approve for SPEC.
- Attachment upload, list, view/download, and archive.
- Immutable analysis runs and append-only idea history.
- Shared audit events for Labs actions and denied access.

Not implemented:

- Automatic SPEC generation.
- Build task generation.
- Code-agent integration.
- GitHub or PR automation.
- Sandbox deploy.
- Preview links.
- Release workflow.
- Tenant-facing Labs.
- Customer-facing Labs.
- Registry enablement.
- Tenant data access.
- External integrations.

## 2. Runtime Classification

Labs v0.1 is implemented as Platform Tooling.

Consequences:

- Labs data tables do not use tenant ownership.
- Labs routes are mounted on the portal/global admin surface.
- Tenant session middleware is not sufficient for Labs access.
- Labs is not part of tenant module enablement or module registry rollout.

## 3. Access Control

Backend access is enforced by the existing global admin session model:

- Cookie: `fd_portal_session`.
- Token type: `global_admin`.
- Actor source: `global_admin_user`.

Missing, invalid, expired, or non-global-admin access is rejected before Labs service handlers run.

Denied requests are audited as `labs.access_denied` where the shared audit system is available.

## 4. Persistence

Migration:

- `migrations/0023_labs_v0_1.sql`

Tables:

- `labs_idea`
- `labs_analysis`
- `labs_attachment`
- `labs_idea_history`

Persistence rules:

- `labs_analysis` is immutable after insert.
- `labs_idea_history` is append-only.
- Labs records are platform scoped.
- `approved_for_spec` is terminal for v0.1 and does not trigger downstream automation.

## 5. Attachments

Allowed file extensions:

- `pdf`
- `png`
- `jpg`
- `jpeg`
- `txt`
- `md`

Default limits:

- Max 10 MB per file.
- Max 5 active files per idea.

Attachment contents are not used as AI context in v0.1. The analyzer receives attachment metadata only.

## 6. Analysis Engine

v0.1 uses a server-side analyzer abstraction with a deterministic local provider by default.

Environment defaults:

- `LABS_AI_PROVIDER=local`
- `LABS_AI_MODEL=fielddesk-local-governance-analyzer-v0.1`

The local analyzer reads idea fields, attachment metadata, and full governance document contents server-side for deterministic keyword checks. It stores governance document metadata and hashes, not raw governance document contents, in analysis metadata.

The local provider does not perform full semantic governance reasoning and does not call external AI providers. Its output must be treated as deterministic v0.1 advisory analysis.

Analysis output follows `docs/LABS_ANALYSIS_SCHEMA.md` and stores:

- Full analysis JSON.
- Summary.
- Recommendation.
- Score and subscores.
- Open questions.
- Critical open questions.
- Docs-read metadata and document hashes.
- Deterministic governance content check results.
- Provider/model/version metadata.

## 7. Approval Rule

`approved_for_spec` requires:

- Latest completed analysis run.
- No critical open questions in the latest analysis.

Non-critical open questions may remain if the analysis recommendation supports moving forward and the questions are documented.

Approval performs only a status transition. It does not generate a SPEC or trigger any build workflow.

## 8. Audit Events

Implemented audit events:

- `labs.idea_created`
- `labs.idea_updated`
- `labs.idea_rejected`
- `labs.idea_reopened`
- `labs.idea_parked`
- `labs.idea_approved_for_spec`
- `labs.analysis_requested`
- `labs.analysis_completed`
- `labs.analysis_failed`
- `labs.attachment_added`
- `labs.attachment_viewed`
- `labs.attachment_downloaded`
- `labs.attachment_archived`
- `labs.access_denied`

The implementation uses the existing shared audit service, not a separate audit platform.

## 9. Known Limitations

- External AI provider integration is intentionally deferred.
- Attachment storage defaults to local backend-managed storage unless `LABS_ATTACHMENT_STORAGE_DIR` is configured.
- There is no malware scanning in v0.1.
- There is no dedicated AI telemetry/cost ledger in v0.1 because the default analyzer is local.
- Existing package scripts do not currently include lint, typecheck, test, or build commands.

## 10. Gate 3 Assessment

Gate 3 implementation is considered complete when:

- Migration exists for Labs tables and audit events.
- Backend routes enforce global-admin-only access.
- Attachments are stored, shown, limited, and audited.
- Analysis runs are immutable and follow the Labs schema.
- UI supports the v0.1 workflow.
- `approved_for_spec` stops the workflow.
- No future build, agent, deploy, preview, or release workflow is implemented.
