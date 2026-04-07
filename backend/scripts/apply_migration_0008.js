require('dotenv').config({ path: '../.env.production' });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const migrationPath = path.resolve(__dirname, '../../migrations/0008_sync_resilience_state.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('migration 0008 applied');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
