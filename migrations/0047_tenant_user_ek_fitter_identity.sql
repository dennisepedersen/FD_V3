BEGIN;

ALTER TABLE tenant_user
  ADD COLUMN IF NOT EXISTS ek_user_id uuid,
  ADD COLUMN IF NOT EXISTS ek_user_linked_at timestamptz,
  ADD COLUMN IF NOT EXISTS ek_user_link_source text;

ALTER TABLE fitter
  ADD COLUMN IF NOT EXISTS ek_user_id uuid,
  ADD COLUMN IF NOT EXISTS identity_link_status text NOT NULL DEFAULT 'unresolved',
  ADD COLUMN IF NOT EXISTS identity_link_method text,
  ADD COLUMN IF NOT EXISTS identity_linked_at timestamptz,
  ADD COLUMN IF NOT EXISTS identity_link_conflict_reason text,
  ADD COLUMN IF NOT EXISTS identity_link_checked_at timestamptz;

UPDATE fitter
SET identity_link_status = CASE
      WHEN tenant_user_id IS NOT NULL THEN 'manually_linked'
      ELSE 'unresolved'
    END,
    identity_link_method = CASE
      WHEN tenant_user_id IS NOT NULL THEN 'preexisting'
      ELSE identity_link_method
    END,
    identity_linked_at = CASE
      WHEN tenant_user_id IS NOT NULL THEN COALESCE(identity_linked_at, updated_at, created_at, now())
      ELSE identity_linked_at
    END,
    identity_link_checked_at = COALESCE(identity_link_checked_at, now())
WHERE identity_link_status = 'unresolved';

DO $$
DECLARE
  duplicate_links jsonb;
BEGIN
  SELECT jsonb_agg(row_to_json(conflict_rows))
  INTO duplicate_links
  FROM (
    SELECT tenant_id, tenant_user_id, count(*) AS linked_fitter_count, array_agg(fitter_id ORDER BY fitter_id) AS fitter_ids
    FROM fitter
    WHERE tenant_user_id IS NOT NULL
      AND identity_link_status IN ('auto_linked', 'manually_linked')
      AND is_active_derived IS DISTINCT FROM false
    GROUP BY tenant_id, tenant_user_id
    HAVING count(*) > 1
  ) conflict_rows;

  IF duplicate_links IS NOT NULL THEN
    RAISE EXCEPTION 'fitter_identity_duplicate_active_tenant_user %', duplicate_links;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_user_tenant_ek_user
  ON tenant_user (tenant_id, ek_user_id)
  WHERE ek_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fitter_identity_active_tenant_user
  ON fitter (tenant_id, tenant_user_id)
  WHERE tenant_user_id IS NOT NULL
    AND identity_link_status IN ('auto_linked', 'manually_linked')
    AND is_active_derived IS DISTINCT FROM false;

CREATE INDEX IF NOT EXISTS ix_fitter_tenant_ek_user
  ON fitter (tenant_id, ek_user_id)
  WHERE ek_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_fitter_identity_status
  ON fitter (tenant_id, identity_link_status);

ALTER TABLE tenant_user
  DROP CONSTRAINT IF EXISTS ck_tenant_user_ek_link_source,
  ADD CONSTRAINT ck_tenant_user_ek_link_source
    CHECK (ek_user_link_source IS NULL OR ek_user_link_source IN ('ek_fitter_auto_email', 'manual', 'preexisting'));

ALTER TABLE fitter
  DROP CONSTRAINT IF EXISTS ck_fitter_identity_link_status,
  ADD CONSTRAINT ck_fitter_identity_link_status
    CHECK (identity_link_status IN ('auto_linked', 'manually_linked', 'unresolved', 'conflict'));

ALTER TABLE fitter
  DROP CONSTRAINT IF EXISTS ck_fitter_identity_link_method,
  ADD CONSTRAINT ck_fitter_identity_link_method
    CHECK (identity_link_method IS NULL OR identity_link_method IN ('auto_email', 'manual', 'preexisting', 'conflict'));

ALTER TABLE audit_event
  DROP CONSTRAINT IF EXISTS audit_event_event_type_check,
  DROP CONSTRAINT IF EXISTS ck_audit_event_event_type,
  ADD CONSTRAINT ck_audit_event_event_type
    CHECK (event_type IN (
      'invitation_created',
      'invitation_accepted',
      'invitation_revoked',
      'login_success',
      'login_fail',
      'tenant_status_changed',
      'tenant_config_changed',
      'role_changed',
      'sync_success',
      'sync_fail',
      'support_access_denied',
      'onboarding_created',
      'onboarding_started',
      'onboarding_completed',
      'invitation_accept_success',
      'logout',
      'tenant_user_created',
      'tenant_user_updated',
      'tenant_user_invite_requested',
      'tenant_user_invite_sent',
      'tenant_user_invite_send_failed',
      'tenant_user_invite_revoked',
      'tenant_user_invite_accepted',
      'tenant_user_deactivated',
      'tenant_user_sessions_revoked',
      'tenant_user_reactivation_requested',
      'tenant_user_reactivation_invite_sent',
      'tenant_user_reactivation_invite_failed',
      'tenant_user_reactivated',
      'tenant_user_identity_linked',
      'resource_group_created',
      'resource_group_updated',
      'resource_group_member_changed',
      'sync_requested',
      'qa_thread_created',
      'qa_message_created',
      'qa_thread_status_changed',
      'qa_thread_seen',
      'qa_thread_participant_added',
      'project_assignment_created',
      'project_assignment_updated',
      'project_assignment_removed',
      'project_equipment_cctv_created',
      'project_equipment_cctv_updated',
      'project_equipment_cctv_archived',
      'project_equipment_cctv_checked',
      'project_equipment_cctv_exported',
      'project_equipment_cctv_pdf_exported',
      'project_equipment_cctv_image_uploaded',
      'project_equipment_cctv_image_replaced',
      'project_equipment_cctv_image_deleted',
      'project_equipment_cctv_drawing_uploaded',
      'project_equipment_cctv_drawing_deleted',
      'project_equipment_cctv_drawing_pdf_imported',
      'project_equipment_cctv_pin_created',
      'project_equipment_cctv_pin_updated',
      'project_equipment_cctv_pin_deleted',
      'restarbejde.item_created',
      'restarbejde.item_updated',
      'restarbejde.item_status_changed',
      'restarbejde.item_archived',
      'restarbejde.item_restored',
      'restarbejde.drawing_created',
      'restarbejde.drawing_archived',
      'restarbejde.drawing_restored',
      'restarbejde.placement_created',
      'restarbejde.placement_updated',
      'restarbejde.placement_archived',
      'restarbejde.attachment_created',
      'restarbejde.attachment_archived',
      'absence_type.created',
      'absence_type.updated',
      'absence_type.archived',
      'absence_request.created',
      'absence_request.updated',
      'absence_request.submitted',
      'absence_request.late_submitted',
      'absence_request.cancelled',
      'absence_request.approved',
      'absence_request.rejected',
      'absence_request.change_proposed',
      'approved_absence.created',
      'absence_special_window.created',
      'absence_special_window.updated',
      'absence_special_window.scope_changed',
      'absence_special_window.archived',
      'employee_manager_relation.created',
      'employee_manager_relation.updated',
      'employee_manager_relation.ended',
      'internal_notification.created',
      'email_outbox.queued',
      'email_outbox.sent',
      'email_outbox.retry_scheduled',
      'email_outbox.dead_lettered',
      'storage_object_uploaded',
      'storage_object_downloaded',
      'storage_object_deleted'
    ));

COMMIT;
