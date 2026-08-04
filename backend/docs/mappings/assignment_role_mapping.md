# Assignment Role Mapping

Status: verified

## Tables
- `project_assignment` stores effective access.
- `project_assignment_source` stores source rows for effective access.
- Supported source types: `manual`, `worksheet`.
- assignment_role enum: owner | contributor | reviewer

## Current Usage
- Role value itself is currently not used in SQL filters for scope=mine.
- Existence of an effective `project_assignment` row grants project visibility for mine scope.
- Effective assignment is removed only when no active source remains for the same tenant/project/user.

## Effective Access Signals in Project Flows
1. effective assignment row existence
2. owner_user_id match
3. responsible_code/team_leader_code username match

## Risk Note
- Because assignment_role is not interpreted in query predicates, role granularity is currently informational for mine-scope access.
- Manual access must not be removed by worksheet sync. Worksheet expiry/removal deletes only the worksheet source first.