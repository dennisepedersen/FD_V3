# EK v4 Project Materials, Purchase Invoices, Finance, And Documents

Status: verified discovery / no write implementation
Date: 2026-06-13
Scope: operational Codex/dev guidance for safe project-scoped EK v4 probes

## Purpose

Record verified EK v4 findings for project-scoped material, purchasing,
financial, worksheet, and document discovery. This doc is evidence only. It
does not authorize new sync behavior, database writes, EK writes, or
production configuration changes.

## Verified Endpoints

Safe project-scoped probes verified these read-only endpoints:

| Endpoint | Filter | Verified behavior |
| --- | --- | --- |
| `GET /api/v4/purchaseinvoicelines` | `searchAttribute=ProjectID&search=<projectId>` | Returned actual purchase/material lines for the project. |
| `GET /api/v4/purchaseinvoicelines` | `searchAttribute=PurchaseInvoiceID&search=<id>` | Returned lines for one purchase invoice. |
| `GET /api/v4/purchaseinvoicelines` | `searchAttribute=AppendixNumber&search=<number>` | Returned lines for one appendix/voucher number. |
| `GET /api/v4/purchaseorders/{id}` | path id | Returned one purchase invoice header. |
| `POST /api/v4/purchaseorders/search` | id, `ProjectID`, or `AppendixNumber` search | Returned purchase invoice header data. Search by id matched `GET /api/v4/purchaseorders/{id}`. Operator `0` behaved as equals in the tested cases. |
| `GET /api/v4/financialposts` | `searchAttribute=ProjectID&search=<projectId>` | Returned financial postings and reconciliation fields for the project. |
| `GET /api/v4/financialposts` | `searchAttribute=AppendixNumber&search=<number>` | Returned postings for one appendix/voucher number. |
| `GET /api/v4/worksheets` | `searchAttribute=ProjectID&search=<projectId>` | Returned worksheet data for the project. |
| `GET /api/v4/projects/{id}/documentation` | project id path | Returned a ZIP containing project documents. |

## PurchaseInvoiceLines

Endpoint: `GET /api/v4/purchaseinvoicelines`

Verified:

- Primary verified source for project material and purchase invoice lines.
- `ProjectID` filter works.
- `PurchaseInvoiceID` filter works.
- `AppendixNumber` filter works.
- TEXT lines exist.
- `CostCode` and `SumCostCode` were empty in the tested cases.
- Fielddesk's material module should be based on `purchaseinvoicelines`.

Verified fields include:

- `ItemCode`
- `ItemName`
- `Amount`
- `Unit`
- `UnitPrice`
- `Price`
- `Creditor`
- `PurchaseInvoiceID`
- `AppendixNumber`
- `EAN` (partially populated)
- `CatalogName`
- `CatalogItemGroupName`

## PurchaseInvoiceHeader

EK endpoints:

- `GET /api/v4/purchaseorders/{id}`
- `POST /api/v4/purchaseorders/search`

Fielddesk name: `PurchaseInvoiceHeader`.

Rationale: the EK endpoint path is named `purchaseorders`, but the returned
data and EK documentation describe purchase invoice headers. Fielddesk should
use the name `PurchaseInvoiceHeader` for this integration concept until EK
proves otherwise.

Verified:

- `GET /api/v4/purchaseorders/{id}` fetches one header.
- `POST /api/v4/purchaseorders/search` works.
- Search by id returns the same data as `GET`.
- Search by `ProjectID` works.
- Search by `AppendixNumber` works.
- Search operator `0` behaved as equals in the tested cases.

Verified fields include:

- `ID`
- `Reference`
- `AppendixNumber`
- `ProjectID`
- `ProjectReference`
- `Creditor`
- `CreditorID`
- `FileID`
- `PaperflowVoucherID`
- `Net`
- `Vat`
- `Total`
- `Remaining`
- `Approved`
- `DueDate`
- `BillingDate`
- `PaymentTerms`
- `ReceivedBy`
- `ReceivedDate`
- `StatusEnum`

## FinancialPosts

Endpoint: `GET /api/v4/financialposts`

Verified:

- `ProjectID` filter works.
- `AppendixNumber` filter works.
- `financialposts` is a bookkeeping and reconciliation source.
- `financialposts` is not a material-line source.

Verified bridge fields include:

- `invoiceID`
- `purchaseOrderID`
- `fileID`
- `appendixNumber`
- posting accounts and values

Relationship:

- `FinancialPosts.purchaseOrderID`
- `PurchaseInvoiceHeader.ID`
- `PurchaseInvoiceLines.PurchaseInvoiceID`

Financial postings balanced to zero in the tested purchase invoice cases:

- `Net`
- plus `Vat`
- minus `Total`
- equals `0`

`invoiceID` appears to be a debtor/sales invoice path in the tested cases. It
was not the purchase invoice path for the tested purchase invoices.

## Relationship Chain

Documented purchase invoice chain:

```text
PurchaseInvoiceLines
-> PurchaseInvoiceID
-> PurchaseInvoiceHeader.ID
-> FinancialPosts.purchaseOrderID
```

`AppendixNumber` binds:

- `PurchaseInvoiceLines`
- `PurchaseInvoiceHeader`
- `FinancialPosts`

## Invoice Type Indicators

Verified examples on project `80396-003`:

RNTM invoice `3341`:

- manual/PDF-like
- `hasElectronicData = false`
- no `EAN`
- no `ItemCode`
- no `CatalogName`

Solar invoice `2040451029`:

- OIOUBL/EAN-like
- `hasElectronicData = true`
- has `EAN`
- has `ItemCode`
- has `CatalogName`
- has `CatalogItemGroupName`

Best invoice type indicators:

- `hasElectronicData`
- `EAN`
- `ItemCode`
- `CatalogName`
- `CatalogItemGroupName`

Not suitable as invoice type indicators:

- `FileID`
- `GetFilename`

## FileID And Appendix Path

Verified via live EK API purchase invoice headers:

- RNTM invoice `3341`: `FileID = 183840`
- Solar invoice `2040451029`: `FileID = 175641`

Conclusion:

- `FileID` exists on both tested invoice types.
- `FileID` does not mean PDF invoice.
- `FileID` most likely means original attached invoice file.

Schema-verified observation: EK schema describes `FileID` as:

```text
ID på vedhæftet originalfil (fx PDF af leverandørens faktura).
```

`PaperflowVoucherID` was empty on both tested purchase invoice headers.

Not verified:

- `FileID -> download` endpoint.
- `FileID -> PDF` endpoint.
- `FileID -> original file` endpoint.

## FinancialPosts Appendix Path

Verified on project `80396-003`:

- 605 `financialposts` rows inspected live.
- 0 rows had `fileID > 0`.
- 2 rows had `hasAppendix = true`.

Those 2 rows had:

- `invoiceID` populated.
- `purchaseOrderID = null`.
- `financialAccountName = Fakturering`.

Conclusion:

- `hasAppendix` appears primarily related to the sales invoice / billing path
  in the tested project.
- `financialposts` is not verified as a file source for purchase invoices.
- `financialposts.fileID` was `0` for every inspected row.
- `PurchaseInvoiceHeader.FileID` remains the best verified purchase invoice
  appendix/file candidate.

## Project Documentation

Endpoint: `GET /api/v4/projects/{projectId}/documentation`

Verified:

- Returns a ZIP.
- Contains project documents.

Not verified:

- Purchase invoice appendices/files.

Conclusion:

- Project documentation ZIP must not be treated as a safe fallback for purchase
  invoice files.

## USE

When Codex investigates EK project materials/economy, prefer this order:

1. `purchaseinvoicelines`
   - Use first for actual material/purchase line detail.
   - Best current candidate for item-level material facts because it exposes item code/name, amount, unit price, line price, creditor, invoice id, and appendix number.
2. `PurchaseInvoiceHeader` through `purchaseorders`
   - Use second for purchase invoice header context.
   - Useful for supplier, appendix number, approval, due date, net/vat/total, remaining amount, and file id.
3. `financialposts`
   - Use third for bookkeeping reconciliation and financial posting context.
   - Do not treat it as a material-line source.
4. File/download endpoints
   - Investigate after `PurchaseInvoiceHeader.FileID` download behavior is verified.
   - Use only as read-only evidence until file handling and storage governance are designed.
5. `projects/{id}/documentation`
   - Investigate only as a project-document source, not as a verified purchase invoice fallback.

Use ProjectID-filtered probes before any proposed sync change. Record endpoint shape, pagination behavior, join keys, and sample field semantics in docs before implementation.

## DO NOT USE

- Do not add these endpoints to scheduled sync until mapping, tenant isolation,
  retention, pagination, and audit behavior are explicitly designed.
- Do not parse `projects/{id}/documentation` as JSON.
- Do not store binary EK document packages in FD without an approved file/storage
  contract.
- Do not treat `purchaseorders` as classic purchase orders in Fielddesk naming;
  use `PurchaseInvoiceHeader` for the verified data shape.
- Do not infer invoice type from `FileID` or `GetFilename`.
- Do not treat `financialposts.fileID` as a verified purchase invoice file path.
- Do not run broad/full scans where a project-scoped endpoint exists.
- Do not use write-side endpoints from this doc without separate write-back governance.

## OPEN QUESTIONS

- Exact business meaning and completeness of each `financialposts` row type.
- Whether the verified `purchaseinvoicelines` material model is stable across all tenants.
- Whether `PurchaseInvoiceHeader.FileID` has a public download/metadata endpoint.
- Whether `PaperflowVoucherID` is populated in other tenants or invoice flows.
- Whether `financialposts.hasAppendix` can be used reliably for sales invoice appendices.
- Whether `worksheets` should feed project status, production documentation, QA context, or only remain raw integration data.
- Whether EK supports targeted metadata-only document listing before downloading binary packages.

## FUTURE POSSIBILITY

Read-side candidates:

- Material module from `purchaseinvoicelines`.
- Project economy from `PurchaseInvoiceHeader` plus `financialposts`.
- CO2 / ESG enrichment from `purchaseinvoicelines` via `EAN`, `ItemCode`, and
  external product data sources.
- Purchase invoice overview from `PurchaseInvoiceHeader` search.
- Appendix/file display after `FileID` download behavior is verified.
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
