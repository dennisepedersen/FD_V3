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
    const tenant = await client.query('SELECT id FROM tenant WHERE slug = $1 LIMIT 1', [TENANT_SLUG]);
    if (!tenant.rows.length) {
      throw new Error('tenant_not_found');
    }
    const tenantId = tenant.rows[0].id;

    const insert = await client.query(
      `
        INSERT INTO sync_job (tenant_id, type, status, rows_processed, pages_processed)
        SELECT $1, 'delta', 'queued', 0, 0
        WHERE NOT EXISTS (
          SELECT 1 FROM sync_job
          WHERE tenant_id = $1
            AND type = 'delta'
            AND status IN ('queued', 'running')
        )
        RETURNING id, status, created_at
      `,
      [tenantId]
    );

    if (insert.rows.length === 0) {
      const existing = await client.query(
        `
          SELECT id, status, created_at
          FROM sync_job
          WHERE tenant_id = $1
            AND type = 'delta'
            AND status IN ('queued', 'running')
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [tenantId]
      );
      console.log(JSON.stringify({ queued: false, existing: existing.rows[0] || null }, null, 2));
      return;
    }

    console.log(JSON.stringify({ queued: true, job: insert.rows[0] }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
