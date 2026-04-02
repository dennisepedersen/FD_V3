BEGIN;

ALTER TABLE project_core
  ADD COLUMN IF NOT EXISTS responsible_code text NULL;

ALTER TABLE project_core
  ADD COLUMN IF NOT EXISTS responsible_name text NULL;

ALTER TABLE project_core
  ADD COLUMN IF NOT EXISTS team_leader_code text NULL;

ALTER TABLE project_core
  ADD COLUMN IF NOT EXISTS team_leader_name text NULL;

CREATE INDEX IF NOT EXISTS ix_project_core_tenant_responsible_code_ci
  ON project_core (tenant_id, lower(responsible_code));

COMMIT;
