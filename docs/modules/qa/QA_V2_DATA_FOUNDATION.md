# QA V2 Data Foundation

Status: implemented foundation
Scope: internal project QA threads only
Last updated: 2026-06-06

This note documents the first QA v2 data foundation slice. It adds per-user participant/read-state data without replacing the global manual QA thread status model.

## Verified Existing Model

- `qa_threads.status` remains the global manual lifecycle status.
- Valid global statuses remain `NEW`, `WAITING`, `ANSWERED`, and `CLOSED`.
- `qa_messages` remains the message history.
- Backend module permissions remain the authority for QA actions.
- Project/thread access still follows existing tenant/project scope rules.

## Implemented Foundation

The table `qa_thread_participants` stores per-user QA thread state:

- participant identity
- participant role
- explicit assignment flag
- visibility source
- last seen timestamp
- last seen message
- active/inactive marker

This enables each user to have a different personal read state for the same QA thread.

## Personal State Semantics

API responses may expose these personal states:

| State | Meaning |
| --- | --- |
| `new` | The latest message is from another user and the current user has not seen it. |
| `seen` | The latest message is from another user and the current user has seen it. |
| `sent` | The latest message is from the current user. |
| `closed` | The global thread status is `CLOSED`. |

These states are inbox/read-state metadata. They do not replace `qa_threads.status`.

## Participant Sources

Participants are resolved only from existing project access truths:

- `project_assignment`
- `project_core.owner_user_id`
- `project_core.responsible_code`
- `project_core.team_leader_code`

Fitterhour employees must not be used as QA access truth.

## Create And Message Flow

When a QA thread is created:

- the creator is added as a participant and marked as having seen the first message
- explicit `recipient_user_ids` are added as recipients when supplied
- without explicit recipients, current project participants are added as safe default participants
- recipients/default participants start as unseen/new

When a message is added:

- the sender is marked as having seen the new latest message
- other active participants are not marked seen, so their personal state can become `new`
- global `qa_threads.status` is not changed automatically

## Mark Seen

The endpoint `POST /api/qa/threads/:threadId/seen` marks the current user as having seen the latest message after normal tenant, module, and thread/project access checks.

If a safe participant row does not already exist for the current user, the endpoint creates one using `visibility_source = self`.

## Audit

The foundation adds audit event support for:

- `qa_thread_seen`
- `qa_thread_participant_added`

These events are supplementary to existing QA audit events:

- `qa_thread_created`
- `qa_message_created`
- `qa_thread_status_changed`

## Not Implemented In This Slice

- dashboard QA inbox
- right-side project QA panel
- notifications
- external/customer QA
- AI/automation
- advanced `waiting_on` ownership
- automatic changes to global `qa_threads.status`

## Future Direction

Next slices can build on this foundation by adding:

- project detail UI that calls mark-seen on thread open
- dashboard QA inbox using `qa_thread_participants`
- recipient picker UI
- participant sync when project assignments change
- explicit `waiting_on_role` / `waiting_on_user_id` only after business semantics are approved
