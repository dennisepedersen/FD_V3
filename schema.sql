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
  suggested_login varchar(4) NULL,
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
  login_status text NOT NULL DEFAULT 'active',
  username varchar(4) NULL,
  session_version integer NOT NULL DEFAULT 0,
  last_invited_at timestamptz NULL,
  invite_accepted_at timestamptz NULL,
  disabled_at timestamptz NULL,
  deactivated_reason text NULL,
  deactivated_by_user_id uuid NULL,
  deactivated_at timestamptz NULL,
  reactivation_requested_at timestamptz NULL,
  reactivation_requested_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_tenant_user_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE RESTRICT,
  CONSTRAINT ck_tenant_user_email_not_blank CHECK (btrim(email) <> ''),
  CONSTRAINT ck_tenant_user_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_tenant_user_role CHECK (role IN ('tenant_admin', 'project_leader', 'technician')),
  CONSTRAINT ck_tenant_user_status CHECK (status IN ('active', 'suspended', 'invited', 'deleted', 'deactivated', 'pending_reactivation')),
  CONSTRAINT ck_tenant_user_login_status CHECK (login_status IN ('imported_no_login','pending_invite','invited','active','disabled','pending_reactivation')),
  CONSTRAINT ck_tenant_user_password_hash_not_blank CHECK (btrim(password_hash) <> '')
);

ALTER TABLE tenant_user
  ADD CONSTRAINT uq_tenant_user_id_tenant UNIQUE (id, tenant_id);

CREATE UNIQUE INDEX uq_tenant_user_tenant_email_ci ON tenant_user (tenant_id, lower(email));
CREATE INDEX ix_tenant_user_tenant_role_status ON tenant_user (tenant_id, role, status);
CREATE INDEX ix_tenant_user_lifecycle_status ON tenant_user (tenant_id, status, login_status);
CREATE INDEX ix_tenant_user_session_version ON tenant_user (tenant_id, id, session_version);
CREATE UNIQUE INDEX tenant_user_username_tenant_uniq ON tenant_user (tenant_id, lower(username)) WHERE username IS NOT NULL;
CREATE INDEX tenant_user_username_idx ON tenant_user (tenant_id, username) WHERE username IS NOT NULL;

CREATE TRIGGER trg_tenant_user_set_updated_at
BEFORE UPDATE ON tenant_user
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_tenant_user_prevent_immutable_update
BEFORE UPDATE ON tenant_user
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'email', 'created_at');

-- ============================================================================
-- 5) tenant_user_lifecycle_event
-- ============================================================================

CREATE TABLE tenant_user_lifecycle_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  tenant_user_id uuid NOT NULL,
  event_type text NOT NULL,
  reason text NULL,
  actor_user_id uuid NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT fk_tenant_user_lifecycle_event_user FOREIGN KEY (tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_tenant_user_lifecycle_event_actor FOREIGN KEY (actor_user_id) REFERENCES tenant_user(id) ON DELETE SET NULL,
  CONSTRAINT ck_tenant_user_lifecycle_event_type CHECK (event_type IN ('deactivated','sessions_revoked','reactivation_requested','reactivation_invite_sent','reactivation_invite_failed','reactivated')),
  CONSTRAINT ck_tenant_user_lifecycle_metadata_is_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX ix_tenant_user_lifecycle_event_user_occurred ON tenant_user_lifecycle_event (tenant_id, tenant_user_id, occurred_at DESC);
CREATE INDEX ix_tenant_user_lifecycle_event_type ON tenant_user_lifecycle_event (event_type, occurred_at DESC);

CREATE TRIGGER trg_tenant_user_lifecycle_event_prevent_update
BEFORE UPDATE ON tenant_user_lifecycle_event
FOR EACH ROW
EXECUTE FUNCTION prevent_update_delete_append_only();

CREATE TRIGGER trg_tenant_user_lifecycle_event_prevent_delete
BEFORE DELETE ON tenant_user_lifecycle_event
FOR EACH ROW
EXECUTE FUNCTION prevent_update_delete_append_only();

-- ============================================================================
-- 6) global_admin_user
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
  CONSTRAINT ck_sync_job_type CHECK (type IN ('bootstrap', 'bootstrap_initial', 'delta', 'retry_backlog', 'manual_full_resync', 'slow_reconciliation')),
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
  is_internal boolean NULL,
  closed_observed_at timestamptz NULL,
  activity_date timestamptz NULL,
  responsible_code text NULL,
  responsible_name text NULL,
  responsible_id text NULL,
  team_leader_code text NULL,
  team_leader_name text NULL,
  team_leader_id text NULL,
  has_v4 boolean NOT NULL DEFAULT false,
  has_v3 boolean NOT NULL DEFAULT false,
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
CREATE INDEX ix_project_core_tenant_team_leader_code_ci ON project_core (tenant_id, lower(btrim(team_leader_code)));
CREATE INDEX ix_project_core_tenant_activity_date ON project_core (tenant_id, activity_date DESC);
CREATE INDEX ix_project_core_tenant_closed_observed ON project_core (tenant_id, closed_observed_at DESC) WHERE is_closed = true;
CREATE INDEX ix_project_core_tenant_visibility_updated ON project_core (tenant_id, has_v4, is_closed, closed_observed_at, updated_at DESC);
CREATE INDEX ix_project_core_tenant_external_ref_norm ON project_core (tenant_id, lower(btrim(external_project_ref))) WHERE external_project_ref IS NOT NULL;

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
  is_work_in_progress boolean NULL,
  last_registration timestamptz NULL,
  last_fitter_hour_date timestamptz NULL,
  calculated_days_since_last_registration integer NULL,
  ready_to_bill boolean NULL,
  margin numeric(14,2) NULL,
  costs numeric(14,2) NULL,
  ongoing numeric(14,2) NULL,
  billed numeric(14,2) NULL,
  coverage numeric(8,2) NULL,
  hours_budget numeric(14,2) NULL,
  hours_expected numeric(14,2) NULL,
  hours_fitter_hour numeric(14,2) NULL,
  remaining_hours numeric(14,2) NULL,
  updated_by_user_id uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_project_wip_project_tenant FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_project_wip_updated_by_user_tenant FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT ck_project_wip_risk_level CHECK (risk_level IS NULL OR risk_level IN ('low', 'medium', 'high', 'critical'))
);

CREATE INDEX ix_project_wip_tenant_stage ON project_wip (tenant_id, current_stage);
CREATE INDEX ix_project_wip_tenant_updated_by ON project_wip (tenant_id, updated_by_user_id);
CREATE INDEX ix_project_wip_tenant_is_work_in_progress ON project_wip (tenant_id, is_work_in_progress);
CREATE INDEX ix_project_wip_tenant_last_registration ON project_wip (tenant_id, last_registration DESC);

CREATE TRIGGER trg_project_wip_set_updated_at
BEFORE UPDATE ON project_wip
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_project_wip_prevent_immutable_update
BEFORE UPDATE ON project_wip
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('project_id', 'tenant_id');

-- ============================================================================
-- 13) project_masterdata_v4
-- ============================================================================

CREATE TABLE project_masterdata_v4 (
  project_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  ek_project_id bigint NULL,
  parent_project_ek_id bigint NULL,
  is_subproject boolean NULL,
  is_closed boolean NULL,
  is_internal boolean NULL,
  responsible_name text NULL,
  project_expected_values jsonb NULL,
  project_budget jsonb NULL,
  associated_address jsonb NULL,
  associated_person jsonb NULL,
  worksheet_ids jsonb NULL,
  total_turn_over_exp numeric(14,2) NULL,
  source_updated_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_project_masterdata_v4_project_tenant FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX ix_project_masterdata_v4_tenant_parent ON project_masterdata_v4 (tenant_id, parent_project_ek_id);
CREATE INDEX ix_project_masterdata_v4_tenant_ek_project_id ON project_masterdata_v4 (tenant_id, ek_project_id);
CREATE UNIQUE INDEX uq_project_masterdata_v4_tenant_ek_project_id ON project_masterdata_v4 (tenant_id, ek_project_id) WHERE ek_project_id IS NOT NULL;
CREATE INDEX ix_project_masterdata_v4_tenant_ek_project_id_text ON project_masterdata_v4 (tenant_id, ((ek_project_id::text))) WHERE ek_project_id IS NOT NULL;
CREATE INDEX ix_project_masterdata_v4_tenant_subproject ON project_masterdata_v4 (tenant_id, is_subproject);
CREATE INDEX ix_project_masterdata_v4_tenant_total_turnover ON project_masterdata_v4 (tenant_id, total_turn_over_exp);

CREATE TRIGGER trg_project_masterdata_v4_set_updated_at
BEFORE UPDATE ON project_masterdata_v4
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_project_masterdata_v4_prevent_immutable_update
BEFORE UPDATE ON project_masterdata_v4
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('project_id', 'tenant_id', 'created_at');

-- ============================================================================
-- 14) project_assignment
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
-- 14) fitter_category
-- ============================================================================

CREATE TABLE fitter_category (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  fitter_category_id text NOT NULL,
  reference text NULL,
  description text NULL,
  display text NULL,
  work_type_id text NULL,
  unit text NULL,
  unit_id text NULL,
  is_on_invoice boolean NULL,
  include_illness boolean NULL,
  hour_rate numeric(14,4) NULL,
  social_fee numeric(14,4) NULL,
  sales_price numeric(14,4) NULL,
  show_in_app boolean NULL,
  is_only_for_internal_projects boolean NULL,
  include_in_salary_calculation boolean NULL,
  salary_company_fitter_category text NULL,
  salary_company_group_by_date boolean NULL,
  salary_company_absence_code text NULL,
  group_fitter_categories_with_same_salary_category boolean NULL,
  show_absence_code boolean NULL,
  bluegarden_salary_type text NULL,
  visma_salary_type text NULL,
  salary_company_use_amount boolean NULL,
  salary_company_use_rate boolean NULL,
  salary_company_use_total boolean NULL,
  lessor_type text NULL,
  lessor_type_id text NULL,
  link text NULL,
  default_cost_code text NULL,
  cost_code_id text NULL,
  cost_code_name text NULL,
  cost_code_alias text NULL,
  sum_cost_code_id text NULL,
  sum_cost_code_name text NULL,
  sum_cost_code_alias text NULL,
  sum_cost_code_display text NULL,
  cost_code_display text NULL,
  raw_payload_json jsonb NULL,
  source_updated_at timestamptz NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_fitter_category_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT ck_fitter_category_id_not_blank CHECK (btrim(fitter_category_id) <> '')
);

CREATE UNIQUE INDEX uq_fitter_category_tenant_external_id
  ON fitter_category (tenant_id, fitter_category_id);

CREATE INDEX ix_fitter_category_tenant_reference
  ON fitter_category (tenant_id, reference);

CREATE INDEX ix_fitter_category_tenant_updated
  ON fitter_category (tenant_id, updated_at DESC);

CREATE TRIGGER trg_fitter_category_set_updated_at
BEFORE UPDATE ON fitter_category
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_fitter_category_prevent_immutable_update
BEFORE UPDATE ON fitter_category
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'fitter_category_id', 'created_at');

-- ============================================================================
-- 14b) fitter
-- ============================================================================

CREATE TABLE fitter (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  fitter_id text NOT NULL,
  name text NULL,
  username text NULL,
  email text NULL,
  phone text NULL,
  salary_id text NULL,
  old_reference text NULL,
  job_position text NULL,
  start_date timestamptz NULL,
  end_date timestamptz NULL,
  is_active_derived boolean NULL,
  is_plannable boolean NULL,
  include_in_export boolean NULL,
  salary_period_type_id text NULL,
  salary_period_type_name text NULL,
  is_sales_person boolean NULL,
  note text NULL,
  show_in_hour_summaries boolean NULL,
  send_email_when_creating_fitter_hour boolean NULL,
  attach_fitter_hour_history_in_salary_email boolean NULL,
  ressource_group_string text NULL,
  resource_groups_json jsonb NULL,
  location_name_string text NULL,
  location_names_json jsonb NULL,
  location_ids_json jsonb NULL,
  fitter_default_work_hours_week_day text NULL,
  fitter_default_work_hours numeric(10,2) NULL,
  fitter_default_work_hours_start_time text NULL,
  fitter_default_work_hours_end_time text NULL,
  show_fitter_rates boolean NULL,
  show_fitter_category_configuration boolean NULL,
  open_background_check_dialog boolean NULL,
  default_cost_code text NULL,
  cost_code_id text NULL,
  sum_cost_code_id text NULL,
  cost_code_display text NULL,
  sum_cost_code_display text NULL,
  raw_payload_json jsonb NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_fitter_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT ck_fitter_id_not_blank CHECK (btrim(fitter_id) <> '')
);

CREATE UNIQUE INDEX uq_fitter_tenant_external_id
  ON fitter (tenant_id, fitter_id);

CREATE INDEX ix_fitter_tenant_username
  ON fitter (tenant_id, username);

CREATE INDEX ix_fitter_tenant_salary_id
  ON fitter (tenant_id, salary_id);

CREATE INDEX ix_fitter_tenant_end_date
  ON fitter (tenant_id, end_date DESC);

CREATE INDEX ix_fitter_tenant_name
  ON fitter (tenant_id, name);

CREATE TRIGGER trg_fitter_set_updated_at
BEFORE UPDATE ON fitter
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_fitter_prevent_immutable_update
BEFORE UPDATE ON fitter
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'fitter_id', 'created_at');

-- ============================================================================
-- 14c) fitter_hour
-- ============================================================================

CREATE TABLE fitter_hour (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  source_key text NOT NULL,
  fitter_hour_id text NULL,
  fd_project_id uuid NULL,
  external_project_ref text NULL,
  project_id text NULL,
  fitter_id text NULL,
  fitter_username text NULL,
  fitter_salary_id text NULL,
  fitter_reference text NULL,
  fitter_category_id text NULL,
  fitter_category_reference text NULL,
  work_date timestamptz NULL,
  registration_date timestamptz NULL,
  hours numeric(12,2) NULL,
  quantity numeric(12,2) NULL,
  unit text NULL,
  note text NULL,
  description text NULL,
  raw_payload_json jsonb NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_fitter_hour_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT ck_fitter_hour_source_key_not_blank CHECK (btrim(source_key) <> '')
);

CREATE UNIQUE INDEX uq_fitter_hour_tenant_source_key
  ON fitter_hour (tenant_id, source_key);

CREATE INDEX ix_fitter_hour_tenant_work_date
  ON fitter_hour (tenant_id, work_date DESC);

CREATE INDEX ix_fitter_hour_tenant_project_ref
  ON fitter_hour (tenant_id, external_project_ref);

CREATE INDEX ix_fitter_hour_tenant_external_ref_norm
  ON fitter_hour (tenant_id, lower(btrim(external_project_ref)))
  WHERE external_project_ref IS NOT NULL;

CREATE INDEX ix_fitter_hour_tenant_project_id_norm
  ON fitter_hour (tenant_id, lower(btrim(project_id)))
  WHERE project_id IS NOT NULL;

CREATE INDEX ix_fitter_hour_tenant_fd_project
  ON fitter_hour (tenant_id, fd_project_id)
  WHERE fd_project_id IS NOT NULL;

CREATE INDEX ix_fitter_hour_tenant_fd_project_work_date
  ON fitter_hour (tenant_id, fd_project_id, work_date DESC, registration_date DESC)
  WHERE fd_project_id IS NOT NULL;

CREATE INDEX ix_fitter_hour_tenant_fitter_id
  ON fitter_hour (tenant_id, fitter_id);

CREATE INDEX ix_fitter_hour_tenant_fitter_category_id
  ON fitter_hour (tenant_id, fitter_category_id);

CREATE TRIGGER trg_fitter_hour_set_updated_at
BEFORE UPDATE ON fitter_hour
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_fitter_hour_prevent_immutable_update
BEFORE UPDATE ON fitter_hour
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'source_key', 'created_at');

-- ============================================================================
-- 15) sync_endpoint_state
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
  current_mode text NULL,
  sync_strategy text NOT NULL DEFAULT 'reconcile_scan',
  current_job_id uuid NULL,
  retry_count integer NOT NULL DEFAULT 0,
  pending_backlog_count integer NOT NULL DEFAULT 0,
  failed_page_count integer NOT NULL DEFAULT 0,
  pages_processed_last_job integer NOT NULL DEFAULT 0,
  rows_fetched_last_job bigint NOT NULL DEFAULT 0,
  last_http_status integer NULL,
  heartbeat_at timestamptz NULL,
  last_seen_remote_cursor text NULL,
  rows_fetched bigint NOT NULL DEFAULT 0,
  rows_persisted bigint NOT NULL DEFAULT 0,
  next_planned_at timestamptz NULL,
  last_error text NULL,
  last_job_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_sync_endpoint_state_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_sync_endpoint_state_job FOREIGN KEY (last_job_id) REFERENCES sync_job(id) ON DELETE SET NULL,
  CONSTRAINT fk_sync_endpoint_state_current_job FOREIGN KEY (current_job_id) REFERENCES sync_job(id) ON DELETE SET NULL,
  CONSTRAINT uq_sync_endpoint_state_tenant_endpoint UNIQUE (tenant_id, endpoint_key),
  CONSTRAINT ck_sync_endpoint_state_status CHECK (status IN ('idle', 'running', 'success', 'partial', 'failed')),
  CONSTRAINT ck_sync_endpoint_state_mode CHECK (current_mode IS NULL OR current_mode IN ('bootstrap_initial', 'delta', 'retry_backlog', 'manual_full_resync', 'slow_reconciliation', 'reconcile_scan')),
  CONSTRAINT ck_sync_endpoint_state_strategy CHECK (sync_strategy IN ('delta_supported', 'reconcile_scan', 'backlog_retry_only', 'not_materialized')),
  CONSTRAINT ck_sync_endpoint_state_endpoint_not_blank CHECK (btrim(endpoint_key) <> ''),
  CONSTRAINT ck_sync_endpoint_state_rows_fetched_nonnegative CHECK (rows_fetched >= 0),
  CONSTRAINT ck_sync_endpoint_state_rows_persisted_nonnegative CHECK (rows_persisted >= 0)
);

CREATE INDEX ix_sync_endpoint_state_tenant_status ON sync_endpoint_state (tenant_id, status);
CREATE INDEX ix_sync_endpoint_state_next_planned ON sync_endpoint_state (next_planned_at);
CREATE INDEX ix_sync_endpoint_state_current_job ON sync_endpoint_state (current_job_id);

CREATE TRIGGER trg_sync_endpoint_state_set_updated_at
BEFORE UPDATE ON sync_endpoint_state
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_sync_endpoint_state_prevent_immutable_update
BEFORE UPDATE ON sync_endpoint_state
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'endpoint_key', 'created_at');

-- ============================================================================
-- 16) sync_failure_backlog
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
-- 17) sync_page_log
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
  mode text NULL,
  retry_count integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  error_text text NULL,
  attempt_no integer NOT NULL DEFAULT 1,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_sync_page_log_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_sync_page_log_job FOREIGN KEY (job_id) REFERENCES sync_job(id) ON DELETE CASCADE,
  CONSTRAINT ck_sync_page_log_status CHECK (status IN ('success', 'failed', 'retry_success', 'retry_failed')),
  CONSTRAINT ck_sync_page_log_mode CHECK (mode IS NULL OR mode IN ('bootstrap_initial', 'delta', 'retry_backlog', 'manual_full_resync', 'slow_reconciliation', 'reconcile_scan')),
  CONSTRAINT ck_sync_page_log_endpoint_not_blank CHECK (btrim(endpoint_key) <> ''),
  CONSTRAINT ck_sync_page_log_rows_fetched_nonnegative CHECK (rows_fetched >= 0),
  CONSTRAINT ck_sync_page_log_rows_persisted_nonnegative CHECK (rows_persisted >= 0),
  CONSTRAINT ck_sync_page_log_attempt_positive CHECK (attempt_no > 0)
);

CREATE INDEX ix_sync_page_log_tenant_occurred ON sync_page_log (tenant_id, occurred_at DESC);
CREATE INDEX ix_sync_page_log_job ON sync_page_log (job_id, occurred_at DESC);
CREATE INDEX ix_sync_page_log_endpoint ON sync_page_log (tenant_id, endpoint_key, occurred_at DESC);

-- ============================================================================
-- 18) project_fitterhours_refresh_status
-- ============================================================================

CREATE TABLE project_fitterhours_refresh_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  ek_project_id bigint NULL,
  external_project_ref text NULL,
  status text NOT NULL DEFAULT 'never_refreshed',
  last_checked_at timestamptz NULL,
  last_refreshed_at timestamptz NULL,
  last_success_at timestamptz NULL,
  last_failure_at timestamptz NULL,
  last_activity_materialized_at timestamptz NULL,
  last_remote_fitterhours_count integer NULL,
  last_inserted integer NULL,
  last_updated integer NULL,
  last_unchanged integer NULL,
  last_error_code text NULL,
  last_error_message text NULL,
  consecutive_failures integer NOT NULL DEFAULT 0,
  next_allowed_refresh_at timestamptz NULL,
  blocked_reason text NULL,
  blocked_payload_json jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_project_fitterhours_refresh_status_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_fitterhours_refresh_status_project
    FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT uq_project_fitterhours_refresh_status_project UNIQUE (tenant_id, project_id),
  CONSTRAINT ck_project_fitterhours_refresh_status_status CHECK (
    status IN (
      'never_refreshed',
      'ready',
      'fresh',
      'stale',
      'refreshing',
      'failed',
      'blocked_reference_mismatch',
      'blocked_cross_project_conflict',
      'blocked_fd_project_mismatch',
      'blocked_duplicate_source_keys',
      'blocked_large'
    )
  ),
  CONSTRAINT ck_project_fitterhours_refresh_status_counts CHECK (
    COALESCE(last_remote_fitterhours_count, 0) >= 0
    AND COALESCE(last_inserted, 0) >= 0
    AND COALESCE(last_updated, 0) >= 0
    AND COALESCE(last_unchanged, 0) >= 0
    AND consecutive_failures >= 0
  )
);

CREATE INDEX ix_project_fitterhours_refresh_status_tenant_status
  ON project_fitterhours_refresh_status (tenant_id, status, updated_at DESC);

CREATE INDEX ix_project_fitterhours_refresh_status_tenant_project
  ON project_fitterhours_refresh_status (tenant_id, project_id);

CREATE INDEX ix_project_fitterhours_refresh_status_tenant_next_allowed
  ON project_fitterhours_refresh_status (tenant_id, next_allowed_refresh_at)
  WHERE next_allowed_refresh_at IS NOT NULL;

CREATE INDEX ix_project_fitterhours_refresh_status_tenant_ek_project
  ON project_fitterhours_refresh_status (tenant_id, ek_project_id)
  WHERE ek_project_id IS NOT NULL;

CREATE TRIGGER trg_project_fitterhours_refresh_status_set_updated_at
BEFORE UPDATE ON project_fitterhours_refresh_status
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_project_fitterhours_refresh_status_prevent_immutable_update
BEFORE UPDATE ON project_fitterhours_refresh_status
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'project_id', 'created_at');

-- ============================================================================
-- 19) targeted_fitterhours_refresh_runs
-- ============================================================================

CREATE TABLE targeted_fitterhours_refresh_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NULL,
  ek_project_id bigint NULL,
  external_project_ref text NULL,
  trigger_type text NOT NULL,
  triggered_by_user_id uuid NULL,
  status text NOT NULL,
  reference_match boolean NULL,
  live_reference text NULL,
  duplicate_source_keys_count integer NOT NULL DEFAULT 0,
  cross_project_conflict_count integer NOT NULL DEFAULT 0,
  fd_project_id_mismatch_count integer NOT NULL DEFAULT 0,
  size_class text NULL,
  remote_rows integer NULL,
  mapped_rows integer NULL,
  inserted integer NOT NULL DEFAULT 0,
  updated integer NOT NULL DEFAULT 0,
  unchanged integer NOT NULL DEFAULT 0,
  deleted integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  duration_ms integer NULL,
  error_code text NULL,
  error_message text NULL,
  raw_summary_json jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_targeted_fitterhours_refresh_runs_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_targeted_fitterhours_refresh_runs_project
    FOREIGN KEY (project_id) REFERENCES project_core(project_id) ON DELETE SET NULL,
  CONSTRAINT fk_targeted_fitterhours_refresh_runs_triggered_by_user
    FOREIGN KEY (triggered_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT ck_targeted_fitterhours_refresh_runs_trigger_type CHECK (
    trigger_type IN ('maintenance', 'admin', 'on_demand', 'scheduler', 'onboarding_backfill')
  ),
  CONSTRAINT ck_targeted_fitterhours_refresh_runs_status CHECK (
    status IN ('ready', 'success', 'failed', 'blocked', 'skipped', 'rate_limited')
  ),
  CONSTRAINT ck_targeted_fitterhours_refresh_runs_size_class CHECK (
    size_class IS NULL OR size_class IN ('SMALL', 'MEDIUM', 'LARGE')
  ),
  CONSTRAINT ck_targeted_fitterhours_refresh_runs_counts CHECK (
    duplicate_source_keys_count >= 0
    AND cross_project_conflict_count >= 0
    AND fd_project_id_mismatch_count >= 0
    AND COALESCE(remote_rows, 0) >= 0
    AND COALESCE(mapped_rows, 0) >= 0
    AND inserted >= 0
    AND updated >= 0
    AND unchanged >= 0
    AND deleted >= 0
    AND COALESCE(duration_ms, 0) >= 0
  )
);

CREATE INDEX ix_targeted_fitterhours_refresh_runs_tenant_project_started
  ON targeted_fitterhours_refresh_runs (tenant_id, project_id, started_at DESC);

CREATE INDEX ix_targeted_fitterhours_refresh_runs_tenant_status_started
  ON targeted_fitterhours_refresh_runs (tenant_id, status, started_at DESC);

CREATE INDEX ix_targeted_fitterhours_refresh_runs_tenant_trigger_started
  ON targeted_fitterhours_refresh_runs (tenant_id, trigger_type, started_at DESC);

CREATE INDEX ix_targeted_fitterhours_refresh_runs_tenant_ek_project
  ON targeted_fitterhours_refresh_runs (tenant_id, ek_project_id)
  WHERE ek_project_id IS NOT NULL;

-- ============================================================================
-- 20) merge_links
-- ============================================================================

CREATE TABLE merge_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_type text NOT NULL,
  master_entity_id uuid NOT NULL,
  merged_entity_id uuid NOT NULL,
  merge_status text NOT NULL DEFAULT 'suggested',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_merge_links_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT ck_merge_links_entity_type_not_blank CHECK (btrim(entity_type) <> ''),
  CONSTRAINT ck_merge_links_status CHECK (merge_status IN ('suggested', 'confirmed', 'rejected', 'unmerged')),
  CONSTRAINT ck_merge_links_distinct_entities CHECK (master_entity_id <> merged_entity_id),
  CONSTRAINT uq_merge_links_pair UNIQUE (tenant_id, entity_type, master_entity_id, merged_entity_id)
);

CREATE INDEX ix_merge_links_master_entity ON merge_links (tenant_id, entity_type, master_entity_id);
CREATE INDEX ix_merge_links_merged_entity ON merge_links (tenant_id, entity_type, merged_entity_id);

-- ============================================================================
-- 19) qa_threads
-- ============================================================================

CREATE TABLE qa_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  title text NULL,
  status text NOT NULL DEFAULT 'NEW',
  priority text NOT NULL DEFAULT 'normal',
  created_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_qa_threads_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_qa_threads_project FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_qa_threads_created_by_user FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT uq_qa_threads_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT ck_qa_threads_status CHECK (status IN ('NEW', 'WAITING', 'ANSWERED', 'CLOSED')),
  CONSTRAINT ck_qa_threads_priority CHECK (priority IN ('low', 'normal', 'high')),
  CONSTRAINT ck_qa_threads_title_not_blank CHECK (title IS NULL OR btrim(title) <> '')
);

CREATE INDEX ix_qa_threads_tenant_project ON qa_threads (tenant_id, project_id);
CREATE INDEX ix_qa_threads_tenant_status ON qa_threads (tenant_id, status);

CREATE TRIGGER trg_qa_threads_set_updated_at
BEFORE UPDATE ON qa_threads
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_qa_threads_prevent_immutable_update
BEFORE UPDATE ON qa_threads
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'project_id', 'created_by_user_id', 'created_at');

-- ============================================================================
-- 20) qa_messages
-- ============================================================================

CREATE TABLE qa_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  project_id uuid NOT NULL,
  user_id uuid NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz NULL,
  deleted_at timestamptz NULL,
  CONSTRAINT fk_qa_messages_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_qa_messages_thread_tenant FOREIGN KEY (thread_id, tenant_id) REFERENCES qa_threads(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_qa_messages_project FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_qa_messages_user FOREIGN KEY (user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT ck_qa_messages_message_not_blank CHECK (btrim(message) <> ''),
  CONSTRAINT ck_qa_messages_edit_after_create CHECK (edited_at IS NULL OR edited_at >= created_at),
  CONSTRAINT ck_qa_messages_delete_after_create CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);

CREATE INDEX ix_qa_messages_tenant_thread ON qa_messages (tenant_id, thread_id);
CREATE INDEX ix_qa_messages_project ON qa_messages (tenant_id, project_id);

-- ============================================================================
-- 21) qa_thread_participants
-- ============================================================================

CREATE TABLE qa_thread_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  project_id uuid NOT NULL,
  tenant_user_id uuid NOT NULL,
  participant_role text NOT NULL DEFAULT 'participant',
  is_assigned boolean NOT NULL DEFAULT false,
  assigned_at timestamptz NULL,
  assigned_by_user_id uuid NULL,
  last_seen_at timestamptz NULL,
  last_seen_message_id uuid NULL,
  visibility_source text NOT NULL DEFAULT 'explicit',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_qa_thread_participants_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_qa_thread_participants_thread_tenant FOREIGN KEY (thread_id, tenant_id) REFERENCES qa_threads(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_qa_thread_participants_project FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_qa_thread_participants_user FOREIGN KEY (tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_qa_thread_participants_assigned_by FOREIGN KEY (assigned_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_qa_thread_participants_last_seen_message FOREIGN KEY (last_seen_message_id) REFERENCES qa_messages(id) ON DELETE SET NULL,
  CONSTRAINT uq_qa_thread_participants_thread_user UNIQUE (tenant_id, thread_id, tenant_user_id),
  CONSTRAINT ck_qa_thread_participants_role CHECK (participant_role IN ('creator', 'recipient', 'participant', 'watcher')),
  CONSTRAINT ck_qa_thread_participants_visibility_source CHECK (visibility_source IN ('explicit', 'project_assignment', 'project_owner', 'responsible', 'team_leader', 'self')),
  CONSTRAINT ck_qa_thread_participants_assigned_at CHECK (
    (is_assigned = false AND assigned_at IS NULL)
    OR
    (is_assigned = true)
  )
);

CREATE INDEX ix_qa_thread_participants_user_active
  ON qa_thread_participants (tenant_id, tenant_user_id, active, updated_at DESC);

CREATE INDEX ix_qa_thread_participants_project_thread
  ON qa_thread_participants (tenant_id, project_id, thread_id);

CREATE INDEX ix_qa_thread_participants_thread
  ON qa_thread_participants (tenant_id, thread_id);

CREATE TRIGGER trg_qa_thread_participants_set_updated_at
BEFORE UPDATE ON qa_thread_participants
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_qa_thread_participants_prevent_immutable_update
BEFORE UPDATE ON qa_thread_participants
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'thread_id', 'project_id', 'tenant_user_id', 'created_at');

-- ============================================================================
-- 22) resource_absences
-- ============================================================================

CREATE TABLE resource_absences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  -- V1 links absence to the imported fitter identity. A neutral resource_person
  -- model can be added later without renaming this Fielddesk-owned table.
  fitter_id text NOT NULL,
  absence_type text NOT NULL,
  status text NOT NULL DEFAULT 'approved',
  start_date date NOT NULL,
  end_date date NOT NULL,
  note text NULL,
  visibility_scope text NOT NULL DEFAULT 'tenant_admin_only',
  source_type text NULL,
  idempotency_key text NULL,
  idempotency_payload_hash text NULL,
  idempotency_segment_index integer NULL,
  created_by_user_id uuid NULL,
  updated_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz NULL,
  cancelled_by_user_id uuid NULL,
  CONSTRAINT fk_resource_absences_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_resource_absences_fitter
    FOREIGN KEY (tenant_id, fitter_id) REFERENCES fitter(tenant_id, fitter_id) ON DELETE RESTRICT,
  CONSTRAINT fk_resource_absences_created_by_user
    FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_resource_absences_updated_by_user
    FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_resource_absences_cancelled_by_user
    FOREIGN KEY (cancelled_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT ck_resource_absences_type CHECK (
    absence_type IN ('vacation', 'vacation_free', 'course', 'sickness', 'other')
  ),
  CONSTRAINT ck_resource_absences_status CHECK (
    status IN ('draft', 'requested', 'approved', 'rejected', 'cancelled')
  ),
  CONSTRAINT ck_resource_absences_visibility_scope CHECK (
    visibility_scope IN ('tenant_admin_only', 'limited_availability', 'manager_full', 'finance_relevant', 'custom')
  ),
  CONSTRAINT ck_resource_absences_source_type CHECK (
    source_type IS NULL OR source_type IN ('direct_registration', 'legacy_resource_absence')
  ),
  CONSTRAINT ck_resource_absences_date_range CHECK (end_date >= start_date),
  CONSTRAINT ck_resource_absences_note_not_blank CHECK (note IS NULL OR btrim(note) <> ''),
  CONSTRAINT ck_resource_absences_idempotency_key CHECK (
    idempotency_key IS NULL OR (btrim(idempotency_key) <> '' AND char_length(idempotency_key) <= 160)
  ),
  CONSTRAINT ck_resource_absences_idempotency_payload_hash CHECK (
    idempotency_payload_hash IS NULL OR idempotency_payload_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT ck_resource_absences_idempotency_segment_index CHECK (
    idempotency_segment_index IS NULL OR idempotency_segment_index >= 1
  ),
  CONSTRAINT ck_resource_absences_cancelled_state CHECK (
    (status = 'cancelled' AND cancelled_at IS NOT NULL)
    OR
    (status <> 'cancelled' AND cancelled_at IS NULL AND cancelled_by_user_id IS NULL)
  )
);

CREATE INDEX ix_resource_absences_tenant_range
  ON resource_absences (tenant_id, start_date, end_date);

CREATE INDEX ix_resource_absences_tenant_fitter_range
  ON resource_absences (tenant_id, fitter_id, start_date, end_date);

CREATE INDEX ix_resource_absences_tenant_status_range
  ON resource_absences (tenant_id, status, start_date, end_date);

CREATE UNIQUE INDEX uq_resource_absences_direct_idempotency
  ON resource_absences (tenant_id, created_by_user_id, idempotency_key, idempotency_segment_index)
  WHERE idempotency_key IS NOT NULL AND created_by_user_id IS NOT NULL;

CREATE INDEX ix_resource_absences_tenant_fitter_status_range
  ON resource_absences (tenant_id, fitter_id, status, start_date, end_date);

CREATE TRIGGER trg_resource_absences_set_updated_at
BEFORE UPDATE ON resource_absences
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_resource_absences_prevent_immutable_update
BEFORE UPDATE ON resource_absences
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'fitter_id', 'created_by_user_id', 'created_at');

-- ============================================================================
-- 23) resource_groups
-- ============================================================================

CREATE TABLE resource_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  description text NULL,
  status text NOT NULL DEFAULT 'active',
  created_by_user_id uuid NULL,
  updated_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_resource_groups_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_resource_groups_created_by_user
    FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_resource_groups_updated_by_user
    FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT ck_resource_groups_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_resource_groups_description_not_blank CHECK (description IS NULL OR btrim(description) <> ''),
  CONSTRAINT ck_resource_groups_status CHECK (status IN ('active', 'archived'))
);

ALTER TABLE resource_groups
  ADD CONSTRAINT uq_resource_groups_id_tenant UNIQUE (id, tenant_id);

CREATE UNIQUE INDEX uq_resource_groups_tenant_name_ci
  ON resource_groups (tenant_id, lower(name));

CREATE INDEX ix_resource_groups_tenant_status
  ON resource_groups (tenant_id, status, name);

CREATE INDEX ix_resource_groups_created_by
  ON resource_groups (tenant_id, created_by_user_id);

CREATE TRIGGER trg_resource_groups_set_updated_at
BEFORE UPDATE ON resource_groups
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_resource_groups_prevent_immutable_update
BEFORE UPDATE ON resource_groups
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'created_by_user_id', 'created_at');

-- ============================================================================
-- 24) resource_group_members
-- ============================================================================

CREATE TABLE resource_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  group_id uuid NOT NULL,
  -- V1 resource group membership references the current fitter identity. A
  -- neutral resource_person model can be added later without changing group
  -- ownership semantics.
  fitter_id text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_by_user_id uuid NULL,
  updated_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_resource_group_members_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_resource_group_members_group
    FOREIGN KEY (group_id, tenant_id) REFERENCES resource_groups(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_resource_group_members_fitter
    FOREIGN KEY (tenant_id, fitter_id) REFERENCES fitter(tenant_id, fitter_id) ON DELETE RESTRICT,
  CONSTRAINT fk_resource_group_members_created_by_user
    FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_resource_group_members_updated_by_user
    FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL
);

ALTER TABLE resource_group_members
  ADD CONSTRAINT uq_resource_group_members_id_tenant UNIQUE (id, tenant_id);

CREATE UNIQUE INDEX uq_resource_group_members_group_fitter
  ON resource_group_members (tenant_id, group_id, fitter_id);

CREATE INDEX ix_resource_group_members_tenant_fitter
  ON resource_group_members (tenant_id, fitter_id);

CREATE INDEX ix_resource_group_members_tenant_group
  ON resource_group_members (tenant_id, group_id);

CREATE TRIGGER trg_resource_group_members_set_updated_at
BEFORE UPDATE ON resource_group_members
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_resource_group_members_prevent_immutable_update
BEFORE UPDATE ON resource_group_members
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'group_id', 'fitter_id', 'created_by_user_id', 'created_at');

-- ============================================================================
-- 25) resource_group_managers
-- ============================================================================

CREATE TABLE resource_group_managers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  group_id uuid NOT NULL,
  tenant_user_id uuid NOT NULL,
  manager_role text NOT NULL DEFAULT 'manager',
  created_by_user_id uuid NULL,
  updated_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_resource_group_managers_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_resource_group_managers_group
    FOREIGN KEY (group_id, tenant_id) REFERENCES resource_groups(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_resource_group_managers_user
    FOREIGN KEY (tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_resource_group_managers_created_by_user
    FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_resource_group_managers_updated_by_user
    FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT ck_resource_group_managers_role CHECK (manager_role IN ('owner', 'manager', 'viewer'))
);

ALTER TABLE resource_group_managers
  ADD CONSTRAINT uq_resource_group_managers_id_tenant UNIQUE (id, tenant_id);

CREATE UNIQUE INDEX uq_resource_group_managers_group_user
  ON resource_group_managers (tenant_id, group_id, tenant_user_id);

CREATE INDEX ix_resource_group_managers_tenant_user
  ON resource_group_managers (tenant_id, tenant_user_id);

CREATE INDEX ix_resource_group_managers_tenant_group_role
  ON resource_group_managers (tenant_id, group_id, manager_role);

CREATE TRIGGER trg_resource_group_managers_set_updated_at
BEFORE UPDATE ON resource_group_managers
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_resource_group_managers_prevent_immutable_update
BEFORE UPDATE ON resource_group_managers
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'group_id', 'tenant_user_id', 'created_by_user_id', 'created_at');

-- ============================================================================
-- 23) project_equipment_cctv beta
-- ============================================================================

CREATE TABLE project_equipment_cctv (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  equipment_area text NOT NULL DEFAULT 'cctv',
  camera_id text NOT NULL,
  mac_address text NULL,
  mac_address_normalized text NULL,
  serial_number text NULL,
  model text NULL,
  location_text text NULL,
  status text NOT NULL DEFAULT 'registered',
  note text NULL,
  created_by_user_id uuid NULL,
  updated_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz NULL,
  CONSTRAINT fk_project_equipment_cctv_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_equipment_cctv_project FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_equipment_cctv_created_by_user FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_project_equipment_cctv_updated_by_user FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT uq_project_equipment_cctv_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT ck_project_equipment_cctv_area CHECK (equipment_area = 'cctv'),
  CONSTRAINT ck_project_equipment_cctv_camera_id_not_blank CHECK (btrim(camera_id) <> ''),
  CONSTRAINT ck_project_equipment_cctv_mac_not_blank CHECK (mac_address IS NULL OR btrim(mac_address) <> ''),
  CONSTRAINT ck_project_equipment_cctv_mac_normalized CHECK (mac_address_normalized IS NULL OR mac_address_normalized ~ '^[0-9A-F]{12}$'),
  CONSTRAINT ck_project_equipment_cctv_serial_not_blank CHECK (serial_number IS NULL OR btrim(serial_number) <> ''),
  CONSTRAINT ck_project_equipment_cctv_model_not_blank CHECK (model IS NULL OR btrim(model) <> ''),
  CONSTRAINT ck_project_equipment_cctv_location_not_blank CHECK (location_text IS NULL OR btrim(location_text) <> ''),
  CONSTRAINT ck_project_equipment_cctv_status CHECK (status IN ('registered', 'planned', 'mounted', 'checked', 'deviation')),
  CONSTRAINT ck_project_equipment_cctv_note_not_blank CHECK (note IS NULL OR btrim(note) <> ''),
  CONSTRAINT ck_project_equipment_cctv_archived_after_create CHECK (archived_at IS NULL OR archived_at >= created_at)
);

CREATE INDEX ix_project_equipment_cctv_project_status
  ON project_equipment_cctv (tenant_id, project_id, status, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX ix_project_equipment_cctv_project_camera
  ON project_equipment_cctv (tenant_id, project_id, lower(camera_id))
  WHERE archived_at IS NULL;

CREATE UNIQUE INDEX uq_project_equipment_cctv_project_mac_active
  ON project_equipment_cctv (tenant_id, project_id, mac_address_normalized)
  WHERE archived_at IS NULL AND mac_address_normalized IS NOT NULL;

CREATE UNIQUE INDEX uq_project_equipment_cctv_project_serial_active
  ON project_equipment_cctv (tenant_id, project_id, lower(serial_number))
  WHERE archived_at IS NULL AND serial_number IS NOT NULL;

CREATE TRIGGER trg_project_equipment_cctv_set_updated_at
BEFORE UPDATE ON project_equipment_cctv
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_project_equipment_cctv_prevent_immutable_update
BEFORE UPDATE ON project_equipment_cctv
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'project_id', 'equipment_area', 'created_by_user_id', 'created_at');

-- ============================================================================
-- 24) storage foundation
-- ============================================================================

CREATE TABLE storage_object (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NULL,
  module_key text NULL,
  resource_type text NULL,
  resource_id text NULL,
  storage_provider text NOT NULL DEFAULT 'azure_blob',
  storage_key text NOT NULL,
  original_filename text NULL,
  content_type text NOT NULL,
  byte_size bigint NOT NULL,
  checksum_sha256 text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid NULL,
  deleted_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  CONSTRAINT fk_storage_object_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_storage_object_project FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_storage_object_created_by_user FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_storage_object_deleted_by_user FOREIGN KEY (deleted_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT uq_storage_object_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT uq_storage_object_provider_key UNIQUE (storage_provider, storage_key),
  CONSTRAINT ck_storage_object_provider CHECK (storage_provider = 'azure_blob'),
  CONSTRAINT ck_storage_object_key_not_blank CHECK (btrim(storage_key) <> ''),
  CONSTRAINT ck_storage_object_original_filename_not_blank CHECK (original_filename IS NULL OR btrim(original_filename) <> ''),
  CONSTRAINT ck_storage_object_content_type_not_blank CHECK (btrim(content_type) <> ''),
  CONSTRAINT ck_storage_object_byte_size CHECK (byte_size >= 0),
  CONSTRAINT ck_storage_object_checksum_sha256 CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT ck_storage_object_metadata_is_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT ck_storage_object_deleted_state CHECK (
    (deleted_at IS NULL AND deleted_by_user_id IS NULL)
    OR deleted_at IS NOT NULL
  )
);

CREATE INDEX ix_storage_object_tenant_project_active
  ON storage_object (tenant_id, project_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX ix_storage_object_resource_active
  ON storage_object (tenant_id, module_key, resource_type, resource_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_storage_object_set_updated_at
BEFORE UPDATE ON storage_object
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_storage_object_prevent_immutable_update
BEFORE UPDATE ON storage_object
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'project_id', 'storage_provider', 'storage_key', 'created_by_user_id', 'created_at');

-- ============================================================================
-- 25) project equipment CCTV image slots
-- ============================================================================

CREATE TABLE project_equipment_cctv_image (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  camera_record_id uuid NOT NULL,
  storage_object_id uuid NOT NULL,
  slot_type text NOT NULL,
  created_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_by_user_id uuid NULL,
  deleted_at timestamptz NULL,
  CONSTRAINT fk_project_equipment_cctv_image_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_equipment_cctv_image_project FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_equipment_cctv_image_camera FOREIGN KEY (camera_record_id, tenant_id) REFERENCES project_equipment_cctv(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_project_equipment_cctv_image_storage_object FOREIGN KEY (storage_object_id, tenant_id) REFERENCES storage_object(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_equipment_cctv_image_created_by_user FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_project_equipment_cctv_image_updated_by_user FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_project_equipment_cctv_image_deleted_by_user FOREIGN KEY (deleted_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT uq_project_equipment_cctv_image_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT ck_project_equipment_cctv_image_slot CHECK (slot_type IN ('projection', 'installation')),
  CONSTRAINT ck_project_equipment_cctv_image_deleted_state CHECK (
    (deleted_at IS NULL AND deleted_by_user_id IS NULL)
    OR deleted_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX uq_project_equipment_cctv_image_active_slot
  ON project_equipment_cctv_image (tenant_id, project_id, camera_record_id, slot_type)
  WHERE deleted_at IS NULL;

CREATE INDEX ix_project_equipment_cctv_image_camera_active
  ON project_equipment_cctv_image (tenant_id, project_id, camera_record_id, slot_type)
  WHERE deleted_at IS NULL;

CREATE INDEX ix_project_equipment_cctv_image_storage_object
  ON project_equipment_cctv_image (tenant_id, storage_object_id);

CREATE TRIGGER trg_project_equipment_cctv_image_set_updated_at
BEFORE UPDATE ON project_equipment_cctv_image
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_project_equipment_cctv_image_prevent_immutable_update
BEFORE UPDATE ON project_equipment_cctv_image
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'project_id', 'camera_record_id', 'storage_object_id', 'slot_type', 'created_by_user_id', 'created_at');


-- ============================================================================
-- 26) project equipment CCTV drawings and pins
-- ============================================================================

CREATE TABLE project_equipment_drawing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  equipment_area text NOT NULL DEFAULT 'cctv',
  storage_object_id uuid NOT NULL,
  source_type text NOT NULL DEFAULT 'image',
  source_storage_object_id uuid NULL,
  pdf_page_number integer NULL,
  page_order integer NOT NULL DEFAULT 0,
  source_filename text NULL,
  title text NOT NULL,
  created_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_by_user_id uuid NULL,
  deleted_at timestamptz NULL,
  CONSTRAINT fk_project_equipment_drawing_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_equipment_drawing_project FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_equipment_drawing_storage_object FOREIGN KEY (storage_object_id, tenant_id) REFERENCES storage_object(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_equipment_drawing_source_storage_object FOREIGN KEY (source_storage_object_id, tenant_id) REFERENCES storage_object(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_equipment_drawing_created_by_user FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_project_equipment_drawing_updated_by_user FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_project_equipment_drawing_deleted_by_user FOREIGN KEY (deleted_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT uq_project_equipment_drawing_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT ck_project_equipment_drawing_area CHECK (equipment_area = 'cctv'),
  CONSTRAINT ck_project_equipment_drawing_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT ck_project_equipment_drawing_source_type CHECK (source_type IN ('image', 'pdf_page')),
  CONSTRAINT ck_project_equipment_drawing_pdf_page_state CHECK (
    (source_type = 'image' AND pdf_page_number IS NULL)
    OR (source_type = 'pdf_page' AND source_storage_object_id IS NOT NULL AND pdf_page_number IS NOT NULL AND pdf_page_number > 0)
  ),
  CONSTRAINT ck_project_equipment_drawing_deleted_state CHECK (
    (deleted_at IS NULL AND deleted_by_user_id IS NULL)
    OR deleted_at IS NOT NULL
  )
);

CREATE INDEX ix_project_equipment_drawing_project_active
  ON project_equipment_drawing (tenant_id, project_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX ix_project_equipment_drawing_storage_object
  ON project_equipment_drawing (tenant_id, storage_object_id);

CREATE INDEX ix_project_equipment_drawing_project_order_active
  ON project_equipment_drawing (tenant_id, project_id, page_order ASC, created_at ASC)
  WHERE deleted_at IS NULL;

CREATE INDEX ix_project_equipment_drawing_source_storage_object
  ON project_equipment_drawing (tenant_id, source_storage_object_id)
  WHERE source_storage_object_id IS NOT NULL;

CREATE TRIGGER trg_project_equipment_drawing_set_updated_at
BEFORE UPDATE ON project_equipment_drawing
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_project_equipment_drawing_prevent_immutable_update
BEFORE UPDATE ON project_equipment_drawing
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'project_id', 'equipment_area', 'storage_object_id', 'created_by_user_id', 'created_at');

CREATE TABLE project_equipment_cctv_pin (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  drawing_id uuid NOT NULL,
  camera_record_id uuid NOT NULL,
  coordinate_mode text NOT NULL DEFAULT 'percent',
  x_percent numeric(6,3) NOT NULL,
  y_percent numeric(6,3) NOT NULL,
  label text NULL,
  created_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_by_user_id uuid NULL,
  deleted_at timestamptz NULL,
  CONSTRAINT fk_project_equipment_cctv_pin_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_equipment_cctv_pin_project FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_equipment_cctv_pin_drawing FOREIGN KEY (drawing_id, tenant_id) REFERENCES project_equipment_drawing(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_project_equipment_cctv_pin_camera FOREIGN KEY (camera_record_id, tenant_id) REFERENCES project_equipment_cctv(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_project_equipment_cctv_pin_created_by_user FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_project_equipment_cctv_pin_updated_by_user FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_project_equipment_cctv_pin_deleted_by_user FOREIGN KEY (deleted_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT uq_project_equipment_cctv_pin_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT ck_project_equipment_cctv_pin_coordinate_mode CHECK (coordinate_mode = 'percent'),
  CONSTRAINT ck_project_equipment_cctv_pin_x_percent CHECK (x_percent >= 0 AND x_percent <= 100),
  CONSTRAINT ck_project_equipment_cctv_pin_y_percent CHECK (y_percent >= 0 AND y_percent <= 100),
  CONSTRAINT ck_project_equipment_cctv_pin_label_not_blank CHECK (label IS NULL OR btrim(label) <> ''),
  CONSTRAINT ck_project_equipment_cctv_pin_deleted_state CHECK (
    (deleted_at IS NULL AND deleted_by_user_id IS NULL)
    OR deleted_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX uq_project_equipment_cctv_pin_active_camera_drawing
  ON project_equipment_cctv_pin (tenant_id, project_id, drawing_id, camera_record_id)
  WHERE deleted_at IS NULL;

CREATE INDEX ix_project_equipment_cctv_pin_drawing_active
  ON project_equipment_cctv_pin (tenant_id, project_id, drawing_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX ix_project_equipment_cctv_pin_camera_active
  ON project_equipment_cctv_pin (tenant_id, project_id, camera_record_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_project_equipment_cctv_pin_set_updated_at
BEFORE UPDATE ON project_equipment_cctv_pin
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_project_equipment_cctv_pin_prevent_immutable_update
BEFORE UPDATE ON project_equipment_cctv_pin
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'project_id', 'drawing_id', 'camera_record_id', 'coordinate_mode', 'created_by_user_id', 'created_at');
-- ============================================================================
-- 27) project restarbejde foundation
-- ============================================================================

CREATE TABLE project_restarbejde_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  description text NULL,
  trade_key text NOT NULL,
  status text NOT NULL,
  priority text NULL,
  risk text NULL,
  location_text text NULL,
  assigned_tenant_user_id uuid NULL,
  responsible_text text NULL,
  deadline date NULL,
  percent_complete integer NULL,
  external_party text NULL,
  blocks_delivery boolean NOT NULL DEFAULT false,
  escalated boolean NOT NULL DEFAULT false,
  can_internal_team_act boolean NULL,
  comment text NULL,
  source text NULL,
  external_import_id text NULL,
  external_import_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid NOT NULL,
  updated_by_user_id uuid NOT NULL,
  closed_at timestamptz NULL,
  closed_by_user_id uuid NULL,
  archived_at timestamptz NULL,
  archived_by_user_id uuid NULL,
  CONSTRAINT fk_project_restarbejde_item_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_restarbejde_item_project FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_item_assigned_user FOREIGN KEY (assigned_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (assigned_tenant_user_id),
  CONSTRAINT fk_project_restarbejde_item_created_by_user FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_item_updated_by_user FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_item_closed_by_user FOREIGN KEY (closed_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (closed_by_user_id),
  CONSTRAINT fk_project_restarbejde_item_archived_by_user FOREIGN KEY (archived_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (archived_by_user_id),
  CONSTRAINT uq_project_restarbejde_item_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT ck_project_restarbejde_item_kind CHECK (kind IN ('internal_defect', 'obs')),
  CONSTRAINT ck_project_restarbejde_item_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT ck_project_restarbejde_item_trade_key_not_blank CHECK (btrim(trade_key) <> ''),
  CONSTRAINT ck_project_restarbejde_item_text_not_blank CHECK (
    (description IS NULL OR btrim(description) <> '')
    AND (location_text IS NULL OR btrim(location_text) <> '')
    AND (responsible_text IS NULL OR btrim(responsible_text) <> '')
    AND (external_party IS NULL OR btrim(external_party) <> '')
    AND (comment IS NULL OR btrim(comment) <> '')
    AND (source IS NULL OR btrim(source) <> '')
    AND (external_import_id IS NULL OR btrim(external_import_id) <> '')
  ),
  CONSTRAINT ck_project_restarbejde_item_kind_status CHECK (
    (kind = 'internal_defect' AND status IN ('open', 'in_progress', 'ready_for_review', 'closed'))
    OR (kind = 'obs' AND status IN ('open', 'monitoring', 'blocking', 'resolved'))
  ),
  CONSTRAINT ck_project_restarbejde_item_priority_risk CHECK (
    (kind = 'internal_defect' AND priority IN ('low', 'normal', 'high', 'critical') AND risk IS NULL)
    OR (kind = 'obs' AND risk IN ('low', 'medium', 'high', 'critical') AND priority IS NULL)
  ),
  CONSTRAINT ck_project_restarbejde_item_percent CHECK (
    (kind = 'internal_defect' AND percent_complete IS NOT NULL AND percent_complete >= 0 AND percent_complete <= 100)
    OR (kind = 'obs' AND percent_complete IS NULL)
  ),
  CONSTRAINT ck_project_restarbejde_item_closed_state CHECK (
    (kind = 'internal_defect' AND status = 'closed' AND percent_complete = 100 AND closed_at IS NOT NULL AND closed_by_user_id IS NOT NULL)
    OR ((kind <> 'internal_defect' OR status <> 'closed') AND closed_at IS NULL AND closed_by_user_id IS NULL)
  ),
  CONSTRAINT ck_project_restarbejde_item_obs_resolved_percent CHECK (
    kind <> 'obs' OR status <> 'resolved' OR percent_complete IS NULL
  ),
  CONSTRAINT ck_project_restarbejde_item_archive_state CHECK (
    (archived_at IS NULL AND archived_by_user_id IS NULL)
    OR (archived_at IS NOT NULL AND archived_by_user_id IS NOT NULL AND archived_at >= created_at)
  ),
  CONSTRAINT ck_project_restarbejde_item_import_source_required CHECK (
    external_import_id IS NULL OR (source IS NOT NULL AND btrim(source) <> '')
  ),
  CONSTRAINT ck_project_restarbejde_item_import_payload_is_object CHECK (jsonb_typeof(external_import_payload) = 'object')
);

CREATE INDEX ix_project_restarbejde_item_project_active
  ON project_restarbejde_item (tenant_id, project_id, kind, status, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX ix_project_restarbejde_item_project_archived
  ON project_restarbejde_item (tenant_id, project_id, archived_at DESC)
  WHERE archived_at IS NOT NULL;

CREATE INDEX ix_project_restarbejde_item_assigned_active
  ON project_restarbejde_item (tenant_id, assigned_tenant_user_id, updated_at DESC)
  WHERE archived_at IS NULL AND assigned_tenant_user_id IS NOT NULL;

CREATE UNIQUE INDEX uq_project_restarbejde_item_import_id
  ON project_restarbejde_item (tenant_id, source, external_import_id)
  WHERE source IS NOT NULL AND external_import_id IS NOT NULL;

CREATE TRIGGER trg_project_restarbejde_item_set_updated_at
BEFORE UPDATE ON project_restarbejde_item
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_project_restarbejde_item_prevent_immutable_update
BEFORE UPDATE ON project_restarbejde_item
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'project_id', 'kind', 'created_by_user_id', 'created_at');

ALTER TABLE project_restarbejde_item
  ADD CONSTRAINT uq_project_restarbejde_item_id_tenant_project UNIQUE (id, tenant_id, project_id);

CREATE TABLE project_restarbejde_drawing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  title text NOT NULL,
  source_type text NOT NULL,
  storage_object_id uuid NOT NULL,
  original_filename text NULL,
  mime_type text NOT NULL,
  file_size_bytes bigint NOT NULL,
  page_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid NOT NULL,
  updated_by_user_id uuid NOT NULL,
  archived_at timestamptz NULL,
  archived_by_user_id uuid NULL,
  CONSTRAINT fk_project_restarbejde_drawing_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_restarbejde_drawing_project FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_drawing_storage_object FOREIGN KEY (storage_object_id, tenant_id) REFERENCES storage_object(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_drawing_created_by_user FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_drawing_updated_by_user FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_drawing_archived_by_user FOREIGN KEY (archived_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (archived_by_user_id),
  CONSTRAINT uq_project_restarbejde_drawing_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT uq_project_restarbejde_drawing_id_tenant_project UNIQUE (id, tenant_id, project_id),
  CONSTRAINT ck_project_restarbejde_drawing_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT ck_project_restarbejde_drawing_source_type CHECK (source_type IN ('image', 'pdf')),
  CONSTRAINT ck_project_restarbejde_drawing_filename_not_blank CHECK (original_filename IS NULL OR btrim(original_filename) <> ''),
  CONSTRAINT ck_project_restarbejde_drawing_mime_not_blank CHECK (btrim(mime_type) <> ''),
  CONSTRAINT ck_project_restarbejde_drawing_file_size CHECK (file_size_bytes > 0),
  CONSTRAINT ck_project_restarbejde_drawing_page_count CHECK (
    (source_type = 'image' AND page_count = 1)
    OR (source_type = 'pdf' AND page_count >= 1)
  ),
  CONSTRAINT ck_project_restarbejde_drawing_archive_state CHECK (
    (archived_at IS NULL AND archived_by_user_id IS NULL)
    OR (archived_at IS NOT NULL AND archived_by_user_id IS NOT NULL AND archived_at >= created_at)
  )
);

CREATE INDEX ix_project_restarbejde_drawing_project_active
  ON project_restarbejde_drawing (tenant_id, project_id, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX ix_project_restarbejde_drawing_project_archived
  ON project_restarbejde_drawing (tenant_id, project_id, archived_at DESC)
  WHERE archived_at IS NOT NULL;

CREATE INDEX ix_project_restarbejde_drawing_storage_object
  ON project_restarbejde_drawing (tenant_id, storage_object_id);

CREATE TRIGGER trg_project_restarbejde_drawing_set_updated_at
BEFORE UPDATE ON project_restarbejde_drawing
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_project_restarbejde_drawing_prevent_immutable_update
BEFORE UPDATE ON project_restarbejde_drawing
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update(
  'id',
  'tenant_id',
  'project_id',
  'storage_object_id',
  'source_type',
  'created_by_user_id',
  'created_at'
);

CREATE TABLE project_restarbejde_placement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  item_id uuid NOT NULL,
  drawing_id uuid NOT NULL,
  page_number integer NOT NULL,
  x_percent numeric(6,3) NOT NULL,
  y_percent numeric(6,3) NOT NULL,
  label text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid NOT NULL,
  updated_by_user_id uuid NOT NULL,
  archived_at timestamptz NULL,
  archived_by_user_id uuid NULL,
  CONSTRAINT fk_project_restarbejde_placement_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_restarbejde_placement_project FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_placement_item FOREIGN KEY (item_id, tenant_id, project_id) REFERENCES project_restarbejde_item(id, tenant_id, project_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_placement_drawing FOREIGN KEY (drawing_id, tenant_id, project_id) REFERENCES project_restarbejde_drawing(id, tenant_id, project_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_placement_created_by_user FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_placement_updated_by_user FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_placement_archived_by_user FOREIGN KEY (archived_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (archived_by_user_id),
  CONSTRAINT uq_project_restarbejde_placement_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT ck_project_restarbejde_placement_page_number CHECK (page_number >= 1),
  CONSTRAINT ck_project_restarbejde_placement_x_percent CHECK (x_percent >= 0 AND x_percent <= 100),
  CONSTRAINT ck_project_restarbejde_placement_y_percent CHECK (y_percent >= 0 AND y_percent <= 100),
  CONSTRAINT ck_project_restarbejde_placement_label_not_blank CHECK (label IS NULL OR btrim(label) <> ''),
  CONSTRAINT ck_project_restarbejde_placement_archive_state CHECK (
    (archived_at IS NULL AND archived_by_user_id IS NULL)
    OR (archived_at IS NOT NULL AND archived_by_user_id IS NOT NULL AND archived_at >= created_at)
  )
);

CREATE INDEX ix_project_restarbejde_placement_drawing_active
  ON project_restarbejde_placement (tenant_id, project_id, drawing_id, page_number, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX ix_project_restarbejde_placement_item_active
  ON project_restarbejde_placement (tenant_id, project_id, item_id, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX ix_project_restarbejde_placement_archived
  ON project_restarbejde_placement (tenant_id, project_id, archived_at DESC)
  WHERE archived_at IS NOT NULL;

CREATE TRIGGER trg_project_restarbejde_placement_set_updated_at
BEFORE UPDATE ON project_restarbejde_placement
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_project_restarbejde_placement_prevent_immutable_update
BEFORE UPDATE ON project_restarbejde_placement
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update(
  'id',
  'tenant_id',
  'project_id',
  'item_id',
  'drawing_id',
  'created_by_user_id',
  'created_at'
);

CREATE TABLE project_restarbejde_attachment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  item_id uuid NOT NULL,
  storage_object_id uuid NOT NULL,
  attachment_type text NOT NULL,
  original_filename text NULL,
  mime_type text NOT NULL,
  file_size_bytes bigint NOT NULL,
  caption text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid NOT NULL,
  archived_at timestamptz NULL,
  archived_by_user_id uuid NULL,
  CONSTRAINT fk_project_restarbejde_attachment_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_restarbejde_attachment_project FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_attachment_item FOREIGN KEY (item_id, tenant_id, project_id) REFERENCES project_restarbejde_item(id, tenant_id, project_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_attachment_storage_object FOREIGN KEY (storage_object_id, tenant_id) REFERENCES storage_object(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_attachment_created_by_user FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_attachment_archived_by_user FOREIGN KEY (archived_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (archived_by_user_id),
  CONSTRAINT uq_project_restarbejde_attachment_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT ck_project_restarbejde_attachment_type CHECK (attachment_type IN ('photo', 'document', 'other')),
  CONSTRAINT ck_project_restarbejde_attachment_filename_not_blank CHECK (original_filename IS NULL OR btrim(original_filename) <> ''),
  CONSTRAINT ck_project_restarbejde_attachment_mime_not_blank CHECK (btrim(mime_type) <> ''),
  CONSTRAINT ck_project_restarbejde_attachment_file_size CHECK (file_size_bytes > 0),
  CONSTRAINT ck_project_restarbejde_attachment_caption_not_blank CHECK (caption IS NULL OR btrim(caption) <> ''),
  CONSTRAINT ck_project_restarbejde_attachment_archive_state CHECK (
    (archived_at IS NULL AND archived_by_user_id IS NULL)
    OR (archived_at IS NOT NULL AND archived_by_user_id IS NOT NULL AND archived_at >= created_at)
  )
);

CREATE INDEX ix_project_restarbejde_attachment_item_active
  ON project_restarbejde_attachment (tenant_id, project_id, item_id, created_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX ix_project_restarbejde_attachment_archived
  ON project_restarbejde_attachment (tenant_id, project_id, archived_at DESC)
  WHERE archived_at IS NOT NULL;

CREATE INDEX ix_project_restarbejde_attachment_storage_object
  ON project_restarbejde_attachment (tenant_id, storage_object_id);


-- ============================================================================
-- 41) absence request foundation
-- ============================================================================

CREATE TABLE absence_type (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  key text NOT NULL,
  name text NOT NULL,
  description text NULL,
  workflow_mode text NOT NULL DEFAULT 'request',
  comment_policy text NOT NULL DEFAULT 'optional',
  visibility_policy text NOT NULL DEFAULT 'private',
  allowed_duration_types text[] NOT NULL DEFAULT ARRAY['full_days', 'time_range']::text[],
  special_window_eligible boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_by_tenant_user_id uuid NULL,
  updated_by_tenant_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT fk_absence_type_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_absence_type_created_by_user FOREIGN KEY (created_by_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (created_by_tenant_user_id),
  CONSTRAINT fk_absence_type_updated_by_user FOREIGN KEY (updated_by_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (updated_by_tenant_user_id),
  CONSTRAINT uq_absence_type_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT ck_absence_type_key_not_blank CHECK (btrim(key) <> ''),
  CONSTRAINT ck_absence_type_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_absence_type_description_not_blank CHECK (description IS NULL OR btrim(description) <> ''),
  CONSTRAINT ck_absence_type_workflow_mode CHECK (workflow_mode IN ('request', 'notification', 'direct_registration', 'administrative')),
  CONSTRAINT ck_absence_type_comment_policy CHECK (comment_policy IN ('optional', 'required', 'disabled')),
  CONSTRAINT ck_absence_type_visibility_policy CHECK (visibility_policy IN ('private', 'manager_visible', 'neutral_shared')),
  CONSTRAINT ck_absence_type_allowed_duration_types CHECK (
    cardinality(allowed_duration_types) > 0
    AND allowed_duration_types <@ ARRAY['full_days', 'partial_day', 'time_range']::text[]
  ),
  CONSTRAINT ck_absence_type_sort_order CHECK (sort_order >= 0)
);

CREATE UNIQUE INDEX uq_absence_type_tenant_key_ci
  ON absence_type (tenant_id, lower(key));

CREATE INDEX ix_absence_type_tenant_active_sort
  ON absence_type (tenant_id, is_active, sort_order, name);

CREATE INDEX ix_absence_type_tenant_special_window
  ON absence_type (tenant_id, special_window_eligible, is_active);

CREATE TABLE absence_special_window (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  key text NOT NULL,
  name text NOT NULL,
  description text NULL,
  absence_start_date date NOT NULL,
  absence_end_date date NOT NULL,
  submission_open_date date NOT NULL,
  submission_deadline date NOT NULL,
  review_start_date date NOT NULL,
  collective_processing boolean NOT NULL DEFAULT true,
  approval_blocked_before_review boolean NOT NULL DEFAULT true,
  late_submission_policy text NOT NULL DEFAULT 'blocked',
  vacation_day_exemption_quota integer NOT NULL DEFAULT 1,
  receipt_text text NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by_tenant_user_id uuid NULL,
  updated_by_tenant_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT fk_absence_special_window_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_absence_special_window_created_by_user FOREIGN KEY (created_by_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (created_by_tenant_user_id),
  CONSTRAINT fk_absence_special_window_updated_by_user FOREIGN KEY (updated_by_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (updated_by_tenant_user_id),
  CONSTRAINT uq_absence_special_window_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT ck_absence_special_window_key_not_blank CHECK (btrim(key) <> ''),
  CONSTRAINT ck_absence_special_window_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_absence_special_window_description_not_blank CHECK (description IS NULL OR btrim(description) <> ''),
  CONSTRAINT ck_absence_special_window_receipt_text CHECK (receipt_text IS NULL OR (btrim(receipt_text) <> '' AND char_length(receipt_text) <= 2000)),
  CONSTRAINT ck_absence_special_window_late_policy CHECK (late_submission_policy IN ('blocked', 'manual_review', 'allowed')),
  CONSTRAINT ck_absence_special_window_vacation_day_exemption_quota CHECK (vacation_day_exemption_quota >= 0 AND vacation_day_exemption_quota <= 31),
  CONSTRAINT ck_absence_special_window_absence_range CHECK (absence_end_date >= absence_start_date),
  CONSTRAINT ck_absence_special_window_submission_range CHECK (submission_deadline >= submission_open_date),
  CONSTRAINT ck_absence_special_window_review_after_deadline CHECK (review_start_date >= submission_deadline),
  CONSTRAINT ck_absence_special_window_version CHECK (version >= 1)
);

CREATE UNIQUE INDEX uq_absence_special_window_tenant_key_ci
  ON absence_special_window (tenant_id, lower(key));

CREATE INDEX ix_absence_special_window_tenant_active_period
  ON absence_special_window (tenant_id, is_active, absence_start_date, absence_end_date);

CREATE INDEX ix_absence_special_window_tenant_review_ready
  ON absence_special_window (tenant_id, is_active, review_start_date, submission_deadline);

CREATE TABLE absence_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  employee_tenant_user_id uuid NOT NULL,
  employee_fitter_id text NULL,
  absence_type_id uuid NOT NULL,
  duration_type text NOT NULL,
  day_part text NULL,
  start_date date NOT NULL,
  end_date date NULL,
  start_time time without time zone NULL,
  end_time time without time zone NULL,
  timezone text NOT NULL DEFAULT 'Europe/Copenhagen',
  employee_comment text NULL,
  status text NOT NULL DEFAULT 'draft',
  assigned_manager_tenant_user_id uuid NULL,
  special_window_id uuid NULL,
  submitted_at timestamptz NULL,
  reviewed_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_absence_request_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_absence_request_employee_user FOREIGN KEY (employee_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_absence_request_employee_fitter FOREIGN KEY (tenant_id, employee_fitter_id) REFERENCES fitter(tenant_id, fitter_id) ON DELETE SET NULL (employee_fitter_id),
  CONSTRAINT fk_absence_request_type FOREIGN KEY (absence_type_id, tenant_id) REFERENCES absence_type(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_absence_request_manager_user FOREIGN KEY (assigned_manager_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (assigned_manager_tenant_user_id),
  CONSTRAINT fk_absence_request_special_window FOREIGN KEY (special_window_id, tenant_id) REFERENCES absence_special_window(id, tenant_id) ON DELETE SET NULL (special_window_id),
  CONSTRAINT uq_absence_request_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT ck_absence_request_duration_type CHECK (duration_type IN ('full_days', 'partial_day', 'time_range')),
  CONSTRAINT ck_absence_request_day_part CHECK (day_part IS NULL OR day_part IN ('morning', 'afternoon')),
  CONSTRAINT ck_absence_request_status CHECK (status IN ('draft', 'submitted', 'ready_for_review', 'under_review', 'approved', 'rejected', 'change_proposed', 'cancelled')),
  CONSTRAINT ck_absence_request_timezone_not_blank CHECK (btrim(timezone) <> ''),
  CONSTRAINT ck_absence_request_employee_comment CHECK (employee_comment IS NULL OR (btrim(employee_comment) <> '' AND char_length(employee_comment) <= 250)),
  CONSTRAINT ck_absence_request_version CHECK (version >= 1),
  CONSTRAINT ck_absence_request_full_days_shape CHECK (
    duration_type <> 'full_days'
    OR (
      end_date IS NOT NULL
      AND end_date >= start_date
      AND start_time IS NULL
      AND end_time IS NULL
      AND day_part IS NULL
    )
  ),
  CONSTRAINT ck_absence_request_time_range_shape CHECK (
    duration_type <> 'time_range'
    OR (
      (end_date IS NULL OR end_date = start_date)
      AND start_time IS NOT NULL
      AND end_time IS NOT NULL
      AND end_time > start_time
      AND day_part IS NULL
    )
  ),
  CONSTRAINT ck_absence_request_partial_day_shape CHECK (
    duration_type <> 'partial_day'
    OR (
      (end_date IS NULL OR end_date = start_date)
      AND start_time IS NULL
      AND end_time IS NULL
      AND day_part IN ('morning', 'afternoon')
    )
  )
);

CREATE INDEX ix_absence_request_employee_created
  ON absence_request (tenant_id, employee_tenant_user_id, created_at DESC);

CREATE INDEX ix_absence_request_manager_status
  ON absence_request (tenant_id, assigned_manager_tenant_user_id, status, submitted_at DESC)
  WHERE assigned_manager_tenant_user_id IS NOT NULL;

CREATE INDEX ix_absence_request_tenant_status_dates
  ON absence_request (tenant_id, status, start_date, end_date);

CREATE INDEX ix_absence_request_tenant_type
  ON absence_request (tenant_id, absence_type_id, status);

CREATE INDEX ix_absence_request_tenant_special_window
  ON absence_request (tenant_id, special_window_id, status)
  WHERE special_window_id IS NOT NULL;

CREATE TABLE absence_request_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  absence_request_id uuid NOT NULL,
  event_type text NOT NULL,
  actor_tenant_user_id uuid NULL,
  old_status text NULL,
  new_status text NULL,
  reason text NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_absence_request_event_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_absence_request_event_request FOREIGN KEY (absence_request_id, tenant_id) REFERENCES absence_request(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_absence_request_event_actor_user FOREIGN KEY (actor_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (actor_tenant_user_id),
  CONSTRAINT ck_absence_request_event_type CHECK (event_type IN ('created', 'draft_updated', 'submitted', 'assigned', 'marked_ready_for_review', 'review_started', 'approved', 'rejected', 'change_proposed', 'cancelled', 'administrative_override')),
  CONSTRAINT ck_absence_request_event_old_status CHECK (old_status IS NULL OR old_status IN ('draft', 'submitted', 'ready_for_review', 'under_review', 'approved', 'rejected', 'change_proposed', 'cancelled')),
  CONSTRAINT ck_absence_request_event_new_status CHECK (new_status IS NULL OR new_status IN ('draft', 'submitted', 'ready_for_review', 'under_review', 'approved', 'rejected', 'change_proposed', 'cancelled')),
  CONSTRAINT ck_absence_request_event_reason_not_blank CHECK (reason IS NULL OR btrim(reason) <> ''),
  CONSTRAINT ck_absence_request_event_metadata_object CHECK (jsonb_typeof(metadata_json) = 'object')
);

CREATE INDEX ix_absence_request_event_request_created
  ON absence_request_event (tenant_id, absence_request_id, created_at ASC);

CREATE INDEX ix_absence_request_event_type_created
  ON absence_request_event (tenant_id, event_type, created_at DESC);
-- ============================================================================
-- 33) approved_absence calendar event source
-- ============================================================================

CREATE TABLE approved_absence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  employee_tenant_user_id uuid NOT NULL,
  employee_fitter_id text NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  absence_request_id uuid NULL,
  absence_type_id uuid NOT NULL,
  duration_type text NOT NULL,
  start_date date NOT NULL,
  end_date date NULL,
  start_time time without time zone NULL,
  end_time time without time zone NULL,
  timezone text NOT NULL DEFAULT 'Europe/Copenhagen',
  status text NOT NULL DEFAULT 'active',
  visibility_policy text NOT NULL,
  approved_by_tenant_user_id uuid NOT NULL,
  approved_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT fk_approved_absence_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_approved_absence_employee_user FOREIGN KEY (employee_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_approved_absence_employee_fitter FOREIGN KEY (tenant_id, employee_fitter_id) REFERENCES fitter(tenant_id, fitter_id) ON DELETE SET NULL (employee_fitter_id),
  CONSTRAINT fk_approved_absence_request FOREIGN KEY (absence_request_id, tenant_id) REFERENCES absence_request(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_approved_absence_type FOREIGN KEY (absence_type_id, tenant_id) REFERENCES absence_type(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_approved_absence_approved_by_user FOREIGN KEY (approved_by_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT uq_approved_absence_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT uq_approved_absence_source UNIQUE (tenant_id, source_type, source_id),
  CONSTRAINT ck_approved_absence_source_type CHECK (source_type IN ('absence_request', 'direct_registration', 'legacy_resource_absence', 'administrative')),
  CONSTRAINT ck_approved_absence_source_shape CHECK (
    (source_type = 'absence_request' AND absence_request_id IS NOT NULL AND source_id = absence_request_id)
    OR (source_type <> 'absence_request' AND source_id IS NOT NULL)
  ),
  CONSTRAINT ck_approved_absence_duration_type CHECK (duration_type IN ('full_days', 'time_range')),
  CONSTRAINT ck_approved_absence_status CHECK (status IN ('active', 'cancelled', 'superseded')),
  CONSTRAINT ck_approved_absence_visibility_policy CHECK (visibility_policy IN ('private', 'manager_visible', 'neutral_shared')),
  CONSTRAINT ck_approved_absence_timezone_not_blank CHECK (btrim(timezone) <> ''),
  CONSTRAINT ck_approved_absence_version CHECK (version >= 1),
  CONSTRAINT ck_approved_absence_full_days_shape CHECK (
    duration_type <> 'full_days'
    OR (
      end_date IS NOT NULL
      AND end_date >= start_date
      AND start_time IS NULL
      AND end_time IS NULL
    )
  ),
  CONSTRAINT ck_approved_absence_time_range_shape CHECK (
    duration_type <> 'time_range'
    OR (
      end_date IS NULL
      AND start_time IS NOT NULL
      AND end_time IS NOT NULL
      AND end_time > start_time
    )
  )
);

CREATE UNIQUE INDEX uq_approved_absence_active_request
  ON approved_absence (tenant_id, absence_request_id)
  WHERE source_type = 'absence_request' AND status = 'active';

CREATE INDEX ix_approved_absence_employee_active_range
  ON approved_absence (tenant_id, employee_tenant_user_id, status, start_date, end_date);

CREATE INDEX ix_approved_absence_tenant_active_range
  ON approved_absence (tenant_id, status, start_date, end_date);

CREATE INDEX ix_approved_absence_tenant_type_status
  ON approved_absence (tenant_id, absence_type_id, status);
CREATE TABLE absence_special_window_scope (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  special_window_id uuid NOT NULL,
  scope_type text NOT NULL,
  resource_group_id uuid NULL,
  scope_tenant_user_id uuid NULL,
  absence_type_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_absence_special_window_scope_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_absence_special_window_scope_window FOREIGN KEY (special_window_id, tenant_id) REFERENCES absence_special_window(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_absence_special_window_scope_resource_group FOREIGN KEY (resource_group_id, tenant_id) REFERENCES resource_groups(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_absence_special_window_scope_user FOREIGN KEY (scope_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_absence_special_window_scope_absence_type FOREIGN KEY (absence_type_id, tenant_id) REFERENCES absence_type(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT ck_absence_special_window_scope_type CHECK (scope_type IN ('tenant', 'resource_group', 'tenant_user')),
  CONSTRAINT ck_absence_special_window_scope_shape CHECK (
    (scope_type = 'tenant' AND resource_group_id IS NULL AND scope_tenant_user_id IS NULL)
    OR (scope_type = 'resource_group' AND resource_group_id IS NOT NULL AND scope_tenant_user_id IS NULL)
    OR (scope_type = 'tenant_user' AND resource_group_id IS NULL AND scope_tenant_user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_absence_special_window_scope_tenant
  ON absence_special_window_scope (tenant_id, special_window_id, COALESCE(absence_type_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE scope_type = 'tenant';

CREATE UNIQUE INDEX uq_absence_special_window_scope_group
  ON absence_special_window_scope (tenant_id, special_window_id, resource_group_id, COALESCE(absence_type_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE scope_type = 'resource_group';

CREATE UNIQUE INDEX uq_absence_special_window_scope_user
  ON absence_special_window_scope (tenant_id, special_window_id, scope_tenant_user_id, COALESCE(absence_type_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE scope_type = 'tenant_user';

CREATE INDEX ix_absence_special_window_scope_window
  ON absence_special_window_scope (tenant_id, special_window_id);

CREATE INDEX ix_absence_special_window_scope_resource_group
  ON absence_special_window_scope (tenant_id, resource_group_id)
  WHERE resource_group_id IS NOT NULL;

CREATE INDEX ix_absence_special_window_scope_user
  ON absence_special_window_scope (tenant_id, scope_tenant_user_id)
  WHERE scope_tenant_user_id IS NOT NULL;

CREATE TABLE employee_manager_relation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  employee_tenant_user_id uuid NOT NULL,
  manager_tenant_user_id uuid NOT NULL,
  relation_type text NOT NULL DEFAULT 'primary',
  valid_from date NOT NULL DEFAULT CURRENT_DATE,
  valid_to date NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by_tenant_user_id uuid NULL,
  updated_by_tenant_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT fk_employee_manager_relation_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_employee_manager_relation_employee FOREIGN KEY (employee_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_employee_manager_relation_manager FOREIGN KEY (manager_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_employee_manager_relation_created_by_user FOREIGN KEY (created_by_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (created_by_tenant_user_id),
  CONSTRAINT fk_employee_manager_relation_updated_by_user FOREIGN KEY (updated_by_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (updated_by_tenant_user_id),
  CONSTRAINT uq_employee_manager_relation_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT ck_employee_manager_relation_type CHECK (relation_type IN ('primary', 'secondary', 'delegate')),
  CONSTRAINT ck_employee_manager_relation_not_self CHECK (employee_tenant_user_id <> manager_tenant_user_id),
  CONSTRAINT ck_employee_manager_relation_valid_range CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE UNIQUE INDEX uq_employee_manager_relation_open_primary
  ON employee_manager_relation (tenant_id, employee_tenant_user_id)
  WHERE is_active = true AND relation_type = 'primary' AND valid_to IS NULL;

CREATE INDEX ix_employee_manager_relation_employee_active
  ON employee_manager_relation (tenant_id, employee_tenant_user_id, is_active, relation_type, valid_from, valid_to);

CREATE INDEX ix_employee_manager_relation_manager_active
  ON employee_manager_relation (tenant_id, manager_tenant_user_id, is_active, relation_type, valid_from, valid_to);

DROP TRIGGER IF EXISTS trg_absence_type_set_updated_at ON absence_type;
CREATE TRIGGER trg_absence_type_set_updated_at
BEFORE UPDATE ON absence_type
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_absence_type_prevent_immutable_update ON absence_type;
CREATE TRIGGER trg_absence_type_prevent_immutable_update
BEFORE UPDATE ON absence_type
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'key', 'created_by_tenant_user_id', 'created_at');

DROP TRIGGER IF EXISTS trg_absence_special_window_set_updated_at ON absence_special_window;
CREATE TRIGGER trg_absence_special_window_set_updated_at
BEFORE UPDATE ON absence_special_window
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_absence_special_window_prevent_immutable_update ON absence_special_window;
CREATE TRIGGER trg_absence_special_window_prevent_immutable_update
BEFORE UPDATE ON absence_special_window
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'key', 'created_by_tenant_user_id', 'created_at');

DROP TRIGGER IF EXISTS trg_absence_request_set_updated_at ON absence_request;
CREATE TRIGGER trg_absence_request_set_updated_at
BEFORE UPDATE ON absence_request
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_absence_request_prevent_immutable_update ON absence_request;
CREATE TRIGGER trg_absence_request_prevent_immutable_update
BEFORE UPDATE ON absence_request
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'employee_tenant_user_id', 'created_at');

DROP TRIGGER IF EXISTS trg_absence_request_event_prevent_update ON absence_request_event;
CREATE TRIGGER trg_absence_request_event_prevent_update
BEFORE UPDATE ON absence_request_event
FOR EACH ROW
EXECUTE FUNCTION prevent_update_delete_append_only();

DROP TRIGGER IF EXISTS trg_absence_request_event_prevent_delete ON absence_request_event;
CREATE TRIGGER trg_absence_request_event_prevent_delete
BEFORE DELETE ON absence_request_event
FOR EACH ROW
EXECUTE FUNCTION prevent_update_delete_append_only();

DROP TRIGGER IF EXISTS trg_approved_absence_set_updated_at ON approved_absence;
CREATE TRIGGER trg_approved_absence_set_updated_at
BEFORE UPDATE ON approved_absence
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_approved_absence_prevent_immutable_update ON approved_absence;
CREATE TRIGGER trg_approved_absence_prevent_immutable_update
BEFORE UPDATE ON approved_absence
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update(
  'id',
  'tenant_id',
  'employee_tenant_user_id',
  'employee_fitter_id',
  'source_type',
  'source_id',
  'absence_request_id',
  'absence_type_id',
  'duration_type',
  'start_date',
  'end_date',
  'start_time',
  'end_time',
  'timezone',
  'visibility_policy',
  'approved_by_tenant_user_id',
  'approved_at',
  'created_at'
);
DROP TRIGGER IF EXISTS trg_employee_manager_relation_set_updated_at ON employee_manager_relation;
CREATE TRIGGER trg_employee_manager_relation_set_updated_at
BEFORE UPDATE ON employee_manager_relation
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_employee_manager_relation_prevent_immutable_update ON employee_manager_relation;
CREATE TRIGGER trg_employee_manager_relation_prevent_immutable_update
BEFORE UPDATE ON employee_manager_relation
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'employee_tenant_user_id', 'manager_tenant_user_id', 'created_by_tenant_user_id', 'created_at');

-- ============================================================================
-- 33) notifications and email outbox
-- ============================================================================

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
    'absence_request.approved.employee',
    'da-DK',
    1,
    'Din fravaersanmodning er godkendt',
    '<p>Hej {{employee_name}}</p><p>Din fravaersanmodning om {{absence_type}} fra {{start_date}} til {{end_date}} er godkendt af {{manager_name}}.</p><p><a href="{{action_url}}">Aabn Fielddesk</a></p><p>{{tenant_name}}</p>',
    'Hej {{employee_name}}\n\nDin fravaersanmodning om {{absence_type}} fra {{start_date}} til {{end_date}} er godkendt af {{manager_name}}.\n\nAabn Fielddesk: {{action_url}}\n\n{{tenant_name}}',
    '["employee_name","manager_name","absence_type","start_date","end_date","start_time","end_time","action_url","tenant_name"]'::jsonb
  ),
  (
    'absence_request.rejected.employee',
    'da-DK',
    1,
    'Din fravaersanmodning er afvist',
    '<p>Hej {{employee_name}}</p><p>Din fravaersanmodning om {{absence_type}} fra {{start_date}} til {{end_date}} er afvist af {{manager_name}}.</p><p>Begrundelse: {{decision_reason}}</p><p><a href="{{action_url}}">Aabn Fielddesk</a></p><p>{{tenant_name}}</p>',
    'Hej {{employee_name}}\n\nDin fravaersanmodning om {{absence_type}} fra {{start_date}} til {{end_date}} er afvist af {{manager_name}}.\n\nBegrundelse: {{decision_reason}}\n\nAabn Fielddesk: {{action_url}}\n\n{{tenant_name}}',
    '["employee_name","manager_name","absence_type","start_date","end_date","start_time","end_time","decision_reason","action_url","tenant_name"]'::jsonb
  )
ON CONFLICT DO NOTHING;
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
    'absence_request.submitted_special_window.employee',
    'da-DK',
    1,
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
    'absence_request.submitted_special_window.manager',
    'da-DK',
    1,
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
