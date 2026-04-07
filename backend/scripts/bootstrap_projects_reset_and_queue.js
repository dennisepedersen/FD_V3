'use strict';
/**
 * bootstrap_projects_reset_and_queue.js
 *
 * Safe re-bootstrap for project sync:
 *  1. Resets stuck 'projects' endpoint from 'running' to 'idle'
 *  2. Resets projects_v4 watermark → bootstrap will start from page 1
 *  3. Resets projects_v3 state (if exists) similarly
 *  4. Clears stale 'running'/'queued' bootstrap jobs (avoids conflicts)
 *  5. Queues a new bootstrap job (type='bootstrap')
 *
 * The running app process (syncWorker) will pick up the job on next poll (~12s).
 * NO data is deleted. Upserts will overwrite existing project_core +
 * project_masterdata_v4 rows safely.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.production') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const TENANT_SLUG = 'hoyrup-clemmensen';

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Look up tenant
    const { rows: tenantRows } = await client.query(
      'SELECT id FROM tenant WHERE slug = $1 LIMIT 1',
      [TENANT_SLUG]
    );
    if (tenantRows.length === 0) throw new Error(`Tenant '${TENANT_SLUG}' not found`);
    const tenantId = tenantRows[0].id;
    console.log(`tenant_id: ${tenantId}`);

    // 2. Reset stuck 'projects' legacy endpoint state (running → idle)
    //    This was left stuck from the old V3 sync and blocks nothing, but clean it up.
    const resetProjects = await client.query(`
      UPDATE sync_endpoint_state
      SET
        status = 'idle',
        current_job_id = NULL,
        last_error = 'manually_reset_for_bootstrap: stuck running state from pre-V4-split sync',
        updated_at = now()
      WHERE tenant_id = $1
        AND endpoint_key = 'projects'
        AND status = 'running'
    `, [tenantId]);
    console.log(`Reset stuck 'projects' endpoint: ${resetProjects.rowCount} row(s) updated`);

    // 3. Reset projects_v4 endpoint: clear watermark and last_successful_page
    //    so the bootstrap starts from page 1 with no updatedAfter filter.
    //    Note: Bootstrap mode ignores watermark anyway (updatedAfter=null),
    //    but clearing it ensures future delta runs start fresh after bootstrap.
    const resetV4 = await client.query(`
      INSERT INTO sync_endpoint_state (tenant_id, endpoint_key, status)
      VALUES ($1, 'projects_v4', 'idle')
      ON CONFLICT (tenant_id, endpoint_key) DO UPDATE SET
        status = 'idle',
        updated_after_watermark = NULL,
        last_successful_page = NULL,
        current_job_id = NULL,
        last_error = 'manually_reset_for_bootstrap',
        updated_at = now()
    `, [tenantId]);
    console.log(`Reset 'projects_v4' endpoint state: ${resetV4.rowCount} row(s) upserted`);

    // 4. Reset projects_v3 (may not exist yet — upsert creates if missing)
    const resetV3 = await client.query(`
      INSERT INTO sync_endpoint_state (tenant_id, endpoint_key, status)
      VALUES ($1, 'projects_v3', 'idle')
      ON CONFLICT (tenant_id, endpoint_key) DO UPDATE SET
        status = 'idle',
        updated_after_watermark = NULL,
        last_successful_page = NULL,
        current_job_id = NULL,
        last_error = 'manually_reset_for_bootstrap',
        updated_at = now()
    `, [tenantId]);
    console.log(`Reset 'projects_v3' endpoint state: ${resetV3.rowCount} row(s) upserted`);

    // 5. Fail any currently queued/running bootstrap jobs to avoid conflicts
    const clearStale = await client.query(`
      UPDATE sync_job
      SET
        status = 'failed',
        error_message = 'superseded_by_new_bootstrap',
        finished_at = now()
      WHERE tenant_id = $1
        AND type IN ('bootstrap', 'bootstrap_initial')
        AND status IN ('queued', 'running')
    `, [tenantId]);
    console.log(`Cancelled stale bootstrap jobs: ${clearStale.rowCount} row(s)`);

    // 6. Queue the new bootstrap job
    const { rows: newJob } = await client.query(`
      INSERT INTO sync_job (tenant_id, type, status, rows_processed, pages_processed)
      VALUES ($1, 'bootstrap', 'queued', 0, 0)
      RETURNING id, type, status, created_at
    `, [tenantId]);
    console.log(`Queued new bootstrap job: ${JSON.stringify(newJob[0])}`);

    await client.query('COMMIT');
    console.log('\nDone. The running syncWorker will pick up this job on the next poll (~12s).');
    console.log('Monitor with: node scripts/check_sync_status.js');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error (rolled back):', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
