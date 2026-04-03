BEGIN;

ALTER TABLE sync_job
  DROP CONSTRAINT IF EXISTS ck_sync_job_type;

ALTER TABLE sync_job
  ADD CONSTRAINT ck_sync_job_type
  CHECK (type IN ('bootstrap', 'bootstrap_initial', 'delta', 'retry_backlog', 'manual_full_resync', 'slow_reconciliation'));

ALTER TABLE project_core
  ADD COLUMN IF NOT EXISTS has_v4 boolean NOT NULL DEFAULT false;

ALTER TABLE project_core
  ADD COLUMN IF NOT EXISTS has_v3 boolean NOT NULL DEFAULT false;

ALTER TABLE sync_endpoint_state
  ADD COLUMN IF NOT EXISTS current_mode text NULL,
  ADD COLUMN IF NOT EXISTS sync_strategy text NOT NULL DEFAULT 'reconcile_scan',
  ADD COLUMN IF NOT EXISTS current_job_id uuid NULL,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_backlog_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_page_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pages_processed_last_job integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rows_fetched_last_job bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_http_status integer NULL,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_seen_remote_cursor text NULL;

ALTER TABLE sync_endpoint_state
  DROP CONSTRAINT IF EXISTS ck_sync_endpoint_state_status;

ALTER TABLE sync_endpoint_state
  ADD CONSTRAINT ck_sync_endpoint_state_status
  CHECK (status IN ('idle', 'running', 'success', 'partial', 'failed'));

ALTER TABLE sync_endpoint_state
  DROP CONSTRAINT IF EXISTS ck_sync_endpoint_state_mode;

ALTER TABLE sync_endpoint_state
  ADD CONSTRAINT ck_sync_endpoint_state_mode
  CHECK (current_mode IS NULL OR current_mode IN ('bootstrap_initial', 'delta', 'retry_backlog', 'manual_full_resync', 'slow_reconciliation', 'reconcile_scan'));

ALTER TABLE sync_endpoint_state
  DROP CONSTRAINT IF EXISTS ck_sync_endpoint_state_strategy;

ALTER TABLE sync_endpoint_state
  ADD CONSTRAINT ck_sync_endpoint_state_strategy
  CHECK (sync_strategy IN ('delta_supported', 'reconcile_scan', 'backlog_retry_only', 'not_materialized'));

ALTER TABLE sync_endpoint_state
  DROP CONSTRAINT IF EXISTS fk_sync_endpoint_state_current_job;

ALTER TABLE sync_endpoint_state
  ADD CONSTRAINT fk_sync_endpoint_state_current_job
  FOREIGN KEY (current_job_id) REFERENCES sync_job(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_sync_endpoint_state_current_job ON sync_endpoint_state (current_job_id);

ALTER TABLE sync_page_log
  ADD COLUMN IF NOT EXISTS mode text NULL,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS started_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS finished_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS error_text text NULL;

UPDATE sync_page_log
SET
  mode = COALESCE(mode, 'slow_reconciliation'),
  retry_count = GREATEST(COALESCE(retry_count, 0), GREATEST(COALESCE(attempt_no, 1) - 1, 0)),
  started_at = COALESCE(started_at, occurred_at),
  finished_at = COALESCE(finished_at, occurred_at),
  error_text = COALESCE(error_text, error_message)
WHERE mode IS NULL
   OR started_at IS NULL
   OR finished_at IS NULL
   OR error_text IS NULL;

ALTER TABLE sync_page_log
  DROP CONSTRAINT IF EXISTS ck_sync_page_log_mode;

ALTER TABLE sync_page_log
  ADD CONSTRAINT ck_sync_page_log_mode
  CHECK (mode IS NULL OR mode IN ('bootstrap_initial', 'delta', 'retry_backlog', 'manual_full_resync', 'slow_reconciliation', 'reconcile_scan'));

COMMIT;
