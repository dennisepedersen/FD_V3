# PR4 - Fravaersnotifikationer og email outbox

Status: PR4 released; PR5 manager decision extensions implemented locally.

## Scope

PR4 etablerer et fundament for interne notifikationer, mailtemplates og transactional email outbox for medarbejderens fravaersanmodninger.

Implemented:

- `internal_notification` til tenant-scopede interne notifikationer.
- `email_template` med systemtemplates og fremtidig tenant override.
- `email_outbox` med `queued`, `processing`, `sent`, `retry` og `dead_letter`.
- Systemtemplates for submit og cancel i `da-DK`.
- PR5 adds systemtemplates for manager approve/reject employee mails in `da-DK`.
- Template rendering med eksplicit variable allowlist og HTML escaping.
- Atomisk enqueue ved `absence_request.submitted` og `absence_request.cancelled`.
- PR5 adds atomic employee notification/outbox enqueue for `absence_request.approved` and `absence_request.rejected`.
- Whitelisted, manuelt aktiveret maintenance job `email-outbox-process`.

Not implemented in PR4:

- Leader approval, reject, change proposal or review UI.
- In-app notification API/UI.
- Template admin UI.
- Calendar feed, `resource_absences`, EK sync or worksheet sync changes.
- Production mail test or automatic mail sending.
- Render environment or service configuration changes.

## Transaction Boundary

Submit and cancel still run in the existing absence request transaction. PR4 adds only database writes inside that transaction:

- absence request update
- absence event
- audit event
- internal notification rows
- email outbox rows

If notification or outbox enqueue fails, the whole submit/cancel transaction rolls back. No mail provider is called from the request transaction. Mail provider calls are isolated to the maintenance processor.

## Recipient Rules

Recipients are resolved server-side from tenant-owned `tenant_user` rows.

- Active tenant users with active login can receive internal notifications.
- Inactive users or users with inactive login are not materialized to `internal_notification` or `email_outbox`.
- Active users with a valid email get a queued outbox row.
- Active users with missing email get an outbox row created directly as `dead_letter` with `recipient_email_missing`.
- Active users with invalid email get an outbox row created directly as `dead_letter` with `recipient_email_invalid`.
- Missing or invalid email does not fail submit/cancel.
- `employee_comment` is not included in notification payloads, outbox payloads, rendered mail content, processor logs, or audit metadata.

## Templates

Template rendering supports only `{{variable}}` placeholders. Unknown placeholders, missing required variables, property traversal, template logic, and arbitrary code are rejected by shape or allowlist.

Tenant-specific active templates may override copy later, but their `allowed_variables_json` must be a subset of the active systemtemplate allowlist for the same `template_key` and locale. A tenant override cannot add new variables beyond the systemtemplate contract.

The PR4 seed uses systemtemplates only and is protected with `ON CONFLICT DO NOTHING` to avoid duplicate seed rows if the seed statement is re-run in a rebuild/test context.

## Tenant URL

Action URLs are built server-side:

- Prefer active verified `tenant_domain.domain`.
- Fall back to `https://{tenant.slug}.fielddesk.dk/login#absence-request-{id}`.

Until PR5 adds absence UI, the temporary destination is the existing tenant `/login` page with a hash. The hash avoids backend 404s and does not contain tokens or private data.

## Processor

The maintenance dispatcher exposes:

```bash
node scripts/fd_maintenance_job.js --job email-outbox-process --mode status-only --tenant hoyrup-clemmensen
node scripts/fd_maintenance_job.js --job email-outbox-process --mode dry-run --tenant hoyrup-clemmensen --limit 25
node scripts/fd_maintenance_job.js --job email-outbox-process --mode apply --tenant hoyrup-clemmensen --limit 25 --confirm APPLY:email-outbox-process:hoyrup-clemmensen
```

`status-only` reads queue counts only. `dry-run` reads due rows only and does not mutate queue status or send mail. `apply` must be explicitly invoked with the confirmation string; it claims due rows with `FOR UPDATE SKIP LOCKED`, sends one email per claimed row, then marks the row as sent, retry or dead-letter.

Backoff is exponential by attempts: 1, 2, 4, 8, 16, 32, then capped at 60 minutes. Permanent 4xx provider failures except 429 dead-letter. 429, timeout and 5xx-class failures retry until `max_attempts`; exhausted attempts dead-letter. Stuck `processing` rows can be recovered after the processor timeout predicate.

The processor is not started by the webprocess, not scheduled, and not activated by deploy. Deploying PR4 can create queued rows when submit/cancel is used, but no real mail is sent unless the maintenance `apply` command is run separately.

## PR5 Recommendation

Recommended next PR:

- Manager pending list.
- Manager request detail.
- Approve.
- Reject.
- Audit.
- Notification/outbox side effects for approval outcomes.
- No calendar materialization.
- No notification UI in the same PR.
## PR5 Manager Decision Notifications

PR5 reuses the PR4 notification/outbox foundation for manager decisions. Approve and reject create employee-facing internal notifications and email outbox rows inside the same absence-request transaction as the status update, request event, and audit event.

Template keys:

- `absence_request.approved.employee`
- `absence_request.rejected.employee`

Allowed variables are limited to `employee_name`, `manager_name`, `absence_type`, `start_date`, `end_date`, `start_time`, `end_time`, `action_url`, `tenant_name`, and, for rejection only, `decision_reason`. Tenant overrides still cannot expand the systemtemplate allowlist.

Rejection reason policy:

- The full reason is stored in `absence_request_event.reason`.
- The full reason is allowed in the employee rejection email body because it is the intended message content.
- The full reason is not copied to internal notification body, notification payload, outbox payload, audit metadata, route logs, or processor logs.

Approval message policy:

- An optional manager approval message is stored in `absence_request_event.reason` for the approved event and shown in employee/assigned-manager request history.
- It is not copied to audit metadata, calendar events, internal notification payload/body, email outbox payload, rendered mail templates, route logs, or processor logs in this slice.
- Adding the approval message to employee email later requires an explicit email-template allowlist/template migration.

PR5 still does not activate automatic outbox `apply`, send production mail, create notification UI, or materialize calendar/resource absence rows.

## PR7 Special-Window Submit Templates

PR7 reuses the PR4 outbox foundation for special vacation window submit receipts. It adds system template keys:

- `absence_request.submitted_special_window.employee`
- `absence_request.submitted_special_window.manager`

Allowed variables are limited to `employee_name`, `manager_name`, `absence_period`, `special_window_name`, `submission_deadline`, `review_start_date`, `receipt_text`, `action_url`, and `tenant_name`.

The special-window submit notification confirms receipt for collective review. It must not imply approval, priority, first-come-first-served handling, or a final calendar absence. Employee comments remain excluded from internal notification payloads, outbox payloads, rendered special-window submit templates, audit metadata, and processor logs.

PR7 still does not activate outbox `apply`, send real mail, create notification UI, or make Render/service configuration changes.