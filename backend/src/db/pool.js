const { Pool } = require("pg");
const env = require("../config/env");

const usesLocalDb = /127\.0\.0\.1|localhost/i.test(String(env.DATABASE_URL || ""));

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: usesLocalDb ? false : { rejectUnauthorized: false },
});

module.exports = pool;
