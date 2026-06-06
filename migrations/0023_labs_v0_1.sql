BEGIN;

CREATE TABLE IF NOT EXISTS labs_idea (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  module_key text NOT NULL,
  problem text NOT NULL,
  desired_function text NOT NULL,
  priority text NOT NULL DEFAULT 'normal',
  description text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  source text NULL,
  tags_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by_global_actor_id uuid NOT NULL,
  updated_by_global_actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_for_spec_at timestamptz NULL,
  approved_for_spec_by uuid NULL,
  rejected_at timestamptz NULL,
  rejected_by uuid NULL,
  rejected_reason text NULL,
  reopened_at timestamptz NULL,
  reopened_by uuid NULL,
  reopened_reason text NULL,
  parked_at timestamptz NULL,
  parked_by uuid NULL,
  parked_reason text NULL,
  CONSTRAINT fk_labs_idea_created_by_global_admin FOREIGN KEY (created_by_global_actor_id) REFERENCES global_admin_user(id) ON DELETE RESTRICT,
  CONSTRAINT fk_labs_idea_updated_by_global_admin FOREIGN KEY (updated_by_global_actor_id) REFERENCES global_admin_user(id) ON DELETE RESTRICT,
  CONSTRAINT fk_labs_idea_approved_by_global_admin FOREIGN KEY (approved_for_spec_by) REFERENCES global_admin_user(id) ON DELETE SET NULL,
  CONSTRAINT fk_labs_idea_rejected_by_global_admin FOREIGN KEY (rejected_by) REFERENCES global_admin_user(id) ON DELETE SET NULL,
  CONSTRAINT fk_labs_idea_reopened_by_global_admin FOREIGN KEY (reopened_by) REFERENCES global_admin_user(id) ON DELETE SET NULL,
  CONSTRAINT fk_labs_idea_parked_by_global_admin FOREIGN KEY (parked_by) REFERENCES global_admin_user(id) ON DELETE SET NULL,
  CONSTRAINT ck_labs_idea_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT ck_labs_idea_module_key_not_blank CHECK (btrim(module_key) <> ''),
  CONSTRAINT ck_labs_idea_problem_not_blank CHECK (btrim(problem) <> ''),
  CONSTRAINT ck_labs_idea_desired_function_not_blank CHECK (btrim(desired_function) <> ''),
  CONSTRAINT ck_labs_idea_description_not_blank CHECK (btrim(description) <> ''),
  CONSTRAINT ck_labs_idea_priority CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  CONSTRAINT ck_labs_idea_status CHECK (status IN ('draft', 'ready_for_analysis', 'analyzing', 'analysis_failed', 'analyzed', 'parked', 'rejected', 'approved_for_spec')),
  CONSTRAINT ck_labs_idea_tags_is_array CHECK (jsonb_typeof(tags_json) = 'array')
);

CREATE INDEX IF NOT EXISTS ix_labs_idea_status_updated ON labs_idea (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS ix_labs_idea_module_updated ON labs_idea (module_key, updated_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_labs_idea_set_updated_at'
  ) THEN
    CREATE TRIGGER trg_labs_idea_set_updated_at
    BEFORE UPDATE ON labs_idea
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_labs_idea_prevent_immutable_update'
  ) THEN
    CREATE TRIGGER trg_labs_idea_prevent_immutable_update
    BEFORE UPDATE ON labs_idea
    FOR EACH ROW
    EXECUTE FUNCTION prevent_immutable_update('id', 'created_by_global_actor_id', 'created_at');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS labs_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id uuid NOT NULL,
  analysis_version integer NOT NULL,
  status text NOT NULL,
  schema_version text NOT NULL,
  analysis_json jsonb NOT NULL,
  summary text NOT NULL,
  recommendation text NOT NULL,
  score integer NOT NULL,
  subscores_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  open_questions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  critical_open_questions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  noncritical_open_questions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  conflicts_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  docs_read_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_level text NOT NULL DEFAULT 'observed',
  analysis_freshness text NOT NULL DEFAULT 'current',
  model_provider text NULL,
  model_name text NULL,
  prompt_version text NOT NULL,
  input_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  attachment_metadata_snapshot_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by_global_actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  failed_at timestamptz NULL,
  failure_code text NULL,
  failure_summary text NULL,
  CONSTRAINT fk_labs_analysis_idea FOREIGN KEY (idea_id) REFERENCES labs_idea(id) ON DELETE CASCADE,
  CONSTRAINT fk_labs_analysis_created_by_global_admin FOREIGN KEY (created_by_global_actor_id) REFERENCES global_admin_user(id) ON DELETE RESTRICT,
  CONSTRAINT uq_labs_analysis_idea_version UNIQUE (idea_id, analysis_version),
  CONSTRAINT ck_labs_analysis_status CHECK (status IN ('completed', 'failed')),
  CONSTRAINT ck_labs_analysis_schema_version_not_blank CHECK (btrim(schema_version) <> ''),
  CONSTRAINT ck_labs_analysis_summary_not_blank CHECK (btrim(summary) <> ''),
  CONSTRAINT ck_labs_analysis_recommendation CHECK (recommendation IN ('reject', 'park', 'needs_clarification', 'ready_for_spec')),
  CONSTRAINT ck_labs_analysis_score CHECK (score >= 0 AND score <= 100),
  CONSTRAINT ck_labs_analysis_evidence_level CHECK (evidence_level IN ('verified', 'observed', 'hypothesis', 'unclear')),
  CONSTRAINT ck_labs_analysis_freshness CHECK (analysis_freshness IN ('current', 'stale')),
  CONSTRAINT ck_labs_analysis_json_is_object CHECK (jsonb_typeof(analysis_json) = 'object'),
  CONSTRAINT ck_labs_analysis_subscores_is_object CHECK (jsonb_typeof(subscores_json) = 'object'),
  CONSTRAINT ck_labs_analysis_open_questions_is_array CHECK (jsonb_typeof(open_questions_json) = 'array'),
  CONSTRAINT ck_labs_analysis_critical_questions_is_array CHECK (jsonb_typeof(critical_open_questions_json) = 'array'),
  CONSTRAINT ck_labs_analysis_noncritical_questions_is_array CHECK (jsonb_typeof(noncritical_open_questions_json) = 'array'),
  CONSTRAINT ck_labs_analysis_conflicts_is_array CHECK (jsonb_typeof(conflicts_json) = 'array'),
  CONSTRAINT ck_labs_analysis_docs_read_is_array CHECK (jsonb_typeof(docs_read_json) = 'array'),
  CONSTRAINT ck_labs_analysis_input_snapshot_is_object CHECK (jsonb_typeof(input_snapshot_json) = 'object'),
  CONSTRAINT ck_labs_analysis_attachment_metadata_is_array CHECK (jsonb_typeof(attachment_metadata_snapshot_json) = 'array')
);

CREATE INDEX IF NOT EXISTS ix_labs_analysis_idea_created ON labs_analysis (idea_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_labs_analysis_recommendation_score ON labs_analysis (recommendation, score DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_labs_analysis_prevent_update'
  ) THEN
    CREATE TRIGGER trg_labs_analysis_prevent_update
    BEFORE UPDATE ON labs_analysis
    FOR EACH ROW
    EXECUTE FUNCTION prevent_update_delete_append_only();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_labs_analysis_prevent_delete'
  ) THEN
    CREATE TRIGGER trg_labs_analysis_prevent_delete
    BEFORE DELETE ON labs_analysis
    FOR EACH ROW
    EXECUTE FUNCTION prevent_update_delete_append_only();
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS labs_attachment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id uuid NOT NULL,
  storage_object_id text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  file_extension text NOT NULL,
  size_bytes bigint NOT NULL,
  attachment_type text NOT NULL DEFAULT 'file',
  description text NULL,
  created_by_global_actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz NULL,
  archived_by uuid NULL,
  CONSTRAINT fk_labs_attachment_idea FOREIGN KEY (idea_id) REFERENCES labs_idea(id) ON DELETE CASCADE,
  CONSTRAINT fk_labs_attachment_created_by_global_admin FOREIGN KEY (created_by_global_actor_id) REFERENCES global_admin_user(id) ON DELETE RESTRICT,
  CONSTRAINT fk_labs_attachment_archived_by_global_admin FOREIGN KEY (archived_by) REFERENCES global_admin_user(id) ON DELETE SET NULL,
  CONSTRAINT ck_labs_attachment_storage_not_blank CHECK (btrim(storage_object_id) <> ''),
  CONSTRAINT ck_labs_attachment_file_name_not_blank CHECK (btrim(file_name) <> ''),
  CONSTRAINT ck_labs_attachment_content_type_not_blank CHECK (btrim(content_type) <> ''),
  CONSTRAINT ck_labs_attachment_file_extension CHECK (file_extension IN ('pdf', 'png', 'jpg', 'jpeg', 'txt', 'md')),
  CONSTRAINT ck_labs_attachment_size CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  CONSTRAINT ck_labs_attachment_type CHECK (attachment_type IN ('file', 'screenshot')),
  CONSTRAINT ck_labs_attachment_archive_pair CHECK ((archived_at IS NULL AND archived_by IS NULL) OR (archived_at IS NOT NULL AND archived_by IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ix_labs_attachment_idea_created ON labs_attachment (idea_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_labs_attachment_active ON labs_attachment (idea_id) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS labs_idea_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id uuid NOT NULL,
  event_type text NOT NULL,
  from_status text NULL,
  to_status text NULL,
  changed_fields_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NULL,
  created_by_global_actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_labs_idea_history_idea FOREIGN KEY (idea_id) REFERENCES labs_idea(id) ON DELETE CASCADE,
  CONSTRAINT fk_labs_idea_history_created_by_global_admin FOREIGN KEY (created_by_global_actor_id) REFERENCES global_admin_user(id) ON DELETE RESTRICT,
  CONSTRAINT ck_labs_idea_history_event_type CHECK (event_type IN ('created', 'updated', 'rejected', 'reopened', 'parked', 'approved_for_spec', 'analysis_requested', 'analysis_completed', 'analysis_failed', 'attachment_added', 'attachment_archived')),
  CONSTRAINT ck_labs_idea_history_changed_fields_is_object CHECK (jsonb_typeof(changed_fields_json) = 'object')
);

CREATE INDEX IF NOT EXISTS ix_labs_idea_history_idea_created ON labs_idea_history (idea_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_labs_idea_history_prevent_update'
  ) THEN
    CREATE TRIGGER trg_labs_idea_history_prevent_update
    BEFORE UPDATE ON labs_idea_history
    FOR EACH ROW
    EXECUTE FUNCTION prevent_update_delete_append_only();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_labs_idea_history_prevent_delete'
  ) THEN
    CREATE TRIGGER trg_labs_idea_history_prevent_delete
    BEFORE DELETE ON labs_idea_history
    FOR EACH ROW
    EXECUTE FUNCTION prevent_update_delete_append_only();
  END IF;
END
$$;

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
      'labs.idea_created',
      'labs.idea_updated',
      'labs.idea_rejected',
      'labs.idea_reopened',
      'labs.idea_parked',
      'labs.idea_approved_for_spec',
      'labs.analysis_requested',
      'labs.analysis_completed',
      'labs.analysis_failed',
      'labs.attachment_added',
      'labs.attachment_viewed',
      'labs.attachment_downloaded',
      'labs.attachment_archived',
      'labs.access_denied'
    )
  );

COMMIT;
