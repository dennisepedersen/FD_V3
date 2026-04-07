/**
 * Fetch and save complete raw V4 paged payload for project 80229-001.
 * ONLY paged endpoint (/api/v4.0/projects?page=...), NOT ref endpoint.
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
  v4Paged: path.join(OUTPUT_DIR, "output_80229_001_v4_paged_raw.json"),
  meta: path.join(OUTPUT_DIR, "output_80229_001_meta.txt"),
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
  const v4PagedBase = base + "/api/v4.0/projects";

  console.log("Scanning V4 paged endpoint for project 80229-001...");
  let foundPage = null;
  let foundItem = null;
  let foundStatus = null;

  for (let page = 1; page <= 500; page++) {
    await delay(600);
    const url = v4PagedBase + `?page=${page}&pageSize=${PAGE_SIZE}`;

    const r = await fetch(url, { headers });

    if (r.status === 429) {
      console.log(`Page ${page}: 429, waiting 30s...`);
      await delay(30000);
      page -= 1;
      continue;
    }
    if (!r.ok) {
      console.log(`Page ${page}: HTTP ${r.status} - stopping`);
      break;
    }

    const data = await r.json();
    const items = Array.isArray(data) ? data : (data.data || data.items || data.projects || []);

    console.log(`Page ${page}: ${items.length} items`);

    const match = items.find((p) => String(p.reference || "").trim() === TARGET_REF);

    if (match) {
      foundPage = page;
      foundItem = match;
      foundStatus = r.status;
      console.log(`FOUND on page ${page}!`);
      break;
    }

    const nextPage = data.nextPage ?? data.NextPage ?? null;
    const total = data.pageCount ?? data.totalPages ?? null;

    if (!nextPage || nextPage === false || nextPage === 0) {
      console.log("No more pages.");
      break;
    }
    if (total != null && page >= total) {
      console.log("Reached last page.");
      break;
    }
  }

  // Write files
  if (foundItem) {
    fs.writeFileSync(files.v4Paged, JSON.stringify(foundItem, null, 2), "utf8");
    console.log("\nV4 paged output written: " + files.v4Paged);

    // Update meta file
    const meta = [];
    meta.push("=== EK Raw Payloads for Project 80229-001 ===\n");
    meta.push("NOTE: V4 ref endpoint was a shortcut - now using authoritative paged V4 source only.\n");

    meta.push(`V4 Paged Source: /api/v4.0/projects (paged scan, NOT ref endpoint)`);
    meta.push(`V4 Paged Endpoint: ${v4PagedBase}`);
    meta.push(`V4 Paged Page Number: ${foundPage}`);
    meta.push(`V4 Paged HTTP Status: ${foundStatus}`);
    meta.push(`V4 Paged Top-level keys: ${Object.keys(foundItem).length}`);
    meta.push(`V4 Paged Keys: ${Object.keys(foundItem).join(", ")}`);
    if (foundItem.reference) meta.push(`V4 Paged Reference: ${foundItem.reference}`);
    if (foundItem.projectID) meta.push(`V4 Paged ProjectID: ${foundItem.projectID}`);
    meta.push(`\nV4 Paged payload complete: YES (from paged endpoint, not ref)`);

    fs.writeFileSync(files.meta, meta.join("\n"), "utf8");
    console.log("Meta file updated: " + files.meta);

    console.log(`\nResult:`);
    console.log(`  File: output_80229_001_v4_paged_raw.json`);
    console.log(`  Endpoint: /api/v4.0/projects (paged)`);
    console.log(`  Page: ${foundPage}`);
    console.log(`  Fields: ${Object.keys(foundItem).length}`);
    console.log(`  Type: V4 paged (authoritative source)`);
  } else {
    console.log("\nERROR: Project 80229-001 not found in V4 paged scan!");
    process.exit(1);
  }
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
