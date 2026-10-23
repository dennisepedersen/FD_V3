BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

-- Preserve every event admitted by the existing constraint.
DO $$
DECLARE
  existing_expression text;
BEGIN
  SELECT pg_get_expr(conbin, conrelid) INTO STRICT existing_expression
  FROM pg_constraint
  WHERE conrelid = 'audit_event'::regclass
    AND conname = 'ck_audit_event_event_type' AND contype = 'c';

  IF position('approval_control.scheduler_activated' IN existing_expression) > 0 THEN
    RETURN;
  END IF;

  ALTER TABLE audit_event DROP CONSTRAINT ck_audit_event_event_type;
  EXECUTE format(
    'ALTER TABLE audit_event ADD CONSTRAINT ck_audit_event_event_type CHECK ((%s) OR event_type IN (''approval_control.scheduler_activated'')) NOT VALID',
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
      AND conname = 'ck_audit_event_approval_control_activation'
  ) THEN
    ALTER TABLE audit_event ADD CONSTRAINT ck_audit_event_approval_control_activation CHECK (
      CASE WHEN event_type = 'approval_control.scheduler_activated' THEN (
        tenant_id IS NOT NULL AND actor_scope = 'tenant'
        AND metadata->>'environment' = 'production'
        AND metadata->>'time_zone' = 'Europe/Copenhagen'
        AND jsonb_typeof(metadata->'activated_at') = 'string'
        AND metadata->>'activated_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
        AND isfinite((metadata->>'activated_at')::timestamptz)
        AND jsonb_typeof(metadata->'coverage_from') = 'string'
        AND metadata->>'coverage_from' ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
        AND metadata->>'coverage_from' = to_char(
          (metadata->>'activated_at')::timestamptz AT TIME ZONE 'Europe/Copenhagen', 'YYYY-MM-DD'
        )
      ) IS TRUE ELSE TRUE END
    ) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE audit_event VALIDATE CONSTRAINT ck_audit_event_approval_control_activation;

CREATE UNIQUE INDEX IF NOT EXISTS ux_audit_approval_control_first_activation
  ON audit_event (tenant_id)
  WHERE event_type = 'approval_control.scheduler_activated';

COMMIT;
