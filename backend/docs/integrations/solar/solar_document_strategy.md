# Solar Document Strategy for CO2/EPD/PEP Parsing

Status: Draft / analysis and design phase

This document prioritizes Solar product document sources for future CO2/GWP extraction. It is based on the completed Solar dump imported into local SQLite:

`C:\tmp\solar-product-catalog-dump-full-20260526-001431\solar_products.sqlite`

No Solar API calls, PDF downloads, AI parsing, or CO2/GWP factor extraction were performed in this phase.

## Baseline

Imported reference data:

- Normalized products: 213214
- CO2/EPD/PEP candidate products: 38450
- Candidate evidence rows: 49443
- Source domains: 838
- PDF-like document rows: 430054
- Duplicate Solar product IDs: 0
- Candidates without matching product: 0

Candidate evidence distribution:

- EPD evidence rows: 28547
- PEP evidence rows: 7142
- Environmental profile evidence rows: 7321
- Sustainability evidence rows: 852
- Keyword/no-domain evidence rows still need filtering before parsing.

## Domain Groups

### High-Value Manufacturer / Declaration Sources

These domains should be prioritized because they contain direct product/environmental declarations, large evidence volume, and likely repeatable layouts.

| Priority | Domain | Evidence rows | Products | Main signals | Assessment |
| --- | ---: | ---: | ---: | --- | --- |
| 1 | `download.schneider-electric.com` | 9554 | 6772 | PEP + EPD | Strong first target. Large volume, manufacturer-owned, likely standardized Schneider PEP/PDF layouts. |
| 2 | `assets.hager.com` | 371 | 342 | PEP + EPD | Excellent golden-path target. URLs contain clear PEP filenames and direct PDFs. Lower volume but very parseable. |
| 3 | `cache.industry.siemens.com` | 2138 | 2134 | EPD | High-volume Siemens source, likely stable PDF assets. |
| 4 | `search.abb.com` | 2304 | 2149 | EPD + environmental profile | Strong ABB source; should be tested after one simpler producer flow. |
| 5 | `assets.signify.com` | 514 | 510 | EPD | Good lighting domain, likely structured product declarations. |
| 6 | `assets.legrand.com` | 579 | 579 | environmental profile + PEP | Good medium-volume source with manufacturer-owned assets. |
| 7 | `assets.danfoss.com` | 205 | 205 | EPD | Smaller but likely high-quality manufacturer PDFs. |
| 8 | `eco-performance.wibe-group.com` | 362 | 360 | PEP + EPD | Domain suggests purpose-built environmental data, useful after core producer parsers. |
| 9 | `files.etim-mapper.com` | 820 | 820 | EPD | Useful but may be aggregator/mapping oriented rather than source declaration owner. |
| 10 | `register.pep-ecopassport.org` | 85 | 85 | PEP | Authoritative PEP registry, lower Solar coverage but strategically important. |

### High-Volume Aggregator / Product Data Sources

These are valuable for discovery and linking, but should not be the first parsing target unless they expose stable direct PDFs.

- `mdgdata.solar.eu`: 11669 evidence rows and 220k+ PDF-like document rows. Very valuable as Solar-hosted document aggregation, but likely mixed document types and many producer layouts.
- `e-nummersok.se`: 3845 evidence rows, mostly EPD. Good Nordic product database source, likely useful after manufacturer-specific flows.
- `efobasen.efo.no`: 4763 evidence rows, many environmental profile hits. Useful for Nordic evidence but may require source-specific parsing rules.
- `att.2ba.nl`: 1178 EPD evidence rows. Potentially useful, but should be treated as an aggregator first.
- `rskdatabasen.se`: 410 EPD evidence rows. Useful later for plumbing-related categories.

### Image/CDN Domains

These should be ignored for CO2 parsing unless they also appear as document evidence with direct PDFs.

- `res.cloudinary.com`: 201792 image rows; image/CDN source, not a CO2 document source.
- `media.solar.eu`: many image/media rows; can contain documents but noisy.
- Null/blank image domain rows: imported image references without parseable host; not useful for document parsing.

### Redirect / Gateway / Low-Value First Targets

These are lower priority for first parser work because they are likely product pages, search gateways, mixed media, or non-declaration links.

- `youtube.com`: not useful for CO2/GWP extraction.
- `mall.industry.siemens.com`: product/catalog gateway; prefer `cache.industry.siemens.com` PDFs first.
- `checkaproduct.se.com`: useful Schneider discovery gateway; prefer direct `download.schneider-electric.com` PDFs first.
- `se.com`: manufacturer web pages/mixed assets; prefer direct download domain first.
- `static.siemens.com`: mixed static assets; lower priority than Siemens cache PDFs.
- `siemens-embedded.partcommunity.com`: likely CAD/configurator content, not first CO2 target.

## Recommended Golden Path

Start with Hager, then Schneider Electric.

### Step 1: Hager PEP/EPD PDFs

Why Hager first:

- Direct PDF URLs on `assets.hager.com`.
- Clear filenames such as `PEP_HAGER_...pdf`.
- Strong PEP/Product Environmental Profile signals.
- Smaller corpus than Schneider, making it ideal for parser validation.
- Same document often maps to multiple Solar products, so hash/dedupe can prove value quickly.

Goal for first prototype:

- Download a tiny allowlisted sample later, not now.
- Hash and dedupe PDFs.
- Extract declaration metadata, product scope, declared unit and GWP table if present.
- Link extracted evidence back to Solar product IDs and identifiers.

### Step 2: Schneider Electric PEP/EPD PDFs

Why Schneider second:

- Largest high-quality manufacturer target.
- `download.schneider-electric.com` has 9554 evidence rows.
- Strong PEP signal and likely standardized layouts.
- Important brands in Solar data: Schneider Electric has 13700 evidence rows across domains.

Use Hager to prove the parser pipeline before scaling to Schneider volume.

### Step 3: Siemens / ABB

- Siemens: prefer `cache.industry.siemens.com` before catalog gateways.
- ABB: use `search.abb.com` evidence, then classify whether URLs are direct PDFs or registry/search results.

## Future Parser Architecture

### 1. Download Queue

Create a queue of document URLs from `co2_candidate_evidence` and `product_documents`.

Minimum fields:

- `document_url`
- `url_hash`
- `source_domain`
- `source_product_id`
- `solar_product_id`
- `brand`
- `evidence_type`
- `priority_score`
- `status`
- `retry_count`
- `last_error`

Initial queue should be domain-allowlisted. Do not crawl broad domains blindly.

### 2. Document Cache

Downloaded files should be cached by content hash, not only URL.

Minimum concepts:

- `document_hash`
- `url_hash`
- `content_type`
- `file_size`
- `downloaded_at`
- `source_domain`
- `storage_path`

This prevents downloading the same PEP/EPD repeatedly when multiple products share one declaration PDF.

### 3. Parser Pipeline

Suggested stages:

1. Fetch metadata/head where possible.
2. Download PDF for allowlisted domains only.
3. Compute content hash and dedupe.
4. Extract text/tables.
5. Detect document type: EPD, PEP, environmental profile, sustainability only.
6. Extract declaration metadata.
7. Extract GWP/CO2 factors only when explicitly present.
8. Assign confidence and parse warnings.
9. Store raw evidence snippets and page/table references.

No CO2/GWP values should be generated from product category, brand, or model similarity.

### 4. Confidence Model

Parsed values should include confidence and provenance:

- `high`: direct table match with declared unit, lifecycle stage and document metadata.
- `medium`: value found but lifecycle stage/unit needs normalization.
- `low`: environmental claim found but no reliable numeric factor.
- `rejected`: document is not a declaration or no parseable factor exists.

### 5. Retry / Failure Handling

Failures should be first-class rows, not console-only logs:

- HTTP error
- content-type mismatch
- oversized file
- extraction failure
- unsupported language/layout
- no GWP table found
- ambiguous units

## Product Linking Strategy

Parsed data should link back to products through several keys:

1. Solar product ID: primary link from imported Solar data.
2. GTIN/EAN: useful for cross-source matching and Fielddesk lookup.
3. SAP material number / Solar identifiers: useful inside Solar-derived datasets.
4. Brand + manufacturer part number: fallback match only, lower confidence.
5. ETIM/category: useful for grouping and prioritization, not as proof of a factor.
6. Document hash: one declaration may cover multiple products.

`categoryName` is still missing in the normalized dump, so category enrichment should use `categoryId` until category data is imported.

## Low-Priority / Ignore Rules

Ignore or defer:

- Image/CDN-only domains, especially `res.cloudinary.com`.
- YouTube/video links.
- Product configurator/CAD domains unless they link to direct declarations.
- Search pages and catalog gateways when direct PDF asset domains exist.
- Sustainability marketing pages without declaration PDFs or numeric GWP tables.
- Null-domain evidence until URL extraction has been improved.

## Red Flags

- Evidence rows are not verified factors.
- Some domains are aggregators and may duplicate manufacturer PDFs.
- Direct PDF count is large enough to require queueing, dedupe and rate limiting.
- PEP/EPD labels can appear in snippets without a usable GWP table.
- One declaration can apply to many product variants; linking must allow many products per document hash.
- Broad PDF download without allowlisting risks unnecessary load and noisy data.

## Recommended Next Step

Build a small PDF download queue, but keep it metadata-first and allowlisted:

1. Select Hager sample URLs from `assets.hager.com`.
2. Dedupe by URL hash before download.
3. Download a very small sample set.
4. Store content hash and metadata.
5. Inspect text/table extraction manually.
6. Only then prototype parser rules.

Do not start with AI parsing or full-domain crawling.
