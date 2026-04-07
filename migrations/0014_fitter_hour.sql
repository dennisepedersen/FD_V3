BEGIN;

CREATE TABLE IF NOT EXISTS fitter_hour (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  source_key text NOT NULL,
  fitter_hour_id text NULL,
  external_project_ref text NULL,
  project_id text NULL,
  fitter_id text NULL,
  fitter_username text NULL,
  fitter_salary_id text NULL,
  fitter_reference text NULL,
  fitter_category_id text NULL,
  fitter_category_reference text NULL,
  work_date timestamptz NULL,
  registration_date timestamptz NULL,
  hours numeric(12,2) NULL,
  quantity numeric(12,2) NULL,
  unit text NULL,
  note text NULL,
  description text NULL,
  raw_payload_json jsonb NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_fitter_hour_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT ck_fitter_hour_source_key_not_blank CHECK (btrim(source_key) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fitter_hour_tenant_source_key
  ON fitter_hour (tenant_id, source_key);

CREATE INDEX IF NOT EXISTS ix_fitter_hour_tenant_work_date
  ON fitter_hour (tenant_id, work_date DESC);

CREATE INDEX IF NOT EXISTS ix_fitter_hour_tenant_project_ref
  ON fitter_hour (tenant_id, external_project_ref);

CREATE INDEX IF NOT EXISTS ix_fitter_hour_tenant_fitter_id
  ON fitter_hour (tenant_id, fitter_id);

CREATE INDEX IF NOT EXISTS ix_fitter_hour_tenant_fitter_category_id
  ON fitter_hour (tenant_id, fitter_category_id);

DROP TRIGGER IF EXISTS trg_fitter_hour_set_updated_at ON fitter_hour;
CREATE TRIGGER trg_fitter_hour_set_updated_at
BEFORE UPDATE ON fitter_hour
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_fitter_hour_prevent_immutable_update ON fitter_hour;
CREATE TRIGGER trg_fitter_hour_prevent_immutable_update
BEFORE UPDATE ON fitter_hour
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'source_key', 'created_at');

COMMIT;
