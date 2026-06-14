BEGIN;

CREATE TABLE IF NOT EXISTS project_fitterhours_refresh_status (
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

CREATE INDEX IF NOT EXISTS ix_project_fitterhours_refresh_status_tenant_status
  ON project_fitterhours_refresh_status (tenant_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS ix_project_fitterhours_refresh_status_tenant_project
  ON project_fitterhours_refresh_status (tenant_id, project_id);

CREATE INDEX IF NOT EXISTS ix_project_fitterhours_refresh_status_tenant_next_allowed
  ON project_fitterhours_refresh_status (tenant_id, next_allowed_refresh_at)
  WHERE next_allowed_refresh_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_project_fitterhours_refresh_status_tenant_ek_project
  ON project_fitterhours_refresh_status (tenant_id, ek_project_id)
  WHERE ek_project_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_project_fitterhours_refresh_status_set_updated_at
  ON project_fitterhours_refresh_status;
CREATE TRIGGER trg_project_fitterhours_refresh_status_set_updated_at
BEFORE UPDATE ON project_fitterhours_refresh_status
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_project_fitterhours_refresh_status_prevent_immutable_update
  ON project_fitterhours_refresh_status;
CREATE TRIGGER trg_project_fitterhours_refresh_status_prevent_immutable_update
BEFORE UPDATE ON project_fitterhours_refresh_status
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'project_id', 'created_at');

CREATE TABLE IF NOT EXISTS targeted_fitterhours_refresh_runs (
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

CREATE INDEX IF NOT EXISTS ix_targeted_fitterhours_refresh_runs_tenant_project_started
  ON targeted_fitterhours_refresh_runs (tenant_id, project_id, started_at DESC);

CREATE INDEX IF NOT EXISTS ix_targeted_fitterhours_refresh_runs_tenant_status_started
  ON targeted_fitterhours_refresh_runs (tenant_id, status, started_at DESC);

CREATE INDEX IF NOT EXISTS ix_targeted_fitterhours_refresh_runs_tenant_trigger_started
  ON targeted_fitterhours_refresh_runs (tenant_id, trigger_type, started_at DESC);

CREATE INDEX IF NOT EXISTS ix_targeted_fitterhours_refresh_runs_tenant_ek_project
  ON targeted_fitterhours_refresh_runs (tenant_id, ek_project_id)
  WHERE ek_project_id IS NOT NULL;

COMMIT;
