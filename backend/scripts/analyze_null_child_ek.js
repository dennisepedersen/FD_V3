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
  const totalRes = await pool.query(`
    SELECT COUNT(*)::int AS matching_rows
    FROM project_masterdata_v4
    WHERE ek_project_id IS NULL
      AND parent_project_ek_id IS NOT NULL
  `);

  const groupedRes = await pool.query(`
    SELECT parent_project_ek_id, COUNT(*)::int AS row_count
    FROM project_masterdata_v4
    WHERE ek_project_id IS NULL
      AND parent_project_ek_id IS NOT NULL
    GROUP BY parent_project_ek_id
    ORDER BY row_count DESC, parent_project_ek_id ASC
  `);

  const examplesRes = await pool.query(`
    SELECT
      pc.external_project_ref,
      md.project_id,
      md.ek_project_id,
      md.parent_project_ek_id,
      md.is_subproject,
      md.responsible_name,
      md.source_updated_at
    FROM project_masterdata_v4 md
    LEFT JOIN project_core pc ON pc.project_id = md.project_id
    WHERE md.ek_project_id IS NULL
      AND md.parent_project_ek_id IS NOT NULL
    ORDER BY md.parent_project_ek_id ASC, pc.external_project_ref ASC NULLS LAST
    LIMIT 10
  `);

  console.log(`MATCHING_ROWS=${totalRes.rows[0].matching_rows}`);
  console.log("");
  console.log("GROUPED_BY_PARENT_EK_ID");
  if (groupedRes.rows.length === 0) {
    console.log("(none)");
  } else {
    groupedRes.rows.forEach((row) => {
      console.log(`${row.parent_project_ek_id} => ${row.row_count}`);
    });
  }

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
