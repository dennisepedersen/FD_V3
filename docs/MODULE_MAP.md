# FD Module Map

Status: current governance map
Scope: high-level module ownership, dependencies, data ownership, and relationships
Last updated: 2026-06-04

This document maps Fielddesk modules and planned module areas. It is not an implementation spec, route map, database schema, or product backlog.

## 1. Platform Relationship Map

```text
FD Core Platform
  -> Tenant/Auth/RBAC/Audit
  -> Project Context
  -> Module Registry
  -> Storage
  -> Report/Export
  -> Integrations

Project Context
  -> QA
  -> Restarbejde
  -> Economy
  -> Documents
  -> Reports
  -> CO2/ESG
  -> Labs (Platform Tooling, not tenant module)

Integrations
  -> E-Komplet enriches Projects/Economy/Time context
  -> Solar enriches Product/Procurement/CO2 context
  -> M365 may enrich Documents/Calendar/Mail later
```

## 2. Module Map

| Module | Purpose | Owner | Dependencies | Data Ownership | Relations |
| --- | --- | --- | --- | --- | --- |
| Core Platform | Tenant lifecycle, auth, RBAC, audit, module registry, shared contracts. | FD Core | PostgreSQL, backend, tenant/domain model, security model. | Fielddesk-owned, audit, credential/config. | Owns foundation used by every module. |
| Projects | Canonical project identity, project access, project context. | FD Core / Projects | Tenant, RBAC, project assignments, EK sync where imported. | Fielddesk-owned project identity; imported/enriched EK fields; derived summaries. | Center point for QA, Restarbejde, Economy, Documents, Reports, CO2, Labs. |
| QA | Project-oriented questions/coordination and early module runtime pattern. | QA module owner / FD Core until assigned | Projects, tenant auth, module access, audit. | QA-owned conversations/items; audit owned by platform. | Uses project context; should follow module contract and module registry. |
| Restarbejde | Manage defects/rest work, OBS points, placements, drawings, photos, reports. | Restarbejde module owner / FD Core until assigned | Projects, storage, report/export, audit, RBAC, module registry. | Restarbejde-owned tasks/placements/metadata; files via storage; reports as derived output. | Strong project relation; prototype exists but must be lifted to FD standards. |
| Economy | Financial/project economy overview and future finance workflows. | Economy module owner not assigned | Projects, EK WIP/masterdata, RBAC, reports. | Imported EK economy/WIP enrichment plus future FD-owned finance annotations if approved. | Depends on Projects and integration semantics; may feed dashboards/reports. |
| Documents | Project/tenant document storage, search, metadata, and future M365 flows. | Documents module owner not assigned | Storage, Projects, RBAC, audit, possibly M365. | File metadata, search text, derived OCR/chunks; binaries owned by storage. | Supports QA, Restarbejde, CO2 evidence, Reports, future AI/RAG. |
| Reports | Shared report/export orchestration across modules. | FD Core / Report engine | Storage, audit, Projects, module-owned adapters. | Report runs/metadata; generated artifacts are derived output. | Consumed by Restarbejde, CO2, QA, Economy, dashboards. |
| CO2/ESG | Product/material/environmental calculations, snapshots, verified outputs. | CO2/ESG module owner not assigned | Projects, Solar/product data, Documents/evidence, Reports, audit. | Derived CO2 data; verified evidence-backed factors; snapshots; imported product refs. | Uses Solar/document evidence; may publish live/snapshot/verified project CO2. |
| Labs | Platform tooling for idea/spec/build readiness and governance checks. v0.1 covers IDE -> ANALYSE only. | Global admin / Dennis until delegated | Governance docs, DECISIONS, DOC_INDEX, module map, project rules, gates, AI governance. | Platform-internal ideas, attachment metadata, analysis outputs, scores, recommendations, open questions. | Exists outside tenant enablement; not a Tenant Module, Registry Enabled Module, or Customer Feature. |
| Integrations | Controlled backend-owned access to external systems. | FD Core / Integration owners | Tenant config/secrets, audit, rate limits, backend clients. | Imported data, integration metadata, credential/config data. | E-Komplet, Solar, M365 and future systems enrich FD, never own FD security truth. |
| Admin/Settings | Tenant admin, module enablement, users, teams, integration setup. | FD Core | Tenant, RBAC, module registry, audit, secrets. | Fielddesk-owned config and credential/config metadata. | Controls module availability and tenant configuration. |
| IDE/Idea Bank | Intake and structured storage of ideas before analysis/spec. | Product/Dennis | IDE_BANK, AI governance, workflow gates. | Idea records and statuses, not implementation truth. | Feeds Labs analysis only after human request. |

## 3. Data Ownership Classes

Every module must classify data as one or more of:

- Fielddesk-owned
- Module-owned
- Imported
- Derived
- Audit
- Credential/config
- Demo/sandbox
- File/binary artifact

See `docs/DATA_POLICY.md` for the canonical data ownership rules.

## 4. Dependency Rules

- Modules must depend on FD Core for tenant, auth, RBAC, audit, and project access.
- Modules must not call third-party APIs directly from frontend.
- Modules must not duplicate tenant, user, project, or assignment truth.
- Optional integrations must be declared as optional and degrade safely.
- Required integrations must be explicit and approved before the module is treated as core.

## 5. Core Vs Optional Direction

Current core direction:

- Tenant/auth/RBAC/audit.
- Project foundation.
- Module registry/enablement.
- Storage/report contracts as platform services.

Optional or not yet classified:

- Restarbejde.
- QA.
- Economy.
- Documents.
- CO2/ESG.
- M365/Solar/Dalux/Public API extensions.

Platform tooling, not tenant modules:

- Labs.

## 6. Open Decisions

- Final owner for each module.
- Which modules are core versus optional.
- Which modules must work without E-Komplet.
- Final module registry implementation.
- Module dependency graph and version compatibility.
- Per-project module enablement.
- Final RBAC matrix per module.

## Related Docs

- `docs/MODULE_CONTRACT.md`
- `docs/MODULE_REGISTRY_CONTRACT.md`
- `docs/PROJECT_CONTEXT_CONTRACT.md`
- `docs/REPORT_ENGINE_CONTRACT.md`
- `docs/STORAGE_CONTRACT.md`
- `docs/AUDIT_CONTRACT.md`
- `docs/DATA_POLICY.md`
- `docs/modules/restarbejde/MODULE_DEFINITION.md`
- `docs/modules/restarbejde/BACKEND_MODULE_CONTRACT.md`
