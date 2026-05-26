# Solar Product SQLite Import Pipeline

Status: Draft / local admin utility

This document describes the first local import pipeline for the completed Solar product catalog dump. It is intended for CO2 Beregner reference work and later Fielddesk reuse. It is not app-runtime storage and it does not call Solar APIs.

## Scope

Input dump directory:

`C:\tmp\solar-product-catalog-dump-full-20260526-001431`

Required files:

- `solar_products_summary.json`
- `solar_products_normalized.jsonl`
- `solar_products_co2_candidates.jsonl`

The raw JSONL file is not imported in this phase. Normalized products and CO2/EPD/PEP candidate evidence are enough for lookup, prioritization and later document parsing.

## Principles

- No new Solar API calls.
- JSONL dump files are admin/dev artifacts and must not be committed.
- SQLite output is a local import artifact and must not be committed.
- Candidate rows are evidence only, not verified CO2 factors.
- GWP/CO2 values must never be invented. They can only be added later after document download/parsing and confidence scoring.
- `categoryName` is currently missing in normalized data and must be enriched later from a category dump or mapped from `categoryId`.

## SQLite Model

The importer creates a local SQLite database, by default:

`<dump-dir>\solar_products.sqlite`

Tables:

- `import_runs`: one row per imported dump directory.
- `products`: normalized Solar product reference rows.
- `product_identifiers`: GTIN/EAN/SAP/electrical/HWS/manufacturer identifiers.
- `product_documents`: document and deeplink URLs found on products.
- `product_images`: image URLs found on products.
- `product_status_history`: observed status per product import.
- `co2_candidate_evidence`: EPD/PEP/sustainability/environmental-profile evidence from candidate JSONL.
- `source_domains`: normalized domains referenced by documents, images and evidence.

The import is idempotent per `import_run_id`, where `import_run_id` is the dump folder name. Re-running the same import refreshes rows for that import run instead of creating duplicates.

## Run Import

From the repository root:

```powershell
python backend/scripts/import_solar_product_dump_to_sqlite.py --dump-dir C:\tmp\solar-product-catalog-dump-full-20260526-001431
```

Optional custom DB path:

```powershell
python backend/scripts/import_solar_product_dump_to_sqlite.py --dump-dir C:\tmp\solar-product-catalog-dump-full-20260526-001431 --db-path C:\tmp\solar-products-reference.sqlite
```

The command prints compact sanity results after import:

- product count
- identifier count
- document link count
- image link count
- candidate evidence row count
- source domain count
- duplicate Solar product IDs
- missing GTIN/EAN count
- status distribution
- top domains

## Expected Baseline

Completed dump baseline:

- Raw products: 485109
- Normalized products: 213214
- Status 40 excluded: 271895
- CO2/EPD/PEP candidates: 38450
- Duplicate identity keys in JSONL sanity review: 0
- Parse errors in JSONL sanity review: 0
- Stop reason: `no_rel_next`

The SQLite import may contain more candidate evidence rows than candidate products because one product can have multiple matching evidence links/terms.

## Next Phase

Recommended next phase is domain prioritization before app lookup UI:

1. Rank evidence domains by quality and volume.
2. Select a small set of high-value domains for document download/parsing tests.
3. Parse EPD/PEP/environmental profile PDFs into extracted factors with confidence.
4. Add verified CO2 factor tables only after parsing rules exist.
5. Build lookup UI against structured DB/API after the data quality model is clear.

## Fielddesk Reuse

The same imported dataset can later support Fielddesk as a product reference source, but not as runtime JSONL. A future Fielddesk import should move the same concepts into Postgres or a controlled backend import pipeline with tenant/security boundaries where relevant. The Solar source enriches product reference data; it must not become an authorization or tenant boundary.
