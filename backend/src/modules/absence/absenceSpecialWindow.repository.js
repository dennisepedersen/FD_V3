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

async function listOverlappingActiveScopedForEmployee(client, {
  tenantId,
  employeeTenantUserId,
  absenceTypeId,
  startDate,
  endDate,
}) {
  const { rows } = await client.query(
    `
      SELECT
        sw.id,
        sw.tenant_id,
        sw.key,
        sw.name,
        sw.absence_start_date,
        sw.absence_end_date,
        sw.submission_open_date,
        sw.submission_deadline,
        sw.review_start_date,
        sw.late_submission_policy,
        sw.collective_processing,
        sw.approval_blocked_before_review,
        sws.scope_type,
        sws.resource_group_id,
        sws.scope_tenant_user_id,
        sws.absence_type_id AS scope_absence_type_id,
        CASE
          WHEN sw.absence_start_date <= $4::date AND sw.absence_end_date >= $5::date THEN true
          ELSE false
        END AS fully_contains_request
      FROM absence_special_window sw
      JOIN absence_special_window_scope sws
        ON sws.tenant_id = sw.tenant_id
       AND sws.special_window_id = sw.id
      WHERE sw.tenant_id = $1
        AND sw.is_active = true
        AND sw.absence_start_date <= $5::date
        AND sw.absence_end_date >= $4::date
        AND (sws.absence_type_id IS NULL OR sws.absence_type_id = $3)
        AND (
          sws.scope_type = 'tenant'
          OR (sws.scope_type = 'tenant_user' AND sws.scope_tenant_user_id = $2)
          OR sws.scope_type = 'resource_group'
        )
      ORDER BY sw.absence_start_date ASC, sw.id ASC, sws.scope_type ASC
    `,
    [tenantId, employeeTenantUserId, absenceTypeId, startDate, endDate]
  );

  return rows;
}

module.exports = {
  findById,
  listOverlappingActiveScopedForEmployee,
  listReviewReady,
};