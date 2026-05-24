# FD Audit Contract

Status: Draft / Proposed  
Scope: Shared audit/event governance contract for FD modules and platform services  
Last updated: 2026-05-24

This document defines shared Fielddesk direction for audit events, event naming, metadata, retention direction, and module/platform audit responsibilities.

It is governance-light, implementation-light, and platform-oriented. It does not define database schema, event bus implementation, queue implementation, SIEM integration, or API implementation.

## 1. Purpose

The audit contract exists to prevent FD Core, modules, storage, reports, and future platform services from creating isolated audit/event models.

It should guide audit behavior for:

- Restarbejde
- QA
- CO2/ESG
- Documents
- Report engine
- Storage service
- Module registry
- future FD modules and platform services

The contract defines shared audit concepts, ownership, event direction, naming direction, required metadata, tenant/project scope, security relationship, module integration rules, report/storage audit direction, and retention/archive direction.

## 2. Core Principles

Audit trail is backend-owned.

Frontend logs are not authoritative audit truth.

Audit events are append-oriented.

Authorization-sensitive actions should be auditable.

Report/export/download access should be auditable.

Storage access should be auditable.

Audit data is governance/security data, not module-owned business state.

Rules:

- `tenant_id` and actor context should follow audit events.
- `project_id` alone is not sufficient audit scope.
- Audit contracts should remain implementation-neutral.
- Modules should use shared audit naming principles.
- Modules should not invent isolated audit systems.
- Audit metadata must not contain secrets.

## 3. Shared Audit Concepts

Shared terms:

- Audit event: append-oriented record that describes a relevant action, outcome, and scope.
- Actor: user, system, integration, worker, or service that initiated the action.
- Target resource: entity or artifact affected by the action.
- Scope: tenant, project, module, resource, and permission context for the action.
- Outcome: result such as success, failure, denied, skipped, or partial.
- Correlation/request id: identifier connecting audit events to request/job/worker flow where available.
- Source module: module or platform service that emitted or caused the event.
- Derived artifact access: access to reports, exports, crops, previews, generated files, or other derived outputs.
- Retention state: policy state controlling how long audit data is retained or archived.

These concepts should be reused by modules and platform services unless a later governance decision defines a replacement.

## 4. Ownership

FD audit system owns:

- audit trail
- audit event contract
- audit metadata direction
- audit retention/access rules where defined
- backend-owned audit write path where implemented

FD Core owns:

- authentication and actor context
- tenant context
- project access context
- RBAC/module entitlement context

Modules own:

- module-specific event triggers
- module-specific resource names
- optional module metadata extensions
- documentation of module audit requirements

Platform services own:

- service-specific event triggers, for example report, storage, integration, and module registry events

Frontend owns:

- UI telemetry where allowed
- display of audit context where authorized
- client-side debug logs where useful

Frontend does not own:

- authoritative audit truth
- audit write authority
- audit retention
- audit authorization

## 5. Audit Event Direction

Auditable action categories should include:

- create/update/archive/delete of important resources
- status changes
- permission-sensitive actions
- module enablement/disablement
- report/export request, generation, failure, and download
- storage upload, access, access denied, archive, and delete
- auth/security-sensitive actions
- integration sync success/failure where relevant
- administrative configuration changes

Denied access may also be auditable, especially for auth, module, storage, report, and export flows.

Events should be emitted from backend/platform-controlled code paths, not frontend-only logs.

## 6. Event Naming Direction

Naming should be stable, readable, and domain-oriented.

Preferred pattern:

```text
{domain}.{action}
{module}.{resource_action}
```

Examples:

- `restarbejde.task_created`
- `restarbejde.task_archived`
- `report.generated`
- `report.downloaded`
- `storage.object_uploaded`
- `storage.object_access_denied`
- `module.enabled`
- `module.disabled`

Guidelines:

- Use past-tense action names where practical.
- Prefer stable event names over UI wording.
- Avoid embedding tenant/project/user identifiers in event names.
- Use metadata for resource ids and scope, not event name suffixes.
- Module-specific event names should align with shared naming principles.
- Exact event registry/schema is deferred.

## 7. Required Metadata Direction

Minimum metadata direction:

- `tenant_id`
- `actor_id`
- `actor_type`
- `module_key` where relevant
- `event_type`
- `resource_type`
- `resource_id`
- `project_id` if relevant
- `timestamp`
- `outcome`
- `correlation_id` or request id if available

Possible additional metadata:

- permission checked
- scope type
- target module
- storage object id
- report run id
- integration id
- source service
- error code
- denied reason category
- before/after summary where safe

Metadata rules:

- Do not include secrets.
- Avoid excessive sensitive payloads.
- Prefer ids, categories, and summaries over full copied business data.
- Keep enough context to investigate action, actor, scope, resource, and outcome.

## 8. Tenant/Project Scope Direction

Tenant and actor context should follow audit events.

Rules:

- `tenant_id` should be present for tenant-owned actions.
- `actor_id` and `actor_type` should be present where known.
- `project_id` should be included when the action is project-scoped.
- `project_id` alone is not sufficient audit scope.
- Backend-verified context should be used, not frontend-provided authority.
- Cross-tenant audit visibility must be explicitly authorized.
- Global admin/platform events must not imply tenant-data access unless explicitly scoped.

Audit scope should align with `PROJECT_CONTEXT_CONTRACT`, `SECURITY_MODEL.md`, and module contracts.

## 9. Security/Audit Relationship

Audit is part of security governance.

Rules:

- Hidden UI does not mean an action is unaudited.
- Hidden UI does not secure an action.
- Denied access may also be auditable.
- Audit access itself may require authorization.
- Audit logs may contain sensitive metadata.
- Audit metadata must not contain secrets.
- Frontend visibility is not audit coverage.
- Audit should not be bypassed by direct storage/report/module service access.

Security-sensitive flows should define audit expectations before production implementation.

## 10. Module Integration Rules

Modules should not invent isolated audit systems.

Modules may extend audit metadata for domain needs, but should keep shared event naming and required metadata direction.

Rules:

- Module contracts should list required audit events.
- Module APIs should emit audit events from backend-controlled paths.
- Module reports/exports should align with report audit direction.
- Module files should align with storage audit direction.
- Module enablement/visibility should align with module registry audit direction.
- Audit should align with project context and RBAC direction.

Restarbejde, QA, CO2, Documents, and future modules should reuse shared audit principles.

## 11. Report/Storage Audit Direction

Report/export events should include, where relevant:

- `report.requested`
- `report.generated`
- `report.failed`
- `report.downloaded`
- `export.requested`
- `export.generated`
- `export.failed`
- `export.downloaded`

Storage events should include, where relevant:

- `storage.object_uploaded`
- `storage.object_accessed`
- `storage.object_downloaded`
- `storage.object_access_denied`
- `storage.object_archived`
- `storage.object_deleted`

Module registry events should include, where relevant:

- `module.enabled`
- `module.disabled`
- `module.entitlement_changed`

Derived artifact access should be auditable where relevant, especially for generated reports, exports, crops, previews, and sensitive downloads.

## 12. Retention/Archive Direction

Audit events should be append-oriented.

Retention and archive policy are governance/security decisions, not module-owned business decisions.

Direction:

- Audit records should not be casually edited or deleted.
- Archive/expiration behavior should be policy-controlled.
- Hard delete should be exceptional and policy-driven.
- Retention may differ by event category and tenant/legal requirements later.
- Audit access should itself be permission-controlled.

Open:

- Final retention duration.
- Immutable/WORM storage requirements.
- Privacy/redaction strategy.
- Audit export policy.

## 13. Extensibility

Future audit capabilities may include:

- SIEM integration
- realtime audit streaming
- alerting
- audit dashboards
- compliance exports
- anomaly detection
- audit analytics pipelines
- security incident workflows
- tenant admin audit views
- module-specific audit views
- automated policy checks

These are not implemented by this contract.

## 14. Deferred Decisions

Not decided in this contract:

- audit database/storage engine
- event schema
- event bus implementation
- SIEM integration
- realtime streaming
- retention duration
- immutable/WORM storage
- privacy/redaction strategy
- audit export policy
- alerting
- analytics pipelines
- audit reader access model
- event registry ownership
- before/after diff policy
- audit sampling/noise reduction strategy

Do not assume these are solved until a current governance or implementation document says so.

## 15. Risks

Known risks:

- inconsistent event naming
- missing tenant scope
- missing actor context
- unaudited exports/downloads
- unaudited denied access
- frontend-only logs being treated as audit truth
- excessive sensitive metadata
- secrets accidentally written to audit metadata
- event duplication
- module-specific audit drift
- retention/legal conflicts
- audit logs becoming too noisy to use
- audit access becoming under-secured
- derived artifact access not being tracked

## Relevant Docs

- `docs/00_MASTER.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY_MODEL.md`
- `docs/MODULE_CONTRACT.md`
- `docs/AI_GOVERNANCE.md`
- `docs/PROJECT_CONTEXT_CONTRACT.md`
- `docs/REPORT_ENGINE_CONTRACT.md`
- `docs/STORAGE_CONTRACT.md`
- `docs/MODULE_REGISTRY_CONTRACT.md`
- `docs/modules/restarbejde/BACKEND_MODULE_CONTRACT.md`
