ALTER TABLE time_control_result
  ALTER COLUMN missing_hours DROP NOT NULL,
  ADD COLUMN coverage_status text NOT NULL DEFAULT 'incomplete',
  ADD COLUMN data_quality_reason text NULL,
  ADD COLUMN unclassified_hours numeric(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN unclassified_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  DROP CONSTRAINT ck_time_control_result_status,
  ADD CONSTRAINT ck_time_control_result_status
    CHECK (status IN ('ok', 'missing_hours', 'config_error', 'sync_blocked', 'data_incomplete', 'unclassified_hours')),
  ADD CONSTRAINT ck_time_control_result_coverage
    CHECK (coverage_status IN ('complete', 'incomplete')),
  ADD CONSTRAINT ck_time_control_result_data_quality_reason
    CHECK (data_quality_reason IS NULL OR char_length(data_quality_reason) <= 500),
  ADD CONSTRAINT ck_time_control_result_unclassified_hours
    CHECK (unclassified_hours >= 0),
  ADD CONSTRAINT ck_time_control_result_unclassified_rows
    CHECK (jsonb_typeof(unclassified_rows) = 'array'),
  ADD CONSTRAINT ck_time_control_result_uncertain_missing_hours
    CHECK (status NOT IN ('data_incomplete', 'unclassified_hours') OR missing_hours IS NULL);
