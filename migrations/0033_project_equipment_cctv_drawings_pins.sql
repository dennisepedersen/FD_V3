BEGIN;

CREATE TABLE IF NOT EXISTS project_equipment_drawing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  equipment_area text NOT NULL DEFAULT 'cctv',
  storage_object_id uuid NOT NULL,
  title text NOT NULL,
  created_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_by_user_id uuid NULL,
  deleted_at timestamptz NULL,
  CONSTRAINT fk_project_equipment_drawing_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_equipment_drawing_project
    FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_equipment_drawing_storage_object
    FOREIGN KEY (storage_object_id, tenant_id) REFERENCES storage_object(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_equipment_drawing_created_by_user
    FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_project_equipment_drawing_updated_by_user
    FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_project_equipment_drawing_deleted_by_user
    FOREIGN KEY (deleted_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT uq_project_equipment_drawing_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT ck_project_equipment_drawing_area CHECK (equipment_area = 'cctv'),
  CONSTRAINT ck_project_equipment_drawing_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT ck_project_equipment_drawing_deleted_state CHECK (
    (deleted_at IS NULL AND deleted_by_user_id IS NULL)
    OR deleted_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS ix_project_equipment_drawing_project_active
  ON project_equipment_drawing (tenant_id, project_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_project_equipment_drawing_storage_object
  ON project_equipment_drawing (tenant_id, storage_object_id);

DROP TRIGGER IF EXISTS trg_project_equipment_drawing_set_updated_at
  ON project_equipment_drawing;
CREATE TRIGGER trg_project_equipment_drawing_set_updated_at
BEFORE UPDATE ON project_equipment_drawing
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_project_equipment_drawing_prevent_immutable_update
  ON project_equipment_drawing;
CREATE TRIGGER trg_project_equipment_drawing_prevent_immutable_update
BEFORE UPDATE ON project_equipment_drawing
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'project_id', 'equipment_area', 'storage_object_id', 'created_by_user_id', 'created_at');

CREATE TABLE IF NOT EXISTS project_equipment_cctv_pin (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  drawing_id uuid NOT NULL,
  camera_record_id uuid NOT NULL,
  coordinate_mode text NOT NULL DEFAULT 'percent',
  x_percent numeric(6,3) NOT NULL,
  y_percent numeric(6,3) NOT NULL,
  label text NULL,
  created_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_by_user_id uuid NULL,
  deleted_at timestamptz NULL,
  CONSTRAINT fk_project_equipment_cctv_pin_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_equipment_cctv_pin_project
    FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_equipment_cctv_pin_drawing
    FOREIGN KEY (drawing_id, tenant_id) REFERENCES project_equipment_drawing(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_project_equipment_cctv_pin_camera
    FOREIGN KEY (camera_record_id, tenant_id) REFERENCES project_equipment_cctv(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_project_equipment_cctv_pin_created_by_user
    FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_project_equipment_cctv_pin_updated_by_user
    FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_project_equipment_cctv_pin_deleted_by_user
    FOREIGN KEY (deleted_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT uq_project_equipment_cctv_pin_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT ck_project_equipment_cctv_pin_coordinate_mode CHECK (coordinate_mode = 'percent'),
  CONSTRAINT ck_project_equipment_cctv_pin_x_percent CHECK (x_percent >= 0 AND x_percent <= 100),
  CONSTRAINT ck_project_equipment_cctv_pin_y_percent CHECK (y_percent >= 0 AND y_percent <= 100),
  CONSTRAINT ck_project_equipment_cctv_pin_label_not_blank CHECK (label IS NULL OR btrim(label) <> ''),
  CONSTRAINT ck_project_equipment_cctv_pin_deleted_state CHECK (
    (deleted_at IS NULL AND deleted_by_user_id IS NULL)
    OR deleted_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_equipment_cctv_pin_active_camera_drawing
  ON project_equipment_cctv_pin (tenant_id, project_id, drawing_id, camera_record_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_project_equipment_cctv_pin_drawing_active
  ON project_equipment_cctv_pin (tenant_id, project_id, drawing_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_project_equipment_cctv_pin_camera_active
  ON project_equipment_cctv_pin (tenant_id, project_id, camera_record_id, updated_at DESC)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_project_equipment_cctv_pin_set_updated_at
  ON project_equipment_cctv_pin;
CREATE TRIGGER trg_project_equipment_cctv_pin_set_updated_at
BEFORE UPDATE ON project_equipment_cctv_pin
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_project_equipment_cctv_pin_prevent_immutable_update
  ON project_equipment_cctv_pin;
CREATE TRIGGER trg_project_equipment_cctv_pin_prevent_immutable_update
BEFORE UPDATE ON project_equipment_cctv_pin
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'project_id', 'drawing_id', 'camera_record_id', 'coordinate_mode', 'created_by_user_id', 'created_at');

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
      'project_equipment_cctv_exported',
      'project_equipment_cctv_pdf_exported',
      'project_equipment_cctv_image_uploaded',
      'project_equipment_cctv_image_replaced',
      'project_equipment_cctv_image_deleted',
      'project_equipment_cctv_drawing_uploaded',
      'project_equipment_cctv_drawing_deleted',
      'project_equipment_cctv_pin_created',
      'project_equipment_cctv_pin_updated',
      'project_equipment_cctv_pin_deleted',
      'storage_object_uploaded',
      'storage_object_downloaded',
      'storage_object_deleted'
    )
  );

COMMIT;
