BEGIN;

CREATE TABLE time_control_poc_mail_test (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  test_key text NOT NULL CHECK (test_key LIKE 'time_control_poc_mail:v1:%:dep_delivery'),
  message_json jsonb NOT NULL CHECK (jsonb_typeof(message_json) = 'object'),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  prepared_by_user_id uuid NOT NULL,
  prepared_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'sending', 'accepted', 'unclear')),
  attempt_started_at timestamptz NULL,
  completed_at timestamptz NULL,
  provider_message_id text NULL,
  last_error_code text NULL,
  UNIQUE (tenant_id, test_key),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (prepared_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CHECK ((status = 'prepared' AND attempt_started_at IS NULL) OR (status <> 'prepared' AND attempt_started_at IS NOT NULL)),
  CHECK (status <> 'accepted' OR (provider_message_id IS NOT NULL AND completed_at IS NOT NULL))
);

CREATE OR REPLACE FUNCTION guard_time_control_poc_mail_test_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'time_control_poc_mail_test_immutable';
  END IF;
  IF ROW(NEW.id, NEW.tenant_id, NEW.test_key, NEW.message_json, NEW.content_hash,
         NEW.prepared_by_user_id, NEW.prepared_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.tenant_id, OLD.test_key, OLD.message_json, OLD.content_hash,
         OLD.prepared_by_user_id, OLD.prepared_at)
     OR (OLD.status = 'prepared' AND NEW.status <> 'sending')
     OR (OLD.status = 'sending' AND NEW.status NOT IN ('accepted', 'unclear'))
     OR OLD.status IN ('accepted', 'unclear') THEN
    RAISE EXCEPTION 'time_control_poc_mail_test_transition_invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_time_control_poc_mail_test_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'time_control_poc_mail_test_immutable';
END;
$$;

CREATE TRIGGER trg_time_control_poc_mail_test_guard BEFORE UPDATE OR DELETE ON time_control_poc_mail_test
FOR EACH ROW EXECUTE FUNCTION guard_time_control_poc_mail_test_update();
CREATE TRIGGER trg_time_control_poc_mail_test_no_truncate BEFORE TRUNCATE ON time_control_poc_mail_test
FOR EACH STATEMENT EXECUTE FUNCTION guard_time_control_poc_mail_test_truncate();

COMMIT;
