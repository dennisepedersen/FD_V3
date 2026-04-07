const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env.production") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /127\.0\.0\.1|localhost/i.test(String(process.env.DATABASE_URL || "")) ? false : { rejectUnauthorized: false },
});

const TENANT_ID = "f1f51c07-2d88-4ee4-a766-78eac833a9d0";

pool.query(
  `SELECT id, type, status, rows_processed, pages_processed, started_at, finished_at, error_message, updated_at
   FROM sync_job
   WHERE tenant_id = $1
   ORDER BY created_at DESC
   LIMIT 5`,
  [TENANT_ID]
).then(r => {
  console.log("Recent jobs:");
  r.rows.forEach(row => {
    console.log(`  ${row.id}`);
    console.log(`    type=${row.type} status=${row.status}`);
    console.log(`    rows=${row.rows_processed} pages=${row.pages_processed}`);
    console.log(`    started=${row.started_at} finished=${row.finished_at}`);
    if (row.error_message) console.log(`    error=${row.error_message}`);
  });
  pool.end();
}).catch(e => {
  console.error(e.message);
  pool.end();
});
