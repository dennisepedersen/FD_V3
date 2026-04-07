require('dotenv').config({ path: '../.env.production' });
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const client = await p.connect();
  try {
    await client.query('BEGIN');

    // 1. Reset the stale running job
    const resetSql = [
      'UPDATE sync_job',
      "SET status = 'failed',",
      "error_message = 'manually_reset: stale running job – no heartbeat for >10h, blocked new sync',",
      'finished_at = NOW()',
      "WHERE id = 'c0a05d8b-944f-42cd-a7f7-22c2cfac34a5'",
      "AND status = 'running'"
    ].join(' ');
    const resetResult = await client.query(resetSql);
    console.log('Rows reset:', resetResult.rowCount);

    // 2. Get tenant_id for hoyrup-clemmensen
    const tenantResult = await client.query(
      "SELECT id FROM tenant WHERE slug = 'hoyrup-clemmensen' LIMIT 1"
    );
    if (!tenantResult.rows.length) throw new Error('tenant not found');
    const tenantId = tenantResult.rows[0].id;
    console.log('tenant_id:', tenantId);

    // 3. Queue new bootstrap job
    const insertSql = [
      'INSERT INTO sync_job (tenant_id, type, status)',
      'VALUES ($1, $2, $3)',
      'RETURNING id, status, created_at'
    ].join(' ');
    const insertResult = await client.query(insertSql, [tenantId, 'bootstrap', 'queued']);
    console.log('New job:', JSON.stringify(insertResult.rows[0]));

    await client.query('COMMIT');
    console.log('DONE');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('ERROR:', err.message);
  } finally {
    client.release();
    p.end();
  }
}

run();
