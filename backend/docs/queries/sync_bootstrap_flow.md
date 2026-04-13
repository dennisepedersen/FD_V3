# Sync Bootstrap Flow

Status: verified
Primary implementation: backend/src/services/syncWorker.js

## Bootstrap Job Type
- bootstrap_initial (and legacy bootstrap)

## Endpoint Order
1. projects (internally projects_v4 then projects_v3 enrichment)
2. fittercategories (if selected/required)
3. other read endpoints
4. fitterhours last

## Per-page Flow
- fetch page
- map/normalize rows
- persist page immediately (when materialized table exists)
- append sync_page_log
- update sync_endpoint_state progress
- continue with page+1 only when fetched row count equals pageSize

## Primary Paging Rule (verified)
- Request explicit page and pageSize.
- Count rows in response.
- If row count == pageSize: continue with next numeric page.
- If row count == 0: stop.
- If row count < pageSize: stop.
- nextPage is parsed and logged as secondary remote metadata only.

## Failure Flow
- Page failure writes sync_page_log failed row.
- Failure queued into sync_failure_backlog with locator_type=page.
- Job continues to next page (partial success model).
- Backlog retry runs before normal processing in later jobs.

## 429 Handling
- fetchJsonWithRetry honors Retry-After header when present.
- Uses endpoint-specific delay arrays for 429 retries.
- For fitter-related read endpoints, pageSize falls back from 50 to 25 on 429.

## Bootstrap vs Delta
- Bootstrap starts from page 1.
- Projects v4 forced full scan even in delta mode to maintain close/open truth and cleanup eligibility.
