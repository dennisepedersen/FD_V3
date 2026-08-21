"use strict";

const WINDOW_COLUMNS = `
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
  vacation_day_exemption_quota,
  receipt_text,
  is_active,
  created_by_tenant_user_id,
  updated_by_tenant_user_id,
  created_at,
  updated_at,
  version
`;

async function findById(client, { tenantId, specialWindowId, forUpdate = false }) {
  const { rows } = await client.query(
    `
      SELECT ${WINDOW_COLUMNS}
      FROM absence_special_window
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
      ${forUpdate ? "FOR UPDATE" : ""}
    `,
    [tenantId, specialWindowId]
  );

  return rows[0] || null;
}

async function listKeysByPrefix(client, { tenantId, keyPrefix }) {
  const { rows } = await client.query(
    `
      SELECT key
      FROM absence_special_window
      WHERE tenant_id = $1
        AND (
          lower(key) = lower($2)
          OR lower(key) LIKE lower($2 || '-%')
        )
    `,
    [tenantId, keyPrefix]
  );
  return rows.map((row) => row.key);
}

async function listWindows(client, {
  tenantId,
  active = null,
  year = null,
  status = null,
  absenceTypeId = null,
  scopeType = null,
  limit = 100,
  offset = 0,
}) {
  const { rows } = await client.query(
    `
      WITH request_counts AS (
        SELECT
          tenant_id,
          special_window_id,
          COUNT(*)::integer AS total_count,
          COUNT(*) FILTER (WHERE status = 'submitted')::integer AS pending_count,
          COUNT(*) FILTER (WHERE status = 'approved')::integer AS approved_count,
          COUNT(*) FILTER (WHERE status = 'rejected')::integer AS rejected_count,
          COUNT(*) FILTER (WHERE status = 'cancelled')::integer AS cancelled_count,
          COUNT(*) FILTER (WHERE COALESCE((metadata.metadata_json->>'submitted_after_deadline')::boolean, false) = true)::integer AS late_count
        FROM absence_request ar
        LEFT JOIN LATERAL (
          SELECT are.metadata_json
          FROM absence_request_event are
          WHERE are.tenant_id = ar.tenant_id
            AND are.absence_request_id = ar.id
            AND are.event_type = 'submitted'
          ORDER BY are.created_at DESC
          LIMIT 1
        ) metadata ON true
        WHERE tenant_id = $1
          AND special_window_id IS NOT NULL
        GROUP BY ar.tenant_id, ar.special_window_id
      )
      SELECT
        sw.*,
        COALESCE(rc.total_count, 0) AS request_total_count,
        COALESCE(rc.pending_count, 0) AS request_pending_count,
        COALESCE(rc.approved_count, 0) AS request_approved_count,
        COALESCE(rc.rejected_count, 0) AS request_rejected_count,
        COALESCE(rc.cancelled_count, 0) AS request_cancelled_count,
        COALESCE(rc.late_count, 0) AS request_late_count
      FROM absence_special_window sw
      LEFT JOIN request_counts rc
        ON rc.tenant_id = sw.tenant_id
       AND rc.special_window_id = sw.id
      WHERE sw.tenant_id = $1
        AND ($2::boolean IS NULL OR sw.is_active = $2::boolean)
        AND ($3::integer IS NULL OR EXTRACT(YEAR FROM sw.absence_start_date)::integer = $3::integer OR EXTRACT(YEAR FROM sw.absence_end_date)::integer = $3::integer)
        AND ($4::uuid IS NULL OR EXISTS (
          SELECT 1
          FROM absence_special_window_scope sws
          WHERE sws.tenant_id = sw.tenant_id
            AND sws.special_window_id = sw.id
            AND sws.absence_type_id = $4::uuid
        ))
        AND ($5::text IS NULL OR EXISTS (
          SELECT 1
          FROM absence_special_window_scope sws
          WHERE sws.tenant_id = sw.tenant_id
            AND sws.special_window_id = sw.id
            AND sws.scope_type = $5::text
        ))
      ORDER BY sw.absence_start_date DESC, sw.name ASC, sw.id ASC
      LIMIT $6
      OFFSET $7
    `,
    [tenantId, active, year, absenceTypeId, scopeType, limit, offset]
  );

  void status;
  return rows;
}

async function insertWindow(client, {
  tenantId,
  key,
  name,
  description = null,
  absenceStartDate,
  absenceEndDate,
  submissionOpenDate,
  submissionDeadline,
  reviewStartDate,
  collectiveProcessing = true,
  approvalBlockedBeforeReview = true,
  lateSubmissionPolicy = "blocked",
  vacationDayExemptionQuota = 1,
  receiptText = null,
  isActive = true,
  actorId,
}) {
  const { rows } = await client.query(
    `
      INSERT INTO absence_special_window (
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
        vacation_day_exemption_quota,
        receipt_text,
        is_active,
        created_by_tenant_user_id,
        updated_by_tenant_user_id
      )
      VALUES ($1, $2, $3, $4, $5::date, $6::date, $7::date, $8::date, $9::date, $10, $11, $12, $13, $14, $15, $16, $16)
      RETURNING ${WINDOW_COLUMNS}
    `,
    [
      tenantId,
      key,
      name,
      description,
      absenceStartDate,
      absenceEndDate,
      submissionOpenDate,
      submissionDeadline,
      reviewStartDate,
      collectiveProcessing === true,
      approvalBlockedBeforeReview === true,
      lateSubmissionPolicy,
      vacationDayExemptionQuota,
      receiptText,
      isActive === true,
      actorId,
    ]
  );

  return rows[0];
}

async function updateWindow(client, {
  tenantId,
  specialWindowId,
  expectedVersion,
  patch,
  actorId,
}) {
  const { rows } = await client.query(
    `
      UPDATE absence_special_window
      SET
        name = COALESCE($4, name),
        description = CASE WHEN $5::boolean THEN $6 ELSE description END,
        absence_start_date = COALESCE($7::date, absence_start_date),
        absence_end_date = COALESCE($8::date, absence_end_date),
        submission_open_date = COALESCE($9::date, submission_open_date),
        submission_deadline = COALESCE($10::date, submission_deadline),
        review_start_date = COALESCE($11::date, review_start_date),
        collective_processing = COALESCE($12::boolean, collective_processing),
        approval_blocked_before_review = COALESCE($13::boolean, approval_blocked_before_review),
        late_submission_policy = COALESCE($14::text, late_submission_policy),
        vacation_day_exemption_quota = COALESCE($15::integer, vacation_day_exemption_quota),
        receipt_text = CASE WHEN $16::boolean THEN $17 ELSE receipt_text END,
        is_active = COALESCE($18::boolean, is_active),
        updated_by_tenant_user_id = $19,
        version = version + 1
      WHERE tenant_id = $1
        AND id = $2
        AND version = $3
      RETURNING ${WINDOW_COLUMNS}
    `,
    [
      tenantId,
      specialWindowId,
      expectedVersion,
      patch.name || null,
      patch.hasDescription === true,
      patch.description || null,
      patch.absenceStartDate || null,
      patch.absenceEndDate || null,
      patch.submissionOpenDate || null,
      patch.submissionDeadline || null,
      patch.reviewStartDate || null,
      Object.prototype.hasOwnProperty.call(patch, "collectiveProcessing") ? patch.collectiveProcessing === true : null,
      Object.prototype.hasOwnProperty.call(patch, "approvalBlockedBeforeReview") ? patch.approvalBlockedBeforeReview === true : null,
      patch.lateSubmissionPolicy || null,
      Object.prototype.hasOwnProperty.call(patch, "vacationDayExemptionQuota") ? patch.vacationDayExemptionQuota : null,
      patch.hasReceiptText === true,
      patch.receiptText || null,
      Object.prototype.hasOwnProperty.call(patch, "isActive") ? patch.isActive === true : null,
      actorId,
    ]
  );

  return rows[0] || null;
}

async function archiveWindow(client, { tenantId, specialWindowId, expectedVersion, actorId }) {
  const { rows } = await client.query(
    `
      UPDATE absence_special_window
      SET
        is_active = false,
        updated_by_tenant_user_id = $4,
        version = version + 1
      WHERE tenant_id = $1
        AND id = $2
        AND version = $3
      RETURNING ${WINDOW_COLUMNS}
    `,
    [tenantId, specialWindowId, expectedVersion, actorId]
  );
  return rows[0] || null;
}

async function listScopesForWindow(client, { tenantId, specialWindowId }) {
  const { rows } = await client.query(
    `
      SELECT
        sws.id,
        sws.tenant_id,
        sws.special_window_id,
        sws.scope_type,
        sws.resource_group_id,
        rg.name AS resource_group_name,
        rg.status AS resource_group_status,
        sws.scope_tenant_user_id,
        tu.name AS tenant_user_name,
        sws.absence_type_id,
        at.key AS absence_type_key,
        at.name AS absence_type_name,
        at.special_window_eligible AS absence_type_special_window_eligible,
        sws.created_at
      FROM absence_special_window_scope sws
      LEFT JOIN resource_groups rg
        ON rg.tenant_id = sws.tenant_id
       AND rg.id = sws.resource_group_id
      LEFT JOIN tenant_user tu
        ON tu.tenant_id = sws.tenant_id
       AND tu.id = sws.scope_tenant_user_id
      LEFT JOIN absence_type at
        ON at.tenant_id = sws.tenant_id
       AND at.id = sws.absence_type_id
      WHERE sws.tenant_id = $1
        AND sws.special_window_id = $2
      ORDER BY sws.scope_type ASC, rg.name ASC NULLS LAST, tu.name ASC NULLS LAST, at.name ASC NULLS LAST, sws.id ASC
    `,
    [tenantId, specialWindowId]
  );
  return rows;
}

async function insertScopes(client, { tenantId, specialWindowId, scopes }) {
  const inserted = [];
  for (const scope of scopes) {
    const { rows } = await client.query(
      `
        INSERT INTO absence_special_window_scope (
          tenant_id,
          special_window_id,
          scope_type,
          resource_group_id,
          scope_tenant_user_id,
          absence_type_id
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT DO NOTHING
        RETURNING id, tenant_id, special_window_id, scope_type, resource_group_id, scope_tenant_user_id, absence_type_id, created_at
      `,
      [tenantId, specialWindowId, scope.scopeType, scope.resourceGroupId, scope.tenantUserId, scope.absenceTypeId]
    );
    if (rows[0]) inserted.push(rows[0]);
  }
  return inserted;
}

async function replaceScopes(client, { tenantId, specialWindowId, scopes }) {
  await client.query(
    `DELETE FROM absence_special_window_scope WHERE tenant_id = $1 AND special_window_id = $2`,
    [tenantId, specialWindowId]
  );
  return insertScopes(client, { tenantId, specialWindowId, scopes });
}

async function countRequestsForWindow(client, { tenantId, specialWindowId }) {
  const { rows } = await client.query(
    `
      SELECT
        COUNT(*)::integer AS total_count,
        COUNT(*) FILTER (WHERE status <> 'draft')::integer AS blocking_count
      FROM absence_request
      WHERE tenant_id = $1
        AND special_window_id = $2
    `,
    [tenantId, specialWindowId]
  );
  return rows[0] || { total_count: 0, blocking_count: 0 };
}

async function listRelevantAbsenceTypes(client, { tenantId, specialWindowId }) {
  const { rows } = await client.query(
    `
      WITH scoped_types AS (
        SELECT DISTINCT absence_type_id
        FROM absence_special_window_scope
        WHERE tenant_id = $1
          AND special_window_id = $2
          AND absence_type_id IS NOT NULL
      )
      SELECT id, tenant_id, key, name, special_window_eligible, is_active,
        CASE WHEN EXISTS (SELECT 1 FROM scoped_types) THEN true ELSE false END AS explicitly_scoped
      FROM absence_type at
      WHERE at.tenant_id = $1
        AND at.is_active = true
        AND (
          (EXISTS (SELECT 1 FROM scoped_types) AND at.id IN (SELECT absence_type_id FROM scoped_types))
          OR (NOT EXISTS (SELECT 1 FROM scoped_types) AND at.special_window_eligible = true)
        )
      ORDER BY at.sort_order ASC, at.name ASC, at.id ASC
    `,
    [tenantId, specialWindowId]
  );
  return rows;
}

async function findTenantUsersByIds(client, { tenantId, ids }) {
  if (!ids.length) return [];
  const { rows } = await client.query(
    `SELECT id, name, status, login_status FROM tenant_user WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    [tenantId, ids]
  );
  return rows;
}

async function findResourceGroupsByIds(client, { tenantId, ids }) {
  if (!ids.length) return [];
  const { rows } = await client.query(
    `SELECT id, name, status FROM resource_groups WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    [tenantId, ids]
  );
  return rows;
}

async function findAbsenceTypesByIds(client, { tenantId, ids }) {
  if (!ids.length) return [];
  const { rows } = await client.query(
    `SELECT id, key, name, is_active, special_window_eligible FROM absence_type WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    [tenantId, ids]
  );
  return rows;
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
      SELECT DISTINCT ON (sw.id, sws.scope_type, sws.resource_group_id, sws.scope_tenant_user_id, sws.absence_type_id)
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
        sw.vacation_day_exemption_quota,
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
      LEFT JOIN resource_groups rg
        ON rg.tenant_id = sws.tenant_id
       AND rg.id = sws.resource_group_id
      LEFT JOIN resource_group_members rgm
        ON rgm.tenant_id = sws.tenant_id
       AND rgm.group_id = sws.resource_group_id
      LEFT JOIN fitter f
        ON f.tenant_id = rgm.tenant_id
       AND f.fitter_id = rgm.fitter_id
       AND f.tenant_user_id = $2
      WHERE sw.tenant_id = $1
        AND sw.is_active = true
        AND sw.absence_start_date <= $5::date
        AND sw.absence_end_date >= $4::date
        AND (sws.absence_type_id IS NULL OR sws.absence_type_id = $3)
        AND (
          sws.scope_type = 'tenant'
          OR (sws.scope_type = 'tenant_user' AND sws.scope_tenant_user_id = $2)
          OR (sws.scope_type = 'resource_group' AND rg.status = 'active' AND f.tenant_user_id = $2)
        )
      ORDER BY sw.id, sws.scope_type ASC, sws.resource_group_id ASC NULLS LAST, sws.scope_tenant_user_id ASC NULLS LAST, sws.absence_type_id ASC NULLS LAST
    `,
    [tenantId, employeeTenantUserId, absenceTypeId, startDate, endDate]
  );

  return rows;
}

async function listReviewOverviewRequests(client, { tenantId, specialWindowId, limit = 200, offset = 0 }) {
  const { rows } = await client.query(
    `
      SELECT
        ar.id,
        ar.tenant_id,
        ar.employee_tenant_user_id,
        employee.name AS employee_name,
        ar.absence_type_id,
        at.key AS absence_type_key,
        at.name AS absence_type_name,
        ar.duration_type,
        ar.day_part,
        ar.start_date,
        ar.end_date,
        ar.start_time,
        ar.end_time,
        ar.timezone,
        ar.employee_comment,
        ar.status,
        ar.assigned_manager_tenant_user_id,
        manager.name AS assigned_manager_name,
        ar.submitted_at,
        ar.reviewed_at,
        ar.cancelled_at,
        ar.version,
        ar.created_at,
        ar.updated_at,
        COALESCE((submitted_event.metadata_json->>'submitted_after_deadline')::boolean, false) AS submitted_after_deadline,
        submitted_event.metadata_json AS submitted_metadata,
        COALESCE(resource_groups.groups, '[]'::jsonb) AS resource_groups
      FROM absence_request ar
      JOIN tenant_user employee
        ON employee.tenant_id = ar.tenant_id
       AND employee.id = ar.employee_tenant_user_id
      JOIN absence_type at
        ON at.tenant_id = ar.tenant_id
       AND at.id = ar.absence_type_id
      LEFT JOIN tenant_user manager
        ON manager.tenant_id = ar.tenant_id
       AND manager.id = ar.assigned_manager_tenant_user_id
      LEFT JOIN LATERAL (
        SELECT are.metadata_json
        FROM absence_request_event are
        WHERE are.tenant_id = ar.tenant_id
          AND are.absence_request_id = ar.id
          AND are.event_type = 'submitted'
        ORDER BY are.created_at DESC
        LIMIT 1
      ) submitted_event ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('id', grouped.id, 'name', grouped.name) ORDER BY grouped.name ASC, grouped.id ASC) AS groups
        FROM (
          SELECT DISTINCT rg.id, rg.name
          FROM fitter f
          JOIN resource_group_members rgm
          ON rgm.tenant_id = f.tenant_id
         AND rgm.fitter_id = f.fitter_id
        JOIN resource_groups rg
          ON rg.tenant_id = rgm.tenant_id
         AND rg.id = rgm.group_id
        WHERE f.tenant_id = ar.tenant_id
          AND f.tenant_user_id = ar.employee_tenant_user_id
          AND rg.status = 'active'
        ) grouped
      ) resource_groups ON true
      WHERE ar.tenant_id = $1
        AND ar.special_window_id = $2
      ORDER BY ar.start_date ASC, ar.start_time ASC NULLS FIRST, employee.name ASC NULLS LAST, ar.id ASC
      LIMIT $3
      OFFSET $4
    `,
    [tenantId, specialWindowId, limit, offset]
  );
  return rows;
}

async function listVacationDayQuotaUsageDates(client, { tenantId, employeeTenantUserId, specialWindowId }) {
  const { rows } = await client.query(
    `
      SELECT DISTINCT days.day::date AS absence_date
      FROM absence_special_window sw
      JOIN absence_request ar
        ON ar.tenant_id = sw.tenant_id
       AND ar.employee_tenant_user_id = $2
       AND ar.status NOT IN ('draft', 'rejected', 'cancelled')
       AND ar.start_date <= sw.absence_end_date
       AND COALESCE(ar.end_date, ar.start_date) >= sw.absence_start_date
      JOIN absence_type at
        ON at.tenant_id = ar.tenant_id
       AND at.id = ar.absence_type_id
       AND at.key = 'vacation_day'
      JOIN LATERAL generate_series(ar.start_date, COALESCE(ar.end_date, ar.start_date), interval '1 day') AS days(day)
        ON true
      WHERE sw.tenant_id = $1
        AND sw.id = $3
        AND days.day::date BETWEEN sw.absence_start_date AND sw.absence_end_date
      ORDER BY absence_date ASC
    `,
    [tenantId, employeeTenantUserId, specialWindowId]
  );
  return rows.map((row) => row.absence_date);
}
module.exports = {
  archiveWindow,
  countRequestsForWindow,
  findAbsenceTypesByIds,
  findById,
  findResourceGroupsByIds,
  findTenantUsersByIds,
  insertScopes,
  insertWindow,
  listKeysByPrefix,
  listOverlappingActiveScopedForEmployee,
  listVacationDayQuotaUsageDates,
  listRelevantAbsenceTypes,
  listReviewOverviewRequests,
  listReviewReady,
  listScopesForWindow,
  listWindows,
  replaceScopes,
  updateWindow,
};