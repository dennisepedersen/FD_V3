BEGIN;

ALTER TABLE time_control_employee_config
  ADD COLUMN approved_group_id uuid NULL,
  ADD COLUMN approved_email text NULL,
  ADD COLUMN email_source text NULL,
  ADD COLUMN email_source_value text NULL,
  ADD COLUMN email_approved_at timestamptz NULL,
  ADD COLUMN email_approved_by_user_id uuid NULL,
  ADD COLUMN approval_reason text NULL,
  ADD COLUMN approval_version integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT fk_time_control_approved_group
    FOREIGN KEY (approved_group_id, tenant_id) REFERENCES resource_groups(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_time_control_email_approver
    FOREIGN KEY (email_approved_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT ck_time_control_email_approval CHECK (
    (approval_version = 0 AND approved_group_id IS NULL AND approved_email IS NULL
      AND email_source IS NULL AND email_source_value IS NULL AND email_approved_at IS NULL
      AND email_approved_by_user_id IS NULL AND approval_reason IS NULL)
    OR
    (approval_version > 0 AND fitter_id IS NOT NULL AND approved_group_id IS NOT NULL
      AND approved_email IS NOT NULL AND btrim(approved_email) <> ''
      AND email_source IS NOT NULL AND email_source IN ('fitter_master', 'admin_override')
      AND email_source_value IS NOT NULL
      AND email_approved_at IS NOT NULL AND email_approved_by_user_id IS NOT NULL
      AND approval_reason IS NOT NULL AND btrim(approval_reason) <> '')
  );

CREATE UNIQUE INDEX uq_time_control_employee_config_fitter
  ON time_control_employee_config (tenant_id, fitter_id) WHERE fitter_id IS NOT NULL;

CREATE FUNCTION prevent_time_control_fitter_reassignment() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.approval_version > 0 AND
     (NEW.fitter_id IS DISTINCT FROM OLD.fitter_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
    RAISE EXCEPTION 'time_control_approved_identity_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_time_control_fitter_identity
BEFORE UPDATE ON time_control_employee_config
FOR EACH ROW EXECUTE FUNCTION prevent_time_control_fitter_reassignment();

ALTER TABLE time_control_result
  ADD COLUMN identity_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT ck_time_control_identity_snapshot CHECK (jsonb_typeof(identity_snapshot) = 'object');

ALTER TABLE audit_event DROP CONSTRAINT ck_audit_event_event_type;
ALTER TABLE audit_event ADD CONSTRAINT ck_audit_event_event_type CHECK (
  event_type IN (
    'invitation_created', 'invitation_accepted', 'invitation_revoked',
    'login_success', 'login_fail', 'tenant_status_changed', 'tenant_config_changed',
    'role_changed', 'sync_success', 'sync_fail', 'support_access_denied',
    'onboarding_created', 'onboarding_started', 'onboarding_completed',
    'invitation_accept_success', 'logout',
    'tenant_user_created', 'tenant_user_updated', 'tenant_user_invite_requested',
    'tenant_user_invite_sent', 'tenant_user_invite_send_failed', 'tenant_user_invite_revoked',
    'tenant_user_invite_accepted', 'tenant_user_deactivated', 'tenant_user_sessions_revoked',
    'tenant_user_reactivation_requested', 'tenant_user_reactivation_invite_sent',
    'tenant_user_reactivation_invite_failed', 'tenant_user_reactivated', 'tenant_user_identity_linked',
    'resource_group_created', 'resource_group_updated', 'resource_group_member_changed', 'sync_requested',
    'qa_thread_created', 'qa_message_created', 'qa_thread_status_changed', 'qa_thread_seen',
    'qa_thread_participant_added', 'project_assignment_created', 'project_assignment_updated',
    'project_assignment_removed',
    'project_equipment_cctv_created', 'project_equipment_cctv_updated', 'project_equipment_cctv_archived',
    'project_equipment_cctv_checked', 'project_equipment_cctv_exported', 'project_equipment_cctv_pdf_exported',
    'project_equipment_cctv_image_uploaded', 'project_equipment_cctv_image_replaced',
    'project_equipment_cctv_image_deleted', 'project_equipment_cctv_drawing_uploaded',
    'project_equipment_cctv_drawing_deleted', 'project_equipment_cctv_drawing_pdf_imported',
    'project_equipment_cctv_pin_created', 'project_equipment_cctv_pin_updated', 'project_equipment_cctv_pin_deleted',
    'restarbejde.item_created', 'restarbejde.item_updated', 'restarbejde.item_status_changed',
    'restarbejde.item_archived', 'restarbejde.item_restored', 'restarbejde.drawing_created',
    'restarbejde.drawing_archived', 'restarbejde.drawing_restored', 'restarbejde.placement_created',
    'restarbejde.placement_updated', 'restarbejde.placement_archived', 'restarbejde.placement_restored',
    'restarbejde.attachment_created', 'restarbejde.attachment_archived',
    'absence_type.created', 'absence_type.updated', 'absence_type.archived',
    'absence_request.created', 'absence_request.updated', 'absence_request.submitted',
    'absence_request.late_submitted', 'absence_request.cancelled', 'absence_request.approved',
    'absence_request.rejected', 'absence_request.change_proposed', 'approved_absence.created',
    'absence_special_window.created', 'absence_special_window.updated',
    'absence_special_window.scope_changed', 'absence_special_window.archived',
    'employee_manager_relation.created', 'employee_manager_relation.updated', 'employee_manager_relation.ended',
    'internal_notification.created', 'email_outbox.queued', 'email_outbox.sent',
    'email_outbox.retry_scheduled', 'email_outbox.dead_lettered',
    'time_control.run_completed', 'time_control.run_blocked', 'time_control.mode_changed',
    'time_control.employee_email_approved',
    'storage_object_uploaded', 'storage_object_downloaded', 'storage_object_deleted',
    'igva.manager_completion_changed', 'igva.summary_refreshed', 'igva.summary_refresh_failed'
  )
);

COMMIT;
