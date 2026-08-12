# Approved Absence Calendar Feeds PR6

Status: implemented locally, not released

## Model Decision

PR6 uses Model B: a new `approved_absence` table as the authoritative calendar source for approved absence requests.

`resource_absences` is not reused for the new feeds because it is fitter-based legacy/direct absence data. It does not provide a safe `tenant_user` source, the approving request, current manager scope, PR6 visibility policy, or request duration rules. Existing `resource_absences` rows are therefore left untouched and are not guessed into `/api/calendar/events/*`.

## Data Source

`approved_absence` is tenant-owned and materialized from `absence_request` only when a manager approves a request.

PR6 creates only:

- `source_type = 'absence_request'`
- `status = 'active'`

The table stores only calendar-safe fields: employee user/fitter reference, request/type source ids, duration, date/time, timezone, visibility policy, approver, approval time, status and technical metadata. It does not copy employee comments, rejection reasons, notification payloads, email outbox data or audit metadata.

Backfill uses only already approved requests with a tenant-valid employee, absence type and assigned manager. `approved_by_tenant_user_id` comes from the assigned manager snapshot. `approved_at` uses `reviewed_at` when available and falls back to `updated_at`, then migration time, so historical rows without a review timestamp are explicit approximations rather than guessed approval times.

## Approve Flow

Approval remains one transaction:

1. Lock and validate the manager-owned request.
2. Update `absence_request` to `approved`.
3. Insert or reuse the idempotent `approved_absence` source.
4. Insert the absence request event.
5. Audit request approval and approved absence creation.
6. Queue internal notification and email outbox through the existing notification service.
7. Commit.

If materialization, event insert, audit, notification or outbox enqueue fails, the transaction rolls back. Reject does not create `approved_absence`.

## API Feeds

Personal feed:

- `GET /api/calendar/events/mine`
- Requires `calendar_event:read_own`.
- Granted by default to `tenant_admin`, `project_leader` and `technician`.
- Returns only the current tenant user's active approved absence events.
- Shows the user's own absence type.

Manager team feed:

- `GET /api/calendar/events/team`
- Requires an active primary `employee_manager_relation` from at least one employee to the requesting manager before the endpoint returns 200.
- Returned rows are additionally scoped by the active primary `employee_manager_relation` from the employee to the requesting manager in the repository query.
- No tenant-admin, project-leader, resource-group-manager or role-only fallback.
- `private` and `neutral_shared` entries use the neutral title `Ikke til stede`.
- `manager_visible` entries may show the absence type.

Both feeds require bounded `from` and `to` date filters, support `event_type=absence`, and paginate with `limit` and `offset`.

## Legacy Behavior

Existing `resource_absences` remain available through the old admin calendar absence endpoints. They are not shown in PR6 feeds because a safe mapping to current active `tenant_user` and manager-scope cannot be proven from the legacy model alone.

Future PRs may add an explicit, reviewed legacy import/mapping path if the product requires legacy absence in employee and manager feeds.

## Next PR

Recommended PR7 scope:

- special-window administration
- submission opening/deadline handling
- review/collective treatment workflow
- shared treatment overview

PR7 should not attempt a full calendar UI unless separately approved.
