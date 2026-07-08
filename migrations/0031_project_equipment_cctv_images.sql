BEGIN;

CREATE TABLE IF NOT EXISTS project_equipment_cctv_image (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  camera_record_id uuid NOT NULL,
  storage_object_id uuid NOT NULL,
  slot_type text NOT NULL,
  created_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_by_user_id uuid NULL,
  deleted_at timestamptz NULL,
  CONSTRAINT fk_project_equipment_cctv_image_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_equipment_cctv_image_project
    FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_equipment_cctv_image_camera
    FOREIGN KEY (camera_record_id, tenant_id) REFERENCES project_equipment_cctv(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_project_equipment_cctv_image_storage_object
    FOREIGN KEY (storage_object_id, tenant_id) REFERENCES storage_object(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_equipment_cctv_image_created_by_user
    FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_project_equipment_cctv_image_updated_by_user
    FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_project_equipment_cctv_image_deleted_by_user
    FOREIGN KEY (deleted_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT uq_project_equipment_cctv_image_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT ck_project_equipment_cctv_image_slot CHECK (slot_type IN ('projection', 'installation')),
  CONSTRAINT ck_project_equipment_cctv_image_deleted_state CHECK (
    (deleted_at IS NULL AND deleted_by_user_id IS NULL)
    OR deleted_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_equipment_cctv_image_active_slot
  ON project_equipment_cctv_image (tenant_id, project_id, camera_record_id, slot_type)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_project_equipment_cctv_image_camera_active
  ON project_equipment_cctv_image (tenant_id, project_id, camera_record_id, slot_type)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_project_equipment_cctv_image_storage_object
  ON project_equipment_cctv_image (tenant_id, storage_object_id);

DROP TRIGGER IF EXISTS trg_project_equipment_cctv_image_set_updated_at
  ON project_equipment_cctv_image;
CREATE TRIGGER trg_project_equipment_cctv_image_set_updated_at
BEFORE UPDATE ON project_equipment_cctv_image
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_project_equipment_cctv_image_prevent_immutable_update
  ON project_equipment_cctv_image;
CREATE TRIGGER trg_project_equipment_cctv_image_prevent_immutable_update
BEFORE UPDATE ON project_equipment_cctv_image
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update(
  'id',
  'tenant_id',
  'project_id',
  'camera_record_id',
  'storage_object_id',
  'slot_type',
  'created_by_user_id',
  'created_at'
);

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
      'project_equipment_cctv_image_uploaded',
      'project_equipment_cctv_image_replaced',
      'project_equipment_cctv_image_deleted',
      'storage_object_uploaded',
      'storage_object_downloaded',
      'storage_object_deleted'
    )
  );

COMMIT;
