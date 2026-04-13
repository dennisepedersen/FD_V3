# Query Manual: /api/projects/:projectId

Status: verified
Route: backend/src/routes/tenantSurfaceRoutes.js
Query: findProjectForUser in backend/src/db/queries/project.js

## Purpose
- Return single project details only if caller has mine-scope access to that project.

## Source of Truth
- project_core with supplemental project_wip and project_masterdata_v4.

## Access Enforcement
- same mine predicate as project list:
- responsible_code username match
- team_leader_code username match
- owner_user_id match
- project_assignment match

## Tenant Enforcement
- tenant_context_mismatch check in route
- SQL WHERE pc.tenant_id = $1 and pc.project_id = $2

## Related Endpoints
- /api/projects/:projectId/fitterhours/summary
- /api/projects/:projectId/fitterhours/breakdown
Both call findProjectForUser first, then fitter business queries.
