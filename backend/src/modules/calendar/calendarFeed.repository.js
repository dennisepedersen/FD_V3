"use strict";

const SELECT_APPROVED_ABSENCE_EVENT = `
  SELECT
    aa.id,
    aa.tenant_id,
    aa.employee_tenant_user_id,
    employee.name AS employee_name,
    employee.username AS employee_username,
    aa.employee_fitter_id,
    aa.source_type,
    aa.source_id,
    aa.absence_request_id,
    aa.absence_type_id,
    at.name AS absence_type_name,
    at.key AS absence_type_key,
    aa.duration_type,
    aa.start_date,
    aa.end_date,
    aa.start_time,
    aa.end_time,
    aa.timezone,
    aa.status,
    aa.visibility_policy,
    aa.approved_by_tenant_user_id,
    aa.approved_at,
    aa.created_at,
    aa.updated_at
  FROM approved_absence aa
  JOIN tenant_user employee
    ON employee.tenant_id = aa.tenant_id
   AND employee.id = aa.employee_tenant_user_id
  JOIN absence_type at
    ON at.tenant_id = aa.tenant_id
   AND at.id = aa.absence_type_id
`;
const SELECT_DIRECT_ABSENCE_EVENT = `
  SELECT
    ra.id,
    ra.tenant_id,
    f.tenant_user_id AS employee_tenant_user_id,
    employee.name AS employee_name,
    employee.username AS employee_username,
    ra.fitter_id AS employee_fitter_id,
    COALESCE(ra.source_type, 'legacy_resource_absence') AS source_type,
    ra.id AS source_id,
    NULL::uuid AS absence_request_id,
    NULL::uuid AS absence_type_id,
    CASE ra.absence_type
      WHEN 'vacation' THEN 'Ferie'
      WHEN 'vacation_free' THEN 'Feriefri'
      WHEN 'course' THEN 'Kursus'
      WHEN 'sickness' THEN 'Sygdom'
      ELSE 'Andet'
    END AS absence_type_name,
    ra.absence_type AS absence_type_key,
    'full_days'::text AS duration_type,
    ra.start_date,
    ra.end_date,
    NULL::time AS start_time,
    NULL::time AS end_time,
    'Europe/Copenhagen'::text AS timezone,
    'active'::text AS status,
    CASE WHEN ra.absence_type = 'sickness' OR ra.visibility_scope = 'manager_full' THEN 'manager_visible' ELSE 'private' END AS visibility_policy,
    ra.created_by_user_id AS approved_by_tenant_user_id,
    ra.created_at AS approved_at,
    ra.created_at,
    ra.updated_at
  FROM resource_absences ra
  JOIN fitter f
    ON f.tenant_id = ra.tenant_id
   AND f.fitter_id = ra.fitter_id
   AND f.tenant_user_id IS NOT NULL
  JOIN tenant_user employee
    ON employee.tenant_id = ra.tenant_id
   AND employee.id = f.tenant_user_id
`;
function overlapPredicate(alias = "aa") {
  return `COALESCE(${alias}.end_date, ${alias}.start_date) >= $3::date AND ${alias}.start_date <= $4::date`;
}

async function listOwnApprovedAbsenceEvents(client, {
  tenantId,
  employeeTenantUserId,
  from,
  to,
  limit,
  offset,
}) {
  const { rows } = await client.query(
    `
      SELECT * FROM (
        ${SELECT_APPROVED_ABSENCE_EVENT}
        WHERE aa.tenant_id = $1
          AND aa.employee_tenant_user_id = $2
          AND aa.status = 'active'
          AND ${overlapPredicate("aa")}
        UNION ALL
        ${SELECT_DIRECT_ABSENCE_EVENT}
        WHERE ra.tenant_id = $1
          AND f.tenant_user_id = $2
          AND employee.status = 'active'
          AND employee.login_status = 'active'
          AND ra.status = 'approved'
          AND ${overlapPredicate("ra")}
      ) events
      ORDER BY start_date ASC, start_time ASC NULLS FIRST, id ASC
      LIMIT $5
      OFFSET $6
    `,
    [tenantId, employeeTenantUserId, from, to, limit, offset]
  );

  return rows;
}

async function hasActiveManagedTeamScope(client, {
  tenantId,
  managerTenantUserId,
}) {
  const { rows } = await client.query(
    `
      SELECT 1
      FROM employee_manager_relation emr
      JOIN tenant_user employee
        ON employee.tenant_id = emr.tenant_id
       AND employee.id = emr.employee_tenant_user_id
      WHERE emr.tenant_id = $1
        AND emr.manager_tenant_user_id = $2
        AND emr.relation_type = 'primary'
        AND emr.is_active = true
        AND emr.valid_from <= CURRENT_DATE
        AND (emr.valid_to IS NULL OR emr.valid_to >= CURRENT_DATE)
        AND employee.status = 'active'
        AND employee.login_status = 'active'
      LIMIT 1
    `,
    [tenantId, managerTenantUserId]
  );

  return rows.length > 0;
}

async function listManagedApprovedAbsenceEvents(client, {
  tenantId,
  managerTenantUserId,
  from,
  to,
  limit,
  offset,
}) {
  const { rows } = await client.query(
    `
      SELECT * FROM (
        ${SELECT_APPROVED_ABSENCE_EVENT}
        JOIN employee_manager_relation emr
          ON emr.tenant_id = aa.tenant_id
         AND emr.employee_tenant_user_id = aa.employee_tenant_user_id
         AND emr.manager_tenant_user_id = $2
         AND emr.relation_type = 'primary'
         AND emr.is_active = true
         AND emr.valid_from <= CURRENT_DATE
         AND (emr.valid_to IS NULL OR emr.valid_to >= CURRENT_DATE)
        WHERE aa.tenant_id = $1
          AND employee.status = 'active'
          AND employee.login_status = 'active'
          AND aa.status = 'active'
          AND ${overlapPredicate("aa")}
        UNION ALL
        ${SELECT_DIRECT_ABSENCE_EVENT}
        JOIN employee_manager_relation emr
          ON emr.tenant_id = ra.tenant_id
         AND emr.employee_tenant_user_id = f.tenant_user_id
         AND emr.manager_tenant_user_id = $2
         AND emr.relation_type = 'primary'
         AND emr.is_active = true
         AND emr.valid_from <= CURRENT_DATE
         AND (emr.valid_to IS NULL OR emr.valid_to >= CURRENT_DATE)
        WHERE ra.tenant_id = $1
          AND employee.status = 'active'
          AND employee.login_status = 'active'
          AND ra.status = 'approved'
          AND ${overlapPredicate("ra")}
      ) events
      ORDER BY start_date ASC, start_time ASC NULLS FIRST, employee_name ASC NULLS LAST, id ASC
      LIMIT $5
      OFFSET $6
    `,
    [tenantId, managerTenantUserId, from, to, limit, offset]
  );

  return rows;
}

module.exports = {
  hasActiveManagedTeamScope,
  listManagedApprovedAbsenceEvents,
  listOwnApprovedAbsenceEvents,
  _test: {
    overlapPredicate,
  },
};
