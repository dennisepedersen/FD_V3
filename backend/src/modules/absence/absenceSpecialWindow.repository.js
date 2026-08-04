"use strict";

async function findById(client, { tenantId, specialWindowId }) {
  const { rows } = await client.query(
    `
      SELECT
        id,
        tenant_id,
        key,
        name,
        description,
        absence_start_date,
        absence_end_date,
        submission_open_date,
        submission_deadline,
        review_start_date,
        collective_processing,
        approval_blocked_before_review,
        late_submission_policy,
        receipt_text,
        is_active,
        created_at,
        updated_at
      FROM absence_special_window
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, specialWindowId]
  );

  return rows[0] || null;
}

async function listReviewReady(client, { tenantId, asOfDate }) {
  const { rows } = await client.query(
    `
      SELECT
        id,
        tenant_id,
        key,
        name,
        absence_start_date,
        absence_end_date,
        submission_deadline,
        review_start_date,
        late_submission_policy
      FROM absence_special_window
      WHERE tenant_id = $1
        AND is_active = true
        AND review_start_date <= $2::date
      ORDER BY review_start_date ASC, absence_start_date ASC, name ASC
    `,
    [tenantId, asOfDate]
  );

  return rows;
}

module.exports = {
  findById,
  listReviewReady,
};
