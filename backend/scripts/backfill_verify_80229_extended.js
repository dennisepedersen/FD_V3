require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.production') });
const crypto = require('crypto');
const { Pool } = require('pg');

const TARGET_REF = '80229-001';
const V3_PAGE = 3;
const V4_PAGE = 141;
const PAGE_SIZE = 200;

function encryptionKey(secret) {
  return crypto.createHash('sha256').update(secret).digest();
}

function decryptSecret(cipherText, jwtSecret) {
  const [ivBase64, tagBase64, encryptedBase64] = String(cipherText || '').split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(jwtSecret), Buffer.from(ivBase64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagBase64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  let tenantId;
  let apiKey;

  try {
    const c = await pool.connect();
    try {
      const { rows } = await c.query(
        `SELECT t.id AS tenant_id, tc.ek_api_key_encrypted
         FROM tenant t
         JOIN tenant_config tc ON tc.tenant_id = t.id
         WHERE t.slug = 'hoyrup-clemmensen'
         LIMIT 1`
      );
      tenantId = rows[0].tenant_id;
      apiKey = decryptSecret(rows[0].ek_api_key_encrypted, process.env.JWT_SECRET);
    } finally {
      c.release();
    }

    const headers = { apikey: apiKey, siteName: 'hoyrup-clemmensen', Accept: 'application/json' };
    const base = 'https://externalaccessapi.e-komplet.dk';

    const v3Url = `${base}/api/v3.0/projects?page=${V3_PAGE}&pageSize=${PAGE_SIZE}`;
    const v4Url = `${base}/api/v4.0/projects?page=${V4_PAGE}&pageSize=${PAGE_SIZE}`;

    const [v3Resp, v4Resp] = await Promise.all([
      fetch(v3Url, { headers }),
      fetch(v4Url, { headers }),
    ]);

    if (!v3Resp.ok) throw new Error(`v3_fetch_failed:${v3Resp.status}`);
    if (!v4Resp.ok) throw new Error(`v4_fetch_failed:${v4Resp.status}`);

    const v3Payload = await v3Resp.json();
    const v4Payload = await v4Resp.json();

    const v3Rows = Array.isArray(v3Payload?.data?.[0]?.data) ? v3Payload.data[0].data : [];
    const v4Rows = Array.isArray(v4Payload?.data) ? v4Payload.data : [];

    const v3Match = v3Rows.find((r) => String(r.ProjectReference || '').trim() === TARGET_REF);
    const v4Match = v4Rows.find((r) => String(r.reference || '').trim() === TARGET_REF);

    if (!v3Match) throw new Error('v3_match_not_found_on_expected_page');
    if (!v4Match) throw new Error('v4_match_not_found_on_expected_page');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const coreRes = await client.query(
        `SELECT project_id
         FROM project_core
         WHERE tenant_id = $1 AND external_project_ref = $2
         LIMIT 1`,
        [tenantId, TARGET_REF]
      );

      if (!coreRes.rows.length) throw new Error('project_core_row_missing');
      const projectId = coreRes.rows[0].project_id;

      await client.query(
        `INSERT INTO project_wip (
          project_id, tenant_id,
          last_registration, last_fitter_hour_date, calculated_days_since_last_registration,
          ready_to_bill, margin, costs, ongoing, billed, coverage,
          hours_budget, hours_expected, hours_fitter_hour, remaining_hours
        ) VALUES (
          $1, $2,
          $3::timestamptz, $4::timestamptz, $5,
          $6, $7, $8, $9, $10, $11,
          $12, $13, $14, $15
        )
        ON CONFLICT (project_id)
        DO UPDATE SET
          last_registration = EXCLUDED.last_registration,
          last_fitter_hour_date = EXCLUDED.last_fitter_hour_date,
          calculated_days_since_last_registration = EXCLUDED.calculated_days_since_last_registration,
          ready_to_bill = EXCLUDED.ready_to_bill,
          margin = EXCLUDED.margin,
          costs = EXCLUDED.costs,
          ongoing = EXCLUDED.ongoing,
          billed = EXCLUDED.billed,
          coverage = EXCLUDED.coverage,
          hours_budget = EXCLUDED.hours_budget,
          hours_expected = EXCLUDED.hours_expected,
          hours_fitter_hour = EXCLUDED.hours_fitter_hour,
          remaining_hours = EXCLUDED.remaining_hours,
          updated_at = now()`,
        [
          projectId,
          tenantId,
          v3Match.LastRegistration || null,
          v3Match.LastFitterHourDate || null,
          v3Match.CalculatedDaysSinceLastRegistration ?? null,
          v3Match.ReadyToBill ?? null,
          v3Match.Margin ?? null,
          v3Match.Costs ?? null,
          v3Match.Ongoing ?? null,
          v3Match.Billed ?? null,
          v3Match.Coverage ?? null,
          v3Match.HoursBudget ?? null,
          v3Match.HoursExpected ?? null,
          v3Match.HoursFitterHour ?? null,
          v3Match.RemainingHours ?? null,
        ]
      );

      await client.query(
        `INSERT INTO project_masterdata_v4 (
          project_id, tenant_id, parent_project_ek_id, is_subproject, is_closed,
          responsible_name, project_expected_values, project_budget,
          associated_address, associated_person, worksheet_ids,
          total_turn_over_exp, source_updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7::jsonb, $8::jsonb,
          $9::jsonb, $10::jsonb, $11::jsonb,
          $12, $13::timestamptz
        )
        ON CONFLICT (project_id)
        DO UPDATE SET
          parent_project_ek_id = EXCLUDED.parent_project_ek_id,
          is_subproject = EXCLUDED.is_subproject,
          is_closed = EXCLUDED.is_closed,
          responsible_name = EXCLUDED.responsible_name,
          project_expected_values = EXCLUDED.project_expected_values,
          project_budget = EXCLUDED.project_budget,
          associated_address = EXCLUDED.associated_address,
          associated_person = EXCLUDED.associated_person,
          worksheet_ids = EXCLUDED.worksheet_ids,
          total_turn_over_exp = EXCLUDED.total_turn_over_exp,
          source_updated_at = EXCLUDED.source_updated_at,
          updated_at = now()`,
        [
          projectId,
          tenantId,
          v4Match.parentProjectID ?? null,
          v4Match.isSubproject ?? null,
          v4Match.isClosed ?? null,
          v4Match.responsibleName ?? null,
          JSON.stringify(v4Match.projectExpectedValues ?? null),
          JSON.stringify(v4Match.projectBudget ?? null),
          JSON.stringify(v4Match.associatedAddress ?? null),
          JSON.stringify(v4Match.associatedPerson ?? null),
          JSON.stringify(v4Match.worksheetIDs ?? null),
          v4Match.projectExpectedValues?.totalTurnOverExp ?? null,
          v4Match.updatedDate ?? null,
        ]
      );

      const verify = await client.query(
        `SELECT
          pw.calculated_days_since_last_registration,
          pw.last_registration,
          pw.last_fitter_hour_date,
          pm.parent_project_ek_id,
          pm.is_subproject,
          pm.total_turn_over_exp
         FROM project_core pc
         LEFT JOIN project_wip pw
           ON pw.project_id = pc.project_id
          AND pw.tenant_id = pc.tenant_id
         LEFT JOIN project_masterdata_v4 pm
           ON pm.project_id = pc.project_id
          AND pm.tenant_id = pc.tenant_id
         WHERE pc.tenant_id = $1 AND pc.external_project_ref = $2
         LIMIT 1`,
        [tenantId, TARGET_REF]
      );

      await client.query('COMMIT');
      console.log(JSON.stringify({
        v3Endpoint: v3Url,
        v4Endpoint: v4Url,
        verification: verify.rows[0] || null,
      }, null, 2));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
