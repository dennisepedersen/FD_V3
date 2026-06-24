# FD V3 Security Model

Status: current security overview  
Scope: canonical overview only; implementation details stay in linked docs and code

## 1. Security Principles

Current:
- Tenant isolation first.
- Backend is source of truth for authentication, authorization, tenant scope, RBAC, and audit.
- Frontend must never own access logic.
- No implicit tenant.
- No default tenant.
- No fallback user.
- No fallback allow.
- Global admin is a platform identity, not an implicit tenant user.
- Secrets must never be hardcoded, logged, or returned through APIs.

Planned:
- Least-privilege permission model for all routes and modules.
- Stronger centralized RBAC and module permission enforcement.
- RLS as database defense-in-depth.

Rule for Codex:
- If a change weakens tenant isolation, scope filtering, auth, RBAC, audit, or secret handling, stop and ask before implementing.

## 2. Authentication

Current:
- Tenant users belong to one tenant through `tenant_user.tenant_id`.
- Tenant login uses backend validation and JWT direction from `docs/V3_FOUNDATION_DESIGN.md`.
- JWT claims include actor scope, tenant id, role, subject, issue time, and expiry.
- Tenant access tokens are a temporary session bridge: normal tenant login lasts 8h, and tenant "remember me" login lasts 7d.
- Tenant access tokens are still stored in browser `localStorage` in this temporary PR.
- Tenant resolution happens before tenant login and app access.
- Invitation/onboarding flows create the first tenant admin.

Planned:
- More formal token/session policy for tenant UI.
- Clear refresh/logout/session lifecycle.
- Replace temporary browser token storage with refresh-token/httpOnly cookie renewal, rotation, revocation, and logout invalidation.

Open:
- Final tenant UI session storage model.
- Final token refresh and revocation model.
- Whether support access is ever allowed later. Current phase: no support session.

## 3. Authorization

Current:
- Minimum roles: `global_admin`, `tenant_admin`, `project_leader`, `technician`.
- Role and actor scope are backend concepts.
- Project access is based on `project_assignment` and scope rules.
- Supported scope direction: `mine`, `team`, `tenant`.
- `global_admin` has no implicit tenant-data access.
- Verified current tenant admin model: `tenant_admin` is a tenant administrator with selected module/admin rights, not an automatic tenant-wide superuser for project-owned data.
- Project-owned data still requires explicit project scope unless a route has an explicit tenant-wide capability.
- QA uses both module permission and project/thread scope. Granting `tenant_admin` or `project_leader` `qa:update` does not by itself broaden project scope.
- Calendar / Resource Absence PR2 exposes full absence read/create API only to `tenant_admin`; `project_leader` and `technician` are denied until masked visibility/resource-scope policy exists.

Planned:
- Central permission model with route policy: required scope, allowed roles, required entitlements/module permissions.
- Module permissions separate from user roles.
- Resource group/team scope where modules need team-based access.
- Tenant-wide project/resource access should be implemented later as explicit capabilities, not as hidden role bypasses.

Open:
- Final RBAC matrix.
- Department/resource group model beyond current team/project assignment direction.
- Exact module permission names and enforcement points.
- Final tenant-wide capability matrix, for example `project:read:tenant`, `qa:update:tenant`, and `document:read:tenant`.

### Tenant Admin Hybrid Access Decision

Status: decided direction, no access logic change in this documentation slice.

Verified current model:
- `tenant_admin` has selected tenant/module/admin permissions.
- `tenant_admin` is not automatically allowed to read or mutate all project-owned data.
- Project-owned resources continue to require project scope unless an API explicitly supports tenant-wide access.
- QA status permissions do not change project scope; a tenant admin can have `qa:update` and still be denied a specific QA thread if project/thread scope does not allow access.

Decision:
- Fielddesk uses a hybrid tenant admin model for now.
- `tenant_admin` administers users, integrations, tenant configuration, operations/diagnostics, and module permissions where relevant.
- `tenant_admin` does not receive implicit tenant-wide access to all project-owned data.
- Tenant-wide access must be modeled as explicit capabilities.

Future capability examples:
- `project:read:assigned`
- `project:read:tenant`
- `qa:update:assigned`
- `qa:update:tenant`
- `document:read:project`
- `document:read:tenant`

Not changed now:
- No backend/frontend access checks are changed by this decision.
- No migrations or RLS policy changes are made by this decision.
- Existing QA, project, document, and future module routes must keep enforcing backend-owned tenant/project/resource scope.

## 4. RLS And Tenant Isolation

Current:
- Tenant-owned data must include `tenant_id`.
- Queries must filter by tenant and avoid cross-tenant joins by shape.
- Composite tenant foreign keys are used in schema direction to keep related rows in the same tenant.
- `resource_absences` is tenant-owned Fielddesk data for Calendar / Resource Absence and uses tenant-scoped references to v1 resource identity (`fitter`) and actor users.
- `resource_groups`, `resource_group_members`, and `resource_group_managers` are tenant-owned Fielddesk data for future resource scoping.
- Resource group manager roles (`owner`, `manager`, `viewer`) are scope/administration metadata only. They do not automatically grant absence approval rights.
- Imported E-Komplet group data may be used as later seed/suggestion input, but Fielddesk-owned resource groups are the canonical source once created.
- RLS is not yet fully active as database policy.

Planned:
- RLS for tenant-owned tables as defense-in-depth.
- Tenant-aware indexes on hot paths.
- Standard query/repository patterns that always carry tenant context.

Rule for Codex:
- Never trust `project_id`, `tenant_id`, role, or scope from frontend as authority.
- Backend must derive tenant from verified request context.
- Every tenant-owned query must include tenant filtering.
- If a query cannot prove tenant isolation, mark it `unclear` and stop before changing behavior.

## 5. Audit Logging

Current:
- `audit_event` exists in the foundation model.
- Critical flows should log success, fail, and deny outcomes.
- Audit metadata must not contain secrets.
- Auth and tenant lifecycle flows are audit-sensitive.

Must be audited:
- Login success/fail.
- Invitation and onboarding lifecycle actions.
- Tenant config changes.
- Role/permission changes.
- Sync success/fail.
- Denied support access attempts.
- Module-critical actions once modules are implemented.

Planned:
- Module audit requirements for create/update/delete, status changes, file access, exports, reports, and permission-sensitive actions.
- Backend-owned audit write paths.

Rule:
- Frontend may display audit context, but must not be the audit source of truth.

## 6. File And Storage Security

Current:
- No finalized FD file/storage architecture exists yet.
- Prototype/local browser storage is not production storage.
- File/blob cleanup and future storage needs are recognized in architecture docs.

Planned:
- Tenant/project scoped file metadata in Postgres.
- Binary files in object/blob storage.
- Access through backend-authorized API stream or signed URLs.
- Permission checks for PDF drawings, photos, generated reports, and exports.
- Audit for report/export/file access where relevant.

Rules:
- No permanent base64/dataUrl storage in production.
- No file access based only on guessed URLs.
- No frontend-held storage credentials.

Open:
- Final storage provider.
- Signed URL vs API-stream policy.
- File retention, virus scanning, versioning, and report snapshot policy.

## 7. Integration Security

Current E-Komplet:
- E-Komplet is the primary active integration.
- E-Komplet credentials are tenant-specific.
- Credentials belong in backend configuration/storage only.
- Imported data must be distinguishable from Fielddesk-owned data.

Planned:
- Solar later for product/material features.
- M365/SharePoint/Outlook later for document/mail/calendar workflows where needed.

Rules:
- No integration secrets in frontend.
- No tokens in browser code, docs, logs, or API responses.
- Integrations may enrich Fielddesk, but must not silently define Fielddesk-owned truth.

Open:
- Final Solar secret/config model.
- Final M365 consent/token model.
- Tenant-facing integration management UI and audit rules.

## 8. Module Security Requirements

Current:
- Module governance is started but not complete.
- Restarbejde has a draft module definition.
- QA exists as early backend module code.
- Calendar / Resource Absence has PR2 tenant-admin API foundation. Visibility is prepared through `visibility_scope`, but no UI route, masked non-admin visibility, or full approval policy exists yet.

Every module must define:
- Tenant ownership model.
- Project/resource scope model.
- Roles and module permissions.
- Audit events.
- File/storage needs.
- Export/report permissions.
- Disable/deactivation behavior.
- Whether it can run without E-Komplet.

Restarbejde example:
- Tasks, drawings, locations, photos, and reports must be tenant/project scoped.
- Drawing/PDF/photo/report storage must move away from local/browser storage before production.
- Report exports and file access must be permission-checked and auditable.
- Prototype frontend state must not become production authorization or storage logic.

Calendar / Resource Absence direction:
- Absence records are tenant-isolated and Fielddesk-owned.
- API routes must derive tenant from verified request context and must not accept frontend-supplied tenant authority.
- PR2 create routes derive actor from auth and set v1 status to `approved` server-side.
- Visibility must be enforced in backend policy before non-admin roles can read full absence type/reason.
- Later resource group, manager approval, finance visibility, and unavailable-only views must be explicit capabilities, not frontend-only filtering.
- Audit events for create, update, cancel, approve, reject, and visibility-sensitive access should be added when write routes/actions are introduced.

## 9. Known Gaps

Current gaps:
- RLS is not fully implemented as active database policy.
- RBAC is not yet a complete central permission system.
- Module registry and module permission model are not final.
- File/storage architecture is not final.
- Report/export security architecture is not final.
- Tenant UI session/token storage is still open.
- Some audits are time-sensitive and may be stale.

Open decisions:
- Full RBAC matrix.
- Full RLS policy design.
- Full Calendar / Resource Absence visibility, approval, and audit event matrix.
- File/storage provider and access pattern.
- Support access policy after phase 1.
- Module-specific security contracts.
- Data policy for owned, imported, derived, audit, credential, demo, and file data.

## 10. Relevant Docs

Start here:
- `docs/00_MASTER.md`
- `docs/ARCHITECTURE.md`
- `docs/DOC_INDEX.md`
- `docs/DECISIONS.md`

Foundation/security:
- `docs/V3_FOUNDATION_DESIGN.md`
- `docs/AI_BOOTSTRAP_CONTEXT.md`
- `docs/V3_BUILD_GATECHECK.md`
- `docs/SECRET_HANDLING_RULES.md`
- `V3_AUTH_AND_ONBOARDING_PLAN.md`
- `V3_BACKEND_AUTH_VERIFICATION.md`

Backend standards and decisions:
- `backend/docs/standards/fd_implementation_rules.md`
- `backend/docs/decisions/projects_endpoint_decision.md`
- `backend/docs/decisions/sync_strategy_decision.md`
- `backend/docs/decisions/data_retention_and_filtering_decision.md`

Integrations and mappings:
- `backend/docs/integrations/ek/projects_v4_masterdata.md`
- `backend/docs/integrations/ek/projects_v3_wip.md`
- `backend/docs/integrations/ek/fitterhours.md`
- `backend/docs/mappings/scope_rules.md`

Modules:
- `docs/modules/restarbejde/MODULE_DEFINITION.md`
