BEGIN;

CREATE TABLE time_control_hours_dataset (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  controlled_date date NOT NULL,
  dataset_revision text NOT NULL CHECK (dataset_revision ~ '^[0-9a-f]{64}$'),
  rows_hash text NOT NULL CHECK (rows_hash ~ '^[0-9a-f]{64}$'),
  capture_key text NOT NULL CHECK (capture_key ~ '^[0-9a-f]{64}$'),
  row_count integer NOT NULL CHECK (row_count > 0),
  evidence_json jsonb NOT NULL CHECK (jsonb_typeof(evidence_json) = 'object'),
  proof_json jsonb NOT NULL CHECK (jsonb_typeof(proof_json) = 'object'),
  observed_at timestamptz NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_time_control_dataset_capture UNIQUE (tenant_id, controlled_date, capture_key),
  CONSTRAINT uq_time_control_dataset_tenant UNIQUE (id, tenant_id),
  CONSTRAINT uq_time_control_dataset_day UNIQUE (id, tenant_id, controlled_date)
);

CREATE FUNCTION prevent_time_control_dataset_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'time_control_hours_dataset_immutable';
END;
$$;

CREATE TRIGGER trg_time_control_dataset_immutable
BEFORE UPDATE OR DELETE ON time_control_hours_dataset
FOR EACH ROW EXECUTE FUNCTION prevent_time_control_dataset_mutation();

CREATE TABLE time_control_hours_dataset_head (
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  controlled_date date NOT NULL,
  dataset_id uuid NULL,
  invalidated_at timestamptz NULL,
  CHECK ((dataset_id IS NOT NULL AND invalidated_at IS NULL) OR
    (dataset_id IS NULL AND invalidated_at IS NOT NULL)),
  PRIMARY KEY (tenant_id, controlled_date),
  CONSTRAINT fk_time_control_dataset_head
    FOREIGN KEY (dataset_id, tenant_id, controlled_date)
    REFERENCES time_control_hours_dataset(id, tenant_id, controlled_date) ON DELETE RESTRICT
);

ALTER TABLE time_control_run
  ADD COLUMN hours_dataset_id uuid NULL,
  ADD CONSTRAINT uq_time_control_run_dataset_binding UNIQUE (id, tenant_id, hours_dataset_id),
  ADD CONSTRAINT fk_time_control_run_dataset
    FOREIGN KEY (hours_dataset_id, tenant_id, controlled_date)
    REFERENCES time_control_hours_dataset(id, tenant_id, controlled_date) ON DELETE RESTRICT;

ALTER TABLE time_control_result
  ADD COLUMN hours_dataset_id uuid NULL,
  ADD CONSTRAINT fk_time_control_result_dataset
    FOREIGN KEY (hours_dataset_id, tenant_id)
    REFERENCES time_control_hours_dataset(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_time_control_result_run_dataset
    FOREIGN KEY (run_id, tenant_id, hours_dataset_id)
    REFERENCES time_control_run(id, tenant_id, hours_dataset_id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_time_control_result_dataset
  ON time_control_result (tenant_id, hours_dataset_id) WHERE hours_dataset_id IS NOT NULL;

COMMIT;
