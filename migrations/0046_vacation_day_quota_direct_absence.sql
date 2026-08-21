BEGIN;

ALTER TABLE absence_special_window
  ADD COLUMN IF NOT EXISTS vacation_day_exemption_quota integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_absence_special_window_vacation_day_exemption_quota'
      AND conrelid = 'absence_special_window'::regclass
  ) THEN
    ALTER TABLE absence_special_window
      ADD CONSTRAINT ck_absence_special_window_vacation_day_exemption_quota
      CHECK (vacation_day_exemption_quota >= 0 AND vacation_day_exemption_quota <= 31);
  END IF;
END $$;

ALTER TABLE resource_absences
  ADD COLUMN IF NOT EXISTS source_type text NULL,
  ADD COLUMN IF NOT EXISTS idempotency_key text NULL,
  ADD COLUMN IF NOT EXISTS idempotency_payload_hash text NULL,
  ADD COLUMN IF NOT EXISTS idempotency_segment_index integer NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_resource_absences_source_type'
      AND conrelid = 'resource_absences'::regclass
  ) THEN
    ALTER TABLE resource_absences
      ADD CONSTRAINT ck_resource_absences_source_type
      CHECK (source_type IS NULL OR source_type IN ('direct_registration', 'legacy_resource_absence'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_resource_absences_idempotency_key'
      AND conrelid = 'resource_absences'::regclass
  ) THEN
    ALTER TABLE resource_absences
      ADD CONSTRAINT ck_resource_absences_idempotency_key
      CHECK (idempotency_key IS NULL OR (btrim(idempotency_key) <> '' AND char_length(idempotency_key) <= 160));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_resource_absences_idempotency_payload_hash'
      AND conrelid = 'resource_absences'::regclass
  ) THEN
    ALTER TABLE resource_absences
      ADD CONSTRAINT ck_resource_absences_idempotency_payload_hash
      CHECK (idempotency_payload_hash IS NULL OR idempotency_payload_hash ~ '^[0-9a-f]{64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_resource_absences_idempotency_segment_index'
      AND conrelid = 'resource_absences'::regclass
  ) THEN
    ALTER TABLE resource_absences
      ADD CONSTRAINT ck_resource_absences_idempotency_segment_index
      CHECK (idempotency_segment_index IS NULL OR idempotency_segment_index >= 1);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_resource_absences_direct_idempotency
  ON resource_absences (tenant_id, created_by_user_id, idempotency_key, idempotency_segment_index)
  WHERE idempotency_key IS NOT NULL AND created_by_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_resource_absences_tenant_fitter_status_range
  ON resource_absences (tenant_id, fitter_id, status, start_date, end_date);

UPDATE absence_type
SET
  workflow_mode = 'direct_registration',
  comment_policy = 'required',
  updated_at = now()
WHERE key = 'sickness'
  AND (
    workflow_mode IS DISTINCT FROM 'direct_registration'
    OR comment_policy IS DISTINCT FROM 'required'
  );

COMMIT;
