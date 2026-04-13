BEGIN;

-- scope=mine filtering on team_leader_code uses lower(btrim(...)) matching username_ci.
CREATE INDEX IF NOT EXISTS ix_project_core_tenant_team_leader_code_ci
  ON project_core (tenant_id, lower(btrim(team_leader_code)));

-- project list/detail frequently filter by open/closed retention and order by updated_at.
CREATE INDEX IF NOT EXISTS ix_project_core_tenant_visibility_updated
  ON project_core (tenant_id, has_v4, is_closed, closed_observed_at, updated_at DESC);

-- fitterhours joins normalize refs via lower(btrim(...)) on both sides.
CREATE INDEX IF NOT EXISTS ix_project_core_tenant_external_ref_norm
  ON project_core (tenant_id, lower(btrim(external_project_ref)))
  WHERE external_project_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_fitter_hour_tenant_external_ref_norm
  ON fitter_hour (tenant_id, lower(btrim(external_project_ref)))
  WHERE external_project_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_fitter_hour_tenant_project_id_norm
  ON fitter_hour (tenant_id, lower(btrim(project_id)))
  WHERE project_id IS NOT NULL;

-- fitterhours join also compares against pm.ek_project_id::text.
CREATE INDEX IF NOT EXISTS ix_project_masterdata_v4_tenant_ek_project_id_text
  ON project_masterdata_v4 (tenant_id, ((ek_project_id::text)))
  WHERE ek_project_id IS NOT NULL;

COMMIT;
