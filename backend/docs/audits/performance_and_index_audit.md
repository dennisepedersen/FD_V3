# Performance and Index Audit

Date: 2026-04-11
Status: verified

## Reviewed Hot Paths
- /api/projects?scope=mine
- /api/projects/:projectId
- /api/fitterhours and project fitterhours summary/breakdown queries
- sync upsert/read loops in syncWorker

## Findings
1. scope=mine filters on team_leader_code use lower(trim()) but lacked dedicated functional index.
2. project list filter/sort combines tenant + has_v4 + is_closed/closed_observed_at + updated_at ordering without a covering index.
3. fitterhours/project joins rely on normalized OR predicates across external_project_ref/project_id and ek_project_id text conversion; missing matching expression indexes.
4. sync loops already use batch upsert patterns and per-page persistence (good baseline).

## Actions Taken
- Added migration for targeted functional/composite indexes aligned to real predicates.
- Kept existing indexes; no destructive or broad speculative indexing.

## Correction of Earlier Over-Strong Statement
- Earlier revision over-stated nextPage as primary pagination truth.
- That does not change SQL query predicates or join shapes used by API/query layer indexes.
- Therefore, index relevance is unchanged by paging correction.

## 0016 Index Verification
| index | table | query pattern supported | predicate/order basis | still relevant after paging correction |
|---|---|---|---|---|
| ix_project_core_tenant_team_leader_code_ci | project_core | scope=mine project list/detail actor match | lower(btrim(team_leader_code)) compare in project/fitterhour scoping queries | yes |
| ix_project_core_tenant_visibility_updated | project_core | /api/projects scope=mine filter + sort | tenant_id + has_v4 + is_closed + closed_observed_at + ORDER BY updated_at DESC | yes |
| ix_project_core_tenant_external_ref_norm | project_core | fitter_hour -> project matching by external ref | lower(btrim(external_project_ref)) normalized joins | yes |
| ix_fitter_hour_tenant_external_ref_norm | fitter_hour | project/fitterhour join arm on fh.external_project_ref | lower(btrim(fh.external_project_ref)) normalized joins | yes |
| ix_fitter_hour_tenant_project_id_norm | fitter_hour | project/fitterhour join arm on fh.project_id | lower(btrim(fh.project_id)) normalized joins | yes |
| ix_project_masterdata_v4_tenant_ek_project_id_text | project_masterdata_v4 | join arm using pm.ek_project_id::text | tenant_id + ek_project_id::text lookup in normalized OR joins | yes |

## Residual Risks
- OR-based normalized joins may still become expensive at high cardinality; long-term improvement is explicit relation key materialization from fitter_hour to project_core.project_id.
- Heuristic text classification in fitterBusiness can be CPU-heavy; acceptable at current scale but should be monitored.
