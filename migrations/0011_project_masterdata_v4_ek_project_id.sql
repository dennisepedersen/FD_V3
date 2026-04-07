BEGIN;

ALTER TABLE project_masterdata_v4
  ADD COLUMN IF NOT EXISTS ek_project_id bigint NULL;

CREATE INDEX IF NOT EXISTS ix_project_masterdata_v4_tenant_ek_project_id
  ON project_masterdata_v4 (tenant_id, ek_project_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_masterdata_v4_tenant_ek_project_id
  ON project_masterdata_v4 (tenant_id, ek_project_id)
  WHERE ek_project_id IS NOT NULL;

COMMIT;
