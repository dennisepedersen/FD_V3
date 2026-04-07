const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env.production") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /127\.0\.0\.1|localhost/i.test(String(process.env.DATABASE_URL || "")) ? false : { rejectUnauthorized: false },
});

pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='sync_job' ORDER BY ordinal_position`).then(r => {
  console.log("sync_job columns:");
  r.rows.forEach(x => console.log(`  ${x.column_name}: ${x.data_type}`));
  pool.end();
}).catch(e => {
  console.error(e.message);
  pool.end();
});
