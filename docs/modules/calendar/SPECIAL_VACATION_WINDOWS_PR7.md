# PR7 - Saerlige Ferieonskeperioder

Status: PR7 implemented locally; not committed, pushed, deployed, or migrated in production.
Scope: backend administration of special vacation request windows and collective-review overview.

## Implemented

- `GET /api/calendar/special-windows`
- `POST /api/calendar/special-windows`
- `GET /api/calendar/special-windows/:id`
- `PATCH /api/calendar/special-windows/:id`
- `POST /api/calendar/special-windows/:id/archive`
- `GET /api/calendar/special-windows/:id/review-overview`

All routes require tenant host, access token, and tenant/auth context match. Admin create/update/archive/list/detail uses `absence_special_window:manage`. Review overview accepts either `absence_special_window:manage` or explicit `absence_special_window:review`.

## Data Model

PR7 reuses the PR2 tables:

- `absence_special_window`
- `absence_special_window_scope`
- `absence_request.special_window_id`

PR7 adds only `absence_special_window.version` for optimistic locking. No parallel scope table is introduced. Tenant-wide scope is represented by `absence_special_window_scope.scope_type = 'tenant'` with null resource/user columns.

## Scope Semantics

Supported scope rows:

- `tenant`: whole tenant, optionally filtered by absence type.
- `tenant_user`: one active tenant user, optionally filtered by absence type.
- `resource_group`: one active resource group, optionally filtered by absence type.

Resource-group matching is resolved through tenant-scoped `resource_group_members` plus `fitter.tenant_user_id`. Resource group membership can identify who is in the window scope; it does not grant approval rights and does not expose private comments.

Absence types used in scopes must be active and `special_window_eligible = true`. If no absence-type scope rows are selected, the window applies to all active request types where `special_window_eligible = true`.

## Derived Status

Persisted window status remains `is_active` plus dates. The API derives:

- `draft`: required date fields are incomplete.
- `scheduled`: today is before `submission_open_date`.
- `open`: today is between `submission_open_date` and `submission_deadline`, inclusive.
- `closed_waiting_review`: deadline has passed, but `review_start_date` has not arrived.
- `review_open`: review date has arrived and the absence period has not ended.
- `ended`: absence period has ended.
- `archived`: `is_active = false`.

## Create Key Behavior

The admin UI does not require a manual `key` on create. If `key` is omitted, the backend generates a deterministic tenant-unique slug from `name`; existing windows keep their stored key, and renaming a window does not regenerate it.

## Submit Enforcement

When an employee submits a draft that matches one unambiguous active special window:

- Before `submission_open_date`: submit is blocked with `absence_special_window_not_open`.
- On or before `submission_deadline`: submit proceeds normally.
- After deadline with `late_submission_policy = 'blocked'`: submit is blocked with `absence_special_window_deadline_passed`.
- After deadline with `manual_review` or `allowed`: submit proceeds and is marked late in event/audit metadata.

Late submit writes `absence_request.late_submitted` audit metadata. It does not automatically approve, reject, prioritize, or change project/resource access.

## Review Overview

The review overview returns requests linked to one special window with:

- employee summary
- absence type and date/time range
- request status and version
- assigned manager summary
- late-submission flag
- resource-group labels
- simple overlap signals between visible requests

`employee_comment` is included only when the actor also has `absence_request:read_private_comment`. Tenant admin role alone still does not grant that permission.

## Notifications

Special-window submit uses dedicated outbox/template keys:

- `absence_request.submitted_special_window.employee`
- `absence_request.submitted_special_window.manager`

Variables are limited to safe workflow data: employee name, manager name, absence period, special window name, submission deadline, review start date, receipt text, action URL, and tenant name. Employee comments are not included.

## Explicit Non-Goals

PR7 does not implement frontend UI, drag/drop calendar, automatic approve/reject, alternative periods, notification inbox UI, outbox apply, real mail sending, EK sync, worksheet sync, resource planning, production migration, Render config, push, merge, or deploy.

## Validation

Relevant checks added or updated:

- `test/specialWindowAdmin.test.js`
- `test/absenceRequestEmployeeBackend.test.js`
- `test/absenceRequestFoundation.test.js`
- `test/notificationOutboxFoundation.test.js`

Full release validation must still run before any commit/release.