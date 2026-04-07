'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.production') });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  // 1. Does parent 18008 exist in project_core at all?
  const { rows: coreRows } = await pool.query(`
    SELECT
      pc.external_project_ref AS ref,
      pc.status,
      pc.is_closed,
      pm.ek_project_id,
      pm.parent_project_ek_id,
      pm.is_subproject,
      pm.is_closed AS pm_is_closed,
      pm.source_updated_at
    FROM project_core pc
    LEFT JOIN project_masterdata_v4 pm
      ON pm.project_id = pc.project_id
     AND pm.tenant_id  = pc.tenant_id
    WHERE pm.ek_project_id = 18008
       OR pm.parent_project_ek_id = 18008
    ORDER BY pc.external_project_ref
  `);

  console.log('\nRows in project_core+masterdata for family root 18008:');
  if (coreRows.length === 0) {
    console.log('  (none) — parent 18008 has NO project_core row. It was never synced.');
  } else {
    coreRows.forEach((r) => console.log(' ', JSON.stringify(r)));
  }

  // 2. What does project_masterdata_v4 contain for reference 80229-001?
  const { rows: subRows } = await pool.query(`
    SELECT
      pc.external_project_ref AS ref,
      pm.ek_project_id,
      pm.parent_project_ek_id,
      pm.is_closed,
      pm.is_subproject,
      pm.total_turn_over_exp,
      pm.source_updated_at
    FROM project_masterdata_v4 pm
    JOIN project_core pc ON pc.project_id = pm.project_id AND pc.tenant_id = pm.tenant_id
    WHERE pc.external_project_ref = '80229-001'
  `);

  console.log('\nproject_masterdata_v4 row for 80229-001:');
  if (subRows.length === 0) {
    console.log('  (none)');
  } else {
    subRows.forEach((r) => console.log(' ', JSON.stringify(r)));
  }

  // 3. Total rows in project_masterdata_v4 (so we know if bootstrap has run)
  const { rows: countRows } = await pool.query(`
    SELECT COUNT(*) AS total, COUNT(ek_project_id) AS with_ek_id FROM project_masterdata_v4
  `);
  console.log('\nproject_masterdata_v4 total rows:', countRows[0]);
}

main().then(() => pool.end()).catch((e) => { console.error(e.message); pool.end(); });
