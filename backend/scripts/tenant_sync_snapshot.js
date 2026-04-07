require('dotenv').config({ path: '../.env.production' });
const { Pool } = require('pg');

const TENANT_SLUG = process.argv[2] || 'hoyrup-clemmensen';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();
  try {
    const counts = await client.query(
      `
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE pc.status = 'closed' OR pc.is_closed = true) AS closed_count,
          COUNT(*) FILTER (WHERE COALESCE(pc.is_closed, false) = false AND pc.status = 'open') AS open_count,
          COUNT(*) FILTER (WHERE lower(btrim(coalesce(responsible_code,''))) = 'dep') AS dep_total,
          COUNT(*) FILTER (WHERE lower(btrim(coalesce(responsible_code,''))) = 'dep' AND COALESCE(pc.is_closed, false) = false AND pc.status = 'open') AS dep_open
        FROM project_core pc
        JOIN tenant t ON t.id = pc.tenant_id
        WHERE t.slug = $1
      `,
      [TENANT_SLUG]
    );

    const latest = await client.query(
      `
        SELECT
          pc.external_project_ref,
          pc.name,
          pc.status,
          pc.is_closed,
          pc.activity_date,
          pc.updated_at,
          pc.responsible_code,
          pc.responsible_name
        FROM project_core pc
        JOIN tenant t ON t.id = pc.tenant_id
        WHERE t.slug = $1
        ORDER BY COALESCE(pc.activity_date, pc.updated_at) DESC NULLS LAST, pc.updated_at DESC
        LIMIT 10
      `,
      [TENANT_SLUG]
    );

    const syncJobs = await client.query(
      `
        SELECT
          sj.id,
          sj.type,
          sj.status,
          sj.retry_count,
          sj.started_at,
          sj.finished_at,
          sj.rows_processed,
          sj.pages_processed,
          sj.error_message,
          sj.updated_at
        FROM sync_job sj
        JOIN tenant t ON t.id = sj.tenant_id
        WHERE t.slug = $1
        ORDER BY sj.created_at DESC
        LIMIT 5
      `,
      [TENANT_SLUG]
    );

    console.log(JSON.stringify({
      tenant: TENANT_SLUG,
      counts: counts.rows[0],
      latest_projects: latest.rows,
      latest_jobs: syncJobs.rows,
      active_logic: {
        backend_status_field: "project_core.status + project_core.is_closed",
        frontend_active_filter: "status !== 'closed' && status !== 'lukket'",
      },
    }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
