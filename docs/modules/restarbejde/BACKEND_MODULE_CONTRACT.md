# Restarbejde Backend Module Contract

Status: Draft / Proposed  
Scope: Backend and module contract only  
Last updated: 2026-05-23

This document defines how Restarbejde should become a real Fielddesk V3 module without carrying prototype/localStorage architecture into production.

It does not implement backend code, migrations, API routes, storage, report rendering, or frontend migration.

## 1. Purpose

The backend/module contract exists to make Restarbejde compatible with FD V3 governance before implementation starts.

It must ensure:

- backend-owned task truth
- tenant and project scope on all module-owned data
- RBAC-compatible actions
- audit-compatible state changes and exports
- secure file/storage boundaries
- clear separation between prototype UX and production architecture

This document is a proposed contract. It should guide future migrations and API design, but it is not itself an implementation decision for exact schema syntax, route handlers, or storage provider.

## 2. Scope

Included in this contract:

- internal tasks / interne mangler
- OBS points
- task placements on drawings/PDFs/images
- drawings and PDF drawing files
- task photos / attachments
- report runs
- CSV/PDF exports
- proposed trade settings / colors

Out of scope for this contract:

- backend implementation
- database migrations
- frontend migration
- report renderer implementation
- offline sync
- realtime collaboration
- AI-assisted detection
- final storage backend choice

## 3. Domain Language

Use `placement` for task marks on drawings, PDF pages, and images.

Avoid using `location` for this concept in new backend/API design, because location can be confused with address, site, project area, or GPS.

Preferred terms:

- task placement
- primary placement
- drawing placement
- PDF page placement
- placement coordinates

A placement is persisted as page number plus percentage coordinates relative to the rendered drawing/PDF page/image surface.

Crop images are not placements. Crop data is derived report output.

## 4. State Ownership

Current direction:

- FD core owns tenants, authentication, users, project masterdata, and platform permissions.
- Restarbejde backend owns Restarbejde task truth, placements, drawing metadata, photo metadata, report runs, and module-owned settings.
- Frontend owns presentation state only, for example zoom, pan, selected modal, selected task, temporary form state, and viewer state.
- Storage service owns binary files such as drawings, photos, and generated reports.
- Report engine owns derived report output, including drawing crops rendered for a report.
- Integration layer enriches projects with ERP/WIP context but does not own Restarbejde state.

Frontend-owned localStorage, dataUrl files, and client-only task state must not become production architecture.

## 5. Proposed Database Tables

### 5.1 `restarbejde_tasks`

Purpose:
Stores both internal tasks and OBS points as module-owned task records.

Important design rule:
Use a domain discriminator field such as `type` with values like `internal` and `obs`.

Internal tasks and OBS points must not be mixed uncontrolled. Fields that only apply to one type should be validated by backend rules and, where practical, database constraints.

Status flows may later diverge per task type.

Key fields:

- `id`
- `tenant_id`
- `project_id`
- `type` (`internal`, `obs`)
- `title`
- `description`
- `trade_key`
- `status`
- `priority` for internal tasks if applicable
- `risk` for OBS points if applicable
- `responsible_user_id`
- `responsible_text`
- `deadline`
- `percent_complete`
- `external_party`
- `comment`
- `created_at`
- `updated_at`
- `created_by`
- `updated_by`
- `archived_at`
- `archived_by`

Tenant/project requirements:

- `tenant_id` is required.
- `project_id` is required.
- Backend queries must filter by both `tenant_id` and `project_id`.
- `project_id` alone is not sufficient for authorization or isolation.

Soft delete/archive:

- Normal delete must be understood as archive/soft delete for normal user actions.
- Hard delete may only happen through admin/retention policy if a later decision allows it.

### 5.2 `restarbejde_task_placements`

Purpose:
Stores task placements on drawings, PDF pages, or images.

Key fields:

- `id`
- `tenant_id`
- `project_id`
- `task_id`
- `drawing_id`
- `page_number`
- `x_percent`
- `y_percent`
- `is_primary`
- `created_at`
- `updated_at`
- `created_by`
- `updated_by`
- `removed_at`
- `removed_by`

Rules:

- Current product rule is one primary placement per task.
- The model may allow historical or future multi-placement support, but UI/API should treat one active primary placement as canonical for now.
- Only active placements should be shown in standard task views and reports.
- For PDF drawings, `page_number` is 1-based.
- For image drawings, `page_number` should normally be `1`.

Tenant/project requirements:

- `tenant_id` and `project_id` are required.
- Placement must belong to a task and drawing in the same tenant/project.

Soft delete/archive:

- Removing a placement should mark it removed/archived so audit history is preserved.
- Hard delete may only happen through admin/retention policy if a later decision allows it.

### 5.3 `restarbejde_drawings`

Purpose:
Stores drawing metadata and links to storage-managed drawing files.

Key fields:

- `id`
- `tenant_id`
- `project_id`
- `storage_object_id` or `file_id`
- `name`
- `mime_type`
- `page_count`
- `version`
- `source`
- `created_at`
- `created_by`
- `archived_at`
- `archived_by`

Rules:

- Binary drawing files are stored in the storage service, not in this table.
- Drawings should be version-ready even if first implementation only supports one active version.
- Archiving a drawing must not silently destroy placement history.

Tenant/project requirements:

- `tenant_id` and `project_id` are required.

Soft delete/archive:

- Normal delete must be understood as archive/soft delete.
- Hard delete may only happen through admin/retention policy if a later decision allows it.

### 5.4 `restarbejde_task_photos`

Purpose:
Stores metadata for photos attached to Restarbejde tasks.

Key fields:

- `id`
- `tenant_id`
- `project_id`
- `task_id`
- `storage_object_id` or `file_id`
- `file_name`
- `mime_type`
- `size_bytes`
- `caption`
- `created_at`
- `created_by`
- `updated_at`
- `updated_by`
- `archived_at`
- `archived_by`

Rules:

- No permanent dataUrl/base64 storage in production.
- Photo binaries belong in the storage service.
- Photos must only be visible within the owning tenant/project scope.

Tenant/project requirements:

- `tenant_id` and `project_id` are required.
- Photo must belong to a task in the same tenant/project.

Soft delete/archive:

- Removing a photo should archive the metadata and revoke or archive storage access where appropriate.
- Hard delete may only happen through admin/retention policy if a later decision allows it.

### 5.5 `restarbejde_report_runs`

Purpose:
Tracks report/export generation requests, outputs, and audit-relevant metadata.

Key fields:

- `id`
- `tenant_id`
- `project_id`
- `requested_by`
- `report_type`
- `format` (`pdf`, `csv`)
- `status` (`requested`, `running`, `completed`, `failed`)
- `filters_json`
- `source_snapshot_json` or `metadata_json`
- `storage_object_id` or `file_id`
- `generated_at`
- `error_code`
- `error_message`
- `created_at`

Rules:

- Report generation should be async-capable.
- The contract should not lock whether first implementation is synchronous or asynchronous.
- Report outputs are derived artifacts, not task truth.
- Report runs should be auditable.

Tenant/project requirements:

- `tenant_id` and `project_id` are required.

Retention/archive:

- Retention policy is open and should align with FD file/data policy.

### 5.6 `restarbejde_trade_settings` - Proposed / Unresolved

Purpose:
Possible table for Restarbejde trade labels, colors, and active/inactive flags.

Status:
Proposed / unresolved.

Open ownership question:
Trade and color settings may belong to one of several domains:

- Restarbejde-domain data
- tenant UI configuration
- shared FD configuration
- project-specific module settings

Do not treat this as a final schema decision yet.

Possible fields if adopted:

- `id`
- `tenant_id`
- `project_id` nullable depending on ownership decision
- `trade_key`
- `label`
- `color`
- `active`
- `created_at`
- `updated_at`
- `created_by`
- `updated_by`

Rules if adopted:

- No two active trades in the same effective scope should use confusingly similar colors.
- Exact contrast/color-distance rules are unresolved.

### 5.7 RLS And Tenant-FK Direction

All Restarbejde-owned tables should be designed for future RLS as defense-in-depth.

Schema direction:

- Use tenant-aware indexes for tenant/project filtered hot paths.
- Use composite tenant/project foreign-key patterns where practical, so child rows cannot reference parent rows from another tenant.
- `project_id` alone must never be an authorization boundary.
- Backend queries must carry authenticated tenant context, not tenant/project authority from frontend input alone.

## 6. API Contract

Preferred route style:

`/api/projects/:projectId/restarbejde/...`

All endpoints must resolve tenant from authenticated context and validate project access within that tenant.

Every endpoint must check:

- authenticated tenant context
- project access
- module enablement/entitlement
- required Restarbejde permission

`projectId` must never be trusted without tenant scope.

### 6.1 Tasks

| Method/path | Purpose | Permission | Audit event |
| --- | --- | --- | --- |
| `GET /api/projects/:projectId/restarbejde/tasks` | List tasks | `restarbejde:read` | Optional read audit / metrics |
| `POST /api/projects/:projectId/restarbejde/tasks` | Create task | `restarbejde:create` | `restarbejde.task_created` |
| `PATCH /api/projects/:projectId/restarbejde/tasks/:taskId` | Update task fields | `restarbejde:update` | `restarbejde.task_updated` |
| `PATCH /api/projects/:projectId/restarbejde/tasks/:taskId/status` | Change task status | `restarbejde:update` | `restarbejde.task_status_changed` |
| `DELETE /api/projects/:projectId/restarbejde/tasks/:taskId` | Archive task | `restarbejde:delete` | `restarbejde.task_archived` |

### 6.2 Placements

| Method/path | Purpose | Permission | Audit event |
| --- | --- | --- | --- |
| `PUT /api/projects/:projectId/restarbejde/tasks/:taskId/primary-placement` | Set or replace primary placement | `restarbejde:manage_placements` | `restarbejde.placement_set` |
| `DELETE /api/projects/:projectId/restarbejde/tasks/:taskId/primary-placement` | Remove primary placement | `restarbejde:manage_placements` | `restarbejde.placement_removed` |
| `GET /api/projects/:projectId/restarbejde/drawings/:drawingId/placements` | List active placements for drawing/page | `restarbejde:read` | Optional read audit / metrics |

Rules:

- Placement coordinates are saved as percentages of the drawing/PDF page/image surface.
- PDF placement must include `page_number`.
- API should enforce same-tenant/same-project task and drawing references.

### 6.3 Drawings

| Method/path | Purpose | Permission | Audit event | Storage requirement |
| --- | --- | --- | --- | --- |
| `POST /api/projects/:projectId/restarbejde/drawings` | Upload drawing/PDF/image | `restarbejde:manage_drawings` | `restarbejde.drawing_uploaded` | Create storage object |
| `GET /api/projects/:projectId/restarbejde/drawings` | List drawings | `restarbejde:read` | Optional read audit / metrics | Metadata only |
| `GET /api/projects/:projectId/restarbejde/drawings/:drawingId/file` | Stream/download drawing | `restarbejde:read` | `restarbejde.drawing_accessed` if needed | API stream or signed URL |
| `DELETE /api/projects/:projectId/restarbejde/drawings/:drawingId` | Archive drawing | `restarbejde:manage_drawings` | `restarbejde.drawing_archived` | Archive/revoke access where relevant |

### 6.4 Photos

| Method/path | Purpose | Permission | Audit event | Storage requirement |
| --- | --- | --- | --- | --- |
| `POST /api/projects/:projectId/restarbejde/tasks/:taskId/photos` | Upload task photo | `restarbejde:manage_photos` | `restarbejde.photo_uploaded` | Create storage object |
| `PATCH /api/projects/:projectId/restarbejde/tasks/:taskId/photos/:photoId` | Update caption/metadata | `restarbejde:manage_photos` | `restarbejde.photo_updated` | Metadata only |
| `GET /api/projects/:projectId/restarbejde/tasks/:taskId/photos` | List photos | `restarbejde:read` | Optional read audit / metrics | Metadata only |
| `GET /api/projects/:projectId/restarbejde/tasks/:taskId/photos/:photoId/file` | Stream/download photo | `restarbejde:read` | `restarbejde.photo_accessed` if needed | API stream or signed URL |
| `DELETE /api/projects/:projectId/restarbejde/tasks/:taskId/photos/:photoId` | Archive photo | `restarbejde:manage_photos` | `restarbejde.photo_archived` | Archive/revoke access where relevant |

### 6.5 Reports and Exports

| Method/path | Purpose | Permission | Audit event | Storage requirement |
| --- | --- | --- | --- | --- |
| `POST /api/projects/:projectId/restarbejde/reports` | Request/generate PDF report | `restarbejde:report` | `restarbejde.report_requested` | May create report storage object |
| `GET /api/projects/:projectId/restarbejde/reports/:reportRunId` | Get report status/metadata | `restarbejde:report` | Optional read audit / metrics | Metadata only |
| `GET /api/projects/:projectId/restarbejde/reports/:reportRunId/file` | Download report | `restarbejde:report` | `restarbejde.report_downloaded` | API stream or signed URL |
| `POST /api/projects/:projectId/restarbejde/exports` | Request/generate CSV/export | `restarbejde:export` | `restarbejde.export_requested` | Optional storage object |
| `GET /api/projects/:projectId/restarbejde/exports/:reportRunId/file` | Download export | `restarbejde:export` | `restarbejde.export_downloaded` | API stream or signed URL |

Report generation note:

- The design should be async-capable.
- First implementation may be synchronous if safe, but the contract should allow queue/background generation later.
- Large reports with PDF crops and photos should be expected to require async generation.
- Report flow should align with a future shared FD report engine if/when available.

## 7. RBAC Permissions

Proposed permission names:

- `restarbejde:read`
- `restarbejde:create`
- `restarbejde:update`
- `restarbejde:delete`
- `restarbejde:manage_placements`
- `restarbejde:manage_drawings`
- `restarbejde:manage_photos`
- `restarbejde:export`
- `restarbejde:report`
- `restarbejde:admin_settings`

Note:
Legacy/prototype wording: `place_location` must not be used as a new permission, API, or schema name unless a later explicit decision keeps it. Use `restarbejde:manage_placements` for new backend/module contract work.

Final role mapping is deferred.

## 8. Audit Events

Proposed event names:

- `restarbejde.task_created`
- `restarbejde.task_updated`
- `restarbejde.task_status_changed`
- `restarbejde.task_archived`
- `restarbejde.placement_set`
- `restarbejde.placement_removed`
- `restarbejde.drawing_uploaded`
- `restarbejde.drawing_versioned`
- `restarbejde.drawing_accessed`
- `restarbejde.drawing_archived`
- `restarbejde.photo_uploaded`
- `restarbejde.photo_updated`
- `restarbejde.photo_accessed`
- `restarbejde.photo_archived`
- `restarbejde.report_requested`
- `restarbejde.report_generated`
- `restarbejde.report_failed`
- `restarbejde.report_downloaded`
- `restarbejde.export_requested`
- `restarbejde.export_generated`
- `restarbejde.export_failed`
- `restarbejde.export_downloaded`
- `restarbejde.trade_settings_updated`

Audit records should include tenant, project, actor, action, resource type, resource id, timestamp, and relevant metadata.

## 9. Storage Objects

Production must not store PDF/image/photo bytes as permanent base64/dataUrl in module tables.

Proposed storage paths:

```text
restarbejde/drawings/{tenantId}/{projectId}/{drawingId}/v{version}/original.pdf
restarbejde/photos/{tenantId}/{projectId}/{taskId}/{photoId}.jpg
restarbejde/reports/{tenantId}/{projectId}/{reportRunId}.pdf
```

Rules:

- Database stores metadata and storage references only.
- Storage access should use API streaming or signed URLs.
- Storage authorization must be enforced by backend/FD core, not frontend path knowledge.
- Storage paths are organizational paths only.
- Storage paths are not an authorization mechanism.
- Drawing versioning should be possible later even if v1 only supports one active version.

## 10. Report Crops and Derived Output

Crop data is derived report output.

Crop data must not be primary persisted task data.

Primary persisted placement data is:

- `drawing_id`
- `page_number`
- `x_percent`
- `y_percent`
- active/primary placement state

Crops may be generated during:

- report preview
- report generation
- background report rendering

Generated report crops should only show the current task marker, not every marker on the same drawing.

If crop generation fails, report generation should fail gracefully or include a fallback message such as:

`Tegningsudsnit kunne ikke genereres`

## 11. Data Ownership

FD-owned data:

- tenants
- users
- authentication/session identity
- project masterdata
- RBAC permissions
- audit infrastructure

Restarbejde-owned data:

- Restarbejde tasks
- task placements
- drawing metadata
- task photo metadata
- report run records
- module-specific settings if approved

Imported/enriched context:

- E-Komplet project context
- WIP/enrichment fields
- future ERP/integration context

Integration data may enrich views and reports, but must not own Restarbejde task state.

Derived output:

- report PDFs
- CSV exports
- crop images inside reports
- KPI calculations

File metadata:

- stored in module tables or shared FD file metadata depending on final storage design

Audit data:

- backend-owned, append-oriented, and not controlled by module frontend

## 12. Migration Principle from Prototype

The prototype frontend architecture must not be moved directly into FD.

Allowed to reuse conceptually:

- workflows
- UX principles
- task concepts
- placement flow
- report preview flow
- report crop strategy
- data model ideas
- validation lessons

Must be rewritten for FD integration:

- localStorage persistence
- frontend-owned task truth
- dataUrl/base64 file handling
- prototype-only state management
- standalone routing/app shell assumptions
- client-only report/file access assumptions
- any security assumptions controlled by frontend

Prototype data can inform schema/API design, but production architecture must follow FD backend, tenant, RBAC, audit, and storage rules.

## 13. Module Disable / Deactivation

Open:
Final module registry behavior is not decided.

Direction:

- If Restarbejde is disabled for a tenant/project, backend APIs should deny writes and navigation should be hidden.
- Existing data should be retained according to retention policy.
- Authorized admins/export flows may still access data if policy requires it.

## 14. E-Komplet Dependency

Direction:

- Restarbejde should use FD project context.
- Restarbejde must not require direct E-Komplet ownership.
- E-Komplet may enrich project data.

Open:
Whether Restarbejde can run on manually created FD projects before full E-Komplet enrichment is finalized.

## 15. Deferred Decisions

Not decided in this contract:

- offline sync
- realtime collaboration
- multi-marker support
- AI-assisted detection
- server-side report rendering
- global/shared trade taxonomy
- final storage backend
- final RBAC role mapping
- exact RLS policy implementation
- whether trade settings are module data, tenant UI config, or shared FD configuration
- report retention policy
- whether exports are always stored or can be streamed directly

## 16. Risks

Known risks:

- large PDF/image payloads can affect upload, preview, and report performance
- report rendering can create high memory usage, especially with crops and future photos
- unclear trade/color ownership can create inconsistent UI/report behavior
- internal tasks and OBS points may diverge enough to make one task table harder to maintain
- storage access/security must not rely on predictable file paths
- tenant leakage risk if `project_id` is used without `tenant_id`
- overfitting backend model to the prototype UI
- async report generation may be needed earlier than expected
- archived drawings with existing placements require careful behavior in reports

## 17. Links

Canonical FD docs:

- `docs/00_MASTER.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY_MODEL.md`
- `docs/MODULE_CONTRACT.md`
- `docs/AI_GOVERNANCE.md`
- `docs/DOC_INDEX.md`
- `docs/DECISIONS.md`

Restarbejde docs:

- `docs/modules/restarbejde/MODULE_DEFINITION.md`
