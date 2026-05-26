#!/usr/bin/env python3
"""Reconstruct candidate table regions from Hager PDF layout JSONL.

Reads local layout POC output only. Does not download PDFs and does not verify CO2 values.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

SCI_RE = re.compile(r"[-+]?\d+(?:[.,]\d+)?E[-+]?\d+", re.I)
LIFECYCLE_RE = re.compile(r"\b(A1\s*[-–/]?\s*A3|A4|A5|B1\s*[-–/]?\s*B7|C1\s*[-–/]?\s*C4|Module\s+D|Manufacturing|Distribution|Installation|Use|End\s+Of\s+Life)\b", re.I)
GWP_RE = re.compile(r"\b(GWP|global warming potential|climate change|CO2|CO₂|carbon)\b", re.I)
UNIT_RE = re.compile(r"\b(functional unit|declared unit|reference product|unit|kg\s*CO2|kg\s*CO₂|kg\s+of|MJ|m3|mol|CTU)\b", re.I)


def now() -> str:
    return dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_nodes(path: Path, limit_lines: int | None = None):
    count = 0
    with path.open("r", encoding="utf-8-sig") as handle:
        for line in handle:
            if not line.strip():
                continue
            yield json.loads(line)
            count += 1
            if limit_lines and count >= limit_lines:
                break


def bbox(nodes: list[dict[str, Any]]) -> dict[str, float]:
    return {
        "x0": min(float(n["x0"]) for n in nodes),
        "y0": min(float(n["y0"]) for n in nodes),
        "x1": max(float(n["x1"]) for n in nodes),
        "y1": max(float(n["y1"]) for n in nodes),
    }


def row_text(row: dict[str, Any]) -> str:
    return " ".join(n["text"] for n in row["nodes"]).strip()


def cluster_rows(nodes: list[dict[str, Any]], y_tolerance: float) -> list[dict[str, Any]]:
    sorted_nodes = sorted(nodes, key=lambda n: (float(n["y0"]), float(n["x0"])))
    rows: list[dict[str, Any]] = []
    for node in sorted_nodes:
        y = float(node["y0"])
        target = None
        for row in rows[-5:]:
            if abs(y - row["y_center"]) <= y_tolerance:
                target = row
                break
        if target is None:
            target = {"nodes": [], "y_values": [], "y_center": y}
            rows.append(target)
        target["nodes"].append(node)
        target["y_values"].append(y)
        target["y_center"] = sum(target["y_values"]) / len(target["y_values"])
    for idx, row in enumerate(rows, start=1):
        row["nodes"] = sorted(row["nodes"], key=lambda n: float(n["x0"]))
        row["row_id"] = idx
        row["text"] = row_text(row)
        row["bbox"] = bbox(row["nodes"])
        row["flags"] = flags(row["text"])
    return rows


def flags(text: str) -> dict[str, bool]:
    return {
        "contains_lifecycle_stage": bool(LIFECYCLE_RE.search(text)),
        "contains_gwp_or_co2_label": bool(GWP_RE.search(text)),
        "contains_declared_unit_candidate": bool(UNIT_RE.search(text)),
        "contains_numeric_scientific_notation": bool(SCI_RE.search(text)),
    }


def infer_columns(rows: list[dict[str, Any]], x_tolerance: float) -> list[dict[str, Any]]:
    xs: list[float] = []
    for row in rows:
        for node in row["nodes"]:
            text = node["text"]
            if SCI_RE.search(text) or GWP_RE.search(text) or LIFECYCLE_RE.search(text) or UNIT_RE.search(text):
                xs.append(float(node["x0"]))
    xs.sort()
    clusters: list[list[float]] = []
    for x in xs:
        if not clusters or abs(x - (sum(clusters[-1]) / len(clusters[-1]))) > x_tolerance:
            clusters.append([x])
        else:
            clusters[-1].append(x)
    columns = []
    for idx, cluster in enumerate(clusters, start=1):
        center = sum(cluster) / len(cluster)
        columns.append({"column_id": idx, "x_center": round(center, 2), "observations": len(cluster)})
    return columns


def row_score(row: dict[str, Any]) -> int:
    f = row["flags"]
    score = 0
    if f["contains_lifecycle_stage"]: score += 3
    if f["contains_gwp_or_co2_label"]: score += 4
    if f["contains_declared_unit_candidate"]: score += 2
    if f["contains_numeric_scientific_notation"]: score += 2
    if f["contains_numeric_scientific_notation"] and (f["contains_lifecycle_stage"] or f["contains_gwp_or_co2_label"]): score += 4
    return score


def find_candidates(doc_hash: str, cache_pdf: str, page_number: int, page_nodes: list[dict[str, Any]], y_tolerance: float, x_tolerance: float, context_rows: int) -> list[dict[str, Any]]:
    rows = cluster_rows(page_nodes, y_tolerance)
    seed_indices = [i for i, r in enumerate(rows) if row_score(r) >= 4]
    candidates = []
    used_ranges: list[tuple[int, int]] = []
    for seed in seed_indices:
        start = max(0, seed - context_rows)
        end = min(len(rows) - 1, seed + context_rows)
        # Expand across adjacent numeric rows, common in environmental tables.
        while start > 0 and rows[start - 1]["flags"]["contains_numeric_scientific_notation"]:
            start -= 1
        while end + 1 < len(rows) and rows[end + 1]["flags"]["contains_numeric_scientific_notation"]:
            end += 1
        if any(not (end < a or start > b) for a, b in used_ranges):
            continue
        used_ranges.append((start, end))
        cand_rows = rows[start:end + 1]
        all_nodes = [node for row in cand_rows for node in row["nodes"]]
        columns = infer_columns(cand_rows, x_tolerance)
        texts = [r["text"] for r in cand_rows]
        lifecycle = sorted({m.group(0) for t in texts for m in LIFECYCLE_RE.finditer(t)})
        labels = sorted({m.group(0) for t in texts for m in GWP_RE.finditer(t)})
        units = sorted({m.group(0) for t in texts for m in UNIT_RE.finditer(t)})
        numerics = [m.group(0) for t in texts for m in SCI_RE.finditer(t)]
        header_candidates = [r["text"] for r in cand_rows if r["flags"]["contains_lifecycle_stage"] or r["flags"]["contains_declared_unit_candidate"]][:8]
        candidates.append({
            "pdf_cache_reference": cache_pdf,
            "document_hash": doc_hash,
            "page_number": page_number,
            "table_candidate_id": f"{doc_hash[:12]}-p{page_number}-{len(candidates)+1}",
            "status": "candidate",
            "confidence": "uncertain",
            "bounding_box": bbox(all_nodes),
            "row_count": len(cand_rows),
            "rows": [{"row_id": r["row_id"], "bbox": r["bbox"], "text": r["text"], "flags": r["flags"]} for r in cand_rows],
            "inferred_columns": columns,
            "header_candidates": header_candidates,
            "lifecycle_stage_candidates": lifecycle,
            "gwp_co2_label_candidates": labels,
            "declared_unit_candidates": units,
            "numeric_value_candidates": numerics[:250],
            "numeric_value_candidate_count": len(numerics),
            "extraction_method": "layout_jsonl_row_column_candidate_v0",
        })
    return candidates


def run(input_path: Path, output_dir: Path, limit_lines: int | None, y_tolerance: float, x_tolerance: float, context_rows: int) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    candidates_path = output_dir / "hager_pdf_table_candidates.jsonl"
    summary_path = output_dir / "hager_pdf_table_reconstruction_summary.json"
    pages: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    nodes_read = 0
    for node in read_nodes(input_path, limit_lines):
        pages[(node["document_hash"], int(node["page_number"]))].append(node)
        nodes_read += 1
    run_at = now()
    metrics = {
        "runAt": run_at,
        "inputPath": str(input_path),
        "outputDir": str(output_dir),
        "nodesRead": nodes_read,
        "pagesSeen": len(pages),
        "documentsSeen": len({k[0] for k in pages}),
        "tableCandidates": 0,
        "candidatesWithLifecycle": 0,
        "candidatesWithGwpOrCo2": 0,
        "candidatesWithDeclaredUnit": 0,
        "numericValueCandidates": 0,
        "verifiedValues": 0,
        "documents": {},
    }
    with candidates_path.open("w", encoding="utf-8") as out:
        for (doc_hash, page_number), nodes in sorted(pages.items(), key=lambda item: (item[0][0], item[0][1])):
            cache_pdf = nodes[0].get("cache_pdf", "")
            candidates = find_candidates(doc_hash, cache_pdf, page_number, nodes, y_tolerance, x_tolerance, context_rows)
            doc_metric = metrics["documents"].setdefault(doc_hash, {"pages": 0, "tableCandidates": 0, "numericValueCandidates": 0})
            doc_metric["pages"] += 1
            for candidate in candidates:
                out.write(json.dumps(candidate, ensure_ascii=False, separators=(",", ":")) + "\n")
                metrics["tableCandidates"] += 1
                doc_metric["tableCandidates"] += 1
                n_count = int(candidate["numeric_value_candidate_count"])
                metrics["numericValueCandidates"] += n_count
                doc_metric["numericValueCandidates"] += n_count
                if candidate["lifecycle_stage_candidates"]: metrics["candidatesWithLifecycle"] += 1
                if candidate["gwp_co2_label_candidates"]: metrics["candidatesWithGwpOrCo2"] += 1
                if candidate["declared_unit_candidates"]: metrics["candidatesWithDeclaredUnit"] += 1
    metrics["candidatesPath"] = str(candidates_path)
    metrics["summaryPath"] = str(summary_path)
    summary_path.write_text(json.dumps(metrics, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    return metrics


def main() -> int:
    root = Path(r"C:\tmp\solar-product-catalog-dump-full-20260526-001431")
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", type=Path, default=root / "layout_poc" / "hager_pdf_layout_nodes.jsonl")
    ap.add_argument("--output-dir", type=Path, default=root / "layout_poc")
    ap.add_argument("--limit-lines", type=int, default=None)
    ap.add_argument("--y-tolerance", type=float, default=4.0)
    ap.add_argument("--x-tolerance", type=float, default=12.0)
    ap.add_argument("--context-rows", type=int, default=3)
    args = ap.parse_args()
    if not args.input.exists():
        print(f"ERROR: input not found: {args.input}", file=sys.stderr)
        return 1
    try:
        print(json.dumps(run(args.input, args.output_dir, args.limit_lines, args.y_tolerance, args.x_tolerance, args.context_rows), ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    except Exception as exc:
        print(f"ERROR: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
