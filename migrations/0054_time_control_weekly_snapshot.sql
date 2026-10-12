BEGIN;

ALTER TABLE time_control_hours_dataset
  DROP CONSTRAINT time_control_hours_dataset_row_count_check,
  ADD CONSTRAINT time_control_hours_dataset_row_count_check CHECK (
    row_count > 0 OR (row_count = 0
      AND proof_json->>'contract' = 'ek_v4_all_projects_empty_day_v1'
      AND proof_json->>'row_count' = '0'
      AND evidence_json->>'expectedTotal' = '0'
      AND evidence_json->'rows' = '[]'::jsonb
      AND evidence_json->'evidence'->'emptyDayContract'->>'endpoint' = '/api/v4/paginatedfitterhours'
      AND evidence_json->'evidence'->'emptyDayContract'->>'version' = 'ek_v4_all_projects_empty_day_v1'
      AND evidence_json->'evidence'->'emptyDayContract'->>'includesClosedProjects' = 'true'
      AND evidence_json->'evidence'->'emptyDayContract'->>'dateFilterInclusive' = 'true'
      AND evidence_json->'evidence'->'emptyDayContract'->>'zeroTotalTerminalPage' = 'true'
      AND evidence_json->'evidence'->'emptyDayContract'->>'emptyCurrentPage' = '0'
      AND length(btrim(evidence_json->'evidence'->'emptyDayContract'->>'verificationReference')) > 0
      AND jsonb_array_length(evidence_json->'passes') = 2
      AND proof_json->>'pass_count' = '2'
      AND proof_json->>'status' = 'complete'
      AND proof_json->>'tenant_id' = tenant_id::text
      AND proof_json->>'controlled_date' = controlled_date::text
      AND rows_hash = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'
      AND proof_json->>'rows_hash' = rows_hash
      AND jsonb_array_length(evidence_json->'passes'->0->'pageEvidence') = 1
      AND jsonb_array_length(evidence_json->'passes'->1->'pageEvidence') = 1
      AND evidence_json->'passes'->0 @> '{"pageEvidence":[{"page":1,"currentPage":0,"nextPage":null,"rowCount":0,"total":0,"status":200,"hasErrors":false,"errorCount":0}],"summary":{"orderedIdsHash":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","canonicalRowsHash":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"}}'::jsonb
      AND evidence_json->'passes'->1 @> '{"pageEvidence":[{"page":1,"currentPage":0,"nextPage":null,"rowCount":0,"total":0,"status":200,"hasErrors":false,"errorCount":0}],"summary":{"orderedIdsHash":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","canonicalRowsHash":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"}}'::jsonb
    ) IS TRUE),
  ADD COLUMN server_captured boolean NOT NULL DEFAULT false;

ALTER TABLE time_control_run DROP CONSTRAINT ck_time_control_run_type;
ALTER TABLE time_control_run ADD CONSTRAINT ck_time_control_run_type
  CHECK (control_type IN ('daily_09', 'friday_12', 'manual', 'friday_weekly_v1'));
ALTER TABLE time_control_run ADD CONSTRAINT ck_time_control_weekly_friday
  CHECK (control_type <> 'friday_weekly_v1' OR extract(isodow FROM controlled_date) = 5);

CREATE TABLE time_control_weekly_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  monday date NOT NULL CHECK (extract(isodow FROM monday) = 1),
  binding_hash text NOT NULL CHECK (binding_hash ~ '^[0-9a-f]{64}$'),
  proof_json jsonb NOT NULL CHECK (jsonb_typeof(proof_json) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, monday, binding_hash)
);

CREATE TABLE time_control_weekly_snapshot_day (
  snapshot_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  controlled_date date NOT NULL,
  dataset_id uuid NOT NULL,
  PRIMARY KEY (snapshot_id, tenant_id, controlled_date),
  FOREIGN KEY (snapshot_id, tenant_id)
    REFERENCES time_control_weekly_snapshot(id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (dataset_id, tenant_id, controlled_date)
    REFERENCES time_control_hours_dataset(id, tenant_id, controlled_date) ON DELETE RESTRICT
);

CREATE FUNCTION validate_time_control_weekly_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  snapshot_key uuid;
  tenant_key uuid;
  week_start date;
  day_count integer;
BEGIN
  snapshot_key := COALESCE(to_jsonb(NEW)->>'snapshot_id', to_jsonb(NEW)->>'id')::uuid;
  tenant_key := NEW.tenant_id;
  SELECT monday INTO week_start FROM time_control_weekly_snapshot WHERE id = snapshot_key AND tenant_id = tenant_key;
  SELECT count(*) INTO day_count FROM time_control_weekly_snapshot_day
    WHERE snapshot_id = snapshot_key AND tenant_id = tenant_key
      AND controlled_date BETWEEN week_start AND week_start + 4;
  IF day_count <> 5 OR EXISTS (
    SELECT 1 FROM time_control_weekly_snapshot_day WHERE snapshot_id = snapshot_key AND tenant_id = tenant_key
      AND controlled_date NOT BETWEEN week_start AND week_start + 4
  ) THEN RAISE EXCEPTION 'time_control_weekly_requires_five_days'; END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_time_control_weekly_complete
AFTER INSERT ON time_control_weekly_snapshot DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_time_control_weekly_snapshot();
CREATE CONSTRAINT TRIGGER trg_time_control_weekly_days_complete
AFTER INSERT ON time_control_weekly_snapshot_day DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_time_control_weekly_snapshot();
CREATE TRIGGER trg_time_control_weekly_immutable BEFORE UPDATE OR DELETE ON time_control_weekly_snapshot
FOR EACH ROW EXECUTE FUNCTION prevent_time_control_dataset_mutation();
CREATE TRIGGER trg_time_control_weekly_day_immutable BEFORE UPDATE OR DELETE ON time_control_weekly_snapshot_day
FOR EACH ROW EXECUTE FUNCTION prevent_time_control_dataset_mutation();
CREATE TRIGGER trg_time_control_weekly_no_truncate BEFORE TRUNCATE ON time_control_weekly_snapshot
FOR EACH STATEMENT EXECUTE FUNCTION prevent_time_control_dataset_mutation();
CREATE TRIGGER trg_time_control_weekly_day_no_truncate BEFORE TRUNCATE ON time_control_weekly_snapshot_day
FOR EACH STATEMENT EXECUTE FUNCTION prevent_time_control_dataset_mutation();

ALTER TABLE time_control_run
  ADD COLUMN weekly_snapshot_id uuid NULL,
  ADD CONSTRAINT fk_time_control_run_weekly_snapshot FOREIGN KEY (weekly_snapshot_id, tenant_id)
    REFERENCES time_control_weekly_snapshot(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT uq_time_control_run_weekly_binding UNIQUE (id, tenant_id, weekly_snapshot_id),
  ADD CONSTRAINT ck_time_control_run_weekly_binding CHECK (
    (control_type = 'friday_weekly_v1' AND hours_dataset_id IS NULL)
    OR (control_type <> 'friday_weekly_v1' AND weekly_snapshot_id IS NULL));

CREATE FUNCTION validate_time_control_weekly_run_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.weekly_snapshot_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM time_control_weekly_snapshot s
      WHERE s.id = NEW.weekly_snapshot_id AND s.tenant_id = NEW.tenant_id
        AND s.monday = NEW.controlled_date - 4
  ) THEN RAISE EXCEPTION 'time_control_weekly_run_period_mismatch'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_time_control_weekly_run_binding BEFORE INSERT OR UPDATE ON time_control_run
FOR EACH ROW EXECUTE FUNCTION validate_time_control_weekly_run_binding();

ALTER TABLE time_control_result DROP CONSTRAINT ck_time_control_result_status;
ALTER TABLE time_control_result ADD CONSTRAINT ck_time_control_result_status CHECK (
  status IN ('ok', 'missing_hours', 'config_error', 'sync_blocked', 'data_incomplete', 'unclassified_hours', 'weekly_reminder'));
ALTER TABLE time_control_result
  ADD COLUMN weekly_snapshot_id uuid NULL,
  ADD CONSTRAINT fk_time_control_result_weekly_binding FOREIGN KEY (run_id, tenant_id, weekly_snapshot_id)
    REFERENCES time_control_run(id, tenant_id, weekly_snapshot_id) DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT ck_time_control_weekly_result CHECK (
    weekly_snapshot_id IS NULL OR (hours_dataset_id IS NULL AND missing_hours IS NULL));
ALTER TABLE time_control_result ADD CONSTRAINT ck_time_control_weekly_reminder CHECK (
  status <> 'weekly_reminder' OR (weekly_snapshot_id IS NOT NULL AND coverage_status = 'complete'
    AND missing_hours IS NULL AND required_hours = 37 AND valid_hours < 37));

ALTER TABLE time_control_mail_log DROP CONSTRAINT ck_time_control_mail_log_type;
ALTER TABLE time_control_mail_log ADD CONSTRAINT ck_time_control_mail_log_type CHECK (
  mail_type IN ('employee_missing_hours', 'friday_manager_summary', 'internal_error',
    'employee_weekly_reminder_v1', 'friday_weekly_summary_v1'));

INSERT INTO email_template (template_key, version, is_active, subject_template, html_template, text_template, allowed_variables_json)
VALUES
  ('time_control.employee_weekly_reminder_v1', 1, true, '{{subject}}', '<p>{{body}}</p>', '{{body}}', '["subject","body"]'::jsonb),
  ('time_control.friday_weekly_summary_v1', 1, true, '{{subject}}', '<p>{{body}}</p>', '{{body}}', '["subject","body"]'::jsonb);

COMMIT;
