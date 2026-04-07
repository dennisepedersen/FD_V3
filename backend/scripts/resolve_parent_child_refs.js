'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const TENANT_ID = 'f1f51c07-2d88-4ee4-a766-78eac833a9d0';
const CHILD_REF = '80229-001';
const CHILD_EK_ID = 29167;
const PARENT_EK_ID = 18008;

async function main() {
  const client = await pool.connect();
  try {
    const { rows: parentRows } = await client.query(
      `SELECT pc.external_project_ref, pm.ek_project_id
       FROM project_masterdata_v4 pm
       JOIN project_core pc
         ON pc.project_id = pm.project_id
        AND pc.tenant_id = pm.tenant_id
       WHERE pm.tenant_id = $1
         AND pm.ek_project_id = $2`,
      [TENANT_ID, PARENT_EK_ID]
    );

    const { rows: childRows } = await client.query(
      `SELECT pc.external_project_ref, pm.ek_project_id, pm.parent_project_ek_id
       FROM project_masterdata_v4 pm
       JOIN project_core pc
         ON pc.project_id = pm.project_id
        AND pc.tenant_id = pm.tenant_id
       WHERE pm.tenant_id = $1
         AND (pc.external_project_ref = $2 OR pm.ek_project_id = $3)`,
      [TENANT_ID, CHILD_REF, CHILD_EK_ID]
    );

    const parentRefFromCore = await client.query(
      `SELECT external_project_ref
       FROM project_core
       WHERE tenant_id = $1
         AND external_project_ref IS NOT NULL
         AND external_project_ref <> ''
         AND external_project_ref::text = $2
       LIMIT 1`,
      [TENANT_ID, '80229']
    );

    console.log(JSON.stringify({
      parentRows,
      childRows,
      parent80229ExistsInProjectCore: parentRefFromCore.rowCount > 0,
    }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
