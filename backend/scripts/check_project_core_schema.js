const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env.production") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /127\.0\.0\.1|localhost/i.test(String(process.env.DATABASE_URL || "")) ? false : { rejectUnauthorized: false },
});

async function check() {
  const core = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='project_core' ORDER BY ordinal_position`
  );
  
  console.log("project_core:");
  core.rows.slice(0, 15).forEach(x => console.log(`  ${x.column_name}: ${x.data_type}`));
  
  // Get actual values to see what's there
  const sample = await pool.query(
    `SELECT project_id, tenant_id, external_project_ref FROM project_core LIMIT 1`
  );
  
  if (sample.rows.length > 0) {
    console.log("\nSample row:");
    const row = sample.rows[0];
    console.log(`  project_id (type=${typeof row.project_id}): ${row.project_id}`);
    console.log(`  tenant_id (type=${typeof row.tenant_id}): ${row.tenant_id}`);
    console.log(`  external_project_ref (type=${typeof row.external_project_ref}): ${row.external_project_ref}`);
  }
  
  await pool.end();
}

check().catch(console.error);
