# FD Module Registry Contract

Status: Draft / Proposed  
Scope: Platform governance contract for module registration, enablement, discovery, and exposure  
Last updated: 2026-05-24

This document defines how Fielddesk registers, enables, disables, discovers, and exposes modules at platform level.

It is governance-light, implementation-light, and platform-oriented. It does not define frontend framework implementation, plugin runtime, dynamic loading mechanics, database migrations, or API route implementation.

## 1. Purpose

The module registry contract exists to keep FD modules consistent as the platform grows.

It should guide modules such as:

- Restarbejde
- QA
- CO2/ESG
- Economy/finance
- Documents
- future FD modules

The contract defines shared module identity, lifecycle, ownership, enablement, discovery, security direction, report/export integration, audit direction, and extensibility principles.

## 2. Core Principles

FD Core owns the module registry.

Modules are platform extensions, not standalone apps.

Modules consume shared FD contracts.

Modules must not redefine auth, tenant, or project identity.

Module metadata is backend-owned.

Frontend may render registry state, but must not own it.

Rules:

- Module visibility is not authorization.
- Module navigation is discovery, not security.
- Module enablement must be tenant-aware.
- Entitlements are backend-owned.
- Disabled modules must not destroy existing data.
- Modules must follow FD security, project context, report/export, audit, and storage direction.

## 3. Shared Module Concepts

Shared terms:

- Module id: stable internal identifier for a module registration.
- Module key: stable human-readable/system key such as `restarbejde`, `qa`, `co2`, `economy`, or `documents`.
- Module display name: user-facing name.
- Module version: version or compatibility marker for module metadata and capabilities.
- Module status: lifecycle state such as registered, enabled, disabled, deprecated, or archived.
- Enabled/disabled: whether a module is available in a tenant/project context.
- Tenant entitlement: backend-owned right for a tenant to use a module or capability.
- Module capabilities: declared features such as tasks, reports, KPIs, files, dashboards, or exports.
- Module routes: backend/frontend route declarations or route references, not authorization by themselves.
- Module navigation: entries exposed for UI discovery.
- Module badges/KPIs: module-owned summaries shown in shared surfaces.
- Module report providers: module-provided report templates, adapters, or export definitions.

These concepts should be reused by modules unless a later governance decision introduces a replacement.

## 4. Module Identity

A module should have stable identity metadata.

Expected identity fields may include:

- `module_id`
- `module_key`
- `display_name`
- `description`
- `version`
- `status`
- `owner`
- `capabilities`
- `dependencies`
- `created_at`
- `updated_at`

Rules:

- `module_key` should be stable and not localized.
- Display names may be localized later.
- Modules must not duplicate core entities such as tenant, user, auth, or project identity.
- Module identity must be backend-owned.
- Frontend may render module identity but must not define it as truth.

Example module keys:

- `restarbejde`
- `qa`
- `co2`
- `economy`
- `documents`
- `planning`

## 5. Module Lifecycle

Shared lifecycle direction:

- `registered`: module exists in FD registry but may not be enabled for tenants.
- `enabled`: module is available for a tenant or allowed scope.
- `disabled`: module is not available for normal use in a tenant or scope.
- `deprecated`: module is still present but should not be expanded or newly adopted.
- `archived`: module is no longer active, but historical data/policy may remain.

Rules:

- Disabled modules must not destroy existing data.
- Disablement should normally deny writes and hide navigation.
- Authorized admin/export flows may still access retained data if policy requires it.
- Deprecation and archival behavior must be explicit before production use.
- Lifecycle state must not be frontend-only.

## 6. Module Ownership

FD Core owns:

- module registry
- module identity metadata
- tenant enablement/entitlement state
- platform contracts
- shared permission and navigation direction
- module lifecycle rules

Modules own:

- module-specific domain data
- module-specific capabilities
- module-specific route contracts
- module-specific reports/exports where approved
- module-specific KPIs, badges, and summaries

Frontend owns:

- presentation of registry state
- selected navigation state
- module UI state
- temporary display/cache state

Frontend does not own:

- module registry truth
- module enablement truth
- module entitlement truth
- module authorization truth

## 7. Tenant Enablement / Entitlements

Module enablement must be tenant-aware.

Entitlements are backend-owned.

Visibility does not equal authorization.

Direction:

- A tenant may be entitled to a module.
- A module may be enabled or disabled for a tenant.
- A future decision may allow project-level module enablement.
- Entitlement and enablement should be checked by backend for module APIs and sensitive surfaces.
- Module capability availability may depend on tenant plan, feature flags, permissions, or integration readiness later.

Rules:

- Frontend must not decide whether a tenant is entitled to a module.
- Hidden module navigation is not security.
- Disabled module APIs should deny writes unless a policy explicitly allows admin/export access.
- Existing module data should remain retained according to data retention policy.

## 8. Navigation / Discovery Direction

Modules may expose discovery metadata such as:

- navigation entries
- project tabs/sections
- dashboard widgets
- KPI cards
- badges
- project summary cards
- report/export entries
- settings entries

Navigation is discovery, not security.

Rules:

- Navigation should be driven by backend-owned registry, entitlements, permissions, and project context.
- Frontend may render navigation entries returned by backend context.
- Frontend hiding a route does not secure the route.
- Backend route authorization remains required.
- Modules should not create shadow navigation systems that bypass FD registry direction.

## 9. Project Context Integration

Modules should consume `PROJECT_CONTEXT_CONTRACT`.

Rules:

- Modules should use shared FD project context.
- Modules must not create shadow project models.
- Modules must not redefine project identity.
- Modules must not trust `project_id` alone.
- Modules must not implicitly resolve tenant.
- Module availability may depend on tenant, project, actor scope, module entitlement, and module permissions.

Module summaries, KPIs, or badges may be shown in project context, but they must remain module-owned contributions and must not mutate core project identity.

## 10. Security Direction

Security direction:

- Tenant-aware module enablement.
- RBAC plus module entitlements.
- Hidden route does not equal secure route.
- Backend authorization is required.
- Module APIs must validate tenant access.
- Module APIs must validate project access where project data is involved.
- Module APIs must validate required module permission.
- Module APIs must validate module enablement/entitlement where relevant.

Rules:

- Modules must not redefine auth, tenant, or project identity.
- Modules must not bypass FD Core security.
- Frontend must not become source of truth for module authorization.
- Module route access must be secured even if navigation is hidden.
- `tenant_id + actor + module entitlement + RBAC + project scope` should be considered together where relevant.

## 11. Report / Export Integration

Modules should use shared report/export principles.

Direction:

- Modules should align with `REPORT_ENGINE_CONTRACT`.
- Modules may provide report providers, templates, sections, data adapters, or export schemas.
- Shared rendering/export pipeline should be preferred where possible.
- Report/export actions should be permission-checked and auditable.
- Branding, headers, footers, generated-at metadata, page numbering, and tenant identity should be centralized later where practical.

Rules:

- Modules should not build isolated report engines as production architecture.
- Module exports must not bypass tenant/project/module permissions.
- Module reports should use module-owned data plus approved FD project context.

## 12. Audit Direction

Audit direction:

- Module lifecycle changes should be auditable.
- Module enablement/disablement should be auditable.
- Permission-sensitive module actions should be auditable.
- Report/export actions should be auditable.
- File access should be auditable where relevant.
- Admin-level module configuration changes should be auditable.

Possible audit events may include:

- `module.registered`
- `module.enabled`
- `module.disabled`
- `module.deprecated`
- `module.archived`
- `module.entitlement_changed`
- `module.capability_changed`

Exact event names are deferred.

## 13. Extensibility

Future extension points may include:

- dashboard widgets
- KPI providers
- report providers
- project summary cards
- notifications
- health indicators
- module settings panels
- file/attachment providers
- search providers
- future AI integrations

Rules:

- Extension points should consume shared FD contracts.
- Extension points must respect tenant, RBAC, project scope, and module entitlement.
- Extension points should be backend-described where they affect security or availability.
- Frontend may render extension points but must not define entitlement or authorization.

## 14. Deferred Decisions

Not decided in this contract:

- dynamic module loading
- plugin runtime
- marketplace/app store
- hot enable/disable behavior
- module version compatibility rules
- per-project module enablement
- feature flags
- dependency graph between modules
- module capability schema
- module navigation registry shape
- module settings registry
- cross-module dependencies
- billing/plan entitlement model
- module health model
- module registry database schema

Do not assume these are solved until a current governance or implementation document says so.

## 15. Risks

Known risks:

- module spaghetti
- duplicated module infrastructure
- hidden auth assumptions
- frontend-owned registry state
- tenant leakage through incomplete module enablement checks
- modules bypassing shared contracts
- incompatible report systems
- shadow navigation systems
- modules redefining project identity
- module routes treated as secure because they are hidden
- disabled modules accidentally destroying or hiding retained data
- unclear dependency behavior between modules
- registry becoming too implementation-specific too early

## Relevant Docs

- `docs/00_MASTER.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY_MODEL.md`
- `docs/MODULE_CONTRACT.md`
- `docs/AI_GOVERNANCE.md`
- `docs/PROJECT_CONTEXT_CONTRACT.md`
- `docs/REPORT_ENGINE_CONTRACT.md`
- `docs/modules/restarbejde/BACKEND_MODULE_CONTRACT.md`
