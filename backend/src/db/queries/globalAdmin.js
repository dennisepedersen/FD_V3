async function lockGlobalAdminTable(client) {
  await client.query("LOCK TABLE global_admin_user IN EXCLUSIVE MODE");
}

async function countGlobalAdmins(client) {
  const { rows } = await client.query("SELECT COUNT(*)::int AS count FROM global_admin_user");
  return rows[0]?.count || 0;
}

async function createGlobalAdminUser(client, { username, passwordHash, displayName, bootstrapCreated }) {
  const sql = `
    INSERT INTO global_admin_user (
      username,
      password_hash,
      display_name,
      is_active,
      bootstrap_created,
      last_login_at
    )
    VALUES ($1, $2, $3, true, $4, now())
    RETURNING id, username, display_name, is_active, bootstrap_created, last_login_at
  `;

  const { rows } = await client.query(sql, [
    String(username).trim().toLowerCase(),
    passwordHash,
    String(displayName).trim(),
    Boolean(bootstrapCreated),
  ]);
  return rows[0] || null;
}

async function findActiveGlobalAdminByUsername(client, { username }) {
  const sql = `
    SELECT id, username, password_hash, display_name, is_active, bootstrap_created, last_login_at
    FROM global_admin_user
    WHERE lower(username) = lower($1)
      AND is_active = true
    LIMIT 1
  `;
  const { rows } = await client.query(sql, [String(username).trim()]);
  return rows[0] || null;
}

async function findActiveGlobalAdminById(client, { id }) {
  const sql = `
    SELECT id, username, password_hash, display_name, is_active, bootstrap_created, last_login_at
    FROM global_admin_user
    WHERE id = $1
      AND is_active = true
    LIMIT 1
  `;
  const { rows } = await client.query(sql, [id]);
  return rows[0] || null;
}

async function touchGlobalAdminLastLogin(client, { userId }) {
  const sql = `
    UPDATE global_admin_user
    SET last_login_at = now(), updated_at = now()
    WHERE id = $1
    RETURNING id, username, display_name, is_active, bootstrap_created, last_login_at
  `;
  const { rows } = await client.query(sql, [userId]);
  return rows[0] || null;
}

module.exports = {
  lockGlobalAdminTable,
  countGlobalAdmins,
  createGlobalAdminUser,
  findActiveGlobalAdminByUsername,
  findActiveGlobalAdminById,
  touchGlobalAdminLastLogin,
};