#!/usr/bin/env python3
"""Re-parse cached Hager PDFs with pdfjs text extraction and store structured evidence.

No downloads. No Solar API calls. No CO2/GWP values are inferred.
"""
from __future__ import annotations

import argparse, datetime as dt, hashlib, json, re, sqlite3, subprocess, sys
from pathlib import Path
from typing import Any

TERMS = ["EPD", "PEP", "EN15804", "GWP", "A1-A3", "carbon", "CO2"]
VALUE_RE = re.compile(r"(?P<label>GWP|global warming potential|CO2|CO₂|carbon).*?(?P<value>-?\d+(?:[.,]\d+)?(?:\s*[Ee][+-]?\d+)?)\s*(?P<unit>kg\s*CO2(?:e|eq)?|kg\s*CO₂(?:e|eq)?|kg\s*CO2\s*eq|kg\s*CO₂\s*eq|t\s*CO2(?:e|eq)?|g\s*CO2(?:e|eq)?)", re.I)
A1A3_RE = re.compile(r"A1\s*[-–]\s*A3|A1/A2/A3|A1\s*A2\s*A3", re.I)
PEP_ID_RE = re.compile(r"\b(?:PEP|HAGE)[-_ ][A-Z0-9.\-]+\b", re.I)
EN_RE = re.compile(r"EN\s*15804(?::?\+?A\d)?", re.I)


def now() -> str:
    return dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def ensure_tables(conn: sqlite3.Connection) -> None:
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS extraction_runs(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_hash TEXT NOT NULL,
      cache_path TEXT NOT NULL,
      extractor TEXT NOT NULL,
      extractor_version TEXT NOT NULL,
      status TEXT NOT NULL,
      page_count INTEGER,
      title TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(document_hash, extractor, extractor_version)
    );
    CREATE TABLE IF NOT EXISTS parsed_environmental_values(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      extraction_run_id INTEGER NOT NULL REFERENCES extraction_runs(id) ON DELETE CASCADE,
      document_hash TEXT NOT NULL,
      page_number INTEGER,
      detected_term TEXT NOT NULL,
      detected_value TEXT,
      detected_unit TEXT,
      lifecycle_stage TEXT,
      pep_identifier TEXT,
      en15804_reference TEXT,
      text_snippet TEXT NOT NULL,
      confidence TEXT NOT NULL,
      verification_status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(extraction_run_id, page_number, detected_term, detected_value, detected_unit, lifecycle_stage, text_snippet)
    );
    CREATE INDEX IF NOT EXISTS idx_extraction_runs_hash ON extraction_runs(document_hash);
    CREATE INDEX IF NOT EXISTS idx_parsed_env_values_hash ON parsed_environmental_values(document_hash);
    CREATE INDEX IF NOT EXISTS idx_parsed_env_values_term ON parsed_environmental_values(detected_term);
    CREATE INDEX IF NOT EXISTS idx_parsed_env_values_confidence ON parsed_environmental_values(confidence);
    """)


def call_pdfjs(node_script: Path, pdf_path: Path, pdfjs_module: Path) -> dict[str, Any]:
    cmd = ["node", str(node_script), "--pdf", str(pdf_path), "--pdfjs-module", str(pdfjs_module)]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120, check=False)
    stdout = (proc.stdout or "").strip().splitlines()
    if not stdout:
        return {"ok": False, "error": (proc.stderr or "").strip() or f"node_exit_{proc.returncode}"}
    try:
        return json.loads(stdout[-1])
    except json.JSONDecodeError:
        return {"ok": False, "error": "invalid_json_from_pdfjs", "stdout": proc.stdout[-500:], "stderr": proc.stderr[-500:]}


def snippet(text: str, start: int, end: int, radius: int = 180) -> str:
    s = max(0, start - radius); e = min(len(text), end + radius)
    return re.sub(r"\s+", " ", text[s:e]).strip()[:700]


def add_evidence(records: list[dict[str, Any]], page_number: int, doc_hash: str, text: str, term: str, start: int, end: int, confidence: str, status: str, value: str | None = None, unit: str | None = None, lifecycle: str | None = None, pep_id: str | None = None, en_ref: str | None = None) -> None:
    records.append({
        "document_hash": doc_hash,
        "page_number": page_number,
        "detected_term": term,
        "detected_value": value,
        "detected_unit": unit,
        "lifecycle_stage": lifecycle,
        "pep_identifier": pep_id,
        "en15804_reference": en_ref,
        "text_snippet": snippet(text, start, end),
        "confidence": confidence,
        "verification_status": status,
    })


def extract_records(doc_hash: str, pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for page in pages:
        page_number = int(page.get("pageNumber") or 0)
        text = page.get("text") or ""
        if not text:
            continue
        for term in TERMS:
            for m in re.finditer(re.escape(term), text, re.I):
                add_evidence(records, page_number, doc_hash, text, term, m.start(), m.end(), "medium", "term_detected")
        for m in EN_RE.finditer(text):
            add_evidence(records, page_number, doc_hash, text, "EN15804", m.start(), m.end(), "high", "verified_reference", en_ref=m.group(0))
        for m in A1A3_RE.finditer(text):
            add_evidence(records, page_number, doc_hash, text, "A1-A3", m.start(), m.end(), "high", "verified_lifecycle_stage", lifecycle="A1-A3")
        for m in PEP_ID_RE.finditer(text):
            add_evidence(records, page_number, doc_hash, text, "PEP_IDENTIFIER", m.start(), m.end(), "medium", "identifier_detected", pep_id=m.group(0))
        for m in VALUE_RE.finditer(text):
            label = m.group("label")
            value = m.group("value").replace(",", ".").replace(" ", "")
            unit = re.sub(r"\s+", " ", m.group("unit")).strip()
            life = "A1-A3" if A1A3_RE.search(snippet(text, m.start(), m.end(), 260)) else None
            confidence = "high" if life else "medium"
            add_evidence(records, page_number, doc_hash, text, "GWP_VALUE" if "gwp" in label.lower() else "CO2_VALUE", m.start(), m.end(), confidence, "verified_extraction" if life else "uncertain_extraction", value=value, unit=unit, lifecycle=life)
    # Keep output useful and bounded: exact duplicates can be common across PDF headers/footers.
    seen = set(); deduped = []
    for r in records:
        key = (r["page_number"], r["detected_term"], r.get("detected_value"), r.get("detected_unit"), r.get("lifecycle_stage"), r["text_snippet"][:220])
        if key in seen:
            continue
        seen.add(key); deduped.append(r)
    return deduped


def store_run(conn: sqlite3.Connection, doc_hash: str, path: Path, parsed: dict[str, Any], records: list[dict[str, Any]]) -> int:
    ts = now(); status = "success" if parsed.get("ok") else "failed"
    conn.execute("""
      INSERT INTO extraction_runs(document_hash, cache_path, extractor, extractor_version, status, page_count, title, error, created_at)
      VALUES (?, ?, 'pdfjs-dist', '4.10.38-local', ?, ?, ?, ?, ?)
      ON CONFLICT(document_hash, extractor, extractor_version) DO UPDATE SET
        cache_path=excluded.cache_path,status=excluded.status,page_count=excluded.page_count,title=excluded.title,error=excluded.error,created_at=excluded.created_at
    """, (doc_hash, str(path), status, parsed.get("pageCount"), parsed.get("title"), parsed.get("error"), ts))
    run_id = conn.execute("SELECT id FROM extraction_runs WHERE document_hash=? AND extractor='pdfjs-dist' AND extractor_version='4.10.38-local'", (doc_hash,)).fetchone()[0]
    conn.execute("DELETE FROM parsed_environmental_values WHERE extraction_run_id=?", (run_id,))
    for r in records:
        conn.execute("""INSERT OR IGNORE INTO parsed_environmental_values(extraction_run_id,document_hash,page_number,detected_term,detected_value,detected_unit,lifecycle_stage,pep_identifier,en15804_reference,text_snippet,confidence,verification_status,created_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (run_id, r["document_hash"], r["page_number"], r["detected_term"], r["detected_value"], r["detected_unit"], r["lifecycle_stage"], r["pep_identifier"], r["en15804_reference"], r["text_snippet"], r["confidence"], r["verification_status"], ts))
    return run_id


def run(db_path: Path, cache_dir: Path, node_script: Path, pdfjs_module: Path) -> dict[str, Any]:
    conn = sqlite3.connect(db_path)
    ensure_tables(conn)
    pdfs = sorted(cache_dir.glob("*.pdf"))
    results = []
    with conn:
        for pdf in pdfs:
            doc_hash = sha256_file(pdf)
            parsed = call_pdfjs(node_script, pdf, pdfjs_module)
            records = extract_records(doc_hash, parsed.get("pages") or []) if parsed.get("ok") else []
            store_run(conn, doc_hash, pdf, parsed, records)
            results.append({"file": pdf.name, "hash": doc_hash, "ok": bool(parsed.get("ok")), "pageCount": parsed.get("pageCount"), "title": parsed.get("title"), "records": len(records), "error": parsed.get("error")})
    summary = {
        "documents": len(pdfs),
        "parsedOk": sum(1 for r in results if r["ok"]),
        "failed": sum(1 for r in results if not r["ok"]),
        "records": sum(r["records"] for r in results),
        "termCounts": {},
        "verifiedValues": [],
        "results": results,
    }
    for row in conn.execute("SELECT detected_term, verification_status, COUNT(*) FROM parsed_environmental_values GROUP BY detected_term, verification_status ORDER BY detected_term, verification_status"):
        summary["termCounts"][f"{row[0]}:{row[1]}"] = row[2]
    summary["verifiedValues"] = [dict(zip(["document_hash","page_number","detected_term","detected_value","detected_unit","lifecycle_stage","confidence","verification_status","text_snippet"], row)) for row in conn.execute("""
      SELECT document_hash,page_number,detected_term,detected_value,detected_unit,lifecycle_stage,confidence,verification_status,text_snippet
      FROM parsed_environmental_values
      WHERE detected_value IS NOT NULL
      ORDER BY confidence DESC, page_number ASC
      LIMIT 20
    """)]
    conn.close(); return summary


def main() -> int:
    root = Path(r"C:\tmp\solar-product-catalog-dump-full-20260526-001431")
    default_pdfjs = Path(r"C:\Users\dep\Projekter\DEMO_FD_Restarbejde\node_modules\pdfjs-dist\legacy\build\pdf.mjs")
    ap = argparse.ArgumentParser()
    ap.add_argument("--db-path", type=Path, default=root / "solar_products.sqlite")
    ap.add_argument("--cache-dir", type=Path, default=root / "document_cache" / "assets.hager.com")
    ap.add_argument("--node-script", type=Path, default=Path(__file__).with_name("solar_pdfjs_extract_text.mjs"))
    ap.add_argument("--pdfjs-module", type=Path, default=default_pdfjs)
    args = ap.parse_args()
    if not args.cache_dir.exists():
        print(f"ERROR: cache dir not found: {args.cache_dir}", file=sys.stderr); return 1
    if not args.pdfjs_module.exists():
        print(f"ERROR: pdfjs module not found: {args.pdfjs_module}", file=sys.stderr); return 1
    try:
        print(json.dumps(run(args.db_path, args.cache_dir, args.node_script, args.pdfjs_module), ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    except Exception as e:
        print(f"ERROR: {type(e).__name__}: {e}", file=sys.stderr); return 1

if __name__ == "__main__":
    raise SystemExit(main())

