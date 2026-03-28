require('dotenv').config();

const app = require("./app");
const env = require("./config/env");
const pool = require("./db/pool");

// 🚨 PROD TRIPWIRE – FAIL IF DEV MODE ENABLED IN PRODUCTION
if (env.NODE_ENV === 'production' && global.__DEV__) {
  throw new Error('DEV MODE ACTIVE IN PRODUCTION – ABORTING');
}

app.listen(env.PORT, () => {
  // Keep startup log minimal and non-sensitive.
  console.log(`Fielddesk V3 backend listening on port ${env.PORT}`);

  // 🚨 DEV ONLY – MUST NEVER RUN IN PRODUCTION
  if (global.__DEV__) {
    (async () => {
      try {
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        console.log('DB connection verified (dev only)');
      } catch (err) {
        console.warn('DB connection failed (dev only):', err.message);
      }
    })();
  }
});
