# Query Manual: /api/projects?scope=mine

Status: verified
Route: backend/src/routes/tenantSurfaceRoutes.js
Query: listProjectsForUser in backend/src/db/queries/project.js

## Purpose
- Return tenant-scoped projects visible to current user.

## Claim Verification
| Claim | Evidence | Status | Note |
|---|---|---|---|
| Scope=mine query is tenant-scoped | backend/src/db/queries/project.js uses pc.tenant_id = $1 and tenant-bound joins | verified | hard tenant boundary |
| mine visibility uses responsible/team leader/owner/assignment OR logic | backend/src/db/queries/project.js scoped_projects WHERE block | verified | username_ci compare + owner_user_id + project_assignment |
| open-project visibility requires has_v4=true | backend/src/db/queries/project.js filter block: COALESCE(pc.is_closed,false)=false AND pc.has_v4=true | verified | explicit in SQL |
| closed projects are retained only by observed window | backend/src/db/queries/project.js filter block: closed_observed_at > now()-interval '6 months' | verified | explicit retention guard |
| project_wip fields are read in list output | backend/src/db/queries/project.js SELECT columns from pw.* | verified | list API consumes WIP columns |
| dedupe by project reference/project_id with newest row preference | backend/src/db/queries/project.js ranked_projects CTE ROW_NUMBER PARTITION/ORDER | verified | deterministic dedupe |

## Source of Truth
- Primary: project_core
- Supplemental reads: project_wip, project_masterdata_v4, project_assignment, tenant_user

## SQL Summary
- current_actor CTE resolves tenant_user.username to username_ci.
- scoped_projects CTE applies tenant filter, open/closed retention filter, and mine predicate.
- ranked_projects deduplicates by external_project_ref/project_id with latest updated_at priority.
- final sort: updated_at DESC, name ASC.

## Joins
- LEFT JOIN project_assignment by tenant_id + project_id
- LEFT JOIN project_wip by tenant_id + project_id
- LEFT JOIN project_masterdata_v4 by tenant_id + project_id

## Filters
- tenant_id mandatory
- open projects require has_v4=true
- closed projects allowed only if closed_observed_at within last 6 months
- mine access predicates (responsible/team_leader/owner/assignment)

## Performance Notes
- Uses lower(trim()) predicates on responsible_code/team_leader_code.
- Recommended indexes:
- ix_project_core_tenant_responsible_code_ci (exists)
- team_leader functional index (added in this audit migration)
- filter+sort support index for open/closed + updated_at (added in this audit migration)
