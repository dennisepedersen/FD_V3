ALTER TABLE audit_event
  DROP CONSTRAINT IF EXISTS audit_event_event_type_check,
  DROP CONSTRAINT IF EXISTS ck_audit_event_event_type,
  ADD CONSTRAINT ck_audit_event_event_type
  CHECK (
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
      'tenant_user_identity_linked',
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
      'restarbejde.drawing_created',
      'restarbejde.drawing_archived',
      'restarbejde.drawing_restored',
      'restarbejde.placement_created',
      'restarbejde.placement_updated',
      'restarbejde.placement_archived',
      'restarbejde.placement_restored',
      'restarbejde.attachment_created',
      'restarbejde.attachment_archived',
      'absence_type.created',
      'absence_type.updated',
      'absence_type.archived',
      'absence_request.created',
      'absence_request.updated',
      'absence_request.submitted',
      'absence_request.late_submitted',
      'absence_request.cancelled',
      'absence_request.approved',
      'absence_request.rejected',
      'absence_request.change_proposed',
      'approved_absence.created',
      'absence_special_window.created',
      'absence_special_window.updated',
      'absence_special_window.scope_changed',
      'absence_special_window.archived',
      'employee_manager_relation.created',
      'employee_manager_relation.updated',
      'employee_manager_relation.ended',
      'internal_notification.created',
      'email_outbox.queued',
      'email_outbox.sent',
      'email_outbox.retry_scheduled',
      'email_outbox.dead_lettered',
      'storage_object_uploaded',
      'storage_object_downloaded',
      'storage_object_deleted',
      'igva.manager_completion_changed',
      'igva.summary_refreshed',
      'igva.summary_refresh_failed'
    )
  );

CREATE TABLE IF NOT EXISTS igva_project_manager_completion (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  completion_percent numeric(5,2) NOT NULL,
  comment text NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_igva_project_manager_completion PRIMARY KEY (tenant_id, project_id),
  CONSTRAINT fk_igva_project_manager_completion_project
    FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_igva_project_manager_completion_changed_by
    FOREIGN KEY (changed_by, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT ck_igva_project_manager_completion_percent CHECK (completion_percent >= 0 AND completion_percent <= 100),
  CONSTRAINT ck_igva_project_manager_completion_comment CHECK (comment IS NULL OR char_length(comment) <= 1000)
);

CREATE INDEX IF NOT EXISTS ix_igva_project_manager_completion_changed
  ON igva_project_manager_completion (tenant_id, changed_at DESC);

DROP TRIGGER IF EXISTS trg_igva_project_manager_completion_set_updated_at ON igva_project_manager_completion;
CREATE TRIGGER trg_igva_project_manager_completion_set_updated_at
BEFORE UPDATE ON igva_project_manager_completion
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS igva_project_manager_completion_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  previous_completion_percent numeric(5,2) NULL,
  completion_percent numeric(5,2) NOT NULL,
  comment text NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT fk_igva_project_manager_completion_event_project
    FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_igva_project_manager_completion_event_changed_by
    FOREIGN KEY (changed_by, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT ck_igva_project_manager_completion_event_percent CHECK (completion_percent >= 0 AND completion_percent <= 100),
  CONSTRAINT ck_igva_project_manager_completion_event_previous_percent CHECK (previous_completion_percent IS NULL OR (previous_completion_percent >= 0 AND previous_completion_percent <= 100)),
  CONSTRAINT ck_igva_project_manager_completion_event_comment CHECK (comment IS NULL OR char_length(comment) <= 1000),
  CONSTRAINT ck_igva_project_manager_completion_event_metadata CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS ix_igva_project_manager_completion_event_project
  ON igva_project_manager_completion_event (tenant_id, project_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS ix_igva_project_manager_completion_event_actor
  ON igva_project_manager_completion_event (tenant_id, changed_by, changed_at DESC);

DROP TRIGGER IF EXISTS trg_igva_project_manager_completion_event_prevent_update ON igva_project_manager_completion_event;
CREATE TRIGGER trg_igva_project_manager_completion_event_prevent_update
BEFORE UPDATE ON igva_project_manager_completion_event
FOR EACH ROW
EXECUTE FUNCTION prevent_update_delete_append_only();

DROP TRIGGER IF EXISTS trg_igva_project_manager_completion_event_prevent_delete ON igva_project_manager_completion_event;
CREATE TRIGGER trg_igva_project_manager_completion_event_prevent_delete
BEFORE DELETE ON igva_project_manager_completion_event
FOR EACH ROW
EXECUTE FUNCTION prevent_update_delete_append_only();

CREATE TABLE IF NOT EXISTS igva_project_summary (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  source_synced_at timestamptz NULL,
  freshness_policy_key text NOT NULL DEFAULT 'sync_worker_cadence',
  budget_completion_percent numeric(7,4) NULL,
  expected_completion_percent numeric(7,4) NULL,
  manager_completion_percent numeric(5,2) NULL,
  labor_completion_percent numeric(7,4) NULL,
  material_completion_percent numeric(7,4) NULL,
  revenue_actual numeric(14,2) NULL,
  revenue_expected numeric(14,2) NULL,
  cost_actual numeric(14,2) NULL,
  cost_expected numeric(14,2) NULL,
  contribution_margin_expected numeric(14,2) NULL,
  coverage_expected numeric(7,4) NULL,
  quality_status text NULL,
  economy_status text NOT NULL DEFAULT 'not_calculated',
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_igva_project_summary PRIMARY KEY (tenant_id, project_id),
  CONSTRAINT fk_igva_project_summary_project
    FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT ck_igva_project_summary_economy_status CHECK (economy_status IN ('not_calculated', 'calculated', 'partial', 'failed')),
  CONSTRAINT ck_igva_project_summary_budget_completion CHECK (budget_completion_percent IS NULL OR (budget_completion_percent >= 0 AND budget_completion_percent <= 100)),
  CONSTRAINT ck_igva_project_summary_expected_completion CHECK (expected_completion_percent IS NULL OR (expected_completion_percent >= 0 AND expected_completion_percent <= 100)),
  CONSTRAINT ck_igva_project_summary_manager_completion CHECK (manager_completion_percent IS NULL OR (manager_completion_percent >= 0 AND manager_completion_percent <= 100)),
  CONSTRAINT ck_igva_project_summary_labor_completion CHECK (labor_completion_percent IS NULL OR (labor_completion_percent >= 0 AND labor_completion_percent <= 100)),
  CONSTRAINT ck_igva_project_summary_material_completion CHECK (material_completion_percent IS NULL OR (material_completion_percent >= 0 AND material_completion_percent <= 100)),
  CONSTRAINT ck_igva_project_summary_summary_json CHECK (jsonb_typeof(summary_json) = 'object'),
  CONSTRAINT ck_igva_project_summary_source_metadata CHECK (jsonb_typeof(source_metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS ix_igva_project_summary_tenant_calculated
  ON igva_project_summary (tenant_id, calculated_at DESC);

CREATE INDEX IF NOT EXISTS ix_igva_project_summary_tenant_synced
  ON igva_project_summary (tenant_id, source_synced_at DESC);

CREATE INDEX IF NOT EXISTS ix_igva_project_summary_status
  ON igva_project_summary (tenant_id, economy_status, calculated_at DESC);

DROP TRIGGER IF EXISTS trg_igva_project_summary_set_updated_at ON igva_project_summary;
CREATE TRIGGER trg_igva_project_summary_set_updated_at
BEFORE UPDATE ON igva_project_summary
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
