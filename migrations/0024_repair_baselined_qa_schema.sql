BEGIN;

-- Repair drift caused by 0017/0018/0019 being marked as baseline before
-- their schema objects were actually present in production.
-- Forward-only and idempotent: no data is deleted and schema_migration is not touched.

CREATE TABLE IF NOT EXISTS merge_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_type text NOT NULL,
  master_entity_id uuid NOT NULL,
  merged_entity_id uuid NOT NULL,
  merge_status text NOT NULL DEFAULT 'suggested',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE merge_links
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS tenant_id uuid,
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS master_entity_id uuid,
  ADD COLUMN IF NOT EXISTS merged_entity_id uuid,
  ADD COLUMN IF NOT EXISTS merge_status text DEFAULT 'suggested',
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'merge_links'::regclass
      AND conname = 'fk_merge_links_tenant'
  ) THEN
    ALTER TABLE merge_links
      ADD CONSTRAINT fk_merge_links_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'merge_links'::regclass
      AND conname = 'ck_merge_links_entity_type_not_blank'
  ) THEN
    ALTER TABLE merge_links
      ADD CONSTRAINT ck_merge_links_entity_type_not_blank
      CHECK (btrim(entity_type) <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'merge_links'::regclass
      AND conname = 'ck_merge_links_status'
  ) THEN
    ALTER TABLE merge_links
      ADD CONSTRAINT ck_merge_links_status
      CHECK (merge_status IN ('suggested', 'confirmed', 'rejected', 'unmerged'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'merge_links'::regclass
      AND conname = 'ck_merge_links_distinct_entities'
  ) THEN
    ALTER TABLE merge_links
      ADD CONSTRAINT ck_merge_links_distinct_entities
      CHECK (master_entity_id <> merged_entity_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'merge_links'::regclass
      AND conname = 'uq_merge_links_pair'
  ) THEN
    ALTER TABLE merge_links
      ADD CONSTRAINT uq_merge_links_pair
      UNIQUE (tenant_id, entity_type, master_entity_id, merged_entity_id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS ix_merge_links_master_entity
  ON merge_links (tenant_id, entity_type, master_entity_id);

CREATE INDEX IF NOT EXISTS ix_merge_links_merged_entity
  ON merge_links (tenant_id, entity_type, merged_entity_id);

CREATE TABLE IF NOT EXISTS qa_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  title text NULL,
  status text NOT NULL DEFAULT 'NEW',
  priority text NOT NULL DEFAULT 'normal',
  created_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE qa_threads
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS tenant_id uuid,
  ADD COLUMN IF NOT EXISTS project_id uuid,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'NEW',
  ADD COLUMN IF NOT EXISTS priority text DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'qa_threads'::regclass
      AND conname = 'fk_qa_threads_tenant'
  ) THEN
    ALTER TABLE qa_threads
      ADD CONSTRAINT fk_qa_threads_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'qa_threads'::regclass
      AND conname = 'fk_qa_threads_project'
  ) THEN
    ALTER TABLE qa_threads
      ADD CONSTRAINT fk_qa_threads_project
      FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'qa_threads'::regclass
      AND conname = 'fk_qa_threads_created_by_user'
  ) THEN
    ALTER TABLE qa_threads
      ADD CONSTRAINT fk_qa_threads_created_by_user
      FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'qa_threads'::regclass
      AND conname = 'uq_qa_threads_id_tenant'
  ) THEN
    ALTER TABLE qa_threads
      ADD CONSTRAINT uq_qa_threads_id_tenant
      UNIQUE (id, tenant_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'qa_threads'::regclass
      AND conname = 'ck_qa_threads_status'
  ) THEN
    ALTER TABLE qa_threads
      ADD CONSTRAINT ck_qa_threads_status
      CHECK (status IN ('NEW', 'WAITING', 'ANSWERED', 'CLOSED'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'qa_threads'::regclass
      AND conname = 'ck_qa_threads_priority'
  ) THEN
    ALTER TABLE qa_threads
      ADD CONSTRAINT ck_qa_threads_priority
      CHECK (priority IN ('low', 'normal', 'high'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'qa_threads'::regclass
      AND conname = 'ck_qa_threads_title_not_blank'
  ) THEN
    ALTER TABLE qa_threads
      ADD CONSTRAINT ck_qa_threads_title_not_blank
      CHECK (title IS NULL OR btrim(title) <> '');
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS ix_qa_threads_tenant_project
  ON qa_threads (tenant_id, project_id);

CREATE INDEX IF NOT EXISTS ix_qa_threads_tenant_status
  ON qa_threads (tenant_id, status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_qa_threads_set_updated_at'
  ) THEN
    CREATE TRIGGER trg_qa_threads_set_updated_at
    BEFORE UPDATE ON qa_threads
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
    WHERE tgname = 'trg_qa_threads_prevent_immutable_update'
  ) THEN
    CREATE TRIGGER trg_qa_threads_prevent_immutable_update
    BEFORE UPDATE ON qa_threads
    FOR EACH ROW
    EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'project_id', 'created_by_user_id', 'created_at');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS qa_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  project_id uuid NOT NULL,
  user_id uuid NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz NULL,
  deleted_at timestamptz NULL
);

ALTER TABLE qa_messages
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS tenant_id uuid,
  ADD COLUMN IF NOT EXISTS thread_id uuid,
  ADD COLUMN IF NOT EXISTS project_id uuid,
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS message text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'qa_messages'::regclass
      AND conname = 'fk_qa_messages_tenant'
  ) THEN
    ALTER TABLE qa_messages
      ADD CONSTRAINT fk_qa_messages_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'qa_messages'::regclass
      AND conname = 'fk_qa_messages_thread_tenant'
  ) THEN
    ALTER TABLE qa_messages
      ADD CONSTRAINT fk_qa_messages_thread_tenant
      FOREIGN KEY (thread_id, tenant_id) REFERENCES qa_threads(id, tenant_id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'qa_messages'::regclass
      AND conname = 'fk_qa_messages_project'
  ) THEN
    ALTER TABLE qa_messages
      ADD CONSTRAINT fk_qa_messages_project
      FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'qa_messages'::regclass
      AND conname = 'fk_qa_messages_user'
  ) THEN
    ALTER TABLE qa_messages
      ADD CONSTRAINT fk_qa_messages_user
      FOREIGN KEY (user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'qa_messages'::regclass
      AND conname = 'ck_qa_messages_message_not_blank'
  ) THEN
    ALTER TABLE qa_messages
      ADD CONSTRAINT ck_qa_messages_message_not_blank
      CHECK (btrim(message) <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'qa_messages'::regclass
      AND conname = 'ck_qa_messages_edit_after_create'
  ) THEN
    ALTER TABLE qa_messages
      ADD CONSTRAINT ck_qa_messages_edit_after_create
      CHECK (edited_at IS NULL OR edited_at >= created_at);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'qa_messages'::regclass
      AND conname = 'ck_qa_messages_delete_after_create'
  ) THEN
    ALTER TABLE qa_messages
      ADD CONSTRAINT ck_qa_messages_delete_after_create
      CHECK (deleted_at IS NULL OR deleted_at >= created_at);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS ix_qa_messages_tenant_thread
  ON qa_messages (tenant_id, thread_id);

CREATE INDEX IF NOT EXISTS ix_qa_messages_project
  ON qa_messages (tenant_id, project_id);

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
      'qa_thread_status_changed'
    )
  );

COMMIT;
