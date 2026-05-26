# Solar Integration - Product Data, Documents, and CO2 Candidates

## Status

Draft / Proposed. Solar product catalog dump completed and sanity reviewed on 2026-05-26.

This document is documentation only. It does not implement Solar runtime integration, database schema, API routes, document parsing, or app UI.

---

## Scope

Solar product data can later support:

- CO2 Beregner product lookup and CO2/EPD/PEP candidate discovery.
- Fielddesk material/product enrichment.
- Product master references for future project material flows.
- Document links for datasheets, EPD, PEP, images, deep links, and manufacturer documentation.

FD frontend must not call Solar directly. Solar credentials and token flows belong in backend/admin tooling only.

---

## Completed Dev/Admin Dump

Dump folder:

`C:\tmp\solar-product-catalog-dump-full-20260526-001431`

Sanity review result:

| Metric | Count |
| --- | ---: |
| Raw products | 485109 |
| Normalized products | 213214 |
| Status 40 excluded | 271895 |
| CO2/EPD/PEP candidates | 38450 |
| Pages | 494 |
| Duplicate identity keys | 0 |
| Parse errors | 0 |
| Completed | true |
| Stop reason | no_rel_next |

File sizes:

| File | Approx size |
| --- | ---: |
| Raw JSONL | 2.85 GB |
| Normalized JSONL | 367 MB |
| CO2 candidates JSONL | 132 MB |

Conclusion:

- The dump is production-grade as a reference/input dataset.
- The dump is not suitable as app runtime storage.
- JSONL should be treated as import/source artifacts, not queried directly by FD or CO2 Beregner UI.
- Future runtime lookup should use SQLite/Postgres or another indexed import pipeline.

---

## Important Constraint: No Invented CO2 Values

GWP/CO2 values must not be invented, estimated, inferred, or filled from product names alone.

Allowed now:

- Mark products as CO2/EPD/PEP candidates.
- Store links and evidence text that indicate possible EPD/PEP/environmental documentation.
- Prioritize domains and documents for later parsing.

Deferred:

- Extracting actual GWP/CO2 factors from documents.
- Confidence scoring for parsed values.
- Unit normalization and lifecycle-stage mapping.
- Verification against source PDF/EPD/PEP documents.

---

## Data Quality Notes

Strong fields:

- GTIN/EAN present for almost all normalized products.
- Brand present for almost all normalized products.
- Product name/description present for all normalized products.
- Image links and document links are broadly available.
- Candidate dataset has many PDF/document URLs.

Known gaps:

- `categoryName` is broadly missing in normalized data.
- Category enrichment should happen later through a category dump or mapping by `categoryId` / `categoryCode`.
- Candidate detection is keyword/link based and may contain false positives.
- Some document URLs are generic pages, images, videos, or product pages rather than parseable EPD/PEP PDFs.
- A small number of products have missing/blank status.

---

## Status Distribution

Raw status counts:

| Status | Count |
| --- | ---: |
| 10 | 205058 |
| 11 | 5682 |
| 30 | 426 |
| 33 | 1443 |
| 40 | 271895 |
| 00 | 472 |
| missing/blank | 133 |

Normalized status counts, after excluding status 40:

| Status | Count |
| --- | ---: |
| 10 | 205058 |
| 11 | 5682 |
| 30 | 426 |
| 33 | 1443 |
| 00 | 472 |
| missing/blank | 133 |

---

## High-Value CO2/EPD/PEP Sources

Candidate analysis found 38450 products and about 300 unique link domains.

High-value domains for future parsing:

- `mdgdata.solar.eu`
- `download.schneider-electric.com`
- `se.com`
- `checkaproduct.se.com`
- `cache.industry.siemens.com`
- `mall.industry.siemens.com`
- `search.abb.com`
- `new.abb.com`
- `assets.signify.com`
- `eco-performance.wibe-group.com`
- `files.etim-mapper.com`
- `assets.legrand.com`
- `assets.hager.com`
- `assets.danfoss.com`

Candidate signal counts:

| Signal | Candidate count / URL count |
| --- | ---: |
| EPD candidates | 28359 |
| PEP candidates | 14872 |
| Environmental profile candidates | 13508 |
| Sustainability candidates | 962 |
| Candidates with PDF-like URLs | 31070 |
| Total PDF URL occurrences | 207684 |

Priority for parsing:

1. Schneider/SE domains: strong EPD/PEP profile and repeatable URL patterns.
2. Siemens domains: many technical/PDF links, likely structured manufacturer content.
3. ABB domains: useful manufacturer documentation and environmental docs.
4. Solar-hosted `mdgdata.solar.eu`: important because it aggregates many source documents.
5. Wibe/Signify/Legrand/Hager/Danfoss domains: targeted later passes.

---

## Proposed Import Pipeline For CO2 Beregner

### Phase 1 - Import Normalized + Candidates To Local DB

Goal:

- Import `solar_products_normalized.jsonl` and `solar_products_co2_candidates.jsonl` into an indexed local DB.
- Keep JSONL files as immutable source artifacts.
- Do not parse GWP/CO2 values yet.

Recommended storage:

- SQLite for fast local prototype and analyst workflows.
- Postgres if the dataset becomes shared across FD backend services.

### Phase 2 - Candidate Domain Prioritization

Goal:

- Rank document/source domains by expected parsing value.
- Separate PDFs from product pages, image links, videos, and generic web pages.
- Group candidates by brand/domain/document type.

### Phase 3 - Document Download And Parsing

Goal:

- Download only prioritized documents.
- Track source URL, checksum, content type, file size, fetch status, and parse status.
- Do not download everything blindly.
- Respect rate limits and avoid frontend/runtime fetching.

### Phase 4 - CO2 Factor Extraction And Confidence

Goal:

- Extract GWP/CO2 factors from source documents.
- Store lifecycle stage, unit, declared unit, source page/text evidence, parser version, and confidence.
- Do not accept values without source evidence.

### Phase 5 - App Lookup UI

Goal:

- Let users search product/GTIN/Solar number/brand/name.
- Show product master fields, documents, candidate status, and verified CO2 factors when available.
- Clearly distinguish `candidate`, `parsed`, `verified`, and `not found`.

---

## Proposed DB Model

Draft tables for CO2 Beregner / future FD product master:

### import_runs

Purpose:

- Track each Solar dump/import.

Suggested fields:

- `id`
- `source`
- `output_dir`
- `started_at`
- `completed_at`
- `completed`
- `stop_reason`
- `raw_count`
- `normalized_count`
- `excluded_status40_count`
- `candidate_count`
- `parser_version`
- `created_at`

### products

Purpose:

- One row per normalized Solar product.

Suggested fields:

- `id`
- `import_run_id`
- `source`
- `catalog_id`
- `country_code`
- `solar_product_id`
- `sap_material_number`
- `product_name`
- `description`
- `brand`
- `series`
- `category_id`
- `category_code`
- `category_name`
- `etim_class`
- `unspsc`
- `status_code`
- `status_label`
- `is_phased_out`
- `last_changed`
- `has_possible_co2_epd_pep_source`
- `raw_normalized_json`
- `created_at`

### product_identifiers

Purpose:

- Searchable identifiers per product.

Suggested fields:

- `id`
- `product_id`
- `identifier_type` such as `gtin`, `ean`, `electrical_number`, `hws_number`, `manufacturer_part_number`, `sap_material_number`
- `identifier_value`
- `created_at`

### product_documents

Purpose:

- Document links and future downloaded document metadata.

Suggested fields:

- `id`
- `product_id`
- `source_domain_id`
- `url`
- `url_hash`
- `document_type` such as `datasheet`, `epd`, `pep`, `environmental_profile`, `manual`, `unknown`
- `is_pdf_like`
- `link_source` such as `documentLinks`, `deepLinks`, `co2Evidence`
- `download_status`
- `content_type`
- `file_size_bytes`
- `checksum`
- `storage_object_id`
- `created_at`

### product_images

Purpose:

- Image links and future local/cache metadata.

Suggested fields:

- `id`
- `product_id`
- `url`
- `url_hash`
- `source_domain_id`
- `is_primary`
- `storage_object_id`
- `created_at`

### product_status_history

Purpose:

- Preserve status movement across imports.

Suggested fields:

- `id`
- `product_id`
- `import_run_id`
- `status_code`
- `status_label`
- `observed_at`

### co2_candidate_evidence

Purpose:

- Store why a product is considered a CO2/EPD/PEP candidate.

Suggested fields:

- `id`
- `product_id`
- `document_id`
- `evidence_type` such as `pep`, `epd`, `sustainability`, `environmental_profile`, `pdf_link`, `keyword`
- `evidence_text`
- `evidence_url`
- `source_field`
- `confidence_hint`
- `created_at`

### source_domains

Purpose:

- Normalize and prioritize link domains.

Suggested fields:

- `id`
- `domain`
- `source_type` such as `solar`, `manufacturer`, `document_registry`, `video`, `image_cdn`, `unknown`
- `priority`
- `notes`
- `created_at`

---

## Normalized JSONL Import Direction

Import `solar_products_normalized.jsonl` as the authoritative normalized product artifact for this run.

Import rules:

- One `products` row per `solarProductId` / stable product identity.
- Keep `raw_normalized_json` for traceability during early pipeline work.
- Split identifiers into `product_identifiers`.
- Split image links into `product_images`.
- Split document and deep links into `product_documents` where useful.
- Store status in `products` and `product_status_history`.
- Preserve `import_run_id` on all imported rows.

Do not:

- Use JSONL directly in app runtime.
- Treat candidate flags as verified CO2 values.
- Invent missing categories.

---

## Candidates JSONL Import Direction

Import `solar_products_co2_candidates.jsonl` as candidate/evidence data.

Import rules:

- Match candidate rows to `products` by stable identity.
- Import `co2Evidence` into `co2_candidate_evidence`.
- Extract evidence URLs and domains into `product_documents` and `source_domains`.
- Mark candidate evidence type from keyword/source URL patterns.
- Keep original candidate row JSON during early pipeline work if needed.

Do not:

- Treat candidates as verified EPD/PEP/GWP records.
- Download all candidate documents in one uncontrolled batch.
- Parse or persist CO2 factors without source evidence and confidence metadata.

---

## Fielddesk Reuse

The same dataset can later support Fielddesk as:

- Product master lookup by GTIN/EAN, Solar product ID, SAP material number, manufacturer part number, brand, and name.
- Material/product enrichment for project lines, purchase flows, documentation modules, and CO2/ESG modules.
- Document link registry for datasheets, images, EPD/PEP candidates, and manufacturer documents.
- Future product summaries inside project context.

FD-specific constraints:

- Solar integration must remain backend-owned.
- Frontend must not receive Solar credentials or raw token context.
- Tenant-specific Solar access model is unresolved.
- Product master can be shared/reference data, but project usage and audit must be tenant/project scoped.
- Storage/downloaded documents must follow `docs/STORAGE_CONTRACT.md`.
- Report/export/document access must be auditable.

---

## Red Flags And Assumptions

Red flags:

- JSONL files are too large for runtime use.
- `categoryName` is missing and needs enrichment.
- Candidate detection may include false positives.
- PDF/document links may expire, redirect, or require different headers.
- Some domains are image/video/product-page sources, not parseable CO2 documents.
- GWP/CO2 extraction requires document parsing and confidence handling.

Assumptions:

- The completed dump is a source artifact, not a live sync mechanism.
- Later imports should be idempotent and linked to `import_runs`.
- CO2 Beregner can start with a local DB before FD backend integration.
- FD product master should not depend on local files in `C:\tmp`.

---

## Next Recommended Action

Create a read-only/import-only technical plan for the local DB importer:

1. Choose SQLite or Postgres for the first import prototype.
2. Define exact DDL for the proposed tables.
3. Build import script for normalized JSONL.
4. Build import script for candidates JSONL.
5. Run local import against a new local DB/file.
6. Add sanity queries for counts, duplicates, domains, and candidate evidence.
7. Only then design document download/parsing.
