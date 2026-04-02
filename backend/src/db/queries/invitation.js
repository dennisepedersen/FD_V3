async function createInvitation(client, {
  email,
  tokenHash,
  expiresAt,
  companyName,
  desiredSlug,
  adminName,
  allowSkipEk,
  invitationNote,
}) {
  const sql = `
    INSERT INTO tenant_invitation (
      email,
      token_hash,
      expires_at,
      status,
      company_name,
      desired_slug,
      admin_name,
      allow_skip_ek,
      invitation_note
    )
    VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8)
    RETURNING id, email, status, expires_at, created_at, company_name, desired_slug, admin_name, allow_skip_ek, invitation_note
  `;

  const { rows } = await client.query(sql, [
    email.toLowerCase(),
    tokenHash,
    expiresAt,
    companyName || null,
    desiredSlug || null,
    adminName || null,
    Boolean(allowSkipEk),
    invitationNote || null,
  ]);
  return rows[0];
}

async function findInvitationByIdForUpdate(client, invitationId) {
  const sql = `
    SELECT id, email, status, expires_at, tenant_id, created_at, accepted_at, revoked_at,
           company_name, desired_slug, admin_name, allow_skip_ek, invitation_note
    FROM tenant_invitation
    WHERE id = $1
    FOR UPDATE
  `;
  const { rows } = await client.query(sql, [invitationId]);
  return rows[0] || null;
}

async function findInvitationByTokenHashForUpdate(client, tokenHash) {
  const sql = `
    SELECT id, email, status, expires_at, tenant_id, created_at, accepted_at, revoked_at,
           company_name, desired_slug, admin_name, allow_skip_ek, invitation_note
    FROM tenant_invitation
    WHERE token_hash = $1
    FOR UPDATE
  `;
  const { rows } = await client.query(sql, [tokenHash]);
  return rows[0] || null;
}

async function listInvitations(client, { status } = {}) {
  const params = [];
  let where = "";
  if (status) {
    params.push(status);
    where = `WHERE status = $1`;
  }
  const sql = `
    SELECT id, email, status, expires_at, tenant_id, created_at, accepted_at,
        company_name, desired_slug, admin_name, allow_skip_ek, invitation_note
    FROM tenant_invitation
    ${where}
    ORDER BY created_at DESC
    LIMIT 200
  `;
  const { rows } = await client.query(sql, params);
  return rows;
}

async function getInvitationStatusById(client, invitationId) {
  const sql = `
    SELECT
      i.id,
      i.email,
      i.status,
      i.expires_at,
      i.created_at,
      i.accepted_at,
      i.revoked_at,
      i.company_name,
      i.desired_slug,
      i.admin_name,
      i.allow_skip_ek,
      i.invitation_note,
      i.tenant_id,
      t.slug AS tenant_slug,
      t.name AS tenant_name,
      t.status AS tenant_status,
      td.domain AS tenant_domain
    FROM tenant_invitation i
    LEFT JOIN tenant t ON t.id = i.tenant_id
    LEFT JOIN LATERAL (
      SELECT domain
      FROM tenant_domain
      WHERE tenant_id = i.tenant_id AND active = true
      ORDER BY created_at DESC
      LIMIT 1
    ) td ON true
    WHERE i.id = $1
    LIMIT 1
  `;

  const { rows } = await client.query(sql, [invitationId]);
  return rows[0] || null;
}

async function markInvitationAccepted(client, { invitationId, tenantId }) {
  const sql = `
    UPDATE tenant_invitation
    SET
      status = 'accepted',
      accepted_at = now(),
      tenant_id = $2
    WHERE id = $1
  `;
  await client.query(sql, [invitationId, tenantId]);
}

module.exports = {
  createInvitation,
  findInvitationByIdForUpdate,
  findInvitationByTokenHashForUpdate,
  markInvitationAccepted,
  listInvitations,
  getInvitationStatusById,
};
