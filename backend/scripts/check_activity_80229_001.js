require("dotenv").config({ path: require("path").resolve(__dirname, "../.env.production") });
const { Pool } = require("pg");

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const sql = `
      SELECT external_project_ref, activity_date
      FROM project_core pc
      JOIN tenant t ON t.id = pc.tenant_id
      WHERE t.slug = 'hoyrup-clemmensen'
        AND external_project_ref = '80229-001'
      LIMIT 1
    `;
    const { rows } = await pool.query(sql);
    console.log(JSON.stringify(rows[0] || null, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
