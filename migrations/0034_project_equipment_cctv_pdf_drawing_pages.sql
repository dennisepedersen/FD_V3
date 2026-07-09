BEGIN;

ALTER TABLE project_equipment_drawing
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'image',
  ADD COLUMN IF NOT EXISTS source_storage_object_id uuid NULL,
  ADD COLUMN IF NOT EXISTS pdf_page_number integer NULL,
  ADD COLUMN IF NOT EXISTS page_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_filename text NULL;

UPDATE project_equipment_drawing
SET source_storage_object_id = storage_object_id
WHERE source_storage_object_id IS NULL;

ALTER TABLE project_equipment_drawing
  DROP CONSTRAINT IF EXISTS fk_project_equipment_drawing_source_storage_object;

ALTER TABLE project_equipment_drawing
  ADD CONSTRAINT fk_project_equipment_drawing_source_storage_object
  FOREIGN KEY (source_storage_object_id, tenant_id) REFERENCES storage_object(id, tenant_id) ON DELETE RESTRICT;

ALTER TABLE project_equipment_drawing
  DROP CONSTRAINT IF EXISTS ck_project_equipment_drawing_source_type;

ALTER TABLE project_equipment_drawing
  ADD CONSTRAINT ck_project_equipment_drawing_source_type CHECK (source_type IN ('image', 'pdf_page'));

ALTER TABLE project_equipment_drawing
  DROP CONSTRAINT IF EXISTS ck_project_equipment_drawing_pdf_page_state;

ALTER TABLE project_equipment_drawing
  ADD CONSTRAINT ck_project_equipment_drawing_pdf_page_state CHECK (
    (source_type = 'image' AND pdf_page_number IS NULL)
    OR (source_type = 'pdf_page' AND source_storage_object_id IS NOT NULL AND pdf_page_number IS NOT NULL AND pdf_page_number > 0)
  );

CREATE INDEX IF NOT EXISTS ix_project_equipment_drawing_project_order_active
  ON project_equipment_drawing (tenant_id, project_id, page_order ASC, created_at ASC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_project_equipment_drawing_source_storage_object
  ON project_equipment_drawing (tenant_id, source_storage_object_id)
  WHERE source_storage_object_id IS NOT NULL;

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
      'project_equipment_cctv_drawing_pdf_imported',
      'project_equipment_cctv_pin_created',
      'project_equipment_cctv_pin_updated',
      'project_equipment_cctv_pin_deleted',
      'storage_object_uploaded',
      'storage_object_downloaded',
      'storage_object_deleted'
    )
  );

COMMIT;
