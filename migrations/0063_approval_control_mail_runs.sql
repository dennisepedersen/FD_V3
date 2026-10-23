BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Extend the current expression, including all events admitted by 0062.
DO $$
DECLARE
  existing_expression text;
BEGIN
  SELECT pg_get_expr(conbin, conrelid) INTO STRICT existing_expression
  FROM pg_constraint
  WHERE conrelid = 'audit_event'::regclass
    AND conname = 'ck_audit_event_event_type' AND contype = 'c';

  IF position('approval_control.mail_run_started' IN existing_expression) > 0
     AND position('approval_control.mail_attempt_started' IN existing_expression) > 0
     AND position('approval_control.mail_run_completed' IN existing_expression) > 0 THEN
    RETURN;
  END IF;

  ALTER TABLE audit_event DROP CONSTRAINT ck_audit_event_event_type;
  EXECUTE format(
    'ALTER TABLE audit_event ADD CONSTRAINT ck_audit_event_event_type CHECK ((%s) OR event_type IN (''approval_control.mail_run_started'', ''approval_control.mail_attempt_started'', ''approval_control.mail_run_completed'')) NOT VALID',
    existing_expression
  );
END;
$$;

ALTER TABLE audit_event VALIDATE CONSTRAINT ck_audit_event_event_type;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'audit_event'::regclass
      AND conname = 'ck_audit_event_approval_control_mail_run'
  ) THEN
    ALTER TABLE audit_event ADD CONSTRAINT ck_audit_event_approval_control_mail_run CHECK (
      event_type NOT IN (
        'approval_control.mail_run_started',
        'approval_control.mail_attempt_started',
        'approval_control.mail_run_completed'
      ) OR (
        tenant_id IS NOT NULL AND actor_scope = 'tenant'
        AND jsonb_typeof(metadata->'run_id') = 'string'
        AND btrim(metadata->>'run_id') <> ''
        AND target_id = metadata->>'run_id'
        AND jsonb_typeof(metadata->'local_date') = 'string'
        AND metadata->>'local_date' ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
        AND jsonb_typeof(metadata->'mode') = 'string'
        AND metadata->>'mode' IN ('simulation', 'live')
      ) IS TRUE
    ) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE audit_event VALIDATE CONSTRAINT ck_audit_event_approval_control_mail_run;

CREATE UNIQUE INDEX IF NOT EXISTS ux_audit_approval_control_mail_run_slot
  ON audit_event (tenant_id, actor_id, (metadata->>'local_date'), (metadata->>'mode'))
  WHERE event_type = 'approval_control.mail_run_started';

CREATE UNIQUE INDEX IF NOT EXISTS ux_audit_approval_control_mail_attempt
  ON audit_event (tenant_id, actor_id, target_id)
  WHERE event_type = 'approval_control.mail_attempt_started';

CREATE UNIQUE INDEX IF NOT EXISTS ux_audit_approval_control_mail_completed
  ON audit_event (tenant_id, actor_id, target_id)
  WHERE event_type = 'approval_control.mail_run_completed';

COMMIT;
