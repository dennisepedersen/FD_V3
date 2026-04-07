const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env.production") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /127\.0\.0\.1|localhost/i.test(String(process.env.DATABASE_URL || "")) ? false : { rejectUnauthorized: false },
});

const TENANT_ID = "f1f51c07-2d88-4ee4-a766-78eac833a9d0";

async function check() {
  const start = new Date();
  
  const countRes = await pool.query(
    `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE ek_project_id IS NOT NULL) as with_ek_id FROM project_masterdata_v4 WHERE tenant_id = $1`,
    [TENANT_ID]
  );
  
  const parent = await pool.query(
    `SELECT project_id, ek_project_id, parent_project_ek_id, is_subproject FROM project_masterdata_v4 WHERE tenant_id = $1 AND ek_project_id = $2 LIMIT 1`,
    [TENANT_ID, 18008]
  );
  
  const child = await pool.query(
    `SELECT project_id, ek_project_id, parent_project_ek_id, is_subproject FROM project_masterdata_v4 WHERE tenant_id = $1 AND project_id = $2 LIMIT 1`,
    [TENANT_ID, "80229-001"]
  );
  
  const elapsed = ((new Date() - start) / 1000).toFixed(1);
  
  console.log(`\n===== MASTERDATA EVIDENCE =====`);
  console.log(`Total rows:        ${countRes.rows[0].total}`);
  console.log(`With ek_project_id: ${countRes.rows[0].with_ek_id}`);
  
  if (parent.rows.length > 0) {
    console.log(`\nPARENT (EK 18008) - FOUND ✓`);
    console.log(JSON.stringify(parent.rows[0], null, 2));
  } else {
    console.log(`\nPARENT (EK 18008) - NOT FOUND ✗`);
  }
  
  if (child.rows.length > 0) {
    console.log(`\nCHILD (80229-001) - FOUND`);
    console.log(JSON.stringify(child.rows[0], null, 2));
  } else {
    console.log(`\nCHILD (80229-001) - NOT FOUND`);
  }
  
  console.log(`\n===== VERDICT =====`);
  if (countRes.rows[0].total > 1 && countRes.rows[0].with_ek_id > 0) {
    console.log(`✓ PATCH VIRKER - masterdata vokser (total=${countRes.rows[0].total}, ek_id=${countRes.rows[0].with_ek_id})`);
  } else {
    console.log(`✗ PATCH VIRKER IKKE - masterdata vokser ikke (total=${countRes.rows[0].total}, ek_id=${countRes.rows[0].with_ek_id})`);
  }
  
  await pool.end();
}

check().catch(console.error);
