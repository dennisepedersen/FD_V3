#!/usr/bin/env python3
"""Controlled Hager-only PDF download/cache/metadata POC for Solar CO2 evidence.

No Solar API calls. No crawling. No CO2/GWP values are inferred.
"""
from __future__ import annotations

import argparse, datetime as dt, hashlib, json, re, sqlite3, sys, time, zlib
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

ALLOWLIST = {"assets.hager.com"}
MAX_BYTES = 20 * 1024 * 1024
TERMS = ["EPD", "PEP", "EN15804", "GWP", "A1-A3", "carbon", "CO2"]


def now() -> str:
    return dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def domain(url: str) -> str:
    return (urlparse(url).netloc or "").lower().split(":", 1)[0]


def is_allowed_pdf(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme == "https" and domain(url) in ALLOWLIST and parsed.path.lower().endswith(".pdf")


def ensure_tables(conn: sqlite3.Connection) -> None:
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS document_download_queue(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_url TEXT NOT NULL UNIQUE,
      source_domain TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 100,
      sample_product_count INTEGER NOT NULL DEFAULT 0,
      evidence_types TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS downloaded_documents(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      queue_id INTEGER REFERENCES document_download_queue(id),
      source_url TEXT NOT NULL UNIQUE,
      source_domain TEXT NOT NULL,
      cache_path TEXT,
      content_hash TEXT,
      file_size_bytes INTEGER,
      http_status INTEGER,
      content_type TEXT,
      downloaded_at TEXT NOT NULL,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS document_parse_runs(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      downloaded_document_id INTEGER NOT NULL REFERENCES downloaded_documents(id) ON DELETE CASCADE,
      parser_name TEXT NOT NULL,
      parser_version TEXT NOT NULL,
      parse_status TEXT NOT NULL,
      page_count INTEGER,
      title TEXT,
      text_preview TEXT,
      encrypted INTEGER NOT NULL DEFAULT 0,
      image_only INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      parsed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS parsed_document_evidence(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parse_run_id INTEGER NOT NULL REFERENCES document_parse_runs(id) ON DELETE CASCADE,
      evidence_key TEXT NOT NULL,
      evidence_found INTEGER NOT NULL DEFAULT 0,
      evidence_count INTEGER NOT NULL DEFAULT 0,
      snippet TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(parse_run_id, evidence_key)
    );
    CREATE INDEX IF NOT EXISTS idx_document_queue_domain ON document_download_queue(source_domain);
    CREATE INDEX IF NOT EXISTS idx_downloaded_documents_hash ON downloaded_documents(content_hash);
    CREATE INDEX IF NOT EXISTS idx_parse_runs_status ON document_parse_runs(parse_status);
    """)


def seed_queue(conn: sqlite3.Connection, limit: int) -> list[sqlite3.Row]:
    ts = now()
    rows = conn.execute("""
      SELECT ce.evidence_url AS url,
             COUNT(DISTINCT ce.product_id) AS products,
             group_concat(DISTINCT ce.evidence_type) AS evidence_types
      FROM co2_candidate_evidence ce
      JOIN source_domains sd ON sd.id = ce.source_domain_id
      WHERE sd.domain = 'assets.hager.com'
        AND ce.evidence_url LIKE 'https://assets.hager.com/%.pdf'
      GROUP BY ce.evidence_url
      ORDER BY products DESC, ce.evidence_url ASC
      LIMIT ?
    """, (limit,)).fetchall()
    for idx, r in enumerate(rows, start=1):
        url = r["url"]
        if not is_allowed_pdf(url):
            continue
        conn.execute("""
          INSERT INTO document_download_queue(source_url, source_domain, priority, sample_product_count, evidence_types, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)
          ON CONFLICT(source_url) DO UPDATE SET
            priority=excluded.priority,
            sample_product_count=excluded.sample_product_count,
            evidence_types=excluded.evidence_types,
            updated_at=excluded.updated_at
        """, (url, domain(url), idx, int(r["products"] or 0), r["evidence_types"], ts, ts))
    conn.commit()
    return conn.execute("""
      SELECT * FROM document_download_queue
      WHERE source_domain='assets.hager.com'
      ORDER BY priority ASC
      LIMIT ?
    """, (limit,)).fetchall()


def download_pdf(url: str) -> tuple[int, str | None, bytes | None, str | None]:
    req = Request(url, headers={"User-Agent": "Fielddesk-Solar-PDF-POC/0.1", "Accept": "application/pdf"})
    try:
        with urlopen(req, timeout=30) as resp:
            status = int(getattr(resp, "status", 200))
            ctype = resp.headers.get("Content-Type")
            data = resp.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                return status, ctype, None, "file_too_large"
            return status, ctype, data, None
    except HTTPError as e:
        return int(e.code), e.headers.get("Content-Type") if e.headers else None, None, f"http_{e.code}"
    except URLError as e:
        return 0, None, None, f"url_error:{e.reason}"
    except Exception as e:
        return 0, None, None, f"download_error:{type(e).__name__}"


def pdf_string_decode(raw: bytes) -> str:
    s = raw.decode("latin-1", errors="ignore")
    s = re.sub(r"\\([nrtbf()\\])", lambda m: {"n":"\n","r":"\r","t":"\t","b":"","f":"","(":"(",")":")","\\":"\\"}.get(m.group(1), m.group(1)), s)
    return s


def extract_textish(pdf: bytes, max_chars: int = 6000) -> str:
    chunks: list[bytes] = []
    # raw strings sometimes catch metadata even when content streams are compressed.
    chunks.append(pdf[:2_000_000])
    for m in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", pdf, re.S):
        raw = m.group(1).strip(b"\r\n")
        try:
            chunks.append(zlib.decompress(raw))
        except Exception:
            continue
        if sum(len(c) for c in chunks) > 8_000_000:
            break
    text_parts: list[str] = []
    for chunk in chunks:
        for sm in re.finditer(rb"\((?:\\.|[^\\)]){2,}\)", chunk):
            text_parts.append(pdf_string_decode(sm.group(0)[1:-1]))
            if sum(len(x) for x in text_parts) > max_chars:
                break
        if sum(len(x) for x in text_parts) > max_chars:
            break
    text = " ".join(t.strip() for t in text_parts if t.strip())
    text = re.sub(r"\s+", " ", text)
    return text[:max_chars]


def extract_title(pdf: bytes, text: str) -> str | None:
    m = re.search(rb"/Title\s*\((.*?)\)", pdf[:500000], re.S)
    if m:
        title = pdf_string_decode(m.group(1)).strip()
        if title:
            return title[:300]
    for marker in ["Product Environmental Profile", "Environmental Product Declaration", "PEP"]:
        i = text.lower().find(marker.lower())
        if i >= 0:
            return text[i:i+160]
    return None


def parse_pdf(pdf: bytes) -> dict[str, Any]:
    encrypted = 1 if b"/Encrypt" in pdf else 0
    page_count = len(re.findall(rb"/Type\s*/Page\b", pdf))
    text = extract_textish(pdf)
    lowered = text.lower()
    evidence = {}
    for term in TERMS:
        count = lowered.count(term.lower())
        idx = lowered.find(term.lower())
        snippet = text[max(0, idx-80):idx+160] if idx >= 0 else None
        evidence[term] = {"found": count > 0, "count": count, "snippet": snippet}
    return {
        "status": "success" if text or page_count else "failed",
        "page_count": page_count,
        "title": extract_title(pdf, text),
        "text_preview": text[:1200],
        "encrypted": encrypted,
        "image_only": 1 if page_count > 0 and len(text) < 200 else 0,
        "evidence": evidence,
    }


def upsert_download(conn: sqlite3.Connection, q: sqlite3.Row, cache_dir: Path) -> dict[str, Any]:
    url = q["source_url"]
    status, ctype, data, err = download_pdf(url)
    ts = now()
    cache_path = None; digest = None; size = None
    if data and status == 200 and (ctype or "").lower().split(";")[0].strip() in {"application/pdf", "application/octet-stream", "binary/octet-stream"}:
        digest = sha256_bytes(data); size = len(data)
        cache_dir.mkdir(parents=True, exist_ok=True)
        cache_path = str(cache_dir / f"{digest}.pdf")
        if not Path(cache_path).exists():
            Path(cache_path).write_bytes(data)
        parse = parse_pdf(data)
        parse_error = None
    else:
        parse = None
        parse_error = err or "not_pdf_or_not_ok"
    conn.execute("""
      INSERT INTO downloaded_documents(queue_id, source_url, source_domain, cache_path, content_hash, file_size_bytes, http_status, content_type, downloaded_at, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_url) DO UPDATE SET queue_id=excluded.queue_id, cache_path=excluded.cache_path, content_hash=excluded.content_hash,
        file_size_bytes=excluded.file_size_bytes, http_status=excluded.http_status, content_type=excluded.content_type,
        downloaded_at=excluded.downloaded_at, error=excluded.error
    """, (q["id"], url, q["source_domain"], cache_path, digest, size, status, ctype, ts, parse_error))
    doc_id = conn.execute("SELECT id FROM downloaded_documents WHERE source_url=?", (url,)).fetchone()[0]
    if parse:
        conn.execute("""INSERT INTO document_parse_runs(downloaded_document_id, parser_name, parser_version, parse_status, page_count, title, text_preview, encrypted, image_only, error, parsed_at)
                       VALUES (?, 'stdlib_pdf_textish', '0.1', ?, ?, ?, ?, ?, ?, NULL, ?)""",
                     (doc_id, parse["status"], parse["page_count"], parse["title"], parse["text_preview"], parse["encrypted"], parse["image_only"], ts))
        run_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        for key, ev in parse["evidence"].items():
            conn.execute("""INSERT OR REPLACE INTO parsed_document_evidence(parse_run_id,evidence_key,evidence_found,evidence_count,snippet,created_at)
                           VALUES (?, ?, ?, ?, ?, ?)""", (run_id, key, 1 if ev["found"] else 0, ev["count"], ev["snippet"], ts))
    conn.execute("UPDATE document_download_queue SET status=?, updated_at=? WHERE id=?", ("downloaded" if data and not parse_error else "failed", ts, q["id"]))
    return {"url": url, "status": status, "contentType": ctype, "bytes": size, "hash": digest, "error": parse_error, "parsed": bool(parse)}


def run(db_path: Path, cache_root: Path, limit: int) -> dict[str, Any]:
    conn = sqlite3.connect(db_path); conn.row_factory = sqlite3.Row
    ensure_tables(conn)
    queue = seed_queue(conn, limit)
    cache_dir = cache_root / "assets.hager.com"
    results=[]
    for q in queue:
        if not is_allowed_pdf(q["source_url"]):
            continue
        results.append(upsert_download(conn, q, cache_dir))
        conn.commit()
        time.sleep(0.25)
    summary = {
        "queued": len(queue),
        "downloadAttempts": len(results),
        "downloadedOk": sum(1 for r in results if r["status"] == 200 and r["hash"]),
        "uniqueContentHashes": len({r["hash"] for r in results if r["hash"]}),
        "failed": sum(1 for r in results if r["error"]),
        "evidenceCounts": {},
        "valuableExamples": [],
    }
    for term in TERMS:
        row = conn.execute("""SELECT COUNT(DISTINCT pr.downloaded_document_id) FROM parsed_document_evidence pe
                              JOIN document_parse_runs pr ON pr.id=pe.parse_run_id
                              WHERE pe.evidence_key=? AND pe.evidence_found=1""", (term,)).fetchone()
        summary["evidenceCounts"][term] = int(row[0] or 0)
    summary["valuableExamples"] = [dict(r) for r in conn.execute("""
      SELECT dd.source_url, dd.content_hash, dd.file_size_bytes, pr.page_count, pr.title,
             max(case when pe.evidence_key='GWP' then pe.evidence_found else 0 end) has_gwp,
             max(case when pe.evidence_key='A1-A3' then pe.evidence_found else 0 end) has_a1_a3
      FROM downloaded_documents dd
      JOIN document_parse_runs pr ON pr.downloaded_document_id=dd.id
      LEFT JOIN parsed_document_evidence pe ON pe.parse_run_id=pr.id
      WHERE dd.source_domain='assets.hager.com' AND dd.content_hash IS NOT NULL
      GROUP BY dd.id, pr.id
      ORDER BY has_gwp DESC, has_a1_a3 DESC, pr.page_count DESC
      LIMIT 8
    """)]
    summary["results"] = results
    conn.close(); return summary


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db-path", default=r"C:\tmp\solar-product-catalog-dump-full-20260526-001431\solar_products.sqlite", type=Path)
    ap.add_argument("--cache-dir", default=r"C:\tmp\solar-product-catalog-dump-full-20260526-001431\document_cache", type=Path)
    ap.add_argument("--limit", type=int, default=15)
    args = ap.parse_args()
    if args.limit < 1 or args.limit > 50:
        print("ERROR: limit must be between 1 and 50", file=sys.stderr); return 1
    try:
        print(json.dumps(run(args.db_path, args.cache_dir, args.limit), ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    except Exception as e:
        print(f"ERROR: {type(e).__name__}: {e}", file=sys.stderr); return 1

if __name__ == "__main__":
    raise SystemExit(main())
