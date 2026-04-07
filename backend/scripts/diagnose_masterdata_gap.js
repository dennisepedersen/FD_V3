'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.production') });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  // 1. How many rows in project_core for this tenant?
  const { rows: coreCounts } = await pool.query(`
    SELECT
      COUNT(*) AS total_projects,
      COUNT(*) FILTER (WHERE is_closed = false OR is_closed IS NULL) AS not_closed
    FROM project_core pc
    JOIN tenant t ON t.id = pc.tenant_id
    WHERE t.slug = 'hoyrup-clemmensen'
  `);
  console.log('\nproject_core counts:', coreCounts[0]);

  // 2. How many rows in project_masterdata_v4?
  const { rows: mdCounts } = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(ek_project_id) AS with_ek_id,
      COUNT(*) FILTER (WHERE is_closed = false) AS active_not_closed
    FROM project_masterdata_v4 pm
    JOIN tenant t ON t.id = pm.tenant_id
    WHERE t.slug = 'hoyrup-clemmensen'
  `);
  console.log('project_masterdata_v4 counts:', mdCounts[0]);

  // 3. How many active (isClosed=false) in V4 raw data?
  // We can't query EK directly, but we can see what the endpoint state says was fetched
  const { rows: epState } = await pool.query(`
    SELECT endpoint_key, status, last_successful_page, pages_processed_last_job,
           rows_fetched_last_job, rows_fetched, rows_persisted,
           updated_after_watermark, last_error
    FROM sync_endpoint_state ses
    JOIN tenant t ON t.id = ses.tenant_id
    WHERE t.slug = 'hoyrup-clemmensen'
      AND endpoint_key IN ('projects', 'projects_v3', 'projects_v4')
  `);
  console.log('\nendpoint state for project endpoints:');
  epState.forEach(r => console.log(' ', JSON.stringify(r)));

  // 4. Most recent page log for projects_v4 — how many rows persisted per page?
  const { rows: pageLogs } = await pool.query(`
    SELECT page_number, rows_fetched, rows_persisted, status, mode
    FROM sync_page_log spl
    JOIN tenant t ON t.id = spl.tenant_id
    WHERE t.slug = 'hoyrup-clemmensen'
      AND spl.endpoint_key = 'projects_v4'
    ORDER BY spl.created_at DESC
    LIMIT 20
  `);
  console.log('\nMost recent projects_v4 page logs (newest first):');
  pageLogs.forEach(r => console.log(
    `  page=${r.page_number} fetched=${r.rows_fetched} persisted=${r.rows_persisted} status=${r.status} mode=${r.mode}`
  ));

  // 5. Check if project_masterdata_v4 insert is actually blocked by project_core JOIN
  // i.e., how many project_core rows match the condition for upsert to project_masterdata_v4?
  const { rows: joinCheck } = await pool.query(`
    SELECT COUNT(*) AS project_core_rows_for_hoyrup
    FROM project_core pc
    JOIN tenant t ON t.id = pc.tenant_id
    WHERE t.slug = 'hoyrup-clemmensen'
  `);
  console.log('\nproject_core rows available for masterdata JOIN:', joinCheck[0]);
}

main().then(() => pool.end()).catch(e => { console.error(e.message); pool.end(); });
