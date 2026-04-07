const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env.production") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /127\.0\.0\.1|localhost/i.test(String(process.env.DATABASE_URL || ""))
    ? false
    : { rejectUnauthorized: false },
});

async function main() {
  const countRes = await pool.query(`
    SELECT COUNT(*)::int AS orphan_count
    FROM project_masterdata_v4 child
    WHERE child.parent_project_ek_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM project_masterdata_v4 parent
        WHERE parent.ek_project_id = child.parent_project_ek_id
      )
  `);

  const examplesRes = await pool.query(`
    SELECT
      pc.external_project_ref,
      child.project_id,
      child.ek_project_id,
      child.parent_project_ek_id,
      child.is_subproject,
      child.responsible_name,
      child.source_updated_at
    FROM project_masterdata_v4 child
    LEFT JOIN project_core pc ON pc.project_id = child.project_id
    WHERE child.parent_project_ek_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM project_masterdata_v4 parent
        WHERE parent.ek_project_id = child.parent_project_ek_id
      )
    ORDER BY child.parent_project_ek_id ASC, pc.external_project_ref ASC NULLS LAST
    LIMIT 10
  `);

  console.log(`ORPHAN_PARENT_LINKS=${countRes.rows[0].orphan_count}`);
  console.log("");
  console.log("EXAMPLES");
  if (examplesRes.rows.length === 0) {
    console.log("(none)");
  } else {
    examplesRes.rows.forEach((row, index) => {
      console.log(
        `${index + 1}. ref=${row.external_project_ref ?? "NULL"} | project_id=${row.project_id} | ek_project_id=${row.ek_project_id ?? "NULL"} | parent_project_ek_id=${row.parent_project_ek_id} | is_subproject=${row.is_subproject} | responsible_name=${row.responsible_name ?? "NULL"} | source_updated_at=${row.source_updated_at ?? "NULL"}`
      );
    });
  }

  await pool.end();
}

main().catch(async (error) => {
  console.error(error.message);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
