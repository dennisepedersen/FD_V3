-- Fielddesk V3 Phase-1 schema snapshot
-- Source of truth: backend/database first

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- Helpers
-- ============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_immutable_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  col_name text;
  old_value text;
  new_value text;
BEGIN
  FOREACH col_name IN ARRAY TG_ARGV LOOP
    EXECUTE format('SELECT ($1).%I::text, ($2).%I::text', col_name, col_name)
      INTO old_value, new_value
      USING OLD, NEW;

    IF old_value IS DISTINCT FROM new_value THEN
      RAISE EXCEPTION 'Immutable column "%" cannot be changed in table %', col_name, TG_TABLE_NAME;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_update_delete_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Append-only table % does not allow %', TG_TABLE_NAME, TG_OP;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_update_create_delete_model()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Create/delete model: table % does not allow %', TG_TABLE_NAME, TG_OP;
END;
$$;

-- ============================================================================
-- 1) tenant
-- ============================================================================

CREATE TABLE tenant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  name text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_tenant_slug_format CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
  CONSTRAINT ck_tenant_status CHECK (status IN ('invited', 'onboarding', 'active', 'suspended', 'deleted')),
  CONSTRAINT ck_tenant_name_not_blank CHECK (btrim(name) <> '')
);

CREATE UNIQUE INDEX uq_tenant_slug_ci ON tenant (lower(slug));
CREATE INDEX ix_tenant_status ON tenant (status);

CREATE TRIGGER trg_tenant_set_updated_at
BEFORE UPDATE ON tenant
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_tenant_prevent_immutable_update
BEFORE UPDATE ON tenant
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'slug', 'created_at');

-- ============================================================================
-- 2) tenant_domain
-- ============================================================================

CREATE TABLE tenant_domain (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  domain text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_tenant_domain_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE RESTRICT,
  CONSTRAINT ck_tenant_domain_not_blank CHECK (btrim(domain) <> ''),
  CONSTRAINT ck_tenant_domain_format CHECK (
    domain = lower(domain)
    AND position(' ' IN domain) = 0
    AND domain !~ '\.\.'
    AND domain ~ '^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$'
  ),
  CONSTRAINT ck_tenant_domain_active_requires_verified CHECK (NOT active OR verified)
);

CREATE UNIQUE INDEX uq_tenant_domain_domain_ci ON tenant_domain (lower(domain));
CREATE UNIQUE INDEX uq_tenant_domain_active_per_tenant ON tenant_domain (tenant_id) WHERE active = true;
CREATE INDEX ix_tenant_domain_tenant_id ON tenant_domain (tenant_id);
CREATE INDEX ix_tenant_domain_verified_active ON tenant_domain (tenant_id, verified, active);

CREATE TRIGGER trg_tenant_domain_set_updated_at
BEFORE UPDATE ON tenant_domain
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_tenant_domain_prevent_immutable_update
BEFORE UPDATE ON tenant_domain
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'domain', 'created_at');

-- ============================================================================
-- 3) tenant_invitation
-- ============================================================================

CREATE TABLE tenant_invitation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL,
  tenant_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz NULL,
  revoked_at timestamptz NULL,
  CONSTRAINT fk_tenant_invitation_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE RESTRICT,
  CONSTRAINT ck_tenant_invitation_email_not_blank CHECK (btrim(email) <> ''),
  CONSTRAINT ck_tenant_invitation_status CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  CONSTRAINT ck_tenant_invitation_expiry_after_create CHECK (expires_at > created_at),
  CONSTRAINT ck_tenant_invitation_accepted_state CHECK (
    (status = 'accepted' AND accepted_at IS NOT NULL AND tenant_id IS NOT NULL AND revoked_at IS NULL) OR
    (status <> 'accepted')
  ),
  CONSTRAINT ck_tenant_invitation_revoked_state CHECK (
    (status = 'revoked' AND revoked_at IS NOT NULL AND accepted_at IS NULL) OR
    (status <> 'revoked')
  ),
  CONSTRAINT ck_tenant_invitation_pending_state CHECK (
    (status = 'pending' AND accepted_at IS NULL AND revoked_at IS NULL) OR
    (status <> 'pending')
  ),
  CONSTRAINT ck_tenant_invitation_expired_state CHECK (
    (status = 'expired' AND accepted_at IS NULL AND revoked_at IS NULL AND tenant_id IS NULL) OR
    (status <> 'expired')
  )
);

CREATE UNIQUE INDEX uq_tenant_invitation_token_hash ON tenant_invitation (token_hash);
CREATE UNIQUE INDEX uq_tenant_invitation_pending_email_ci ON tenant_invitation (lower(email)) WHERE status = 'pending';
CREATE INDEX ix_tenant_invitation_status_expires ON tenant_invitation (status, expires_at);
CREATE INDEX ix_tenant_invitation_tenant_id ON tenant_invitation (tenant_id);

CREATE TRIGGER trg_tenant_invitation_prevent_immutable_update
BEFORE UPDATE ON tenant_invitation
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'email', 'token_hash', 'expires_at', 'created_at');

-- ============================================================================
-- 4) tenant_user
-- ============================================================================

CREATE TABLE tenant_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  email text NOT NULL,
  name text NOT NULL,
  role text NOT NULL,
  status text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_tenant_user_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE RESTRICT,
  CONSTRAINT ck_tenant_user_email_not_blank CHECK (btrim(email) <> ''),
  CONSTRAINT ck_tenant_user_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_tenant_user_role CHECK (role IN ('tenant_admin', 'project_leader', 'technician')),
  CONSTRAINT ck_tenant_user_status CHECK (status IN ('active', 'suspended', 'invited', 'deleted')),
  CONSTRAINT ck_tenant_user_password_hash_not_blank CHECK (btrim(password_hash) <> '')
);

ALTER TABLE tenant_user
  ADD CONSTRAINT uq_tenant_user_id_tenant UNIQUE (id, tenant_id);

CREATE UNIQUE INDEX uq_tenant_user_tenant_email_ci ON tenant_user (tenant_id, lower(email));
CREATE INDEX ix_tenant_user_tenant_role_status ON tenant_user (tenant_id, role, status);

CREATE TRIGGER trg_tenant_user_set_updated_at
BEFORE UPDATE ON tenant_user
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_tenant_user_prevent_immutable_update
BEFORE UPDATE ON tenant_user
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'email', 'created_at');

-- ============================================================================
-- 5) global_admin_user
-- ============================================================================

CREATE TABLE global_admin_user (
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

CREATE UNIQUE INDEX uq_global_admin_user_username_ci ON global_admin_user (lower(username));
CREATE INDEX ix_global_admin_user_active ON global_admin_user (is_active);

CREATE TRIGGER trg_global_admin_user_set_updated_at
BEFORE UPDATE ON global_admin_user
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_global_admin_user_prevent_immutable_update
BEFORE UPDATE ON global_admin_user
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'created_at');

-- ============================================================================
-- 6) team
-- ============================================================================

CREATE TABLE team (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_team_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE RESTRICT,
  CONSTRAINT ck_team_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_team_status CHECK (status IN ('active', 'inactive'))
);

ALTER TABLE team
  ADD CONSTRAINT uq_team_id_tenant UNIQUE (id, tenant_id);

CREATE UNIQUE INDEX uq_team_tenant_name_ci ON team (tenant_id, lower(name));
CREATE INDEX ix_team_tenant_status ON team (tenant_id, status);

CREATE TRIGGER trg_team_set_updated_at
BEFORE UPDATE ON team
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_team_prevent_immutable_update
BEFORE UPDATE ON team
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'created_at');

-- ============================================================================
-- 7) team_membership
-- ============================================================================

CREATE TABLE team_membership (
  team_id uuid NOT NULL,
  tenant_user_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  membership_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_team_membership PRIMARY KEY (team_id, tenant_user_id),
  CONSTRAINT fk_team_membership_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE RESTRICT,
  CONSTRAINT fk_team_membership_team_tenant FOREIGN KEY (team_id, tenant_id) REFERENCES team(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_team_membership_user_tenant FOREIGN KEY (tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT ck_team_membership_role CHECK (membership_role IN ('member', 'lead'))
);

CREATE INDEX ix_team_membership_tenant_user ON team_membership (tenant_id, tenant_user_id);
CREATE INDEX ix_team_membership_tenant_team ON team_membership (tenant_id, team_id);

CREATE TRIGGER trg_team_membership_prevent_update
BEFORE UPDATE ON team_membership
FOR EACH ROW
EXECUTE FUNCTION prevent_update_create_delete_model();

-- ============================================================================
-- 8) tenant_config
-- ============================================================================

CREATE TABLE tenant_config (
  tenant_id uuid PRIMARY KEY,
  ek_base_url text NOT NULL,
  ek_api_key_encrypted text NOT NULL,
  last_tested_at timestamptz NULL,
  status text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_tenant_config_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE RESTRICT,
  CONSTRAINT ck_tenant_config_status CHECK (status IN ('not_configured', 'configured', 'test_ok', 'test_failed')),
  CONSTRAINT ck_tenant_config_base_url_https CHECK (ek_base_url ~ '^https://')
);

CREATE INDEX ix_tenant_config_status ON tenant_config (status);

CREATE TRIGGER trg_tenant_config_set_updated_at
BEFORE UPDATE ON tenant_config
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_tenant_config_prevent_immutable_update
BEFORE UPDATE ON tenant_config
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('tenant_id');

-- ============================================================================
-- 9) tenant_config_snapshot
-- ============================================================================

CREATE TABLE tenant_config_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by_actor_id text NOT NULL,
  changed_by_actor_scope text NOT NULL,
  config_snapshot jsonb NOT NULL,
  reason text NOT NULL,
  CONSTRAINT fk_tenant_config_snapshot_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE RESTRICT,
  CONSTRAINT uq_tenant_config_snapshot_seq UNIQUE (seq),
  CONSTRAINT ck_tenant_config_snapshot_actor_scope CHECK (changed_by_actor_scope IN ('global', 'tenant', 'system')),
  CONSTRAINT ck_tenant_config_snapshot_reason_not_blank CHECK (btrim(reason) <> ''),
  CONSTRAINT ck_tenant_config_snapshot_is_object CHECK (jsonb_typeof(config_snapshot) = 'object')
);

CREATE INDEX ix_tenant_config_snapshot_tenant_changed ON tenant_config_snapshot (tenant_id, changed_at DESC);

CREATE TRIGGER trg_tenant_config_snapshot_prevent_update
BEFORE UPDATE ON tenant_config_snapshot
FOR EACH ROW
EXECUTE FUNCTION prevent_update_delete_append_only();

CREATE TRIGGER trg_tenant_config_snapshot_prevent_delete
BEFORE DELETE ON tenant_config_snapshot
FOR EACH ROW
EXECUTE FUNCTION prevent_update_delete_append_only();

-- ============================================================================
-- 10) audit_event
-- ============================================================================

CREATE TABLE audit_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id text NOT NULL,
  actor_scope text NOT NULL,
  tenant_id uuid NULL,
  event_type text NOT NULL,
  target_type text NOT NULL,
  target_id text NULL,
  outcome text NOT NULL,
  reason text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT fk_audit_event_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE RESTRICT,
  CONSTRAINT ck_audit_event_actor_scope CHECK (actor_scope IN ('global', 'tenant', 'system')),
  CONSTRAINT ck_audit_event_outcome CHECK (outcome IN ('success', 'fail', 'deny')),
  CONSTRAINT ck_audit_event_event_type CHECK (
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
  ),
  CONSTRAINT ck_audit_event_target_type_not_blank CHECK (btrim(target_type) <> ''),
  CONSTRAINT ck_audit_event_metadata_is_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX ix_audit_event_tenant_occurred ON audit_event (tenant_id, occurred_at DESC);
CREATE INDEX ix_audit_event_actor_scope_occurred ON audit_event (actor_scope, occurred_at DESC);
CREATE INDEX ix_audit_event_event_type_occurred ON audit_event (event_type, occurred_at DESC);

CREATE TRIGGER trg_audit_event_prevent_update
BEFORE UPDATE ON audit_event
FOR EACH ROW
EXECUTE FUNCTION prevent_update_delete_append_only();

CREATE TRIGGER trg_audit_event_prevent_delete
BEFORE DELETE ON audit_event
FOR EACH ROW
EXECUTE FUNCTION prevent_update_delete_append_only();

-- ============================================================================
-- 11) sync_job
-- ============================================================================

CREATE TABLE sync_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  type text NOT NULL,
  status text NOT NULL,
  last_run timestamptz NULL,
  error text NULL,
  rows_processed bigint NOT NULL DEFAULT 0,
  pages_processed integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_sync_job_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE RESTRICT,
  CONSTRAINT ck_sync_job_type CHECK (type IN ('bootstrap', 'delta')),
  CONSTRAINT ck_sync_job_status CHECK (status IN ('queued', 'running', 'success', 'failed')),
  CONSTRAINT ck_sync_job_rows_nonnegative CHECK (rows_processed >= 0),
  CONSTRAINT ck_sync_job_pages_nonnegative CHECK (pages_processed >= 0)
);

CREATE INDEX ix_sync_job_tenant_created ON sync_job (tenant_id, created_at DESC);
CREATE INDEX ix_sync_job_tenant_status ON sync_job (tenant_id, status);
CREATE INDEX ix_sync_job_tenant_type_status ON sync_job (tenant_id, type, status);

CREATE TRIGGER trg_sync_job_set_updated_at
BEFORE UPDATE ON sync_job
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_sync_job_prevent_immutable_update
BEFORE UPDATE ON sync_job
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'type', 'created_at');

-- ============================================================================
-- 11) project_core
-- ============================================================================

CREATE TABLE project_core (
  project_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  external_project_ref text NULL,
  name text NOT NULL,
  status text NOT NULL,
  is_closed boolean NULL,
  activity_date timestamptz NULL,
  responsible_code text NULL,
  responsible_name text NULL,
  responsible_id text NULL,
  team_leader_code text NULL,
  team_leader_name text NULL,
  team_leader_id text NULL,
  owner_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_project_core_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_core_owner_user_tenant FOREIGN KEY (owner_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT ck_project_core_status CHECK (status IN ('open', 'closed', 'archived')),
  CONSTRAINT ck_project_core_name_not_blank CHECK (btrim(name) <> '')
);

ALTER TABLE project_core
  ADD CONSTRAINT uq_project_core_id_tenant UNIQUE (project_id, tenant_id);

CREATE UNIQUE INDEX uq_project_core_tenant_external_ref
  ON project_core (tenant_id, external_project_ref)
  WHERE external_project_ref IS NOT NULL;

CREATE INDEX ix_project_core_tenant_status ON project_core (tenant_id, status);
CREATE INDEX ix_project_core_owner ON project_core (tenant_id, owner_user_id);
CREATE INDEX ix_project_core_tenant_responsible_code_ci ON project_core (tenant_id, lower(responsible_code));
CREATE INDEX ix_project_core_tenant_responsible_id ON project_core (tenant_id, responsible_id);
CREATE INDEX ix_project_core_tenant_activity_date ON project_core (tenant_id, activity_date DESC);

CREATE TRIGGER trg_project_core_set_updated_at
BEFORE UPDATE ON project_core
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_project_core_prevent_immutable_update
BEFORE UPDATE ON project_core
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('project_id', 'tenant_id', 'created_at');

-- ============================================================================
-- 12) project_wip
-- ============================================================================

CREATE TABLE project_wip (
  project_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  current_stage text NULL,
  risk_level text NULL,
  notes text NULL,
  updated_by_user_id uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_project_wip_project_tenant FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_project_wip_updated_by_user_tenant FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT ck_project_wip_risk_level CHECK (risk_level IS NULL OR risk_level IN ('low', 'medium', 'high', 'critical'))
);

CREATE INDEX ix_project_wip_tenant_stage ON project_wip (tenant_id, current_stage);
CREATE INDEX ix_project_wip_tenant_updated_by ON project_wip (tenant_id, updated_by_user_id);

CREATE TRIGGER trg_project_wip_set_updated_at
BEFORE UPDATE ON project_wip
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_project_wip_prevent_immutable_update
BEFORE UPDATE ON project_wip
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('project_id', 'tenant_id');

-- ============================================================================
-- 13) project_assignment
-- ============================================================================

CREATE TABLE project_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  tenant_user_id uuid NOT NULL,
  assignment_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_project_assignment_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_assignment_project_tenant FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_assignment_user_tenant FOREIGN KEY (tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT ck_project_assignment_role CHECK (assignment_role IN ('owner', 'contributor', 'reviewer'))
);

CREATE UNIQUE INDEX uq_project_assignment_project_user ON project_assignment (project_id, tenant_user_id);
CREATE INDEX ix_project_assignment_tenant_user ON project_assignment (tenant_id, tenant_user_id);
CREATE INDEX ix_project_assignment_tenant_project ON project_assignment (tenant_id, project_id);

CREATE TRIGGER trg_project_assignment_set_updated_at
BEFORE UPDATE ON project_assignment
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_project_assignment_prevent_immutable_update
BEFORE UPDATE ON project_assignment
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'project_id', 'tenant_user_id', 'created_at');

-- ============================================================================
-- 14) sync_endpoint_state
-- ============================================================================

CREATE TABLE sync_endpoint_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  endpoint_key text NOT NULL,
  status text NOT NULL DEFAULT 'idle',
  last_attempt_at timestamptz NULL,
  last_successful_sync_at timestamptz NULL,
  last_successful_page integer NULL,
  last_successful_cursor text NULL,
  updated_after_watermark timestamptz NULL,
  rows_fetched bigint NOT NULL DEFAULT 0,
  rows_persisted bigint NOT NULL DEFAULT 0,
  next_planned_at timestamptz NULL,
  last_error text NULL,
  last_job_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_sync_endpoint_state_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_sync_endpoint_state_job FOREIGN KEY (last_job_id) REFERENCES sync_job(id) ON DELETE SET NULL,
  CONSTRAINT uq_sync_endpoint_state_tenant_endpoint UNIQUE (tenant_id, endpoint_key),
  CONSTRAINT ck_sync_endpoint_state_status CHECK (status IN ('idle', 'running', 'success', 'partial', 'failed')),
  CONSTRAINT ck_sync_endpoint_state_endpoint_not_blank CHECK (btrim(endpoint_key) <> ''),
  CONSTRAINT ck_sync_endpoint_state_rows_fetched_nonnegative CHECK (rows_fetched >= 0),
  CONSTRAINT ck_sync_endpoint_state_rows_persisted_nonnegative CHECK (rows_persisted >= 0)
);

CREATE INDEX ix_sync_endpoint_state_tenant_status ON sync_endpoint_state (tenant_id, status);
CREATE INDEX ix_sync_endpoint_state_next_planned ON sync_endpoint_state (next_planned_at);

CREATE TRIGGER trg_sync_endpoint_state_set_updated_at
BEFORE UPDATE ON sync_endpoint_state
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_sync_endpoint_state_prevent_immutable_update
BEFORE UPDATE ON sync_endpoint_state
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'endpoint_key', 'created_at');

-- ============================================================================
-- 15) sync_failure_backlog
-- ============================================================================

CREATE TABLE sync_failure_backlog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  endpoint_key text NOT NULL,
  locator_type text NOT NULL,
  locator_value text NOT NULL,
  page_number integer NULL,
  cursor_value text NULL,
  reference_value text NULL,
  failure_kind text NOT NULL,
  error_message text NULL,
  attempts integer NOT NULL DEFAULT 1,
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  last_failed_at timestamptz NOT NULL DEFAULT now(),
  next_retry_at timestamptz NULL,
  status text NOT NULL DEFAULT 'pending',
  last_job_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_sync_failure_backlog_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_sync_failure_backlog_job FOREIGN KEY (last_job_id) REFERENCES sync_job(id) ON DELETE SET NULL,
  CONSTRAINT uq_sync_failure_locator UNIQUE (tenant_id, endpoint_key, locator_type, locator_value),
  CONSTRAINT ck_sync_failure_locator_type CHECK (locator_type IN ('page', 'cursor', 'reference', 'item')),
  CONSTRAINT ck_sync_failure_kind CHECK (failure_kind IN ('http_429', 'transient', 'permanent', 'persist', 'mapping')),
  CONSTRAINT ck_sync_failure_status CHECK (status IN ('pending', 'deferred', 'retrying', 'resolved', 'failed')),
  CONSTRAINT ck_sync_failure_attempts_positive CHECK (attempts > 0),
  CONSTRAINT ck_sync_failure_endpoint_not_blank CHECK (btrim(endpoint_key) <> ''),
  CONSTRAINT ck_sync_failure_locator_not_blank CHECK (btrim(locator_value) <> '')
);

CREATE INDEX ix_sync_failure_backlog_tenant_status_retry ON sync_failure_backlog (tenant_id, status, next_retry_at);
CREATE INDEX ix_sync_failure_backlog_endpoint_status ON sync_failure_backlog (tenant_id, endpoint_key, status);

CREATE TRIGGER trg_sync_failure_backlog_set_updated_at
BEFORE UPDATE ON sync_failure_backlog
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_sync_failure_backlog_prevent_immutable_update
BEFORE UPDATE ON sync_failure_backlog
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'endpoint_key', 'locator_type', 'locator_value', 'first_failed_at', 'created_at');

-- ============================================================================
-- 16) sync_page_log
-- ============================================================================

CREATE TABLE sync_page_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  job_id uuid NOT NULL,
  endpoint_key text NOT NULL,
  page_number integer NULL,
  next_page integer NULL,
  status text NOT NULL,
  rows_fetched integer NOT NULL DEFAULT 0,
  rows_persisted integer NOT NULL DEFAULT 0,
  http_status integer NULL,
  error_message text NULL,
  attempt_no integer NOT NULL DEFAULT 1,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_sync_page_log_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_sync_page_log_job FOREIGN KEY (job_id) REFERENCES sync_job(id) ON DELETE CASCADE,
  CONSTRAINT ck_sync_page_log_status CHECK (status IN ('success', 'failed', 'retry_success', 'retry_failed')),
  CONSTRAINT ck_sync_page_log_endpoint_not_blank CHECK (btrim(endpoint_key) <> ''),
  CONSTRAINT ck_sync_page_log_rows_fetched_nonnegative CHECK (rows_fetched >= 0),
  CONSTRAINT ck_sync_page_log_rows_persisted_nonnegative CHECK (rows_persisted >= 0),
  CONSTRAINT ck_sync_page_log_attempt_positive CHECK (attempt_no > 0)
);

CREATE INDEX ix_sync_page_log_tenant_occurred ON sync_page_log (tenant_id, occurred_at DESC);
CREATE INDEX ix_sync_page_log_job ON sync_page_log (job_id, occurred_at DESC);
CREATE INDEX ix_sync_page_log_endpoint ON sync_page_log (tenant_id, endpoint_key, occurred_at DESC);

COMMIT;
