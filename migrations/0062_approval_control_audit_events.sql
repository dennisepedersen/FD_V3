BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Preserve the existing expression verbatim: no previous event is removed.
DO $$
DECLARE
  existing_expression text;
BEGIN
  SELECT pg_get_expr(conbin, conrelid) INTO STRICT existing_expression
  FROM pg_constraint
  WHERE conrelid = 'audit_event'::regclass
    AND conname = 'ck_audit_event_event_type' AND contype = 'c';

  IF position('approval_control.previewed' IN existing_expression) > 0
     AND position('approval_control.preview_failed' IN existing_expression) > 0
     AND position('approval_control.capture_admitted' IN existing_expression) > 0 THEN
    RETURN;
  END IF;

  ALTER TABLE audit_event DROP CONSTRAINT ck_audit_event_event_type;
  EXECUTE format(
    'ALTER TABLE audit_event ADD CONSTRAINT ck_audit_event_event_type CHECK ((%s) OR event_type IN (''approval_control.previewed'', ''approval_control.preview_failed'', ''approval_control.capture_admitted'')) NOT VALID',
    existing_expression
  );
END;
$$;

ALTER TABLE audit_event VALIDATE CONSTRAINT ck_audit_event_event_type;

COMMIT;
