BEGIN;

ALTER TABLE tenant_user
  ADD COLUMN IF NOT EXISTS login_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS last_invited_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS invite_accepted_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz NULL;

ALTER TABLE tenant_user DROP CONSTRAINT IF EXISTS ck_tenant_user_login_status;
ALTER TABLE tenant_user
  ADD CONSTRAINT ck_tenant_user_login_status CHECK (
    login_status IN ('imported_no_login','pending_invite','invited','active','disabled')
  );

UPDATE tenant_user
SET login_status = CASE
  WHEN status = 'active' THEN 'active'
  WHEN status = 'suspended' THEN 'disabled'
  WHEN status = 'deleted' THEN 'disabled'
  ELSE 'imported_no_login'
END
WHERE login_status = 'active'
  AND status <> 'active';
CREATE UNIQUE INDEX IF NOT EXISTS ux_tenant_user_id_tenant_id
  ON tenant_user (id, tenant_id);

CREATE TABLE IF NOT EXISTS tenant_user_invitation_token (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  tenant_user_id uuid NOT NULL,
  purpose text NOT NULL DEFAULT 'account_setup',
  token_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  revoked_at timestamptz NULL,
  created_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz NULL,
  send_error text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT fk_tenant_user_invitation_token_user
    FOREIGN KEY (tenant_user_id, tenant_id)
    REFERENCES tenant_user(id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_tenant_user_invitation_token_created_by
    FOREIGN KEY (created_by_user_id)
    REFERENCES tenant_user(id)
    ON DELETE SET NULL,
  CONSTRAINT uq_tenant_user_invitation_token_hash UNIQUE (token_hash),
  CONSTRAINT ck_tenant_user_invitation_token_purpose CHECK (purpose IN ('account_setup','password_reset')),
  CONSTRAINT ck_tenant_user_invitation_token_status CHECK (status IN ('pending','sent','send_failed','used','revoked','expired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_tenant_user_invitation_token_open
  ON tenant_user_invitation_token (tenant_id, tenant_user_id, purpose)
  WHERE status IN ('pending','sent','send_failed') AND used_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_tenant_user_invitation_token_user_status
  ON tenant_user_invitation_token (tenant_id, tenant_user_id, status, expires_at DESC);

CREATE INDEX IF NOT EXISTS ix_tenant_user_invitation_token_expiry
  ON tenant_user_invitation_token (status, expires_at);

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
      'resource_group_created',
      'resource_group_updated',
      'resource_group_member_changed',
      'sync_requested',
      'qa_thread_created',
      'qa_message_created',
      'qa_thread_status_changed',
      'qa_thread_seen',
      'qa_thread_participant_added',
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
      'storage_object_uploaded',
      'storage_object_downloaded',
      'storage_object_deleted'
    )
  );

COMMIT;
