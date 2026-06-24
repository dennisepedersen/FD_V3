async function listGroups(client, { tenantId, includeArchived = false }) {
  const { rows } = await client.query(
    `
      SELECT
        id,
        tenant_id,
        name,
        description,
        status,
        created_by_user_id,
        updated_by_user_id,
        created_at,
        updated_at
      FROM resource_groups
      WHERE tenant_id = $1
        AND ($2::boolean = true OR status = 'active')
      ORDER BY
        CASE WHEN status = 'active' THEN 0 ELSE 1 END,
        name ASC,
        created_at ASC
    `,
    [tenantId, includeArchived === true]
  );

  return rows;
}

async function findGroupById(client, { tenantId, groupId }) {
  const { rows } = await client.query(
    `
      SELECT
        id,
        tenant_id,
        name,
        description,
        status,
        created_by_user_id,
        updated_by_user_id,
        created_at,
        updated_at
      FROM resource_groups
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, groupId]
  );

  return rows[0] || null;
}

async function createGroup(client, {
  tenantId,
  name,
  description = null,
  createdByUserId = null,
  updatedByUserId = null,
}) {
  const { rows } = await client.query(
    `
      INSERT INTO resource_groups (
        tenant_id,
        name,
        description,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING
        id,
        tenant_id,
        name,
        description,
        status,
        created_by_user_id,
        updated_by_user_id,
        created_at,
        updated_at
    `,
    [tenantId, name, description, createdByUserId, updatedByUserId]
  );

  return rows[0];
}

async function updateGroup(client, {
  tenantId,
  groupId,
  name,
  description,
  hasDescription = false,
  status,
  updatedByUserId = null,
}) {
  const { rows } = await client.query(
    `
      UPDATE resource_groups
      SET
        name = COALESCE($3, name),
        description = CASE WHEN $4::boolean THEN $5 ELSE description END,
        status = COALESCE($6, status),
        updated_by_user_id = $7
      WHERE tenant_id = $1
        AND id = $2
      RETURNING
        id,
        tenant_id,
        name,
        description,
        status,
        created_by_user_id,
        updated_by_user_id,
        created_at,
        updated_at
    `,
    [
      tenantId,
      groupId,
      name,
      hasDescription === true,
      description,
      status,
      updatedByUserId,
    ]
  );

  return rows[0] || null;
}

async function findFitterById(client, { tenantId, fitterId }) {
  const { rows } = await client.query(
    `
      SELECT fitter_id
      FROM fitter
      WHERE tenant_id = $1
        AND fitter_id = $2
      LIMIT 1
    `,
    [tenantId, fitterId]
  );

  return rows[0] || null;
}

async function findTenantUserById(client, { tenantId, tenantUserId }) {
  const { rows } = await client.query(
    `
      SELECT id
      FROM tenant_user
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, tenantUserId]
  );

  return rows[0] || null;
}

async function listMemberResourceOptions(client, { tenantId, includeInactive = false }) {
  const { rows } = await client.query(
    `
      SELECT
        id,
        fitter_id,
        name,
        username,
        email,
        UPPER(
          LEFT(
            REGEXP_REPLACE(
              COALESCE(NULLIF(btrim(name), ''), NULLIF(btrim(username), ''), fitter_id),
              '[^[:alnum:]]',
              '',
              'g'
            ),
            4
          )
        ) AS initials,
        COALESCE(NULLIF(btrim(name), ''), NULLIF(btrim(username), ''), fitter_id) AS label,
        is_active_derived AS is_active,
        is_plannable,
        end_date,
        CASE
          WHEN is_active_derived IS TRUE THEN 'active'
          WHEN end_date IS NOT NULL AND end_date::date < CURRENT_DATE THEN 'ended'
          WHEN is_active_derived IS FALSE THEN 'inactive'
          ELSE 'unknown'
        END AS status,
        'fitter' AS source
      FROM fitter
      WHERE tenant_id = $1
        AND ($2::boolean = true OR is_active_derived IS TRUE)
      ORDER BY
        CASE
          WHEN is_active_derived IS TRUE THEN 0
          WHEN is_active_derived IS NULL THEN 1
          ELSE 2
        END,
        COALESCE(NULLIF(btrim(name), ''), NULLIF(btrim(username), ''), fitter_id) ASC,
        fitter_id ASC
    `,
    [tenantId, includeInactive === true]
  );

  return rows;
}

async function listMembers(client, { tenantId, groupId }) {
  const { rows } = await client.query(
    `
      SELECT
        rgm.id,
        rgm.tenant_id,
        rgm.group_id,
        rgm.fitter_id,
        f.name,
        f.username,
        f.email,
        UPPER(
          LEFT(
            REGEXP_REPLACE(
              COALESCE(NULLIF(btrim(f.name), ''), NULLIF(btrim(f.username), ''), rgm.fitter_id),
              '[^[:alnum:]]',
              '',
              'g'
            ),
            4
          )
        ) AS initials,
        COALESCE(NULLIF(btrim(f.name), ''), NULLIF(btrim(f.username), ''), rgm.fitter_id) AS label,
        f.is_active_derived AS is_active,
        f.is_plannable,
        f.end_date,
        rgm.is_primary,
        rgm.created_by_user_id,
        rgm.updated_by_user_id,
        rgm.created_at,
        rgm.updated_at
      FROM resource_group_members rgm
      JOIN fitter f
        ON f.tenant_id = rgm.tenant_id
       AND f.fitter_id = rgm.fitter_id
      WHERE rgm.tenant_id = $1
        AND rgm.group_id = $2
      ORDER BY
        COALESCE(NULLIF(btrim(f.name), ''), NULLIF(btrim(f.username), ''), rgm.fitter_id) ASC,
        rgm.fitter_id ASC
    `,
    [tenantId, groupId]
  );

  return rows;
}

async function addMember(client, {
  tenantId,
  groupId,
  fitterId,
  isPrimary = false,
  createdByUserId = null,
  updatedByUserId = null,
}) {
  const { rows } = await client.query(
    `
      INSERT INTO resource_group_members (
        tenant_id,
        group_id,
        fitter_id,
        is_primary,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING
        id,
        tenant_id,
        group_id,
        fitter_id,
        is_primary,
        created_by_user_id,
        updated_by_user_id,
        created_at,
        updated_at
    `,
    [tenantId, groupId, fitterId, isPrimary === true, createdByUserId, updatedByUserId]
  );

  return rows[0];
}

async function updateMember(client, {
  tenantId,
  groupId,
  fitterId,
  isPrimary,
  updatedByUserId = null,
}) {
  const { rows } = await client.query(
    `
      UPDATE resource_group_members
      SET
        is_primary = $4,
        updated_by_user_id = $5
      WHERE tenant_id = $1
        AND group_id = $2
        AND fitter_id = $3
      RETURNING
        id,
        tenant_id,
        group_id,
        fitter_id,
        is_primary,
        created_by_user_id,
        updated_by_user_id,
        created_at,
        updated_at
    `,
    [tenantId, groupId, fitterId, isPrimary === true, updatedByUserId]
  );

  return rows[0] || null;
}

async function removeMember(client, { tenantId, groupId, fitterId }) {
  const { rows } = await client.query(
    `
      DELETE FROM resource_group_members
      WHERE tenant_id = $1
        AND group_id = $2
        AND fitter_id = $3
      RETURNING id, tenant_id, group_id, fitter_id
    `,
    [tenantId, groupId, fitterId]
  );

  return rows[0] || null;
}

async function listManagers(client, { tenantId, groupId }) {
  const { rows } = await client.query(
    `
      SELECT
        rgm.id,
        rgm.tenant_id,
        rgm.group_id,
        rgm.tenant_user_id,
        tu.name,
        tu.email,
        tu.role AS tenant_user_role,
        tu.status AS tenant_user_status,
        rgm.manager_role,
        rgm.created_by_user_id,
        rgm.updated_by_user_id,
        rgm.created_at,
        rgm.updated_at
      FROM resource_group_managers rgm
      JOIN tenant_user tu
        ON tu.tenant_id = rgm.tenant_id
       AND tu.id = rgm.tenant_user_id
      WHERE rgm.tenant_id = $1
        AND rgm.group_id = $2
      ORDER BY
        CASE rgm.manager_role
          WHEN 'owner' THEN 0
          WHEN 'manager' THEN 1
          ELSE 2
        END,
        tu.name ASC NULLS LAST,
        tu.email ASC
    `,
    [tenantId, groupId]
  );

  return rows;
}

async function addManager(client, {
  tenantId,
  groupId,
  tenantUserId,
  managerRole,
  createdByUserId = null,
  updatedByUserId = null,
}) {
  const { rows } = await client.query(
    `
      INSERT INTO resource_group_managers (
        tenant_id,
        group_id,
        tenant_user_id,
        manager_role,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING
        id,
        tenant_id,
        group_id,
        tenant_user_id,
        manager_role,
        created_by_user_id,
        updated_by_user_id,
        created_at,
        updated_at
    `,
    [tenantId, groupId, tenantUserId, managerRole, createdByUserId, updatedByUserId]
  );

  return rows[0];
}

async function updateManager(client, {
  tenantId,
  groupId,
  tenantUserId,
  managerRole,
  updatedByUserId = null,
}) {
  const { rows } = await client.query(
    `
      UPDATE resource_group_managers
      SET
        manager_role = $4,
        updated_by_user_id = $5
      WHERE tenant_id = $1
        AND group_id = $2
        AND tenant_user_id = $3
      RETURNING
        id,
        tenant_id,
        group_id,
        tenant_user_id,
        manager_role,
        created_by_user_id,
        updated_by_user_id,
        created_at,
        updated_at
    `,
    [tenantId, groupId, tenantUserId, managerRole, updatedByUserId]
  );

  return rows[0] || null;
}

async function removeManager(client, { tenantId, groupId, tenantUserId }) {
  const { rows } = await client.query(
    `
      DELETE FROM resource_group_managers
      WHERE tenant_id = $1
        AND group_id = $2
        AND tenant_user_id = $3
      RETURNING id, tenant_id, group_id, tenant_user_id
    `,
    [tenantId, groupId, tenantUserId]
  );

  return rows[0] || null;
}

module.exports = {
  addManager,
  addMember,
  createGroup,
  findFitterById,
  findGroupById,
  findTenantUserById,
  listGroups,
  listMemberResourceOptions,
  listManagers,
  listMembers,
  removeManager,
  removeMember,
  updateGroup,
  updateManager,
  updateMember,
};
