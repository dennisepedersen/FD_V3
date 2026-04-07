require('dotenv').config({ path: '.env.production' });
const { Client } = require('pg');

const client = new Client({ 
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    await client.connect();
    const res = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'sync_endpoint_state'
      ORDER BY ordinal_position
    `);
    console.log(JSON.stringify(res.rows, null, 2));
    await client.end();
  } catch (err) { 
    console.error(err.message); 
    process.exit(1); 
  }
})();
