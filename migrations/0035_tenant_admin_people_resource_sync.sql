BEGIN;

ALTER TABLE fitter
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'ekomplet',
  ADD COLUMN IF NOT EXISTS external_source text NULL,
  ADD COLUMN IF NOT EXISTS external_id text NULL,
  ADD COLUMN IF NOT EXISTS tenant_user_id uuid NULL,
  ADD COLUMN IF NOT EXISTS manual_note text NULL;

UPDATE fitter
SET
  source = COALESCE(NULLIF(source, ''), 'ekomplet'),
  external_source = COALESCE(external_source, 'ekomplet'),
  external_id = COALESCE(external_id, fitter_id)
WHERE external_source IS NULL
   OR external_id IS NULL
   OR source IS NULL
   OR source = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_fitter_tenant_user'
  ) THEN
    ALTER TABLE fitter
      ADD CONSTRAINT fk_fitter_tenant_user
      FOREIGN KEY (tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (tenant_user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_fitter_source'
  ) THEN
    ALTER TABLE fitter
      ADD CONSTRAINT ck_fitter_source CHECK (source IN ('manual', 'ekomplet'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fitter_tenant_source_external
  ON fitter (tenant_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_fitter_tenant_user
  ON fitter (tenant_id, tenant_user_id)
  WHERE tenant_user_id IS NOT NULL;

ALTER TABLE resource_groups
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS external_source text NULL,
  ADD COLUMN IF NOT EXISTS external_id text NULL,
  ADD COLUMN IF NOT EXISTS short_code text NULL,
  ADD COLUMN IF NOT EXISTS area text NULL,
  ADD COLUMN IF NOT EXISTS discipline text NULL,
  ADD COLUMN IF NOT EXISTS category text NULL,
  ADD COLUMN IF NOT EXISTS external_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_resource_groups_source'
  ) THEN
    ALTER TABLE resource_groups
      ADD CONSTRAINT ck_resource_groups_source CHECK (source IN ('manual', 'ekomplet'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_resource_groups_external_metadata_object'
  ) THEN
    ALTER TABLE resource_groups
      ADD CONSTRAINT ck_resource_groups_external_metadata_object CHECK (jsonb_typeof(external_metadata) = 'object');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_resource_groups_tenant_source_external
  ON resource_groups (tenant_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_resource_groups_tenant_short_code
  ON resource_groups (tenant_id, short_code)
  WHERE short_code IS NOT NULL;

ALTER TABLE resource_group_members
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS external_source text NULL,
  ADD COLUMN IF NOT EXISTS external_id text NULL,
  ADD COLUMN IF NOT EXISTS external_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_resource_group_members_source'
  ) THEN
    ALTER TABLE resource_group_members
      ADD CONSTRAINT ck_resource_group_members_source CHECK (source IN ('manual', 'ekomplet'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_resource_group_members_external_metadata_object'
  ) THEN
    ALTER TABLE resource_group_members
      ADD CONSTRAINT ck_resource_group_members_external_metadata_object CHECK (jsonb_typeof(external_metadata) = 'object');
  END IF;
END $$;

ALTER TABLE sync_job
  ADD COLUMN IF NOT EXISTS endpoint_key text NULL,
  ADD COLUMN IF NOT EXISTS requested_by_user_id uuid NULL,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_sync_job_endpoint_key_not_blank'
  ) THEN
    ALTER TABLE sync_job
      ADD CONSTRAINT ck_sync_job_endpoint_key_not_blank CHECK (endpoint_key IS NULL OR btrim(endpoint_key) <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_sync_job_metadata_object'
  ) THEN
    ALTER TABLE sync_job
      ADD CONSTRAINT ck_sync_job_metadata_object CHECK (jsonb_typeof(metadata) = 'object');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_sync_job_tenant_endpoint_status
  ON sync_job (tenant_id, endpoint_key, status, created_at DESC)
  WHERE endpoint_key IS NOT NULL;

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
      'storage_object_uploaded',
      'storage_object_downloaded',
      'storage_object_deleted'
    )
  );

COMMIT;
