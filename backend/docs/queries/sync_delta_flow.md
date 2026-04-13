# Sync Delta Flow

Status: verified
Primary implementation: backend/src/services/syncWorker.js

## Delta Scheduling
- scheduleDeltaJobs inserts queued delta jobs per tenant when:
- endpoints enabled
- bootstrap success exists
- no active delta job exists
- last delta older than DELTA_INTERVAL_MS (10 min)

## Delta State Inputs
- sync_endpoint_state.updated_after_watermark
- sync_failure_backlog pending/deferred/retrying count

## Endpoint Delta Behavior
- projects_v4: forced full scan (updatedAfter disabled)
- projects_v3: can use updatedAfter when strict-delta conditions are met
- read endpoints with supportsDelta=false are run as slow_reconciliation mode

## Backlog Priority
- Each claimed job processes backlog retry rounds first.
- This prevents hidden restart behavior and improves partial-failure recovery.

## Idempotence
- project_core upsert by tenant_id + external_project_ref
- fitter_hour upsert by tenant_id + source_key
- fitter/fitter_category upsert by tenant_id + external id

## Stop Criteria
- Primary: fetched row count drives pagination.
- Continue only when row count == pageSize.
- Stop when row count == 0.
- Stop when row count < pageSize.

## Note
- Previous note about nextPage-primary progression was incorrect for this codebase.
- Current verified behavior is count-based page/pageSize progression.
- nextPage is retained only as secondary parsed/logged metadata.
