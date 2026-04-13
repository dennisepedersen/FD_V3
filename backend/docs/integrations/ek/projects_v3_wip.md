# EK Projects v3 WorkInProgress Contract

Contract status: verified
Endpoint family: /Management/WorkInProgress (+ v3 prefixed variants)
Consumer: backend/src/services/syncWorker.js

## Purpose
- Enrichment stream for projects already known in project_core.
- Supplies WIP/open signal and identity fallback fields.

## Verified Behavior
- v3 rows are mapped but only persisted when matching existing project_core.external_project_ref.
- v3 does not create new project_core rows.
- isWorkInProgress=true is treated as open signal; false/null is non-authoritative.

## Verified Fields Used
| EK field | FD usage | Destination |
|---|---|---|
| Reference-like project id fields | match existing project_core ref | sync filterExistingProjectRowsForV3Enrichment |
| IsWorkInProgress | open hint only | mapProjectRow status/is_closed logic |
| Responsible*/TeamLeader* | identity enrichment | project_core.responsible_* / team_leader_* |

## Unclear Fields
| Field | Why unclear |
|---|---|
| Full financial WIP fields in v3 payload | not materialized to project_wip in current worker implementation |

## Known Pitfalls
- Treated as optional enrichment phase: failures do not fail bootstrap when v4 succeeds.
- Must not override authoritative close/open from v4.

## Allowed FD Usage
- Identity/role field enrichment for existing project rows only.
