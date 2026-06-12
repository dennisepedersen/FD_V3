# EK v4 Project Materials, Purchasing, Finance, And Documents

Status: verified discovery / no write implementation
Date: 2026-06-12
Scope: operational Codex/dev guidance for safe project-scoped EK v4 probes

## Purpose

Record verified EK v4 findings for project-scoped material, purchasing,
financial, worksheet, and document discovery. This doc is evidence only. It
does not authorize new sync behavior, database writes, EK writes, or
production configuration changes.

## VERIFIED

Safe project-scoped probes verified these read-only endpoints:

| Endpoint | Filter | Verified behavior |
| --- | --- | --- |
| `GET /api/v4/purchaseinvoicelines` | `searchAttribute=ProjectID&search=<projectId>` | Returned actual purchase/material lines for the project. |
| `GET /api/v4/purchaseorders` | `searchAttribute=ProjectID&search=<projectId>` | Returned purchase/supplier header data for the project. |
| `GET /api/v4/financialposts` | `searchAttribute=ProjectID&search=<projectId>` | Returned financial activity and linking fields. |
| `GET /api/v4/worksheets` | `searchAttribute=ProjectID&search=<projectId>` | Returned worksheet data for the project. |
| `GET /api/v4/projects/{id}/documentation` | project id path | Returned a binary ZIP/PDF-like document package, not JSON. |

Verified `purchaseinvoicelines` fields include:

- `ItemCode`
- `ItemName`
- `Amount`
- `UnitPrice`
- `Price`
- `Creditor`
- `PurchaseInvoiceID`
- `AppendixNumber`

Verified `financialposts` can be a bridge to:

- `invoiceID`
- `purchaseOrderID`
- `fileID`
- postings
- financial activity

## USE

When Codex investigates EK project materials/economy, prefer this order:

1. `purchaseinvoicelines`
   - Use first for actual material/purchase line detail.
   - Best current candidate for item-level material facts because it exposes item code/name, amount, unit price, line price, creditor, invoice id, and appendix number.
2. `purchaseorders`
   - Use second for supplier/order header context.
   - Useful for grouping lines and understanding purchase/supplier activity around a project.
3. `financialposts`
   - Use third as a bridge between project, invoice, purchase order, file references, postings, and financial activity.
   - Do not treat it as the first material-line source; use it to connect and reconcile.
4. invoices/PDF-related endpoints
   - Investigate after line/order/posting relationships are mapped.
   - Use only as read-only evidence until invoice and purchase-invoice chains are verified.
5. `projects/{id}/documentation`
   - Investigate last because it returns a binary ZIP/PDF-like package, not JSON.
   - Requires file/storage governance before FD stores anything.

Use ProjectID-filtered probes before any proposed sync change. Record endpoint shape, pagination behavior, join keys, and sample field semantics in docs before implementation.

## DO NOT USE

- Do not add these endpoints to scheduled sync until mapping, tenant isolation,
  retention, pagination, and audit behavior are explicitly designed.
- Do not parse `projects/{id}/documentation` as JSON.
- Do not store binary EK document packages in FD without an approved file/storage
  contract.
- Do not infer FD-owned material truth from one endpoint before resolving how
  purchase invoice lines, purchase orders, financial posts, and worksheets relate.
- Do not run broad/full scans where a project-scoped endpoint exists.
- Do not use write-side endpoints from this doc without separate write-back governance.

## OPEN QUESTIONS

- Exact business meaning and completeness of each `financialposts` row type.
- Whether `purchaseinvoicelines` should become the primary FD material cost source, or only a cross-check/enrichment source.
- Whether `purchaseorders` and `purchaseinvoicelines` have stable joins through EK identifiers across all tenants.
- How invoice, purchase invoice, purchase order, appendix, and PDF chains relate.
- How `fileID` links from `financialposts` resolve to files or documentation packages.
- Whether `worksheets` should feed project status, production documentation, QA context, or only remain raw integration data.
- Exact content type and internal structure of `GET /api/v4/projects/{id}/documentation` output.
- Whether EK supports targeted metadata-only document listing before downloading binary packages.

## FUTURE POSSIBILITY

Read-side candidates:

- Project material cost and supplier overview from `purchaseinvoicelines`.
- Purchase/supplier context from `purchaseorders`.
- Financial bridge between invoices, purchase orders, files, postings, and
  project activity from `financialposts`.
- Worksheet-backed project activity or documentation signals from `worksheets`.
- Document ingestion research from `projects/{id}/documentation`, only after
  storage governance is ready.

Write-side candidates, not implementation:

- `POST /api/v4/projects/upload` may be investigated later as document upload
  to EK.
- `POST /api/v4/projects/{id}/items` may be investigated later for creating
  project item lines.
- `POST /api/v4/fitterhours` may be investigated later for creating time
  registrations.
- `POST /api/v4/projects/budgets` and `PUT /api/v4/projects/budgets` may be
  investigated later for creating or updating project budgets.

These write-side endpoints must not be used without separate write-back
governance covering RBAC, audit, change note, tenant isolation, dry-run or
approval flow, rollback/compensation strategy, and explicit user approval.
