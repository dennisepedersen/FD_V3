# CO2 / Hager Research Learnings

## Purpose

This note preserves business and methodology learnings from local Hager CO2 research POCs.

The research was performed to understand whether Fielddesk can extract evidence-backed CO2/EPD values from supplier PDF material, especially Hager PEP/EPD documents found through Solar-related product research.

The reviewed files are research artifacts, not production code. They should not be committed as scripts until a future CO2/EPD platform or module has a proper specification, data model, safety rules, and review workflow.

## PDF Layout Extraction Concept

Raw PDF text is insufficient for reliable CO2 extraction because table meaning depends on layout, not just words and numbers.

Important concepts:

- Layout coordinates: each text node needs page, x/y position, dimensions, font metadata where available, and line/block grouping.
- Table ownership: a numeric value only becomes meaningful when it can be tied to the correct row label, column header, lifecycle module, and unit.
- Evidence nodes: extraction should preserve the exact text nodes used as evidence, including indicator, value, unit, module header, parent header, and nearby row text.
- Document hashing: PDF hashes should be recorded so extracted values can be traced to a stable source document version.
- Candidate regions: GWP, CO2, lifecycle-module labels, declared/functional unit labels, and scientific notation can flag likely table regions, but these flags are only candidate signals.

The key learning is that CO2 extraction must be spatial and evidence-based. A string such as `1.91E+00` is not a CO2 value until its table ownership has been proven.

## Human Review Bundle Concept

Automatic candidate generation is not enough for trusted CO2 values.

The review bundle concept preserves a workflow where extracted candidates are made reviewable by humans:

- Candidate generation: potential table cells or table regions are identified from layout nodes and heuristics.
- Overlay review: SVG or similar overlays can show the candidate bounding box and surrounding text layout.
- Human validation workflow: reviewers can inspect candidates and mark them pending, rejected, reviewed, or verified.
- Review evidence: review bundles should include enough context to understand why a value was proposed without needing to rerun the extraction.

The important principle is that automation can propose candidates, but humans or strict deterministic checks must validate the evidence before a value becomes operationally trusted.

## Verified Extraction Policy

Verified extraction requires explicit ownership checks. Confidence labels alone are not enough.

Useful policy rules:

- Ownership checks: the extraction must prove which indicator, module, value, and unit belong together.
- Row ownership: the indicator, value, and unit should align on the same row within a defined tolerance.
- Column ownership: the value must align under the correct lifecycle/module header within a defined tolerance.
- Module ownership: lifecycle stages such as A1-A3 must be tied to the correct column and parent section.
- Unit validation: the unit must be present and linked to the same row or table structure as the value.
- Conflict checks: there should be no competing GWP/climate-change indicators on the same row that make ownership ambiguous.
- Confidence requirements: `verified` should only be emitted when all required deterministic checks pass; otherwise the value should remain `candidate` or `uncertain`.

This policy intentionally avoids fuzzy inference as the basis for verified CO2 data.

## CO2 / EPD Principles Learned

The research highlighted several principles for CO2 and EPD handling:

- GWP interpretation: Global Warming Potential values must be tied to the exact indicator name, scope, lifecycle module, unit, and source document.
- Lifecycle module mapping: modules such as A1-A3, A4, A5, B1-B7, C1-C4, and Module D have different meanings and must not be mixed.
- A1-A3 handling: A1-A3 is commonly used as a manufacturing/product-stage figure, but it must still be proven from the document table.
- Evidence traceability: every accepted value should link back to document hash, page, evidence nodes, bounding boxes, and extraction/review status.
- Verified vs inferred values: inferred or candidate values can support research, but they should not be treated as verified product CO2 data.

The central lesson is that CO2 values are not just product attributes. They are claims that need evidence, provenance, and review state.

## Future Architecture Implications

Future Fielddesk CO2 functionality should distinguish between data ingestion, candidate extraction, human review, and verified publication.

Architecture implications:

- CO2 values should be evidence-backed because supplier documents can vary in layout, language, unit placement, and table structure.
- Auditability matters because CO2 values may affect procurement, reporting, compliance, and customer-facing decisions.
- Confidence alone is insufficient because a high-confidence extractor can still attach the right number to the wrong lifecycle module or unit.
- Fielddesk should preserve the path from raw source to verified value.

Fielddesk should distinguish these states:

- `raw`: source document or extracted text/layout data with no interpretation.
- `candidate`: machine-identified possible CO2 value or table region.
- `reviewed`: human or system-reviewed candidate with documented outcome.
- `verified`: value with deterministic evidence checks and accepted review status.

Potential future data should include source document identity, document hash, page number, value, unit, lifecycle module, indicator, confidence/status, evidence nodes, review metadata, and audit timestamps.

## Research Artifacts Reviewed

- `solar_hager_pdf_layout_extract_poc.py`
- `solar_hager_pdf_review_bundle_poc.py`
- `solar_hager_verified_extraction_poc.py`
