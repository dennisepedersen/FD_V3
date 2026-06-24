# Calendar / Resource Absence MVP

Status: PR7a resource group admin UI started
Scope: Fielddesk-owned absence data foundation, tenant-admin API, first tenant Kalender/Fravaer UI, resource dropdown, active-resource filtering, resource group data foundation, resource group administration API, and tenant-admin resource group UI

## Decision

Fielddesk is the primary source of truth for resource absence in v1. Integrations such as E-Komplet, Outlook, Microsoft Graph, or other systems may enrich data later, but v1 absence records are owned by Fielddesk.

Fielddesk is also the primary source of truth for resource groups. Imported E-Komplet `resource_groups_json` values may be used later as seed data or suggestions, but they do not define the canonical Fielddesk group model.

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

## PR5 Resource Group Foundation

Implemented direction:
- `resource_groups` stores tenant-owned Fielddesk resource groups.
- `resource_group_members` allows a fitter to be in multiple groups.
- `resource_group_managers` allows a group to have multiple tenant-user managers with `owner`, `manager`, or `viewer` role metadata.
- V1 membership still references `fitter.fitter_id`; a neutral `resource_person` model can be added later.
- Manager/viewer relation prepares future "mine grupper" and "mine medarbejdere" scope, but does not by itself grant approval rights.
- Apprentices or shared resources can belong to multiple groups without hardcoding tenant-specific rules.

Not part of PR5:
- UI for groups.
- Filtering `GET /api/calendar/resources` by groups.
- E-Komplet group import/seed.
- Approval flow, visibility engine, integrations, PDF, reporting, or tenant-specific rules.

## PR6 Resource Group API Foundation

Implemented direction:
- `GET /api/resource-groups` lists tenant-scoped resource groups; active groups are default and `include_archived=true` can include archived groups.
- `POST /api/resource-groups` creates a tenant-scoped group.
- `PATCH /api/resource-groups/:groupId` updates group `name`, `description`, or `status`.
- Member endpoints manage `resource_group_members` by `fitter_id`.
- Manager endpoints manage `resource_group_managers` by `tenant_user_id` and `manager_role`.
- API routes require tenant host, access token, token tenant matching resolved tenant, and tenant-admin resource group module access.
- Resource group manager roles remain group administration/scope metadata only and do not grant or imply absence approval rights.

Not part of PR6:
- UI for groups.
- Filtering Kalender resource dropdowns by groups.
- E-Komplet group import/seed.
- Approval flow, visibility engine, integrations, PDF, reporting, or tenant-specific rules.

## PR7a Resource Group Admin UI

Implemented direction:
- Tenant-admin users can open Admin / Ressourcegrupper from the tenant shell.
- The UI lists active groups by default and can include archived groups.
- Tenant-admin users can create, edit, activate, and archive Fielddesk-owned resource groups.
- Tenant-admin users can view group members, add attachable tenant fitters through `GET /api/resource-groups/member-resources`, update `is_primary`, and remove members.
- Tenant-admin users can view existing group managers, update `manager_role`, and remove managers.
- Manager roles remain group/scope administration metadata only and do not grant or imply absence approval rights.
- Member lookup is separate from `GET /api/calendar/resources`; Resource Group Admin must not inherit Calendar dropdown filtering.
- V1 group members still store `fitter_id`, so the lookup can only return resources present in the current `fitter` table. A full HC employee base requires a later neutral `resource_person` model/import.

Follow-up data-source repair:
- Resource Group member lookup depends on `fitter` being correctly populated.
- EK `/api/v4/fitters` is the verified source for fitter master import.
- The endpoint is treated as an unpaginated full-list endpoint based on current EK documentation and read-only verification.
- Fielddesk derives active status from EK `endDate`; no `endDate` means active.
- EK `resourceGroups` / `ressourceGroupString` values observed on fitterhours payloads may be used later as seed/suggestions only. Fielddesk-owned resource groups remain the truth.

Not part of PR7a:
- Calendar/resource dropdown filtering by groups.
- "Mine medarbejdere" default scope.
- Add-manager UI for arbitrary tenant users; this requires a tenant-user lookup/admin endpoint in a later PR.
- Full employee/person master data beyond current `fitter` records.
- E-Komplet group import/seed.
- Approval flow, visibility engine, integrations, PDF, reporting, or tenant-specific rules.

## Next Backlog Items

- PR7b: group-aware resource listing and default "mine medarbejdere" design, once admin UI usage is verified.
- Later: audit events for create, update, cancel, approve/reject when those actions exist.
- Later: direct manager/resource owner approval and masked visibility such as unavailable-only views.
