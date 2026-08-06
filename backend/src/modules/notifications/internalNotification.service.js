"use strict";

const auditService = require("../../services/auditService");
const repository = require("./internalNotification.repository");

const MODULE_KEY = "notifications";
const RESOURCE_TYPE = "internal_notification";

async function createInternalNotification(client, {
  tenantId,
  actorId,
  recipientTenantUserId,
  eventKey,
  sourceId,
  title,
  body,
  actionUrl,
  payload,
}) {
  const row = await repository.upsertNotification(client, {
    tenantId,
    recipientTenantUserId,
    notificationType: "absence_request",
    eventKey,
    sourceType: "absence_request",
    sourceId,
    title,
    body,
    actionUrl,
    payload,
  });

  await auditService.logAuditEvent({
    client,
    tenantId,
    actorId,
    actorType: "tenant_user",
    actorScope: "tenant",
    moduleKey: MODULE_KEY,
    eventType: "internal_notification.created",
    resourceType: RESOURCE_TYPE,
    resourceId: row.id,
    outcome: "success",
    metadata: {
      event_key: eventKey,
      recipient_tenant_user_id: recipientTenantUserId,
      source_type: "absence_request",
      source_id: sourceId,
    },
  });

  return row;
}

module.exports = {
  createInternalNotification,
};
