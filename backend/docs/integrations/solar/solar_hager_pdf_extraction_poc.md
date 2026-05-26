# Solar Hager PDF Extraction POC

Status: Proof of concept / local admin extraction

This document records the improved extraction pass over already cached Hager PEP/EPD PDFs. No Solar API calls, new PDF downloads, crawling, app UI work, or AI parsing were performed.

## Inputs

Cached PDFs:

`C:\tmp\solar-product-catalog-dump-full-20260526-001431\document_cache\assets.hager.com\*.pdf`

Local SQLite database:

`C:\tmp\solar-product-catalog-dump-full-20260526-001431\solar_products.sqlite`

Scripts:

- `backend/scripts/solar_pdfjs_extract_text.mjs`
- `backend/scripts/solar_hager_pdf_extract_poc.py`

PDF extraction dependency:

- `pdfjs-dist` from the local Restarbejde prototype dependency tree.
- Used only as an explicit local admin POC dependency.
- No new dependency was installed in Fielddesk.

## Run Command

```powershell
python -B C:\Users\dep\Projekter\Fielddesk_V3\backend\scripts\solar_hager_pdf_extract_poc.py
```

## Local SQLite Tables

The extraction POC creates:

- `extraction_runs`
- `parsed_environmental_values`

These are local/admin prototype tables only. They are not production schema.

## Result

- Cached PDFs parsed: 7
- Parse failures: 0
- Structured evidence rows: 406
- Page counts detected: 4 to 23 pages
- Common title detected: `LCA report template`

Detected evidence rows:

| Evidence | Status | Count |
| --- | --- | ---: |
| PEP | term detected | 122 |
| PEP identifier | identifier detected | 156 |
| GWP | term detected | 42 |
| CO2 | term detected | 61 |
| carbon | term detected | 10 |
| EN15804 | term detected | 1 |
| A1-A3 | term detected | 5 |
| A1-A3 | verified lifecycle stage | 7 |
| GWP value | uncertain extraction | 1 |
| CO2 value | uncertain extraction | 1 |

## Verified / Useful Evidence

The extractor can now reliably prove that the cached PDFs contain structured environmental declaration language and lifecycle stage references.

Useful examples:

- PEP identifier found:
  - `HAGE-01255-V01.01-EN`
  - document hash `13c342f57c6626c31ded6b8dde75d22f5a3a8e9ff75d90a347c09952ae761228`
  - page 1

- PEP program reference found:
  - `PEP-PCR-ed4-2021`
  - `PEP ecopassport`
  - document hash `13c342f57c6626c31ded6b8dde75d22f5a3a8e9ff75d90a347c09952ae761228`

- EN reference found:
  - snippet includes `Compliance: PEP ed.4, EN15804+A2`
  - document hash `13c342f57c6626c31ded6b8dde75d22f5a3a8e9ff75d90a347c09952ae761228`
  - page 3

- Lifecycle stage found:
  - `Manufacturing A1-A3`
  - `Distribution A4`
  - `Installation A5`
  - `Use B1-B7`
  - `End Of Life C1-C4`
  - document hash `13c342f57c6626c31ded6b8dde75d22f5a3a8e9ff75d90a347c09952ae761228`

## Uncertain Value Extraction

The extractor found numeric values near GWP/CO2 terms, but they are marked as uncertain and must not be treated as verified CO2 factors yet.

Examples:

- `GWP_VALUE` = `1.92E+00`, unit `kg CO2`, page 3
- `CO2_VALUE` = `1.11E-02`, unit `kg CO2`, page 3

These values are not accepted as verified factors because the current extraction does not yet preserve table columns well enough to prove lifecycle stage, unit scope and declared unit mapping.

## What Works

- Text extraction from cached Hager PDFs works with pdfjs.
- Page counts and metadata are available.
- PEP/EPD-style language is extractable.
- PEP identifiers and lifecycle stage labels can be found.
- Structured evidence can be persisted locally.
- Values can be detected cautiously and marked as uncertain.

## What Does Not Work Yet

- Table structure is not reliable enough.
- GWP/A1-A3 values cannot yet be verified end-to-end.
- Declared unit and lifecycle column mapping still need table-aware extraction.
- No OCR was attempted.
- No AI parsing was used.

## OCR Assessment

OCR is not needed for this Hager sample yet. The PDFs contain extractable text. The blocker is table reconstruction, not image-only pages.

## Recommended Next Step

Next technical slice should be better table extraction over the same cached PDFs.

Recommended order:

1. Add a table-aware parser strategy for local/admin extraction.
2. Re-run only the same cached Hager PDFs.
3. Preserve row/column structure for environmental impact tables.
4. Verify GWP values only when lifecycle stage, declared unit and unit are all mapped.
5. Only after that expand to more Hager PDFs or Schneider.

Do not move to OCR, broad downloads or AI parsing yet.
