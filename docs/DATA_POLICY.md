# FD V3 Data Policy

Status: current direction
Scope: storage ownership split for structured data and files

Fielddesk stores structured application data in PostgreSQL and binary files in external object storage.

## Current Storage Direction

- Structured tenant, project, module, audit, and file metadata lives in PostgreSQL.
- Binary file objects live in Azure Blob Storage.
- The Fielddesk backend is the control point for storage access.
- Frontend code must never receive Azure connection strings or direct storage credentials.
- Permanent base64, dataUrl, browser storage, or production local disk storage is not allowed for files.

## Azure Blob Foundation

The initial provider is Azure Blob Storage, configured through backend environment variables:

- `FD_STORAGE_PROVIDER=azure_blob`
- `FD_AZURE_STORAGE_CONNECTION_STRING`
- `FD_AZURE_STORAGE_CONTAINER`
- `FD_STORAGE_MAX_UPLOAD_MB`

The backend storage provider must fail closed when the provider is missing, unknown, or missing required Azure configuration.

## Metadata Direction

File metadata is tenant-scoped in PostgreSQL through `storage_object`.

Project-scoped files include `project_id` and use the same tenant boundary as `project_core`. Modules attach files through metadata fields such as `module_key`, `resource_type`, and `resource_id`.

## Non-Goals

This policy does not implement UI upload, document folders, reports, OCR/AI, public URLs, or module-specific file workflows by itself.
