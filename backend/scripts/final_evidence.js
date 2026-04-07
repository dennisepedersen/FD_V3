const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env.production") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const r1 = await pool.query(
    "SELECT COUNT(*) total, COUNT(ek_project_id) with_ek FROM project_masterdata_v4"
  );

  // Job info
  const rJob = await pool.query(`
    SELECT id, status, rows_processed, pages_fetched, started_at, finished_at
    FROM sync_job
    ORDER BY started_at DESC
    LIMIT 1
  `);

  // Masterdata for ref 80229 & 80229-001 via JOIN
  const rRef = await pool.query(`
    SELECT
      pc.external_project_ref,
      md.project_id,
      md.ek_project_id,
      md.parent_project_ek_id,
      md.is_subproject,
      md.responsible_name,
      md.source_updated_at
    FROM project_core pc
    LEFT JOIN project_masterdata_v4 md ON md.project_id = pc.project_id
    WHERE pc.external_project_ref IN ('80229','80229-001')
    ORDER BY pc.external_project_ref
  `);

  // UNNEST bootstrap started at: use latest job started_at as cutoff
  const bootstrapStart = rJob.rows[0]?.started_at ?? new Date(0);

  const rOld = await pool.query(`
    SELECT error_message, COUNT(*) cnt
    FROM sync_failure_backlog
    WHERE created_at < $1
    GROUP BY error_message
    ORDER BY cnt DESC
  `, [bootstrapStart]);

  const rNew = await pool.query(`
    SELECT error_message, COUNT(*) cnt
    FROM sync_failure_backlog
    WHERE created_at >= $1
    GROUP BY error_message
    ORDER BY cnt DESC
  `, [bootstrapStart]);

  console.log("===== FINAL EVIDENCE =====");

  const job = rJob.rows[0];
  if (job) {
    console.log(`\nJob ${job.id}`);
    console.log(`  status:   ${job.status}`);
    console.log(`  pages:    ${job.pages_fetched ?? 'n/a'}`);
    console.log(`  rows:     ${job.rows_processed ?? 'n/a'}`);
    console.log(`  started:  ${job.started_at}`);
    console.log(`  finished: ${job.finished_at ?? '(still running)'}`);
  }

  console.log(`\n--- project_masterdata_v4 ---`);
  console.log(`  Total rows:    ${r1.rows[0].total}`);
  console.log(`  with_ek_id:    ${r1.rows[0].with_ek}`);

  console.log(`\n--- Parent/child case (80229 / 80229-001) ---`);
  if (rRef.rows.length === 0) {
    console.log("  project_core has no rows for these refs");
  } else {
    rRef.rows.forEach((r) => {
      const hasMd = r.ek_project_id !== null || r.project_id !== null;
      console.log(`  ref=${r.external_project_ref}`);
      console.log(`    project_id:          ${r.project_id ?? '(no masterdata row)'}`);
      console.log(`    ek_project_id:       ${r.ek_project_id ?? 'NULL'}`);
      console.log(`    parent_project_ek_id:${r.parent_project_ek_id ?? 'NULL'}`);
      console.log(`    is_subproject:       ${r.is_subproject ?? 'NULL'}`);
      console.log(`    responsible_name:    ${r.responsible_name ?? 'NULL'}`);
      if (!hasMd) console.log(`    *** INGEN MASTERDATA - JOIN miss eller ikke nået endnu ***`);
    });
    // Relation check
    const parent = rRef.rows.find(r => r.external_project_ref === '80229');
    const child  = rRef.rows.find(r => r.external_project_ref === '80229-001');
    if (parent?.ek_project_id && child?.parent_project_ek_id) {
      const ok = String(child.parent_project_ek_id) === String(parent.ek_project_id);
      console.log(`\n  Relation: child.parent_project_ek_id (${child.parent_project_ek_id}) === parent.ek_project_id (${parent.ek_project_id}) → ${ok ? '✓ KORREKT' : '✗ MISMATCH'}`);
    } else {
      console.log(`\n  Relation: kan ikke verificeres endnu (mangler ek_project_id)`);
    }
  }

  console.log(`\n--- Backlog-fejl (FØR UNNEST-bootstrap ${bootstrapStart.toISOString().slice(0,19)}) ---`);
  if (rOld.rows.length === 0) console.log("  (ingen)");
  rOld.rows.forEach(r => console.log(`  [${r.cnt}x] ${String(r.error_message).slice(0,90)}`));

  console.log(`\n--- Backlog-fejl (EFTER UNNEST-bootstrap / NYE) ---`);
  if (rNew.rows.length === 0) {
    console.log("  (ingen) ✓ Ingen nye persist/type-fejl");
  } else {
    rNew.rows.forEach(r => console.log(`  [${r.cnt}x] ${String(r.error_message).slice(0,90)}`));
    const hasTypeErr = rNew.rows.some(r =>
      r.error_message && !r.error_message.includes('429')
    );
    if (hasTypeErr) console.log("  ✗ NYE TYPE-FEJL FUNDET");
    else console.log("  (kun 429 — ingen type-fejl) ✓");
  }

  await pool.end();
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
