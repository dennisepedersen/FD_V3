# Project WIP Mapping

Status: mixed (verified reads, no active production write-path)

## Claim Verification
| Claim | Evidence | Status | Note |
|---|---|---|---|
| project_wip is read by project list/detail API queries | backend/src/db/queries/project.js selects multiple pw.* columns | verified | read-path is explicit |
| project_wip fields affect /api/projects scope=mine output | backend/src/db/queries/project.js SELECT + response columns | verified | includes registration, economics, hour metrics |
| syncWorker writes project_wip from EK payload | exhaustive search of all backend/src/**/*.js: no INSERT/UPDATE/UPSERT on project_wip found anywhere | not present | no production write-path exists in backend/src/ |
| backfill script writes project_wip | backend/scripts/backfill_verify_80229_extended.js line 87: INSERT INTO project_wip ... ON CONFLICT DO UPDATE | confirmed one-off only | not called from any service/route/worker; not a production mechanism |

## Consumed Fields in API Queries
| project_wip column | Used by | Status |
|---|---|---|
| last_registration | /api/projects scope=mine | verified |
| last_fitter_hour_date | /api/projects scope=mine | verified |
| calculated_days_since_last_registration | /api/projects scope=mine | verified |
| ready_to_bill, margin, costs, ongoing, billed, coverage | /api/projects scope=mine and detail | verified |
| hours_budget, hours_expected, hours_fitter_hour, remaining_hours | /api/projects scope=mine and detail | verified |

## Gap
- No active production write-path for project_wip exists in backend/src/.
- The only INSERT found is backend/scripts/backfill_verify_80229_extended.js — a one-off backfill script, not a production mechanism.
- EK-to-FD field mapping for WIP metrics is not documented and not implemented in syncWorker.
- Gap is tracked in audits/missing_business_semantics.md.
