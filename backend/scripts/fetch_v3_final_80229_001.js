/**
 * Scan V3 paged (total-based pagination, 7 pages) for project ref 80229-001.
 * Also fetch V4 paged sample to confirm isClosed and other fields.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env.production") });
const crypto = require("crypto");
const { Pool } = require("pg");

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

  // --- V4 paged sample: get first item to see isClosed and full field set ---
  console.log("=== V4 PAGED - sample to confirm field set ===");
  await delay(2000);
  const v4pr = await fetch(base + "/api/v4.0/projects?page=1&pageSize=1", { headers });
  console.log("V4 paged status:", v4pr.status);
  if (v4pr.ok) {
    const v4pd = await v4pr.json();
    const items = Array.isArray(v4pd) ? v4pd : (v4pd.data || v4pd.items || v4pd.projects || []);
    const item = Array.isArray(items[0]?.data) ? items[0].data[0] : items[0];
    if (item) {
      console.log("V4 paged field names:", Object.keys(item));
      console.log("V4 paged sample:\n", JSON.stringify(item, null, 2));
    }
  }

  // --- V3 scan: total-based pagination ---
  console.log("\n=== Scanning V3 paged (/api/v3.0/projects) for ref 80229-001 ===");
  const v3Base = base + "/api/v3.0/projects";
  let page = 1;
  let totalItems = null;
  let found = null;

  while (true) {
    await delay(600);
    const url = v3Base + `?page=${page}&pageSize=${PAGE_SIZE}`;
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
    // Structure: { data: [ { data: [...items...], total: N } ] }
    const wrapper = Array.isArray(d.data) ? d.data[0] : null;
    const items = wrapper && Array.isArray(wrapper.data) ? wrapper.data : [];

    if (totalItems === null && wrapper?.total != null) {
      totalItems = Number(wrapper.total);
      const totalPages = Math.ceil(totalItems / PAGE_SIZE);
      console.log(`Total items: ${totalItems}, estimated pages: ${totalPages}`);
    }

    console.log(`Page ${page}: ${items.length} items`);

    const match = items.find((p) => {
      const ref = p.ProjectReference || p.projectReference || p.reference || p.Reference ||
                  p.projectNumber || p.ProjectNumber;
      return String(ref || "").trim() === TARGET_REF;
    });

    if (match) {
      found = { page, url, raw: match };
      console.log(`FOUND on page ${page}!`);
      break;
    }

    // Check if we've seen all items
    const fetched = (page - 1) * PAGE_SIZE + items.length;
    if (items.length < PAGE_SIZE || (totalItems != null && fetched >= totalItems)) {
      console.log("No more pages.");
      break;
    }

    page += 1;
  }

  if (found) {
    console.log("\n--- V3 RAW JSON (full rich WorkInProgress format) ---");
    console.log("endpoint:", v3Base);
    console.log("page:    ", found.page);
    console.log("\nraw JSON:");
    console.log(JSON.stringify(found.raw, null, 2));

    const DATE_KEYS = [
      "startDate","StartDate","endDate","EndDate",
      "updatedDate","UpdatedDate","createdDate","CreatedDate",
      "lastRegistration","LastRegistration","lastFitterHourDate","LastFitterHourDate",
      "lastModifiedDate","LastModifiedDate","changedDate","ChangedDate",
      "closedDate","ClosedDate","deliveryDate","DeliveryDate",
      "offerDate","OfferDate","orderDate","OrderDate",
    ];
    const dateFields = {};
    for (const k of DATE_KEYS) {
      if (found.raw[k] !== undefined) dateFields[k] = found.raw[k];
    }
    console.log("\nDate fields:");
    console.log(JSON.stringify(dateFields, null, 2));
  } else {
    console.log("\nNOT FOUND in V3 paged scan (project may be closed/not in WorkInProgress).");
  }

  console.log("\n" + "=".repeat(60));
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
