BEGIN;

ALTER TABLE project_wip
  ADD COLUMN IF NOT EXISTS is_work_in_progress boolean NULL;

CREATE INDEX IF NOT EXISTS ix_project_wip_tenant_is_work_in_progress
  ON project_wip (tenant_id, is_work_in_progress);

UPDATE project_core pc
SET
  is_closed = pm.is_closed,
  status = CASE WHEN pm.is_closed = true THEN 'closed' ELSE 'open' END,
  closed_observed_at = CASE
    WHEN pm.is_closed = true THEN COALESCE(pc.closed_observed_at, now())
    ELSE NULL
  END,
  updated_at = now()
FROM project_masterdata_v4 pm
WHERE pm.tenant_id = pc.tenant_id
  AND pm.project_id = pc.project_id
  AND pm.is_closed IS NOT NULL
  AND (
    pc.is_closed IS DISTINCT FROM pm.is_closed
    OR pc.status IS DISTINCT FROM CASE WHEN pm.is_closed = true THEN 'closed' ELSE 'open' END
    OR (pm.is_closed = true AND pc.closed_observed_at IS NULL)
    OR (pm.is_closed = false AND pc.closed_observed_at IS NOT NULL)
  );

COMMIT;
