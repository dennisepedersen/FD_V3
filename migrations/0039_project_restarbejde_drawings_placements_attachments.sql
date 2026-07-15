BEGIN;

-- 39) project restarbejde drawings, placements and attachments

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
      'tenant_user_created',
      'tenant_user_updated',
      'tenant_user_invite_requested',
      'tenant_user_invite_sent',
      'tenant_user_invite_send_failed',
      'tenant_user_invite_revoked',
      'tenant_user_invite_accepted',
      'tenant_user_deactivated',
      'tenant_user_sessions_revoked',
      'tenant_user_reactivation_requested',
      'tenant_user_reactivation_invite_sent',
      'tenant_user_reactivation_invite_failed',
      'tenant_user_reactivated',
      'resource_group_created',
      'resource_group_updated',
      'resource_group_member_changed',
      'sync_requested',
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
      'project_equipment_cctv_drawing_pdf_imported',
      'project_equipment_cctv_pin_created',
      'project_equipment_cctv_pin_updated',
      'project_equipment_cctv_pin_deleted',
      'restarbejde.item_created',
      'restarbejde.item_updated',
      'restarbejde.item_status_changed',
      'restarbejde.item_archived',
      'restarbejde.item_restored',
      'restarbejde.drawing_created',
      'restarbejde.drawing_archived',
      'restarbejde.drawing_restored',
      'restarbejde.placement_created',
      'restarbejde.placement_updated',
      'restarbejde.placement_archived',
      'restarbejde.placement_restored',
      'restarbejde.attachment_created',
      'restarbejde.attachment_archived',
      'storage_object_uploaded',
      'storage_object_downloaded',
      'storage_object_deleted'
    )
  );

ALTER TABLE project_restarbejde_item
  ADD CONSTRAINT uq_project_restarbejde_item_id_tenant_project UNIQUE (id, tenant_id, project_id);

CREATE TABLE project_restarbejde_drawing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  title text NOT NULL,
  source_type text NOT NULL,
  storage_object_id uuid NOT NULL,
  original_filename text NULL,
  mime_type text NOT NULL,
  file_size_bytes bigint NOT NULL,
  page_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid NOT NULL,
  updated_by_user_id uuid NOT NULL,
  archived_at timestamptz NULL,
  archived_by_user_id uuid NULL,
  CONSTRAINT fk_project_restarbejde_drawing_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_restarbejde_drawing_project FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_drawing_storage_object FOREIGN KEY (storage_object_id, tenant_id) REFERENCES storage_object(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_drawing_created_by_user FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_drawing_updated_by_user FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_drawing_archived_by_user FOREIGN KEY (archived_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (archived_by_user_id),
  CONSTRAINT uq_project_restarbejde_drawing_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT uq_project_restarbejde_drawing_id_tenant_project UNIQUE (id, tenant_id, project_id),
  CONSTRAINT ck_project_restarbejde_drawing_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT ck_project_restarbejde_drawing_source_type CHECK (source_type IN ('image', 'pdf')),
  CONSTRAINT ck_project_restarbejde_drawing_filename_not_blank CHECK (original_filename IS NULL OR btrim(original_filename) <> ''),
  CONSTRAINT ck_project_restarbejde_drawing_mime_not_blank CHECK (btrim(mime_type) <> ''),
  CONSTRAINT ck_project_restarbejde_drawing_file_size CHECK (file_size_bytes > 0),
  CONSTRAINT ck_project_restarbejde_drawing_page_count CHECK (
    (source_type = 'image' AND page_count = 1)
    OR (source_type = 'pdf' AND page_count >= 1)
  ),
  CONSTRAINT ck_project_restarbejde_drawing_archive_state CHECK (
    (archived_at IS NULL AND archived_by_user_id IS NULL)
    OR (archived_at IS NOT NULL AND archived_by_user_id IS NOT NULL AND archived_at >= created_at)
  )
);

CREATE INDEX ix_project_restarbejde_drawing_project_active
  ON project_restarbejde_drawing (tenant_id, project_id, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX ix_project_restarbejde_drawing_project_archived
  ON project_restarbejde_drawing (tenant_id, project_id, archived_at DESC)
  WHERE archived_at IS NOT NULL;

CREATE INDEX ix_project_restarbejde_drawing_storage_object
  ON project_restarbejde_drawing (tenant_id, storage_object_id);

CREATE TRIGGER trg_project_restarbejde_drawing_set_updated_at
BEFORE UPDATE ON project_restarbejde_drawing
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_project_restarbejde_drawing_prevent_immutable_update
BEFORE UPDATE ON project_restarbejde_drawing
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update(
  'id',
  'tenant_id',
  'project_id',
  'storage_object_id',
  'source_type',
  'created_by_user_id',
  'created_at'
);

CREATE TABLE project_restarbejde_placement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  item_id uuid NOT NULL,
  drawing_id uuid NOT NULL,
  page_number integer NOT NULL,
  x_percent numeric(6,3) NOT NULL,
  y_percent numeric(6,3) NOT NULL,
  label text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid NOT NULL,
  updated_by_user_id uuid NOT NULL,
  archived_at timestamptz NULL,
  archived_by_user_id uuid NULL,
  CONSTRAINT fk_project_restarbejde_placement_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_restarbejde_placement_project FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_placement_item FOREIGN KEY (item_id, tenant_id, project_id) REFERENCES project_restarbejde_item(id, tenant_id, project_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_placement_drawing FOREIGN KEY (drawing_id, tenant_id, project_id) REFERENCES project_restarbejde_drawing(id, tenant_id, project_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_placement_created_by_user FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_placement_updated_by_user FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_placement_archived_by_user FOREIGN KEY (archived_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (archived_by_user_id),
  CONSTRAINT uq_project_restarbejde_placement_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT ck_project_restarbejde_placement_page_number CHECK (page_number >= 1),
  CONSTRAINT ck_project_restarbejde_placement_x_percent CHECK (x_percent >= 0 AND x_percent <= 100),
  CONSTRAINT ck_project_restarbejde_placement_y_percent CHECK (y_percent >= 0 AND y_percent <= 100),
  CONSTRAINT ck_project_restarbejde_placement_label_not_blank CHECK (label IS NULL OR btrim(label) <> ''),
  CONSTRAINT ck_project_restarbejde_placement_archive_state CHECK (
    (archived_at IS NULL AND archived_by_user_id IS NULL)
    OR (archived_at IS NOT NULL AND archived_by_user_id IS NOT NULL AND archived_at >= created_at)
  )
);

CREATE INDEX ix_project_restarbejde_placement_drawing_active
  ON project_restarbejde_placement (tenant_id, project_id, drawing_id, page_number, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX ix_project_restarbejde_placement_item_active
  ON project_restarbejde_placement (tenant_id, project_id, item_id, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX ix_project_restarbejde_placement_archived
  ON project_restarbejde_placement (tenant_id, project_id, archived_at DESC)
  WHERE archived_at IS NOT NULL;

CREATE TRIGGER trg_project_restarbejde_placement_set_updated_at
BEFORE UPDATE ON project_restarbejde_placement
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_project_restarbejde_placement_prevent_immutable_update
BEFORE UPDATE ON project_restarbejde_placement
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update(
  'id',
  'tenant_id',
  'project_id',
  'item_id',
  'drawing_id',
  'created_by_user_id',
  'created_at'
);

CREATE TABLE project_restarbejde_attachment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  item_id uuid NOT NULL,
  storage_object_id uuid NOT NULL,
  attachment_type text NOT NULL,
  original_filename text NULL,
  mime_type text NOT NULL,
  file_size_bytes bigint NOT NULL,
  caption text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid NOT NULL,
  archived_at timestamptz NULL,
  archived_by_user_id uuid NULL,
  CONSTRAINT fk_project_restarbejde_attachment_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_restarbejde_attachment_project FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_attachment_item FOREIGN KEY (item_id, tenant_id, project_id) REFERENCES project_restarbejde_item(id, tenant_id, project_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_attachment_storage_object FOREIGN KEY (storage_object_id, tenant_id) REFERENCES storage_object(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_attachment_created_by_user FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_attachment_archived_by_user FOREIGN KEY (archived_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (archived_by_user_id),
  CONSTRAINT uq_project_restarbejde_attachment_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT ck_project_restarbejde_attachment_type CHECK (attachment_type IN ('photo', 'document', 'other')),
  CONSTRAINT ck_project_restarbejde_attachment_filename_not_blank CHECK (original_filename IS NULL OR btrim(original_filename) <> ''),
  CONSTRAINT ck_project_restarbejde_attachment_mime_not_blank CHECK (btrim(mime_type) <> ''),
  CONSTRAINT ck_project_restarbejde_attachment_file_size CHECK (file_size_bytes > 0),
  CONSTRAINT ck_project_restarbejde_attachment_caption_not_blank CHECK (caption IS NULL OR btrim(caption) <> ''),
  CONSTRAINT ck_project_restarbejde_attachment_archive_state CHECK (
    (archived_at IS NULL AND archived_by_user_id IS NULL)
    OR (archived_at IS NOT NULL AND archived_by_user_id IS NOT NULL AND archived_at >= created_at)
  )
);

CREATE INDEX ix_project_restarbejde_attachment_item_active
  ON project_restarbejde_attachment (tenant_id, project_id, item_id, created_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX ix_project_restarbejde_attachment_archived
  ON project_restarbejde_attachment (tenant_id, project_id, archived_at DESC)
  WHERE archived_at IS NOT NULL;

CREATE INDEX ix_project_restarbejde_attachment_storage_object
  ON project_restarbejde_attachment (tenant_id, storage_object_id);

COMMIT;
