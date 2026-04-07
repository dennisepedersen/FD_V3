const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env.production") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /127\.0\.0\.1|localhost/i.test(String(process.env.DATABASE_URL || "")) ? false : { rejectUnauthorized: false },
});

const TENANT_ID = "f1f51c07-2d88-4ee4-a766-78eac833a9d0";

async function check() {
  const count = await pool.query(
    `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE ek_project_id IS NOT NULL) as with_ek_id FROM project_masterdata_v4 WHERE tenant_id = $1`,
    [TENANT_ID]
  );
  
  console.log(`\n===== MASTERDATA COUNTS =====`);
  console.log(`Total rows in project_masterdata_v4:     ${count.rows[0].total}`);
  console.log(`With ek_project_id populated:            ${count.rows[0].with_ek_id}`);
  
  if (count.rows[0].total <= 10) {
    console.log(`\nAll rows:`);
    const all = await pool.query(
      `SELECT project_id, ek_project_id, parent_project_ek_id, is_subproject, is_closed FROM project_masterdata_v4 WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [TENANT_ID]
    );
    all.rows.forEach((r, i) => {
      console.log(`  ${i + 1}. ek_id=${r.ek_project_id} parent_ek=${r.parent_project_ek_id} sub=${r.is_subproject} closed=${r.is_closed}`);
    });
  }
  
  // Check for EK ID 18008
  const parent = await pool.query(
    `SELECT COUNT(*) as cnt FROM project_masterdata_v4 WHERE tenant_id = $1 AND ek_project_id = 18008`,
    [TENANT_ID]
  );
  console.log(`\nParent (EK 18008):                       ${parent.rows[0].cnt} row(s)`);
  
  console.log(`\n===== VERDICT =====`);
  if (count.rows[0].total > 1 && count.rows[0].with_ek_id > 0) {
    console.log(`✓ PATCH VIRKER - masterdata vokser`);
    console.log(`  Totalt: ${count.rows[0].total} rows, ${count.rows[0].with_ek_id} med ek_project_id`);
  } else if (count.rows[0].total === 1 && count.rows[0].with_ek_id === 0) {
    console.log(`✗ PATCH VIRKER IKKE - masterdata vokser ikke`);
    console.log(`  Stadig kun 1 row, 0 med ek_project_id`);
  } else {
    console.log(`? UKLART`);
    console.log(`  Total=${count.rows[0].total}, with_ek_id=${count.rows[0].with_ek_id}`);
  }
  
  await pool.end();
}

check().catch(console.error);
