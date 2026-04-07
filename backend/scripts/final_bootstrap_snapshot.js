'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.production') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  try {
    const job = await client.query(`
      SELECT id, type, status, retry_count, started_at, finished_at, rows_processed, pages_processed, error_message
      FROM sync_job
      WHERE tenant_id = (SELECT id FROM tenant WHERE slug = 'hoyrup-clemmensen')
      ORDER BY created_at DESC
      LIMIT 5
    `);

    const counts = await client.query(`
      SELECT COUNT(*)::int AS total, COUNT(ek_project_id)::int AS with_ek_id
      FROM project_masterdata_v4
    `);

    const parent = await client.query(`
      SELECT pc.external_project_ref AS parent_ref, pm.ek_project_id AS parent_ek_id
      FROM project_masterdata_v4 pm
      JOIN project_core pc ON pc.project_id = pm.project_id AND pc.tenant_id = pm.tenant_id
      WHERE pm.ek_project_id = 18008
      LIMIT 1
    `);

    const child = await client.query(`
      SELECT pc.external_project_ref AS child_ref, pm.ek_project_id AS child_ek_id, pm.parent_project_ek_id AS parent_ek_id
      FROM project_masterdata_v4 pm
      JOIN project_core pc ON pc.project_id = pm.project_id AND pc.tenant_id = pm.tenant_id
      WHERE pc.external_project_ref = '80229-001'
      LIMIT 1
    `);

    console.log(JSON.stringify({
      jobs: job.rows,
      masterdataCounts: counts.rows[0],
      parent18008: parent.rows[0] || null,
      child80229_001: child.rows[0] || null,
    }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
