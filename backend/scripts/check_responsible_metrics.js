require('dotenv').config({ path: '../.env.production' });
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const sql = [
  'SELECT',
  'COUNT(*) AS total,',
  "COUNT(*) FILTER (WHERE responsible_code IS NOT NULL AND btrim(responsible_code) <> '') AS responsible_set,",
  "COUNT(*) FILTER (WHERE lower(btrim(coalesce(responsible_code,''))) = 'dep') AS dep_match",
  'FROM project_core pc',
  'JOIN tenant t ON t.id = pc.tenant_id',
  "WHERE t.slug = 'hoyrup-clemmensen'"
].join(' ');

p.query(sql).then(r => {
  console.log(JSON.stringify(r.rows[0], null, 2));
  p.end();
}).catch(e => {
  console.error(e.message);
  p.end();
});
