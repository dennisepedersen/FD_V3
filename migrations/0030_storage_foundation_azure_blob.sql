BEGIN;

CREATE TABLE IF NOT EXISTS storage_object (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NULL,
  module_key text NULL,
  resource_type text NULL,
  resource_id text NULL,
  storage_provider text NOT NULL DEFAULT 'azure_blob',
  storage_key text NOT NULL,
  original_filename text NULL,
  content_type text NOT NULL,
  byte_size bigint NOT NULL,
  checksum_sha256 text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid NULL,
  deleted_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  CONSTRAINT fk_storage_object_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_storage_object_project
    FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_storage_object_created_by_user
    FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_storage_object_deleted_by_user
    FOREIGN KEY (deleted_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT uq_storage_object_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT uq_storage_object_provider_key UNIQUE (storage_provider, storage_key),
  CONSTRAINT ck_storage_object_provider CHECK (storage_provider = 'azure_blob'),
  CONSTRAINT ck_storage_object_key_not_blank CHECK (btrim(storage_key) <> ''),
  CONSTRAINT ck_storage_object_original_filename_not_blank CHECK (
    original_filename IS NULL OR btrim(original_filename) <> ''
  ),
  CONSTRAINT ck_storage_object_content_type_not_blank CHECK (btrim(content_type) <> ''),
  CONSTRAINT ck_storage_object_byte_size CHECK (byte_size >= 0),
  CONSTRAINT ck_storage_object_checksum_sha256 CHECK (
    checksum_sha256 IS NULL OR checksum_sha256 ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT ck_storage_object_metadata_is_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT ck_storage_object_deleted_state CHECK (
    (deleted_at IS NULL AND deleted_by_user_id IS NULL)
    OR deleted_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS ix_storage_object_tenant_project_active
  ON storage_object (tenant_id, project_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_storage_object_resource_active
  ON storage_object (tenant_id, module_key, resource_type, resource_id, created_at DESC)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_storage_object_set_updated_at
  ON storage_object;
CREATE TRIGGER trg_storage_object_set_updated_at
BEFORE UPDATE ON storage_object
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_storage_object_prevent_immutable_update
  ON storage_object;
CREATE TRIGGER trg_storage_object_prevent_immutable_update
BEFORE UPDATE ON storage_object
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update(
  'id',
  'tenant_id',
  'project_id',
  'storage_provider',
  'storage_key',
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
      'storage_object_uploaded',
      'storage_object_downloaded',
      'storage_object_deleted'
    )
  );

COMMIT;
