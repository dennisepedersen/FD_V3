BEGIN;

ALTER TABLE tenant_user
  ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deactivated_reason text NULL,
  ADD COLUMN IF NOT EXISTS deactivated_by_user_id uuid NULL,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS reactivation_requested_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS reactivation_requested_by_user_id uuid NULL;

ALTER TABLE tenant_user DROP CONSTRAINT IF EXISTS ck_tenant_user_status;
ALTER TABLE tenant_user
  ADD CONSTRAINT ck_tenant_user_status CHECK (
    status IN ('active', 'suspended', 'invited', 'deleted', 'deactivated', 'pending_reactivation')
  );

ALTER TABLE tenant_user DROP CONSTRAINT IF EXISTS ck_tenant_user_login_status;
ALTER TABLE tenant_user
  ADD CONSTRAINT ck_tenant_user_login_status CHECK (
    login_status IN ('imported_no_login','pending_invite','invited','active','disabled','pending_reactivation')
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_tenant_user_deactivated_by'
      AND conrelid = 'tenant_user'::regclass
  ) THEN
    ALTER TABLE tenant_user
      ADD CONSTRAINT fk_tenant_user_deactivated_by
      FOREIGN KEY (deactivated_by_user_id)
      REFERENCES tenant_user(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_tenant_user_reactivation_requested_by'
      AND conrelid = 'tenant_user'::regclass
  ) THEN
    ALTER TABLE tenant_user
      ADD CONSTRAINT fk_tenant_user_reactivation_requested_by
      FOREIGN KEY (reactivation_requested_by_user_id)
      REFERENCES tenant_user(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_tenant_user_lifecycle_status
  ON tenant_user (tenant_id, status, login_status);

CREATE INDEX IF NOT EXISTS ix_tenant_user_session_version
  ON tenant_user (tenant_id, id, session_version);

CREATE TABLE IF NOT EXISTS tenant_user_lifecycle_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  tenant_user_id uuid NOT NULL,
  event_type text NOT NULL,
  reason text NULL,
  actor_user_id uuid NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT fk_tenant_user_lifecycle_event_user
    FOREIGN KEY (tenant_user_id, tenant_id)
    REFERENCES tenant_user(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_tenant_user_lifecycle_event_actor
    FOREIGN KEY (actor_user_id)
    REFERENCES tenant_user(id)
    ON DELETE SET NULL,
  CONSTRAINT ck_tenant_user_lifecycle_event_type CHECK (
    event_type IN ('deactivated','sessions_revoked','reactivation_requested','reactivation_invite_sent','reactivation_invite_failed','reactivated')
  ),
  CONSTRAINT ck_tenant_user_lifecycle_metadata_is_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS ix_tenant_user_lifecycle_event_user_occurred
  ON tenant_user_lifecycle_event (tenant_id, tenant_user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS ix_tenant_user_lifecycle_event_type
  ON tenant_user_lifecycle_event (event_type, occurred_at DESC);

DROP TRIGGER IF EXISTS trg_tenant_user_lifecycle_event_prevent_update ON tenant_user_lifecycle_event;
CREATE TRIGGER trg_tenant_user_lifecycle_event_prevent_update
BEFORE UPDATE ON tenant_user_lifecycle_event
FOR EACH ROW
EXECUTE FUNCTION prevent_update_delete_append_only();

DROP TRIGGER IF EXISTS trg_tenant_user_lifecycle_event_prevent_delete ON tenant_user_lifecycle_event;
CREATE TRIGGER trg_tenant_user_lifecycle_event_prevent_delete
BEFORE DELETE ON tenant_user_lifecycle_event
FOR EACH ROW
EXECUTE FUNCTION prevent_update_delete_append_only();

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
