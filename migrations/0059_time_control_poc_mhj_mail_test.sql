BEGIN;

ALTER TABLE time_control_poc_mail_test
  DROP CONSTRAINT ck_time_control_poc_mail_test_test_key;

ALTER TABLE time_control_poc_mail_test
  ADD CONSTRAINT ck_time_control_poc_mail_test_test_key
  CHECK (test_key ~ '^time_control_poc_mail:v1:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(dep_delivery(:[0-9a-f]{12})?|mhj_delivery:[0-9a-f]{12})$');

COMMIT;
