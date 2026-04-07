/**
 * Debug V3 paged structure - show outer structure and pagination fields.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env.production") });
const crypto = require("crypto");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

function ek() { return crypto.createHash("sha256").update(process.env.JWT_SECRET).digest(); }
function dec(ct) {
  const [iv, tag, enc] = String(ct).split(".");
  const d = crypto.createDecipheriv("aes-256-gcm", ek(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64")), d.final()]).toString("utf8");
}

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

  // Fetch page 1 of V3 and show structure WITHOUT items array
  const url = base + "/api/v3.0/projects?page=1&pageSize=5";
  console.log("Fetching:", url);
  const r = await fetch(url, { headers });
  console.log("Status:", r.status);
  const raw = await r.json();

  // Print top-level keys
  console.log("\nTop-level keys:", Object.keys(raw));

  // If raw.data is array, show first element's keys (minus data array)
  if (Array.isArray(raw.data)) {
    const first = raw.data[0];
    if (first) {
      const stripped = { ...first };
      if (Array.isArray(stripped.data)) {
        stripped.data = `[Array of ${stripped.data.length} items, first keys: ${Object.keys(stripped.data[0] || {}).join(", ").slice(0, 200)}]`;
      }
      console.log("\nraw.data[0] structure:");
      console.log(JSON.stringify(stripped, null, 2));
    }
  }

  // Show full raw with items truncated
  const display = JSON.parse(JSON.stringify(raw));
  if (Array.isArray(display.data)) {
    display.data = display.data.map((d) => {
      if (d && Array.isArray(d.data)) {
        return { ...d, data: `<<${d.data.length} items>>` };
      }
      return d;
    });
  }
  console.log("\nFull outer structure:");
  console.log(JSON.stringify(display, null, 2));
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
