BEGIN;

CREATE TABLE IF NOT EXISTS project_assignment_source (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  tenant_user_id uuid NOT NULL,
  source_type text NOT NULL,
  source_key text NOT NULL,
  assignment_role text NOT NULL DEFAULT 'contributor',
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz NULL,
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  last_reconciliation_id uuid NULL,
  source_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_project_assignment_source_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_assignment_source_project_tenant FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_project_assignment_source_user_tenant FOREIGN KEY (tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT ck_project_assignment_source_type CHECK (source_type IN ('manual', 'worksheet')),
  CONSTRAINT ck_project_assignment_source_key_not_blank CHECK (btrim(source_key) <> ''),
  CONSTRAINT ck_project_assignment_source_role CHECK (assignment_role IN ('owner', 'contributor', 'reviewer')),
  CONSTRAINT ck_project_assignment_source_payload_object CHECK (jsonb_typeof(source_payload_json) = 'object'),
  CONSTRAINT ck_project_assignment_source_valid_window CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_assignment_source_source
  ON project_assignment_source (tenant_id, source_type, source_key);

CREATE INDEX IF NOT EXISTS ix_project_assignment_source_project_user
  ON project_assignment_source (tenant_id, project_id, tenant_user_id);

CREATE INDEX IF NOT EXISTS ix_project_assignment_source_user_valid
  ON project_assignment_source (tenant_id, tenant_user_id, valid_until);

CREATE INDEX IF NOT EXISTS ix_project_assignment_source_reconciliation
  ON project_assignment_source (tenant_id, source_type, last_reconciliation_id)
  WHERE source_type = 'worksheet';

DROP TRIGGER IF EXISTS trg_project_assignment_source_set_updated_at ON project_assignment_source;
CREATE TRIGGER trg_project_assignment_source_set_updated_at
BEFORE UPDATE ON project_assignment_source
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_project_assignment_source_prevent_immutable_update ON project_assignment_source;
CREATE TRIGGER trg_project_assignment_source_prevent_immutable_update
BEFORE UPDATE ON project_assignment_source
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'source_type', 'source_key', 'created_at');

INSERT INTO project_assignment_source (
  tenant_id,
  project_id,
  tenant_user_id,
  source_type,
  source_key,
  assignment_role,
  valid_from,
  last_observed_at,
  source_payload_json
)
SELECT
  pa.tenant_id,
  pa.project_id,
  pa.tenant_user_id,
  'manual',
  'manual:' || pa.project_id::text || ':' || pa.tenant_user_id::text,
  pa.assignment_role,
  pa.created_at,
  now(),
  jsonb_build_object('backfilled_from_project_assignment_id', pa.id)
FROM project_assignment pa
ON CONFLICT (tenant_id, source_type, source_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS ek_worksheet (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  worksheet_id text NOT NULL,
  ek_project_id bigint NULL,
  project_reference text NULL,
  project_id uuid NULL,
  fitter_id text NULL,
  responsible_fitter_id text NULL,
  tenant_user_id uuid NULL,
  status_enum text NULL,
  start_date timestamptz NULL,
  completed_date timestamptz NULL,
  closed_date timestamptz NULL,
  valid_until timestamptz NULL,
  is_access_candidate boolean NOT NULL DEFAULT false,
  access_blocked_reason text NULL,
  source_updated_at timestamptz NULL,
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  last_reconciliation_id uuid NULL,
  raw_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_ek_worksheet_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_ek_worksheet_project_tenant FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE SET NULL (project_id),
  CONSTRAINT fk_ek_worksheet_user_tenant FOREIGN KEY (tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (tenant_user_id),
  CONSTRAINT ck_ek_worksheet_id_not_blank CHECK (btrim(worksheet_id) <> ''),
  CONSTRAINT ck_ek_worksheet_payload_object CHECK (jsonb_typeof(raw_payload_json) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ek_worksheet_tenant_worksheet
  ON ek_worksheet (tenant_id, worksheet_id);

CREATE INDEX IF NOT EXISTS ix_ek_worksheet_tenant_project
  ON ek_worksheet (tenant_id, project_id);

CREATE INDEX IF NOT EXISTS ix_ek_worksheet_tenant_fitter
  ON ek_worksheet (tenant_id, fitter_id);

CREATE INDEX IF NOT EXISTS ix_ek_worksheet_tenant_user
  ON ek_worksheet (tenant_id, tenant_user_id)
  WHERE tenant_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_ek_worksheet_tenant_updated
  ON ek_worksheet (tenant_id, source_updated_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS ix_ek_worksheet_reconciliation
  ON ek_worksheet (tenant_id, last_reconciliation_id);

DROP TRIGGER IF EXISTS trg_ek_worksheet_set_updated_at ON ek_worksheet;
CREATE TRIGGER trg_ek_worksheet_set_updated_at
BEFORE UPDATE ON ek_worksheet
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_ek_worksheet_prevent_immutable_update ON ek_worksheet;
CREATE TRIGGER trg_ek_worksheet_prevent_immutable_update
BEFORE UPDATE ON ek_worksheet
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'worksheet_id', 'created_at');

COMMIT;
