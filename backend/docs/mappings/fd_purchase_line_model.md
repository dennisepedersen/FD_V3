# Fielddesk canonical purchase line model

Status: POC architecture groundwork
Date: 2026-09-02
Scope: E-Komplet V4 purchase invoice line normalization for IGVA POC and future Fielddesk purchase domains.

## Source Endpoints

Primary source:

- `GET /api/v4/purchaseinvoicelines?searchAttribute=ProjectID&search=<EK ProjectID>`

Secondary/provenance source:

- `GET /api/v4/financialposts?searchAttribute=ProjectID&search=<EK ProjectID>`

Fallback/enrichment source:

- `GET /api/v4/purchaseinvoicelines?searchAttribute=PurchaseInvoiceID&search=<PurchaseInvoiceID>`

`verified`: Direct ProjectID purchase invoice lines are a better primary project purchase source than financialposts/PurchaseInvoiceID bridge for `80279-003` and `38155`.

`verified`: `purchaseinvoicelines` are project purchase transactions, not automatically Materialer Realiseret. Rows must be classified.

## Canonical Fields

The in-memory model is produced by `backend/src/services/purchaseLineNormalizer.js`.

Core identity/provenance:

- `sourceSystem`
- `sourceType`
- `sourceLineId`
- `sourceInvoiceId`
- `sourceInvoiceReference`
- `rawSource`

Project and tenant context:

- `tenantId`
- `projectId`
- `externalProjectId`
- `projectReference`

Supplier and item:

- `supplierId`
- `supplierReference`
- `supplierName`
- `itemCode`
- `itemName`
- `ean`
- `catalogName`
- `catalogItemGroupName`

Economy and accounting:

- `financialAccount`
- `financialAccountName`
- `quantity`
- `unit`
- `unitPrice`
- `lineAmount`
- `foreignUnitPrice`
- `foreignLineAmount`
- `currency`
- `currencyRate`
- `discount`
- `vatType`

Classification:

- `transactionType`
- `sourceStatus`
- `costCategory`
- `isCorrection`
- `isNegative`
- `isMovedOrReversed`
- `classificationConfidence`
- `classificationReason`
- `uiBucketCandidate`
- `sourceRecordType`

Economic source values are normalized without rounding. Rounding belongs in presentation/calculation summaries, not source normalization.

## Source Types And UI Bucket Candidates

Current source types:

- `purchase_invoice_line` - ordinary direct V4 purchase invoice line provenance.
- `INTERNAL_PROJECT_MOVEMENT` - probable internal movement/correction candidate inferred from direct ProjectID purchase lines with `FinancialAccount=null` and `StatusEnum=4`.

Current UI bucket candidates:

- `LAGER_BIL` - probable match for EK UI `Materialer -> Lager/Bil -> Realiseret`.

`observed`: On project `80396-003` / EK ProjectID `25906`, 12 direct purchase invoice lines with `FinancialAccount=null` and `StatusEnum=4` summed to `95,904.77`, which rounds to the historical EK UI Lager/Bil actual value `95,905`.

`observed`: The candidate rows preserved their original transaction types and suppliers, including `RNTM ApS` `Type=Diverse/UE` rows totaling `94,405.00` and `DHL Freight Denmark A/S` `Type=Standard` rows totaling `1,499.77`.

`hypothesis`: This rule identifies the EK UI Lager/Bil bucket for IGVA material actual, but it is not an officially documented V4 Lager/Bil field.

Guardrails:

- Do not treat `INTERNAL_PROJECT_MOVEMENT` as a general material category.
- Do not overwrite the original `transactionType`, supplier, item, source status, or raw provenance.
- Do not automatically set `costCategory=MATERIAL` only because a row is a Lager/Bil candidate.
- IGVA may include `uiBucketCandidate=LAGER_BIL` and `classificationConfidence=PROBABLE` as a separate `lagerBilActualCandidate` component.
- The combined material actual quality is `VERIFIED_WITH_PROBABLE_COMPONENT`, not fully `VERIFIED`, when this component is used.

## Cost Categories

Minimum categories:

- `MATERIAL`
- `SUBCONTRACTOR`
- `OTHER_PURCHASE`
- `CORRECTION`
- `UNCLASSIFIED`

Classification rules in the current POC:

- `Type=Diverse/UE` => `SUBCONTRACTOR`; not `MATERIAL`.
- `FinancialAccount in (2020, 2030, 3880)` => `MATERIAL`, unless `Type=Diverse/UE`.
- `IGVA=true` and `Type=Standard` => `MATERIAL`, including negative and null-account rows, unless a consumer separates the row as a Lager/Bil UI bucket candidate.
- `FinancialAccount=null` and `StatusEnum=4` => `sourceType=INTERNAL_PROJECT_MOVEMENT`, `uiBucketCandidate=LAGER_BIL`, `classificationConfidence=PROBABLE`; original `costCategory` classification is preserved.
- Correction/reversal signals without material/subcontractor proof => `CORRECTION`.
- Insufficient source fields => `UNCLASSIFIED`.

Supplier name is supporting evidence only. It is not the sole classification truth.

## Corrections And Moved Rows

Negative rows, `StatusEnum=4`, and null financial account rows are legitimate project purchase events.

They must be normalized, flagged, and included or excluded by classification. They must not be dropped just because they look unusual.

`80279-003` proved why: three negative direct ProjectID purchase lines totaling `-6,810.98` were needed to explain the old V4 reconstruction difference.

## Dedupe

Primary direct ProjectID rows win.

Bridge rows are deduped by stable source identity:

```text
sourceSystem + sourceType + sourceLineId
```

When `sourceLineId` is missing, a fallback composite identity may use invoice id, project reference, transaction date, item code/name, and line amount.

The PurchaseInvoiceID bridge is fallback/enrichment only and must not be double-counted with direct ProjectID rows.

## IGVA Usage

IGVA consumes the generic normalized purchase-line layer.

Material actual in the IGVA POC is:

```text
classified creditor MATERIAL
+ lagerBilActualCandidate where uiBucketCandidate = LAGER_BIL and classificationConfidence = PROBABLE
```

Rows included in `lagerBilActualCandidate` are excluded from ordinary creditor MATERIAL aggregation to avoid double counting.

It is not:

```text
sum(all purchase lines)
sum(financialposts.value where account in 2020,2030,3880)
```

Current POC guardrail:

- Include material actual in weighted completion only when classification coverage is sufficient.
- Keep total quality separate from breakdown/source quality.
- Keep rows and category totals visible even when material actual is excluded from weighted completion.

Financialposts remain useful for voucher/accounting provenance and turnover, not as the primary material total.

## Future Persistence

No migration is included in this POC.

A later persisted model should be tenant-scoped and likely keyed by:

```text
tenant_id
source_system
source_type
source_line_id
```

Recommended future columns:

- Tenant/project identity
- Source invoice identity
- Supplier identity
- Raw item identifiers
- Canonical item identity when available
- Quantity/unit/economic fields
- Classification fields
- Correction/movement flags
- Raw source JSON
- Source timestamps and sync metadata

All project joins must include `tenant_id`.

## Future Permissions

Leader/manager purchase views may include prices, totals, supplier, invoice, discount, and financial provenance.

Employee/fitter purchase views may need material/item data without economic prices.

Price filtering must be server-side. Fielddesk must not send price fields to unauthorized clients and merely hide them with CSS or frontend JavaScript.

## Future Item Standardization

The model preserves:

- supplier item code
- raw item name
- EAN
- catalog name
- catalog item group

Future item matching may add `canonicalItemId`, but no AI matching or fuzzy matching is implemented now.

Example future goal:

```text
STRIPS SORT 200MM
KABELBINDER 200X4,8 SORT
```

could map to the same canonical item only after enough evidence exists.

## Future Kalkia Comparison

Canonical purchase data can later be compared with Kalkia expected material quantities.

Use terms like:

- purchased
- net purchased
- purchase actual

Do not call purchases "consumed" unless Fielddesk later has source data proving actual consumption.
