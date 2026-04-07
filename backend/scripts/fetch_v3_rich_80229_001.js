/**
 * Scan V3 paged endpoint for project ref 80229-001 (rich format).
 * Also get one V4 paged row to see full field set including isClosed.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env.production") });
const crypto = require("crypto");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const TARGET_REF = "80229-001";
const DELAY_MS = 500;

function ek() { return crypto.createHash("sha256").update(process.env.JWT_SECRET).digest(); }
function dec(ct) {
  const [iv, tag, enc] = String(ct).split(".");
  const d = crypto.createDecipheriv("aes-256-gcm", ek(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64")), d.final()]).toString("utf8");
}

async function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

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

  // Also fetch one V4 paged row to see full field set (isClosed etc.)
  console.log("=== V4 PAGED - one item sample (to see isClosed field) ===");
  await delay(2000);
  const v4r = await fetch(base + "/api/v4.0/projects?page=1&pageSize=1", { headers });
  if (v4r.ok) {
    const v4d = await v4r.json();
    const items = Array.isArray(v4d) ? v4d : (v4d.data || v4d.items || v4d.projects || []);
    if (items.length > 0) {
      console.log("V4 field names:", Object.keys(items[0]));
      console.log("Sample row:", JSON.stringify(items[0], null, 2));
    }
  } else {
    console.log("V4 paged:", v4r.status);
  }

  // Scan V3 paged for 80229-001
  console.log("\n=== Scanning V3 paged for ref 80229-001 ===");
  const v3Base = base + "/api/v3.0/projects";
  let page = 1;
  let found = null;

  while (page <= 500) {
    await delay(DELAY_MS);
    const url = v3Base + `?page=${page}&pageSize=200`;
    const r = await fetch(url, { headers });

    if (r.status === 429) {
      console.log(`Page ${page}: 429, waiting 30s...`);
      await delay(30000);
      continue;
    }
    if (!r.ok) {
      console.log(`Page ${page}: HTTP ${r.status} - stopping`);
      break;
    }

    const d = await r.json();
    // V3 paged wraps: { data: [ { data: [...projects...], nextPage, ... } ] }
    // or sometimes: { data: [...projects...], nextPage }
    let items = [];
    if (Array.isArray(d)) {
      items = d;
    } else if (Array.isArray(d.data)) {
      // Could be outer wrapper
      const first = d.data[0];
      if (first && Array.isArray(first.data)) {
        items = first.data; // nested
      } else {
        items = d.data;
      }
    }

    // Determine nextPage
    const outerNext = d.nextPage ?? d.NextPage ?? null;
    const innerNext = (d.data?.[0]?.nextPage ?? d.data?.[0]?.NextPage) ?? null;
    const nextPage = outerNext ?? innerNext;

    console.log(`Page ${page}: ${items.length} items, nextPage=${nextPage}`);

    const match = items.find((p) => {
      const ref = p.ProjectReference || p.projectReference || p.reference || p.Reference ||
                  p.projectNumber || p.ProjectNumber;
      return String(ref || "").trim() === TARGET_REF;
    });

    if (match) {
      found = { page, url, raw: match };
      console.log("FOUND on page " + page + "!");
      break;
    }

    if (!nextPage || nextPage === false || nextPage === 0) {
      console.log("No more pages.");
      break;
    }
    page = typeof nextPage === "number" ? nextPage : page + 1;
  }

  if (found) {
    console.log("\n--- V3 RAW JSON (full rich format) ---");
    console.log("endpoint: " + v3Base);
    console.log("page:     " + found.page);
    console.log("\nraw JSON:");
    console.log(JSON.stringify(found.raw, null, 2));

    const DATE_KEYS = [
      "startDate","StartDate","endDate","EndDate",
      "updatedDate","UpdatedDate","createdDate","CreatedDate",
      "lastRegistration","LastRegistration","lastFitterHourDate","LastFitterHourDate",
      "lastModifiedDate","LastModifiedDate","changedDate","ChangedDate",
      "closedDate","ClosedDate","deliveryDate","DeliveryDate",
    ];
    const dateFields = {};
    for (const k of DATE_KEYS) {
      if (found.raw[k] !== undefined) dateFields[k] = found.raw[k];
    }
    console.log("\nDate fields extracted:");
    console.log(JSON.stringify(dateFields, null, 2));
  } else {
    console.log("\nNOT FOUND in V3 paged scan.");
  }
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
