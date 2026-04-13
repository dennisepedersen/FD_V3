BEGIN;

ALTER TABLE project_core
  ADD COLUMN IF NOT EXISTS closed_observed_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS ix_project_core_tenant_closed_observed
  ON project_core (tenant_id, closed_observed_at DESC)
  WHERE is_closed = true;

COMMIT;
