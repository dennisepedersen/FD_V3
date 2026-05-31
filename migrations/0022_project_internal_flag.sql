BEGIN;

ALTER TABLE project_core
  ADD COLUMN IF NOT EXISTS is_internal boolean NULL;

ALTER TABLE project_masterdata_v4
  ADD COLUMN IF NOT EXISTS is_internal boolean NULL;

UPDATE project_core pc
SET
  is_internal = pm.is_internal,
  updated_at = now()
FROM project_masterdata_v4 pm
WHERE pm.tenant_id = pc.tenant_id
  AND pm.project_id = pc.project_id
  AND pm.is_internal IS NOT NULL
  AND pc.is_internal IS DISTINCT FROM pm.is_internal;

COMMIT;
