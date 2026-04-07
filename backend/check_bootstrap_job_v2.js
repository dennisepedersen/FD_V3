require('dotenv').config({ path: '.env.production' });
const { Client } = require('pg');

const client = new Client({ 
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    await client.connect();
    
    console.log('\n=== A. JOB STATUS (Most Recent) ===');
    const jobRes = await client.query(`
      SELECT id, type, status, rows_processed, pages_processed, created_at, updated_at 
      FROM sync_job 
      ORDER BY created_at DESC LIMIT 1
    `);
    console.log(JSON.stringify(jobRes.rows[0], null, 2));
    
    console.log('\n=== B. ENDPOINT STATE (V4 + V3) ===');
    const stateRes = await client.query(`
      SELECT endpoint_key, status, last_successful_page, rows_persisted, last_error, updated_at 
      FROM sync_endpoint_state 
      WHERE endpoint_key IN ('projects_v4', 'projects_v3')
      ORDER BY endpoint_key
    `);
    console.log(JSON.stringify(stateRes.rows, null, 2));
    
    console.log('\n=== C. DATA: COUNT FROM project_masterdata_v4 ===');
    const v4Res = await client.query(`SELECT COUNT(*) as v4_rows FROM project_masterdata_v4`);
    console.log(JSON.stringify(v4Res.rows[0], null, 2));
    
    console.log('\n=== D. PROJECT_WIP COUNT ===');
    const wipRes = await client.query(`SELECT COUNT(*) as wip_rows FROM project_wip`);
    console.log(JSON.stringify(wipRes.rows[0], null, 2));
    
    await client.end();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
