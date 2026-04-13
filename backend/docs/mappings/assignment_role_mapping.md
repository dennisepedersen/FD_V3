# Assignment Role Mapping

Status: verified

## Table
- project_assignment
- assignment_role enum: owner | contributor | reviewer

## Current Usage
- Role value itself is currently not used in SQL filters for scope=mine.
- Existence of assignment row grants project visibility for mine scope.

## Effective Access Signals in Project Flows
1. assignment row existence
2. owner_user_id match
3. responsible_code/team_leader_code username match

## Risk Note
- Because assignment_role is not interpreted in query predicates, role granularity is currently informational for mine-scope access.
- This is documented, not changed, in this audit.
