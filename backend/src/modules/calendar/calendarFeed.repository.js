"use strict";

const SELECT_APPROVED_ABSENCE_EVENT = `
  SELECT
    aa.id,
    aa.tenant_id,
    aa.employee_tenant_user_id,
    employee.name AS employee_name,
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
      ${SELECT_APPROVED_ABSENCE_EVENT}
      WHERE aa.tenant_id = $1
        AND aa.employee_tenant_user_id = $2
        AND aa.status = 'active'
        AND ${overlapPredicate("aa")}
      ORDER BY aa.start_date ASC, aa.start_time ASC NULLS FIRST, aa.id ASC
      LIMIT $5
      OFFSET $6
    `,
    [tenantId, employeeTenantUserId, from, to, limit, offset]
  );

  return rows;
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
      ORDER BY aa.start_date ASC, aa.start_time ASC NULLS FIRST, employee.name ASC NULLS LAST, aa.id ASC
      LIMIT $5
      OFFSET $6
    `,
    [tenantId, managerTenantUserId, from, to, limit, offset]
  );

  return rows;
}

module.exports = {
  listManagedApprovedAbsenceEvents,
  listOwnApprovedAbsenceEvents,
  _test: {
    overlapPredicate,
  },
};
