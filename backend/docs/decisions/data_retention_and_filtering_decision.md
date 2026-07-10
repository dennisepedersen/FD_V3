# Decision: Data Retention and Filtering

Status: verified + observed
Date: 2026-04-11

## Projects
- Keep open has_v4 projects.
- Keep closed projects only for 6 months after closed_observed_at.
- Delete retention-eligible closed projects after v4 terminal pass and no backlog/retries.

## Fitterhours
- Current implemented behavior: synced fitterhours are 12-month scoped and should be described as synced FD rows, not guaranteed all EK hours.
- Verified target retention model:
  - `isClosed=false` and `isIntern=false` => `all_time_external_active`, no 12-month cutoff.
  - all other combinations => `rolling_12_months_internal_or_closed`, 12-month scope.
- The target model is not implemented yet because FD does not currently persist project-level `is_internal`.
- Project-targeted all-time reads should use `/api/v3.0/fitterhours?page=1&pageSize=1000&searchAttribute=ProjectID&search=<EK ProjectID>`.
- Details and evidence are in `backend/docs/integrations/ek/fitterhours_retention_model.md`.

## Bootstrap vs Delta
- Bootstrap: full run from page 1.
- Delta/reconcile: scheduled every 12 hours, backlog first.
- projects_v4 still full-scanned to maintain closure truth.

## Risk / Follow-up
- Persist project-level `is_internal` from v4 LIST before retention cutover.
- Add explicit API/UI hour scope metadata before displaying all-time vs rolling values.
- Rate-limit and resume project-targeted all-time fitterhour sync.
