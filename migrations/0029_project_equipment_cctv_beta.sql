BEGIN;

CREATE TABLE IF NOT EXISTS project_equipment_cctv (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  equipment_area text NOT NULL DEFAULT 'cctv',
  camera_id text NOT NULL,
  mac_address text NULL,
  mac_address_normalized text NULL,
  serial_number text NULL,
  model text NULL,
  location_text text NULL,
  status text NOT NULL DEFAULT 'registered',
  note text NULL,
  created_by_user_id uuid NULL,
  updated_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz NULL,
  CONSTRAINT fk_project_equipment_cctv_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_equipment_cctv_project
    FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_equipment_cctv_created_by_user
    FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_project_equipment_cctv_updated_by_user
    FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT uq_project_equipment_cctv_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT ck_project_equipment_cctv_area CHECK (equipment_area = 'cctv'),
  CONSTRAINT ck_project_equipment_cctv_camera_id_not_blank CHECK (btrim(camera_id) <> ''),
  CONSTRAINT ck_project_equipment_cctv_mac_not_blank CHECK (mac_address IS NULL OR btrim(mac_address) <> ''),
  CONSTRAINT ck_project_equipment_cctv_mac_normalized CHECK (
    mac_address_normalized IS NULL OR mac_address_normalized ~ '^[0-9A-F]{12}$'
  ),
  CONSTRAINT ck_project_equipment_cctv_serial_not_blank CHECK (serial_number IS NULL OR btrim(serial_number) <> ''),
  CONSTRAINT ck_project_equipment_cctv_model_not_blank CHECK (model IS NULL OR btrim(model) <> ''),
  CONSTRAINT ck_project_equipment_cctv_location_not_blank CHECK (location_text IS NULL OR btrim(location_text) <> ''),
  CONSTRAINT ck_project_equipment_cctv_status CHECK (status IN ('registered', 'planned', 'mounted', 'checked', 'deviation')),
  CONSTRAINT ck_project_equipment_cctv_note_not_blank CHECK (note IS NULL OR btrim(note) <> ''),
  CONSTRAINT ck_project_equipment_cctv_archived_after_create CHECK (archived_at IS NULL OR archived_at >= created_at)
);

CREATE INDEX IF NOT EXISTS ix_project_equipment_cctv_project_status
  ON project_equipment_cctv (tenant_id, project_id, status, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_project_equipment_cctv_project_camera
  ON project_equipment_cctv (tenant_id, project_id, lower(camera_id))
  WHERE archived_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_equipment_cctv_project_mac_active
  ON project_equipment_cctv (tenant_id, project_id, mac_address_normalized)
  WHERE archived_at IS NULL AND mac_address_normalized IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_equipment_cctv_project_serial_active
  ON project_equipment_cctv (tenant_id, project_id, lower(serial_number))
  WHERE archived_at IS NULL AND serial_number IS NOT NULL;

DROP TRIGGER IF EXISTS trg_project_equipment_cctv_set_updated_at
  ON project_equipment_cctv;
CREATE TRIGGER trg_project_equipment_cctv_set_updated_at
BEFORE UPDATE ON project_equipment_cctv
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_project_equipment_cctv_prevent_immutable_update
  ON project_equipment_cctv;
CREATE TRIGGER trg_project_equipment_cctv_prevent_immutable_update
BEFORE UPDATE ON project_equipment_cctv
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'project_id', 'equipment_area', 'created_by_user_id', 'created_at');

ALTER TABLE audit_event
  DROP CONSTRAINT IF EXISTS ck_audit_event_event_type;

ALTER TABLE audit_event
  ADD CONSTRAINT ck_audit_event_event_type CHECK (
    event_type IN (
      'invitation_created',
      'invitation_accepted',
      'invitation_revoked',
      'login_success',
      'login_fail',
      'tenant_status_changed',
      'tenant_config_changed',
      'role_changed',
      'sync_success',
      'sync_fail',
      'support_access_denied',
      'onboarding_created',
      'onboarding_started',
      'onboarding_completed',
      'invitation_accept_success',
      'logout',
      'qa_thread_created',
      'qa_message_created',
      'qa_thread_status_changed',
      'qa_thread_seen',
      'qa_thread_participant_added',
      'project_equipment_cctv_created',
      'project_equipment_cctv_updated',
      'project_equipment_cctv_archived',
      'project_equipment_cctv_checked',
      'project_equipment_cctv_exported'
    )
  );

COMMIT;
