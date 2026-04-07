'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.production') });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const { rows: cols } = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='sync_page_log'"
  );
  console.log('sync_page_log columns:', cols.map(c => c.column_name));

  const { rows: pageLogs } = await pool.query(`
    SELECT spl.page_number, spl.rows_fetched, spl.rows_persisted, spl.status, spl.mode
    FROM sync_page_log spl
    JOIN tenant t ON t.id = spl.tenant_id
    WHERE t.slug = 'hoyrup-clemmensen'
      AND spl.endpoint_key = 'projects_v4'
    ORDER BY spl.started_at DESC
    LIMIT 20
  `);
  console.log('\nprojects_v4 recent page logs:');
  pageLogs.forEach(r => console.log(
    `  page=${r.page_number} fetched=${r.rows_fetched} persisted=${r.rows_persisted} status=${r.status} mode=${r.mode}`
  ));

  // Summary of last run
  const { rows: summary } = await pool.query(`
    SELECT
      SUM(spl.rows_fetched) AS total_fetched,
      SUM(spl.rows_persisted) AS total_persisted,
      COUNT(*) AS page_count,
      MAX(spl.page_number) AS max_page,
      MIN(spl.started_at) AS started,
      MAX(spl.finished_at) AS finished
    FROM sync_page_log spl
    JOIN tenant t ON t.id = spl.tenant_id
    WHERE t.slug = 'hoyrup-clemmensen'
      AND spl.endpoint_key = 'projects_v4'
  `);
  console.log('\nprojects_v4 all-time summary:');
  summary.forEach(r => console.log(' ', JSON.stringify(r)));
}

main().then(() => pool.end()).catch(e => { console.error(e.message); pool.end(); });
