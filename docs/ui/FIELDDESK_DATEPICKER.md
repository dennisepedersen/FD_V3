# Fielddesk Datepicker

Status: current UI foundation  
Scope: shared tenant frontend date and date-range controls

## Product Rule

Fielddesk uses shared custom date controls where native browser date inputs need richer context, range selection, or mobile behavior. The component keeps the stored value as ISO `YYYY-MM-DD` and renders Danish calendar labels with Monday as first weekday.

The component must not disable pinch zoom or rely on viewport hacks. Mobile/touch controls in the picker stay at minimum `16px`, in line with `docs/ui/MOBILE_FORM_CONTROLS.md`.

## Assets

Shared component:

- `backend/src/public/tenant/fd-datepicker.js`
- tenant route: `/tenant/fd-datepicker.js`
- loaded before `/tenant/auth.js` on `app.html`

Public API:

- `window.FielddeskDatePicker.FDDatePicker`
- `window.FielddeskDatePicker.FDDateRangePicker`
- `window.FielddeskDatePicker.normalizeDecorations`

## Decoration Contract

Decorations are presentation-only. Backend preflight and submit validation remain authoritative.

Accepted fields:

- `date` or `start` plus optional `end`
- `styles`: any of `range`, `disabled`, `dot`, `underline`, `info`
- `label`
- `info`
- `priority`

The component is domain-neutral. Absence-specific mapping belongs in `auth.js`, not in `fd-datepicker.js`.

## Phase 1 Pilot

Implemented pilot:

- Fravær / Planlægning
- medarbejderens “Anmod om fravær”
- full-day range fields: `absenceRequestStartDateInput`, `absenceRequestEndDateInput`
- time-range date field: `absenceRequestTimeDateInput`

The pilot keeps the existing hidden ISO inputs and dispatches normal `input` / `change` events, so current request validation, draft, preflight and submit code paths stay in use.

Decoration sources in the pilot:

- own submitted/ready/under-review/approved absence requests from `/api/calendar/absence-requests/mine`
- own approved calendar events from `/api/calendar/events/mine`
- current preflight response from `/api/calendar/absence-requests/preflight`

The pilot does not use team events, manager queues, review overview data, or other employees’ project/meeting information for picker decorations.

## Tenant Calendar Date Inputs

The tenant calendar absence/planning surface uses the shared DatePicker components for:

- employee request full-day and time-range dates
- direct absence filter range
- direct absence create start/end range
- special-window absence period range
- special-window open date, deadline and review-start date

All values remain plain ISO `YYYY-MM-DD` strings in the underlying inputs and backend contracts. DatePicker decorations remain presentation-only; backend preflight and submit validation remain authoritative.

Future project/equipment/date surfaces should migrate to the shared picker as they appear. Auth/login/invite/password flows currently have no datepicker need.

## Accessibility

The picker supports mouse, touch and keyboard navigation:

- `Escape` closes and returns focus
- arrow keys move day focus
- `Home` / `End` move within week
- `PageUp` / `PageDown` move month
- mobile uses a bottom sheet with 16px controls and larger day targets
- selected and disabled states are exposed with ARIA attributes

Do not add `user-scalable=no`, `maximum-scale=1`, or equivalent zoom-blocking viewport changes.
