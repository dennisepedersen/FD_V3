require("dotenv").config({ path: require("path").resolve(__dirname, "../.env.production") });
const { Client } = require("pg");
const fitterBusinessQueries = require("../src/db/queries/fitterBusiness");

const TENANT_ID = "f1f51c07-2d88-4ee4-a766-78eac833a9d0"; // hoyrup-clemmensen

const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  await client.connect();

  // Find top project by fitter_hour count
  const topRes = await client.query(`
    SELECT fh.external_project_ref, COUNT(*) AS cnt
    FROM fitter_hour fh
    WHERE fh.tenant_id = $1 AND fh.external_project_ref IS NOT NULL
    GROUP BY fh.external_project_ref
    ORDER BY cnt DESC LIMIT 1
  `, [TENANT_ID]);

  if (!topRes.rows.length) { console.log("no data"); await client.end(); return; }
  const projectRef = topRes.rows[0].external_project_ref;
  console.log("Using project ref:", projectRef, "(", topRes.rows[0].cnt, "fitter_hour rows)");

  // Find matching project_core record
  const pcRes = await client.query(`
    SELECT project_id, external_project_ref, name FROM project_core
    WHERE tenant_id = $1 AND lower(btrim(coalesce(external_project_ref,''))) = lower(btrim($2))
    LIMIT 1
  `, [TENANT_ID, projectRef]);
  const project = pcRes.rows[0];
  console.log("project_core:", project ? JSON.stringify(project) : "not found (will use ref only)");

  const projectId = project ? project.project_id : null;

  // Run drawer summary
  console.log("\n--- DRAWER SUMMARY ---");
  const summary = await fitterBusinessQueries.getProjectDrawerOutput(client, {
    tenantId: TENANT_ID,
    projectId,
    projectRef: project ? null : projectRef,
  });
  console.log(JSON.stringify(summary, null, 2));

  // Run detail breakdown
  console.log("\n--- DETAIL BREAKDOWN ---");
  const detail = await fitterBusinessQueries.getProjectDetailHoursOutput(client, {
    tenantId: TENANT_ID,
    projectId,
    projectRef: project ? null : projectRef,
  });
  console.log(JSON.stringify(detail, null, 2));

  // Raw total for comparison
  const rawRes = await client.query(`
    SELECT COALESCE(SUM(COALESCE(fh.hours, fh.quantity, 0)),0)::numeric(14,2) AS raw_hours, COUNT(*) AS raw_rows
    FROM fitter_hour fh
    WHERE fh.tenant_id = $1 AND lower(btrim(coalesce(fh.external_project_ref,''))) = lower(btrim($2))
  `, [TENANT_ID, projectRef]);
  console.log("\n--- RAW TOTALS ---");
  console.log(JSON.stringify(rawRes.rows[0], null, 2));

  console.log("\n--- VERIFICATION ---");
  const businessTotal = Number(summary.total_project_relevant_hours);
  const rawTotal = Number(rawRes.rows[0].raw_hours);
  console.log("business_total:", businessTotal, "| raw_total:", rawTotal);
  console.log("filter_active:", businessTotal < rawTotal ? "YES - rows excluded" : "NO - all rows pass or no data");
  console.log("fitter_names_sorted:", JSON.stringify(summary.fitter_names));

  await client.end();
})().catch(e => { console.error(e.message, e.stack); process.exit(1); });
