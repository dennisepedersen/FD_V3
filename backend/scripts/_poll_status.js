require("dotenv").config({ path: ".env.production" });
const { Client } = require("pg");

const JOB_ID = "72ee28ee-f6fc-4d8a-bbe7-99fac7881764";

async function snapshot() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const job = await c.query(
    "SELECT id,status,retry_count,rows_processed,pages_processed,error_message,finished_at FROM sync_job WHERE id=$1",
    [JOB_ID]
  );
  const endpoints = await c.query(
    "SELECT endpoint_key,status,last_successful_page,rows_persisted,last_error FROM sync_endpoint_state WHERE endpoint_key IN ('projects_v4','projects_v3') ORDER BY endpoint_key"
  );
  const v4count = await c.query("SELECT COUNT(*) FROM project_masterdata_v4");
  const wipcount = await c.query("SELECT COUNT(*) FROM project_wip");

  await c.end();

  return {
    job: job.rows[0] || null,
    endpoints: endpoints.rows,
    project_masterdata_v4_count: v4count.rows[0].count,
    project_wip_count: wipcount.rows[0].count
  };
}

async function poll() {
  let attempts = 0;
  const maxAttempts = 80; // ~80 min

  while (attempts < maxAttempts) {
    let result;
    try {
      result = await snapshot();
    } catch (e) {
      console.error(`[poll] DB error (attempt ${attempts + 1}): ${e.message}`);
      attempts++;
      await new Promise(r => setTimeout(r, 30000));
      continue;
    }

    const status = result.job?.status;
    console.error(`[${new Date().toISOString()}] attempt=${attempts + 1} status=${status}`);

    if (status !== "running") {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    attempts++;
    await new Promise(r => setTimeout(r, 60000));
  }

  console.error("Timeout: job still running after max attempts");
}

poll().catch(e => { console.error(e.message); process.exit(1); });
