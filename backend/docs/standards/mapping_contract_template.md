# Mapping Contract Template

Status: template

## Mapping Scope
- Source endpoint:
- Destination table(s):
- Destination query consumers:
- Mapping status: verified | observed | hypothesis | unclear

## Field Mapping Table
| EK field | FD field | FD column | Data type | Transform | Null policy | Status | Note |
|---|---|---|---|---|---|---|---|

## Identity and Keys
- Source natural key(s)
- FD upsert key(s)
- Duplicate handling strategy

## Tenant and Scope Constraints
- Required tenant_id usage
- Any role/scope gates tied to mapped fields

## Drift Detection
- What indicates contract drift
- Where to log or audit drift

## Evidence
- mapper function(s)
- upsert function(s)
- schema/migration references
