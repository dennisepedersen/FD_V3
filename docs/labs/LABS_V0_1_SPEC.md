# Fielddesk Labs v0.1 SPEC

Status: Gate 2 approved SPEC; Gate 3 implementation reference exists
Scope: Fielddesk Labs v0.1 only: IDE -> ANALYSE
Last updated: 2026-06-04
Owner: Dennis / Fielddesk platform governance

This document is a SPEC only.

It does not implement or approve runtime changes. It does not create migrations, API endpoints, UI, database changes, agents, deploys, previews, or automation.

Gate 3 implementation reference: `docs/labs/LABS_V0_1_IMPLEMENTATION.md`.

## 0. Governance Basis

Labs v0.1 must follow:

- `docs/PROJECT_RULES.md`
- `docs/UI_UX_PRINCIPLES.md`
- `docs/MODULE_MAP.md`
- `docs/CODEX_WORKFLOW.md`
- `docs/AI_GOVERNANCE.md`
- `docs/IMPLEMENTATION_GATES.md`
- `docs/LABS_ANALYSIS_SCHEMA.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY_MODEL.md`
- `docs/DATA_POLICY.md`
- `docs/DECISIONS.md`
- `docs/labs/LABS_V0_1_IMPLEMENTATION.md`

No blocking conflict was found while finalizing Gate 2.

Key decisions:

- Labs may recommend, never decide.
- Labs v0.1 is Platform Tooling, not tenant functionality.
- Labs v0.1 is global-admin-only.
- Labs v0.1 covers only IDE -> ANALYSE.
- Labs v0.1 stops at `approved_for_spec`.
- Attachments are saved, shown, and audited, but are human-review context only in v0.1.
- Labs v0.1 AI analyzes idea fields, governance docs, and metadata only.
- Human approval is required before any SPEC generation, build task, code agent, deploy, preview, review, or release work.

## 1. Purpose

Fielddesk Labs v0.1 is the first building block in the future Fielddesk Development Platform.

Long-term vision:

```text
FD Labs
  -> Analyse
  -> Approved SPEC
  -> Build Task
  -> Code Agent
  -> Sandbox Deploy
  -> Preview Link
```

v0.1 scope:

```text
IDE
  -> ANALYSE
  -> approved_for_spec
```

v0.1 purpose:

- Capture development ideas in a structured way.
- Attach supporting files/screenshots for human review.
- Run governance-aware analysis against current Fielddesk docs.
- Save analysis output and history.
- Let global admin reject, park, reopen, edit, or approve an idea for the next phase.

v0.1 must not:

- Generate SPEC automatically.
- Create build tasks.
- Call code agents.
- Create branches, commits, PRs, deployments, previews, or releases.
- Mutate tenant data.
- Act as customer-, tenant-, technician-, or project-leader functionality.

## 1.1 Platform Tooling Classification

Fielddesk Labs v0.1 is classified as:

```text
Platform Tooling
```

It is not:

- Tenant Module.
- Registry Enabled Module.
- Customer Feature.
- Tenant-facing functionality.
- Project-facing functionality.

Consequences:

- Labs exists outside tenant enablement.
- Labs is not enabled or disabled per tenant.
- Labs is not visible in tenant navigation.
- Labs does not use tenant module entitlements.
- Labs access is controlled by global admin/platform authorization only.
- Labs data is platform-internal data.
- Labs must not imply global admin access to tenant-owned data.
- Labs may reference modules, tenants, projects, integrations, or customer cases as analysis context, but those references do not create tenant scope or tenant access.

## 2. User Roles

### 2.1 Allowed Role

Only `global_admin` may access Labs v0.1.

Labs v0.1 is platform-internal governance tooling for Dennis/global admin.

### 2.2 Excluded Roles

The following roles must not access Labs v0.1:

- `tenant_admin`
- `project_leader`
- `technician`
- future tenant roles such as finance, planner, advisor, guest
- anonymous users
- tenant-scoped support users

### 2.3 AI Role

AI/Labs may:

- Analyze ideas.
- Read approved governance docs.
- Produce analysis following `LABS_ANALYSIS_SCHEMA.md`.
- Identify conflicts, risks, dependencies, and open questions.
- Recommend next action.

AI/Labs must not:

- Approve its own analysis.
- Decide product scope.
- Decide security, RBAC, RLS, data retention, or release policy.
- Generate SPEC automatically in v0.1.
- Create build tasks.
- Call code agents.
- Deploy or preview anything.
- Mutate source data without explicit human-approved implementation scope.

## 3. Access Model

### 3.1 Global Admin Identification

Recommendation:

- Labs v0.1 should be reachable only from the existing global/portal admin surface.
- Backend must identify the actor as `actor_scope = global`.
- Backend must verify `role = global_admin`.
- Tenant JWT/session context must not grant Labs access.
- `tenant_id` must be `null` or absent in the Labs actor context.

Valid access context:

```text
actor_scope = global
role = global_admin
tenant_id = null
```

Invalid access contexts:

```text
actor_scope = tenant
role = tenant_admin
tenant_id = <any tenant>
```

```text
actor_scope = tenant
role = project_leader
tenant_id = <any tenant>
```

```text
actor_scope = global
role != global_admin
```

### 3.2 Enforcement

Access must be enforced in backend.

Frontend route visibility is usability only. It is not authorization.

Backend policy for every future Labs endpoint/action:

- Require authenticated global actor.
- Require `global_admin`.
- Deny any tenant actor.
- Deny missing/invalid session.
- Deny if request is resolved through tenant host/app scope.

### 3.3 Labs Outside Tenant Scope

Labs data is platform-internal data, not tenant-owned data.

Labs records should not use `tenant_id` as ownership scope.

Recommended scope fields:

- `platform_scope = "global"`
- `created_by_global_actor_id`
- `updated_by_global_actor_id`

If a Labs idea references a tenant, module, project, integration, or customer case, that reference must be stored as context, not as an access boundary.

Labs must not grant global admin implicit tenant-data access. If future analysis needs real tenant data, that requires a separate approved support/access policy. v0.1 does not include that.

### 3.4 Platform Tooling Access Consequences

Because Labs is Platform Tooling:

- Tenant module registry state must not control Labs availability.
- Tenant users must not receive Labs permissions.
- Tenant route middleware must not be sufficient for Labs access.
- Labs endpoints in a future implementation must live behind global/platform admin authorization.
- Audit events should use platform/global actor context and `tenant_id = null`.
- Labs records should use platform ownership fields, not tenant ownership fields.

### 3.5 Audit

Labs actions are platform audit events.

Recommended audit shape:

```text
actor_scope = global
actor_id = <global admin id>
tenant_id = null
target_type = labs_idea | labs_analysis | labs_attachment
target_id = <resource id>
outcome = success | fail | deny
metadata = sanitized structured metadata
```

Audit metadata must not include file contents, screenshots, secrets, raw prompts, raw AI output, or sensitive tenant/customer payloads.

## 4. Dataflow

### 4.1 Create Idea

Input:

- Module.
- Problem.
- Desired function.
- Priority.
- Description.
- Optional files/screenshots.

Output:

- Saved Labs idea.
- Status: `draft` or `ready_for_analysis`.
- Audit event: `labs.idea_created`.

Rules:

- Idea creation does not approve analysis.
- Idea creation does not create backlog/spec/build scope.
- Required fields must be validated before `ready_for_analysis`.

### 4.2 Attach Files/Screenshots

Input:

- One to five allowed files/screenshots.

Output:

- Attachment metadata.
- Storage object reference, when implemented.
- Audit event: `labs.attachment_added`.

Rules:

- Attachments must be saved, shown in the idea detail, and audited.
- Attachments are human-review context only in v0.1.
- Attachments do not become source of truth.
- Screenshots may contain sensitive data and must be treated as internal platform files.
- No permanent base64/dataUrl storage in production design.
- Attachment contents must not be used as AI context in v0.1.
- Attachment content must not be sent to the analysis engine in v0.1.
- Only attachment metadata may be included in analysis input.
- Allowed file extensions: `pdf`, `png`, `jpg`, `jpeg`, `txt`, `md`.
- Default max file size: 10 MB per file.
- Default max attachment count: 5 files per idea.

### 4.3 Run Analysis

Input:

- Saved idea.
- Current governance docs.
- Attachment metadata only.

Required docs for analysis:

- `PROJECT_RULES.md`
- `UI_UX_PRINCIPLES.md`
- `MODULE_MAP.md`
- `AI_GOVERNANCE.md`
- `DECISIONS.md`
- `ARCHITECTURE.md`
- `SECURITY_MODEL.md`
- `DATA_POLICY.md`
- `LABS_ANALYSIS_SCHEMA.md`
- `CODEX_WORKFLOW.md`
- `IMPLEMENTATION_GATES.md`

Output:

- Analysis run following `LABS_ANALYSIS_SCHEMA.md`.
- Analysis score.
- Recommendation.
- Critical and non-critical open questions.
- Docs-read list.
- Evidence level.
- Status transition to `analyzed` or `analysis_failed`.
- Audit event: `labs.analysis_run`.

Rules:

- Analysis output is derived advisory data.
- Analysis does not approve itself.
- Analysis cannot auto-generate SPEC in v0.1.
- If conflicts are found, output must include conflict section and may recommend `needs_clarification`.
- Attachment contents, screenshots, PDFs, text files, markdown files, extracted text, OCR, and raw binary data must not be included in AI context in v0.1.
- AI may know that attachments exist, including filename, type, size, attachment description, and attachment ids.

### 4.4 View Analysis

Input:

- Idea id.

Output:

- Latest analysis summary.
- Analysis history.
- Attachments list.
- Current idea status.

Rules:

- Read access is global-admin-only.
- Read audit is optional in v0.1, but denied reads should be auditable.

### 4.5 Save Analysis

Analysis runs should be persisted as immutable versions.

Saving a new analysis does not overwrite older analysis output.

Recommended behavior:

- Each run creates a new `labs_analysis` row.
- Latest analysis is derived by newest successful run.
- Previous runs remain available for comparison/history.

### 4.6 Edit Idea

Global admin may edit idea fields.

Rules:

- Editing an idea after analysis should not mutate the previous analysis.
- Editing should mark the latest analysis as stale or set `analysis_freshness = stale`.
- Re-running analysis creates a new analysis version.
- Audit event: `labs.idea_updated`.

### 4.7 Reject Idea

Rejecting means the idea should not proceed.

Rules:

- Require a reason.
- Keep idea, analysis, attachments, and history.
- Status: `rejected`.
- Audit event: `labs.idea_rejected`.

### 4.8 Reopen Rejected Idea

Rejected ideas may be reopened.

Rules:

- Only `global_admin` may reopen a rejected idea.
- Reopen requires a reason.
- Reopen changes status from `rejected` to `ready_for_analysis`.
- Existing analysis history remains preserved.
- Reopening should mark the latest analysis as stale unless a human explicitly confirms the old analysis is still current.
- Audit event: `labs.idea_reopened`.

### 4.9 Park Idea

Parking means the idea may be revisited later.

Rules:

- Require optional or recommended reason.
- Keep idea, analysis, attachments, and history.
- Status: `parked`.
- Audit event: `labs.idea_parked`.

### 4.10 Approve Idea For SPEC

Approving for SPEC means the idea passed Gate 1 and may enter manual SPEC work.

Rules:

- Status: `approved_for_spec`.
- Require human/global admin action.
- Require a current successful analysis.
- Require all critical open questions to be resolved.
- Non-critical open questions may remain if they are documented in the analysis and accepted by global admin.
- Does not generate SPEC.
- Does not create build task.
- Does not call code agent.
- Does not create preview/deploy.
- Audit event: `labs.idea_approved_for_spec`.

Critical open question:

- A question that can change tenant isolation, auth, RBAC, RLS, data ownership, storage/security, audit coverage, AI authority, module classification, release safety, or the actual feasibility of the next phase.
- Critical open questions block `approved_for_spec`.

Non-critical open question:

- A question that affects wording, prioritization, UI polish, later roadmap detail, or implementation preference without changing security, data ownership, gate eligibility, or scope.
- Non-critical questions do not block `approved_for_spec` when they are explicitly documented.

## 5. UI Flow

This is UI/UX specification only, not implementation.

### 5.1 Entry

Labs v0.1 should be accessible from a global-admin-only platform area.

Recommended navigation label:

```text
Labs
```

Recommended first screen:

- Idea list.
- Create idea action.
- Filters by status, priority, module, score.
- Latest analysis score/recommendation where available.

### 5.2 Create/Edit Idea Form

Required fields:

- Module.
- Problem.
- Desired function.
- Priority.
- Description.

Optional fields:

- Files.
- Screenshots.
- Tags.
- Source/reference.
- Notes.

Recommended field behavior:

- Show required fields first.
- Keep description large enough for structured context.
- File upload appears after core idea fields.
- Validation should happen before analysis can run.

### 5.3 Idea Detail

Idea detail should show:

- Current status.
- Idea fields.
- Attachment list.
- Attachment metadata and safe preview/download action where supported by the future implementation.
- Latest analysis card.
- Analysis history.
- Audit/history summary.
- Action buttons.

### 5.4 Analysis Card

Collapsed card shows:

- Title.
- Status.
- Score.
- Short resume.
- Recommendation.
- Last run time.

Expanded card shows full analysis:

- Resume.
- Problem.
- Business value.
- Affected modules.
- Risk.
- Security.
- Data/RBAC.
- UI/UX impact.
- Technical complexity.
- Dependencies.
- Recommendation.
- Analysis score.
- Critical and non-critical open questions.
- Metadata: docs read, evidence level, analyst, date.
- Conflicts if any.

### 5.5 Actions

Required buttons:

- Gem.
- Rediger ide.
- Afvis.
- Parker.
- Godkend til SPEC.

Recommended additional actions:

- Koer analyse.
- Genabn ide, visible only for `rejected` ideas and only to `global_admin`.

Button rules:

- `Gem` saves idea changes only.
- `Koer analyse` creates a new analysis run.
- `Rediger ide` opens edit mode/drawer.
- `Afvis` requires reason and confirmation.
- `Parker` should ask for optional reason.
- `Godkend til SPEC` requires current analysis and confirmation.
- `Godkend til SPEC` is disabled while critical open questions remain unresolved.
- `Genabn ide` requires reason and audit logging.

### 5.6 Empty/Error/Loading States

Empty:

- Show that no ideas exist yet.
- Offer create idea action.

Loading:

- Show stable card/list skeleton.
- Do not shift layout.

Analysis running:

- Show status `analyzing`.
- Prevent duplicate analysis run for same idea unless explicitly allowed later.

Analysis failed:

- Show safe error summary.
- Do not expose raw prompts, stack traces, tokens, or secrets.
- Allow retry.

Denied:

- Show access denied.
- Do not reveal tenant/platform internals.
- Audit deny outcome.

## 6. Mobile-First UX

Labs is internal global-admin tooling, but must still be usable on mobile.

Mobile requirements:

- Idea list uses cards before tables.
- Create/edit idea form is single-column.
- Required fields appear first.
- Attachments are shown as compact list items.
- Analysis card is collapsed by default.
- Expanded analysis uses section accordions.
- Primary action should remain reachable without horizontal scrolling.
- Destructive actions are separated and confirmed.

Desktop requirements:

- May use denser list/table view.
- Idea detail may use two-column layout: idea/context and analysis/history.
- Analysis history can be side panel or secondary section.

UI must not:

- Hide access rules in frontend only.
- Present AI recommendation as a decision.
- Present `approved_for_spec` as build approval.
- Make future phases look available in v0.1.

## 7. Proposed Database Model

This is a proposed model only. No migrations are approved by this SPEC.

### 7.1 `labs_idea`

Purpose:
Stores platform-internal ideas.

Recommended fields:

- `id`
- `title`
- `module_key`
- `problem`
- `desired_function`
- `priority`
- `description`
- `status`
- `source`
- `tags_json`
- `created_by_global_actor_id`
- `updated_by_global_actor_id`
- `created_at`
- `updated_at`
- `approved_for_spec_at`
- `approved_for_spec_by`
- `rejected_at`
- `rejected_by`
- `rejected_reason`
- `reopened_at`
- `reopened_by`
- `reopened_reason`
- `parked_at`
- `parked_by`
- `parked_reason`

Rules:

- No `tenant_id` ownership field.
- Platform/global actor fields are required for creates/updates.
- `module_key` should align with `MODULE_MAP.md` where possible.

### 7.2 `labs_analysis`

Purpose:
Stores immutable analysis runs.

Recommended fields:

- `id`
- `idea_id`
- `analysis_version`
- `status`
- `schema_version`
- `analysis_json`
- `summary`
- `recommendation`
- `score`
- `subscores_json`
- `open_questions_json`
- `critical_open_questions_json`
- `noncritical_open_questions_json`
- `conflicts_json`
- `docs_read_json`
- `evidence_level`
- `analysis_freshness`
- `model_provider`
- `model_name`
- `prompt_version`
- `input_snapshot_json`
- `attachment_metadata_snapshot_json`
- `created_by_global_actor_id`
- `created_at`
- `completed_at`
- `failed_at`
- `failure_code`
- `failure_summary`

Rules:

- Analysis rows are append-only for successful runs.
- If analysis output must be corrected, create a new run/version.
- Raw prompts and raw model traces should not be stored unless separately approved.
- Attachment content must not be stored in `input_snapshot_json`.
- `attachment_metadata_snapshot_json` may store filename, type, size, description, and attachment ids only.
- `analysis_json` must conform to `LABS_ANALYSIS_SCHEMA.md`.

### 7.3 `labs_attachment`

Purpose:
Stores attachment metadata for idea context.

Recommended fields:

- `id`
- `idea_id`
- `storage_object_id`
- `file_name`
- `content_type`
- `file_extension`
- `size_bytes`
- `attachment_type`
- `description`
- `created_by_global_actor_id`
- `created_at`
- `archived_at`
- `archived_by`

Rules:

- Binary data belongs in storage service/object storage.
- No permanent base64/dataUrl storage.
- Attachments are platform-internal files.
- Attachment contents should not be copied into audit metadata.
- Allowed extensions: `pdf`, `png`, `jpg`, `jpeg`, `txt`, `md`.
- Default max size: 10 MB per file.
- Default max count: 5 files per idea.
- Attachment contents are not AI input in v0.1.

### 7.4 `labs_idea_history`

Purpose:
Stores structured history for idea changes.

Recommended fields:

- `id`
- `idea_id`
- `event_type`
- `from_status`
- `to_status`
- `changed_fields_json`
- `reason`
- `created_by_global_actor_id`
- `created_at`

Rules:

- Use for user-visible history.
- Use platform audit for authoritative audit.
- Do not store secrets or full file contents.

### 7.5 Audit Events

Labs should use the shared audit system, not create a separate authoritative audit table.

Recommended event names:

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

## 8. Analysis Model

### 8.1 Analysis Inputs

Labs v0.1 analysis input should include:

- Idea fields.
- Attachment metadata only.
- Required governance docs.
- Current date.
- Actor identity category: global admin.

Labs v0.1 analysis input must not include:

- Attachment file contents.
- Screenshot pixels.
- PDF text extraction.
- TXT/MD file contents.
- Image OCR.
- Raw binary data.

### 8.2 Required Governance Context

The analysis prompt/context must explicitly include or reference:

- Project rules.
- UI/UX principles.
- Module map.
- Codex workflow.
- AI governance.
- Decisions.
- Architecture.
- Security model.
- Data policy.
- Implementation gates.
- Labs analysis schema.

Implementation note for the deterministic local v0.1 provider:

- It may read full governance document contents server-side for deterministic checks.
- It must record docs-read metadata and hashes rather than raw governance document contents.
- It must not claim full semantic governance reasoning unless an approved provider actually performs that reasoning.
- Attachment contents remain excluded from analysis input.

### 8.3 Required Analysis Steps

The analysis engine should:

1. Validate that idea fields are complete enough.
2. Classify affected modules using `MODULE_MAP.md`.
3. Check the idea against `PROJECT_RULES.md`.
4. Check AI authority limits using `AI_GOVERNANCE.md`.
5. Include attachment metadata only as supporting context.
6. Check workflow/gate position using `CODEX_WORKFLOW.md` and `IMPLEMENTATION_GATES.md`.
7. Check security implications using `SECURITY_MODEL.md`.
8. Classify data using `DATA_POLICY.md`.
9. Check UI/UX implications using `UI_UX_PRINCIPLES.md`.
10. Check active decisions in `DECISIONS.md`.
11. Produce output in `LABS_ANALYSIS_SCHEMA.md` format.
12. Classify open questions as critical or non-critical.
13. Assign readiness score and subscores.
14. List open questions.
15. Recommend one next action.

### 8.4 Output Contract

Output must follow `LABS_ANALYSIS_SCHEMA.md`.

Required output sections:

- Resume.
- Problem.
- Forretningsvaerdi.
- Beroerte moduler.
- Risiko.
- Sikkerhed.
- Data/RBAC.
- UI/UX paavirkning.
- Teknisk kompleksitet.
- Afhaengigheder.
- Anbefaling.
- Analyse-score.
- Aabne spoergsmaal.

Required metadata:

- Analysis id.
- Date.
- Request/source.
- Analyst.
- Evidence level.
- Docs read.
- Gate recommendation.
- Critical vs non-critical open questions.

### 8.5 Recommendation Values

Labs v0.1 may recommend:

- `reject`
- `park`
- `needs_clarification`
- `ready_for_spec`

Labs v0.1 must not recommend:

- `ready_for_build`
- `ready_for_preview`
- `ready_for_release`

If `LABS_ANALYSIS_SCHEMA.md` contains broader recommendation values for future phases, v0.1 must hide or disallow them in the v0.1 workflow.

### 8.6 Score Semantics

The score is advisory.

It must not automatically change idea status.

Suggested status guidance:

- 0-24: likely reject or park.
- 25-49: needs clarification.
- 50-69: viable but not ready.
- 70-84: possible ready for SPEC if open questions are acceptable.
- 85-100: strong candidate for SPEC, still requires human approval.

## 9. File Handling

Labs v0.1 supports optional files/screenshots.

Labs v0.1 treats attachments as human-review context only.

Allowed file extensions:

- `pdf`
- `png`
- `jpg`
- `jpeg`
- `txt`
- `md`

Default constraints:

- Max 10 MB per file.
- Max 5 files per idea.
- Virus/malware scanning when storage implementation supports it.
- Manual warning that screenshots may contain secrets or customer data.

Rationale for defaults:

- 10 MB is large enough for normal screenshots, short PDFs, markdown/text notes, and focused review material.
- 5 files per idea encourages concise analysis context and avoids turning Labs v0.1 into a document repository.
- Larger files or more attachments may be useful later for document-heavy analysis, but that should be a later explicit decision because it affects storage, scanning, performance, and review ergonomics.

Storage direction:

- Use shared storage service direction.
- Store metadata in `labs_attachment`.
- Store binary in object/blob storage.
- Access only through backend-authorized global-admin routes.
- Do not expose storage paths as authorization.

Analysis use:

- Attachment contents must not be used as AI context in v0.1.
- AI may receive attachment metadata only.
- Analysis output should state that attachments were stored for human review and not analyzed by AI.
- Attachment access, view, download, and archive actions must be audited.

## 10. Status Model

Recommended statuses:

| Status | Meaning | Allowed next statuses |
| --- | --- | --- |
| `draft` | Idea saved but not ready for analysis. | `ready_for_analysis`, `rejected`, `parked` |
| `ready_for_analysis` | Required idea fields are present. | `analyzing`, `rejected`, `parked` |
| `analyzing` | Analysis run is in progress. | `analyzed`, `analysis_failed` |
| `analysis_failed` | Last analysis failed safely. | `ready_for_analysis`, `rejected`, `parked` |
| `analyzed` | At least one successful analysis exists. | `ready_for_analysis`, `approved_for_spec`, `rejected`, `parked` |
| `parked` | Idea is intentionally paused. | `ready_for_analysis`, `rejected` |
| `rejected` | Idea is closed as not proceeding. | `ready_for_analysis` only through global-admin reopen |
| `approved_for_spec` | Human approved idea to enter SPEC phase. | No automatic next transition in v0.1 |

Rules:

- `approved_for_spec` is not approval to build.
- `approved_for_spec` is not generated SPEC.
- `approved_for_spec` requires all critical open questions to be resolved.
- Non-critical open questions may remain if documented and accepted.
- Editing an analyzed idea should mark the latest analysis stale and return the idea to `ready_for_analysis` or equivalent.
- Reopening rejected ideas is allowed only by global admin and must be audited.

## 11. Audit Requirements

Must audit:

- Access denied.
- Idea created.
- Idea updated.
- Idea rejected.
- Idea reopened.
- Idea parked.
- Idea approved for SPEC.
- Analysis requested.
- Analysis completed.
- Analysis failed.
- Attachment added.
- Attachment viewed.
- Attachment downloaded.
- Attachment archived/removed.

Audit metadata should include:

- Idea id.
- Analysis id where relevant.
- Attachment id where relevant.
- From/to status.
- Recommendation.
- Score.
- Reason category.
- Critical open question count.
- Non-critical open question count.
- Docs-read hash/version metadata if available.

Audit metadata must not include:

- Secrets.
- Raw files.
- Raw screenshots.
- Raw AI prompts.
- Full AI output.
- Sensitive tenant/customer payloads.

## 12. AI Limitations

Labs v0.1 AI must:

- Use only approved docs, idea fields, and metadata.
- Produce advisory analysis.
- Mark uncertainty.
- Name conflicts.
- Follow `LABS_ANALYSIS_SCHEMA.md`.
- Store analysis as derived data.

Labs v0.1 AI must not:

- Generate SPEC.
- Write code.
- Create migrations.
- Create endpoints.
- Create UI.
- Create build tasks.
- Open PRs.
- Commit or push.
- Deploy.
- Create preview links.
- Make product/security/data decisions.
- Mutate tenant data.
- Access tenant data by global admin implication.
- Call third-party APIs from frontend.
- Use attachment contents, screenshots, PDFs, text files, markdown files, OCR, or extracted attachment text as AI context in v0.1.

If the analysis engine is unsure, it must choose `needs_clarification` and list concrete open questions.

## 13. Future Build Integration

This section documents the long-term vision only. It does not change v0.1 scope.

Future target flow:

```text
FD Labs
  -> Analyse
  -> Approved SPEC
  -> Build Task
  -> Code Agent
  -> Sandbox Deploy
  -> Preview Link
```

Expected future phases:

- Analysis identifies whether an idea is viable and ready for SPEC.
- Approved SPEC turns accepted analysis into a buildable contract.
- Build Task packages scope, files, constraints, acceptance criteria, and verification plan.
- Code Agent performs approved implementation work in a constrained workspace.
- Sandbox Deploy creates a non-production deployment for inspection.
- Preview Link lets a human review behavior before merge/release.

Gate protection:

- Gate 1 protects transition from analysis to SPEC.
- Gate 2 protects transition from SPEC to build.
- Gate 3 protects transition from build to preview.
- Gate 4 protects preview approval.
- Gate 5 protects review approval.
- Gate 6 protects release approval.

None of the following are included in v0.1:

- SPEC generation.
- Build task generation.
- Code-agent invocation.
- Branch/commit/PR creation.
- Sandbox deploy.
- Preview link.
- Review automation.
- Release automation.

## 14. Future Extensions

Future extensions are not included in v0.1.

### After v0.1

#### v0.2: IDE -> ANALYSE -> SPEC

Potential scope:

- Human-approved SPEC drafting from an approved analysis.
- SPEC templates per module type.
- SPEC versioning.
- SPEC review workflow.
- Gate 2 evidence capture.

Still requires:

- Human approval before SPEC becomes buildable.
- No automatic build.

#### v0.3: IDE -> ANALYSE -> SPEC -> BUILD TASK

Potential scope:

- Convert approved SPEC into build task.
- Define file scope.
- Define acceptance criteria.
- Define verification plan.
- Create task package for Codex/code agent.

Still requires:

- Human approval before code agent invocation.
- No automatic deploy.

#### v0.4: IDE -> ANALYSE -> SPEC -> BUILD -> PREVIEW

Potential scope:

- Agent-assisted scoped build.
- Sandbox branch/workspace.
- Automated local verification.
- Sandbox deploy.
- Preview link.

Still requires:

- Build gate verification.
- Preview approval.
- No production release.

#### v0.5+

Potential scope:

- Review workflow.
- Agent integration orchestration.
- Sandbox workflows.
- Release gate support.
- PR/check integration.
- Audit dashboards.
- AI cost/telemetry.
- Docs/code consistency checks.

Still requires:

- Human gate approval.
- No skipped gates.
- No autonomous production release.

## 15. Acceptance Criteria For This SPEC

Labs v0.1 is ready for implementation planning when:

- Dennis decisions from Gate 2 review are incorporated.
- Access model is global-admin-only.
- Labs classification is Platform Tooling, not tenant module or customer feature.
- Proposed persistence model is documented.
- File handling strategy is documented with default file types and limits.
- Attachment AI-context exclusion is documented.
- Reopen behavior for rejected ideas is documented.
- Critical vs non-critical open question behavior is documented.
- Audit event list is documented.
- AI limitations are documented.
- Future Build Integration is documented as future-only, not v0.1 scope.

## 16. Open Questions

No open decisions currently block v0.1 implementation planning.

Non-blocking implementation details to confirm during implementation planning:

1. Exact global admin session mechanism to reuse in the first implementation slice.
2. Whether `model_provider` and `model_name` are stored as nullable fields in v0.1 or deferred behind a feature flag.
3. Whether attachment `viewed` and `downloaded` are separate events in first implementation or one `labs.attachment_accessed` event.
4. Exact error codes for rejected file types, oversized files, and attachment-count limit.

## 17. Gate 2 Review Status

Gate 2 is approved for Fielddesk Labs v0.1.

Reason:

- Scope is bounded to IDE -> ANALYSE.
- v0.1 stops at `approved_for_spec`.
- Global-admin-only access model is documented.
- Labs is classified as Platform Tooling outside tenant enablement.
- Data ownership and persistence model are documented as proposed implementation contract.
- Attachment handling decisions are resolved.
- AI input limitations are explicit.
- Critical open question behavior is explicit.
- Audit requirements are documented.
- Future build integration is documented as roadmap only and not part of v0.1.

Gate 2 approval means implementation may be prompted next, but it does not itself implement anything.

## 18. Explicit Non-Scope

Not in v0.1:

- Automatic SPEC generation.
- SPEC editor.
- Build task generation.
- Code-agent calls.
- Sandbox deploy.
- Preview link.
- Review workflow.
- Release workflow.
- Tenant-facing Labs.
- Customer-facing Labs.
- Project-specific Labs.
- Tenant data access.
- Third-party integrations.
- Runtime implementation in this SPEC task.

## 19. Related Docs

- `docs/PROJECT_RULES.md`
- `docs/UI_UX_PRINCIPLES.md`
- `docs/MODULE_MAP.md`
- `docs/CODEX_WORKFLOW.md`
- `docs/AI_GOVERNANCE.md`
- `docs/IMPLEMENTATION_GATES.md`
- `docs/LABS_ANALYSIS_SCHEMA.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY_MODEL.md`
- `docs/DATA_POLICY.md`
- `docs/DECISIONS.md`
