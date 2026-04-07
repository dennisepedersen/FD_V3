'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.production') });
const crypto = require('crypto');
const { Pool } = require('pg');

const TARGET_PARENT_EK_ID = 18008;
const TARGET_CHILD_REF = '80229-001';
const TARGET_CHILD_EK_ID = 29167;
const SITE_NAME = 'hoyrup-clemmensen';
const PAGE_SIZE = 200;
const MAX_PAGES = 220;

function encryptionKey() {
  return crypto.createHash('sha256').update(process.env.JWT_SECRET).digest();
}

function decryptSecret(cipherText) {
  const [ivBase64, tagBase64, encryptedBase64] = String(cipherText || '').split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivBase64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagBase64, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadApiKey() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT tc.ek_api_key_encrypted
       FROM tenant_config tc
       JOIN tenant t ON t.id = tc.tenant_id
       WHERE t.slug = 'hoyrup-clemmensen'
       LIMIT 1`
    );

    if (!rows[0]?.ek_api_key_encrypted) {
      throw new Error('No ek_api_key_encrypted found for hoyrup-clemmensen');
    }

    return decryptSecret(rows[0].ek_api_key_encrypted);
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const apiKey = await loadApiKey();
  const headers = {
    apikey: apiKey,
    siteName: SITE_NAME,
    Accept: 'application/json',
  };

  let childRow = null;
  let parentRow = null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://externalaccessapi.e-komplet.dk/api/v4.0/projects?page=${page}&pageSize=${PAGE_SIZE}`;
    const response = await fetch(url, { method: 'GET', headers });

    if (response.status === 429) {
      await delay(2500);
      page -= 1;
      continue;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} on page ${page}`);
    }

    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : (payload.data || payload.items || payload.projects || []);

    for (const row of rows) {
      if (!childRow && String(row.reference || '').trim() === TARGET_CHILD_REF) {
        childRow = row;
      }
      if (!parentRow && Number(row.projectID) === TARGET_PARENT_EK_ID) {
        parentRow = row;
      }
    }

    if (childRow && parentRow) {
      break;
    }

    const nextPage = payload.nextPage ?? payload.NextPage ?? null;
    if (!nextPage && rows.length < PAGE_SIZE) {
      break;
    }

    await delay(350);
  }

  console.log(JSON.stringify({
    parent: parentRow
      ? {
          reference: parentRow.reference ?? null,
          projectID: parentRow.projectID ?? null,
          isClosed: parentRow.isClosed ?? null,
        }
      : null,
    child: childRow
      ? {
          reference: childRow.reference ?? null,
          projectID: childRow.projectID ?? null,
          parentProjectID: childRow.parentProjectID ?? null,
          isSubproject: childRow.isSubproject ?? null,
        }
      : null,
    expected: {
      childRef: TARGET_CHILD_REF,
      childEkId: TARGET_CHILD_EK_ID,
      parentEkId: TARGET_PARENT_EK_ID,
    },
  }, null, 2));
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
