require("dotenv").config({ path: require("path").resolve(__dirname, "../.env.production") });
const { Client } = require("pg");
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  await client.connect();
  const t = await client.query(`
    SELECT t.id, t.slug, 
      (SELECT COUNT(*) FROM fitter_hour fh WHERE fh.tenant_id = t.id) AS fh_count,
      (SELECT COUNT(*) FROM fitter_category fc WHERE fc.tenant_id = t.id) AS fc_count
    FROM tenant t
    ORDER BY fh_count DESC LIMIT 10
  `);
  console.log("tenants with data:", JSON.stringify(t.rows, null, 2));
  await client.end();
})().catch(e => { console.error(e.message); process.exit(1); });
