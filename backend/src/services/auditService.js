const auditQueries = require("../db/queries/audit");

const ALLOWED_EVENT_TYPES = Object.freeze([
  "invitation_created",
  "invitation_accepted",
  "invitation_revoked",
  "login_success",
  "login_fail",
  "tenant_status_changed",
  "tenant_config_changed",
  "role_changed",
  "sync_success",
  "sync_fail",
  "support_access_denied",
  "onboarding_created",
  "onboarding_started",
  "onboarding_completed",
  "invitation_accept_success",
  "logout",
  "tenant_user_created",
  "tenant_user_updated",
  "tenant_user_invite_requested",
  "tenant_user_invite_sent",
  "tenant_user_invite_send_failed",
  "tenant_user_invite_revoked",
  "tenant_user_invite_accepted",
  "tenant_user_deactivated",
  "tenant_user_sessions_revoked",
  "tenant_user_reactivation_requested",
  "tenant_user_reactivation_invite_sent",
  "tenant_user_reactivation_invite_failed",
  "tenant_user_reactivated",
  "resource_group_created",
  "resource_group_updated",
  "resource_group_member_changed",
  "sync_requested",
  "qa_thread_created",
  "qa_message_created",
  "qa_thread_status_changed",
  "qa_thread_seen",
  "qa_thread_participant_added",
  "project_equipment_cctv_created",
  "project_equipment_cctv_updated",
  "project_equipment_cctv_archived",
  "project_equipment_cctv_checked",
  "project_equipment_cctv_exported",
  "project_equipment_cctv_pdf_exported",
  "project_equipment_cctv_image_uploaded",
  "project_equipment_cctv_image_replaced",
  "project_equipment_cctv_image_deleted",
  "project_equipment_cctv_drawing_uploaded",
  "project_equipment_cctv_drawing_deleted",
  "project_equipment_cctv_drawing_pdf_imported",
  "project_equipment_cctv_pin_created",
  "project_equipment_cctv_pin_updated",
  "project_equipment_cctv_pin_deleted",
  "storage_object_uploaded",
  "storage_object_downloaded",
  "storage_object_deleted",
]);

const TENANT_SCOPED_ACTOR_SCOPES = new Set(["tenant"]);
const ALLOWED_OUTCOMES = new Set(["success", "fail", "deny"]);
const ALLOWED_ACTOR_SCOPES = new Set(["global", "tenant", "system"]);

function normalizeRequiredString(value, fieldName) {
  const normalized = value == null ? "" : String(value).trim();
  if (!normalized) {
    throw new Error(`${fieldName}_required`);
  }
  return normalized;
}

function normalizeOptionalString(value) {
  const normalized = value == null ? "" : String(value).trim();
  return normalized || null;
}

function normalizeMetadata(metadata) {
  if (metadata == null) {
    return {};
  }

  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("audit_metadata_must_be_object");
  }

  return { ...metadata };
}

async function logAuditEvent({
  client,
  tenantId,
  actorId,
  actorType,
  actorScope,
  moduleKey,
  eventType,
  resourceType,
  resourceId,
  projectId,
  outcome,
  reason,
  metadata,
}) {
  if (!client) {
    throw new Error("audit_client_required");
  }

  const normalizedEventType = normalizeRequiredString(eventType, "event_type");
  if (!ALLOWED_EVENT_TYPES.includes(normalizedEventType)) {
    throw new Error("audit_event_type_not_allowed");
  }

  const normalizedActorId = normalizeRequiredString(actorId, "actor_id");
  const normalizedActorScope = normalizeRequiredString(actorScope, "actor_scope");
  if (!ALLOWED_ACTOR_SCOPES.has(normalizedActorScope)) {
    throw new Error("audit_actor_scope_not_allowed");
  }

  const normalizedOutcome = normalizeRequiredString(outcome, "outcome");
  if (!ALLOWED_OUTCOMES.has(normalizedOutcome)) {
    throw new Error("audit_outcome_not_allowed");
  }

  const normalizedTenantId = normalizeOptionalString(tenantId);
  if (TENANT_SCOPED_ACTOR_SCOPES.has(normalizedActorScope) && !normalizedTenantId) {
    throw new Error("tenant_id_required_for_tenant_audit_event");
  }

  const normalizedResourceType = normalizeRequiredString(resourceType, "resource_type");
  const normalizedReason = normalizeOptionalString(reason);
  const normalizedMetadata = normalizeMetadata(metadata);

  const mergedMetadata = {
    ...normalizedMetadata,
    actor_scope: normalizedActorScope,
    outcome: normalizedOutcome,
  };

  const normalizedActorType = normalizeOptionalString(actorType);
  if (normalizedActorType) {
    mergedMetadata.actor_type = normalizedActorType;
  }

  const normalizedModuleKey = normalizeOptionalString(moduleKey);
  if (normalizedModuleKey) {
    mergedMetadata.module_key = normalizedModuleKey;
  }

  const normalizedProjectId = normalizeOptionalString(projectId);
  if (normalizedProjectId) {
    mergedMetadata.project_id = normalizedProjectId;
  }

  if (normalizedReason) {
    mergedMetadata.reason = normalizedReason;
  }

  await auditQueries.insertAuditEvent(client, {
    actorId: normalizedActorId,
    actorScope: normalizedActorScope,
    tenantId: normalizedTenantId,
    eventType: normalizedEventType,
    targetType: normalizedResourceType,
    targetId: normalizeOptionalString(resourceId),
    outcome: normalizedOutcome,
    reason: normalizedReason,
    metadata: mergedMetadata,
  });
}

module.exports = {
  ALLOWED_EVENT_TYPES,
  logAuditEvent,
};
