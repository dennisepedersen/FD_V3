const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env.production") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /127\.0\.0\.1|localhost/i.test(String(process.env.DATABASE_URL || "")) ? false : { rejectUnauthorized: false },
});

const TENANT_ID = "f1f51c07-2d88-4ee4-a766-78eac833a9d0";

async function check() {
  const deferred = await pool.query(
    `SELECT id, endpoint_key, error_message, status, attempts, next_retry_at FROM sync_failure_backlog WHERE tenant_id = $1 AND endpoint_key = 'projects_v4' AND status = 'deferred' LIMIT 5`,
    [TENANT_ID]
  );
  
  console.log("\n===== DEFERRED BACKLOG (first 5) =====");
  deferred.rows.forEach(row => {
    console.log(`\nID: ${row.id}`);
    console.log(`  Error: ${row.error_message.slice(0, 200)}`);
    console.log(`  Attempts: ${row.attempts}`);
    console.log(`  Next retry: ${row.next_retry_at}`);
  });
  
  const summary = await pool.query(
    `SELECT error_message, COUNT(*) as cnt FROM sync_failure_backlog WHERE tenant_id = $1 AND endpoint_key = 'projects_v4' AND status = 'deferred' GROUP BY error_message`,[TENANT_ID]
  );
  
  console.log("\n===== ERROR SUMMARY (deferred) =====");
  summary.rows.forEach(row => {
    console.log(`  [${row.cnt}x] ${row.error_message.slice(0, 150)}`);
  });
  
  await pool.end();
}

check().catch(console.error);
