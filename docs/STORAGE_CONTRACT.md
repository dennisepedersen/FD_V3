# FD Storage Contract

Status: Draft / Proposed  
Scope: Shared storage/file governance contract for FD modules  
Last updated: 2026-05-24

This document defines shared Fielddesk direction for files, binary artifacts, uploads, downloads, storage metadata, retention, archive, and access rules.

It is governance-light, implementation-light, platform-oriented, and vendor/cloud-neutral. It does not define a storage provider, database schema, API implementation, CDN setup, upload library, or migration.

## 1. Purpose

The storage contract exists to prevent each FD module from creating its own isolated file/storage model.

It should guide storage behavior for:

- Restarbejde drawings, photos, and reports
- Documents module files
- CO2 attachments/imports
- QA attachments
- generated reports and exports
- future files and binary artifacts

The contract defines ownership, shared storage concepts, lifecycle, metadata direction, tenant/project scope, security direction, upload/download principles, module integration rules, and retention direction.

## 2. Core Principles

Storage service owns binary objects.

Modules own metadata/domain relationships only.

Binary files are not authorization boundaries.

Paths, URLs, and filenames are organizational only.

Access must always be backend-authorized.

Frontend may upload/download through controlled flows, but does not own storage truth.

Prototype storage such as base64, dataUrl, and localStorage is not production architecture.

Rules:

- Modules should store references, not binary files.
- Modules must not trust client-provided paths.
- Tenant and scope metadata must follow files.
- `project_id` alone is not a security boundary.
- Shared storage principles must support future signed URLs, API streaming, and CDN flows.
- Reports, exports, crops, thumbnails, and previews are derived artifacts unless explicitly defined otherwise.

## 3. Shared Storage Concepts

Shared terms:

- Storage object: backend-owned identity for a stored binary object.
- File metadata: structured metadata describing ownership, scope, content type, size, lifecycle, and relationships.
- Binary artifact: any stored file/blob such as PDF, image, CSV, Excel, import file, or generated report.
- Derived artifact: generated object created from source data or source files, such as report PDFs, exports, crops, thumbnails, or previews.
- Original artifact: uploaded or imported source file before derived processing.
- Upload session: controlled process for receiving a file from a client or integration.
- Storage scope: tenant/project/module/resource context that controls file visibility and access.
- Retention state: policy state controlling how long metadata and/or binary output should be retained.
- Archive state: state indicating that a file is no longer active but may still exist for policy, audit, or historical access.

These terms should be reused by modules unless a later governance decision defines a replacement.

## 4. Ownership

Storage service owns:

- binary objects
- storage object identifiers
- storage access mechanics
- storage lifecycle state
- low-level upload/download behavior where shared
- storage provider abstraction where implemented later

Modules own:

- domain relationships to files
- module-specific metadata
- attachment references
- drawing/photo/report/import relationships
- module-specific validation rules

Report engine owns:

- report/export generation flow
- generated report/export artifacts as derived outputs
- links between report runs and generated artifacts

Project context owns:

- project identity and project scope used by file metadata

Audit system owns:

- upload/access/download/delete/archive audit trail where relevant

Frontend owns:

- upload UI state
- download UI state
- progress indicators
- temporary preview state

Frontend does not own:

- storage truth
- file authorization
- storage paths
- file lifecycle
- audit trail

## 5. File/Object Lifecycle

Shared lifecycle direction:

- `uploaded`: object has been received or registered.
- `processing`: object is being scanned, transformed, validated, or prepared.
- `available`: object is available to authorized flows.
- `archived`: object is no longer active but retained by policy.
- `expired`: object is no longer available according to retention policy.
- `deleted`: object has been removed according to approved policy.

Early implementations may collapse some states if safe, but modules should not invent incompatible lifecycle meanings.

Hard delete should be policy-controlled and should not be the default user-facing delete behavior.

## 6. Storage Metadata Direction

Minimum metadata direction:

- `tenant_id`
- `project_id` where relevant
- `module_key`
- `storage_object_id`
- `file_name`
- `content_type`
- `size_bytes`
- `created_by`
- `created_at`
- `source_type`
- `original_or_derived`
- `retention_state`
- `archive_state`
- linked resource type/id where relevant

Possible later metadata:

- checksum/hash
- version
- content disposition
- scan status
- processing status
- storage provider key
- thumbnail/preview references
- original source reference
- generated-from report run id
- import job id
- expiration timestamp

Metadata must be structured enough to answer:

- Which tenant owns this file?
- Which project/resource is it attached to?
- Which module uses it?
- Is it original or derived?
- Who created/uploaded/generated it?
- Is it active, archived, expired, or deleted?

## 7. Security Direction

Access must always be backend-authorized.

Storage paths, URLs, filenames, and hidden links are not authorization.

Security rules:

- Backend must verify authenticated tenant context.
- Backend must verify project access where project-scoped files are involved.
- Backend must verify module entitlement and module permissions where relevant.
- Backend must verify resource access where files attach to tasks, reports, imports, documents, or other resources.
- Modules must not trust client-provided paths.
- Frontend-held paths or URLs must not grant access by themselves.
- Signed URLs may be used later, but must be backend-issued and time/scope controlled.
- API streaming may be used later and must enforce backend authorization.
- CDN flows may be used later but must not bypass authorization requirements.
- Storage access should be auditable where relevant.

No frontend-held storage credentials.

No direct public bucket/path assumptions unless a later explicit decision allows a public asset class.

## 8. Tenant/Project Scope Direction

Tenant and scope metadata must follow files.

Direction:

- Tenant-owned files must include `tenant_id` metadata.
- Project-owned files should include `project_id` metadata.
- Module-owned relationships should include `module_key`.
- Resource-attached files should include linked resource type/id where relevant.
- `project_id` alone is not a security boundary.
- Cross-tenant file references are forbidden unless explicitly designed later.
- Project-scoped file access should align with `PROJECT_CONTEXT_CONTRACT`.

Examples:

- Restarbejde drawing: tenant + project + module + drawing resource.
- Restarbejde task photo: tenant + project + module + task resource + photo metadata.
- Report artifact: tenant + project where relevant + module/report run + derived marker.
- Document module file: tenant + project or document-space scope depending on future document contract.

## 9. Upload/Download Principles

Upload principles:

- Uploads should create backend-owned metadata.
- Client-provided paths must not be trusted.
- Content type should be validated where practical.
- Size limits should be enforced.
- Upload flow should be able to support processing/scanning later.
- Failed uploads should not leave untracked active metadata.

Download principles:

- Downloads must verify tenant/project/module/resource permission.
- Direct path access should not bypass backend checks.
- Downloads may later use signed URLs or API streaming.
- Sensitive downloads should be auditable where relevant.
- Frontend may initiate downloads but does not own authorization.

## 10. Report/Generated Artifact Storage

Reports, exports, crops, previews, and thumbnails are derived artifacts unless explicitly defined otherwise.

Rules:

- Generated artifacts should link back to source scope through metadata.
- Generated artifacts should not replace source domain data.
- Report engine should use shared storage principles.
- Report artifacts should align with `REPORT_ENGINE_CONTRACT`.
- Report retention may differ from original upload retention.
- Report artifacts may include tenant/project/module/report-run metadata.

Examples:

- Restarbejde report PDF is a derived artifact.
- Restarbejde crop image inside a report is derived output.
- CSV/Excel exports are derived artifacts.
- Dashboard/KPI export files are derived artifacts.

## 11. Module Integration Rules

Modules should not build isolated storage systems.

Modules may extend metadata for domain needs, but should not replace shared storage ownership.

Rules:

- Modules should store references to storage objects, not binary files.
- Modules should not store permanent base64/dataUrl/localStorage files in production.
- Modules should define which resources can have files.
- Modules should define file permissions and audit needs.
- Modules should align file scope with tenant/project/resource ownership.
- Report engine should use shared storage principles.
- Project context should align with storage scope.

Restarbejde drawings, photos, and reports should follow this contract.

QA attachments, CO2 imports/attachments, document files, and future module files should follow the same storage direction.

## 12. Retention / Archive Direction

Retention and archive behavior must be explicit before production use.

Direction:

- Archive state should preserve metadata where policy requires it.
- Expired files may become inaccessible before metadata is removed.
- Hard delete should be policy-controlled.
- User-facing delete should normally mean archive/remove from active use unless a policy says otherwise.
- Derived artifacts may have shorter retention than original/source files.
- Retention for reports/exports may differ from attachments/imports.

Open:

- Final retention periods.
- Archive visibility rules.
- Legal hold requirements if needed later.
- Tenant export/delete obligations.

## 13. Extensibility

Future storage capabilities may include:

- image resizing pipeline
- thumbnail generation
- preview generation
- virus/malware scanning
- encryption policy
- CDN delivery
- signed URLs
- API streaming
- chunked uploads
- resumable uploads
- cold storage/archive tiers
- deduplication
- storage lifecycle automation
- file versioning
- import processing pipelines
- OCR/text extraction

These are not implemented by this contract.

## 14. Deferred Decisions

Not decided in this contract:

- blob/object provider
- CDN strategy
- signed URL vs API streaming policy
- image resizing pipeline
- preview generation implementation
- virus scanning
- encryption strategy
- lifecycle automation
- deduplication
- cold storage/archive tiers
- chunked uploads
- resumable uploads
- offline sync
- final metadata schema
- storage cost/accounting model
- file versioning policy
- legal hold/tenant deletion behavior

Do not assume these are solved until a current governance or implementation document says so.

## 15. Risks

Known risks:

- tenant leakage
- orphaned files
- oversized uploads
- inconsistent metadata
- modules storing local paths/base64/dataUrl
- hidden URL assumptions
- storage sprawl
- report/export duplication
- broken retention behavior
- frontend-owned file truth
- path-based security assumptions
- generated artifacts replacing source truth
- modules creating incompatible file lifecycle states
- missing audit trail for sensitive downloads
- stale derived previews or thumbnails

## Relevant Docs

- `docs/00_MASTER.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY_MODEL.md`
- `docs/MODULE_CONTRACT.md`
- `docs/AI_GOVERNANCE.md`
- `docs/PROJECT_CONTEXT_CONTRACT.md`
- `docs/REPORT_ENGINE_CONTRACT.md`
- `docs/MODULE_REGISTRY_CONTRACT.md`
- `docs/modules/restarbejde/BACKEND_MODULE_CONTRACT.md`
