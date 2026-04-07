require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.production') });
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const sql = `
      SELECT
        pc.external_project_ref,
        pw.calculated_days_since_last_registration,
        pw.last_registration,
        pw.last_fitter_hour_date,
        pm.parent_project_ek_id,
        pm.is_subproject,
        pm.total_turn_over_exp
      FROM project_core pc
      LEFT JOIN project_wip pw
        ON pw.project_id = pc.project_id
       AND pw.tenant_id = pc.tenant_id
      LEFT JOIN project_masterdata_v4 pm
        ON pm.project_id = pc.project_id
       AND pm.tenant_id = pc.tenant_id
      WHERE pc.external_project_ref = '80229-001'
        AND pc.tenant_id = (SELECT id FROM tenant WHERE slug = 'hoyrup-clemmensen')
      LIMIT 1
    `;
    const { rows } = await pool.query(sql);
    console.log(JSON.stringify(rows[0] || null, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
