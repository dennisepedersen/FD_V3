const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env.production") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /127\.0\.0\.1|localhost/i.test(String(process.env.DATABASE_URL || "")) ? false : { rejectUnauthorized: false },
});

const JOB_ID = "d22ed240-4d48-4e9d-b24d-e01530feec97";

pool.query(
  `SELECT id, type, status, rows_processed, pages_processed, started_at, finished_at, error, error_message, updated_at FROM sync_job WHERE id = $1`,
  [JOB_ID]
).then(r => {
  if (r.rows.length === 0) {
    console.log("Job not found");
  } else {
    const job = r.rows[0];
    console.log("Job details:");
    console.log(JSON.stringify(job, null, 2));
  }
  pool.end();
}).catch(e => {
  console.error(e.message);
  pool.end();
});
