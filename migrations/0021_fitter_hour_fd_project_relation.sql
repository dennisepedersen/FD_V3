BEGIN;

ALTER TABLE fitter_hour
  ADD COLUMN IF NOT EXISTS fd_project_id uuid NULL;

WITH hour_keys AS (
  SELECT
    fh.id,
    fh.tenant_id,
    lower(btrim(COALESCE(
      NULLIF(btrim(fh.raw_payload_json ->> 'ProjectReference'), ''),
      NULLIF(btrim(fh.raw_payload_json ->> 'projectReference'), ''),
      NULLIF(btrim(fh.raw_payload_json ->> 'ExternalProjectRef'), ''),
      NULLIF(btrim(fh.raw_payload_json ->> 'externalProjectRef'), ''),
      NULLIF(btrim(fh.external_project_ref), '')
    ))) AS source_project_ref_norm,
    lower(btrim(COALESCE(
      NULLIF(btrim(fh.raw_payload_json ->> 'ProjectID'), ''),
      NULLIF(btrim(fh.raw_payload_json ->> 'ProjectId'), ''),
      NULLIF(btrim(fh.raw_payload_json ->> 'projectID'), ''),
      NULLIF(btrim(fh.raw_payload_json ->> 'projectId'), ''),
      NULLIF(btrim(fh.project_id), '')
    ))) AS source_project_id_norm
  FROM fitter_hour fh
  WHERE fh.fd_project_id IS NULL
),
reference_matches AS (
  SELECT
    hk.id,
    pc.project_id
  FROM hour_keys hk
  INNER JOIN project_core pc
    ON pc.tenant_id = hk.tenant_id
   AND hk.source_project_ref_norm IS NOT NULL
   AND lower(btrim(pc.external_project_ref)) = hk.source_project_ref_norm
),
source_id_matches AS (
  SELECT
    hk.id,
    pm.project_id
  FROM hour_keys hk
  INNER JOIN project_masterdata_v4 pm
    ON pm.tenant_id = hk.tenant_id
   AND hk.source_project_id_norm IS NOT NULL
   AND lower(btrim(pm.ek_project_id::text)) = hk.source_project_id_norm
),
resolved AS (
  SELECT
    hk.id,
    CASE
      WHEN rm.project_id IS NOT NULL AND sm.project_id IS NOT NULL AND rm.project_id = sm.project_id THEN rm.project_id
      WHEN rm.project_id IS NOT NULL AND sm.project_id IS NULL THEN rm.project_id
      WHEN rm.project_id IS NULL AND sm.project_id IS NOT NULL THEN sm.project_id
      ELSE NULL
    END AS fd_project_id
  FROM hour_keys hk
  LEFT JOIN reference_matches rm
    ON rm.id = hk.id
  LEFT JOIN source_id_matches sm
    ON sm.id = hk.id
)
UPDATE fitter_hour fh
SET
  fd_project_id = resolved.fd_project_id,
  updated_at = now()
FROM resolved
WHERE resolved.id = fh.id
  AND resolved.fd_project_id IS NOT NULL
  AND fh.fd_project_id IS DISTINCT FROM resolved.fd_project_id;

CREATE INDEX IF NOT EXISTS ix_fitter_hour_tenant_fd_project
  ON fitter_hour (tenant_id, fd_project_id)
  WHERE fd_project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_fitter_hour_tenant_fd_project_work_date
  ON fitter_hour (tenant_id, fd_project_id, work_date DESC, registration_date DESC)
  WHERE fd_project_id IS NOT NULL;

COMMIT;
