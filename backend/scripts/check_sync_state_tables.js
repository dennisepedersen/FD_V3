require('dotenv').config({ path: '../.env.production' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();
  try {
    const endpointState = await client.query(
      `
        SELECT
          ses.endpoint_key,
          ses.status,
          ses.last_attempt_at,
          ses.last_successful_sync_at,
          ses.last_successful_page,
          ses.updated_after_watermark,
          ses.rows_fetched,
          ses.rows_persisted,
          ses.next_planned_at,
          ses.last_error
        FROM sync_endpoint_state ses
        JOIN tenant t ON t.id = ses.tenant_id
        WHERE t.slug = 'hoyrup-clemmensen'
        ORDER BY ses.endpoint_key ASC
      `
    );

    const backlog = await client.query(
      `
        SELECT
          sfb.status,
          COUNT(*) AS count,
          MIN(sfb.next_retry_at) AS next_retry_at
        FROM sync_failure_backlog sfb
        JOIN tenant t ON t.id = sfb.tenant_id
        WHERE t.slug = 'hoyrup-clemmensen'
        GROUP BY sfb.status
        ORDER BY sfb.status
      `
    );

    console.log(JSON.stringify({
      endpoint_state: endpointState.rows,
      backlog: backlog.rows,
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
