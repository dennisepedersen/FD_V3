# Scope Rules

Status: verified

## /api/projects
- Only supports scope=mine.
- Any other scope returns 400 unsupported_project_scope.
- Access gating requires:
- tenant context match between auth token and resolved tenant host
- authenticated access token

## mine semantics for projects
A project is visible when at least one is true:
1. lower(trim(project_core.responsible_code)) == lower(trim(current tenant_user.username))
2. lower(trim(project_core.team_leader_code)) == lower(trim(current tenant_user.username))
3. project_core.owner_user_id == current user id
4. project_assignment has tenant_user_id == current user id

Additional project filter:
- include open projects with has_v4=true
- include closed projects only when closed_observed_at > now - 6 months

## /api/fitterhours
- Supports scope=mine and scope=all.
- scope=all requires role tenant_admin.
- mine/all both still enforce tenant_id and scoped_projects CTE.
