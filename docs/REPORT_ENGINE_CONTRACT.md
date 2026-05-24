# FD Report Engine Contract

Status: Draft / Proposed  
Scope: Shared report/export governance contract for FD modules  
Last updated: 2026-05-24

This document defines shared Fielddesk direction for reports, exports, and generated artifacts across current and future modules.

It is governance-light and implementation-light. It does not define React code, Node handlers, database migrations, queue implementation, storage provider, or rendering engine choice.

## 1. Purpose

The report engine contract exists to prevent every FD module from building its own isolated report/export architecture.

It should guide report and export behavior for:

- Restarbejde
- CO2/ESG
- QA
- Economy/finance
- Dashboard/KPI exports
- future FD modules

The contract defines shared report concepts, ownership boundaries, lifecycle, security direction, storage direction, and module integration principles.

## 2. Core Principle

FD owns report orchestration.

Modules own source domain data.

Report engine owns the rendering/export pipeline.

Storage service owns binary outputs.

Audit system owns the audit trail.

Frontend owns preview, filter, and modal state only.

Rules:

- Frontend must not own report truth.
- Generated report/export output is derived output, not primary truth.
- Reports and exports must not bypass tenant, project, module permission, storage, or audit rules.
- Modules should not create isolated report engines unless a later explicit decision allows it.

## 3. Shared Report Concepts

Shared terms:

- Report request: the user/system intent to generate a report or export.
- Report run: the tracked execution of a report request.
- Report template: the structure/layout definition used for rendering.
- Report output: the generated user-facing result such as PDF, CSV, Excel, or image bundle.
- Report artifact: the stored binary or metadata artifact created by a report run.
- Export job: a report-like run focused on exporting structured data.
- Report metadata: tenant, project, module, actor, source scope, filters, template version, status, timestamps, and storage references.
- Source snapshot: optional metadata describing which source data scope/version was used.
- Generated file: binary output stored through FD storage rules.

These terms should be reused by modules unless a module-specific contract defines a reason to diverge.

## 4. Ownership

Modules own:

- source domain data
- module-specific report sections
- module-specific data adapters
- module-specific validation of what can be reported
- module-owned KPIs or summaries included in reports

Report engine owns:

- report orchestration
- rendering/export pipeline
- template execution
- output generation
- report lifecycle state
- report metadata contract where shared

Storage service owns:

- binary PDFs
- CSV/Excel files
- generated images
- report artifacts
- storage references and access mechanics

Audit system owns:

- report request trail
- generation success/failure trail
- download/access trail
- export trail

Frontend owns:

- preview state
- selected filters before submission
- modal state
- presentation state
- temporary client-side UI state

Frontend does not own:

- report truth
- generated output truth
- access decisions
- audit trail
- storage authorization

## 5. Report Lifecycle

Shared lifecycle direction:

- `requested`: a user/system requested a report or export.
- `queued`: the run is waiting for processing.
- `generating`: the run is actively generating output.
- `generated`: output was created successfully.
- `failed`: generation failed.
- `archived`: output or metadata was archived according to policy.
- `expired`: output is no longer available according to retention policy.

Early implementations may collapse some states if safe, but the contract should remain async-capable and lifecycle-aware.

## 6. Output Principles

PDF/export output is derived output.

Binary output is not primary truth.

Reports should be regenerable where possible.

Rules:

- Source domain data remains owned by the module or FD core.
- Generated report files should link back to source scope through metadata.
- Crops, previews, screenshots, and rendered tables are derived artifacts.
- Report metadata should include enough context to understand tenant, project, module, actor, filters, template, and generation time.
- Stored artifacts may be retained for audit, legal, or UX reasons, but they do not replace source data.
- If exact regeneration is required, source snapshot/version rules must be explicitly defined.

## 7. Async Direction

Report generation should be async-capable.

Frontend should not block on heavy rendering.

Early implementations may be synchronous if safe and explicitly scoped.

The contract must not lock the final implementation strategy.

Direction:

- Small exports may be generated immediately if safe.
- Heavy reports should be queue/background-worker ready.
- Frontend should be able to show requested/generating/generated/failed states.
- Modules should avoid UI-only long-running report generation as a platform pattern.
- The report engine should be able to evolve toward background workers or distributed rendering later.

## 8. Storage Direction

Reports and exports should be stored as storage objects where persistence is required.

Storage metadata should be tenant-aware and project/module-aware where relevant.

Rules:

- Storage paths and filenames are not authorization.
- Storage authorization must be enforced by backend/FD core.
- Report access may use API streaming or signed URLs later.
- Storage paths are organizational paths only.
- Binary output should not be stored as permanent base64/dataUrl in module tables.
- Retention and expiration policy are deferred decisions.

Possible organizational path shape:

```text
reports/{tenantId}/{projectId}/{moduleKey}/{reportRunId}/output.pdf
exports/{tenantId}/{projectId}/{moduleKey}/{exportRunId}/output.csv
```

Exact path format and storage provider are deferred.

## 9. Security And Audit

Report access must be checked by tenant, project, module permissions, and report/export permissions.

`project_id` alone is not a security boundary.

Paths, filenames, slugs, and URLs are not authorization.

Security rules:

- Backend must verify authenticated tenant context.
- Backend must verify project access where reports are project-scoped.
- Backend must verify module entitlement and module permission.
- Backend must verify report/export permission.
- Generated outputs may contain sensitive tenant/project data.
- Frontend visibility must not be treated as access control.

Audit direction:

- Report requests should be auditable.
- Report generation success/failure should be auditable.
- Report downloads/access should be auditable where relevant.
- Export requests/generation/downloads should be auditable.
- Audit metadata must not contain secrets.

Example event names may follow module/shared conventions such as:

- `report.requested`
- `report.generated`
- `report.failed`
- `report.downloaded`
- `export.requested`
- `export.generated`
- `export.failed`
- `export.downloaded`

Module-specific events may prefix these if needed.

## 10. Module Integration Rules

Modules should not build isolated report engines.

Modules may provide:

- report templates
- report sections
- data adapters
- validation rules
- module-specific table/summary/crop components
- module-specific export schemas

Shared rendering pipeline should be preferred.

Branding, header, footer, page numbering, tenant identity, generation metadata, and common layout conventions should be centralized later.

Rules:

- Module reports should use FD project context, not raw ERP context as the primary project source.
- Module reports should use module-owned source data plus approved FD context.
- Modules should declare report/export permissions.
- Modules should declare whether output is project-level, tenant-level, or actor-scope limited.
- Modules should avoid direct frontend-only PDF/export pipelines as production architecture.

## 11. Extensibility

Possible future report/export capabilities:

- PDF reports
- CSV exports
- Excel exports
- dashboard/KPI exports
- scheduled reports
- email delivery
- report snapshots
- signed sharing links
- image rendering services
- server-side rendering
- localization
- tenant branding
- watermarks
- report template registry
- report versioning
- report preview pipeline
- background rendering workers

These are not implemented by this contract.

## 12. Deferred Decisions

Not decided in this contract:

- rendering engine choice
- headless browser vs library rendering
- queue system
- background worker model
- caching strategy
- report deduplication
- watermarking
- distributed rendering
- PDF/A compliance
- final report storage provider
- signed URL vs API streaming policy
- report retention period
- report template versioning
- report artifact immutability
- tenant branding model
- localization strategy
- scheduled report permissions
- email delivery and recipient authorization

Do not assume these are solved until a current governance or implementation document says so.

## 13. Risks

Known risks:

- multiple PDF engines across modules
- memory-heavy rendering
- stale snapshots treated as current truth
- security leakage via exports
- oversized reports
- frontend-driven rendering drift
- report version mismatch
- inconsistent branding/header/footer behavior
- unaudited downloads
- module-specific report code bypassing shared storage/security
- reports depending on stale or optional enrichment data
- file paths or filenames accidentally treated as authorization
- report generation blocking frontend flows

## Relevant Docs

- `docs/00_MASTER.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY_MODEL.md`
- `docs/MODULE_CONTRACT.md`
- `docs/AI_GOVERNANCE.md`
- `docs/PROJECT_CONTEXT_CONTRACT.md`
- `docs/modules/restarbejde/BACKEND_MODULE_CONTRACT.md`
