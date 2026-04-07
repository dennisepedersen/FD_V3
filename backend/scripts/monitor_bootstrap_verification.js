'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.production') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const CHILD_REF = '80229-001';
const PARENT_EK_ID = 18008;
const SLEEP_MS = 30000;
const MAX_POLLS = 16;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function snapshot(client) {
  const job = await client.query(
    `SELECT id, type, status, retry_count, started_at, finished_at, rows_processed, pages_processed, error_message
     FROM sync_job
     WHERE tenant_id = (SELECT id FROM tenant WHERE slug = 'hoyrup-clemmensen')
     ORDER BY created_at DESC
     LIMIT 1`
  );

  const counts = await client.query(
    `SELECT COUNT(*)::int AS total, COUNT(ek_project_id)::int AS with_ek_id
     FROM project_masterdata_v4`
  );

  const child = await client.query(
    `SELECT pc.external_project_ref, pm.ek_project_id, pm.parent_project_ek_id, pm.is_subproject
     FROM project_masterdata_v4 pm
     JOIN project_core pc ON pc.project_id = pm.project_id AND pc.tenant_id = pm.tenant_id
     WHERE pc.external_project_ref = $1
     LIMIT 1`,
    [CHILD_REF]
  );

  const parent = await client.query(
    `SELECT pc.external_project_ref, pm.ek_project_id
     FROM project_masterdata_v4 pm
     JOIN project_core pc ON pc.project_id = pm.project_id AND pc.tenant_id = pm.tenant_id
     WHERE pm.ek_project_id = $1
     LIMIT 1`,
    [PARENT_EK_ID]
  );

  return {
    latestJob: job.rows[0] || null,
    counts: counts.rows[0],
    child: child.rows[0] || null,
    parent: parent.rows[0] || null,
  };
}

async function main() {
  const client = await pool.connect();
  try {
    for (let i = 1; i <= MAX_POLLS; i += 1) {
      const s = await snapshot(client);
      console.log(`poll=${i} ts=${new Date().toISOString()}`);
      console.log(JSON.stringify(s, null, 2));

      const total = Number(s.counts.total || 0);
      const withEk = Number(s.counts.with_ek_id || 0);
      const childOk = Boolean(s.child && Number(s.child.parent_project_ek_id) === PARENT_EK_ID);
      const parentOk = Boolean(s.parent);
      const done = s.latestJob && ['success', 'failed'].includes(String(s.latestJob.status || '').toLowerCase());

      if ((parentOk && childOk && withEk > 0) || done) {
        break;
      }

      await sleep(SLEEP_MS);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('monitor failed:', err.message);
  process.exit(1);
});
