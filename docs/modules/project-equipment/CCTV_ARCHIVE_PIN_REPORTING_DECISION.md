# CCTV archive, pins and reporting decision

Status: Proposed / backlog decision
Date: 2026-07-13
Scope: Project Equipment / CCTV, drawings, pins, reporting and exports
Implementation status: Not implemented in this decision note

## Decision

Fielddesk should prefer archive over delete for CCTV cameras.

Archiving a CCTV camera means removing it from the active installation view while preserving the camera record and its related data. A camera archive action must not delete or recreate its drawing pin. The pin should remain related to the same camera and should be hidden by default because the camera is no longer active.

If the camera is restored later, the same camera record should become active again and the existing pin should become visible again with the same `x_percent` / `y_percent` coordinates. Restoration must not create a new pin.

## Current data model evidence

The current CCTV beta model already points in this direction:

- `project_equipment_cctv` has `archived_at`.
- `project_equipment_cctv_pin` references `project_equipment_cctv` through `camera_record_id`.
- `project_equipment_cctv_pin` stores percent coordinates through `x_percent`, `y_percent` and `coordinate_mode = 'percent'`.
- Active uniqueness is enforced through partial active indexes:
  - `uq_project_equipment_cctv_project_mac_active`
  - `uq_project_equipment_cctv_project_serial_active`

The intended future behavior should preserve those principles: archive changes the camera active state; related pins, images, notes, audit and history remain attached.

## Standard active view

The standard drawing view represents the current active installation:

- Active cameras: pins are visible.
- Archived cameras: pins are hidden.

Archived pins should only be shown through an explicit future admin/support affordance such as:

- `Vis arkiverede kameraer`
- `Vis arkiverede pins`
- `Medtag arkiverede`

When archived pins are shown, they must be visually distinct from active installation pins, for example grey, muted or dashed.

## Restoration behavior

Restoring an archived camera should:

- clear the archived state on the same camera record;
- keep the same images, notes, audit, history and relations;
- keep the same pin row;
- show the existing pin again automatically;
- keep the same `x_percent` / `y_percent` placement;
- not create a duplicate camera pin.

## Reporting and counting defaults

Archived cameras should be excluded by default from:

- camera counts;
- dashboard statistics;
- project status;
- CCTV status summaries;
- reports;
- CSV export;
- PDF export;
- active-camera search;
- control overviews;
- `Kontroller kamera`;
- other standard active lists.

Including archived cameras must be a deliberate opt-in, not the default.

## Consequences by area

### CCTV

List, search, check, create duplicate checks and status summaries should keep using active-camera semantics by default. Archive remains the normal user-facing removal action.

### Drawing / pins

Pins remain data-owned by their camera relation. Default drawing queries should join/filter through active cameras so archived camera pins are hidden without deleting the pin row. Future admin views may include archived camera pins with a clear archived style.

### Reporting

Standard CCTV reports should describe the current active installation only. Historical/archive reports are a separate explicit mode.

### Export

CSV and PDF exports should exclude archived cameras by default. Any future `include_archived` option must be visible in the UI and auditable where relevant.

### Dashboard

Dashboard cards and project status indicators should count active cameras only unless the card is explicitly about archive/history.

### KPI / counts

KPI totals should use active-camera counts by default. Archive/history KPIs must be named clearly so they are not confused with current installation size.

### Future "show archived" function

A future `Vis arkiverede` function should be role-gated, tenant/project scoped and explicit. It should support review and restoration without making archived cameras look active.

## Implementation notes for later

This note does not require a migration by itself.

Future implementation work should verify:

- whether restore needs a dedicated endpoint such as `POST /api/projects/:projectId/equipment/cctv/:cameraRecordId/restore`;
- whether all current read/export/check queries consistently exclude `archived_at IS NOT NULL`;
- whether pin list queries hide pins by active camera state instead of deleting pins;
- whether archive and restore events are both covered by audit;
- whether partial unique indexes still allow a new active camera with the same MAC or serial number after the old camera has been archived;
- how conflict handling should work if an archived camera is restored while a newer active camera uses the same MAC or serial number.

## Non-goals

- No hard delete behavior is decided here.
- No migration is introduced here.
- No current UI, API, RBAC, storage or reporting behavior is changed by this note.
