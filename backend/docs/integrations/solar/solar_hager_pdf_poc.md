# Solar Hager PDF Download / Metadata POC

Status: Proof of concept / controlled local admin run

This POC proves a small, allowlisted document flow for Solar CO2/EPD/PEP evidence. It does not call Solar APIs, does not crawl web pages, does not use AI parsing, and does not create CO2/GWP factors.

## Scope

Input database:

`C:\tmp\solar-product-catalog-dump-full-20260526-001431\solar_products.sqlite`

Allowlisted domain:

- `assets.hager.com`

Sample limit used:

- 15 queued Hager PDF evidence URLs

Local cache:

`C:\tmp\solar-product-catalog-dump-full-20260526-001431\document_cache\assets.hager.com\`

## Created Local Tables

The POC script creates local SQLite tables in the same import database:

- `document_download_queue`
- `downloaded_documents`
- `document_parse_runs`
- `parsed_document_evidence`

These are local/admin POC tables. They are not production schema and should not be treated as app-runtime DB design yet.

## Flow

1. Select Hager candidate evidence URLs from `co2_candidate_evidence`.
2. Enforce allowlist: only `https://assets.hager.com/*.pdf` URLs are accepted.
3. Seed a small download queue ordered by product coverage.
4. Download each PDF directly, with no browser crawling.
5. Cache each successful PDF by SHA-256 content hash.
6. Store HTTP status, content type, file size, source URL and timestamp.
7. Extract basic PDF metadata using Python stdlib only:
   - page count by PDF page markers
   - title if present in PDF metadata
   - text-ish preview from raw/decompressed streams
   - keyword evidence flags for EPD, PEP, EN15804, GWP, A1-A3, carbon and CO2
8. Store parse status and evidence flags.

## Result

Run command:

```powershell
python backend/scripts/solar_hager_pdf_poc.py --limit 15
```

Observed result:

- Queue items: 15
- Download attempts: 15
- Successful PDF downloads: 7
- Failed downloads: 8
- Unique content hashes: 7
- Parse success: 7
- Encrypted PDFs: 0
- Image-only PDFs: 0

Term detection from the very basic stdlib parser:

| Term | Documents found |
| --- | ---: |
| EPD | 0 |
| PEP | 2 |
| EN15804 | 0 |
| GWP | 0 |
| A1-A3 | 0 |
| carbon | 0 |
| CO2 | 0 |

Important interpretation: the low term hit rate is a parser limitation, not proof that the PDFs lack EPD/GWP content. The URLs and filenames clearly indicate PEP/EPD documents, but reliable extraction needs a stronger PDF text/table parser.

## Valuable Downloaded Examples

Successful Hager PDFs included:

- `TEH_PEP_HAGER_HAGE-00111-V02.01-EN_10082022.pdf`
  - 223276 bytes
  - 4 pages
  - content hash `e75964b7607307fef1d384be47e0b8698edcb275398cb1ba4d2314f330bcec51`

- `PEP_HAGER_HAGE-00686-V01.01-EN_10052022.pdf`
  - 224821 bytes
  - 4 pages
  - content hash `be31a5a83d48c493b2f3a897b7926ad1ebb7b08d944eabd5919a6967fe291edc`

- `PEP_HAGER_HAGE-00683-V01.01-EN.pdf`
  - 231963 bytes
  - 4 pages
  - content hash `efe59b779281527d64cb119706a918c5a558db0800d1614855dae9db9f9c495d`

- `PEP_ADA513D_HAGER_HAGE-00645-V01.03-EN_08092022.pdf`
  - 365695 bytes
  - 4 pages
  - content hash `9b38f80cfca72333adbe76846a74eb86722d2062b05a6c36335aaac0e5e7198f`
  - title detected: `LCA report template`

- `PEP_HAGE-01255-V01.01-EN.pdf`
  - 2351350 bytes
  - 23 pages
  - content hash `13c342f57c6626c31ded6b8dde75d22f5a3a8e9ff75d90a347c09952ae761228`

## Failures / Red Flags

8 of 15 queued URLs returned HTTP 404 with `application/xml` content type. This means Solar evidence can contain stale or moved Hager asset URLs.

Observed failed examples include:

- `PEP_HAGER_LFH_HAGE-00556-V01.02-EN_10062020.pdf`
- `PEP_HAGER_HAGE-00626-V01.01-EN.pdf`
- `PEP_HAGER_HAGE-00627-V01.01-EN.pdf`
- `PEP_GS16009010_HAGER_HAGE-00603-V01.01_EN_27102020.pdf`

This confirms the need for download status, failure storage and retry/fallback strategy before broad downloads.

## Parser Assessment

The controlled download/cache/hash part works.

The stdlib-only parser is not enough for CO2/GWP extraction:

- It can count pages approximately.
- It can detect some metadata/title strings.
- It can extract limited text-ish snippets.
- It does not reliably extract table text, lifecycle modules or GWP values.

No CO2/GWP values were extracted or invented.

## Recommended Next Step

Next technical slice should be a better parser, not more producers yet.

Recommended order:

1. Add a real PDF text/table extraction dependency or CLI strategy for local admin parsing.
2. Re-run the same 7 cached Hager PDFs without downloading again.
3. Verify whether terms like GWP, A1-A3, CO2 and EN15804 are present in extracted text/tables.
4. Only then design structured factor extraction and confidence scoring.
5. Expand to Schneider after Hager parser quality is acceptable.

Do not proceed to broad download or AI parsing before deterministic text/table extraction is working.
