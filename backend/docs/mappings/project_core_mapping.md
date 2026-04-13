# Project Core Mapping

Status: verified

## Source Endpoints
- projects_v4 (authoritative)
- projects_v3 (enrichment only)

## Claim Verification
| Claim | Evidence | Status | Note |
|---|---|---|---|
| external_project_ref comes from EK reference family and is mandatory for project upsert | backend/src/services/syncWorker.js mapProjectRow + upsertProjectBatch | verified | row dropped when external ref is empty |
| name is mapped from EK name-family fields with fallback | backend/src/services/syncWorker.js mapProjectRow | verified | fallback Project {ref} |
| isClosed is authoritative only from projects_v4 | backend/src/services/syncWorker.js mapProjectRow sourceEndpointKey === projects_v4 | verified | v3 does not close projects |
| v3 only proves open when IsWorkInProgress=true | backend/src/services/syncWorker.js mapProjectRow sourceEndpointKey === projects_v3 | verified | otherwise v3 leaves status/isClosed unchanged |
| responsible/team leader identity fields are mapped to project_core.* | backend/src/services/syncWorker.js mapProjectRow + upsertProjectBatch | verified | used later in scope SQL |
| activity_date is derived from date candidate list | backend/src/services/syncWorker.js pickDateValue + mapProjectRow | verified | first valid date wins |
| has_v4/has_v3 lifecycle flags are cumulative | backend/src/services/syncWorker.js upsertProjectBatch SET has_v4 = project_core.has_v4 OR EXCLUDED.has_v4 (same for has_v3) | verified | flags are not unset |
| closed_observed_at transition handling is write-side managed in upsert | backend/src/services/syncWorker.js upsertProjectBatch CASE on closed/open transitions | verified | also read by list filter |

## Key Rules
- Upsert key: (tenant_id, external_project_ref).
- project_id is FD generated UUID, not EK value.
- has_v4/has_v3 flags are cumulative and never unset in current logic.
- closed_observed_at is maintained from v4 transition logic.
