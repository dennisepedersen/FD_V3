/**
 * test_1row_persist.js
 *
 * Proves that upsertProjectMasterdataBatch can persist exactly 1 row.
 * Uses a real project_core row as the join target.
 * Does NOT start backend, does NOT queue bootstrap.
 * Rolls back at the end so test is non-destructive.
 */
const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env.production") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /127\.0\.0\.1|localhost/i.test(String(process.env.DATABASE_URL || ""))
    ? false
    : { rejectUnauthorized: false },
});

const TENANT_ID = "f1f51c07-2d88-4ee4-a766-78eac833a9d0";

// ── Inline the fixed upsert function (copy from syncWorker.js) ─────────────
function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function upsertProjectMasterdataBatch(client, { tenantId, mappedRows }) {
  if (!mappedRows.length) return 0;
  let totalUpserted = 0;

  const rowChunks = chunkArray(mappedRows, 100);
  for (const chunk of rowChunks) {
    const tenantIds          = chunk.map(() => tenantId);
    const externalRefs       = chunk.map((r) => r.externalProjectRef ?? null);
    const ekProjectIds       = chunk.map((r) => r.projectEkId != null ? Number(r.projectEkId) : null);
    const parentEkIds        = chunk.map((r) => r.parentProjectEkId != null ? Number(r.parentProjectEkId) : null);
    const isSubprojects      = chunk.map((r) => r.isSubproject != null ? Boolean(r.isSubproject) : null);
    const isCloseds          = chunk.map((r) => r.isClosed != null ? Boolean(r.isClosed) : null);
    const responsibleNames   = chunk.map((r) => r.responsibleName ?? null);
    const expectedValues     = chunk.map((r) => r.projectExpectedValues != null ? JSON.stringify(r.projectExpectedValues) : null);
    const budgets            = chunk.map((r) => r.projectBudget != null ? JSON.stringify(r.projectBudget) : null);
    const addresses          = chunk.map((r) => r.associatedAddress != null ? JSON.stringify(r.associatedAddress) : null);
    const persons            = chunk.map((r) => r.associatedPerson != null ? JSON.stringify(r.associatedPerson) : null);
    const worksheetIDsArr    = chunk.map((r) => r.worksheetIDs != null ? JSON.stringify(r.worksheetIDs) : null);
    const sourceUpdatedDates = chunk.map((r) => {
      if (r.sourceUpdatedDate == null) return null;
      if (r.sourceUpdatedDate instanceof Date) return r.sourceUpdatedDate.toISOString();
      return String(r.sourceUpdatedDate);
    });

    const sql = `
      WITH incoming AS (
        SELECT
          UNNEST($1::uuid[])          AS tenant_id,
          UNNEST($2::text[])          AS external_project_ref,
          UNNEST($3::bigint[])        AS ek_project_id,
          UNNEST($4::bigint[])        AS parent_project_ek_id,
          UNNEST($5::boolean[])       AS is_subproject,
          UNNEST($6::boolean[])       AS is_closed,
          UNNEST($7::text[])          AS responsible_name,
          UNNEST($8::jsonb[])         AS project_expected_values,
          UNNEST($9::jsonb[])         AS project_budget,
          UNNEST($10::jsonb[])        AS associated_address,
          UNNEST($11::jsonb[])        AS associated_person,
          UNNEST($12::jsonb[])        AS worksheet_ids,
          UNNEST($13::timestamptz[])  AS source_updated_at
      )
      INSERT INTO project_masterdata_v4 (
        project_id,
        tenant_id,
        ek_project_id,
        parent_project_ek_id,
        is_subproject,
        is_closed,
        responsible_name,
        project_expected_values,
        project_budget,
        associated_address,
        associated_person,
        worksheet_ids,
        source_updated_at,
        total_turn_over_exp
      )
      SELECT
        pc.project_id,
        pc.tenant_id,
        i.ek_project_id,
        i.parent_project_ek_id,
        i.is_subproject,
        i.is_closed,
        i.responsible_name,
        i.project_expected_values,
        i.project_budget,
        i.associated_address,
        i.associated_person,
        i.worksheet_ids,
        i.source_updated_at,
        CASE
          WHEN i.project_expected_values IS NULL THEN NULL
          ELSE NULLIF((i.project_expected_values ->> 'totalTurnOverExp'), '')::numeric
        END
      FROM incoming i
      JOIN project_core pc
        ON pc.tenant_id = i.tenant_id
       AND pc.external_project_ref = i.external_project_ref
      ON CONFLICT (project_id)
      DO UPDATE SET
        ek_project_id           = COALESCE(EXCLUDED.ek_project_id,          project_masterdata_v4.ek_project_id),
        parent_project_ek_id    = COALESCE(EXCLUDED.parent_project_ek_id,   project_masterdata_v4.parent_project_ek_id),
        is_subproject           = COALESCE(EXCLUDED.is_subproject,          project_masterdata_v4.is_subproject),
        is_closed               = COALESCE(EXCLUDED.is_closed,              project_masterdata_v4.is_closed),
        responsible_name        = COALESCE(EXCLUDED.responsible_name,       project_masterdata_v4.responsible_name),
        project_expected_values = COALESCE(EXCLUDED.project_expected_values, project_masterdata_v4.project_expected_values),
        project_budget          = COALESCE(EXCLUDED.project_budget,         project_masterdata_v4.project_budget),
        associated_address      = COALESCE(EXCLUDED.associated_address,     project_masterdata_v4.associated_address),
        associated_person       = COALESCE(EXCLUDED.associated_person,      project_masterdata_v4.associated_person),
        worksheet_ids           = COALESCE(EXCLUDED.worksheet_ids,          project_masterdata_v4.worksheet_ids),
        source_updated_at       = COALESCE(EXCLUDED.source_updated_at,      project_masterdata_v4.source_updated_at),
        total_turn_over_exp     = COALESCE(EXCLUDED.total_turn_over_exp,    project_masterdata_v4.total_turn_over_exp),
        updated_at              = now()
      RETURNING project_id
    `;

    const res = await client.query(sql, [
      tenantIds, externalRefs, ekProjectIds, parentEkIds,
      isSubprojects, isCloseds, responsibleNames, expectedValues,
      budgets, addresses, persons, worksheetIDsArr, sourceUpdatedDates,
    ]);
    totalUpserted += res.rowCount;
  }
  return totalUpserted;
}
// ────────────────────────────────────────────────────────────────────────────

async function run() {
  const client = await pool.connect();
  try {
    // 1. Grab a known project_core row (prefer parent 80229 / ek_id 18008 area)
    const coreRes = await client.query(
      `SELECT project_id, external_project_ref, tenant_id
       FROM project_core
       WHERE tenant_id = $1
         AND external_project_ref IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [TENANT_ID]
    );

    if (coreRes.rows.length === 0) {
      console.error("✗ No project_core rows found for tenant. Cannot test.");
      return;
    }

    const coreRow = coreRes.rows[0];
    console.log(`\nUsing project_core row:`);
    console.log(`  project_id:           ${coreRow.project_id}`);
    console.log(`  external_project_ref: ${coreRow.external_project_ref}`);

    // 2. Build a synthetic mappedRow with all types covered
    const testRow = {
      externalProjectRef:   coreRow.external_project_ref,
      projectEkId:          99999,          // bigint
      parentProjectEkId:    null,            // bigint nullable
      isSubproject:         false,           // boolean
      isClosed:             false,           // boolean
      responsibleName:      "Test Person",   // text
      projectExpectedValues: { totalTurnOverExp: "12345.67" }, // jsonb
      projectBudget:        { amount: 50000 },                  // jsonb
      associatedAddress:    null,
      associatedPerson:     null,
      worksheetIDs:         null,
      sourceUpdatedDate:    new Date().toISOString(),           // timestamptz
    };

    console.log(`\nTest mappedRow:`);
    console.log(`  externalProjectRef: ${testRow.externalProjectRef}`);
    console.log(`  projectEkId:        ${testRow.projectEkId} (bigint)`);
    console.log(`  isSubproject:       ${testRow.isSubproject} (boolean)`);
    console.log(`  isClosed:           ${testRow.isClosed} (boolean)`);
    console.log(`  sourceUpdatedDate:  ${testRow.sourceUpdatedDate} (timestamptz)`);

    // 3. Run within a SAVEPOINT so we can roll back non-destructively
    await client.query("BEGIN");
    await client.query("SAVEPOINT test_1row");

    let upserted = 0;
    let error = null;
    try {
      upserted = await upsertProjectMasterdataBatch(client, {
        tenantId: TENANT_ID,
        mappedRows: [testRow],
      });
    } catch (err) {
      error = err;
    }

    if (error) {
      await client.query("ROLLBACK TO SAVEPOINT test_1row");
      await client.query("ROLLBACK");
      console.log(`\n✗ UPSERT THREW ERROR:`);
      console.log(`  ${error.message}`);
      return;
    }

    // 4. Check the write
    const verify = await client.query(
      `SELECT project_id, ek_project_id, is_subproject, is_closed, source_updated_at, total_turn_over_exp
       FROM project_masterdata_v4
       WHERE project_id = $1`,
      [coreRow.project_id]
    );

    // Roll back so we don't pollute real data with ek_id=99999
    await client.query("ROLLBACK TO SAVEPOINT test_1row");
    await client.query("ROLLBACK");

    console.log(`\n===== 1-ROW PERSIST TEST =====`);
    if (upserted > 0 && verify.rows.length > 0) {
      const v = verify.rows[0];
      console.log(`✓ UPSERT SUCCEEDED`);
      console.log(`  upserted rows:      ${upserted}`);
      console.log(`  project_id:         ${v.project_id}`);
      console.log(`  ek_project_id:      ${v.ek_project_id}  (bigint ✓)`);
      console.log(`  is_subproject:      ${v.is_subproject}   (boolean ✓)`);
      console.log(`  is_closed:          ${v.is_closed}       (boolean ✓)`);
      console.log(`  source_updated_at:  ${v.source_updated_at} (timestamptz ✓)`);
      console.log(`  total_turn_over_exp: ${v.total_turn_over_exp} (numeric ✓)`);
      console.log(`\n→ PATCH VIRKER: persist-laget er typed korrekt`);
    } else if (upserted === 0 && verify.rows.length === 0) {
      console.log(`✗ UPSERT RAN BUT 0 ROWS WRITTEN`);
      console.log(`  JOIN may have missed: project_core ref=${coreRow.external_project_ref} not matched`);
    } else {
      console.log(`? Inconclusive: upserted=${upserted} verify.rows=${verify.rows.length}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
