const { Pool } = require("pg");
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    const tenant_id = "f1f51c07-2d88-4ee4-a766-78eac833a9d0";

    // 1. Check project_masterdata_v4 schema
    const cols = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'project_masterdata_v4'
      ORDER BY ordinal_position
    `);
    console.log("=== project_masterdata_v4 columns ===");
    cols.rows.forEach((r) => console.log(` ${r.column_name}: ${r.data_type}`));

    // 2. Check constraints
    const constraints = await client.query(`
      SELECT conname, contype
      FROM pg_constraint
      WHERE conrelid = 'project_masterdata_v4'::regclass
    `);
    console.log("\n=== constraints ===");
    constraints.rows.forEach((r) => console.log(` ${r.conname}: ${r.contype}`));

    // 3. Count project_core
    const coreCount = await client.query(
      `SELECT COUNT(*) as total, COUNT(external_project_ref) as with_ref
       FROM project_core WHERE tenant_id = $1`,
      [tenant_id]
    );
    console.log("\n=== project_core ===", coreCount.rows[0]);

    // 4. Sample refs from project_core with has_v4=true
    const sample = await client.query(
      `SELECT external_project_ref, has_v4, has_v3
       FROM project_core
       WHERE tenant_id = $1
         AND external_project_ref IS NOT NULL
         AND has_v4 = true
       LIMIT 5`,
      [tenant_id]
    );
    console.log("\n=== project_core sample (has_v4=true) ===");
    sample.rows.forEach((r) => console.log(" ", JSON.stringify(r)));

    // 5. Test the JOIN directly with a text comparison
    if (sample.rows.length > 0) {
      const testRef = sample.rows[0].external_project_ref;
      const joinTest = await client.query(
        `WITH incoming(tenant_id, external_project_ref) AS (
           VALUES ($1::text, $2::text)
         )
         SELECT pc.project_id, pc.external_project_ref
         FROM incoming i
         JOIN project_core pc
           ON pc.tenant_id = i.tenant_id
          AND pc.external_project_ref = i.external_project_ref`,
        [tenant_id, testRef]
      );
      console.log(
        `\n=== JOIN test for ref='${testRef}' ===`,
        joinTest.rows.length > 0 ? joinTest.rows[0] : "NO MATCH"
      );
    }

    // 6. Check if project_masterdata_v4.project_id exists in project_core
    const masterdataRow = await client.query(
      `SELECT pm.project_id, pm.ek_project_id, pm.source_updated_at, pc.external_project_ref
       FROM project_masterdata_v4 pm
       LEFT JOIN project_core pc ON pc.project_id = pm.project_id
       WHERE pm.tenant_id = $1
       LIMIT 3`,
      [tenant_id]
    );
    console.log("\n=== existing masterdata rows ===");
    masterdataRow.rows.forEach((r) => console.log(" ", JSON.stringify(r)));

    // 7. Check if project_core has valid project_id (uuid)
    const pcSchema = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'project_core'
        AND column_name IN ('project_id', 'tenant_id', 'external_project_ref')
      ORDER BY ordinal_position
    `);
    console.log("\n=== project_core key columns ===");
    pcSchema.rows.forEach((r) => console.log(` ${r.column_name}: ${r.data_type} default=${r.column_default}`));

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
