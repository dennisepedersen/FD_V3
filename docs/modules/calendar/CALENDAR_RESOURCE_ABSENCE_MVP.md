# Calendar / Resource Absence MVP

Status: PR4 resource dropdown hygiene started
Scope: Fielddesk-owned absence data foundation, tenant-admin API, first tenant Kalender/Fravaer UI, resource dropdown, and active-resource filtering

## Decision

Fielddesk is the primary source of truth for resource absence in v1. Integrations such as E-Komplet, Outlook, Microsoft Graph, or other systems may enrich data later, but v1 absence records are owned by Fielddesk.

## PR1 Foundation

Implemented direction:
- `resource_absences` stores tenant-owned absence records.
- V1 links absences to `fitter.fitter_id` because `fitter` is the current employee/resource table.
- The table name and docs intentionally use resource language so a neutral `resource_person` model can be added later.
- V1 can create absences directly as `approved`.
- Status is modeled from the start: `draft`, `requested`, `approved`, `rejected`, `cancelled`.
- Visibility is prepared through `visibility_scope`, but no full RBAC/visibility engine exists yet.

## PR2 API Foundation

Implemented direction:
- `GET /api/calendar/absences?from=YYYY-MM-DD&to=YYYY-MM-DD` lists tenant-scoped absences.
- `POST /api/calendar/absences` creates tenant-scoped absences.
- API access requires tenant host, access token, and token tenant matching resolved tenant.
- PR2 RBAC allows only `tenant_admin` to read full absence data or create absence.
- `project_leader` and `technician` receive 403 for these endpoints until masked visibility rules are implemented.
- POST ignores client-supplied tenant, actor, and status. Status is set server-side to `approved`.

Not part of PR1/PR2:
- Frontend calendar UI.
- Full approval flow.
- Outlook/Graph or E-Komplet write/sync.
- PDF/reporting.
- Tenant-specific or HC-specific rules.

## PR3 Frontend Foundation

Implemented direction:
- Tenant app navigation opens `#calendar` as a SPA view.
- Project shell navigation links to `/app#calendar`.
- Kalender view has tabs for Opgaver and Fravaer.
- Fravaer is the active working tab with quick overview, period picker, absence list, and create form.
- The form calls the PR2 API and does not send tenant, actor, or status.
- Full Fravaer UI is for `tenant_admin`; denied users see a calm access message.
- Opgaver remains a placeholder.

Not part of PR3:
- Database changes.
- Full calendar/task engine.
- Approval flow, cancel/update, masked visibility, integrations, PDF, or reporting.

## PR3.1 Resource Dropdown

Implemented direction:
- `GET /api/calendar/resources` returns tenant-scoped resources from the current `fitter` table.
- PR3.1 resource access is tenant-admin only and uses the same calendar absence RBAC boundary.
- The Fravaer create form uses a medarbejder dropdown instead of manual `fitter_id` typing.
- The create payload still sends `fitter_id` to the absence API.

Not part of PR3.1:
- New database model or migration.
- Neutral `resource_person` table.
- Group membership, approval flow, masked visibility, integrations, audit/events, PDF, or reporting.

## PR4 Resource Dropdown Hygiene

Implemented direction:
- `GET /api/calendar/resources` returns active fitters by default using `fitter.is_active_derived = true`.
- The tenant-admin-only query parameter `include_inactive=true` can fetch inactive/historical fitters for later admin/debug use.
- The resource payload keeps `fitter_id`, `label`, `name`, and `initials`, and adds light status metadata.

Not part of PR4:
- Resource group tables or group-scoped access.
- UI toggle for inactive fitters.
- Approval flow, integrations, PDF, reporting, or tenant-specific rules.

## Next Backlog Items

- PR5: normalized `resource_groups`, group membership, and resource manager ownership foundation.
- Later: audit events for create, update, cancel, approve/reject when those actions exist.
- Later: direct manager/resource owner approval and masked visibility such as unavailable-only views.
