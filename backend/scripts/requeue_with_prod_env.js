const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env.production") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /127\.0\.0\.1|localhost/i.test(String(process.env.DATABASE_URL || "")) ? false : { rejectUnauthorized: false },
});

const TENANT_ID = "f1f51c07-2d88-4ee4-a766-78eac833a9d0";

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Mark stale bootstrap jobs as failed
    const staleJobs = await client.query(
      `UPDATE sync_job
       SET status = 'failed', finished_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND type IN ('bootstrap', 'bootstrap_initial') AND status = 'running'
       RETURNING id, rows_processed, pages_processed`,
      [TENANT_ID]
    );
    console.log(`Marked ${staleJobs.rowCount} stale jobs as failed`);
    staleJobs.rows.forEach((r) => console.log(`  id=${r.id} rows=${r.rows_processed} pages=${r.pages_processed}`));

    // Reset projects_v4
    await client.query(
      `INSERT INTO sync_endpoint_state (tenant_id, endpoint_key, status)
       VALUES ($1, 'projects_v4', 'idle')
       ON CONFLICT (tenant_id, endpoint_key)
       DO UPDATE SET status = 'idle', updated_after_watermark = NULL, last_successful_page = NULL, current_job_id = NULL, updated_at = now()`,
      [TENANT_ID]
    );
    console.log("Reset projects_v4");

    // Reset projects_v3
    await client.query(
      `INSERT INTO sync_endpoint_state (tenant_id, endpoint_key, status)
       VALUES ($1, 'projects_v3', 'idle')
       ON CONFLICT (tenant_id, endpoint_key)
       DO UPDATE SET status = 'idle', updated_after_watermark = NULL, last_successful_page = NULL, current_job_id = NULL, updated_at = now()`,
      [TENANT_ID]
    );
    console.log("Reset projects_v3");

    // Queue new bootstrap job
    const newJob = await client.query(
      `INSERT INTO sync_job (tenant_id, type, status, created_at, updated_at)
       VALUES ($1, 'bootstrap', 'queued', now(), now())
       RETURNING id`,
      [TENANT_ID]
    );
    const jobId = newJob.rows[0].id;
    console.log(`Queued new bootstrap job: ${jobId}`);

    await client.query("COMMIT");
    console.log("✓ Bootstrap requeue complete");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("ERROR:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
