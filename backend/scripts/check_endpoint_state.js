const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env.production") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /127\.0\.0\.1|localhost/i.test(String(process.env.DATABASE_URL || "")) ? false : { rejectUnauthorized: false },
});

const TENANT_ID = "f1f51c07-2d88-4ee4-a766-78eac833a9d0";

async function check() {
  const endpoints = await pool.query(
    `SELECT endpoint_key, status, last_successful_page, current_mode, last_error, updated_at FROM sync_endpoint_state WHERE tenant_id = $1 AND endpoint_key IN ('projects_v4', 'projects_v3', 'projects') ORDER BY endpoint_key`,
    [TENANT_ID]
  );
  
  console.log("\n===== ENDPOINT STATE =====");
  endpoints.rows.forEach(ep => {
    console.log(`\n${ep.endpoint_key}:`);
    console.log(`  status: ${ep.status}`);
    console.log(`  last_page: ${ep.last_successful_page}`);
    console.log(`  mode: ${ep.current_mode}`);
    console.log(`  error: ${ep.last_error || "(none)"}`);
    console.log(`  updated: ${ep.updated_at}`);
  });
  
  const jobs = await pool.query(
    `SELECT id, type, status, rows_processed, pages_processed, started_at, finished_at, error_message FROM sync_job WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 3`,
    [TENANT_ID]
  );
  
  console.log("\n===== RECENT JOBS =====");
  jobs.rows.forEach(job => {
    console.log(`\n${job.id}`);
    console.log(`  type: ${job.type}, status: ${job.status}`);
    console.log(`  rows: ${job.rows_processed}, pages: ${job.pages_processed}`);
    console.log(`  started: ${job.started_at}, finished: ${job.finished_at}`);
    if (job.error_message) console.log(`  error: ${job.error_message}`);
  });
  
  await pool.end();
}

check().catch(console.error);
