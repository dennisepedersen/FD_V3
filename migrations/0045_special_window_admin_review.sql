BEGIN;

ALTER TABLE absence_special_window
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_absence_special_window_version'
  ) THEN
    ALTER TABLE absence_special_window
      ADD CONSTRAINT ck_absence_special_window_version CHECK (version >= 1);
  END IF;
END $$;

ALTER TABLE audit_event DROP CONSTRAINT IF EXISTS ck_audit_event_event_type;
ALTER TABLE audit_event ADD CONSTRAINT ck_audit_event_event_type CHECK (
  event_type IN (
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
      'restarbejde.placement_restored',
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
  )
);

INSERT INTO email_template (
  tenant_id,
  template_key,
  locale,
  version,
  is_active,
  subject_template,
  html_template,
  text_template,
  allowed_variables_json
)
VALUES
  (
    NULL,
    'absence_request.submitted_special_window.employee',
    'da-DK',
    1,
    true,
    'Dit ferieonske er modtaget',
    '<p>Hej {{employee_name}}</p><p>Dit ferieonske for {{absence_period}} er modtaget til samlet behandling i {{special_window_name}}.</p><p>Det er ikke godkendt endnu, og det er ikke foerst til moelle.</p><p>Frist: {{submission_deadline}}. Behandling starter: {{review_start_date}}.</p><p>{{receipt_text}}</p><p><a href="{{action_url}}">Se onsket i Fielddesk</a></p>',
    'Hej {{employee_name}}

Dit ferieonske for {{absence_period}} er modtaget til samlet behandling i {{special_window_name}}.
Det er ikke godkendt endnu, og det er ikke foerst til moelle.
Frist: {{submission_deadline}}. Behandling starter: {{review_start_date}}.
{{receipt_text}}

Se onsket i Fielddesk: {{action_url}}',
    '["employee_name","manager_name","absence_period","special_window_name","submission_deadline","review_start_date","receipt_text","action_url","tenant_name"]'::jsonb
  ),
  (
    NULL,
    'absence_request.submitted_special_window.manager',
    'da-DK',
    1,
    true,
    'Nyt ferieonske til samlet behandling',
    '<p>Hej {{manager_name}}</p><p>{{employee_name}} har sendt et ferieonske for {{absence_period}}, som afventer faelles behandling i {{special_window_name}}.</p><p>Frist: {{submission_deadline}}. Behandling aabner: {{review_start_date}}.</p><p><a href="{{action_url}}">Se onsket i Fielddesk</a></p>',
    'Hej {{manager_name}}

{{employee_name}} har sendt et ferieonske for {{absence_period}}, som afventer faelles behandling i {{special_window_name}}.
Frist: {{submission_deadline}}. Behandling aabner: {{review_start_date}}.

Se onsket i Fielddesk: {{action_url}}',
    '["employee_name","manager_name","absence_period","special_window_name","submission_deadline","review_start_date","receipt_text","action_url","tenant_name"]'::jsonb
  )
ON CONFLICT DO NOTHING;

COMMIT;