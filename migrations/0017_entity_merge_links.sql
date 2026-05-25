BEGIN;

CREATE TABLE IF NOT EXISTS merge_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_type text NOT NULL,
  master_entity_id uuid NOT NULL,
  merged_entity_id uuid NOT NULL,
  merge_status text NOT NULL DEFAULT 'suggested',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_merge_links_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT ck_merge_links_entity_type_not_blank CHECK (btrim(entity_type) <> ''),
  CONSTRAINT ck_merge_links_status CHECK (merge_status IN ('suggested', 'confirmed', 'rejected', 'unmerged')),
  CONSTRAINT ck_merge_links_distinct_entities CHECK (master_entity_id <> merged_entity_id),
  CONSTRAINT uq_merge_links_pair UNIQUE (tenant_id, entity_type, master_entity_id, merged_entity_id)
);

CREATE INDEX IF NOT EXISTS ix_merge_links_master_entity ON merge_links (tenant_id, entity_type, master_entity_id);
CREATE INDEX IF NOT EXISTS ix_merge_links_merged_entity ON merge_links (tenant_id, entity_type, merged_entity_id);

COMMIT;