#!/usr/bin/env python3
"""Offline import of a completed Solar product dump into local SQLite."""
from __future__ import annotations

import argparse, datetime as dt, hashlib, json, sqlite3, sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

SCHEMA_VERSION = "solar_product_sqlite_v1"
BATCH_SIZE = 1000


def now() -> str:
    return dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def txt(v: Any) -> str | None:
    if v is None:
        return None
    s = v.strip() if isinstance(v, str) else str(v)
    return s or None


def j(v: Any) -> str:
    return json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def h(v: str | None) -> str:
    return hashlib.sha256((v or "").encode("utf-8")).hexdigest()


def b(v: Any) -> int:
    return 1 if bool(v) else 0


def domain(url: str | None) -> str | None:
    if not url:
        return None
    host = (urlparse(url).netloc or "").lower()
    if "@" in host:
        host = host.rsplit("@", 1)[-1]
    if ":" in host:
        host = host.split(":", 1)[0]
    if host.startswith("www."):
        host = host[4:]
    return host or None


def first(o: dict[str, Any], keys: list[str]) -> str | None:
    for k in keys:
        v = txt(o.get(k))
        if v:
            return v
    return None


def links(v: Any) -> list[dict[str, Any]]:
    if v is None:
        return []
    items: list[Any]
    if isinstance(v, list):
        items = v
    elif isinstance(v, dict):
        items = []
        for group, item in v.items():
            nested = item if isinstance(item, list) else [item]
            for n in nested:
                if isinstance(n, dict):
                    x = dict(n); x.setdefault("group", group); items.append(x)
                else:
                    items.append({"url": txt(n), "group": group})
    else:
        items = [{"url": txt(v)}]
    out = []
    for item in items:
        if isinstance(item, dict):
            u = first(item, ["url", "href", "link", "uri", "src"])
            if u:
                x = dict(item); x["url"] = u; out.append(x)
        elif txt(item):
            out.append({"url": txt(item)})
    return out


def pdf_like(url: str | None, label: str | None, raw: Any) -> int:
    s = " ".join([url or "", label or "", j(raw)]).lower()
    return 1 if ".pdf" in s or "pdf" in s else 0


def ev_type(ev: dict[str, Any]) -> str:
    mt = ev.get("matchedTerms")
    terms = " ".join(str(x) for x in mt) if isinstance(mt, list) else str(mt or "")
    s = " ".join([terms, txt(ev.get("url")) or "", txt(ev.get("field")) or "", txt(ev.get("snippet")) or ""]).lower()
    if "epd" in s: return "epd"
    if "pep" in s: return "pep"
    if "environmental profile" in s or "environmentalprofile" in s: return "environmental_profile"
    if "sustainability" in s: return "sustainability"
    if "pdf" in s: return "pdf_link"
    return "keyword"


def ensure_schema(c: sqlite3.Connection) -> None:
    c.executescript("""
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS import_runs(
      id TEXT PRIMARY KEY, schema_version TEXT NOT NULL, source TEXT NOT NULL,
      dump_dir TEXT NOT NULL, summary_path TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0,
      stop_reason TEXT, pages INTEGER, raw_product_count INTEGER, normalized_product_count INTEGER,
      status40_excluded_count INTEGER, candidate_count INTEGER, started_at TEXT,
      completed_at TEXT, imported_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_run_id TEXT NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
      source TEXT, catalog_id TEXT, country_code TEXT, solar_product_id TEXT NOT NULL,
      sap_material_number TEXT, product_name TEXT, description TEXT, brand TEXT, series TEXT,
      category_id TEXT, category_code TEXT, category_name TEXT, etim_class TEXT, unspsc TEXT,
      status_code TEXT, status_label TEXT, is_phased_out INTEGER NOT NULL DEFAULT 0,
      last_changed TEXT, has_possible_co2_epd_pep_source INTEGER NOT NULL DEFAULT 0,
      raw_normalized_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(import_run_id, solar_product_id)
    );
    CREATE TABLE IF NOT EXISTS product_identifiers(
      id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      identifier_type TEXT NOT NULL, identifier_value TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(product_id, identifier_type, identifier_value)
    );
    CREATE TABLE IF NOT EXISTS source_domains(
      id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT NOT NULL UNIQUE,
      source_type TEXT NOT NULL DEFAULT 'unknown', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS product_documents(
      id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      source_domain_id INTEGER REFERENCES source_domains(id), url TEXT NOT NULL, url_hash TEXT NOT NULL,
      document_type TEXT NOT NULL DEFAULT '', is_pdf_like INTEGER NOT NULL DEFAULT 0,
      link_source TEXT NOT NULL, label TEXT, raw_link_json TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(product_id, url_hash, link_source, document_type)
    );
    CREATE TABLE IF NOT EXISTS product_images(
      id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      source_domain_id INTEGER REFERENCES source_domains(id), url TEXT NOT NULL, url_hash TEXT NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0, raw_link_json TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(product_id, url_hash)
    );
    CREATE TABLE IF NOT EXISTS product_status_history(
      id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      status_code TEXT, status_label TEXT, observed_at TEXT NOT NULL,
      UNIQUE(product_id, status_code, observed_at)
    );
    CREATE TABLE IF NOT EXISTS co2_candidate_evidence(
      id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      source_domain_id INTEGER REFERENCES source_domains(id), evidence_type TEXT NOT NULL,
      evidence_text TEXT, evidence_url TEXT, evidence_url_hash TEXT NOT NULL,
      source_field TEXT NOT NULL DEFAULT '', matched_terms TEXT NOT NULL DEFAULT '', snippet TEXT,
      raw_evidence_json TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(product_id, evidence_type, evidence_url_hash, source_field, matched_terms)
    );
    CREATE INDEX IF NOT EXISTS idx_products_import_run ON products(import_run_id);
    CREATE INDEX IF NOT EXISTS idx_products_solar_product_id ON products(solar_product_id);
    CREATE INDEX IF NOT EXISTS idx_products_status_code ON products(status_code);
    CREATE INDEX IF NOT EXISTS idx_product_identifiers_value ON product_identifiers(identifier_type, identifier_value);
    CREATE INDEX IF NOT EXISTS idx_product_documents_domain ON product_documents(source_domain_id);
    CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);
    CREATE INDEX IF NOT EXISTS idx_co2_evidence_type ON co2_candidate_evidence(evidence_type);
    CREATE INDEX IF NOT EXISTS idx_co2_evidence_domain ON co2_candidate_evidence(source_domain_id);
    """)


def domain_id(c: sqlite3.Connection, d: str | None, source_type: str) -> int | None:
    if not d:
        return None
    ts = now()
    c.execute("""INSERT INTO source_domains(domain,source_type,created_at,updated_at) VALUES(?,?,?,?)
                 ON CONFLICT(domain) DO UPDATE SET updated_at=excluded.updated_at""", (d, source_type, ts, ts))
    r = c.execute("SELECT id FROM source_domains WHERE domain=?", (d,)).fetchone()
    return int(r[0]) if r else None


def upsert_product(c: sqlite3.Connection, run_id: str, p: dict[str, Any]) -> int:
    s = p.get("status") if isinstance(p.get("status"), dict) else {}
    sid = txt(p.get("solarProductId")) or txt(p.get("sapMaterialNumber"))
    if not sid:
        raise ValueError("product missing solarProductId and sapMaterialNumber")
    ts = now()
    vals = (run_id, txt(p.get("source")), txt(p.get("catalogId")), txt(p.get("countrycode")), sid,
            txt(p.get("sapMaterialNumber")), txt(p.get("productName")), txt(p.get("description")),
            txt(p.get("brand")), txt(p.get("series")), txt(p.get("categoryId")), txt(p.get("categoryCode")),
            txt(p.get("categoryName")), txt(p.get("etimClass")), txt(p.get("unspsc")), txt(s.get("code")),
            txt(s.get("label")), b(s.get("isPhasedOut")), txt(p.get("lastChanged")),
            b(p.get("hasPossibleCo2EpdPepSource")), j(p), ts, ts)
    c.execute("""INSERT INTO products(import_run_id,source,catalog_id,country_code,solar_product_id,sap_material_number,
      product_name,description,brand,series,category_id,category_code,category_name,etim_class,unspsc,status_code,
      status_label,is_phased_out,last_changed,has_possible_co2_epd_pep_source,raw_normalized_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(import_run_id,solar_product_id) DO UPDATE SET source=excluded.source,catalog_id=excluded.catalog_id,
      country_code=excluded.country_code,sap_material_number=excluded.sap_material_number,product_name=excluded.product_name,
      description=excluded.description,brand=excluded.brand,series=excluded.series,category_id=excluded.category_id,
      category_code=excluded.category_code,category_name=excluded.category_name,etim_class=excluded.etim_class,unspsc=excluded.unspsc,
      status_code=excluded.status_code,status_label=excluded.status_label,is_phased_out=excluded.is_phased_out,
      last_changed=excluded.last_changed,has_possible_co2_epd_pep_source=excluded.has_possible_co2_epd_pep_source,
      raw_normalized_json=excluded.raw_normalized_json,updated_at=excluded.updated_at""", vals)
    return int(c.execute("SELECT id FROM products WHERE import_run_id=? AND solar_product_id=?", (run_id, sid)).fetchone()[0])


def insert_related(c: sqlite3.Connection, pid: int, p: dict[str, Any]) -> None:
    ts = now()
    ids = {"solar_product_id": p.get("solarProductId"), "sap_material_number": p.get("sapMaterialNumber"),
           "gtin": p.get("gtin"), "ean": p.get("ean"), "electrical_number": p.get("electricalNumber"),
           "hws_number": p.get("hwsNumber"), "manufacturer_part_number": p.get("manufacturerPartNumber")}
    for typ, val in ids.items():
        if txt(val):
            c.execute("INSERT OR IGNORE INTO product_identifiers(product_id,identifier_type,identifier_value,created_at) VALUES(?,?,?,?)", (pid, typ, txt(val), ts))
    for source, raw in [("documentLinks", p.get("documentLinks")), ("deepLinks", p.get("deepLinks"))]:
        for link in links(raw):
            u = txt(link.get("url")); label = first(link, ["label", "title", "name", "type", "group"])
            if u:
                c.execute("""INSERT OR IGNORE INTO product_documents(product_id,source_domain_id,url,url_hash,document_type,is_pdf_like,link_source,label,raw_link_json,created_at)
                             VALUES(?,?,?,?,?,?,?,?,?,?)""",
                          (pid, domain_id(c, domain(u), "document"), u, h(u), first(link, ["type", "group", "documentType"]) or "", pdf_like(u, label, link), source, label, j(link), ts))
    imgs = links(p.get("imageLinks"))
    if txt(p.get("imageUrl")):
        imgs.insert(0, {"url": txt(p.get("imageUrl")), "source": "imageUrl"})
    for i, link in enumerate(imgs):
        u = txt(link.get("url"))
        if u:
            c.execute("INSERT OR IGNORE INTO product_images(product_id,source_domain_id,url,url_hash,is_primary,raw_link_json,created_at) VALUES(?,?,?,?,?,?,?)",
                      (pid, domain_id(c, domain(u), "image"), u, h(u), 1 if i == 0 and txt(p.get("imageUrl")) else 0, j(link), ts))
    s = p.get("status") if isinstance(p.get("status"), dict) else {}
    c.execute("INSERT OR IGNORE INTO product_status_history(product_id,status_code,status_label,observed_at) VALUES(?,?,?,?)", (pid, txt(s.get("code")), txt(s.get("label")), txt(p.get("lastChanged")) or ts))


def insert_candidate(c: sqlite3.Connection, pid: int, cand: dict[str, Any]) -> None:
    ev = cand.get("co2Evidence")
    for item in (ev if isinstance(ev, list) else [ev]):
        if not isinstance(item, dict):
            continue
        u = txt(item.get("url")); mt = item.get("matchedTerms")
        mt_text = ",".join(str(x) for x in mt) if isinstance(mt, list) else (txt(mt) or "")
        field = txt(item.get("field")) or ""; snip = txt(item.get("snippet")); ts = now()
        c.execute("""INSERT OR IGNORE INTO co2_candidate_evidence(product_id,source_domain_id,evidence_type,evidence_text,evidence_url,
                     evidence_url_hash,source_field,matched_terms,snippet,raw_evidence_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                  (pid, domain_id(c, domain(u), "evidence"), ev_type(item), snip or mt_text, u, h(u or j(item)), field, mt_text, snip, j(item), ts))


def iter_jsonl(path: Path):
    with path.open("r", encoding="utf-8-sig") as f:
        for n, line in enumerate(f, 1):
            if line.strip():
                yield n, json.loads(line)


def scalar(c: sqlite3.Connection, q: str, p: tuple[Any, ...] = ()) -> int:
    return int((c.execute(q, p).fetchone() or [0])[0] or 0)


def sanity(c: sqlite3.Connection, run_id: str) -> dict[str, Any]:
    top = [{"domain": r[0], "references": r[1]} for r in c.execute("""
      SELECT sd.domain, COUNT(*) refs FROM source_domains sd JOIN (
        SELECT source_domain_id FROM product_documents WHERE source_domain_id IS NOT NULL UNION ALL
        SELECT source_domain_id FROM product_images WHERE source_domain_id IS NOT NULL UNION ALL
        SELECT source_domain_id FROM co2_candidate_evidence WHERE source_domain_id IS NOT NULL
      ) x ON x.source_domain_id=sd.id GROUP BY sd.domain ORDER BY refs DESC, sd.domain LIMIT 15""")]
    statuses = [{"statusCode": r[0] if r[0] is not None else "", "products": r[1]} for r in c.execute("SELECT status_code,COUNT(*) FROM products WHERE import_run_id=? GROUP BY status_code ORDER BY COUNT(*) DESC,status_code", (run_id,))]
    return {
      "products": scalar(c, "SELECT COUNT(*) FROM products WHERE import_run_id=?", (run_id,)),
      "identifiers": scalar(c, "SELECT COUNT(*) FROM product_identifiers pi JOIN products p ON p.id=pi.product_id WHERE p.import_run_id=?", (run_id,)),
      "documentLinks": scalar(c, "SELECT COUNT(*) FROM product_documents pd JOIN products p ON p.id=pd.product_id WHERE p.import_run_id=?", (run_id,)),
      "imageLinks": scalar(c, "SELECT COUNT(*) FROM product_images pi JOIN products p ON p.id=pi.product_id WHERE p.import_run_id=?", (run_id,)),
      "candidateEvidenceRows": scalar(c, "SELECT COUNT(*) FROM co2_candidate_evidence ce JOIN products p ON p.id=ce.product_id WHERE p.import_run_id=?", (run_id,)),
      "sourceDomains": scalar(c, "SELECT COUNT(*) FROM source_domains"),
      "duplicateSolarProductIds": scalar(c, "SELECT COUNT(*) FROM (SELECT solar_product_id FROM products WHERE import_run_id=? GROUP BY solar_product_id HAVING COUNT(*)>1)", (run_id,)),
      "missingGtinOrEan": scalar(c, "SELECT COUNT(*) FROM products p WHERE p.import_run_id=? AND NOT EXISTS (SELECT 1 FROM product_identifiers pi WHERE pi.product_id=p.id AND pi.identifier_type IN ('gtin','ean'))", (run_id,)),
      "statusDistribution": statuses,
      "topDomains": top,
    }


def import_dump(dump_dir: Path, db_path: Path) -> dict[str, Any]:
    summary_path = dump_dir / "solar_products_summary.json"
    norm_path = dump_dir / "solar_products_normalized.jsonl"
    cand_path = dump_dir / "solar_products_co2_candidates.jsonl"
    for p in [summary_path, norm_path, cand_path]:
        if not p.exists():
            raise FileNotFoundError(str(p))
    summary = json.loads(summary_path.read_text(encoding="utf-8-sig"))
    counts = summary.get("counts") if isinstance(summary.get("counts"), dict) else {}
    run_id = dump_dir.name; db_path.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(db_path); c.execute("PRAGMA foreign_keys=ON"); c.execute("PRAGMA journal_mode=WAL"); c.execute("PRAGMA synchronous=NORMAL")
    with c:
        ensure_schema(c)
        for t in ["co2_candidate_evidence", "product_status_history", "product_images", "product_documents", "product_identifiers"]:
            c.execute(f"DELETE FROM {t} WHERE product_id IN (SELECT id FROM products WHERE import_run_id=?)", (run_id,))
        c.execute("DELETE FROM products WHERE import_run_id=?", (run_id,))
        ts = now()
        c.execute("""INSERT INTO import_runs(id,schema_version,source,dump_dir,summary_path,completed,stop_reason,pages,raw_product_count,normalized_product_count,status40_excluded_count,candidate_count,started_at,completed_at,imported_at,updated_at)
                     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                     ON CONFLICT(id) DO UPDATE SET schema_version=excluded.schema_version,source=excluded.source,dump_dir=excluded.dump_dir,summary_path=excluded.summary_path,completed=excluded.completed,stop_reason=excluded.stop_reason,pages=excluded.pages,raw_product_count=excluded.raw_product_count,normalized_product_count=excluded.normalized_product_count,status40_excluded_count=excluded.status40_excluded_count,candidate_count=excluded.candidate_count,started_at=excluded.started_at,completed_at=excluded.completed_at,imported_at=excluded.imported_at,updated_at=excluded.updated_at""",
                  (run_id, SCHEMA_VERSION, "solar_product_catalog_dump", str(dump_dir), str(summary_path), b(summary.get("completed")), txt(summary.get("stopReason")), counts.get("pages"), counts.get("productsBeforeFiltering"), counts.get("productsAfterStatus40Filtering"), counts.get("excludedStatus40"), counts.get("co2Candidates"), ts, txt(summary.get("finishedAt")) or ts, ts, ts))
    by_solar: dict[str, int] = {}; norm_read = 0
    with c:
        for _, p in iter_jsonl(norm_path):
            pid = upsert_product(c, run_id, p); sid = txt(p.get("solarProductId")) or txt(p.get("sapMaterialNumber"))
            if sid: by_solar[sid] = pid
            insert_related(c, pid, p); norm_read += 1
            if norm_read % BATCH_SIZE == 0: c.commit()
    cand_read = 0; unmatched = 0
    with c:
        for _, cand in iter_jsonl(cand_path):
            sid = txt(cand.get("solarProductId")) or txt(cand.get("sapMaterialNumber")); pid = by_solar.get(sid or "")
            if not pid and sid:
                r = c.execute("SELECT id FROM products WHERE import_run_id=? AND solar_product_id=?", (run_id, sid)).fetchone(); pid = int(r[0]) if r else None
            if not pid:
                unmatched += 1; continue
            insert_candidate(c, pid, cand); cand_read += 1
            if cand_read % BATCH_SIZE == 0: c.commit()
    out = sanity(c, run_id)
    out.update({"importRunId": run_id, "dbPath": str(db_path), "normalizedRowsRead": norm_read, "candidateRowsRead": cand_read, "unmatchedCandidateRows": unmatched,
                "summary": {"completed": bool(summary.get("completed")), "stopReason": summary.get("stopReason"), "rawProducts": counts.get("productsBeforeFiltering"), "normalizedProducts": counts.get("productsAfterStatus40Filtering"), "status40Excluded": counts.get("excludedStatus40"), "co2Candidates": counts.get("co2Candidates")}})
    c.close(); return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump-dir", required=True, type=Path)
    ap.add_argument("--db-path", type=Path)
    a = ap.parse_args(); dump = a.dump_dir.resolve(); db = (a.db_path or dump / "solar_products.sqlite").resolve()
    try:
        print(json.dumps(import_dump(dump, db), ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())



