/**
 * wait_and_evidence.js
 * Polls sync_job until status != 'running', then prints full evidence.
 */
const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env.production") });

const BOOTSTRAP_JOB_ID = "991350c4-0c13-4d67-817d-39d5783a3536";
// Cutoff: when this job started (used to split old vs new backlog errors)
const BOOTSTRAP_START  = new Date("2026-04-04T21:15:43.000Z"); // UTC

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function pollUntilDone(maxWaitSec = 600) {
  const start = Date.now();
  while (Date.now() - start < maxWaitSec * 1000) {
    const res = await pool.query(
      "SELECT status, rows_processed, pages_processed FROM sync_job WHERE id = $1",
      [BOOTSTRAP_JOB_ID]
    );
    const row = res.rows[0];
    if (!row) { console.log("Job not found"); break; }
    process.stdout.write(`\r[poll] status=${row.status} pages=${row.pages_processed} rows=${row.rows_processed}     `);
    if (row.status !== "running") { process.stdout.write("\n"); return row; }
    await new Promise((r) => setTimeout(r, 15000));
  }
  process.stdout.write("\n");
  return null;
}

async function main() {
  console.log("Polling for job completion (max 10 min)...");
  const finalJob = await pollUntilDone(600);

  // ── evidence ─────────────────────────────────────────────────────────────
  const r1 = await pool.query(
    "SELECT COUNT(*) total, COUNT(ek_project_id) with_ek FROM project_masterdata_v4"
  );

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

  const rOld = await pool.query(`
    SELECT error_message, COUNT(*) cnt
    FROM sync_failure_backlog
    WHERE created_at < $1
    GROUP BY error_message
    ORDER BY cnt DESC
  `, [BOOTSTRAP_START]);

  const rNew = await pool.query(`
    SELECT error_message, COUNT(*) cnt
    FROM sync_failure_backlog
    WHERE created_at >= $1
    GROUP BY error_message
    ORDER BY cnt DESC
  `, [BOOTSTRAP_START]);

  // ── output ────────────────────────────────────────────────────────────────
  console.log("\n=================== FINAL EVIDENCE ===================");

  if (finalJob) {
    console.log(`\n[1] JOB STATUS`);
    console.log(`  id:       ${BOOTSTRAP_JOB_ID}`);
    console.log(`  status:   ${finalJob.status}`);
    console.log(`  pages:    ${finalJob.pages_processed}`);
    console.log(`  rows:     ${finalJob.rows_processed}`);
  } else {
    console.log(`\n[1] JOB: still running after poll timeout`);
  }

  console.log(`\n[2] project_masterdata_v4`);
  console.log(`  Total rows:    ${r1.rows[0].total}`);
  console.log(`  with_ek_id:    ${r1.rows[0].with_ek}`);

  console.log(`\n[3] Parent/child case`);
  rRef.rows.forEach((r) => {
    console.log(`  ref=${r.external_project_ref}`);
    console.log(`    ek_project_id:         ${r.ek_project_id ?? "NULL"}`);
    console.log(`    parent_project_ek_id:  ${r.parent_project_ek_id ?? "NULL"}`);
    console.log(`    is_subproject:         ${r.is_subproject ?? "NULL"}`);
    console.log(`    responsible_name:      ${r.responsible_name ?? "NULL"}`);
    console.log(`    source_updated_at:     ${r.source_updated_at ?? "NULL"}`);
  });

  const parent = rRef.rows.find((r) => r.external_project_ref === "80229");
  const child  = rRef.rows.find((r) => r.external_project_ref === "80229-001");
  if (parent?.ek_project_id && child?.parent_project_ek_id) {
    const ok = String(child.parent_project_ek_id) === String(parent.ek_project_id);
    console.log(`\n  RELATION: child.parent_project_ek_id (${child.parent_project_ek_id}) === parent.ek_project_id (${parent.ek_project_id})`);
    console.log(`  → ${ok ? "✓ KORREKT" : "✗ MISMATCH"}`);
  } else {
    console.log(`\n  RELATION: kan ikke verificeres (mangler ek_project_id på en eller begge)`);
    if (!parent?.ek_project_id) console.log("  → ref 80229 mangler ek_project_id");
    if (!child?.parent_project_ek_id) console.log("  → ref 80229-001 mangler parent_project_ek_id");
  }

  console.log(`\n[4] Backlog-fejl FØR UNNEST-bootstrap (gamle)`);
  if (rOld.rows.length === 0) console.log("  (ingen)");
  rOld.rows.forEach((r) => console.log(`  [${r.cnt}x] ${String(r.error_message).slice(0, 90)}`));

  console.log(`\n[5] Backlog-fejl EFTER UNNEST-bootstrap (NYE)`);
  if (rNew.rows.length === 0) {
    console.log("  (ingen) ✓ Ingen nye fejl overhovedet");
  } else {
    const typeErrs = rNew.rows.filter((r) => r.error_message && !r.error_message.includes("429"));
    const only429  = typeErrs.length === 0;
    rNew.rows.forEach((r) => console.log(`  [${r.cnt}x] ${String(r.error_message).slice(0, 90)}`));
    if (only429) console.log("  → Kun 429-rate-limit fejl, INGEN type- eller persist-fejl ✓");
    else         console.log("  ✗ NYE TYPE-FEJL FUNDET");
  }

  console.log("\n=======================================================");
  await pool.end();
}

main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
