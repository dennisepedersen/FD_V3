# EK Worksheets Project Access

Status: implemented policy, pending production migration/apply

## Purpose

Worksheets are the only E-Komplet source that can automatically grant a
technician project access. Fitterhours, calendar events, and resource groups
remain activity/planning/group data only.

## OpenAPI Endpoint Decision

| Data | Endpoint | Reason |
|---|---|---|
| Worksheet list/delta | `GET /api/v4/worksheets` | Supports `page`, `pagesize`, `fromDate`, `toDate`, `updatedAfter`, `searchAttribute`, `search`, `searchOperator`. Used by sync worker. |
| Worksheet detail | `GET /api/v4/worksheets/{id}` | Same container model for one worksheet. Useful for investigation or repair. |
| Worksheet search | `POST /api/v4/worksheets/search` | Supports structured filters and `updatedAfter`; reserved for targeted repair/search flows. |
| Calendar planning | `GET /api/v4/calendarevents` | May contain `fitters`, `worksheets`, `projectID`, `projectReference`, `worksheetStartDate`, but is planning data and must not grant access. |
| Deleted worksheets | none found | No OpenAPI deleted worksheet feed. Missing-source removal only runs after a complete successful full reconciliation. |

The worksheet response fields used for access are `id`, `projectID`,
`projectReference`, `responsibleFitterID`, `responsibleFitterName`,
`statusEnum`, `completedDate`, `closedDate`, `updatedDate`, and
`projectIsClosed`.

## Access Policy

Automatic worksheet access is materialized only when:

- the worksheet maps to exactly one Fielddesk project in the same tenant;
- the worksheet fitter maps to exactly one active `tenant_user`;
- the tenant user has `status = active` and `login_status = active`;
- the fitter is not a common/default/system fitter;
- the worksheet lifecycle is active or inside completion retention.

Active statuses: `NotStarted`, `InProgress`, `PartiallyCompleted`.

Completion retention: if `closedDate` exists, use it as the authoritative
completion time. Otherwise use `completedDate`. Keep the worksheet source for
30 calendar days after that timestamp, then remove only the worksheet source.

## Data Model

`project_assignment` remains effective access and is still what project scope
queries read.

`project_assignment_source` stores source rows. Supported sources:

- `manual`
- `worksheet`

Manual admin assignment creates a `manual` source. Worksheet sync creates a
`worksheet` source. Effective `project_assignment` is removed only when no
active source remains for the same tenant/project/user.

## Safety Rules

- Fitterhours never create or extend access.
- Calendar events never create or extend access.
- Resource groups never create or extend access.
- A fitter without an active Fielddesk login may appear in hours/activity, but
  cannot receive project access.
- Worksheet reassignment removes the old worksheet source immediately and
  creates the new source only if mapping is valid.
- Worksheet project moves remove the old project source immediately.
- A reopened worksheet clears the previous expiry by materializing an active
  worksheet source again.
- Interrupted or partial worksheet API sync cannot mass-remove access.

## Refresh Strategy

Normal sync uses `updatedAfter` for worksheet delta.

Periodic full reconciliation uses the same list endpoint without delta. Missing
worksheet sources are removed only after all pages complete successfully and no
pending/failed page backlog exists.
