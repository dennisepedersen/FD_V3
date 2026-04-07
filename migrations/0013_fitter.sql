BEGIN;

CREATE TABLE IF NOT EXISTS fitter (
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_fitter_tenant_external_id
  ON fitter (tenant_id, fitter_id);

CREATE INDEX IF NOT EXISTS ix_fitter_tenant_username
  ON fitter (tenant_id, username);

CREATE INDEX IF NOT EXISTS ix_fitter_tenant_salary_id
  ON fitter (tenant_id, salary_id);

CREATE INDEX IF NOT EXISTS ix_fitter_tenant_end_date
  ON fitter (tenant_id, end_date DESC);

CREATE INDEX IF NOT EXISTS ix_fitter_tenant_name
  ON fitter (tenant_id, name);

DROP TRIGGER IF EXISTS trg_fitter_set_updated_at ON fitter;
CREATE TRIGGER trg_fitter_set_updated_at
BEFORE UPDATE ON fitter
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_fitter_prevent_immutable_update ON fitter;
CREATE TRIGGER trg_fitter_prevent_immutable_update
BEFORE UPDATE ON fitter
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'fitter_id', 'created_at');

COMMIT;
