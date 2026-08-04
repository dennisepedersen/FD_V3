"use strict";

async function findActiveManagersForEmployee(client, {
  tenantId,
  employeeTenantUserId,
  asOfDate,
}) {
  const { rows } = await client.query(
    `
      SELECT
        id,
        tenant_id,
        employee_tenant_user_id,
        manager_tenant_user_id,
        relation_type,
        valid_from,
        valid_to,
        is_active,
        created_at,
        updated_at
      FROM employee_manager_relation
      WHERE tenant_id = $1
        AND employee_tenant_user_id = $2
        AND is_active = true
        AND valid_from <= $3::date
        AND (valid_to IS NULL OR valid_to >= $3::date)
      ORDER BY
        CASE relation_type
          WHEN 'primary' THEN 0
          WHEN 'secondary' THEN 1
          ELSE 2
        END,
        valid_from DESC,
        created_at ASC
    `,
    [tenantId, employeeTenantUserId, asOfDate]
  );

  return rows;
}

async function insertRelation(client, {
  tenantId,
  employeeTenantUserId,
  managerTenantUserId,
  relationType = "primary",
  validFrom,
  validTo = null,
  actorUserId = null,
}) {
  const { rows } = await client.query(
    `
      INSERT INTO employee_manager_relation (
        tenant_id,
        employee_tenant_user_id,
        manager_tenant_user_id,
        relation_type,
        valid_from,
        valid_to,
        created_by_tenant_user_id,
        updated_by_tenant_user_id
      )
      VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $7)
      RETURNING
        id,
        tenant_id,
        employee_tenant_user_id,
        manager_tenant_user_id,
        relation_type,
        valid_from,
        valid_to,
        is_active,
        created_at,
        updated_at
    `,
    [
      tenantId,
      employeeTenantUserId,
      managerTenantUserId,
      relationType,
      validFrom,
      validTo,
      actorUserId,
    ]
  );

  return rows[0];
}

module.exports = {
  findActiveManagersForEmployee,
  insertRelation,
};
