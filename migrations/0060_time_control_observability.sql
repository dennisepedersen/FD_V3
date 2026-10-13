BEGIN;

CREATE TABLE time_control_monitor_policy (
  tenant_id uuid PRIMARY KEY REFERENCES tenant(id) ON DELETE RESTRICT,
  is_enabled boolean NOT NULL DEFAULT false,
  first_schedule_on date NOT NULL,
  status_recipient_email text NOT NULL,
  scheduler_heartbeat_at timestamptz,
  last_checked_at timestamptz,
  CHECK (NOT is_enabled OR (tenant_id='f1f51c07-2d88-4ee4-a766-78eac833a9d0'::uuid
    AND status_recipient_email='dep@hoyrup-clemmensen.dk'))
);

CREATE TABLE time_control_execution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL,
  group_id uuid NOT NULL,
  scheduled_at timestamptz NOT NULL,
  controlled_date date NOT NULL,
  control_type text NOT NULL CHECK (control_type IN ('daily_09','friday_weekly_v1')),
  origin text NOT NULL CHECK (origin IN ('scheduled','incident')),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','running','completed','partial','failed','missed')),
  run_id uuid,
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(counts)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,tenant_id),
  UNIQUE (tenant_id,scheduled_at,control_type),
  FOREIGN KEY (operation_id,tenant_id,group_id) REFERENCES time_control_operation(id,tenant_id,group_id) ON DELETE RESTRICT,
  FOREIGN KEY (run_id,tenant_id) REFERENCES time_control_run(id,tenant_id) ON DELETE RESTRICT
);
CREATE INDEX ix_time_control_execution_recent ON time_control_execution(tenant_id,scheduled_at DESC);

CREATE TABLE time_control_execution_step (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  step text NOT NULL CHECK (step ~ '^[a-z][a-z0-9_]{0,79}$'),
  status text NOT NULL CHECK (status IN ('started','completed','failed','observed')),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms bigint CHECK (duration_ms >= 0),
  counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(counts)='object'),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[a-zA-Z0-9_:.-]{1,180}$'),
  FOREIGN KEY (execution_id,tenant_id) REFERENCES time_control_execution(id,tenant_id) ON DELETE RESTRICT
);
CREATE INDEX ix_time_control_execution_step_timeline ON time_control_execution_step(tenant_id,execution_id,id);
CREATE UNIQUE INDEX uq_time_control_watchdog_notice ON time_control_execution_step(tenant_id,execution_id,step)
WHERE step IN ('watchdog','watchdog_mail');
CREATE TRIGGER trg_time_control_execution_step_immutable BEFORE UPDATE OR DELETE ON time_control_execution_step
FOR EACH ROW EXECUTE FUNCTION prevent_time_control_dataset_mutation();
CREATE TRIGGER trg_time_control_execution_step_no_truncate BEFORE TRUNCATE ON time_control_execution_step
FOR EACH STATEMENT EXECUTE FUNCTION prevent_time_control_dataset_mutation();

CREATE TABLE time_control_status_report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  report_date date NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','accepted','rejected','unclear')),
  message_json jsonb NOT NULL CHECK (jsonb_typeof(message_json)='object'),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 256 AND idempotency_key ~ '^[a-zA-Z0-9:_-]+$'),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  last_attempt_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  provider_message_id text,
  error_code text,
  provider_http_status integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,tenant_id),
  UNIQUE (tenant_id,report_date),
  UNIQUE (tenant_id,idempotency_key),
  CHECK (status <> 'accepted' OR provider_message_id IS NOT NULL)
);
CREATE INDEX ix_time_control_status_report_due ON time_control_status_report(tenant_id,status,next_attempt_at);

CREATE FUNCTION prevent_time_control_status_message_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.tenant_id,NEW.report_date,NEW.message_json,NEW.idempotency_key,NEW.expires_at)
     IS DISTINCT FROM ROW(OLD.tenant_id,OLD.report_date,OLD.message_json,OLD.idempotency_key,OLD.expires_at) THEN
    RAISE EXCEPTION 'time_control_status_message_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_time_control_status_message_immutable BEFORE UPDATE ON time_control_status_report
FOR EACH ROW EXECUTE FUNCTION prevent_time_control_status_message_mutation();

INSERT INTO time_control_monitor_policy(tenant_id,is_enabled,first_schedule_on,status_recipient_email)
SELECT id,true,'2026-10-14'::date,'dep@hoyrup-clemmensen.dk' FROM tenant
WHERE id='f1f51c07-2d88-4ee4-a766-78eac833a9d0'::uuid AND slug='hoyrup-clemmensen';

COMMIT;
