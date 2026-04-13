# Decision: Sync Strategy

Status: verified decision
Date: 2026-04-11

## Decision
- Keep split strategy:
- delta_supported for projects_v4/projects_v3
- reconcile_scan for read endpoints (fitterhours, fitters, fittercategories, others)
- backlog_retry for partial failures

## Rules
- Process backlog retry before normal endpoint pass.
- Persist each successful page immediately.
- Keep per-endpoint state in sync_endpoint_state.
- Log every page attempt in sync_page_log.
- Primary pagination rule is count-based page/pageSize progression.
- Continue only when fetched rows == pageSize.
- Stop when fetched rows == 0 or fetched rows < pageSize.
- nextPage may be parsed/logged as secondary metadata, never primary control.

## 429 Policy
- Respect Retry-After when present.
- Use controlled per-endpoint retry delays.
- For fitter-related read endpoints, fallback page size from 50 to 25 on 429.
