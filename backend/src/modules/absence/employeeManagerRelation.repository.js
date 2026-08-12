"use strict";

async function findActiveManagersForEmployee(client, {
  tenantId,
  employeeTenantUserId,
  asOfDate,
}) {
  const { rows } = await client.query(
    `
      SELECT
        emr.id,
        emr.tenant_id,
        emr.employee_tenant_user_id,
        emr.manager_tenant_user_id,
        manager.name AS manager_name,
        manager.email AS manager_email,
        manager.status AS manager_status,
        manager.login_status AS manager_login_status,
        emr.relation_type,
        emr.valid_from,
        emr.valid_to,
        emr.is_active,
        emr.created_at,
        emr.updated_at
      FROM employee_manager_relation emr
      JOIN tenant_user manager
        ON manager.tenant_id = emr.tenant_id
       AND manager.id = emr.manager_tenant_user_id
      WHERE emr.tenant_id = $1
        AND emr.employee_tenant_user_id = $2
        AND emr.is_active = true
        AND emr.valid_from <= $3::date
        AND (emr.valid_to IS NULL OR emr.valid_to >= $3::date)
      ORDER BY
        CASE emr.relation_type
          WHEN 'primary' THEN 0
          WHEN 'delegate' THEN 1
          WHEN 'secondary' THEN 2
          ELSE 3
        END,
        emr.valid_from DESC,
        emr.created_at ASC
    `,
    [tenantId, employeeTenantUserId, asOfDate]
  );

  return rows;
}

async function findActivePrimaryManagersForEmployee(client, {
  tenantId,
  employeeTenantUserId,
  asOfDate,
}) {
  const { rows } = await client.query(
    `
      SELECT
        emr.id,
        emr.tenant_id,
        emr.employee_tenant_user_id,
        emr.manager_tenant_user_id,
        manager.name AS manager_name,
        manager.email AS manager_email,
        manager.status AS manager_status,
        manager.login_status AS manager_login_status,
        emr.relation_type,
        emr.valid_from,
        emr.valid_to,
        emr.is_active,
        emr.created_at,
        emr.updated_at
      FROM employee_manager_relation emr
      JOIN tenant_user manager
        ON manager.tenant_id = emr.tenant_id
       AND manager.id = emr.manager_tenant_user_id
      WHERE emr.tenant_id = $1
        AND emr.employee_tenant_user_id = $2
        AND emr.relation_type = 'primary'
        AND emr.is_active = true
        AND emr.valid_from <= $3::date
        AND (emr.valid_to IS NULL OR emr.valid_to >= $3::date)
        AND manager.status = 'active'
        AND manager.login_status = 'active'
      ORDER BY emr.valid_from DESC, emr.created_at ASC
    `,
    [tenantId, employeeTenantUserId, asOfDate]
  );

  return rows;
}

async function findCurrentPrimaryForEmployee(client, {
  tenantId,
  employeeTenantUserId,
  asOfDate,
}) {
  const { rows } = await client.query(
    `
      SELECT
        emr.id,
        emr.tenant_id,
        emr.employee_tenant_user_id,
        emr.manager_tenant_user_id,
        manager.name AS manager_name,
        manager.email AS manager_email,
        manager.status AS manager_status,
        manager.login_status AS manager_login_status,
        emr.relation_type,
        emr.valid_from,
        emr.valid_to,
        emr.is_active,
        emr.created_at,
        emr.updated_at
      FROM employee_manager_relation emr
      JOIN tenant_user manager
        ON manager.tenant_id = emr.tenant_id
       AND manager.id = emr.manager_tenant_user_id
      WHERE emr.tenant_id = $1
        AND emr.employee_tenant_user_id = $2
        AND emr.relation_type = 'primary'
        AND emr.is_active = true
        AND emr.valid_from <= $3::date
        AND (emr.valid_to IS NULL OR emr.valid_to >= $3::date)
      ORDER BY emr.valid_from DESC, emr.created_at ASC
      LIMIT 1
    `,
    [tenantId, employeeTenantUserId, asOfDate]
  );

  return rows[0] || null;
}

async function endActivePrimaryRelationsForEmployee(client, {
  tenantId,
  employeeTenantUserId,
  actorUserId,
  validTo,
}) {
  const { rows } = await client.query(
    `
      UPDATE employee_manager_relation
      SET
        is_active = false,
        valid_to = GREATEST(valid_from, $4::date),
        updated_by_tenant_user_id = $3,
        updated_at = now()
      WHERE tenant_id = $1
        AND employee_tenant_user_id = $2
        AND relation_type = 'primary'
        AND is_active = true
        AND (valid_to IS NULL OR valid_to >= $4::date)
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
    [tenantId, employeeTenantUserId, actorUserId, validTo]
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
  endActivePrimaryRelationsForEmployee,
  findActiveManagersForEmployee,
  findActivePrimaryManagersForEmployee,
  findCurrentPrimaryForEmployee,
  insertRelation,
};