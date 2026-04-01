async function createTenantAdminUser(client, { tenantId, email, name, passwordHash, username }) {
  const sql = `
    INSERT INTO tenant_user (tenant_id, email, name, role, status, password_hash, username)
    VALUES ($1, $2, $3, 'tenant_admin', 'active', $4, $5)
    RETURNING id, tenant_id, email, role, status, username
  `;
  const { rows } = await client.query(sql, [
    tenantId,
    email.toLowerCase(),
    name,
    passwordHash,
    username ? String(username).toLowerCase().trim() : null,
  ]);
  return rows[0];
}

async function findActiveUserByUsername(client, { tenantId, username }) {
  const sql = `
    SELECT id, tenant_id, email, name, role, status, password_hash, username
    FROM tenant_user
    WHERE tenant_id = $1
      AND lower(username) = lower($2)
      AND status = 'active'
    LIMIT 1
  `;
  const { rows } = await client.query(sql, [tenantId, username]);
  return rows[0] || null;
}

async function findTenantUserById(client, { tenantId, userId }) {
  const sql = `
    SELECT id, tenant_id, email, name, role, status
    FROM tenant_user
    WHERE tenant_id = $1
      AND id = $2
    LIMIT 1
  `;

  const { rows } = await client.query(sql, [tenantId, userId]);
  return rows[0] || null;
}

async function findActiveUserByEmail(client, { tenantId, email }) {
  const sql = `
    SELECT id, tenant_id, email, name, role, status, password_hash
    FROM tenant_user
    WHERE tenant_id = $1
      AND lower(email) = lower($2)
      AND status = 'active'
    LIMIT 1
  `;
  const { rows } = await client.query(sql, [tenantId, email]);
  return rows[0] || null;
}

module.exports = {
  createTenantAdminUser,
  findTenantUserById,
  findActiveUserByEmail,
  findActiveUserByUsername,
};
