BEGIN;

CREATE TABLE IF NOT EXISTS time_control_settings (
  tenant_id uuid PRIMARY KEY,
  is_enabled boolean NOT NULL DEFAULT true,
  mode text NOT NULL DEFAULT 'dry_run',
  timezone text NOT NULL DEFAULT 'Europe/Copenhagen',
  resource_group_external_id text NOT NULL DEFAULT '61',
  monday_thursday_required_hours numeric(5,2) NOT NULL DEFAULT 7.50,
  friday_required_hours numeric(5,2) NOT NULL DEFAULT 7.00,
  sync_freshness_minutes integer NOT NULL DEFAULT 180,
  sync_wait_seconds integer NOT NULL DEFAULT 900,
  employee_cc_emails jsonb NOT NULL DEFAULT '["dep@hoyrup-clemmensen.dk"]'::jsonb,
  internal_error_emails jsonb NOT NULL DEFAULT '["dep@hoyrup-clemmensen.dk"]'::jsonb,
  friday_manager_emails jsonb NOT NULL DEFAULT '["dep@hoyrup-clemmensen.dk","LKE@hoyrup-clemmensen.dk"]'::jsonb,
  live_enabled_at timestamptz NULL,
  live_enabled_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_time_control_settings_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_time_control_settings_live_enabled_by FOREIGN KEY (live_enabled_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT ck_time_control_settings_mode CHECK (mode IN ('dry_run', 'live')),
  CONSTRAINT ck_time_control_settings_timezone CHECK (timezone = 'Europe/Copenhagen'),
  CONSTRAINT ck_time_control_settings_resource_group CHECK (btrim(resource_group_external_id) <> ''),
  CONSTRAINT ck_time_control_settings_hours CHECK (monday_thursday_required_hours > 0 AND friday_required_hours > 0),
  CONSTRAINT ck_time_control_settings_sync CHECK (sync_freshness_minutes BETWEEN 1 AND 1440 AND sync_wait_seconds BETWEEN 0 AND 3600),
  CONSTRAINT ck_time_control_settings_employee_cc CHECK (jsonb_typeof(employee_cc_emails) = 'array'),
  CONSTRAINT ck_time_control_settings_internal_error CHECK (jsonb_typeof(internal_error_emails) = 'array'),
  CONSTRAINT ck_time_control_settings_friday_manager CHECK (jsonb_typeof(friday_manager_emails) = 'array')
);

CREATE TRIGGER trg_time_control_settings_set_updated_at
BEFORE UPDATE ON time_control_settings
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS time_control_pay_code_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  pay_code text NOT NULL,
  counts_as_valid_hours boolean NOT NULL DEFAULT false,
  label text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_time_control_pay_code_rule_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT uq_time_control_pay_code_rule UNIQUE (tenant_id, pay_code),
  CONSTRAINT ck_time_control_pay_code_rule_pay_code CHECK (btrim(pay_code) <> ''),
  CONSTRAINT ck_time_control_pay_code_rule_label CHECK (label IS NULL OR btrim(label) <> '')
);

CREATE INDEX IF NOT EXISTS ix_time_control_pay_code_rule_counts
  ON time_control_pay_code_rule (tenant_id, counts_as_valid_hours, pay_code);

CREATE TRIGGER trg_time_control_pay_code_rule_set_updated_at
BEFORE UPDATE ON time_control_pay_code_rule
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS time_control_employee_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  internal_ref text NOT NULL,
  resource_group_external_id text NOT NULL DEFAULT '61',
  tenant_user_id uuid NULL,
  fitter_id text NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  note text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_time_control_employee_config_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_time_control_employee_config_user FOREIGN KEY (tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_time_control_employee_config_fitter FOREIGN KEY (tenant_id, fitter_id) REFERENCES fitter(tenant_id, fitter_id) ON DELETE SET NULL,
  CONSTRAINT uq_time_control_employee_config_ref UNIQUE (tenant_id, internal_ref),
  CONSTRAINT ck_time_control_employee_config_ref CHECK (btrim(internal_ref) <> ''),
  CONSTRAINT ck_time_control_employee_config_group CHECK (btrim(resource_group_external_id) <> ''),
  CONSTRAINT ck_time_control_employee_config_note CHECK (note IS NULL OR btrim(note) <> '')
);

CREATE INDEX IF NOT EXISTS ix_time_control_employee_config_tenant_enabled
  ON time_control_employee_config (tenant_id, is_enabled, internal_ref);

CREATE TRIGGER trg_time_control_employee_config_set_updated_at
BEFORE UPDATE ON time_control_employee_config
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS time_control_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  control_type text NOT NULL,
  controlled_date date NOT NULL,
  mode text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  timezone text NOT NULL DEFAULT 'Europe/Copenhagen',
  required_hours numeric(5,2) NOT NULL,
  sync_status text NOT NULL DEFAULT 'not_checked',
  sync_job_id uuid NULL,
  sync_completed_at timestamptz NULL,
  sync_checked_at timestamptz NULL,
  error_reason text NULL,
  triggered_by text NOT NULL DEFAULT 'scheduler',
  triggered_by_user_id uuid NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_time_control_run_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_time_control_run_sync_job FOREIGN KEY (sync_job_id) REFERENCES sync_job(id) ON DELETE SET NULL,
  CONSTRAINT fk_time_control_run_triggered_by_user FOREIGN KEY (triggered_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT uq_time_control_run_key UNIQUE (tenant_id, control_type, controlled_date),
  CONSTRAINT ck_time_control_run_type CHECK (control_type IN ('daily_09', 'friday_12', 'manual')),
  CONSTRAINT ck_time_control_run_mode CHECK (mode IN ('dry_run', 'live')),
  CONSTRAINT ck_time_control_run_status CHECK (status IN ('running', 'completed', 'blocked', 'failed')),
  CONSTRAINT ck_time_control_run_timezone CHECK (timezone = 'Europe/Copenhagen'),
  CONSTRAINT ck_time_control_run_sync_status CHECK (sync_status IN ('not_checked', 'queued', 'running', 'fresh', 'stale', 'failed', 'timeout')),
  CONSTRAINT ck_time_control_run_required_hours CHECK (required_hours > 0),
  CONSTRAINT ck_time_control_run_error CHECK (error_reason IS NULL OR char_length(error_reason) <= 500)
);

CREATE INDEX IF NOT EXISTS ix_time_control_run_tenant_started
  ON time_control_run (tenant_id, started_at DESC);

CREATE TRIGGER trg_time_control_run_set_updated_at
BEFORE UPDATE ON time_control_run
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS time_control_result (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  employee_config_id uuid NOT NULL,
  tenant_user_id uuid NULL,
  fitter_id text NULL,
  internal_ref text NOT NULL,
  employee_name text NULL,
  employee_email text NULL,
  required_hours numeric(5,2) NOT NULL,
  valid_hours numeric(8,2) NOT NULL DEFAULT 0,
  missing_hours numeric(8,2) NOT NULL DEFAULT 0,
  counted_pay_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded_pay_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL,
  config_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_time_control_result_run FOREIGN KEY (run_id) REFERENCES time_control_run(id) ON DELETE CASCADE,
  CONSTRAINT fk_time_control_result_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_time_control_result_config FOREIGN KEY (employee_config_id) REFERENCES time_control_employee_config(id) ON DELETE CASCADE,
  CONSTRAINT fk_time_control_result_user FOREIGN KEY (tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_time_control_result_fitter FOREIGN KEY (tenant_id, fitter_id) REFERENCES fitter(tenant_id, fitter_id) ON DELETE SET NULL,
  CONSTRAINT uq_time_control_result_config UNIQUE (run_id, employee_config_id),
  CONSTRAINT ck_time_control_result_hours CHECK (required_hours > 0 AND valid_hours >= 0 AND missing_hours >= 0),
  CONSTRAINT ck_time_control_result_counted_codes CHECK (jsonb_typeof(counted_pay_codes) = 'array'),
  CONSTRAINT ck_time_control_result_excluded_codes CHECK (jsonb_typeof(excluded_pay_codes) = 'array'),
  CONSTRAINT ck_time_control_result_status CHECK (status IN ('ok', 'missing_hours', 'config_error', 'sync_blocked')),
  CONSTRAINT ck_time_control_result_config_error CHECK (config_error IS NULL OR char_length(config_error) <= 500)
);

CREATE INDEX IF NOT EXISTS ix_time_control_result_tenant_status
  ON time_control_result (tenant_id, status, created_at DESC);

CREATE TRIGGER trg_time_control_result_set_updated_at
BEFORE UPDATE ON time_control_result
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS time_control_mail_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  run_id uuid NOT NULL,
  result_id uuid NULL,
  mail_type text NOT NULL,
  mode text NOT NULL,
  status text NOT NULL,
  recipient_emails jsonb NOT NULL DEFAULT '[]'::jsonb,
  cc_emails jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject text NOT NULL,
  body_preview text NOT NULL,
  email_outbox_id uuid NULL,
  idempotency_key text NOT NULL,
  sent_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_time_control_mail_log_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_time_control_mail_log_run FOREIGN KEY (run_id) REFERENCES time_control_run(id) ON DELETE CASCADE,
  CONSTRAINT fk_time_control_mail_log_result FOREIGN KEY (result_id) REFERENCES time_control_result(id) ON DELETE SET NULL,
  CONSTRAINT fk_time_control_mail_log_outbox FOREIGN KEY (email_outbox_id) REFERENCES email_outbox(id) ON DELETE SET NULL,
  CONSTRAINT uq_time_control_mail_log_idempotency UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT ck_time_control_mail_log_type CHECK (mail_type IN ('employee_missing_hours', 'friday_manager_summary', 'internal_error')),
  CONSTRAINT ck_time_control_mail_log_mode CHECK (mode IN ('dry_run', 'live')),
  CONSTRAINT ck_time_control_mail_log_status CHECK (status IN ('would_send', 'queued', 'skipped', 'blocked', 'failed')),
  CONSTRAINT ck_time_control_mail_log_recipients CHECK (jsonb_typeof(recipient_emails) = 'array'),
  CONSTRAINT ck_time_control_mail_log_cc CHECK (jsonb_typeof(cc_emails) = 'array'),
  CONSTRAINT ck_time_control_mail_log_subject CHECK (btrim(subject) <> '' AND char_length(subject) <= 240),
  CONSTRAINT ck_time_control_mail_log_body CHECK (btrim(body_preview) <> '' AND char_length(body_preview) <= 20000),
  CONSTRAINT ck_time_control_mail_log_idempotency CHECK (btrim(idempotency_key) <> '' AND char_length(idempotency_key) <= 160)
);

CREATE INDEX IF NOT EXISTS ix_time_control_mail_log_run
  ON time_control_mail_log (tenant_id, run_id, created_at DESC);

CREATE TRIGGER trg_time_control_mail_log_set_updated_at
BEFORE UPDATE ON time_control_mail_log
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

ALTER TABLE audit_event
  DROP CONSTRAINT IF EXISTS ck_audit_event_event_type;

ALTER TABLE audit_event
  ADD CONSTRAINT ck_audit_event_event_type CHECK (
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
      'time_control.run_completed',
      'time_control.run_blocked',
      'time_control.mode_changed',
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
    'time_control.missing_hours.employee',
    'da-DK',
    1,
    true,
    '{{subject}}',
    '<p>Hej {{first_name}}</p><p>{{intro}}</p><p>Dagens krav er {{required_hours}} timer. Fielddesk kan aktuelt se {{valid_hours}} gyldige timer, og der mangler derfor {{missing_hours}} timer.</p><p>Bemaerk, at tillaeg ikke taeller som arbejdstimer i denne kontrol. Godkendte arbejdstids- og sygdomsloenarter taeller.</p><p>Hvis timerne allerede er registreret, kan der vaere forsinkelse i synkroniseringen. Ellers bedes du registrere {{missing_phrase}} i E-Komplet.</p><p>Venlig hilsen<br>Fielddesk Timekontrol</p>',
    'Hej {{first_name}}\n\n{{intro}}\n\nDagens krav er {{required_hours}} timer. Fielddesk kan aktuelt se {{valid_hours}} gyldige timer, og der mangler derfor {{missing_hours}} timer.\n\nBemaerk, at tillaeg ikke taeller som arbejdstimer i denne kontrol. Godkendte arbejdstids- og sygdomsloenarter taeller.\n\nHvis timerne allerede er registreret, kan der vaere forsinkelse i synkroniseringen. Ellers bedes du registrere {{missing_phrase}} i E-Komplet.\n\nVenlig hilsen\nFielddesk Timekontrol',
    '["subject","first_name","intro","required_hours","valid_hours","missing_hours","missing_phrase"]'::jsonb
  ),
  (
    NULL,
    'time_control.friday_manager_summary',
    'da-DK',
    1,
    true,
    'Timekontrol: manglende fredagstimer for {{date_label}}',
    '<p>Fielddesk Timekontrol har fundet medarbejdere med manglende gyldige timer for {{date_label}}.</p><p>{{summary_lines}}</p>',
    'Fielddesk Timekontrol har fundet medarbejdere med manglende gyldige timer for {{date_label}}.\n\n{{summary_lines}}',
    '["date_label","summary_lines"]'::jsonb
  ),
  (
    NULL,
    'time_control.internal_error',
    'da-DK',
    1,
    true,
    'Timekontrol stoppet: {{date_label}}',
    '<p>Timekontrol blev stoppet for {{date_label}}.</p><p>Aarsag: {{error_reason}}</p>',
    'Timekontrol blev stoppet for {{date_label}}.\n\nAarsag: {{error_reason}}',
    '["date_label","error_reason"]'::jsonb
  )
ON CONFLICT DO NOTHING;

WITH target_tenant AS (
  SELECT id FROM tenant WHERE slug = 'hoyrup-clemmensen'
)
INSERT INTO time_control_settings (tenant_id, is_enabled, mode, resource_group_external_id)
SELECT id, true, 'dry_run', '61'
FROM target_tenant
ON CONFLICT (tenant_id) DO NOTHING;

WITH target_tenant AS (
  SELECT id FROM tenant WHERE slug = 'hoyrup-clemmensen'
),
rules(pay_code, counts_as_valid_hours, label) AS (
  VALUES
    ('3300', true, 'Servicetekniker Sikring'),
    ('1220', true, 'Servicetekniker Sikring'),
    ('9010', true, NULL),
    ('9012', true, '2. sygedag m.fl.'),
    ('9022', true, 'Sygdom uden loen'),
    ('1244', false, 'Formandstillaeg'),
    ('1246', false, 'Funktionstillaeg')
)
INSERT INTO time_control_pay_code_rule (tenant_id, pay_code, counts_as_valid_hours, label)
SELECT target_tenant.id, rules.pay_code, rules.counts_as_valid_hours, rules.label
FROM target_tenant
CROSS JOIN rules
ON CONFLICT (tenant_id, pay_code) DO NOTHING;

WITH target_tenant AS (
  SELECT id FROM tenant WHERE slug = 'hoyrup-clemmensen'
),
employees(internal_ref) AS (
  VALUES ('MHJ'), ('MUM'), ('JSK'), ('PEP'), ('MBO'), ('MPJ')
)
INSERT INTO time_control_employee_config (tenant_id, internal_ref, resource_group_external_id)
SELECT target_tenant.id, employees.internal_ref, '61'
FROM target_tenant
CROSS JOIN employees
ON CONFLICT (tenant_id, internal_ref) DO NOTHING;

COMMIT;
