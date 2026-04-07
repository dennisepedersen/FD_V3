require("dotenv").config({ path: require("path").resolve(__dirname, "../.env.production") });
const { Client } = require("pg");
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  await client.connect();
  const t = await client.query("SELECT id, slug FROM tenant LIMIT 3");
  console.log("tenants:", JSON.stringify(t.rows));
  const tenantId = t.rows[0].id;
  const fh = await client.query("SELECT COUNT(*) FROM fitter_hour WHERE tenant_id = $1", [tenantId]);
  console.log("fitter_hour count:", fh.rows[0].count);
  const fc = await client.query("SELECT COUNT(*) FROM fitter_category WHERE tenant_id = $1", [tenantId]);
  console.log("fitter_category count:", fc.rows[0].count);
  // Top project by fitter_hour hits
  const top = await client.query(`
    SELECT fh.external_project_ref, COUNT(*) AS cnt, COALESCE(SUM(COALESCE(fh.hours, fh.quantity, 0)),0) AS raw_hours
    FROM fitter_hour fh
    WHERE fh.tenant_id = $1 AND fh.external_project_ref IS NOT NULL
    GROUP BY fh.external_project_ref
    ORDER BY cnt DESC LIMIT 5
  `, [tenantId]);
  console.log("top projects by fitter_hour count:", JSON.stringify(top.rows, null, 2));
  await client.end();
})().catch(e => { console.error(e.message); process.exit(1); });
