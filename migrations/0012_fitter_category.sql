BEGIN;

CREATE TABLE IF NOT EXISTS fitter_category (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  fitter_category_id text NOT NULL,
  reference text NULL,
  description text NULL,
  display text NULL,
  work_type_id text NULL,
  unit text NULL,
  unit_id text NULL,
  is_on_invoice boolean NULL,
  include_illness boolean NULL,
  hour_rate numeric(14,4) NULL,
  social_fee numeric(14,4) NULL,
  sales_price numeric(14,4) NULL,
  show_in_app boolean NULL,
  is_only_for_internal_projects boolean NULL,
  include_in_salary_calculation boolean NULL,
  salary_company_fitter_category text NULL,
  salary_company_group_by_date boolean NULL,
  salary_company_absence_code text NULL,
  group_fitter_categories_with_same_salary_category boolean NULL,
  show_absence_code boolean NULL,
  bluegarden_salary_type text NULL,
  visma_salary_type text NULL,
  salary_company_use_amount boolean NULL,
  salary_company_use_rate boolean NULL,
  salary_company_use_total boolean NULL,
  lessor_type text NULL,
  lessor_type_id text NULL,
  link text NULL,
  default_cost_code text NULL,
  cost_code_id text NULL,
  cost_code_name text NULL,
  cost_code_alias text NULL,
  sum_cost_code_id text NULL,
  sum_cost_code_name text NULL,
  sum_cost_code_alias text NULL,
  sum_cost_code_display text NULL,
  cost_code_display text NULL,
  raw_payload_json jsonb NULL,
  source_updated_at timestamptz NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_fitter_category_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT ck_fitter_category_id_not_blank CHECK (btrim(fitter_category_id) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fitter_category_tenant_external_id
  ON fitter_category (tenant_id, fitter_category_id);

CREATE INDEX IF NOT EXISTS ix_fitter_category_tenant_reference
  ON fitter_category (tenant_id, reference);

CREATE INDEX IF NOT EXISTS ix_fitter_category_tenant_updated
  ON fitter_category (tenant_id, updated_at DESC);

DROP TRIGGER IF EXISTS trg_fitter_category_set_updated_at ON fitter_category;
CREATE TRIGGER trg_fitter_category_set_updated_at
BEFORE UPDATE ON fitter_category
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_fitter_category_prevent_immutable_update ON fitter_category;
CREATE TRIGGER trg_fitter_category_prevent_immutable_update
BEFORE UPDATE ON fitter_category
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'fitter_category_id', 'created_at');

COMMIT;
