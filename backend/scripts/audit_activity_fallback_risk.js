require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.production') });
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const tenantSql = `SELECT id FROM tenant WHERE slug = 'hoyrup-clemmensen' LIMIT 1`;
    const tenantRes = await pool.query(tenantSql);
    const tenantId = tenantRes.rows[0]?.id;

    const countSql = `
      SELECT
        COUNT(*)::int AS rows_with_core_activity_no_wip,
        COUNT(*) FILTER (WHERE pc.activity_date IS NOT NULL)::int AS core_activity_total,
        COUNT(*) FILTER (WHERE pw.last_registration IS NOT NULL OR pw.last_fitter_hour_date IS NOT NULL)::int AS wip_activity_total
      FROM project_core pc
      LEFT JOIN project_wip pw
        ON pw.project_id = pc.project_id
       AND pw.tenant_id = pc.tenant_id
      WHERE pc.tenant_id = $1
        AND pc.activity_date IS NOT NULL
        AND pw.last_registration IS NULL
        AND pw.last_fitter_hour_date IS NULL
    `;
    const countRes = await pool.query(countSql, [tenantId]);

    const sampleSql = `
      SELECT
        pc.external_project_ref,
        pc.activity_date,
        pc.status,
        pc.is_closed,
        pw.last_registration,
        pw.last_fitter_hour_date
      FROM project_core pc
      LEFT JOIN project_wip pw
        ON pw.project_id = pc.project_id
       AND pw.tenant_id = pc.tenant_id
      WHERE pc.tenant_id = $1
        AND pc.activity_date IS NOT NULL
        AND pw.last_registration IS NULL
        AND pw.last_fitter_hour_date IS NULL
      ORDER BY pc.activity_date DESC
      LIMIT 10
    `;
    const sampleRes = await pool.query(sampleSql, [tenantId]);

    console.log(JSON.stringify({
      tenantId,
      counts: countRes.rows[0],
      sampleRows: sampleRes.rows,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
