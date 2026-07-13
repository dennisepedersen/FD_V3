BEGIN;

-- ============================================================================
-- 38) project restarbejde foundation
-- ============================================================================

ALTER TABLE audit_event DROP CONSTRAINT IF EXISTS ck_audit_event_event_type;
ALTER TABLE audit_event ADD CONSTRAINT ck_audit_event_event_type CHECK (
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
      'project_assignment_created',
      'project_assignment_updated',
      'project_assignment_removed',
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
      'storage_object_uploaded',
      'storage_object_downloaded',
      'storage_object_deleted'
  )
);

CREATE TABLE project_restarbejde_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  description text NULL,
  trade_key text NOT NULL,
  status text NOT NULL,
  priority text NULL,
  risk text NULL,
  location_text text NULL,
  assigned_tenant_user_id uuid NULL,
  responsible_text text NULL,
  deadline date NULL,
  percent_complete integer NULL,
  external_party text NULL,
  blocks_delivery boolean NOT NULL DEFAULT false,
  escalated boolean NOT NULL DEFAULT false,
  can_internal_team_act boolean NULL,
  comment text NULL,
  source text NULL,
  external_import_id text NULL,
  external_import_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid NOT NULL,
  updated_by_user_id uuid NOT NULL,
  closed_at timestamptz NULL,
  closed_by_user_id uuid NULL,
  archived_at timestamptz NULL,
  archived_by_user_id uuid NULL,
  CONSTRAINT fk_project_restarbejde_item_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_restarbejde_item_project FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_item_assigned_user FOREIGN KEY (assigned_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_project_restarbejde_item_created_by_user FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_item_updated_by_user FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_restarbejde_item_closed_by_user FOREIGN KEY (closed_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_project_restarbejde_item_archived_by_user FOREIGN KEY (archived_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT uq_project_restarbejde_item_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT ck_project_restarbejde_item_kind CHECK (kind IN ('internal_defect', 'obs')),
  CONSTRAINT ck_project_restarbejde_item_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT ck_project_restarbejde_item_trade_key_not_blank CHECK (btrim(trade_key) <> ''),
  CONSTRAINT ck_project_restarbejde_item_text_not_blank CHECK (
    (description IS NULL OR btrim(description) <> '')
    AND (location_text IS NULL OR btrim(location_text) <> '')
    AND (responsible_text IS NULL OR btrim(responsible_text) <> '')
    AND (external_party IS NULL OR btrim(external_party) <> '')
    AND (comment IS NULL OR btrim(comment) <> '')
    AND (source IS NULL OR btrim(source) <> '')
    AND (external_import_id IS NULL OR btrim(external_import_id) <> '')
  ),
  CONSTRAINT ck_project_restarbejde_item_kind_status CHECK (
    (kind = 'internal_defect' AND status IN ('open', 'in_progress', 'ready_for_review', 'closed'))
    OR (kind = 'obs' AND status IN ('open', 'monitoring', 'blocking', 'resolved'))
  ),
  CONSTRAINT ck_project_restarbejde_item_priority_risk CHECK (
    (kind = 'internal_defect' AND priority IN ('low', 'normal', 'high', 'critical') AND risk IS NULL)
    OR (kind = 'obs' AND risk IN ('low', 'medium', 'high', 'critical') AND priority IS NULL)
  ),
  CONSTRAINT ck_project_restarbejde_item_percent CHECK (
    (kind = 'internal_defect' AND percent_complete IS NOT NULL AND percent_complete >= 0 AND percent_complete <= 100)
    OR (kind = 'obs' AND percent_complete IS NULL)
  ),
  CONSTRAINT ck_project_restarbejde_item_closed_state CHECK (
    (kind = 'internal_defect' AND status = 'closed' AND percent_complete = 100 AND closed_at IS NOT NULL AND closed_by_user_id IS NOT NULL)
    OR ((kind <> 'internal_defect' OR status <> 'closed') AND closed_at IS NULL AND closed_by_user_id IS NULL)
  ),
  CONSTRAINT ck_project_restarbejde_item_obs_resolved_percent CHECK (
    kind <> 'obs' OR status <> 'resolved' OR percent_complete IS NULL
  ),
  CONSTRAINT ck_project_restarbejde_item_archive_state CHECK (
    (archived_at IS NULL AND archived_by_user_id IS NULL)
    OR (archived_at IS NOT NULL AND archived_by_user_id IS NOT NULL AND archived_at >= created_at)
  ),
  CONSTRAINT ck_project_restarbejde_item_import_payload_is_object CHECK (jsonb_typeof(external_import_payload) = 'object')
);

CREATE INDEX ix_project_restarbejde_item_project_active
  ON project_restarbejde_item (tenant_id, project_id, kind, status, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX ix_project_restarbejde_item_project_archived
  ON project_restarbejde_item (tenant_id, project_id, archived_at DESC)
  WHERE archived_at IS NOT NULL;

CREATE INDEX ix_project_restarbejde_item_assigned_active
  ON project_restarbejde_item (tenant_id, assigned_tenant_user_id, updated_at DESC)
  WHERE archived_at IS NULL AND assigned_tenant_user_id IS NOT NULL;

CREATE UNIQUE INDEX uq_project_restarbejde_item_import_id
  ON project_restarbejde_item (tenant_id, source, external_import_id)
  WHERE external_import_id IS NOT NULL;

CREATE TRIGGER trg_project_restarbejde_item_set_updated_at
BEFORE UPDATE ON project_restarbejde_item
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_project_restarbejde_item_prevent_immutable_update
BEFORE UPDATE ON project_restarbejde_item
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'project_id', 'kind', 'created_by_user_id', 'created_at');

COMMIT;