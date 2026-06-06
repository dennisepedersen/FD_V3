# FD Data Policy

Status: current data governance baseline
Scope: shared data ownership, source, retention, audit, and AI/data rules
Last updated: 2026-06-04

This document consolidates data ownership principles that were previously spread across architecture, AI bootstrap, module, storage, report, audit, and integration docs.

It does not define migrations, schemas, endpoints, retention periods, or a complete GDPR/legal policy.

## 1. Purpose

Fielddesk must know what kind of data it is handling before code, AI, reporting, storage, integrations, or release decisions are made.

Every table, API response, module record, report output, import, and AI analysis should be classifiable by ownership and source.

## 2. Data Classes

| Class | Meaning | Examples | Owner |
| --- | --- | --- | --- |
| Fielddesk-owned | Created or governed as FD source truth. | Tenant, user, project identity, module settings, FD task state. | FD Core or module owner. |
| Module-owned | Created by a module but scoped by FD platform rules. | QA items, Restarbejde tasks, placements. | Module owner. |
| Imported | Copied or synchronized from an external system. | E-Komplet projects/fitterhours, Solar product data. | Integration layer owns import behavior; external source owns original truth. |
| Derived | Calculated from one or more source inputs. | KPIs, CO2 calculations, report outputs, summaries. | Producing module/service. |
| Audit | Append-oriented governance/security trace. | Login events, exports, report downloads, module changes. | FD audit system. |
| Credential/config | Sensitive tenant/platform configuration. | API keys, encrypted integration credentials, tenant config. | FD Core/security. |
| File/binary artifact | Uploaded or generated binary object. | PDFs, images, reports, exports, drawings. | Storage service for binary; module/report service for relationships. |
| Demo/sandbox | Non-production or prototype data. | Local demo records, localStorage prototype state. | Demo/prototype owner; not production truth. |

## 3. Core Rules

- Imported data must not silently become Fielddesk-owned truth.
- Derived data must record its source inputs, freshness, and confidence where relevant.
- Audit data is append-oriented and not module-owned business state.
- Credential/config data must never be exposed to frontend, docs, logs, screenshots, or commits.
- File paths, URLs, and filenames are not authorization.
- Demo/sandbox data must not leak into production.
- Frontend may cache display data, but must not become source of truth for permissions, tenant scope, or persisted data.
- AI analysis output is derived advisory data until approved by a human.

## 4. Fielddesk-Owned Data

Fielddesk-owned data can be used as platform truth when current docs and implementation agree.

Examples:
- Tenant identity and lifecycle.
- Tenant users and roles.
- Project identity in `project_core`.
- Module enablement/registry state once implemented.
- FD-created module task state.

Rules:
- Must be tenant-scoped where tenant-owned.
- Must be protected by backend auth/RBAC/scope.
- Must have audit for critical changes.
- Must have documented owner and lifecycle.

## 5. Imported Data

Imported data enriches Fielddesk but does not automatically define FD truth.

Examples:
- E-Komplet v4 project masterdata.
- E-Komplet v3 WIP enrichment.
- E-Komplet fitterhours.
- Solar products, accounts, prices, ATP, document links.

Rules:
- Store source, sync/import context, and freshness where relevant.
- Keep imported fields distinguishable from FD-owned fields.
- Do not overwrite FD-owned decisions without explicit decision.
- Handle integration downtime without corrupting FD-owned data.
- Do not call third-party APIs from frontend.

## 6. Derived Data

Derived data is calculated or generated from source inputs.

Examples:
- Dashboard KPIs.
- Report PDFs.
- CSV/Excel exports.
- CO2 live calculations.
- CO2 snapshots.
- Labs analysis scores.

Rules:
- Record source scope and generated time where relevant.
- Distinguish live, snapshot, and verified outputs.
- Do not treat report/export artifacts as primary truth.
- Audit sensitive generated outputs and downloads where relevant.
- If exact regeneration matters, define snapshot/version policy first.

## 7. Audit Data

Audit data records security and governance-relevant actions.

Rules:
- Backend-owned.
- Append-oriented.
- Tenant and actor context should follow events.
- Must not contain secrets.
- Should avoid excessive sensitive payloads.
- Must be access-controlled.

See `docs/AUDIT_CONTRACT.md`.

## 8. Credential And Config Data

Credential/config data is sensitive.

Rules:
- Store only in backend-controlled config/secret storage.
- Encrypt tenant integration secrets where persisted.
- Never return secrets through APIs.
- Never log secrets.
- Never place secrets in frontend bundles, localStorage, screenshots, docs, or committed files.
- Mask secrets in snapshots and audit metadata.

See `docs/SECRET_HANDLING_RULES.md`.

## 9. File And Binary Data

Binary files belong behind the storage contract.

Rules:
- Store metadata and references in structured records.
- Store binaries in storage service/object storage when production-ready.
- Do not store permanent base64/dataUrl/localStorage files in production.
- Backend must authorize upload/download/access.
- Sensitive file/report access should be auditable.

See `docs/STORAGE_CONTRACT.md`.

## 10. AI And Labs Data

AI outputs are advisory unless approved.

AI/Labs outputs must:
- Include evidence level.
- List docs read.
- Name uncertainty and conflicts.
- Avoid changing source data automatically.
- Avoid exposing secrets or raw sensitive payloads.
- Treat analysis scores as recommendations, not decisions.

AI must not:
- Approve gates.
- Release changes.
- Decide product/security/data policy.
- Mutate tenant data without explicit human-approved implementation scope.

## 11. Retention And Deletion Direction

Current status:
- Final retention periods are not decided.
- Final tenant export/delete obligations are not decided.
- Final legal hold policy is not decided.

Direction:
- Prefer archive/soft delete for user-facing deletes where audit/history matters.
- Hard delete must be policy-controlled.
- Audit records should not be casually edited or deleted.
- Derived artifacts may have different retention from source data.
- Credentials should follow security rotation and deletion policy.

## 12. Open Decisions

- Final retention periods by data class.
- GDPR/privacy deletion/anonymization process.
- Tenant export policy.
- Legal hold policy.
- Final RLS policy.
- Final RBAC matrix.
- Final storage provider and file retention.
- Final CO2 live/snapshot/verified data model.
- Final AI telemetry/cost logging data model.

## Related Docs

- `docs/ARCHITECTURE.md`
- `docs/SECURITY_MODEL.md`
- `docs/AUDIT_CONTRACT.md`
- `docs/STORAGE_CONTRACT.md`
- `docs/REPORT_ENGINE_CONTRACT.md`
- `docs/MODULE_CONTRACT.md`
- `docs/PROJECT_CONTEXT_CONTRACT.md`
- `docs/AI_GOVERNANCE.md`
- `docs/integrations/FD_SOLAR.md`
