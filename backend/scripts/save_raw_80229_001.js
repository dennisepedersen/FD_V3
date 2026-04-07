/**
 * Fetch and save complete raw JSON payloads for project 80229-001 from EK v3 and v4.
 * Save to files without truncation or transformation.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env.production") });
const crypto = require("crypto");
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const TARGET_REF = "80229-001";
const PAGE_SIZE = 200;

function ek() { return crypto.createHash("sha256").update(process.env.JWT_SECRET).digest(); }
function dec(ct) {
  const [iv, tag, enc] = String(ct).split(".");
  const d = crypto.createDecipheriv("aes-256-gcm", ek(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64")), d.final()]).toString("utf8");
}
async function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

const OUTPUT_DIR = __dirname;
const files = {
  v3: path.join(OUTPUT_DIR, "output_80229_001_v3_raw.json"),
  v4Ref: path.join(OUTPUT_DIR, "output_80229_001_v4_ref_raw.json"),
  v4Paged: path.join(OUTPUT_DIR, "output_80229_001_v4_paged_match_raw.json"),
  meta: path.join(OUTPUT_DIR, "output_80229_001_meta.txt"),
};

const collected = {
  v3: { endpoint: null, status: null, payload: null, source: null },
  v4Ref: { endpoint: null, status: null, payload: null },
  v4Paged: { endpoint: null, status: null, payload: null },
};

async function main() {
  const c = await pool.connect();
  const { rows } = await c.query(
    "SELECT tc.ek_api_key_encrypted FROM tenant_config tc JOIN tenant t ON t.id=tc.tenant_id WHERE t.slug='hoyrup-clemmensen' LIMIT 1"
  );
  c.release();
  await pool.end();

  const apiKey = dec(rows[0].ek_api_key_encrypted);
  const headers = { apikey: apiKey, siteName: "hoyrup-clemmensen", Accept: "application/json" };
  const base = "https://externalaccessapi.e-komplet.dk";
  const encodedRef = encodeURIComponent(TARGET_REF);

  // --- V4 REF ---
  console.log("Fetching V4 ref endpoint...");
  const v4RefUrl = base + "/api/v4.0/projects/ref/" + encodedRef;
  await delay(1000);
  const r4r = await fetch(v4RefUrl, { headers });
  collected.v4Ref.endpoint = v4RefUrl;
  collected.v4Ref.status = r4r.status;
  if (r4r.ok) {
    collected.v4Ref.payload = await r4r.json();
  }
  console.log("V4 ref:", r4r.status);

  // --- V4 PAGED (find matching row) ---
  console.log("Fetching V4 paged endpoint (looking for match)...");
  const v4PagedBase = base + "/api/v4.0/projects";
  await delay(2000);
  const r4p = await fetch(v4PagedBase + "?page=1&pageSize=200", { headers });
  collected.v4Paged.endpoint = v4PagedBase;
  collected.v4Paged.status = r4p.status;
  if (r4p.ok) {
    const fullResp = await r4p.json();
    const items = Array.isArray(fullResp) ? fullResp : (fullResp.data || fullResp.items || []);
    const match = items.find((p) => String(p.reference || "").trim() === TARGET_REF);
    if (match) {
      collected.v4Paged.payload = match;
    }
  }
  console.log("V4 paged:", r4p.status, collected.v4Paged.payload ? "found match" : "no match on page 1");

  // --- V3 PAGED (find matching rich row) ---
  console.log("Fetching V3 paged endpoint (looking for match)...");
  const v3Base = base + "/api/v3.0/projects";
  let v3Found = false;
  for (let page = 1; page <= 10; page++) {
    await delay(600);
    const url = v3Base + `?page=${page}&pageSize=${PAGE_SIZE}`;
    const r3 = await fetch(url, { headers });

    if (r3.status === 429) {
      console.log(`V3 page ${page}: 429, waiting 30s...`);
      await delay(30000);
      page -= 1;
      continue;
    }
    if (!r3.ok) {
      console.log(`V3 page ${page}: ${r3.status}`);
      break;
    }

    const d = await r3.json();
    const wrapper = Array.isArray(d.data) ? d.data[0] : null;
    const items = wrapper && Array.isArray(wrapper.data) ? wrapper.data : [];

    console.log(`V3 page ${page}: ${items.length} items`);

    const match = items.find((p) => {
      const ref = p.ProjectReference || p.projectReference;
      return String(ref || "").trim() === TARGET_REF;
    });

    if (match) {
      collected.v3.endpoint = v3Base;
      collected.v3.status = 200;
      collected.v3.payload = match;
      collected.v3.source = `V3 paged (page ${page})`;
      v3Found = true;
      console.log(`V3 found on page ${page}`);
      break;
    }

    const fetched = (page - 1) * PAGE_SIZE + items.length;
    if (items.length < PAGE_SIZE || (wrapper?.total != null && fetched >= wrapper.total)) {
      console.log("No more pages in V3.");
      break;
    }
  }

  // --- WRITE FILES ---
  console.log("\nWriting output files...");

  const meta = [];
  meta.push("=== EK Raw Payloads for Project 80229-001 ===\n");

  if (collected.v3.payload) {
    fs.writeFileSync(files.v3, JSON.stringify(collected.v3.payload, null, 2), "utf8");
    meta.push(`V3 Source: ${collected.v3.source}`);
    meta.push(`V3 Endpoint: ${collected.v3.endpoint}`);
    meta.push(`V3 HTTP Status: ${collected.v3.status}`);
    meta.push(`V3 Top-level keys: ${Object.keys(collected.v3.payload).length}`);
    meta.push(`V3 Keys: ${Object.keys(collected.v3.payload).join(", ")}`);
    if (collected.v3.payload.ProjectReference) meta.push(`V3 Project Reference: ${collected.v3.payload.ProjectReference}`);
    if (collected.v3.payload.ProjectID) meta.push(`V3 ProjectID: ${collected.v3.payload.ProjectID}`);
    meta.push("");
  } else {
    meta.push("V3: NOT FOUND");
    meta.push("");
  }

  if (collected.v4Ref.payload) {
    fs.writeFileSync(files.v4Ref, JSON.stringify(collected.v4Ref.payload, null, 2), "utf8");
    meta.push(`V4 Ref Source: V4 ref endpoint`);
    meta.push(`V4 Ref Endpoint: ${collected.v4Ref.endpoint}`);
    meta.push(`V4 Ref HTTP Status: ${collected.v4Ref.status}`);
    const v4RefItems = Array.isArray(collected.v4Ref.payload) ? collected.v4Ref.payload : [collected.v4Ref.payload];
    if (collected.v4Ref.payload.data) {
      meta.push(`V4 Ref Response type: object with 'data' array`);
      const dataArray = Array.isArray(collected.v4Ref.payload.data) ? collected.v4Ref.payload.data : [collected.v4Ref.payload.data];
      if (dataArray.length > 0) {
        meta.push(`V4 Ref Data array length: ${dataArray.length}`);
        meta.push(`V4 Ref Top-level keys in wrapper: ${Object.keys(collected.v4Ref.payload).join(", ")}`);
        meta.push(`V4 Ref Item[0] keys: ${Object.keys(dataArray[0]).length}`);
        meta.push(`V4 Ref Item[0] keys: ${Object.keys(dataArray[0]).join(", ")}`);
      }
    } else {
      meta.push(`V4 Ref Top-level keys: ${Object.keys(collected.v4Ref.payload).length}`);
      meta.push(`V4 Ref Keys: ${Object.keys(collected.v4Ref.payload).join(", ")}`);
      if (collected.v4Ref.payload.reference) meta.push(`V4 Ref Reference: ${collected.v4Ref.payload.reference}`);
      if (collected.v4Ref.payload.projectID) meta.push(`V4 Ref ProjectID: ${collected.v4Ref.payload.projectID}`);
    }
    meta.push("");
  } else {
    meta.push("V4 Ref: NOT FOUND");
    meta.push("");
  }

  if (collected.v4Paged.payload) {
    fs.writeFileSync(files.v4Paged, JSON.stringify(collected.v4Paged.payload, null, 2), "utf8");
    meta.push(`V4 Paged Source: V4 paged endpoint`);
    meta.push(`V4 Paged Endpoint: ${collected.v4Paged.endpoint}?page=1&pageSize=200`);
    meta.push(`V4 Paged HTTP Status: ${collected.v4Paged.status}`);
    meta.push(`V4 Paged Top-level keys: ${Object.keys(collected.v4Paged.payload).length}`);
    meta.push(`V4 Paged Keys: ${Object.keys(collected.v4Paged.payload).join(", ")}`);
    if (collected.v4Paged.payload.reference) meta.push(`V4 Paged Reference: ${collected.v4Paged.payload.reference}`);
    if (collected.v4Paged.payload.projectID) meta.push(`V4 Paged ProjectID: ${collected.v4Paged.payload.projectID}`);
    meta.push("");
  }

  meta.push("=== Summary ===");
  meta.push(`V3 payload complete: ${collected.v3.payload ? "YES" : "NO"}`);
  meta.push(`V4 Ref payload complete: ${collected.v4Ref.payload ? "YES (but may be slim)" : "NO"}`);
  meta.push(`V4 Paged payload complete: ${collected.v4Paged.payload ? "YES (richer)" : "NO"}`);

  fs.writeFileSync(files.meta, meta.join("\n"), "utf8");

  console.log("\nFiles written:");
  if (collected.v3.payload) console.log("  ✓ " + files.v3);
  if (collected.v4Ref.payload) console.log("  ✓ " + files.v4Ref);
  if (collected.v4Paged.payload) console.log("  ✓ " + files.v4Paged);
  console.log("  ✓ " + files.meta);
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
