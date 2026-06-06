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
- Deeper module-specific data ownership matrices built on `docs/DATA_POLICY.md`.

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

## 9. Runtime Module Pattern

QA is the current reference for an integrated backend module pattern. Use it as an implementation reference, but keep this section generic for future modules.

Access model:
- Module APIs must use the shared module access service for module permission checks.
- Route visibility, navigation, and frontend state are not authorization.
- Project-owned module APIs must validate tenant, actor, project scope, and module permission before returning or mutating data.
- Module checks should use stable module keys, such as `qa`, and action names that match the module permission model.
- Module access checks must not replace project access checks or tenant isolation.

Tenant route wiring:
- Module routes should be mounted inside the authenticated tenant route surface.
- Tenant host/context middleware should establish tenant context before module route handlers run.
- Route handlers should preserve current 401, 403, and 404 semantics.
- A tenant mismatch should deny access, not silently fall back to another tenant or global scope.
- Project-scoped module routes should resolve project access through backend project context, not through frontend-provided assumptions.

Route, service, and repository responsibilities:
- Routes own HTTP concerns: request parameters, response status codes, lightweight body validation, and calling shared access checks.
- Services own the module use case: transaction boundaries, business validation, tenant/project/actor scoped orchestration, and audit placement.
- Repositories own SQL/data access only: tenant-scoped projections, inserts, updates, and lookups.
- Repositories should not know HTTP semantics, frontend state, or audit policy.
- Services should not hide access-control failures as successful empty responses.

Migration and `schema.sql` sync:
- Module schema changes belong in migrations first.
- `schema.sql` must be kept in sync with migrations when a migration changes tables, indexes, constraints, or allowed enum-like values.
- Runtime code must not depend on a column, table, constraint, or event type until the migration and schema baseline both describe it.
- Local/dev DB drift should be audited before runtime debugging when a runtime error suggests a missing database object.
- A module slice should not fix unrelated schema drift unless that drift blocks the slice and is explicitly called out.

Audit event model and runtime audit:
- New module audit event types must be added to the audit event model before runtime code emits them.
- Event type changes must preserve existing allowed audit event types.
- Runtime success audit belongs in the service layer after the successful mutation it describes.
- Audit writes should share the same transaction flow as the mutation where practical.
- Audit failure must fail the mutation rather than reporting false success.
- Audit metadata should include identifiers and state transitions, not large bodies, secrets, or unnecessary PII.
- Denied/failed audit events are a separate pattern and should not be mixed into a success-audit slice unless the shared auth/middleware contract supports it cleanly.

Endpoint smoke expectations:
- Each backend module slice should have a focused local smoke path before it is treated as runtime green.
- Smoke should cover the primary happy paths and the expected deny paths.
- For project modules, smoke should normally cover list/create/detail/update-style flows plus tenant mismatch, missing token, missing module permission, and project-without-access behavior.
- Smoke should verify that expected failures return safe 401, 403, or 404 responses instead of generic 500 responses.
- Audit-enabled mutations should verify the expected `audit_event` rows without relying on message bodies or broad metadata matching.
- Local smoke test data should be named or otherwise traceable so cleanup can be reviewed separately.

What does not belong in a backend module runtime slice:
- Frontend UI implementation.
- Navigation registry or app shell decisions that are not required by the backend endpoint contract.
- Unrelated DB drift fixes.
- Broad refactors of shared auth, tenant, audit, or project services.
- New integrations, report engines, or storage systems unless the module slice explicitly requires them.
- Cleanup of existing local test data unless the slice is a cleanup slice.

Frontend follow-up:
- Frontend work should attach to a runtime-green backend contract.
- Frontend should consume backend-owned tenant, project, permission, and module state instead of recreating those rules.
- Frontend may hide unavailable actions for usability, but backend authorization remains required.
- Frontend slices should avoid changing module schema, audit model, or backend access semantics unless the backend slice is explicitly reopened.

## 10. What Modules Must Not Do

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

## 11. Restarbejde As First Reference Module

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

## 12. Open Questions

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

## 13. Relevant Docs

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
