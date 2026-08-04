# Resource, Absence And Calendar Architecture PR1

Status: decided direction for PR1, no implementation
Scope: absence requests, approved absence, special vacation windows, manager relation, calendar read-model, permissions, audit, notifications, outbox, and future resource planning
Baseline: `b861627de3764f93b4df425fbb20d5d40dc927dc`

This document is an architecture and documentation foundation only. It does not
approve migrations, API routes, UI code, sync jobs, mail sending, Render changes,
or production data changes.

## Evidence Summary

verified: `resource_absences` exists from
`migrations/0027_resource_absence_foundation.sql`. It is tenant-owned
Fielddesk data, references `(tenant_id, fitter_id)`, stores direct absence
records, and supports statuses `draft`, `requested`, `approved`, `rejected`,
and `cancelled`.

verified: `backend/src/modules/calendar/calendar.routes.js` exposes
`GET /api/calendar/absences`, `POST /api/calendar/absences`, and
`GET /api/calendar/resources`. All routes require tenant host, access token, and
tenant/auth context match.

verified: `resourceAbsence.service.js` creates new absence records with
`status = "approved"` server-side. The current API is direct registration, not a
request/approval workflow.

verified: `resource_groups`, `resource_group_members`, and
`resource_group_managers` exist from
`migrations/0028_resource_group_foundation.sql`. They are tenant-owned and
currently reference `fitter` for members and `tenant_user` for managers.

verified: `docs/modules/calendar/CALENDAR_RESOURCE_ABSENCE_MVP.md` states that
resource group manager roles are scope/administration metadata only and do not
grant absence approval rights.

verified: `migrations/0035_tenant_admin_people_resource_sync.sql` adds
`fitter.tenant_user_id`, source metadata on `fitter` and resource groups, and
EK/manual source fields. `fitter` remains the current imported/resource identity,
not a neutral permanent employee model.

verified: `tenant_user` is the tenant login/actor table. It has tenant-scoped
identity, role, lifecycle status, login status, and session version.

verified: `moduleAccessService.js` currently has simple role-to-module
permissions. `calendar_absence` supports only `read` and `create`, and only
`tenant_admin` has those permissions.

verified: `auditService.js` uses an allowlist of event types. New absence
request, approval, calendar, notification, and outbox audit events require a
future allowlist/schema/code change.

verified: `mailService.js` sends mail directly through the configured provider.
There is no general notification outbox or email outbox foundation yet.

verified: QA docs separate global workflow status from per-user read state.
That pattern should be reused: absence request status, approved absence,
calendar feed state, notification state, and personal inbox state are separate.

verified: E-Komplet project docs treat project `EndDate` as planning/end date,
not lifecycle. Project lifecycle is driven by v4 `IsClosed`.

verified: worksheet-backed project access docs state that fitterhours, calendar
events, and resource groups must never grant project access.

## Decisions

1. Absence request and calendar event are separate concepts.
2. Absence reason and duration are separate concepts.
3. Approved absence must not be created until a valid approval, direct
   registration rule, or administrative rule has run.
4. Calendar is primarily a combined read-model/feed, not the owner of every
   timed thing it displays.
5. Special vacation request windows are tenant-configurable and never
   hardcoded.
6. Special vacation windows are not first-come-first-served.
7. Approval before a special window review date is blocked by default.
8. Private employee comments require explicit permission and must not appear in
   broad calendars by default.
9. Tenant admin is not automatically an HR/private-comment reader.
10. Project responsible, project team leader, resource group manager, and
    tenant admin are not automatically personnel approvers.
11. A Fielddesk-owned employee-manager relation is required.
12. `fitter` may be used as a transitional resource link, but must not become
    the permanent neutral employee identity by accident.
13. Mail and internal notifications are created through outbox records; mail
    provider failure must not roll back a saved request.
14. Existing `resource_absences` is a legacy/direct-absence table for now. It
    should be adapted, migrated, or superseded only through a later approved PR.
15. All status transitions are validated in backend service logic and are
    tenant- and object-scoped.
16. Fielddesk supports operational absence and planning. It is not a payroll or
    legal HR master system.

## Domain Boundaries

### Absence Request

An absence request is an employee wish or administrative workflow item. It can
be draft, submitted, waiting for a special window, ready for review, under
review, approved, rejected, change-proposed, or cancelled. It is not itself proof
that the employee is unavailable.

The request owns:

- requested reason and duration
- employee comment
- status and version
- special window relation
- proposal/response history
- manager/admin review metadata
- request event history

### Approved Absence

Approved absence is confirmed operational unavailability. It is created only by
an approved request, a configured direct-registration workflow, or an audited
administrative override.

Approved absence owns:

- factual availability impact
- employee/resource relation
- date/time span
- visibility classification
- cancellation/replacement relation
- audit trail for lifecycle changes

The current `resource_absences` table can represent simple approved/direct
absence in the short term, but it is not sufficient as the full request
workflow.

### Calendar

The calendar is a viewing and filtering surface across source domains. It may
materialize normalized event rows for performance or external integration, but
source domains remain authoritative.

Calendar sources can include:

- approved absence
- project periods
- Fielddesk planning periods
- project staffing periods
- milestones
- courses/internal activities
- holidays
- QA deadlines or other later module deadlines

Calendar records must carry `source_type`, source id, tenant scope, visibility,
and enough source metadata to rebuild or invalidate the feed.

### Resources

Resource planning may later include employees, availability, approved absence,
project assignments, skills, certificates, capacity, vehicles, and equipment.
PR1 only reserves the architecture. It does not implement capacity planning.

## Existing Code Findings

### Reusable Components

- Tenant-host and access-token route pattern in calendar/resource group routes.
- Server-derived tenant and actor context checks.
- Tenant-aware SQL joins on `(tenant_id, id)` or `(tenant_id, fitter_id)`.
- Resource group tables as Fielddesk-owned grouping/scope data.
- `tenant_user` lifecycle and session-version model for login-capable actors.
- `fitter.tenant_user_id` as a transitional bridge from imported fitters to
  login users.
- QA participant/read-state pattern as an example of separating global workflow
  state from personal state.
- `auditService.logAuditEvent` transaction-friendly shape.
- `mailService.sendEmail` provider abstraction as the future low-level sender.
- Tenant UI panels, tabs, modals, drawers, and calendar form/list patterns in
  `backend/src/public/tenant/app.html`.

### Components To Phase Out Or Adapt

- `resource_absences.absence_type` enum is hardcoded and should become
  tenant-configurable `absence_types`.
- `resource_absences.note` allows 1000 frontend characters in current UI; new
  employee private comment policy is 250 characters by default.
- Current direct `POST /api/calendar/absences` creates approved absence and is
  not an employee request workflow.
- `visibility_scope` is a useful seed, but it is not a complete visibility/RBAC
  policy.
- `resource_group_managers.manager_role` must remain group metadata unless a
  future explicit approval capability maps it into manager scope.
- Direct mail send should become a worker behind an email outbox for workflow
  notifications.

### Legacy Risks

- Treating `fitter` as permanent employee identity would couple Fielddesk HR and
  planning to E-Komplet.
- Treating resource group manager as personnel approver would bypass verified
  manager relations.
- Treating tenant admin as broad HR reader would expose private comments beyond
  technical administration.
- Extending `resource_absences` directly for every request state would blur the
  difference between wishes, approvals, and calendar feed.
- Calendar rows that copy EK project data without source ownership rules could
  create uncontrolled project-data forks.

## Absence Types

Absence reason and duration are separate. Absence types should be tenant-owned
configuration with optional global defaults copied or referenced per tenant.

Recommended standard reasons:

- vacation
- vacation_free
- time_off_in_lieu
- leave
- care_day
- child_first_sick_day
- course_training
- doctor_dentist
- private_appointment
- other

Recommended properties:

- stable internal key
- display name
- active/archived status
- requires approval
- employee can create
- manager/admin can register directly
- allowed duration types
- comment policy: optional, required, disallowed
- visibility policy
- can be included in special vacation windows
- workflow mode
- visual category/color
- sort order
- created/updated audit fields

Workflow modes should support at least:

- request workflow
- notification workflow
- direct registration
- administrative registration

Sickness must not automatically follow vacation approve/reject semantics.

## Duration And Time Storage

Supported future duration types:

- full_days
- half_day_morning
- half_day_afternoon
- timed

Storage recommendation:

- Store date-only values as PostgreSQL `date` for whole-day and partial-day
  absence dates.
- Store local times as `time without time zone` for factual local start/end
  clock times.
- Store event/action timestamps as `timestamptz`.
- Store `timezone` on requests and approved absence, defaulting from tenant
  configuration when implemented.
- Store full-day ranges as inclusive `start_date` and `end_date`.
- Store half-day absence as a date plus duration type, not guessed hours.
- Store precise timed absence as `date`, `start_time`, `end_time`, and
  `timezone`.

Fielddesk must not infer normal working time unless a work schedule exists. A
request for Wednesday 07:00-10:00 is stored and displayed as that factual time
span, not automatically interpreted as late arrival or early departure.

## Employee Comment

Employee comment is optional by default, max 250 characters, and treated as
potentially private information. It must not be displayed in broad team calendar
or shared calendar feeds by default.

The `other` absence type should be configurable to require a comment. PR1
recommendation: default `other` to optional comment for first implementation,
but allow tenant configuration to require it before rollout to tenants that need
that policy.

## Special Vacation Request Windows

Special windows are tenant-configurable. Examples: week 7/8, Easter, industry
holiday, summer holiday, autumn holiday, Christmas/new year.

Recommended fields:

- name
- description
- vacation period start/end dates
- request open date
- submission deadline
- earliest review date
- batch review enabled
- approval before review date blocked
- late submission policy
- receipt text
- scope
- relevant absence type ids
- active/archived status
- tenant id
- audit fields

Default principle: not first-come-first-served. The receipt must state that the
request is received, not approved, that requests are reviewed together, that
submission time does not give priority, the deadline, and expected review start.

Default rule: approval is technically blocked before `review_start_date`.
A later separate permission may allow exception approval before the review date,
but only with required reason and audit.

### Partial Overlap Rules

Recommended v1 rules:

- Completely inside one active special window: accept as submitted or
  awaiting-window-close, depending on dates.
- Partly inside one window: require the employee to split the request, unless an
  admin chooses manual handling.
- Touches multiple windows: require split requests.
- Before request window opens: block with explanation.
- After submission deadline: allow only if the window permits late submission;
  otherwise block or route to administrative handling.
- After review has started: allow only if the window permits late submission,
  and mark as late.
- Overlapping special windows: block creation/activation of overlapping windows
  for the same scope/type unless an admin records a special override. The first
  implementation should avoid overlapping active windows.

## Manager Relation

Fielddesk needs a neutral personnel manager relation. These must not
automatically approve absence:

- project responsible
- project team leader
- EK project responsible
- resource group manager
- tenant admin
- generic leader role

Recommended direction:

- Introduce a neutral employee/resource model in a later PR.
- Link the neutral employee to `tenant_user` when the person can log in.
- Link the neutral employee to `fitter` only as an integration/source relation.
- Store manager relations against the neutral employee or employee membership,
  not directly against EK-only `fitter`.

Recommended `employee_manager_relations` semantics:

- tenant id
- employee id or membership id
- manager employee/user id
- relation type: primary, secondary, delegate
- valid from/to
- organizational scope or team scope
- temporary delegate marker
- created/updated audit fields
- archived/replaced history, never silent overwrite

When no manager exists, submit should either fail with a clear message or route
to an admin/HR queue, depending on tenant configuration. If the manager is
absent, delegate/escalation rules must be explicit and auditable.

## Workflow And Status Model

Recommended persisted request statuses:

- `draft`
- `submitted`
- `ready_for_review`
- `under_review`
- `approved`
- `rejected`
- `change_proposed`
- `cancelled`

Recommendation: do not persist `awaiting_window_close` as a primary status in
v1. Derive it from `submitted`, linked special window, deadline, and review
date. Use a read-model field for UI labels.

Recommendation: `under_review` is optional in first implementation. Persist it
only if a manager/admin claim/locking feature is implemented. Otherwise move
from `ready_for_review` directly to approved/rejected/change_proposed.

Valid transitions:

| From | To | Actor |
| --- | --- | --- |
| none | draft | employee, admin |
| draft | submitted | employee, admin |
| submitted | ready_for_review | system, admin |
| ready_for_review | under_review | manager, admin |
| ready_for_review | approved | manager, admin |
| ready_for_review | rejected | manager, admin |
| ready_for_review | change_proposed | manager, admin |
| under_review | approved | claiming manager, admin |
| under_review | rejected | claiming manager, admin |
| under_review | change_proposed | claiming manager, admin |
| change_proposed | submitted | employee |
| change_proposed | cancelled | employee, admin |
| draft | cancelled | employee, admin |
| submitted | cancelled | employee before review, admin |
| ready_for_review | cancelled | admin, or employee if policy allows |

Invalid transitions include:

- approved to draft/submitted
- rejected to approved without a new review action
- cancelled to approved
- direct employee edit of approved absence
- manager approval before special-window review date without override permission

All writes should use optimistic locking with a `version` integer. The API must
require the expected version for mutating request actions. Double approval is
prevented by transaction, version check, and current status predicate in the
update.

UI labels must be Danish and must not expose raw database values.

## Change After Approval

An employee may not directly edit approved absence. Later workflow:

- employee creates change or cancellation request
- manager/admin reviews
- approved change creates replacement approved absence or updates through an
  auditable versioned mechanism
- cancellation marks approved absence cancelled and preserves history
- administrative override requires permission, reason, and audit
- employee receives internal notification and optional mail

Original request and original approved absence must remain auditable.

## Data Model Recommendation

No migration is created in PR1. This is the future model direction.

### `absence_types`

Purpose: tenant-configurable absence reason catalog.
Tenant scope: required `tenant_id`; optional global defaults may be copied per
tenant later.
Fields: id, tenant_id, key, display_name, status, requires_approval,
employee_can_create, manager_can_register_directly, allowed_duration_types,
comment_policy, visibility_policy, include_in_special_windows, workflow_mode,
color_key, sort_order, created_at, updated_at.
Constraints: unique `(tenant_id, key)`, nonblank display name, status/workflow
checks, JSON/object checks if arrays are stored in jsonb.
Indexes: `(tenant_id, status, sort_order)`, `(tenant_id, key)`.
Retention: archive, not hard delete when used.
Persondata: low, except visibility policy can affect private display.

### `absence_requests`

Purpose: employee/admin absence request workflow.
Tenant scope: required `tenant_id`.
Fields: id, tenant_id, employee_user_id, employee_membership_id,
absence_type_id, duration_type, start_date, end_date, start_time, end_time,
timezone, employee_comment, status, manager_user_id, special_window_id,
submitted_at, reviewed_at, calendar_event_id, approved_absence_id, version,
created_at, updated_at.
Constraints: composite tenant FKs, status/duration checks, date range check,
time range check for timed requests, employee_comment length <= 250.
Indexes: `(tenant_id, employee_user_id, created_at desc)`,
`(tenant_id, status, submitted_at)`, `(tenant_id, manager_user_id, status)`,
`(tenant_id, special_window_id, status)`, date range index matching calendar
queries.
Retention: retain history while operationally needed; later tenant retention
policy should define anonymization/archive.
Persondata: high; includes private comments and absence reason.

Specific status dates should be duplicated on the request only for common
query/sort needs, such as `submitted_at` and `reviewed_at`. Full lifecycle
history belongs in events.

### `absence_request_events`

Purpose: append-only request history.
Fields: id, tenant_id, request_id, event_type, from_status, to_status,
actor_user_id, actor_scope, reason, metadata, occurred_at.
Constraints: composite FK `(request_id, tenant_id)`, metadata object,
append-only trigger.
Indexes: `(tenant_id, request_id, occurred_at)`, `(tenant_id, event_type,
occurred_at desc)`.
Persondata: may contain reasons; reason visibility must follow permission.

### `absence_request_proposals`

Purpose: manager alternative-period proposals.
Fields: id, tenant_id, request_id, proposed_start_date, proposed_end_date,
proposed_start_time, proposed_end_time, proposed_duration_type,
manager_comment, status, proposed_by_user_id, responded_by_user_id,
responded_at, version, created_at, updated_at.
Constraints: tenant FKs, date/time checks, proposal status check.
Indexes: `(tenant_id, request_id, created_at desc)`, `(tenant_id, status)`.

### `absence_special_windows`

Purpose: tenant-defined batch review windows.
Fields: id, tenant_id, name, description, period_start_date, period_end_date,
request_open_date, submission_deadline, review_start_date, batch_review,
block_approval_before_review, allow_late_submission, receipt_text, status,
created_by_user_id, updated_by_user_id, created_at, updated_at.
Constraints: date ordering, nonblank name, status check.
Indexes: `(tenant_id, status, period_start_date, period_end_date)`,
`(tenant_id, request_open_date, submission_deadline)`.
Archive: archive, not delete when referenced.

### `absence_special_window_scopes`

Purpose: define which employees/groups/types a special window applies to.
Fields: id, tenant_id, special_window_id, scope_type, scope_id,
absence_type_id, created_at.
Constraints: tenant FK to window and type, scope type check, unique active
scope/type row.
Indexes: `(tenant_id, special_window_id)`, `(tenant_id, scope_type, scope_id)`.

### `employee_manager_relations`

Purpose: Fielddesk-owned personnel approval relation.
Fields: id, tenant_id, employee_id or employee_membership_id,
manager_employee_id, manager_user_id, relation_type, valid_from, valid_to,
scope_type, scope_id, is_delegate, created_by_user_id, updated_by_user_id,
created_at, updated_at.
Constraints: no self-manager unless explicit exception is approved, valid date
range, relation type check, tenant composite FKs.
Indexes: `(tenant_id, employee_id, relation_type, valid_from, valid_to)`,
`(tenant_id, manager_user_id, valid_from, valid_to)`.

### `calendar_events`

Purpose: optional materialized calendar feed rows.
Fields: id, tenant_id, source_type, source_id, title, starts_at, ends_at,
start_date, end_date, timezone, all_day, visibility_scope, owner_user_id,
resource_id, project_id, status, metadata, source_version, created_at,
updated_at.
Constraints: source uniqueness `(tenant_id, source_type, source_id)`, tenant
composite FKs where source tables support it, metadata object.
Indexes: `(tenant_id, start_date, end_date)`, `(tenant_id, owner_user_id,
start_date)`, `(tenant_id, project_id, start_date)`, `(tenant_id, source_type,
source_id)`.
Data owner: calendar owns only materialized feed rows, not source domain truth.

### `internal_notifications`

Purpose: in-app notification records.
Fields: id, tenant_id, recipient_user_id, event_key, source_type, source_id,
title, body, action_url, status, read_at, created_at.
Constraints: tenant FK to recipient, event key check/reference, source metadata.
Indexes: `(tenant_id, recipient_user_id, status, created_at desc)`.
Retention: tenant policy; old read notifications may be archived.

### `notification_outbox`

Purpose: transactional queue for internal notification materialization when
separate from immediate records.
Fields: id, tenant_id, event_key, aggregate_type, aggregate_id,
idempotency_key, payload, status, attempts, next_attempt_at, last_error,
created_at, processed_at.
Constraints: unique `(tenant_id, idempotency_key)`, payload object, status
check.
Indexes: `(status, next_attempt_at)`, `(tenant_id, aggregate_type,
aggregate_id)`.

### `email_templates`

Purpose: global system templates and optional tenant overrides.
Fields: id, tenant_id nullable for global, template_key, locale, version,
subject_template, html_template, text_template, status, created_at, updated_at.
Constraints: unique active template per tenant/global key/locale/version
policy, nonblank subject/text.
Persondata: templates must not contain real personal data.

### `email_outbox`

Purpose: durable outbound mail queue.
Fields: id, tenant_id, template_key, template_version, recipient_user_id,
recipient_email, locale, payload, idempotency_key, status, attempts,
next_attempt_at, last_error, provider, provider_message_id, created_at,
sent_at.
Constraints: unique `(tenant_id, idempotency_key)`, payload object, status
check, recipient email nonblank.
Indexes: `(status, next_attempt_at)`, `(tenant_id, recipient_user_id,
created_at desc)`.
Mail errors must move the row to retry/dead-letter state, not roll back the
absence request transaction.

## Calendar Architecture

Recommendation: hybrid leaning to Model B.

Model B is the source-of-truth rule: domain tables own their data and calendar
APIs combine approved domain rows into a feed. Model A is allowed only as a
materialized read-model for performance, external calendar export, or expensive
derived feeds.

Reasons:

- avoids duplicate domain truth
- keeps tenant/object authorization close to source data
- supports source-specific retention and audit
- allows project, absence, milestones, and planning to evolve independently
- reduces risk of stale copies of EK data
- can still support iCal/Microsoft 365 by emitting normalized feed rows later

Calendar feed rows must always identify their source and authorization policy.
Deleting or changing a source event must update/invalidate the calendar row
inside a controlled transaction or deterministic rebuild job.

## Projects In Calendar

Project calendar data must distinguish:

- administrative project period
- contract period
- expected start/end
- real installation/montage period
- staffing period
- milestones

Data ownership:

- EK-owned data stays imported/enriched source data and should be read from
  project tables or a controlled projection.
- Fielddesk-owned planning data needs separate planning tables.
- Local overrides must be explicit, tenant-scoped, and auditable.
- Conflicts should be shown as conflicts, not silently merged.

No uncontrolled copies of E-Komplet project rows should be created by calendar
features.

## Permission Catalog

Permission names are proposed. Implementation must integrate with
`moduleAccessService.js` or its future replacement and enforce object scope in
service/repository code.

### Employee

- `absence_request:create:self`
- `absence_request:read:self`
- `absence_request:update_draft:self`
- `absence_request:submit:self`
- `absence_request:cancel_unreviewed:self`
- `absence_request:history:self`
- `absence_request:change_request:self`
- `absence_request:proposal_accept:self`
- `absence_request:proposal_reject:self`
- `calendar:read:self`

### Manager

- `absence_request:read:managed`
- `absence_request:read_reason:managed`
- `absence_request:read_private_comment:managed`
- `absence_request:approve:managed`
- `absence_request:reject:managed`
- `absence_request:proposal_create:managed`
- `absence_approved:read_team`
- `absence_special_window:read_managed`
- `calendar:read:team`

### Administration

- `absence_type:manage`
- `absence_special_window:manage`
- `absence_special_window_scope:manage`
- `employee_manager_relation:manage`
- `absence_request:override`
- `absence_request:approve_before_window_review`
- `absence_request:audit_read`
- `notification_template:manage`

Private comment read must be separate from technical tenant administration.
Tenant-admin role alone must not grant private-comment access unless a concrete
permission is present.

## Security Requirements

API must enforce:

- tenant derived from resolved tenant host/context
- actor derived from access token
- employee identity derived server-side from tenant user/resource mapping
- manager identity derived from Fielddesk manager relation
- no trust in client-supplied tenant, role, employee id, manager id, or scope
- object-level authorization for every request/action
- private-comment permission
- idempotency and version checks for mutations
- generic errors where detailed response could aid enumeration
- signed/short-lived action links if email actions are introduced

Service layer must enforce:

- status transition rules
- special-window restrictions
- manager scope
- no direct edit of approved absence by employee
- transaction boundaries and outbox insertion
- audit event creation

Repository/query layer must enforce:

- every tenant-owned query filters by `tenant_id`
- cross-tenant joins join on tenant id and entity id
- list queries match indexes by tenant, status/date, actor/object scope
- no fallback tenant/user/project allow

Database should later enforce:

- tenant composite FKs
- check constraints for status/duration/workflow enums
- unique idempotency keys
- append-only event tables
- RLS as defense-in-depth when the RLS design is approved

Exports and broad calendar feeds must treat private comments and sensitive
reasons as restricted data.

## Mail, Internal Notifications And Outbox

Recommended event example: `absence_request_submitted`.

One domain action can create:

- `absence_request_events`
- `audit_event`
- internal notification rows or notification outbox rows
- email outbox rows

Template keys:

- `absence_request_received_employee`
- `absence_request_received_employee_special_window`
- `absence_request_received_manager`
- `absence_request_received_manager_special_window`
- `absence_request_ready_for_review`
- `absence_request_approved`
- `absence_request_rejected`
- `absence_request_change_proposed`
- `absence_request_cancelled`

Placeholders:

- `employee_name`
- `manager_name`
- `absence_type`
- `start_date`
- `end_date`
- `start_time`
- `end_time`
- `employee_comment`
- `manager_comment`
- `special_window_name`
- `submission_deadline`
- `review_start_date`
- `action_url`
- `tenant_name`

Templates should support HTML, plain text, locale, version, global system
template, tenant override, idempotency, retry, dead letter, and provider
metadata.

Mail send happens after commit through a worker. Provider failure updates
outbox status and may notify admins later; it does not undo the request.

## Transaction Boundary

Recommended submit transaction:

1. Validate input, actor, object scope, status, version, and special window.
2. Create or update `absence_requests`.
3. Create `absence_request_events`.
4. Create `audit_event`.
5. Create internal notification records or outbox records.
6. Create email outbox records.
7. Commit.
8. Send asynchronously.

Use idempotency keys for create/submit/actions. Double-clicks should return the
same result or a safe conflict. Race conditions are handled with row locks or
`WHERE version = $expectedVersion AND status = $expectedStatus`.

## API Design

Endpoints are proposed only.

### Employee

| Endpoint | Actor | Permission | Notes |
| --- | --- | --- | --- |
| `GET /api/absence-requests/mine` | employee | `absence_request:read:self` | tenant/user derived; filters by actor |
| `POST /api/absence-requests` | employee | `absence_request:create:self` | idempotency key |
| `PATCH /api/absence-requests/:id` | employee | `absence_request:update_draft:self` | expected version |
| `POST /api/absence-requests/:id/submit` | employee | `absence_request:submit:self` | audit/outbox |
| `GET /api/absence-requests/:id` | employee | self or scoped manager/admin | object scope |
| `POST /api/absence-requests/:id/cancel` | employee | `absence_request:cancel_unreviewed:self` | reason optional by policy |
| `POST /api/absence-requests/:id/change-requests` | employee | `absence_request:change_request:self` | after approval |
| `POST /api/absence-requests/:id/proposals/:proposalId/accept` | employee | `absence_request:proposal_accept:self` | version check |
| `POST /api/absence-requests/:id/proposals/:proposalId/reject` | employee | `absence_request:proposal_reject:self` | version check |

### Manager

| Endpoint | Actor | Permission | Notes |
| --- | --- | --- | --- |
| `GET /api/manager/absence-requests/pending` | manager | `absence_request:read:managed` | manager scope derived |
| `GET /api/manager/absence-requests/special-windows/:windowId` | manager | `absence_special_window:read_managed` | scoped list |
| `GET /api/manager/absence-requests/:id` | manager | `absence_request:read:managed` | private fields conditional |
| `POST /api/manager/absence-requests/:id/approve` | manager | `absence_request:approve:managed` | expected version |
| `POST /api/manager/absence-requests/:id/reject` | manager | `absence_request:reject:managed` | reason required |
| `POST /api/manager/absence-requests/:id/proposals` | manager | `absence_request:proposal_create:managed` | original request unchanged |
| `GET /api/manager/absence-requests/:id/overlap` | manager | `calendar:read:team` | no private leakage |

### Administration

| Endpoint | Actor | Permission | Notes |
| --- | --- | --- | --- |
| `/api/admin/absence-types` | admin | `absence_type:manage` | CRUD/archive |
| `/api/admin/absence-special-windows` | admin | `absence_special_window:manage` | CRUD/archive |
| `/api/admin/absence-special-windows/:id/scopes` | admin | `absence_special_window_scope:manage` | tenant-scoped |
| `/api/admin/employee-manager-relations` | admin | `employee_manager_relation:manage` | valid-from/to history |
| `POST /api/admin/absence-requests/:id/override` | admin | `absence_request:override` | reason and audit required |

### Calendar

| Endpoint | Actor | Permission | Notes |
| --- | --- | --- | --- |
| `GET /api/calendar/mine` | employee | `calendar:read:self` | masked by actor |
| `GET /api/calendar/team` | manager | `calendar:read:team` | manager scope |
| `GET /api/calendar/feed` | scoped actors | feed-specific | combined filters |
| `GET /api/calendar/filters` | scoped actors | feed-specific | allowed source filters |

All mutating endpoints require audit. Create/submit/action endpoints require
idempotency where repeated requests are likely. Version/locking is required for
status-changing actions. Expected status codes include 200, 201, 400, 401, 403,
404, 409, 422, and 500.

## UI Direction

No frontend code is implemented in PR1.

Employee information architecture:

- Min kalender
- Anmod om fravær
- Mine anmodninger
- Afventer
- Godkendt
- Afvist
- Historik

Manager information architecture:

- Afventer behandling
- Afventer fælles behandling
- Klar til behandling
- Teamkalender
- Overlap
- Særlige ferieperioder

Administration:

- Fraværstyper
- Ferieønskeperioder
- Lederrelationer
- Permissions

Form behavior:

- Whole days show start date and end date.
- Timed absence shows date, from, and to.
- If the date hits a special window, show explanation, deadline, review date,
  and the not-first-come-first-served principle.
- Employee comment is optional by default and capped at 250 characters.

## Boundary Against HR And Payroll

Fielddesk supports operations and availability. First versions must not:

- calculate vacation accrual
- calculate payroll
- calculate overtime
- handle pension
- generate payslips
- calculate sick-pay reimbursement
- become legal HR master

Hourly absence may be stored factually. Payroll interpretation needs a later
decision and integration.

## Future Capacity Planning

These PR1 choices preserve room for:

- employee capacity
- project staffing
- skills and certificates
- minimum staffing
- conflict views
- first and second vacation choices
- flexible dates
- team capacity
- calendar sharing
- iCal and Microsoft 365
- edge status and day overview
- vehicles and equipment later

Future capacity data should use Fielddesk-owned planning tables and explicit
relations, not fitterhours, calendar events, or resource groups as implicit
availability truth.

## Open Questions With Recommendations

| Question | Recommendation |
| --- | --- |
| Should `other` require comment? | Make it tenant-configurable; default optional until tenant policy is known. |
| Should late submissions be allowed? | Configure per special window; default false for shared vacation windows. |
| Can one special window cover multiple scopes? | Yes, through `absence_special_window_scopes`; avoid overlapping active scope/type windows in v1. |
| Should private reasons be hidden from secondary managers? | Yes by default; grant through explicit relation/permission. |
| Can employees edit submitted but unreviewed requests? | Prefer cancel-and-resubmit in v1, or allow edit only before review with version/audit. |
| Are alternative periods v1? | Later PR; design table now, implement after core approval flow. |
| Should approved request create calendar event or be a source directly? | Calendar should read approved absence as source first; materialize `calendar_events` only when needed for performance/export. |
| Should `awaiting_window_close` be persisted? | No; derive from special window dates and request status. |
| Should resource group managers approve absence? | No, not without explicit manager relation or future permission mapping. |


## PR2 Implemented Foundation

Status: implemented locally in PR2, pending commit and later production migration.

verified: PR2 adds `migrations/0041_absence_request_foundation.sql` as the next migration after applied `0040_worksheet_project_assignment_sources.sql`.

verified: PR2 keeps `resource_absences` unchanged. Existing `resource_absences` remains direct/legacy registered or approved absence. New absence requests use the new `absence_request` domain tables. No legacy records are migrated in PR2.

verified: PR2 uses `tenant_user` as the authoritative Fielddesk employee/manager identity for requests and manager relations. `absence_request.employee_fitter_id` is nullable and only prepares optional resource/E-Komplet linkage; `fitter` is not required to use the request foundation.

### PR2 Tables

- `absence_type`: tenant-configurable absence reasons with text/check workflow mode, comment policy, visibility policy, `allowed_duration_types text[]`, soft archive through `is_active`, and tenant-scoped created/updated actor FKs.
- `absence_special_window`: tenant-defined special vacation request windows with date ordering checks, late submission policy, receipt text limit, and soft archive through `is_active`.
- `absence_request`: current request state with employee `tenant_user`, optional `employee_fitter_id`, absence type, duration shape, private `employee_comment` limited to 250 characters, status, optional manager/window links, and optimistic `version` starting at 1.
- `absence_request_event`: append-only request history using `prevent_update_delete_append_only()` and tenant-scoped request/actor FKs.
- `absence_special_window_scope`: strongly referenced scope rows using nullable FK columns for tenant-wide, `resource_group`, `tenant_user`, and optional `absence_type` filtering; no generic unvalidated object id is used.
- `employee_manager_relation`: Fielddesk-owned personnel manager relation between tenant users with `primary`, `secondary`, and `delegate` types, self-manager prevention, active/open primary uniqueness, and service-layer historical overlap gap documented for later.

### PR2 Constraints And Tenant Scope

All PR2 tables have `tenant_id`. Cross-table relations use composite tenant foreign keys, for example `(employee_tenant_user_id, tenant_id)`, `(absence_type_id, tenant_id)`, `(special_window_id, tenant_id)`, `(absence_request_id, tenant_id)`, `(resource_group_id, tenant_id)`, and `(manager_tenant_user_id, tenant_id)`. RLS is still a future defense-in-depth gap and is not introduced in PR2.

Duration constraints:

- `full_days`: requires `start_date`, `end_date`, `end_date >= start_date`, and no times or day part.
- `time_range`: same-day only in first version, requires `start_time`, `end_time`, and `end_time > start_time`; overnight absence is not supported.
- `partial_day`: supported with `day_part IN ('morning', 'afternoon')`; no times are stored.

### PR2 Permissions

Actual module/action names use the existing `module:action` convention:

- Own request actions: `absence_request:create_own`, `absence_request:read_own`, `absence_request:update_own_draft`, `absence_request:submit_own`, `absence_request:cancel_own`, `absence_request:read_own_history`.
- Managed/request review actions prepared for explicit grants: `absence_request:read_managed`, `absence_request:approve_managed`, `absence_request:reject_managed`, `absence_request:propose_change_managed`, `absence_request:read_private_comment`.
- Admin actions: `absence_type:manage`, `absence_special_window:manage`, `employee_manager_relation:manage`, `absence_request:administrative_override`, `absence_request:approve_before_review_date`, `absence_request:read_audit`.

Default grants: all tenant roles can receive own-request permissions. `tenant_admin` receives administration permissions, but not `absence_request:read_private_comment`. `project_leader` does not receive managed approval actions by role alone. Explicit per-actor permission strings on server-derived auth can grant private-comment or managed actions later while still enforcing tenant match.

### PR2 Audit Keys

PR2 registers these audit event keys in migration and `auditService.js` allowlist:

- `absence_type.created`, `absence_type.updated`, `absence_type.archived`
- `absence_request.created`, `absence_request.updated`, `absence_request.submitted`, `absence_request.cancelled`, `absence_request.approved`, `absence_request.rejected`, `absence_request.change_proposed`
- `absence_special_window.created`, `absence_special_window.updated`, `absence_special_window.archived`
- `employee_manager_relation.created`, `employee_manager_relation.updated`, `employee_manager_relation.ended`

No PR2 route writes these events yet. PR3+ actions must write them inside service transactions.

### PR2 Standard Types

PR2 does not seed tenant absence types. Standard types should be introduced through a later safe tenant bootstrap/admin PR. Sickness is not seeded as ordinary request workflow.

### PR2 Legacy Strategy

PR2 preserves all three future options:

- Option A: approved request creates a `resource_absences` record.
- Option B: approved request becomes a direct calendar source while legacy records remain separate.
- Option C: a new shared approved-absence model is introduced later.

Recommendation for PR5/PR6: prefer Option C if approved absence needs richer lifecycle than legacy `resource_absences`; otherwise use Option B temporarily for calendar feed and keep legacy/direct absence as a separate source.

### Ready For PR3

PR3 can build employee request backend on `absence_type`, `absence_request`, `absence_request_event`, and own-request permissions. PR3 should still avoid manager approve/reject, calendar feed, mail/outbox, special-window automatching, and legacy absence migration.
## Follow-Up PR Plan And Tests

### PR2: Data Model Foundation

Expected files: new migration, schema, migration tests/checks, module docs,
audit allowlist updates only if audit keys are introduced.
Scope: absence types, request tables, special windows, manager relation,
permissions contract, audit event keys.
Tests: migration checks, tenant FK/static checks, repository constraint tests if
repository code is added.
Stop points: neutral employee identity decision, private-comment permission
matrix, production data migration from `resource_absences`.

### PR3: Employee Request Backend

Scope: employee draft/create/submit/list/detail for whole days and timed
absence, self scope, status history.
Tests: auth/tenant/object-scope tests, validation tests, idempotency/version
tests, private-comment response shaping.

### PR4: Notifications And Mail Outbox

Scope: templates, internal notifications, email outbox, worker/retry.
Tests: transaction/outbox tests, retry/dead-letter tests, disabled-provider
tests, no rollback on provider failure.

### PR5: Manager Review

Scope: manager pending list, approve, reject, object-scope, audit.
Tests: manager scope tests, double-approval/version conflicts, special-window
blocking, private-comment permission.

### PR6: Approved Calendar Data

Scope: approved absence feed, own calendar, team calendar, masking.
Tests: feed scope tests, masking tests, date range tests, source-of-truth
invalidation/materialization tests if calendar rows are added.

### PR7: Special Vacation Windows

Scope: window config, deadlines, extended receipt, review-date approval block.
Tests: overlap rules, before-open/after-deadline behavior, override permission
and audit.

### PR8: Alternative Periods

Scope: proposals, employee accept/reject, history.
Tests: proposal lifecycle, original request immutability, accepted proposal
approval flow, notification events.
