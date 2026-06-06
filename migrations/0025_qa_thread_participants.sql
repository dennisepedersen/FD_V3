BEGIN;

CREATE TABLE IF NOT EXISTS qa_thread_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  project_id uuid NOT NULL,
  tenant_user_id uuid NOT NULL,
  participant_role text NOT NULL DEFAULT 'participant',
  is_assigned boolean NOT NULL DEFAULT false,
  assigned_at timestamptz NULL,
  assigned_by_user_id uuid NULL,
  last_seen_at timestamptz NULL,
  last_seen_message_id uuid NULL,
  visibility_source text NOT NULL DEFAULT 'explicit',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_qa_thread_participants_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_qa_thread_participants_thread_tenant FOREIGN KEY (thread_id, tenant_id) REFERENCES qa_threads(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_qa_thread_participants_project FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_qa_thread_participants_user FOREIGN KEY (tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_qa_thread_participants_assigned_by FOREIGN KEY (assigned_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_qa_thread_participants_last_seen_message FOREIGN KEY (last_seen_message_id) REFERENCES qa_messages(id) ON DELETE SET NULL,
  CONSTRAINT uq_qa_thread_participants_thread_user UNIQUE (tenant_id, thread_id, tenant_user_id),
  CONSTRAINT ck_qa_thread_participants_role CHECK (participant_role IN ('creator', 'recipient', 'participant', 'watcher')),
  CONSTRAINT ck_qa_thread_participants_visibility_source CHECK (visibility_source IN ('explicit', 'project_assignment', 'project_owner', 'responsible', 'team_leader', 'self')),
  CONSTRAINT ck_qa_thread_participants_assigned_at CHECK (
    (is_assigned = false AND assigned_at IS NULL)
    OR
    (is_assigned = true)
  )
);

CREATE INDEX IF NOT EXISTS ix_qa_thread_participants_user_active
  ON qa_thread_participants (tenant_id, tenant_user_id, active, updated_at DESC);

CREATE INDEX IF NOT EXISTS ix_qa_thread_participants_project_thread
  ON qa_thread_participants (tenant_id, project_id, thread_id);

CREATE INDEX IF NOT EXISTS ix_qa_thread_participants_thread
  ON qa_thread_participants (tenant_id, thread_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_qa_thread_participants_set_updated_at'
  ) THEN
    CREATE TRIGGER trg_qa_thread_participants_set_updated_at
    BEFORE UPDATE ON qa_thread_participants
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_qa_thread_participants_prevent_immutable_update'
  ) THEN
    CREATE TRIGGER trg_qa_thread_participants_prevent_immutable_update
    BEFORE UPDATE ON qa_thread_participants
    FOR EACH ROW
    EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'thread_id', 'project_id', 'tenant_user_id', 'created_at');
  END IF;
END
$$;

WITH latest_messages AS (
  SELECT DISTINCT ON (tenant_id, thread_id)
    tenant_id,
    thread_id,
    id AS message_id,
    created_at
  FROM qa_messages
  WHERE deleted_at IS NULL
  ORDER BY tenant_id, thread_id, created_at DESC, id DESC
)
INSERT INTO qa_thread_participants (
  tenant_id,
  thread_id,
  project_id,
  tenant_user_id,
  participant_role,
  is_assigned,
  last_seen_at,
  last_seen_message_id,
  visibility_source
)
SELECT
  qt.tenant_id,
  qt.id,
  qt.project_id,
  qt.created_by_user_id,
  'creator',
  false,
  COALESCE(lm.created_at, qt.created_at),
  lm.message_id,
  'self'
FROM qa_threads qt
LEFT JOIN latest_messages lm
  ON lm.tenant_id = qt.tenant_id
 AND lm.thread_id = qt.id
WHERE qt.created_by_user_id IS NOT NULL
ON CONFLICT (tenant_id, thread_id, tenant_user_id) DO NOTHING;

INSERT INTO qa_thread_participants (
  tenant_id,
  thread_id,
  project_id,
  tenant_user_id,
  participant_role,
  is_assigned,
  visibility_source
)
SELECT DISTINCT
  qt.tenant_id,
  qt.id,
  qt.project_id,
  participant.tenant_user_id,
  'participant',
  false,
  participant.visibility_source
FROM qa_threads qt
JOIN project_core pc
  ON pc.tenant_id = qt.tenant_id
 AND pc.project_id = qt.project_id
JOIN LATERAL (
  SELECT pc.owner_user_id AS tenant_user_id, 'project_owner' AS visibility_source
  WHERE pc.owner_user_id IS NOT NULL

  UNION

  SELECT pa.tenant_user_id, 'project_assignment'
  FROM project_assignment pa
  WHERE pa.tenant_id = pc.tenant_id
    AND pa.project_id = pc.project_id

  UNION

  SELECT tu.id, 'responsible'
  FROM tenant_user tu
  WHERE tu.tenant_id = pc.tenant_id
    AND lower(btrim(tu.username)) = lower(btrim(pc.responsible_code))
    AND nullif(btrim(pc.responsible_code), '') IS NOT NULL

  UNION

  SELECT tu.id, 'team_leader'
  FROM tenant_user tu
  WHERE tu.tenant_id = pc.tenant_id
    AND lower(btrim(tu.username)) = lower(btrim(pc.team_leader_code))
    AND nullif(btrim(pc.team_leader_code), '') IS NOT NULL
) participant ON true
ON CONFLICT (tenant_id, thread_id, tenant_user_id) DO NOTHING;

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
      'qa_thread_participant_added'
    )
  );

COMMIT;
