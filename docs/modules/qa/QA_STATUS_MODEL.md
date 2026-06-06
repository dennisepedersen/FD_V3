# QA Status Model V1

Status: current decision
Scope: internal project QA threads only
Last updated: 2026-06-06

This note defines the minimal v1 meaning of QA thread statuses. It prevents future dashboard, inbox, notification, and automation work from interpreting the existing statuses differently.

## Verified Current Behavior

- `qa_threads.status` is the only persisted QA status source.
- New QA threads are created as `NEW`.
- Status changes only through the QA status endpoint.
- Messages do not change status automatically.
- Status does not grant, remove, or widen access.
- Status is counted in the project QA summary.
- Status changes are audited as `qa_thread_status_changed`.
- `tenant_admin` and `project_leader` can change QA status when project/thread scope allows access.
- `technician` can read/create QA threads and messages, but sees status as read-only.
- There is no persisted `waiting_on`, `awaiting_role`, `assignee_type`, QA inbox, or auto-status model.

## Decision: Manual V1 Status Model

QA status v1 is manual. Project leaders and tenant admins own status hygiene. Technicians can participate through messages, but do not change status.

| Status | Meaning |
| --- | --- |
| `NEW` | New QA thread, not yet actively handled or triaged. |
| `WAITING` | A project leader or tenant admin has manually marked that the thread is waiting for action, an answer, or clarification. |
| `ANSWERED` | An answer or clarification exists, but the thread is not closed yet. |
| `CLOSED` | The QA thread is finished and remains available as history. |

## Rules

- Status is workflow/overview metadata, not access control.
- Messages do not change status automatically in v1.
- `WAITING` does not say who is being waited on in v1.
- `WAITING` must not be used as "waiting on me" or as a personal work queue by itself.
- Dashboard and inbox logic must not infer responsibility from `WAITING` alone.
- `CLOSED` means manually finished; v1 does not define immutable close or transition rules.

## Do Not Assume

- Do not assume `ANSWERED` means the latest message came from a technician.
- Do not assume `WAITING` means the technician is responsible.
- Do not assume `WAITING` means the project leader is responsible.
- Do not build notifications, inboxes, or dashboard counts that require a responsible role/person from status alone.
- Do not use frontend-only waiting context labels as persisted business truth.

## Future V2 Direction

Later versions may add explicit responsibility and history fields, for example:

- `waiting_on_role`
- `waiting_on_user_id`
- `last_message_by_user_id`
- `last_message_by_role`
- `last_status_changed_by`
- `last_status_changed_at`
- status history API
- inbox "waiting on me"
- notifications
- SLA/age metrics for open QA threads

V2 should be implemented only after the business meaning of waiting, ownership, and automatic transitions has been approved.
