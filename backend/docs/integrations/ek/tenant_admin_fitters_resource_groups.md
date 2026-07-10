# Tenant Admin Fitters and Resource Groups

Status: implemented first slice
Date: 2026-07-10

## Verified EK Inputs

- `GET /api/v4/fitters` is the verified fitter master endpoint in this repo.
- Existing docs verify a full-list `data: FitterResponseDTO[]` response and persisted fields such as `id`, `employeeNumber`, `name`, `email`, `phone`, `startDate`, `endDate`, `userID`, `jobPosition`, `salaryID`, and `isPlannable`.
- `GET /api/v3.0/users` is observed/read-only in the current sync worker and is not materialized into tenant admin users yet.
- `GET /api/v4.0/roles` is not verified or materialized in this repo state.

## Defensive EK Fields

The tenant admin fitter import now recognizes these optional group fields if EK returns them:

- `resourceGroupID` / `ResourceGroupID`
- `resourceGroupName` / `ResourceGroupName`
- `resourceGroups` / `ResourceGroups`

These fields were not part of the previously verified fitter contract, so they are treated as optional adapter inputs. If they are absent, fitters still import normally and no resource-group membership is inferred.

## Resource Group Mapping

When a fitter has a resource group id:

- Fielddesk upserts `resource_groups` by `(tenant_id, external_source, external_id)` with `external_source = ekomplet`.
- Fielddesk upserts `resource_group_members` by `(tenant_id, group_id, fitter_id)`.
- Missing EK fitters are not deleted by later syncs.
- Manual Fielddesk groups and users continue to exist independently of EK.

Names like `183 - Pharma - Sikring - (service) - DEP` are parsed defensively:

- `external_id`: `183`
- `area`: `Pharma`
- `discipline`: `Sikring`
- `category`: `service`
- `short_code`: `DEP`

No owner code such as `DEP` is global behavior; it is stored only as metadata found in that tenant import.

## Initials

Email prefixes are used for display/search metadata only. For example `jsk@example.dk` becomes `JSK`. Identity still uses tenant-scoped ids and external references.

## Sync

- Manual endpoint: `POST /api/tenant/admin/integrations/ekomplet/fitters/sync`.
- Status endpoint: `GET /api/tenant/admin/integrations/sync-status`.
- Manual sync creates an endpoint-scoped `sync_job` with `type = manual_full_resync` and `endpoint_key = fitters`.
- The worker now schedules automatic delta/reconcile jobs every 12 hours.
- `/api/v4/fitters` has no verified delta parameters in this repo, so fitters use idempotent full-list upsert.

## Tenant Admin UI/API

Tenant admins can:

- List imported and manual employees via `GET /api/tenant/admin/users`.
- Create manual users via `POST /api/tenant/admin/users`.
- List resource groups with source/external metadata via `GET /api/tenant/admin/resource-groups`.
- Trigger fitters/resource-group derivation sync from the tenant admin UI.

RBAC uses the `tenant_admin` module permission. Routes require tenant host resolution, access token auth, tenant-context match, and tenant admin role.
