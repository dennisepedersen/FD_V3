BEGIN;

ALTER TABLE sync_job
  ADD COLUMN IF NOT EXISTS started_at timestamptz NULL;

ALTER TABLE sync_job
  ADD COLUMN IF NOT EXISTS finished_at timestamptz NULL;

ALTER TABLE sync_job
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;

ALTER TABLE sync_job
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz NULL;

ALTER TABLE sync_job
  ADD COLUMN IF NOT EXISTS error_message text NULL;

ALTER TABLE sync_job
  ADD CONSTRAINT ck_sync_job_retry_nonnegative CHECK (retry_count >= 0);

CREATE INDEX IF NOT EXISTS ix_sync_job_tenant_type_status_retry
  ON sync_job (tenant_id, type, status, next_retry_at);

COMMIT;
