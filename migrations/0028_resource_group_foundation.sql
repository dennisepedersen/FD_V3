BEGIN;

CREATE TABLE IF NOT EXISTS resource_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  description text NULL,
  status text NOT NULL DEFAULT 'active',
  created_by_user_id uuid NULL,
  updated_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_resource_groups_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_resource_groups_created_by_user
    FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_resource_groups_updated_by_user
    FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT ck_resource_groups_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_resource_groups_description_not_blank CHECK (description IS NULL OR btrim(description) <> ''),
  CONSTRAINT ck_resource_groups_status CHECK (status IN ('active', 'archived'))
);

ALTER TABLE resource_groups
  ADD CONSTRAINT uq_resource_groups_id_tenant UNIQUE (id, tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_resource_groups_tenant_name_ci
  ON resource_groups (tenant_id, lower(name));

CREATE INDEX IF NOT EXISTS ix_resource_groups_tenant_status
  ON resource_groups (tenant_id, status, name);

CREATE INDEX IF NOT EXISTS ix_resource_groups_created_by
  ON resource_groups (tenant_id, created_by_user_id);

CREATE TABLE IF NOT EXISTS resource_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  group_id uuid NOT NULL,
  -- V1 resource group membership references the current fitter identity. A
  -- neutral resource_person model can be added later without changing group
  -- ownership semantics.
  fitter_id text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_by_user_id uuid NULL,
  updated_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_resource_group_members_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_resource_group_members_group
    FOREIGN KEY (group_id, tenant_id) REFERENCES resource_groups(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_resource_group_members_fitter
    FOREIGN KEY (tenant_id, fitter_id) REFERENCES fitter(tenant_id, fitter_id) ON DELETE RESTRICT,
  CONSTRAINT fk_resource_group_members_created_by_user
    FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_resource_group_members_updated_by_user
    FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL
);

ALTER TABLE resource_group_members
  ADD CONSTRAINT uq_resource_group_members_id_tenant UNIQUE (id, tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_resource_group_members_group_fitter
  ON resource_group_members (tenant_id, group_id, fitter_id);

CREATE INDEX IF NOT EXISTS ix_resource_group_members_tenant_fitter
  ON resource_group_members (tenant_id, fitter_id);

CREATE INDEX IF NOT EXISTS ix_resource_group_members_tenant_group
  ON resource_group_members (tenant_id, group_id);

CREATE TABLE IF NOT EXISTS resource_group_managers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  group_id uuid NOT NULL,
  tenant_user_id uuid NOT NULL,
  manager_role text NOT NULL DEFAULT 'manager',
  created_by_user_id uuid NULL,
  updated_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_resource_group_managers_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT fk_resource_group_managers_group
    FOREIGN KEY (group_id, tenant_id) REFERENCES resource_groups(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_resource_group_managers_user
    FOREIGN KEY (tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_resource_group_managers_created_by_user
    FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT fk_resource_group_managers_updated_by_user
    FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT ck_resource_group_managers_role CHECK (manager_role IN ('owner', 'manager', 'viewer'))
);

ALTER TABLE resource_group_managers
  ADD CONSTRAINT uq_resource_group_managers_id_tenant UNIQUE (id, tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_resource_group_managers_group_user
  ON resource_group_managers (tenant_id, group_id, tenant_user_id);

CREATE INDEX IF NOT EXISTS ix_resource_group_managers_tenant_user
  ON resource_group_managers (tenant_id, tenant_user_id);

CREATE INDEX IF NOT EXISTS ix_resource_group_managers_tenant_group_role
  ON resource_group_managers (tenant_id, group_id, manager_role);

DROP TRIGGER IF EXISTS trg_resource_groups_set_updated_at
  ON resource_groups;
CREATE TRIGGER trg_resource_groups_set_updated_at
BEFORE UPDATE ON resource_groups
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_resource_groups_prevent_immutable_update
  ON resource_groups;
CREATE TRIGGER trg_resource_groups_prevent_immutable_update
BEFORE UPDATE ON resource_groups
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'created_by_user_id', 'created_at');

DROP TRIGGER IF EXISTS trg_resource_group_members_set_updated_at
  ON resource_group_members;
CREATE TRIGGER trg_resource_group_members_set_updated_at
BEFORE UPDATE ON resource_group_members
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_resource_group_members_prevent_immutable_update
  ON resource_group_members;
CREATE TRIGGER trg_resource_group_members_prevent_immutable_update
BEFORE UPDATE ON resource_group_members
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'group_id', 'fitter_id', 'created_by_user_id', 'created_at');

DROP TRIGGER IF EXISTS trg_resource_group_managers_set_updated_at
  ON resource_group_managers;
CREATE TRIGGER trg_resource_group_managers_set_updated_at
BEFORE UPDATE ON resource_group_managers
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_resource_group_managers_prevent_immutable_update
  ON resource_group_managers;
CREATE TRIGGER trg_resource_group_managers_prevent_immutable_update
BEFORE UPDATE ON resource_group_managers
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'group_id', 'tenant_user_id', 'created_by_user_id', 'created_at');

COMMIT;
