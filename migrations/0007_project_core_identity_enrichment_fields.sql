BEGIN;

ALTER TABLE project_core
  ADD COLUMN IF NOT EXISTS responsible_id text NULL;

ALTER TABLE project_core
  ADD COLUMN IF NOT EXISTS team_leader_id text NULL;

ALTER TABLE project_core
  ADD COLUMN IF NOT EXISTS activity_date timestamptz NULL;

ALTER TABLE project_core
  ADD COLUMN IF NOT EXISTS is_closed boolean NULL;

CREATE INDEX IF NOT EXISTS ix_project_core_tenant_responsible_id
  ON project_core (tenant_id, responsible_id);

CREATE INDEX IF NOT EXISTS ix_project_core_tenant_activity_date
  ON project_core (tenant_id, activity_date DESC);

COMMIT;
