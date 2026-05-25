BEGIN;

CREATE TABLE IF NOT EXISTS qa_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  title text NULL,
  status text NOT NULL DEFAULT 'NEW',
  priority text NOT NULL DEFAULT 'normal',
  created_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_qa_threads_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_qa_threads_project FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_qa_threads_created_by_user FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT uq_qa_threads_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT ck_qa_threads_status CHECK (status IN ('NEW', 'WAITING', 'ANSWERED', 'CLOSED')),
  CONSTRAINT ck_qa_threads_priority CHECK (priority IN ('low', 'normal', 'high')),
  CONSTRAINT ck_qa_threads_title_not_blank CHECK (title IS NULL OR btrim(title) <> '')
);

CREATE INDEX IF NOT EXISTS ix_qa_threads_tenant_project ON qa_threads (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS ix_qa_threads_tenant_status ON qa_threads (tenant_id, status);

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
  deleted_at timestamptz NULL,
  CONSTRAINT fk_qa_messages_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_qa_messages_thread_tenant FOREIGN KEY (thread_id, tenant_id) REFERENCES qa_threads(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_qa_messages_project FOREIGN KEY (project_id, tenant_id) REFERENCES project_core(project_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_qa_messages_user FOREIGN KEY (user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT ck_qa_messages_message_not_blank CHECK (btrim(message) <> ''),
  CONSTRAINT ck_qa_messages_edit_after_create CHECK (edited_at IS NULL OR edited_at >= created_at),
  CONSTRAINT ck_qa_messages_delete_after_create CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);

CREATE INDEX IF NOT EXISTS ix_qa_messages_tenant_thread ON qa_messages (tenant_id, thread_id);
CREATE INDEX IF NOT EXISTS ix_qa_messages_project ON qa_messages (tenant_id, project_id);

COMMIT;