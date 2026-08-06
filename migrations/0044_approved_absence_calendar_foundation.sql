BEGIN;

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
      'absence_request.cancelled',
      'absence_request.approved',
      'absence_request.rejected',
      'absence_request.change_proposed',
      'approved_absence.created',
      'absence_special_window.created',
      'absence_special_window.updated',
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
      'storage_object_deleted'
  )
);

CREATE TABLE approved_absence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  employee_tenant_user_id uuid NOT NULL,
  employee_fitter_id text NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  absence_request_id uuid NULL,
  absence_type_id uuid NOT NULL,
  duration_type text NOT NULL,
  start_date date NOT NULL,
  end_date date NULL,
  start_time time without time zone NULL,
  end_time time without time zone NULL,
  timezone text NOT NULL DEFAULT 'Europe/Copenhagen',
  status text NOT NULL DEFAULT 'active',
  visibility_policy text NOT NULL,
  approved_by_tenant_user_id uuid NOT NULL,
  approved_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT fk_approved_absence_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_approved_absence_employee_user FOREIGN KEY (employee_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_approved_absence_employee_fitter FOREIGN KEY (tenant_id, employee_fitter_id) REFERENCES fitter(tenant_id, fitter_id) ON DELETE SET NULL (employee_fitter_id),
  CONSTRAINT fk_approved_absence_request FOREIGN KEY (absence_request_id, tenant_id) REFERENCES absence_request(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_approved_absence_type FOREIGN KEY (absence_type_id, tenant_id) REFERENCES absence_type(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_approved_absence_approved_by_user FOREIGN KEY (approved_by_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT uq_approved_absence_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT uq_approved_absence_source UNIQUE (tenant_id, source_type, source_id),
  CONSTRAINT ck_approved_absence_source_type CHECK (source_type IN ('absence_request', 'direct_registration', 'legacy_resource_absence', 'administrative')),
  CONSTRAINT ck_approved_absence_source_shape CHECK (
    (source_type = 'absence_request' AND absence_request_id IS NOT NULL AND source_id = absence_request_id)
    OR (source_type <> 'absence_request' AND source_id IS NOT NULL)
  ),
  CONSTRAINT ck_approved_absence_duration_type CHECK (duration_type IN ('full_days', 'time_range')),
  CONSTRAINT ck_approved_absence_status CHECK (status IN ('active', 'cancelled', 'superseded')),
  CONSTRAINT ck_approved_absence_visibility_policy CHECK (visibility_policy IN ('private', 'manager_visible', 'neutral_shared')),
  CONSTRAINT ck_approved_absence_timezone_not_blank CHECK (btrim(timezone) <> ''),
  CONSTRAINT ck_approved_absence_version CHECK (version >= 1),
  CONSTRAINT ck_approved_absence_full_days_shape CHECK (
    duration_type <> 'full_days'
    OR (
      end_date IS NOT NULL
      AND end_date >= start_date
      AND start_time IS NULL
      AND end_time IS NULL
    )
  ),
  CONSTRAINT ck_approved_absence_time_range_shape CHECK (
    duration_type <> 'time_range'
    OR (
      end_date IS NULL
      AND start_time IS NOT NULL
      AND end_time IS NOT NULL
      AND end_time > start_time
    )
  )
);

CREATE UNIQUE INDEX uq_approved_absence_active_request
  ON approved_absence (tenant_id, absence_request_id)
  WHERE source_type = 'absence_request' AND status = 'active';

CREATE INDEX ix_approved_absence_employee_active_range
  ON approved_absence (tenant_id, employee_tenant_user_id, status, start_date, end_date);

CREATE INDEX ix_approved_absence_tenant_active_range
  ON approved_absence (tenant_id, status, start_date, end_date);

CREATE INDEX ix_approved_absence_tenant_type_status
  ON approved_absence (tenant_id, absence_type_id, status);

DROP TRIGGER IF EXISTS trg_approved_absence_set_updated_at ON approved_absence;
CREATE TRIGGER trg_approved_absence_set_updated_at
BEFORE UPDATE ON approved_absence
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_approved_absence_prevent_immutable_update ON approved_absence;
CREATE TRIGGER trg_approved_absence_prevent_immutable_update
BEFORE UPDATE ON approved_absence
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update(
  'id',
  'tenant_id',
  'employee_tenant_user_id',
  'employee_fitter_id',
  'source_type',
  'source_id',
  'absence_request_id',
  'absence_type_id',
  'duration_type',
  'start_date',
  'end_date',
  'start_time',
  'end_time',
  'timezone',
  'visibility_policy',
  'approved_by_tenant_user_id',
  'approved_at',
  'created_at'
);

INSERT INTO approved_absence (
  tenant_id,
  employee_tenant_user_id,
  employee_fitter_id,
  source_type,
  source_id,
  absence_request_id,
  absence_type_id,
  duration_type,
  start_date,
  end_date,
  start_time,
  end_time,
  timezone,
  status,
  visibility_policy,
  approved_by_tenant_user_id,
  approved_at,
  created_at,
  updated_at
)
SELECT
  ar.tenant_id,
  ar.employee_tenant_user_id,
  ar.employee_fitter_id,
  'absence_request',
  ar.id,
  ar.id,
  ar.absence_type_id,
  ar.duration_type,
  ar.start_date,
  ar.end_date,
  ar.start_time,
  ar.end_time,
  ar.timezone,
  'active',
  at.visibility_policy,
  ar.assigned_manager_tenant_user_id,
  COALESCE(ar.reviewed_at, ar.updated_at, now()),
  now(),
  now()
FROM absence_request ar
JOIN absence_type at
  ON at.tenant_id = ar.tenant_id
 AND at.id = ar.absence_type_id
JOIN tenant_user employee
  ON employee.tenant_id = ar.tenant_id
 AND employee.id = ar.employee_tenant_user_id
JOIN tenant_user manager
  ON manager.tenant_id = ar.tenant_id
 AND manager.id = ar.assigned_manager_tenant_user_id
LEFT JOIN approved_absence existing
  ON existing.tenant_id = ar.tenant_id
 AND existing.source_type = 'absence_request'
 AND existing.source_id = ar.id
WHERE ar.status = 'approved'
  AND existing.id IS NULL
  AND ar.assigned_manager_tenant_user_id IS NOT NULL
  AND ar.duration_type IN ('full_days', 'time_range')
  AND (
    (ar.duration_type = 'full_days' AND ar.end_date IS NOT NULL AND ar.end_date >= ar.start_date AND ar.start_time IS NULL AND ar.end_time IS NULL)
    OR (ar.duration_type = 'time_range' AND ar.end_date IS NULL AND ar.start_time IS NOT NULL AND ar.end_time IS NOT NULL AND ar.end_time > ar.start_time)
  )
ON CONFLICT DO NOTHING;

COMMIT;
