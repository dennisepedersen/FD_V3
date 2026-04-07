require('dotenv').config({ path: '.env.production' });
const { Client } = require('pg');

const client = new Client({ 
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    await client.connect();
    
    const db = await client.query('SELECT current_database()');
    const user = await client.query('SELECT current_user');
    const schema = await client.query('SELECT current_schema()');
    const job = await client.query("SELECT to_regclass('public.sync_job')");
    const state = await client.query("SELECT to_regclass('public.sync_endpoint_state')");
    const v4 = await client.query("SELECT to_regclass('public.project_masterdata_v4')");
    const wip = await client.query("SELECT to_regclass('public.project_wip')");
    
    console.log('DATABASE:', db.rows[0].current_database);
    console.log('USER:', user.rows[0].current_user);
    console.log('SCHEMA:', schema.rows[0].current_schema);
    console.log('sync_job:', job.rows[0].to_regclass);
    console.log('sync_endpoint_state:', state.rows[0].to_regclass);
    console.log('project_masterdata_v4:', v4.rows[0].to_regclass);
    console.log('project_wip:', wip.rows[0].to_regclass);
    
    await client.end();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
