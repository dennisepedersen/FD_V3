# Current State Audit

Date: 2026-04-11
Status: verified from code + schema

## 1) EK endpoints actually read
- projects_v4 via discovered variants under /api/v4.0/projects and /api/v4/projects
- projects_v3 via documented /api/v3.0/projects variants; /Management/WorkInProgress must not be used as an API path
- fittercategories
- fitters
- fitterhours
- users/invoices/purchaseinvoices/worksheets can be fetched as read-only endpoint mode when selected

## 2) Sync jobs actually present
- bootstrap_initial, delta, retry_backlog, manual_full_resync, slow_reconciliation (+ legacy bootstrap)
- Claimed through sync_job claimNextSyncJob queue with retry metadata.

## 3) Tables used by core flows
- Project list/detail scope: project_core + project_wip + project_masterdata_v4 + project_assignment + tenant_user
- Fitterhours API: fitter_hour + project_core + project_masterdata_v4 + fitter + fitter_category
- Assignment/scope: project_assignment + project_core responsible/team leader fields
- Sync state: sync_endpoint_state + sync_failure_backlog + sync_page_log + sync_job

## 3a) Fitterhours retention update (2026-05-31)
- Verified EK project-level internal/external source field exists as v4 LIST `isIntern` and v4 DETAIL `IsInternal`.
- Current FD schema does not persist project-level `is_internal`.
- Current synced fitterhours can be rolling 12-month scoped; they must not be treated as all EK hours.
- Verified target model: active external projects use all-time ProjectID-targeted sync; internal or closed projects use rolling 12 months.
- Canonical details: `backend/docs/integrations/ek/fitterhours_retention_model.md`.

## 4) Pagination/429/retry handling
- page/pageSize used in fetch.
- Primary stop/continue logic is count-based:
- continue only when fetched rows == pageSize
- stop when fetched rows == 0
- stop when fetched rows < pageSize
- nextPage is parsed from multiple envelope variants as secondary metadata.
- 429 handled with Retry-After aware retry and endpoint delay arrays.
- backlog queue used for partial failures and retry rounds.

## 8) Correction of previous over-strong statement
- Previous revision stated nextPage-driven progression as primary truth.
- That statement was too strong and has been corrected.
- Verified code truth now: count-based pagination drives progression.

## 5) Bootstrap vs delta
- Delta jobs auto-scheduled every DELTA_INTERVAL_MS (~10m) post bootstrap success.
- projects_v4 effectively full scanned to preserve closure truth.
- read-only non-delta endpoints run as slow_reconciliation.

## 6) Cron/periodic behavior
- Worker polls every 12s.
- scheduleDeltaJobs inserts delta jobs if cooldown and prerequisites pass.

## 7) Existing index baseline
- Core indexes exist on project_core/project_wip/project_masterdata_v4/fitter_hour and sync tables.
- Additional index gaps found for functional normalized joins and team_leader_code filtering.
