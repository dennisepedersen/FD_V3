'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.production') });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  // Endpoint state
  const { rows: epState } = await pool.query(`
    SELECT ses.endpoint_key, ses.status, ses.last_successful_page,
           ses.pages_processed_last_job, ses.rows_fetched_last_job,
           ses.rows_fetched, ses.rows_persisted,
           ses.updated_after_watermark, ses.last_error
    FROM sync_endpoint_state ses
    JOIN tenant t ON t.id = ses.tenant_id
    WHERE t.slug = 'hoyrup-clemmensen'
      AND ses.endpoint_key IN ('projects', 'projects_v3', 'projects_v4')
  `);
  console.log('Endpoint state:');
  epState.forEach(r => console.log(' ', JSON.stringify(r)));

  // Page log summary for projects_v4 — how many rows persisted per page?
  const { rows: pageLogs } = await pool.query(`
    SELECT spl.page_number, spl.rows_fetched, spl.rows_persisted, spl.status, spl.mode
    FROM sync_page_log spl
    JOIN tenant t ON t.id = spl.tenant_id
    WHERE t.slug = 'hoyrup-clemmensen'
      AND spl.endpoint_key = 'projects_v4'
    ORDER BY spl.created_at DESC, spl.page_number DESC
    LIMIT 30
  `);
  console.log('\nprojects_v4 recent page logs (newest page first):');
  pageLogs.forEach(r => console.log(
    `  page=${r.page_number} fetched=${r.rows_fetched} persisted=${r.rows_persisted} status=${r.status} mode=${r.mode}`
  ));

  // Total rows persisted across last job run
  const { rows: jobSummary } = await pool.query(`
    SELECT
      SUM(spl.rows_fetched) AS total_fetched,
      SUM(spl.rows_persisted) AS total_persisted,
      COUNT(*) AS pages,
      MAX(spl.page_number) AS max_page,
      spl.mode
    FROM sync_page_log spl
    JOIN tenant t ON t.id = spl.tenant_id
    WHERE t.slug = 'hoyrup-clemmensen'
      AND spl.endpoint_key = 'projects_v4'
      AND spl.created_at > now() - interval '24 hours'
    GROUP BY spl.mode
  `);
  console.log('\nprojects_v4 last 24h summary:');
  jobSummary.forEach(r => console.log(' ', JSON.stringify(r)));
}

main().then(() => pool.end()).catch(e => { console.error(e.message); pool.end(); });
