# Solar Hager PDF Table Reconstruction POC

Status: Proof of concept / local admin table candidate reconstruction

This POC reads layout JSONL from the Hager PDF layout extraction phase and builds table candidates. It does not verify CO2/GWP values and does not write to runtime app state.

## Purpose

The layout extraction POC produced text nodes with coordinates from already cached Hager PDFs. This table reconstruction POC groups those nodes into candidate rows, infers approximate columns and identifies possible environmental table regions.

The goal is structural reconstruction only. Verified GWP extraction is deliberately deferred.

## Input

Layout JSONL:

`C:\tmp\solar-product-catalog-dump-full-20260526-001431\layout_poc\hager_pdf_layout_nodes.jsonl`

Each input row contains:

- document hash
- cache PDF path
- page number
- text
- x/y bounds
- font size
- line/block hints
- candidate flags from layout extraction

## Output

Local POC output under:

`C:\tmp\solar-product-catalog-dump-full-20260526-001431\layout_poc\`

Files:

- `hager_pdf_table_candidates.jsonl`
- `hager_pdf_table_reconstruction_summary.json`

These output files are local artifacts and must not be staged or committed.

## Clustering Principles

The script uses deterministic heuristics:

1. Group text nodes by PDF and page.
2. Sort nodes by `y0`, then `x0`.
3. Cluster nodes into rows using a configurable Y tolerance.
4. Find seed rows containing lifecycle stages, GWP/CO2 labels, declared-unit terms or scientific notation.
5. Expand candidates with nearby context rows and adjacent numeric rows.
6. Infer approximate columns from repeated X positions among relevant nodes.

This is intentionally conservative: output is `candidate` and `uncertain` only.

## Table Candidate Model

Each table candidate includes:

- `pdf_cache_reference`
- `document_hash`
- `page_number`
- `table_candidate_id`
- `status = candidate`
- `confidence = uncertain`
- bounding box
- rows with row text and row bounding boxes
- inferred columns
- header candidates
- lifecycle stage candidates
- GWP/CO2 label candidates
- declared unit candidates
- numeric value candidates
- extraction method

## What It Does Not Do

- It does not mark values as verified.
- It does not select an A1-A3 value.
- It does not guess declared unit.
- It does not map lifecycle stages to values without evidence.
- It does not write to SQLite runtime DB.
- It does not change Tauri/frontend/runtime app code.
- It does not download PDFs or call Solar APIs.

## Run

Small sample:

```powershell
python -B backend/scripts/solar_hager_pdf_table_reconstruct_poc.py --limit-lines 5000
```

Full layout POC output:

```powershell
python -B backend/scripts/solar_hager_pdf_table_reconstruct_poc.py
```

## Current POC Metrics

The full run over the existing Hager layout JSONL produced:

- Nodes read: 59252
- Documents seen: 7
- Pages seen: 47
- Table candidates: 70
- Candidates with lifecycle evidence: 69
- Candidates with GWP/CO2 label evidence: 22
- Candidates with declared-unit evidence: 64
- Numeric value candidates: 18096
- Verified values: 0

The high numeric candidate count confirms dense environmental tables. It also confirms why verification must wait until row/column mapping is stronger.

## What Is Still Uncertain

- Y clustering tolerance may merge or split table rows incorrectly.
- X-position clustering is approximate and not yet validated visually.
- Numeric values are candidates only; they are not associated with lifecycle stages yet.
- Header detection is still heuristic.
- Large tables can create broad candidates with many numeric values.
- Declared unit terms may appear outside the relevant table.

## Why Values Are Not Verified Yet

A value can only become verified when all of this can be traced to evidence:

- environmental indicator row, such as Climate Change / GWP
- lifecycle stage column, such as A1-A3
- numeric value
- unit
- declared unit / functional unit
- source document and page

This POC only reconstructs candidate table regions. It does not prove the final mapping.

## Next Phase

Build a verified GWP extraction prototype over the table candidates:

1. Reconstruct rows/columns more strictly for one known Hager document.
2. Detect header rows and lifecycle-stage columns.
3. Detect GWP/Climate Change indicator rows.
4. Map cell intersections only when row and column evidence is clear.
5. Emit `verified` only when declared unit, unit, lifecycle stage and value are all supported.

