"use strict";

async function upsertNotification(client, {
  tenantId,
  recipientTenantUserId,
  notificationType,
  eventKey,
  sourceType,
  sourceId,
  title,
  body,
  actionUrl = null,
  payload = {},
}) {
  const { rows } = await client.query(
    `
      INSERT INTO internal_notification (
        tenant_id,
        recipient_tenant_user_id,
        notification_type,
        event_key,
        source_type,
        source_id,
        title,
        body,
        action_url,
        payload_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
      ON CONFLICT (tenant_id, recipient_tenant_user_id, event_key, source_type, source_id)
      DO UPDATE SET
        title = EXCLUDED.title,
        body = EXCLUDED.body,
        action_url = EXCLUDED.action_url,
        payload_json = EXCLUDED.payload_json
      RETURNING
        id,
        tenant_id,
        recipient_tenant_user_id,
        notification_type,
        event_key,
        source_type,
        source_id,
        title,
        body,
        action_url,
        payload_json,
        read_at,
        created_at,
        updated_at
    `,
    [
      tenantId,
      recipientTenantUserId,
      notificationType,
      eventKey,
      sourceType,
      sourceId,
      title,
      body,
      actionUrl,
      JSON.stringify(payload || {}),
    ]
  );

  return rows[0];
}

module.exports = {
  upsertNotification,
};
