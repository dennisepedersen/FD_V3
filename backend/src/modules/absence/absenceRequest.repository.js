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

async function listForEmployee(client, { tenantId, employeeTenantUserId, limit = 100 }) {
  const { rows } = await client.query(
    `
      SELECT
        id,
        tenant_id,
        employee_tenant_user_id,
        absence_type_id,
        duration_type,
        day_part,
        start_date,
        end_date,
        start_time,
        end_time,
        timezone,
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
        AND employee_tenant_user_id = $2
      ORDER BY created_at DESC, id DESC
      LIMIT $3
    `,
    [tenantId, employeeTenantUserId, limit]
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
  findById,
  insertEvent,
  insertRequest,
  listEvents,
  listForEmployee,
};
