# EK Fitters Contract

Contract status: verified
Endpoint family: `/api/v4/fitters`
Consumer: `backend/src/services/syncWorker.js`, Calendar / Resource Groups

## Purpose

- Import the tenant fitter/employee master list into Fielddesk `fitter`.
- Provide the current attachable `fitter_id` source for Calendar absences and Resource Group members until a neutral `resource_person` / `tenant_employee` model exists.

## Verified Behavior

- `GET /api/v4/fitters` is documented as "Hent alle medarbejdere".
- Current OpenAPI documentation lists no query parameters for this endpoint.
- The endpoint returns a full-list response with `data: FitterResponseDTO[]`.
- Read-only verification for tenant `hoyrup-clemmensen` returned 545 raw EK fitters.
- Active status is derived by Fielddesk from `endDate`: no `endDate` means active, a past `endDate` means inactive.

## Verified Source Fields

Relevant EK response fields:

- `id`
- `employeeNumber`
- `name`
- `email`
- `phone`
- `startDate`
- `endDate`
- `userID`
- `jobPosition`
- `salaryID`
- `isPlannable`
- `isIncludedInSalaryExport`
- `isSalesPerson`

Fielddesk persists supported fields in `fitter` and keeps the full EK row in `raw_payload_json`.
`userID` is currently retained only in `raw_payload_json`; no schema change is made by this contract.

## Import Rule

- Treat `/api/v4/fitters` as an unpaginated full-list endpoint.
- Do not send `page` or `pageSize` for this endpoint.
- Fetch once and upsert the returned rows by `(tenant_id, fitter_id)`.
- Do not delete local fitter rows as part of this import.
- Do not mark missing EK rows inactive unless a separate safe reconciliation rule is designed and approved.

## Calendar / Resource Groups

- `GET /api/calendar/resources` and Resource Group member lookup depend on `fitter` being correctly populated.
- Resource Group membership remains many-to-many through `resource_group_members.fitter_id` in v1.
- EK `resourceGroups` / `ressourceGroupString` values observed on fitterhours payloads may be used later as seed/suggestion data only.
- Fielddesk-owned `resource_groups` remain the canonical group truth.

## Known Limitation

`fitter` is still an EK-specific person/resource identity. A later neutral `resource_person` / `tenant_employee` model is still recommended before Fielddesk supports non-EK-native employees, multiple external identity sources, or richer person lifecycle governance.
