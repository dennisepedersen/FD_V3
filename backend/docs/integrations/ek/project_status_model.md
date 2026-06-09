# EK Project Status Model

Status: verified decision
Date: 2026-05-29
Evidence: read-only live EK analysis for tenant `hoyrup-clemmensen`

## Decision

Fielddesk uses E-Komplet project sources with separate truth roles:

- v4 LIST (`/api/v4.0/projects`) is primary project sync, lifecycle, and masterdata.
- v4 DETAIL (`/api/v4.0/projects/:id` or ref lookup) is enrichment for economy, activity, and WIP detail.
- v3 (`/api/v3.0/projects`) is fallback/enrichment only, not lifecycle.

`/Management/WorkInProgress` must not be used as an EK API path. It is treated as a documentation group/name, not a verified endpoint URL for FD sync.

## Status Model

```text
administrative_closed = v4 LIST IsClosed
financial_wip = v4 LIST IsWorkInProgress
planning_status = EndDate
activity_status = LastRegistration / LastFitterHourDate / ReadyToBill
operational_attention = detail-based signals
active_project_count = administrative_closed === false
```

Project internal/external state is a separate source field:

```text
project_internal = v4 LIST isIntern / v4 DETAIL IsInternal
```

`project_internal` must not override lifecycle. It is used for fitterhours retention/sync scope decisions, not active/open status.

## Rules

- `IsClosed` decides active/closed lifecycle.
- `IsWorkInProgress` is IGVA/economy/WIP, not active/closed status.
- `EndDate` is planning/end date, not a closed filter.
- v4 DETAIL activity/economy fields may raise attention, but must not override lifecycle.
- UI active project counts must use `administrative_closed === false`.
- Sync status should not be shown on the normal tenant dashboard or project overview.
- Sync operations status may remain available in global admin/portal drift views, admin/dev diagnostics, or logs.

## Live Data Evidence

Observed v4 LIST matrix, approximately 30,091 projects:

| IsClosed | IsWorkInProgress | Count |
|---|---:|---:|
| false | false | 37 |
| false | true | 1230 |
| true | false | 508 |
| true | true | 28316 |

This confirms that `IsWorkInProgress=true` cannot mean active/open, because most WIP=true projects are administratively closed.

## v3 Field Analysis

- v3 has no `IsClosed`.
- No v3-only fields were found in the live field inventory.
- v3 may still provide fallback/enrichment value, but it must not drive lifecycle.

## Known Control Cases

These references were used as domain-known controls:

| Reference | Expected FD lifecycle |
|---|---|
| 26794 | open/active |
| 80356 | open/active |
| 80491 | open/active |
| 36521 | closed |
| 36529 | closed |

The active cases matched v4 LIST `IsClosed=false`.

Additional verification on 2026-05-31 showed:

| Reference | EK ProjectID | IsClosed | IsWorkInProgress | isIntern |
|---|---:|---:|---:|---:|
| 26794 | 19687 | false | true | false |
| 80356 | 23922 | false | true | false |
| 80491 | 28860 | false | true | false |
| 36521 | 30511 | true | true | false |
| 36529 | 30519 | true | true | false |

## Implementation Implications

- Persist v4 LIST `IsClosed` to `project_core.is_closed` / administrative lifecycle.
- Persist `IsWorkInProgress` separately as financial WIP/IGVA signal.
- Persist v4 LIST `isIntern` separately as nullable `project_core.is_internal` / `project_masterdata_v4.is_internal` before implementing fitterhours retention rules based on internal/external project state.
- Keep legacy `status` fields only for compatibility and labels.
- Do not let v3 or detail activity fields reopen or close projects.
- Detail enrichment may support economy, forecast, activity, ready-to-bill, and operational attention.
- Fitterhours retention details are documented in `backend/docs/integrations/ek/fitterhours_retention_model.md`.
