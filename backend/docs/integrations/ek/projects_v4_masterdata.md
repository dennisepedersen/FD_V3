# EK Projects v4 Masterdata Contract

Contract status: verified
Endpoint family: /api/v4.0/projects and /api/v4/projects (discovered at runtime)
Consumer: backend/src/services/syncWorker.js

## Purpose
- Authoritative project master stream for open/closed state in FD.
- Drives project_core upsert and retention cleanup eligibility.

## Payload Handling (verified)
- Paged fetch with query params page and pageSize.
- Optional updatedAfter in delta mode.
- Parsed by parsePagedPayload with support for:
- payload.data[0].data + payload.data[0].nextPage
- payload.data
- payload.items
- payload.result

## Verified Fields Used
| EK field | FD usage | Destination |
|---|---|---|
| reference/Reference/projectReference/ProjectReference | external project reference | project_core.external_project_ref |
| ProjectName/projectName/name/Name | project name | project_core.name |
| Status/status/ProjectStatus | status fallback | project_core.status |
| isClosed/IsClosed | authoritative close state | project_core.is_closed + closed_observed_at |
| Responsible*/TeamLeader* variants | role identity fields | project_core.responsible_* and team_leader_* |
| date-like fields (updatedDate/startDate/etc) | activity fallback | project_core.activity_date |

## Unclear Fields
| Field group | Why unclear |
|---|---|
| project_expected_values/project_budget subtree semantics | stored in project_masterdata_v4 JSON but business meaning is not fully documented in backend |
| worksheet_ids linkage guarantees | no enforced FK to worksheet entity in current schema |

## Relations
- project_core.project_id is FD internal primary key.
- project_masterdata_v4.ek_project_id supports joins to fitter_hour.project identifiers via text comparison in queries.

## Known Pitfalls
- Endpoint compatibility is probed dynamically; version path is not guaranteed.
- nextPage may be missing or inconsistent across endpoints; it must not be used as primary stop signal.
- Primary paging control is row-count vs pageSize (continue only on full page).

## Allowed FD Usage
- Project bootstrap/delta sync.
- Scope=mine and project detail source enrichment through project_core/project_masterdata_v4.
