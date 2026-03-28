async function insertAuditEvent(client, {
  actorId,
  actorScope,
  tenantId,
  eventType,
  targetType,
  targetId,
  outcome,
  reason,
  metadata,
}) {
  const sql = `
    INSERT INTO audit_event (
      actor_id,
      actor_scope,
      tenant_id,
      event_type,
      target_type,
      target_id,
      outcome,
      reason,
      metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
  `;

  await client.query(sql, [
    actorId,
    actorScope,
    tenantId || null,
    eventType,
    targetType,
    targetId || null,
    outcome,
    reason || null,
    JSON.stringify(metadata || {}),
  ]);
}

module.exports = {
  insertAuditEvent,
};
