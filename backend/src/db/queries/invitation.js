async function findInvitationByTokenHashForUpdate(client, tokenHash) {
  const sql = `
    SELECT id, email, status, expires_at, tenant_id, created_at, accepted_at, revoked_at
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
  findInvitationByTokenHashForUpdate,
  markInvitationAccepted,
};
