BEGIN;

ALTER TABLE time_control_run ADD CONSTRAINT uq_time_control_run_tenant UNIQUE (id, tenant_id);

CREATE TABLE time_control_operation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  group_id uuid NOT NULL,
  covered_from date NOT NULL,
  started_at timestamptz NOT NULL,
  started_by_user_id uuid NOT NULL,
  cohort_json jsonb NOT NULL CHECK (jsonb_typeof(cohort_json) = 'array' AND jsonb_array_length(cohort_json) > 0),
  UNIQUE (id, tenant_id, group_id),
  FOREIGN KEY (group_id, tenant_id) REFERENCES resource_groups(id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (started_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT
);

CREATE TABLE time_control_operation_state (
  tenant_id uuid NOT NULL,
  group_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'paused')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, group_id),
  FOREIGN KEY (operation_id, tenant_id, group_id) REFERENCES time_control_operation(id, tenant_id, group_id) ON DELETE RESTRICT
);

CREATE TABLE time_control_operational_check (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  group_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  fitter_id text NOT NULL CHECK (fitter_id ~ '^[1-9][0-9]*$'),
  controlled_date date NOT NULL,
  control_type text NOT NULL CHECK (control_type IN ('daily_09', 'friday_weekly_v1')),
  run_id uuid NOT NULL,
  dataset_id uuid NULL,
  weekly_snapshot_id uuid NULL,
  binding_key uuid NOT NULL,
  identity_hash text NOT NULL CHECK (identity_hash ~ '^[0-9a-f]{64}$'),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL CHECK (completed_at >= started_at),
  result_json jsonb NOT NULL CHECK (jsonb_typeof(result_json) = 'object'),
  UNIQUE (tenant_id, operation_id, fitter_id, controlled_date, control_type, binding_key),
  FOREIGN KEY (operation_id, tenant_id, group_id) REFERENCES time_control_operation(id, tenant_id, group_id) ON DELETE RESTRICT,
  FOREIGN KEY (run_id, tenant_id) REFERENCES time_control_run(id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (dataset_id, tenant_id, controlled_date) REFERENCES time_control_hours_dataset(id, tenant_id, controlled_date) ON DELETE RESTRICT,
  FOREIGN KEY (weekly_snapshot_id, tenant_id) REFERENCES time_control_weekly_snapshot(id, tenant_id) ON DELETE RESTRICT,
  CHECK ((control_type = 'daily_09' AND dataset_id IS NOT NULL AND weekly_snapshot_id IS NULL)
    OR (control_type = 'friday_weekly_v1' AND dataset_id IS NULL AND weekly_snapshot_id IS NOT NULL)),
  CHECK (binding_key = COALESCE(dataset_id, weekly_snapshot_id))
);

CREATE TRIGGER trg_time_control_operation_immutable BEFORE UPDATE OR DELETE ON time_control_operation
FOR EACH ROW EXECUTE FUNCTION prevent_time_control_dataset_mutation();
CREATE TRIGGER trg_time_control_operation_no_truncate BEFORE TRUNCATE ON time_control_operation
FOR EACH STATEMENT EXECUTE FUNCTION prevent_time_control_dataset_mutation();
CREATE TRIGGER trg_time_control_operational_check_immutable BEFORE UPDATE OR DELETE ON time_control_operational_check
FOR EACH ROW EXECUTE FUNCTION prevent_time_control_dataset_mutation();
CREATE TRIGGER trg_time_control_operational_check_no_truncate BEFORE TRUNCATE ON time_control_operational_check
FOR EACH STATEMENT EXECUTE FUNCTION prevent_time_control_dataset_mutation();

COMMIT;
