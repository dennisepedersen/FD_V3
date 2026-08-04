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
      'absence_special_window.created',
      'absence_special_window.updated',
      'absence_special_window.archived',
      'employee_manager_relation.created',
      'employee_manager_relation.updated',
      'employee_manager_relation.ended',
      'storage_object_uploaded',
      'storage_object_downloaded',
      'storage_object_deleted'
  )
);

CREATE TABLE absence_type (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  key text NOT NULL,
  name text NOT NULL,
  description text NULL,
  workflow_mode text NOT NULL DEFAULT 'request',
  comment_policy text NOT NULL DEFAULT 'optional',
  visibility_policy text NOT NULL DEFAULT 'private',
  allowed_duration_types text[] NOT NULL DEFAULT ARRAY['full_days', 'time_range']::text[],
  special_window_eligible boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_by_tenant_user_id uuid NULL,
  updated_by_tenant_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_absence_type_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_absence_type_created_by_user FOREIGN KEY (created_by_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (created_by_tenant_user_id),
  CONSTRAINT fk_absence_type_updated_by_user FOREIGN KEY (updated_by_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (updated_by_tenant_user_id),
  CONSTRAINT uq_absence_type_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT ck_absence_type_key_not_blank CHECK (btrim(key) <> ''),
  CONSTRAINT ck_absence_type_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_absence_type_description_not_blank CHECK (description IS NULL OR btrim(description) <> ''),
  CONSTRAINT ck_absence_type_workflow_mode CHECK (workflow_mode IN ('request', 'notification', 'direct_registration', 'administrative')),
  CONSTRAINT ck_absence_type_comment_policy CHECK (comment_policy IN ('optional', 'required', 'disabled')),
  CONSTRAINT ck_absence_type_visibility_policy CHECK (visibility_policy IN ('private', 'manager_visible', 'neutral_shared')),
  CONSTRAINT ck_absence_type_allowed_duration_types CHECK (
    cardinality(allowed_duration_types) > 0
    AND allowed_duration_types <@ ARRAY['full_days', 'partial_day', 'time_range']::text[]
  ),
  CONSTRAINT ck_absence_type_sort_order CHECK (sort_order >= 0)
);

CREATE UNIQUE INDEX uq_absence_type_tenant_key_ci
  ON absence_type (tenant_id, lower(key));

CREATE INDEX ix_absence_type_tenant_active_sort
  ON absence_type (tenant_id, is_active, sort_order, name);

CREATE INDEX ix_absence_type_tenant_special_window
  ON absence_type (tenant_id, special_window_eligible, is_active);

CREATE TABLE absence_special_window (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  key text NOT NULL,
  name text NOT NULL,
  description text NULL,
  absence_start_date date NOT NULL,
  absence_end_date date NOT NULL,
  submission_open_date date NOT NULL,
  submission_deadline date NOT NULL,
  review_start_date date NOT NULL,
  collective_processing boolean NOT NULL DEFAULT true,
  approval_blocked_before_review boolean NOT NULL DEFAULT true,
  late_submission_policy text NOT NULL DEFAULT 'blocked',
  receipt_text text NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by_tenant_user_id uuid NULL,
  updated_by_tenant_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_absence_special_window_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_absence_special_window_created_by_user FOREIGN KEY (created_by_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (created_by_tenant_user_id),
  CONSTRAINT fk_absence_special_window_updated_by_user FOREIGN KEY (updated_by_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (updated_by_tenant_user_id),
  CONSTRAINT uq_absence_special_window_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT ck_absence_special_window_key_not_blank CHECK (btrim(key) <> ''),
  CONSTRAINT ck_absence_special_window_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_absence_special_window_description_not_blank CHECK (description IS NULL OR btrim(description) <> ''),
  CONSTRAINT ck_absence_special_window_receipt_text CHECK (receipt_text IS NULL OR (btrim(receipt_text) <> '' AND char_length(receipt_text) <= 2000)),
  CONSTRAINT ck_absence_special_window_late_policy CHECK (late_submission_policy IN ('blocked', 'manual_review', 'allowed')),
  CONSTRAINT ck_absence_special_window_absence_range CHECK (absence_end_date >= absence_start_date),
  CONSTRAINT ck_absence_special_window_submission_range CHECK (submission_deadline >= submission_open_date),
  CONSTRAINT ck_absence_special_window_review_after_deadline CHECK (review_start_date >= submission_deadline)
);

CREATE UNIQUE INDEX uq_absence_special_window_tenant_key_ci
  ON absence_special_window (tenant_id, lower(key));

CREATE INDEX ix_absence_special_window_tenant_active_period
  ON absence_special_window (tenant_id, is_active, absence_start_date, absence_end_date);

CREATE INDEX ix_absence_special_window_tenant_review_ready
  ON absence_special_window (tenant_id, is_active, review_start_date, submission_deadline);

CREATE TABLE absence_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  employee_tenant_user_id uuid NOT NULL,
  employee_fitter_id text NULL,
  absence_type_id uuid NOT NULL,
  duration_type text NOT NULL,
  day_part text NULL,
  start_date date NOT NULL,
  end_date date NULL,
  start_time time without time zone NULL,
  end_time time without time zone NULL,
  timezone text NOT NULL DEFAULT 'Europe/Copenhagen',
  employee_comment text NULL,
  status text NOT NULL DEFAULT 'draft',
  assigned_manager_tenant_user_id uuid NULL,
  special_window_id uuid NULL,
  submitted_at timestamptz NULL,
  reviewed_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_absence_request_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_absence_request_employee_user FOREIGN KEY (employee_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_absence_request_employee_fitter FOREIGN KEY (tenant_id, employee_fitter_id) REFERENCES fitter(tenant_id, fitter_id) ON DELETE SET NULL (employee_fitter_id),
  CONSTRAINT fk_absence_request_type FOREIGN KEY (absence_type_id, tenant_id) REFERENCES absence_type(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_absence_request_manager_user FOREIGN KEY (assigned_manager_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (assigned_manager_tenant_user_id),
  CONSTRAINT fk_absence_request_special_window FOREIGN KEY (special_window_id, tenant_id) REFERENCES absence_special_window(id, tenant_id) ON DELETE SET NULL (special_window_id),
  CONSTRAINT uq_absence_request_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT ck_absence_request_duration_type CHECK (duration_type IN ('full_days', 'partial_day', 'time_range')),
  CONSTRAINT ck_absence_request_day_part CHECK (day_part IS NULL OR day_part IN ('morning', 'afternoon')),
  CONSTRAINT ck_absence_request_status CHECK (status IN ('draft', 'submitted', 'ready_for_review', 'under_review', 'approved', 'rejected', 'change_proposed', 'cancelled')),
  CONSTRAINT ck_absence_request_timezone_not_blank CHECK (btrim(timezone) <> ''),
  CONSTRAINT ck_absence_request_employee_comment CHECK (employee_comment IS NULL OR (btrim(employee_comment) <> '' AND char_length(employee_comment) <= 250)),
  CONSTRAINT ck_absence_request_version CHECK (version >= 1),
  CONSTRAINT ck_absence_request_full_days_shape CHECK (
    duration_type <> 'full_days'
    OR (
      end_date IS NOT NULL
      AND end_date >= start_date
      AND start_time IS NULL
      AND end_time IS NULL
      AND day_part IS NULL
    )
  ),
  CONSTRAINT ck_absence_request_time_range_shape CHECK (
    duration_type <> 'time_range'
    OR (
      (end_date IS NULL OR end_date = start_date)
      AND start_time IS NOT NULL
      AND end_time IS NOT NULL
      AND end_time > start_time
      AND day_part IS NULL
    )
  ),
  CONSTRAINT ck_absence_request_partial_day_shape CHECK (
    duration_type <> 'partial_day'
    OR (
      (end_date IS NULL OR end_date = start_date)
      AND start_time IS NULL
      AND end_time IS NULL
      AND day_part IN ('morning', 'afternoon')
    )
  )
);

CREATE INDEX ix_absence_request_employee_created
  ON absence_request (tenant_id, employee_tenant_user_id, created_at DESC);

CREATE INDEX ix_absence_request_manager_status
  ON absence_request (tenant_id, assigned_manager_tenant_user_id, status, submitted_at DESC)
  WHERE assigned_manager_tenant_user_id IS NOT NULL;

CREATE INDEX ix_absence_request_tenant_status_dates
  ON absence_request (tenant_id, status, start_date, end_date);

CREATE INDEX ix_absence_request_tenant_type
  ON absence_request (tenant_id, absence_type_id, status);

CREATE INDEX ix_absence_request_tenant_special_window
  ON absence_request (tenant_id, special_window_id, status)
  WHERE special_window_id IS NOT NULL;

CREATE TABLE absence_request_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  absence_request_id uuid NOT NULL,
  event_type text NOT NULL,
  actor_tenant_user_id uuid NULL,
  old_status text NULL,
  new_status text NULL,
  reason text NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_absence_request_event_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_absence_request_event_request FOREIGN KEY (absence_request_id, tenant_id) REFERENCES absence_request(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_absence_request_event_actor_user FOREIGN KEY (actor_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (actor_tenant_user_id),
  CONSTRAINT ck_absence_request_event_type CHECK (event_type IN ('created', 'draft_updated', 'submitted', 'assigned', 'marked_ready_for_review', 'review_started', 'approved', 'rejected', 'change_proposed', 'cancelled', 'administrative_override')),
  CONSTRAINT ck_absence_request_event_old_status CHECK (old_status IS NULL OR old_status IN ('draft', 'submitted', 'ready_for_review', 'under_review', 'approved', 'rejected', 'change_proposed', 'cancelled')),
  CONSTRAINT ck_absence_request_event_new_status CHECK (new_status IS NULL OR new_status IN ('draft', 'submitted', 'ready_for_review', 'under_review', 'approved', 'rejected', 'change_proposed', 'cancelled')),
  CONSTRAINT ck_absence_request_event_reason_not_blank CHECK (reason IS NULL OR btrim(reason) <> ''),
  CONSTRAINT ck_absence_request_event_metadata_object CHECK (jsonb_typeof(metadata_json) = 'object')
);

CREATE INDEX ix_absence_request_event_request_created
  ON absence_request_event (tenant_id, absence_request_id, created_at ASC);

CREATE INDEX ix_absence_request_event_type_created
  ON absence_request_event (tenant_id, event_type, created_at DESC);

CREATE TABLE absence_special_window_scope (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  special_window_id uuid NOT NULL,
  scope_type text NOT NULL,
  resource_group_id uuid NULL,
  scope_tenant_user_id uuid NULL,
  absence_type_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_absence_special_window_scope_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_absence_special_window_scope_window FOREIGN KEY (special_window_id, tenant_id) REFERENCES absence_special_window(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_absence_special_window_scope_resource_group FOREIGN KEY (resource_group_id, tenant_id) REFERENCES resource_groups(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_absence_special_window_scope_user FOREIGN KEY (scope_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_absence_special_window_scope_absence_type FOREIGN KEY (absence_type_id, tenant_id) REFERENCES absence_type(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT ck_absence_special_window_scope_type CHECK (scope_type IN ('tenant', 'resource_group', 'tenant_user')),
  CONSTRAINT ck_absence_special_window_scope_shape CHECK (
    (scope_type = 'tenant' AND resource_group_id IS NULL AND scope_tenant_user_id IS NULL)
    OR (scope_type = 'resource_group' AND resource_group_id IS NOT NULL AND scope_tenant_user_id IS NULL)
    OR (scope_type = 'tenant_user' AND resource_group_id IS NULL AND scope_tenant_user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_absence_special_window_scope_tenant
  ON absence_special_window_scope (tenant_id, special_window_id, COALESCE(absence_type_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE scope_type = 'tenant';

CREATE UNIQUE INDEX uq_absence_special_window_scope_group
  ON absence_special_window_scope (tenant_id, special_window_id, resource_group_id, COALESCE(absence_type_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE scope_type = 'resource_group';

CREATE UNIQUE INDEX uq_absence_special_window_scope_user
  ON absence_special_window_scope (tenant_id, special_window_id, scope_tenant_user_id, COALESCE(absence_type_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE scope_type = 'tenant_user';

CREATE INDEX ix_absence_special_window_scope_window
  ON absence_special_window_scope (tenant_id, special_window_id);

CREATE INDEX ix_absence_special_window_scope_resource_group
  ON absence_special_window_scope (tenant_id, resource_group_id)
  WHERE resource_group_id IS NOT NULL;

CREATE INDEX ix_absence_special_window_scope_user
  ON absence_special_window_scope (tenant_id, scope_tenant_user_id)
  WHERE scope_tenant_user_id IS NOT NULL;

CREATE TABLE employee_manager_relation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  employee_tenant_user_id uuid NOT NULL,
  manager_tenant_user_id uuid NOT NULL,
  relation_type text NOT NULL DEFAULT 'primary',
  valid_from date NOT NULL DEFAULT CURRENT_DATE,
  valid_to date NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by_tenant_user_id uuid NULL,
  updated_by_tenant_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_employee_manager_relation_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_employee_manager_relation_employee FOREIGN KEY (employee_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_employee_manager_relation_manager FOREIGN KEY (manager_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_employee_manager_relation_created_by_user FOREIGN KEY (created_by_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (created_by_tenant_user_id),
  CONSTRAINT fk_employee_manager_relation_updated_by_user FOREIGN KEY (updated_by_tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL (updated_by_tenant_user_id),
  CONSTRAINT uq_employee_manager_relation_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT ck_employee_manager_relation_type CHECK (relation_type IN ('primary', 'secondary', 'delegate')),
  CONSTRAINT ck_employee_manager_relation_not_self CHECK (employee_tenant_user_id <> manager_tenant_user_id),
  CONSTRAINT ck_employee_manager_relation_valid_range CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE UNIQUE INDEX uq_employee_manager_relation_open_primary
  ON employee_manager_relation (tenant_id, employee_tenant_user_id)
  WHERE is_active = true AND relation_type = 'primary' AND valid_to IS NULL;

CREATE INDEX ix_employee_manager_relation_employee_active
  ON employee_manager_relation (tenant_id, employee_tenant_user_id, is_active, relation_type, valid_from, valid_to);

CREATE INDEX ix_employee_manager_relation_manager_active
  ON employee_manager_relation (tenant_id, manager_tenant_user_id, is_active, relation_type, valid_from, valid_to);

DROP TRIGGER IF EXISTS trg_absence_type_set_updated_at ON absence_type;
CREATE TRIGGER trg_absence_type_set_updated_at
BEFORE UPDATE ON absence_type
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_absence_type_prevent_immutable_update ON absence_type;
CREATE TRIGGER trg_absence_type_prevent_immutable_update
BEFORE UPDATE ON absence_type
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'key', 'created_by_tenant_user_id', 'created_at');

DROP TRIGGER IF EXISTS trg_absence_special_window_set_updated_at ON absence_special_window;
CREATE TRIGGER trg_absence_special_window_set_updated_at
BEFORE UPDATE ON absence_special_window
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_absence_special_window_prevent_immutable_update ON absence_special_window;
CREATE TRIGGER trg_absence_special_window_prevent_immutable_update
BEFORE UPDATE ON absence_special_window
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'key', 'created_by_tenant_user_id', 'created_at');

DROP TRIGGER IF EXISTS trg_absence_request_set_updated_at ON absence_request;
CREATE TRIGGER trg_absence_request_set_updated_at
BEFORE UPDATE ON absence_request
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_absence_request_prevent_immutable_update ON absence_request;
CREATE TRIGGER trg_absence_request_prevent_immutable_update
BEFORE UPDATE ON absence_request
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'employee_tenant_user_id', 'created_at');

DROP TRIGGER IF EXISTS trg_absence_request_event_prevent_update ON absence_request_event;
CREATE TRIGGER trg_absence_request_event_prevent_update
BEFORE UPDATE ON absence_request_event
FOR EACH ROW
EXECUTE FUNCTION prevent_update_delete_append_only();

DROP TRIGGER IF EXISTS trg_absence_request_event_prevent_delete ON absence_request_event;
CREATE TRIGGER trg_absence_request_event_prevent_delete
BEFORE DELETE ON absence_request_event
FOR EACH ROW
EXECUTE FUNCTION prevent_update_delete_append_only();

DROP TRIGGER IF EXISTS trg_employee_manager_relation_set_updated_at ON employee_manager_relation;
CREATE TRIGGER trg_employee_manager_relation_set_updated_at
BEFORE UPDATE ON employee_manager_relation
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_employee_manager_relation_prevent_immutable_update ON employee_manager_relation;
CREATE TRIGGER trg_employee_manager_relation_prevent_immutable_update
BEFORE UPDATE ON employee_manager_relation
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'employee_tenant_user_id', 'manager_tenant_user_id', 'created_by_tenant_user_id', 'created_at');

COMMIT;
