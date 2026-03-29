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
};
