"use strict";

async function findById(client, { tenantId, absenceRequestId }) {
  const { rows } = await client.query(
    `
      SELECT
        id,
        tenant_id,
        employee_tenant_user_id,
        employee_fitter_id,
        absence_type_id,
        duration_type,
        day_part,
        start_date,
        end_date,
        start_time,
        end_time,
        timezone,
        employee_comment,
        status,
        assigned_manager_tenant_user_id,
        special_window_id,
        submitted_at,
        reviewed_at,
        cancelled_at,
        version,
        created_at,
        updated_at
      FROM absence_request
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, absenceRequestId]
  );

  return rows[0] || null;
}

async function findByIdForEmployee(client, { tenantId, employeeTenantUserId, absenceRequestId, forUpdate = false }) {
  const { rows } = await client.query(
    `
      SELECT
        ar.id,
        ar.tenant_id,
        ar.employee_tenant_user_id,
        ar.employee_fitter_id,
        ar.absence_type_id,
        at.key AS absence_type_key,
        at.name AS absence_type_name,
        at.workflow_mode AS absence_type_workflow_mode,
        at.comment_policy AS absence_type_comment_policy,
        at.visibility_policy AS absence_type_visibility_policy,
        at.allowed_duration_types AS absence_type_allowed_duration_types,
        at.special_window_eligible AS absence_type_special_window_eligible,
        at.is_active AS absence_type_is_active,
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
        ar.special_window_id,
        sw.key AS special_window_key,
        sw.name AS special_window_name,
        sw.review_start_date AS special_window_review_start_date,
        sw.submission_deadline AS special_window_submission_deadline,
        ar.submitted_at,
        ar.reviewed_at,
        ar.cancelled_at,
        ar.version,
        ar.created_at,
        ar.updated_at
      FROM absence_request ar
      JOIN absence_type at
        ON at.tenant_id = ar.tenant_id
       AND at.id = ar.absence_type_id
      LEFT JOIN tenant_user manager
        ON manager.tenant_id = ar.tenant_id
       AND manager.id = ar.assigned_manager_tenant_user_id
      LEFT JOIN absence_special_window sw
        ON sw.tenant_id = ar.tenant_id
       AND sw.id = ar.special_window_id
      WHERE ar.tenant_id = $1
        AND ar.employee_tenant_user_id = $2
        AND ar.id = $3
      LIMIT 1
      ${forUpdate ? "FOR UPDATE OF ar" : ""}
    `,
    [tenantId, employeeTenantUserId, absenceRequestId]
  );

  return rows[0] || null;
}

async function listForEmployee(client, {
  tenantId,
  employeeTenantUserId,
  status = null,
  dateFrom = null,
  dateTo = null,
  limit = 100,
  offset = 0,
}) {
  const { rows } = await client.query(
    `
      SELECT
        ar.id,
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
        ar.status,
        ar.assigned_manager_tenant_user_id,
        manager.name AS assigned_manager_name,
        ar.special_window_id,
        sw.key AS special_window_key,
        sw.name AS special_window_name,
        ar.submitted_at,
        ar.reviewed_at,
        ar.cancelled_at,
        ar.version,
        ar.created_at,
        ar.updated_at
      FROM absence_request ar
      JOIN absence_type at
        ON at.tenant_id = ar.tenant_id
       AND at.id = ar.absence_type_id
      LEFT JOIN tenant_user manager
        ON manager.tenant_id = ar.tenant_id
       AND manager.id = ar.assigned_manager_tenant_user_id
      LEFT JOIN absence_special_window sw
        ON sw.tenant_id = ar.tenant_id
       AND sw.id = ar.special_window_id
      WHERE ar.tenant_id = $1
        AND ar.employee_tenant_user_id = $2
        AND ($3::text IS NULL OR ar.status = $3::text)
        AND ($4::date IS NULL OR COALESCE(ar.end_date, ar.start_date) >= $4::date)
        AND ($5::date IS NULL OR ar.start_date <= $5::date)
      ORDER BY ar.created_at DESC, ar.id DESC
      LIMIT $6
      OFFSET $7
    `,
    [tenantId, employeeTenantUserId, status, dateFrom, dateTo, limit, offset]
  );

  return rows;
}

async function insertRequest(client, {
  tenantId,
  employeeTenantUserId,
  employeeFitterId = null,
  absenceTypeId,
  durationType,
  dayPart = null,
  startDate,
  endDate = null,
  startTime = null,
  endTime = null,
  timezone = "Europe/Copenhagen",
  employeeComment = null,
  status = "draft",
  assignedManagerTenantUserId = null,
  specialWindowId = null,
}) {
  const { rows } = await client.query(
    `
      INSERT INTO absence_request (
        tenant_id,
        employee_tenant_user_id,
        employee_fitter_id,
        absence_type_id,
        duration_type,
        day_part,
        start_date,
        end_date,
        start_time,
        end_time,
        timezone,
        employee_comment,
        status,
        assigned_manager_tenant_user_id,
        special_window_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9::time, $10::time, $11, $12, $13, $14, $15)
      RETURNING
        id,
        tenant_id,
        employee_tenant_user_id,
        employee_fitter_id,
        absence_type_id,
        duration_type,
        day_part,
        start_date,
        end_date,
        start_time,
        end_time,
        timezone,
        employee_comment,
        status,
        assigned_manager_tenant_user_id,
        special_window_id,
        version,
        created_at,
        updated_at
    `,
    [
      tenantId,
      employeeTenantUserId,
      employeeFitterId,
      absenceTypeId,
      durationType,
      dayPart,
      startDate,
      endDate,
      startTime,
      endTime,
      timezone,
      employeeComment,
      status,
      assignedManagerTenantUserId,
      specialWindowId,
    ]
  );

  return rows[0];
}

async function acquireIdempotencyLock(client, { lockKey }) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
    [lockKey]
  );
}

async function findCreatedByIdempotencyKey(client, {
  tenantId,
  employeeTenantUserId,
  idempotencyKey,
}) {
  const { rows } = await client.query(
    `
      SELECT
        ar.id,
        ar.tenant_id,
        ar.employee_tenant_user_id,
        ar.employee_fitter_id,
        ar.absence_type_id,
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
        ar.special_window_id,
        ar.submitted_at,
        ar.reviewed_at,
        ar.cancelled_at,
        ar.version,
        ar.created_at,
        ar.updated_at
      FROM absence_request_event are
      JOIN absence_request ar
        ON ar.tenant_id = are.tenant_id
       AND ar.id = are.absence_request_id
      WHERE are.tenant_id = $1
        AND ar.employee_tenant_user_id = $2
        AND are.event_type = 'created'
        AND are.metadata_json->>'idempotency_key' = $3
      ORDER BY are.created_at ASC
      LIMIT 1
    `,
    [tenantId, employeeTenantUserId, idempotencyKey]
  );

  return rows[0] || null;
}

async function updateDraftForEmployee(client, {
  tenantId,
  employeeTenantUserId,
  absenceRequestId,
  expectedVersion,
  absenceTypeId,
  durationType,
  dayPart = null,
  startDate,
  endDate = null,
  startTime = null,
  endTime = null,
  timezone,
  employeeComment = null,
}) {
  const { rows } = await client.query(
    `
      UPDATE absence_request
      SET
        absence_type_id = $5,
        duration_type = $6,
        day_part = $7,
        start_date = $8::date,
        end_date = $9::date,
        start_time = $10::time,
        end_time = $11::time,
        timezone = $12,
        employee_comment = $13,
        version = version + 1
      WHERE tenant_id = $1
        AND employee_tenant_user_id = $2
        AND id = $3
        AND version = $4
        AND status = 'draft'
      RETURNING
        id,
        tenant_id,
        employee_tenant_user_id,
        employee_fitter_id,
        absence_type_id,
        duration_type,
        day_part,
        start_date,
        end_date,
        start_time,
        end_time,
        timezone,
        employee_comment,
        status,
        assigned_manager_tenant_user_id,
        special_window_id,
        submitted_at,
        reviewed_at,
        cancelled_at,
        version,
        created_at,
        updated_at
    `,
    [
      tenantId,
      employeeTenantUserId,
      absenceRequestId,
      expectedVersion,
      absenceTypeId,
      durationType,
      dayPart,
      startDate,
      endDate,
      startTime,
      endTime,
      timezone,
      employeeComment,
    ]
  );

  return rows[0] || null;
}

async function submitDraftForEmployee(client, {
  tenantId,
  employeeTenantUserId,
  absenceRequestId,
  expectedVersion,
  managerTenantUserId,
  specialWindowId = null,
}) {
  const { rows } = await client.query(
    `
      UPDATE absence_request
      SET
        status = 'submitted',
        submitted_at = now(),
        assigned_manager_tenant_user_id = $5,
        special_window_id = $6,
        version = version + 1
      WHERE tenant_id = $1
        AND employee_tenant_user_id = $2
        AND id = $3
        AND version = $4
        AND status = 'draft'
      RETURNING
        id,
        tenant_id,
        employee_tenant_user_id,
        employee_fitter_id,
        absence_type_id,
        duration_type,
        day_part,
        start_date,
        end_date,
        start_time,
        end_time,
        timezone,
        employee_comment,
        status,
        assigned_manager_tenant_user_id,
        special_window_id,
        submitted_at,
        reviewed_at,
        cancelled_at,
        version,
        created_at,
        updated_at
    `,
    [
      tenantId,
      employeeTenantUserId,
      absenceRequestId,
      expectedVersion,
      managerTenantUserId,
      specialWindowId,
    ]
  );

  return rows[0] || null;
}

async function cancelForEmployee(client, {
  tenantId,
  employeeTenantUserId,
  absenceRequestId,
  expectedVersion,
  allowedStatuses,
}) {
  const { rows } = await client.query(
    `
      UPDATE absence_request
      SET
        status = 'cancelled',
        cancelled_at = now(),
        version = version + 1
      WHERE tenant_id = $1
        AND employee_tenant_user_id = $2
        AND id = $3
        AND version = $4
        AND status = ANY($5::text[])
      RETURNING
        id,
        tenant_id,
        employee_tenant_user_id,
        employee_fitter_id,
        absence_type_id,
        duration_type,
        day_part,
        start_date,
        end_date,
        start_time,
        end_time,
        timezone,
        employee_comment,
        status,
        assigned_manager_tenant_user_id,
        special_window_id,
        submitted_at,
        reviewed_at,
        cancelled_at,
        version,
        created_at,
        updated_at
    `,
    [tenantId, employeeTenantUserId, absenceRequestId, expectedVersion, allowedStatuses]
  );

  return rows[0] || null;
}

async function findNotificationContextById(client, { tenantId, absenceRequestId }) {
  const { rows } = await client.query(
    `
      SELECT
        ar.id,
        ar.tenant_id,
        tenant.slug AS tenant_slug,
        tenant.name AS tenant_name,
        td.domain AS tenant_domain,
        ar.employee_tenant_user_id,
        employee.name AS employee_name,
        employee.email AS employee_email,
        employee.status AS employee_status,
        employee.login_status AS employee_login_status,
        ar.assigned_manager_tenant_user_id,
        manager.name AS assigned_manager_name,
        manager.email AS manager_email,
        manager.status AS manager_status,
        manager.login_status AS manager_login_status,
        at.name AS absence_type_name,
        ar.duration_type,
        ar.day_part,
        ar.start_date,
        ar.end_date,
        ar.start_time,
        ar.end_time,
        ar.timezone,
        ar.status,
        ar.submitted_at,
        ar.cancelled_at,
        ar.special_window_id,
        sw.name AS special_window_name
      FROM absence_request ar
      JOIN tenant
        ON tenant.id = ar.tenant_id
      JOIN tenant_user employee
        ON employee.tenant_id = ar.tenant_id
       AND employee.id = ar.employee_tenant_user_id
      JOIN absence_type at
        ON at.tenant_id = ar.tenant_id
       AND at.id = ar.absence_type_id
      LEFT JOIN tenant_user manager
        ON manager.tenant_id = ar.tenant_id
       AND manager.id = ar.assigned_manager_tenant_user_id
      LEFT JOIN absence_special_window sw
        ON sw.tenant_id = ar.tenant_id
       AND sw.id = ar.special_window_id
      LEFT JOIN LATERAL (
        SELECT domain
        FROM tenant_domain
        WHERE tenant_id = ar.tenant_id
          AND active = true
          AND verified = true
        ORDER BY created_at DESC
        LIMIT 1
      ) td ON true
      WHERE ar.tenant_id = $1
        AND ar.id = $2
      LIMIT 1
    `,
    [tenantId, absenceRequestId]
  );

  return rows[0] || null;
}

async function findByIdForManager(client, { tenantId, managerTenantUserId, absenceRequestId, forUpdate = false }) {
  const { rows } = await client.query(
    `
      SELECT
        ar.id,
        ar.tenant_id,
        ar.employee_tenant_user_id,
        employee.name AS employee_name,
        employee.email AS employee_email,
        employee.status AS employee_status,
        employee.login_status AS employee_login_status,
        ar.employee_fitter_id,
        ar.absence_type_id,
        at.key AS absence_type_key,
        at.name AS absence_type_name,
        at.workflow_mode AS absence_type_workflow_mode,
        at.comment_policy AS absence_type_comment_policy,
        at.visibility_policy AS absence_type_visibility_policy,
        at.allowed_duration_types AS absence_type_allowed_duration_types,
        at.special_window_eligible AS absence_type_special_window_eligible,
        at.is_active AS absence_type_is_active,
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
        ar.special_window_id,
        sw.key AS special_window_key,
        sw.name AS special_window_name,
        sw.review_start_date AS special_window_review_start_date,
        sw.submission_deadline AS special_window_submission_deadline,
        sw.absence_start_date AS special_window_absence_start_date,
        sw.absence_end_date AS special_window_absence_end_date,
        sw.approval_blocked_before_review AS special_window_approval_blocked_before_review,
        sw.is_active AS special_window_is_active,
        ar.submitted_at,
        ar.reviewed_at,
        ar.cancelled_at,
        ar.version,
        ar.created_at,
        ar.updated_at
      FROM absence_request ar
      JOIN tenant_user employee
        ON employee.tenant_id = ar.tenant_id
       AND employee.id = ar.employee_tenant_user_id
      JOIN tenant_user manager
        ON manager.tenant_id = ar.tenant_id
       AND manager.id = ar.assigned_manager_tenant_user_id
      JOIN absence_type at
        ON at.tenant_id = ar.tenant_id
       AND at.id = ar.absence_type_id
      LEFT JOIN absence_special_window sw
        ON sw.tenant_id = ar.tenant_id
       AND sw.id = ar.special_window_id
      WHERE ar.tenant_id = $1
        AND ar.assigned_manager_tenant_user_id = $2
        AND ar.id = $3
      LIMIT 1
      ${forUpdate ? "FOR UPDATE OF ar" : ""}
    `,
    [tenantId, managerTenantUserId, absenceRequestId]
  );

  return rows[0] || null;
}

async function listForManager(client, {
  tenantId,
  managerTenantUserId,
  statuses,
  dateFrom = null,
  dateTo = null,
  employee = null,
  absenceTypeId = null,
  specialWindowId = null,
  limit = 100,
  offset = 0,
}) {
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
        ar.special_window_id,
        sw.key AS special_window_key,
        sw.name AS special_window_name,
        sw.review_start_date AS special_window_review_start_date,
        sw.submission_deadline AS special_window_submission_deadline,
        ar.submitted_at,
        ar.reviewed_at,
        ar.cancelled_at,
        ar.version,
        ar.created_at,
        ar.updated_at
      FROM absence_request ar
      JOIN tenant_user employee
        ON employee.tenant_id = ar.tenant_id
       AND employee.id = ar.employee_tenant_user_id
      JOIN tenant_user manager
        ON manager.tenant_id = ar.tenant_id
       AND manager.id = ar.assigned_manager_tenant_user_id
      JOIN absence_type at
        ON at.tenant_id = ar.tenant_id
       AND at.id = ar.absence_type_id
      LEFT JOIN absence_special_window sw
        ON sw.tenant_id = ar.tenant_id
       AND sw.id = ar.special_window_id
      WHERE ar.tenant_id = $1
        AND ar.assigned_manager_tenant_user_id = $2
        AND ar.status = ANY($3::text[])
        AND ($4::date IS NULL OR COALESCE(ar.end_date, ar.start_date) >= $4::date)
        AND ($5::date IS NULL OR ar.start_date <= $5::date)
        AND ($6::text IS NULL OR employee.name ILIKE '%' || $6::text || '%')
        AND ($7::uuid IS NULL OR ar.absence_type_id = $7::uuid)
        AND ($8::uuid IS NULL OR ar.special_window_id = $8::uuid)
      ORDER BY ar.submitted_at ASC NULLS LAST, ar.created_at ASC, ar.id ASC
      LIMIT $9
      OFFSET $10
    `,
    [tenantId, managerTenantUserId, statuses, dateFrom, dateTo, employee, absenceTypeId, specialWindowId, limit, offset]
  );

  return rows;
}

async function updateManagedDecision(client, {
  tenantId,
  managerTenantUserId,
  absenceRequestId,
  expectedVersion,
  fromStatuses,
  toStatus,
}) {
  const { rows } = await client.query(
    `
      UPDATE absence_request
      SET
        status = $6,
        reviewed_at = now(),
        version = version + 1
      WHERE tenant_id = $1
        AND assigned_manager_tenant_user_id = $2
        AND id = $3
        AND version = $4
        AND status = ANY($5::text[])
      RETURNING
        id,
        tenant_id,
        employee_tenant_user_id,
        employee_fitter_id,
        absence_type_id,
        duration_type,
        day_part,
        start_date,
        end_date,
        start_time,
        end_time,
        timezone,
        employee_comment,
        status,
        assigned_manager_tenant_user_id,
        special_window_id,
        submitted_at,
        reviewed_at,
        cancelled_at,
        version,
        created_at,
        updated_at
    `,
    [tenantId, managerTenantUserId, absenceRequestId, expectedVersion, fromStatuses, toStatus]
  );

  return rows[0] || null;
}
async function insertEvent(client, {
  tenantId,
  absenceRequestId,
  eventType,
  actorTenantUserId = null,
  oldStatus = null,
  newStatus = null,
  reason = null,
  metadata = {},
}) {
  const { rows } = await client.query(
    `
      INSERT INTO absence_request_event (
        tenant_id,
        absence_request_id,
        event_type,
        actor_tenant_user_id,
        old_status,
        new_status,
        reason,
        metadata_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      RETURNING
        id,
        tenant_id,
        absence_request_id,
        event_type,
        actor_tenant_user_id,
        old_status,
        new_status,
        reason,
        metadata_json,
        created_at
    `,
    [
      tenantId,
      absenceRequestId,
      eventType,
      actorTenantUserId,
      oldStatus,
      newStatus,
      reason,
      JSON.stringify(metadata || {}),
    ]
  );

  return rows[0];
}

async function listEvents(client, { tenantId, absenceRequestId }) {
  const { rows } = await client.query(
    `
      SELECT
        id,
        tenant_id,
        absence_request_id,
        event_type,
        actor_tenant_user_id,
        old_status,
        new_status,
        reason,
        metadata_json,
        created_at
      FROM absence_request_event
      WHERE tenant_id = $1
        AND absence_request_id = $2
      ORDER BY created_at ASC, id ASC
    `,
    [tenantId, absenceRequestId]
  );

  return rows;
}

module.exports = {
  acquireIdempotencyLock,
  cancelForEmployee,
  findById,
  findByIdForEmployee,
  findByIdForManager,
  findCreatedByIdempotencyKey,
  findNotificationContextById,
  insertEvent,
  insertRequest,
  listEvents,
  listForEmployee,
  listForManager,
  submitDraftForEmployee,
  updateDraftForEmployee,
  updateManagedDecision,
};
