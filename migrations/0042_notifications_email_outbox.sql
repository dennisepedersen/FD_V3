BEGIN;

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
      'absence_request.cancelled',
      'absence_request.approved',
      'absence_request.rejected',
      'absence_request.change_proposed',
      'absence_special_window.created',
      'absence_special_window.updated',
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

CREATE TABLE internal_notification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  recipient_tenant_user_id uuid NOT NULL,
  notification_type text NOT NULL,
  event_key text NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  action_url text NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_internal_notification_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_internal_notification_recipient FOREIGN KEY (recipient_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT uq_internal_notification_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT ck_internal_notification_type CHECK (notification_type IN ('absence_request')),
  CONSTRAINT ck_internal_notification_event_key CHECK (btrim(event_key) <> '' AND char_length(event_key) <= 120),
  CONSTRAINT ck_internal_notification_source_type CHECK (btrim(source_type) <> '' AND char_length(source_type) <= 80),
  CONSTRAINT ck_internal_notification_title CHECK (btrim(title) <> '' AND char_length(title) <= 160),
  CONSTRAINT ck_internal_notification_body CHECK (btrim(body) <> '' AND char_length(body) <= 1000),
  CONSTRAINT ck_internal_notification_action_url CHECK (action_url IS NULL OR (btrim(action_url) <> '' AND char_length(action_url) <= 1000)),
  CONSTRAINT ck_internal_notification_payload_object CHECK (jsonb_typeof(payload_json) = 'object')
);

CREATE UNIQUE INDEX uq_internal_notification_tenant_event_recipient_source
  ON internal_notification (tenant_id, recipient_tenant_user_id, event_key, source_type, source_id);

CREATE INDEX ix_internal_notification_recipient_created
  ON internal_notification (tenant_id, recipient_tenant_user_id, created_at DESC);

CREATE INDEX ix_internal_notification_recipient_unread
  ON internal_notification (tenant_id, recipient_tenant_user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE TRIGGER trg_internal_notification_set_updated_at
BEFORE UPDATE ON internal_notification
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE email_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  template_key text NOT NULL,
  locale text NOT NULL DEFAULT 'da-DK',
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  subject_template text NOT NULL,
  html_template text NOT NULL,
  text_template text NOT NULL,
  allowed_variables_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_email_template_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT uq_email_template_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT ck_email_template_key CHECK (btrim(template_key) <> '' AND char_length(template_key) <= 120),
  CONSTRAINT ck_email_template_locale CHECK (btrim(locale) <> '' AND char_length(locale) <= 16),
  CONSTRAINT ck_email_template_version CHECK (version >= 1),
  CONSTRAINT ck_email_template_subject CHECK (btrim(subject_template) <> '' AND char_length(subject_template) <= 240),
  CONSTRAINT ck_email_template_html CHECK (btrim(html_template) <> '' AND char_length(html_template) <= 20000),
  CONSTRAINT ck_email_template_text CHECK (btrim(text_template) <> '' AND char_length(text_template) <= 20000),
  CONSTRAINT ck_email_template_allowed_variables_array CHECK (jsonb_typeof(allowed_variables_json) = 'array')
);

CREATE UNIQUE INDEX uq_email_template_tenant_key_locale_version
  ON email_template (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), template_key, locale, version);

CREATE UNIQUE INDEX uq_email_template_active_tenant_key_locale
  ON email_template (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), template_key, locale)
  WHERE is_active = true;

CREATE INDEX ix_email_template_lookup
  ON email_template (template_key, locale, is_active, tenant_id);

CREATE TRIGGER trg_email_template_set_updated_at
BEFORE UPDATE ON email_template
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  template_id uuid NOT NULL,
  template_key text NOT NULL,
  locale text NOT NULL DEFAULT 'da-DK',
  recipient_tenant_user_id uuid NULL,
  recipient_email text NULL,
  recipient_name text NULL,
  subject text NOT NULL,
  html_body text NOT NULL,
  text_body text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz NULL,
  sent_at timestamptz NULL,
  dead_lettered_at timestamptz NULL,
  provider text NULL,
  provider_message_id text NULL,
  last_error_code text NULL,
  last_error text NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  idempotency_key text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_email_outbox_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_email_outbox_template FOREIGN KEY (template_id) REFERENCES email_template(id) ON DELETE RESTRICT,
  CONSTRAINT fk_email_outbox_recipient FOREIGN KEY (recipient_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (recipient_tenant_user_id),
  CONSTRAINT uq_email_outbox_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT ck_email_outbox_template_key CHECK (btrim(template_key) <> '' AND char_length(template_key) <= 120),
  CONSTRAINT ck_email_outbox_locale CHECK (btrim(locale) <> '' AND char_length(locale) <= 16),
  CONSTRAINT ck_email_outbox_recipient_email CHECK (recipient_email IS NULL OR (btrim(recipient_email) <> '' AND char_length(recipient_email) <= 320)),
  CONSTRAINT ck_email_outbox_recipient_name CHECK (recipient_name IS NULL OR (btrim(recipient_name) <> '' AND char_length(recipient_name) <= 160)),
  CONSTRAINT ck_email_outbox_subject CHECK (btrim(subject) <> '' AND char_length(subject) <= 240),
  CONSTRAINT ck_email_outbox_html CHECK (btrim(html_body) <> '' AND char_length(html_body) <= 20000),
  CONSTRAINT ck_email_outbox_text CHECK (btrim(text_body) <> '' AND char_length(text_body) <= 20000),
  CONSTRAINT ck_email_outbox_payload_object CHECK (jsonb_typeof(payload_json) = 'object'),
  CONSTRAINT ck_email_outbox_status CHECK (status IN ('queued', 'processing', 'sent', 'retry', 'dead_letter')),
  CONSTRAINT ck_email_outbox_attempts CHECK (attempt_count >= 0 AND max_attempts BETWEEN 1 AND 20 AND attempt_count <= max_attempts),
  CONSTRAINT ck_email_outbox_sent_state CHECK (
    (status = 'sent' AND sent_at IS NOT NULL AND dead_lettered_at IS NULL)
    OR status <> 'sent'
  ),
  CONSTRAINT ck_email_outbox_dead_letter_state CHECK (
    (status = 'dead_letter' AND dead_lettered_at IS NOT NULL AND sent_at IS NULL)
    OR status <> 'dead_letter'
  ),
  CONSTRAINT ck_email_outbox_unsent_state CHECK (
    (status IN ('queued', 'processing', 'retry') AND sent_at IS NULL AND dead_lettered_at IS NULL)
    OR status NOT IN ('queued', 'processing', 'retry')
  ),
  CONSTRAINT ck_email_outbox_provider CHECK (provider IS NULL OR (btrim(provider) <> '' AND char_length(provider) <= 80)),
  CONSTRAINT ck_email_outbox_provider_message_id CHECK (provider_message_id IS NULL OR (btrim(provider_message_id) <> '' AND char_length(provider_message_id) <= 200)),
  CONSTRAINT ck_email_outbox_last_error_code CHECK (last_error_code IS NULL OR (btrim(last_error_code) <> '' AND char_length(last_error_code) <= 120)),
  CONSTRAINT ck_email_outbox_last_error CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  CONSTRAINT ck_email_outbox_source_type CHECK (btrim(source_type) <> '' AND char_length(source_type) <= 80),
  CONSTRAINT ck_email_outbox_idempotency_key CHECK (idempotency_key IS NULL OR (btrim(idempotency_key) <> '' AND char_length(idempotency_key) <= 160))
);

CREATE UNIQUE INDEX uq_email_outbox_tenant_idempotency_key
  ON email_outbox (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX ix_email_outbox_due
  ON email_outbox (tenant_id, status, next_attempt_at, created_at)
  WHERE status IN ('queued', 'retry', 'processing');

CREATE INDEX ix_email_outbox_source
  ON email_outbox (tenant_id, source_type, source_id);

CREATE INDEX ix_email_outbox_recipient_created
  ON email_outbox (tenant_id, recipient_tenant_user_id, created_at DESC)
  WHERE recipient_tenant_user_id IS NOT NULL;

CREATE TRIGGER trg_email_outbox_set_updated_at
BEFORE UPDATE ON email_outbox
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

INSERT INTO email_template (
  template_key,
  locale,
  version,
  subject_template,
  html_template,
  text_template,
  allowed_variables_json
)
VALUES
  (
    'absence_request.submitted.employee',
    'da-DK',
    1,
    'Din fravaersanmodning er sendt',
    '<p>Hej {{employee_name}}</p><p>Din fravaersanmodning for {{absence_period}} er sendt til {{manager_name}}.</p><p><a href="{{action_url}}">Aabn Fielddesk</a></p>',
    'Hej {{employee_name}}\n\nDin fravaersanmodning for {{absence_period}} er sendt til {{manager_name}}.\n\nAabn Fielddesk: {{action_url}}',
    '["employee_name","manager_name","absence_period","action_url"]'::jsonb
  ),
  (
    'absence_request.submitted.manager',
    'da-DK',
    1,
    'Ny fravaersanmodning fra {{employee_name}}',
    '<p>Hej {{manager_name}}</p><p>{{employee_name}} har sendt en fravaersanmodning for {{absence_period}}.</p><p><a href="{{action_url}}">Aabn Fielddesk</a></p>',
    'Hej {{manager_name}}\n\n{{employee_name}} har sendt en fravaersanmodning for {{absence_period}}.\n\nAabn Fielddesk: {{action_url}}',
    '["employee_name","manager_name","absence_period","action_url"]'::jsonb
  ),
  (
    'absence_request.cancelled.employee',
    'da-DK',
    1,
    'Din fravaersanmodning er annulleret',
    '<p>Hej {{employee_name}}</p><p>Din fravaersanmodning for {{absence_period}} er annulleret.</p><p><a href="{{action_url}}">Aabn Fielddesk</a></p>',
    'Hej {{employee_name}}\n\nDin fravaersanmodning for {{absence_period}} er annulleret.\n\nAabn Fielddesk: {{action_url}}',
    '["employee_name","absence_period","action_url"]'::jsonb
  ),
  (
    'absence_request.cancelled.manager',
    'da-DK',
    1,
    '{{employee_name}} har annulleret en fravaersanmodning',
    '<p>Hej {{manager_name}}</p><p>{{employee_name}} har annulleret fravaersanmodningen for {{absence_period}}.</p><p><a href="{{action_url}}">Aabn Fielddesk</a></p>',
    'Hej {{manager_name}}\n\n{{employee_name}} har annulleret fravaersanmodningen for {{absence_period}}.\n\nAabn Fielddesk: {{action_url}}',
    '["employee_name","manager_name","absence_period","action_url"]'::jsonb
  )
ON CONFLICT DO NOTHING;

COMMIT;
