require('dotenv').config({ path: '../.env.production' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `
        WITH tenant_ctx AS (
          SELECT id AS tenant_id
          FROM tenant
          WHERE slug = 'hoyrup-clemmensen'
          LIMIT 1
        )
        SELECT
          COUNT(*) FILTER (WHERE lower(btrim(coalesce(pc.responsible_code, ''))) = 'dep') AS mine_total,
          COUNT(*) FILTER (WHERE lower(btrim(coalesce(pc.responsible_code, ''))) = 'dep' AND pc.status = 'open' AND COALESCE(pc.is_closed, false) = false) AS mine_open,
          COUNT(*) FILTER (WHERE lower(btrim(coalesce(pc.responsible_code, ''))) = 'dep' AND (pc.status = 'closed' OR pc.is_closed = true)) AS mine_closed,
          COUNT(*) FILTER (WHERE lower(btrim(coalesce(pc.team_leader_code, ''))) = 'dep') AS teamleader_total,
          COUNT(*) FILTER (WHERE lower(btrim(coalesce(pc.team_leader_code, ''))) = 'dep' AND pc.status = 'open' AND COALESCE(pc.is_closed, false) = false) AS teamleader_open
        FROM project_core pc
        JOIN tenant_ctx tc ON tc.tenant_id = pc.tenant_id
      `
    );
    console.log(JSON.stringify(result.rows[0], null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
