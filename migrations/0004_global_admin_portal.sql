-- Fielddesk V3 global admin portal v1
BEGIN;

CREATE TABLE IF NOT EXISTS global_admin_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  bootstrap_created boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NULL,
  CONSTRAINT ck_global_admin_user_username_format CHECK (username ~ '^[a-z0-9._-]{3,64}$'),
  CONSTRAINT ck_global_admin_user_display_name_not_blank CHECK (btrim(display_name) <> ''),
  CONSTRAINT ck_global_admin_user_password_hash_not_blank CHECK (btrim(password_hash) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_global_admin_user_username_ci
  ON global_admin_user (lower(username));

CREATE INDEX IF NOT EXISTS ix_global_admin_user_active
  ON global_admin_user (is_active);

DROP TRIGGER IF EXISTS trg_global_admin_user_set_updated_at ON global_admin_user;
CREATE TRIGGER trg_global_admin_user_set_updated_at
BEFORE UPDATE ON global_admin_user
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_global_admin_user_prevent_immutable_update ON global_admin_user;
CREATE TRIGGER trg_global_admin_user_prevent_immutable_update
BEFORE UPDATE ON global_admin_user
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'created_at');

ALTER TABLE audit_event DROP CONSTRAINT IF EXISTS ck_audit_event_event_type;
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
      'logout'
    )
  );

COMMIT;