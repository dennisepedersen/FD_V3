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

  const urls = [
    base + "/api/v3.0/projects/ref/80229-001",
    base + "/api/v3.0/projects?page=1&pageSize=5",
    base + "/api/v3.0/Management/WorkInProgress?page=1&pageSize=5",
  ];

  for (const url of urls) {
    console.log("\n--- " + url + " ---");
    const r = await fetch(url, { headers });
    console.log("Status:", r.status);
    if (r.ok) {
      const d = await r.json();
      console.log(JSON.stringify(d, null, 2).slice(0, 2000));
    } else {
      console.log(await r.text().catch(() => ""));
    }
    await new Promise((x) => setTimeout(x, 2000));
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
