/**
 * restart_and_requeue_bootstrap.js
 *
 * Run this script AFTER restarting the backend server.
 *
 * WHY: The previous bootstrap job was running with OLD server code that lacked
 * the upsertProjectMasterdataBatch() call. The server cached syncWorker.js at
 * startup — before this session's changes. All rows_processed were written to
 * project_core but NOTHING to project_masterdata_v4.
 *
 * WHAT THIS DOES:
 *  1. Marks the stale 'running' bootstrap job as failed
 *  2. Resets projects_v4 / projects_v3 endpoint states (clears watermark, resets to idle)
 *  3. Queues a fresh bootstrap job to run on the updated server
 *
 * SEQUENCE:
 *  1. Start Docker (DB at port 55432 must be accessible)
 *  2. Kill the old node process (or restart the backend server)
 *  3. Start the backend server fresh:  cd backend && node src/server.js
 *  4. Run this script:                 node scripts/restart_and_requeue_bootstrap.js
 *  5. The new server picks up the bootstrap job within seconds
 *  6. Monitor with:                    node scripts/check_sync_status.js
 */

const { Pool } = require("pg");
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const usesLocalDb = /127\.0\.0\.1|localhost/i.test(String(process.env.DATABASE_URL || ""));
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: usesLocalDb ? false : { rejectUnauthorized: false },
});

const TENANT_ID = "f1f51c07-2d88-4ee4-a766-78eac833a9d0"; // hoyrup-clemmensen

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Mark any stale 'running' bootstrap jobs as failed
    const staleJobs = await client.query(
      `UPDATE sync_job
          SET status = 'failed',
              error_message = 'stale_server_restart',
              finished_at = now(),
              updated_at = now()
        WHERE tenant_id = $1
          AND type IN ('bootstrap', 'bootstrap_initial')
          AND status = 'running'
        RETURNING id, type, rows_processed, pages_processed`,
      [TENANT_ID]
    );
    console.log(`Marked ${staleJobs.rowCount} stale bootstrap job(s) as failed:`);
    staleJobs.rows.forEach((r) =>
      console.log(`  id=${r.id} rows_processed=${r.rows_processed} pages_processed=${r.pages_processed}`)
    );

    // 2. Reset projects_v4 endpoint state (clear watermark so bootstrap starts from page 1)
    const v4Reset = await client.query(
      `INSERT INTO sync_endpoint_state (tenant_id, endpoint_key, status)
       VALUES ($1, 'projects_v4', 'idle')
       ON CONFLICT (tenant_id, endpoint_key)
       DO UPDATE SET
         status = 'idle',
         updated_after_watermark = NULL,
         last_successful_page = NULL,
         current_job_id = NULL,
         last_error = 'manually_reset_for_bootstrap',
         updated_at = now()
       RETURNING endpoint_key, status`,
      [TENANT_ID]
    );
    console.log(`Reset projects_v4 endpoint state: ${v4Reset.rowCount} row(s)`);

    // 3. Also reset projects_v3 if needed
    const v3Reset = await client.query(
      `INSERT INTO sync_endpoint_state (tenant_id, endpoint_key, status)
       VALUES ($1, 'projects_v3', 'idle')
       ON CONFLICT (tenant_id, endpoint_key)
       DO UPDATE SET
         status = 'idle',
         updated_after_watermark = NULL,
         last_successful_page = NULL,
         current_job_id = NULL,
         last_error = 'manually_reset_for_bootstrap',
         updated_at = now()
       RETURNING endpoint_key, status`,
      [TENANT_ID]
    );
    console.log(`Reset projects_v3 endpoint state: ${v3Reset.rowCount} row(s)`);

    // 4. Queue a new bootstrap job
    const newJob = await client.query(
      `INSERT INTO sync_job (tenant_id, type, status, rows_processed, pages_processed)
            VALUES ($1, 'bootstrap', 'queued', 0, 0)
        RETURNING id, type, status, created_at`,
      [TENANT_ID]
    );
    console.log(`New bootstrap job queued: ${JSON.stringify(newJob.rows[0])}`);

    await client.query("COMMIT");
    console.log("\nDone. The server should pick up the new bootstrap job within ~10 seconds.");
    console.log("Monitor with: node scripts/check_sync_status.js");
    console.log("\nExpected outcome:");
    console.log("  - project_core:           ~38,801 rows (already present, will be updated)");
    console.log("  - project_masterdata_v4:  ~22,000-29,000 rows after bootstrap completes");
    console.log("  - ek_project_id filled:   yes (projectEkId from V4 payload)");
    console.log("  - parent 18008:           included via pendingRows family flush");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("Script failed:", err.message);
  process.exit(1);
});
