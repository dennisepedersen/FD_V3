# FD V3 Module Contract

Status: current module governance contract  
Scope: minimum requirements for FD modules; no implementation by itself

## 1. What An FD Module Is

Current:
- FD core platform owns tenant, auth, RBAC, audit, project foundation, sync foundation, and shared backend rules.
- A module is a bounded product area built on top of core platform rules.
- A module may have its own UI, routes, data, reports, files, and workflows.

Module examples:
- Restarbejde.
- QA.
- CO2/ESG.
- Economy/finance.
- Planning, documents, reports, intelligence.

Prototype vs FD module:
- A prototype may prove workflow, UX, and domain concepts outside FD.
- A real FD module must use FD tenant, project, RBAC, audit, storage, routing, and data contracts.
- Prototype storage, local auth assumptions, standalone app shells, and demo state are not production architecture.

## 2. Minimum Requirements For FD Modules

Every FD module must define:
- Purpose and owner.
- Tenant awareness.
- Project awareness, if project data is involved.
- RBAC compatibility.
- Audit compatibility.
- Report/export compatibility.
- Attachment/file compatibility, if files are involved.
- Module routes.
- Module navigation placement.
- Data ownership: Fielddesk-owned, imported, derived, audit, credential/config, demo, or file data.
- Required timestamps.
- `created_by` / `updated_by` where user changes are stored.
- Soft delete/archive strategy where deletion matters.
- Disable/deactivation behavior.
- Whether the module can run without E-Komplet.

Planned:
- A formal module registry and feature/module enablement model.
- Shared module permission naming.

Open:
- Final module registry format.
- Final module dependency model.

## 3. Data Rules

Current:
- Tenant-owned module data must include `tenant_id`.
- Project-owned module data must include `project_id` and reference FD project identity.
- Backend is source of truth for persisted module data.
- Frontend must not be the only owner of security, scope, or state.

Rules:
- No cross-tenant data leakage.
- No tenant or project authority from frontend alone.
- No module-owned duplicate of core entities such as tenant, tenant_user, project_core, or project_assignment.
- Use backend-verified tenant and actor context for writes and reads.
- Preserve evidence level when documenting data behavior: verified, observed, hypothesis, unclear.

Planned:
- RLS as defense-in-depth for tenant-owned module tables.
- Module data ownership in `DATA_POLICY.md` later.

## 4. UI And UX Rules

Current:
- Frontend must render allowed data, not decide permissions.
- Current UI surfaces are static backend-served pages, while final app shell is still open.

Module UI should be:
- Mobile-first where workflows are field-facing.
- Compact and operational, not marketing-style.
- Compatible with a shared FD shell.
- Compatible with drawer/detail flows where useful.
- Compatible with dashboard summaries/KPIs.
- Ready for future light/dark theme direction, without hardcoding brittle colors.

Planned:
- Shared FD app shell.
- Navigation driven by tenant features, backend permissions, and module enablement.

Open:
- Final frontend framework and shell.
- Final navigation registry.

## 5. Report And Export Rules

Current:
- Reports/exports are audit-sensitive because they can contain tenant/project data.
- No canonical shared report service exists yet.

Module requirements:
- Define what can be exported.
- Define who can export.
- Define whether exports are project-level, tenant-level, or user-scope limited.
- Report/export actions must be permission-checked in backend.
- Report/export actions should be auditable.
- Reports using images, PDFs, drawings, or attachments must respect file permissions.

Planned:
- Shared report/export strategy.
- Report archive/storage policy where needed.

Open:
- Client-side vs server-side report rendering per module.
- Tenant branding strategy.
- Shared export formats and retention rules.

## 6. File And Storage Rules

Current:
- Final FD file/storage architecture is not yet defined.
- Prototype modules may use local/browser storage only as temporary proof of concept.

Rules:
- No permanent `dataUrl` or base64 file storage in production.
- No frontend-held storage credentials.
- No file access based only on guessed or public URLs.
- File metadata must be tenant-scoped and project/task/resource-scoped where relevant.
- Binary storage should be abstracted behind FD storage rules.

Planned:
- Object/blob storage for files.
- Backend-authorized API streaming or signed URLs.
- Audit for sensitive downloads, reports, exports, and file access.

Open:
- Final storage provider.
- Signed URL vs API-stream policy.
- File retention, scanning, versioning, and snapshot strategy.

## 7. Integration Rules

Current:
- E-Komplet is the primary active integration.
- E-Komplet may enrich FD data, but must not silently own FD state.
- Integration credentials are backend-only.

Rules:
- Integrations must not bypass FD tenant, project, RBAC, audit, or data ownership rules.
- Integration data must be marked as imported or derived when relevant.
- Frontend must never know client secrets, API keys, refresh tokens, or integration credentials.
- A module must define whether an integration is required, optional, or future-only.

Planned:
- Solar integration for product/material-related features later.
- M365 integration for document/mail/calendar workflows later.

Open:
- Final integration config UI and audit model.
- Final Solar and M365 security models.

## 8. Module Lifecycle

Prototype:
- May live outside FD.
- May use local/demo storage.
- Proves UX and domain behavior.
- Must not be treated as production architecture.

MVP:
- Has documented scope and core workflows.
- Has known limitations listed.
- May still miss some platform integrations if explicitly accepted.

Integrated module:
- Uses FD auth, tenant, project, RBAC, audit, storage, routing, and navigation contracts.
- Has backend API/data contract before UI is treated as real.
- Has module definition and migration notes.

Production-ready:
- Has tested tenant isolation.
- Has permission model and audit events.
- Has file/storage/report strategy if needed.
- Has operational failure behavior.
- Has docs updated with implementation reality.

## 9. What Modules Must Not Do

FD modules must not:
- Hardcode tenant, user, project, or environment logic.
- Bypass RBAC or scope checks.
- Implement their own auth system.
- Treat ERP/E-Komplet/Solar data as FD-owned truth without a decision.
- Use localStorage, base64, or dataUrl as permanent storage.
- Duplicate core entities like tenants, users, projects, teams, or assignments.
- Make frontend-only security decisions.
- Hide missing backend policy behind UI visibility.
- Create reports/exports without permission and audit planning.
- Add schema/migrations without documented data need.

## 10. Restarbejde As First Reference Module

Current:
- Restarbejde exists as a module definition draft in `docs/modules/restarbejde/MODULE_DEFINITION.md`.
- The prototype lives outside FD and is useful as workflow/domain reference.

How it fits this contract:
- Tasks, OBS points, drawings, locations, photos, crops, and reports must become tenant/project scoped before production.
- Placement/PDF/report concepts can be reused as domain behavior.
- LocalStorage, standalone shell, frontend-owned scope, and dataUrl photo/drawing storage are prototype-only.
- Reports, drawing crops, file access, and exports must be RBAC-checked and auditable.
- Restarbejde should integrate through FD project context, module navigation, backend APIs, and storage contracts.

Open:
- Restarbejde backend schema.
- Restarbejde RBAC matrix.
- Restarbejde storage/report strategy.
- Restarbejde migration plan.

## 11. Open Questions

Open:
- Module registry format.
- Plugin/module loading system.
- Tenant feature flags and entitlements.
- Module enable/disable lifecycle.
- Module dependency declarations.
- Shared module navigation API.
- Shared report/export service.
- Shared file/storage service.
- How modules declare whether they require E-Komplet.

Do not assume these are solved until a current doc says so.

## 12. Relevant Docs

Start here:
- `docs/00_MASTER.md`
- `docs/DOC_INDEX.md`
- `docs/DECISIONS.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY_MODEL.md`

Foundation:
- `docs/V3_FOUNDATION_DESIGN.md`
- `docs/AI_BOOTSTRAP_CONTEXT.md`
- `docs/V3_BUILD_GATECHECK.md`

Backend standards:
- `backend/docs/standards/fd_implementation_rules.md`

Module docs:
- `docs/modules/restarbejde/MODULE_DEFINITION.md`

Security and secrets:
- `docs/SECRET_HANDLING_RULES.md`
