require('dotenv').config({ path: '../.env.production' });
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const sql = [
  'SELECT sj.id, sj.type, sj.status, sj.retry_count,',
  'sj.started_at, sj.finished_at, sj.updated_at,',
  'sj.rows_processed, sj.pages_processed, sj.error_message',
  'FROM sync_job sj',
  'JOIN tenant t ON t.id = sj.tenant_id',
  "WHERE t.slug = 'hoyrup-clemmensen'",
  'ORDER BY sj.created_at DESC',
  'LIMIT 5'
].join(' ');

p.query(sql).then(r => {
  console.log(JSON.stringify(r.rows, null, 2));
  p.end();
}).catch(e => {
  console.error(e.message);
  p.end();
});
