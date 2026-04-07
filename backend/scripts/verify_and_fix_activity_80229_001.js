require("dotenv").config({ path: require("path").resolve(__dirname, "../.env.production") });
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

async function main() {
  const rawPath = path.resolve(__dirname, "output_80229_001_v3_raw.json");
  const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
  const derived = raw.LastRegistration || raw.LastFitterHourDate || null;

  if (!derived) {
    throw new Error("No LastRegistration/LastFitterHourDate in V3 raw payload");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const updateSql = `
      UPDATE project_core pc
      SET activity_date = $1::timestamptz,
          updated_at = now()
      FROM tenant t
      WHERE t.id = pc.tenant_id
        AND t.slug = 'hoyrup-clemmensen'
        AND pc.external_project_ref = '80229-001'
    `;
    await pool.query(updateSql, [derived]);

    const checkSql = `
      SELECT external_project_ref, activity_date
      FROM project_core pc
      JOIN tenant t ON t.id = pc.tenant_id
      WHERE t.slug = 'hoyrup-clemmensen'
        AND external_project_ref = '80229-001'
      LIMIT 1
    `;
    const { rows } = await pool.query(checkSql);
    console.log(JSON.stringify({ derivedActivityDate: derived, dbRow: rows[0] || null }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
