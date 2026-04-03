BEGIN;

CREATE TABLE IF NOT EXISTS sync_endpoint_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  endpoint_key text NOT NULL,
  status text NOT NULL DEFAULT 'idle',
  last_attempt_at timestamptz NULL,
  last_successful_sync_at timestamptz NULL,
  last_successful_page integer NULL,
  last_successful_cursor text NULL,
  updated_after_watermark timestamptz NULL,
  rows_fetched bigint NOT NULL DEFAULT 0,
  rows_persisted bigint NOT NULL DEFAULT 0,
  next_planned_at timestamptz NULL,
  last_error text NULL,
  last_job_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_sync_endpoint_state_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_sync_endpoint_state_job FOREIGN KEY (last_job_id) REFERENCES sync_job(id) ON DELETE SET NULL,
  CONSTRAINT uq_sync_endpoint_state_tenant_endpoint UNIQUE (tenant_id, endpoint_key),
  CONSTRAINT ck_sync_endpoint_state_status CHECK (status IN ('idle', 'running', 'success', 'partial', 'failed')),
  CONSTRAINT ck_sync_endpoint_state_endpoint_not_blank CHECK (btrim(endpoint_key) <> ''),
  CONSTRAINT ck_sync_endpoint_state_rows_fetched_nonnegative CHECK (rows_fetched >= 0),
  CONSTRAINT ck_sync_endpoint_state_rows_persisted_nonnegative CHECK (rows_persisted >= 0)
);

CREATE INDEX IF NOT EXISTS ix_sync_endpoint_state_tenant_status ON sync_endpoint_state (tenant_id, status);
CREATE INDEX IF NOT EXISTS ix_sync_endpoint_state_next_planned ON sync_endpoint_state (next_planned_at);

DROP TRIGGER IF EXISTS trg_sync_endpoint_state_set_updated_at ON sync_endpoint_state;
CREATE TRIGGER trg_sync_endpoint_state_set_updated_at
BEFORE UPDATE ON sync_endpoint_state
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sync_endpoint_state_prevent_immutable_update ON sync_endpoint_state;
CREATE TRIGGER trg_sync_endpoint_state_prevent_immutable_update
BEFORE UPDATE ON sync_endpoint_state
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'endpoint_key', 'created_at');

CREATE TABLE IF NOT EXISTS sync_failure_backlog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  endpoint_key text NOT NULL,
  locator_type text NOT NULL,
  locator_value text NOT NULL,
  page_number integer NULL,
  cursor_value text NULL,
  reference_value text NULL,
  failure_kind text NOT NULL,
  error_message text NULL,
  attempts integer NOT NULL DEFAULT 1,
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  last_failed_at timestamptz NOT NULL DEFAULT now(),
  next_retry_at timestamptz NULL,
  status text NOT NULL DEFAULT 'pending',
  last_job_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_sync_failure_backlog_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_sync_failure_backlog_job FOREIGN KEY (last_job_id) REFERENCES sync_job(id) ON DELETE SET NULL,
  CONSTRAINT uq_sync_failure_locator UNIQUE (tenant_id, endpoint_key, locator_type, locator_value),
  CONSTRAINT ck_sync_failure_locator_type CHECK (locator_type IN ('page', 'cursor', 'reference', 'item')),
  CONSTRAINT ck_sync_failure_kind CHECK (failure_kind IN ('http_429', 'transient', 'permanent', 'persist', 'mapping')),
  CONSTRAINT ck_sync_failure_status CHECK (status IN ('pending', 'deferred', 'retrying', 'resolved', 'failed')),
  CONSTRAINT ck_sync_failure_attempts_positive CHECK (attempts > 0),
  CONSTRAINT ck_sync_failure_endpoint_not_blank CHECK (btrim(endpoint_key) <> ''),
  CONSTRAINT ck_sync_failure_locator_not_blank CHECK (btrim(locator_value) <> '')
);

CREATE INDEX IF NOT EXISTS ix_sync_failure_backlog_tenant_status_retry
  ON sync_failure_backlog (tenant_id, status, next_retry_at);
CREATE INDEX IF NOT EXISTS ix_sync_failure_backlog_endpoint_status
  ON sync_failure_backlog (tenant_id, endpoint_key, status);

DROP TRIGGER IF EXISTS trg_sync_failure_backlog_set_updated_at ON sync_failure_backlog;
CREATE TRIGGER trg_sync_failure_backlog_set_updated_at
BEFORE UPDATE ON sync_failure_backlog
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sync_failure_backlog_prevent_immutable_update ON sync_failure_backlog;
CREATE TRIGGER trg_sync_failure_backlog_prevent_immutable_update
BEFORE UPDATE ON sync_failure_backlog
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'endpoint_key', 'locator_type', 'locator_value', 'first_failed_at', 'created_at');

CREATE TABLE IF NOT EXISTS sync_page_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  job_id uuid NOT NULL,
  endpoint_key text NOT NULL,
  page_number integer NULL,
  next_page integer NULL,
  status text NOT NULL,
  rows_fetched integer NOT NULL DEFAULT 0,
  rows_persisted integer NOT NULL DEFAULT 0,
  http_status integer NULL,
  error_message text NULL,
  attempt_no integer NOT NULL DEFAULT 1,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_sync_page_log_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_sync_page_log_job FOREIGN KEY (job_id) REFERENCES sync_job(id) ON DELETE CASCADE,
  CONSTRAINT ck_sync_page_log_status CHECK (status IN ('success', 'failed', 'retry_success', 'retry_failed')),
  CONSTRAINT ck_sync_page_log_endpoint_not_blank CHECK (btrim(endpoint_key) <> ''),
  CONSTRAINT ck_sync_page_log_rows_fetched_nonnegative CHECK (rows_fetched >= 0),
  CONSTRAINT ck_sync_page_log_rows_persisted_nonnegative CHECK (rows_persisted >= 0),
  CONSTRAINT ck_sync_page_log_attempt_positive CHECK (attempt_no > 0)
);

CREATE INDEX IF NOT EXISTS ix_sync_page_log_tenant_occurred
  ON sync_page_log (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_sync_page_log_job
  ON sync_page_log (job_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_sync_page_log_endpoint
  ON sync_page_log (tenant_id, endpoint_key, occurred_at DESC);

COMMIT;
