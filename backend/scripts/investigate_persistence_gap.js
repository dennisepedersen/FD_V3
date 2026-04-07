const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env.production") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /127\.0\.0\.1|localhost/i.test(String(process.env.DATABASE_URL || "")) ? false : { rejectUnauthorized: false },
});

const TENANT_ID = "f1f51c07-2d88-4ee4-a766-78eac833a9d0";
const JOB_ID = "33354a94-53bc-442e-b0d0-4995635b970a";

async function investigate() {
  // Check backlog for this job
  const backlog = await pool.query(
    `SELECT COUNT(*) as total, status FROM sync_failure_backlog WHERE tenant_id = $1 AND endpoint_key = 'projects_v4' GROUP BY status`,
    [TENANT_ID]
  );
  
  console.log("\n===== BACKLOG FOR projects_v4 =====");
  if (backlog.rows.length === 0) {
    console.log("No backlog entries");
  } else {
    backlog.rows.forEach(r => {
      console.log(`  ${r.status}: ${r.total}`);
    });
  }
  
  // Check page_metrics for this job
  const metrics = await pool.query(
    `SELECT COUNT(*) as total, page, raw_rows, scoped_rows, mapped_rows FROM page_metrics WHERE tenant_id = $1 AND job_id = $2 GROUP BY page, raw_rows, scoped_rows, mapped_rows ORDER BY page LIMIT 15`,
    [TENANT_ID, JOB_ID]
  );
  
  console.log("\n===== PAGE_METRICS FOR JOB 33354 =====");
  if (metrics.rows.length === 0) {
    console.log("No page_metrics entries (persist layer not instrumented?)");
  } else {
    let totalRaw = 0, totalScoped = 0, totalMapped = 0;
    metrics.rows.forEach(r => {
      totalRaw += r.raw_rows;
      totalScoped += r.scoped_rows;
      totalMapped += r.mapped_rows;
      console.log(`  Page ${r.page}: raw=${r.raw_rows} scoped=${r.scoped_rows} mapped=${r.mapped_rows}`);
    });
    console.log(`  TOTALS: raw=${totalRaw} scoped=${totalScoped} mapped=${totalMapped}`);
  }
  
  // Check masterdata_upsert log
  const upsert = await pool.query(
    `SELECT COUNT(*) as logs, SUM(incoming_count) as total_incoming, SUM(upserted_count) as total_upserted FROM masterdata_upsert WHERE tenant_id = $1 AND job_id = $2`,
    [TENANT_ID, JOB_ID]
  );
  
  console.log("\n===== MASTERDATA_UPSERT LOG =====");
  const upsertRow = upsert.rows[0];
  if (upsertRow.logs === 0) {
    console.log("No masterdata_upsert logs");
  } else {
    console.log(`  ${upsertRow.logs} upsert calls`);
    console.log(`  Total incoming: ${upsertRow.total_incoming}`);
    console.log(`  Total upserted: ${upsertRow.total_upserted}`);
  }
  
  // Final count
  const final = await pool.query(
    `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE ek_project_id IS NOT NULL) as with_ek_id FROM project_masterdata_v4 WHERE tenant_id = $1`,
    [TENANT_ID]
  );
  
  console.log("\n===== CURRENT MASTERDATA STATE =====");
  console.log(`  Total rows: ${final.rows[0].total}`);
  console.log(`  With ek_project_id: ${final.rows[0].with_ek_id}`);
  
  console.log("\n===== DIAGNOSTIC =====");
  console.log(`Job 33354 fetched 2400 rows (rows_processed=2400 from DB)`);
  console.log(`But masterdata_v4 still has only ${final.rows[0].total} rows`);
  console.log(`This means: Rows were FETCHED but NOT PERSISTED to masterdata_v4`);
  
  await pool.end();
}

investigate().catch(console.error);
