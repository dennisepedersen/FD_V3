BEGIN;

CREATE TABLE IF NOT EXISTS resource_absences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  -- V1 links absence to the imported fitter identity. A neutral resource_person
  -- model can be added later without renaming this Fielddesk-owned table.
  fitter_id text NOT NULL,
  absence_type text NOT NULL,
  status text NOT NULL DEFAULT 'approved',
  start_date date NOT NULL,
  end_date date NOT NULL,
  note text NULL,
  visibility_scope text NOT NULL DEFAULT 'tenant_admin_only',
  created_by_user_id uuid NULL,
  updated_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz NULL,
  cancelled_by_user_id uuid NULL,
  CONSTRAINT fk_resource_absences_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_resource_absences_fitter
    FOREIGN KEY (tenant_id, fitter_id) REFERENCES fitter(tenant_id, fitter_id) ON DELETE RESTRICT,
  CONSTRAINT fk_resource_absences_created_by_user
    FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_resource_absences_updated_by_user
    FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_resource_absences_cancelled_by_user
    FOREIGN KEY (cancelled_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT ck_resource_absences_type CHECK (
    absence_type IN ('vacation', 'vacation_free', 'course', 'sickness', 'other')
  ),
  CONSTRAINT ck_resource_absences_status CHECK (
    status IN ('draft', 'requested', 'approved', 'rejected', 'cancelled')
  ),
  CONSTRAINT ck_resource_absences_visibility_scope CHECK (
    visibility_scope IN ('tenant_admin_only', 'limited_availability', 'manager_full', 'finance_relevant', 'custom')
  ),
  CONSTRAINT ck_resource_absences_date_range CHECK (end_date >= start_date),
  CONSTRAINT ck_resource_absences_note_not_blank CHECK (note IS NULL OR btrim(note) <> ''),
  CONSTRAINT ck_resource_absences_cancelled_state CHECK (
    (status = 'cancelled' AND cancelled_at IS NOT NULL)
    OR
    (status <> 'cancelled' AND cancelled_at IS NULL AND cancelled_by_user_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS ix_resource_absences_tenant_range
  ON resource_absences (tenant_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS ix_resource_absences_tenant_fitter_range
  ON resource_absences (tenant_id, fitter_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS ix_resource_absences_tenant_status_range
  ON resource_absences (tenant_id, status, start_date, end_date);

DROP TRIGGER IF EXISTS trg_resource_absences_set_updated_at
  ON resource_absences;
CREATE TRIGGER trg_resource_absences_set_updated_at
BEFORE UPDATE ON resource_absences
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_resource_absences_prevent_immutable_update
  ON resource_absences;
CREATE TRIGGER trg_resource_absences_prevent_immutable_update
BEFORE UPDATE ON resource_absences
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'fitter_id', 'created_by_user_id', 'created_at');

COMMIT;
