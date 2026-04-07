BEGIN;

ALTER TABLE project_wip
  ADD COLUMN IF NOT EXISTS last_registration timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_fitter_hour_date timestamptz NULL,
  ADD COLUMN IF NOT EXISTS calculated_days_since_last_registration integer NULL,
  ADD COLUMN IF NOT EXISTS ready_to_bill boolean NULL,
  ADD COLUMN IF NOT EXISTS margin numeric(14,2) NULL,
  ADD COLUMN IF NOT EXISTS costs numeric(14,2) NULL,
  ADD COLUMN IF NOT EXISTS ongoing numeric(14,2) NULL,
  ADD COLUMN IF NOT EXISTS billed numeric(14,2) NULL,
  ADD COLUMN IF NOT EXISTS coverage numeric(8,2) NULL,
  ADD COLUMN IF NOT EXISTS hours_budget numeric(14,2) NULL,
  ADD COLUMN IF NOT EXISTS hours_expected numeric(14,2) NULL,
  ADD COLUMN IF NOT EXISTS hours_fitter_hour numeric(14,2) NULL,
  ADD COLUMN IF NOT EXISTS remaining_hours numeric(14,2) NULL;

CREATE INDEX IF NOT EXISTS ix_project_wip_tenant_last_registration
  ON project_wip (tenant_id, last_registration DESC);

CREATE TABLE IF NOT EXISTS project_masterdata_v4 (
  project_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  parent_project_ek_id bigint NULL,
  is_subproject boolean NULL,
  is_closed boolean NULL,
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
  CONSTRAINT fk_project_masterdata_v4_project_tenant
    FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_project_masterdata_v4_tenant_parent
  ON project_masterdata_v4 (tenant_id, parent_project_ek_id);

CREATE INDEX IF NOT EXISTS ix_project_masterdata_v4_tenant_subproject
  ON project_masterdata_v4 (tenant_id, is_subproject);

CREATE INDEX IF NOT EXISTS ix_project_masterdata_v4_tenant_total_turnover
  ON project_masterdata_v4 (tenant_id, total_turn_over_exp);

DROP TRIGGER IF EXISTS trg_project_masterdata_v4_set_updated_at ON project_masterdata_v4;
CREATE TRIGGER trg_project_masterdata_v4_set_updated_at
BEFORE UPDATE ON project_masterdata_v4
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_project_masterdata_v4_prevent_immutable_update ON project_masterdata_v4;
CREATE TRIGGER trg_project_masterdata_v4_prevent_immutable_update
BEFORE UPDATE ON project_masterdata_v4
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('project_id', 'tenant_id', 'created_at');

COMMIT;
