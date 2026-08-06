"use strict";

async function insertFromAbsenceRequest(client, {
  tenantId,
  absenceRequest,
  approvedByTenantUserId,
}) {
  const { rows } = await client.query(
    `
      INSERT INTO approved_absence (
        tenant_id,
        employee_tenant_user_id,
        employee_fitter_id,
        source_type,
        source_id,
        absence_request_id,
        absence_type_id,
        duration_type,
        start_date,
        end_date,
        start_time,
        end_time,
        timezone,
        status,
        visibility_policy,
        approved_by_tenant_user_id,
        approved_at
      )
      VALUES (
        $1,
        $2,
        $3,
        'absence_request',
        $4,
        $4,
        $5,
        $6,
        $7::date,
        $8::date,
        $9::time,
        $10::time,
        $11,
        'active',
        $12,
        $13,
        $14::timestamptz
      )
      ON CONFLICT (tenant_id, source_type, source_id) DO NOTHING
      RETURNING
        id,
        tenant_id,
        employee_tenant_user_id,
        employee_fitter_id,
        source_type,
        source_id,
        absence_request_id,
        absence_type_id,
        duration_type,
        start_date,
        end_date,
        start_time,
        end_time,
        timezone,
        status,
        visibility_policy,
        approved_by_tenant_user_id,
        approved_at,
        created_at,
        updated_at,
        version
    `,
    [
      tenantId,
      absenceRequest.employee_tenant_user_id,
      absenceRequest.employee_fitter_id || null,
      absenceRequest.id,
      absenceRequest.absence_type_id,
      absenceRequest.duration_type,
      absenceRequest.start_date,
      absenceRequest.end_date || null,
      absenceRequest.start_time || null,
      absenceRequest.end_time || null,
      absenceRequest.timezone,
      absenceRequest.absence_type_visibility_policy,
      approvedByTenantUserId,
      absenceRequest.reviewed_at,
    ]
  );

  return rows[0] || null;
}

async function findBySource(client, { tenantId, sourceType, sourceId }) {
  const { rows } = await client.query(
    `
      SELECT
        id,
        tenant_id,
        employee_tenant_user_id,
        employee_fitter_id,
        source_type,
        source_id,
        absence_request_id,
        absence_type_id,
        duration_type,
        start_date,
        end_date,
        start_time,
        end_time,
        timezone,
        status,
        visibility_policy,
        approved_by_tenant_user_id,
        approved_at,
        created_at,
        updated_at,
        version
      FROM approved_absence
      WHERE tenant_id = $1
        AND source_type = $2
        AND source_id = $3
      LIMIT 1
    `,
    [tenantId, sourceType, sourceId]
  );

  return rows[0] || null;
}

module.exports = {
  findBySource,
  insertFromAbsenceRequest,
};
