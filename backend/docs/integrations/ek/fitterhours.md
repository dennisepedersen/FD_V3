# EK Fitterhours Contract

Contract status: verified / retention update pending implementation
Endpoint family: /api/v3.0/fitterhours (+ v3/v4 variants)
Consumer: backend/src/services/syncWorker.js, backend/src/db/queries/fitterHour.js, backend/src/db/queries/fitterBusiness.js

## Purpose
- Store time rows for active projects into fitter_hour.
- Power project drawer summary/breakdown and /api/fitterhours endpoint.

## Verified Ingestion Rules
- pageSize starts at 50 for read endpoints; fallback to 25 on 429.
- Current FD sync maps and filters rows before persist.
- Current implemented sync uses a 12-month cutoff for fitterhours.
- Current implemented sync should be treated as `synced_rows_only`, not guaranteed all EK hours.
- Future retention behavior is documented in `backend/docs/integrations/ek/fitterhours_retention_model.md`.

## Verified Endpoint Behavior

- `/api/v3.0/fitterhours` returns data for tenant `hoyrup-clemmensen`.
- `/api/v4.0/fitterhours` returned 0 rows in the verification test.
- Direct query parameters such as `ProjectID=<id>` and `ProjectReference=<ref>` did not filter the response.
- `searchAttribute=ProjectID&search=<EK ProjectID>` works for project-targeted reads.
- `searchAttribute=ProjectReference&search=<reference>` returned an EK-side error in the verification test.

Verified project-targeted pattern:

```text
GET /api/v3.0/fitterhours?page=1&pageSize=1000&searchAttribute=ProjectID&search=<EK ProjectID>
```

## Verified Fields Used
| EK field | FD field | Table column |
|---|---|---|
| FitterHourID | fitter_hour_id | fitter_hour.fitter_hour_id |
| ProjectID/ProjectReference | external_project_ref/project_id | fitter_hour.external_project_ref / fitter_hour.project_id |
| ProjectID resolved against v4 masterdata | resolved FD project relation | fitter_hour.fd_project_id |
| FitterID | fitter identity | fitter_hour.fitter_id |
| FitterCategoryID/Reference | category identity | fitter_hour.fitter_category_id / fitter_category_reference |
| Date/WorkDate/RegistrationDate | work/registration date | fitter_hour.work_date / registration_date |
| Hours/Quantity | numeric hours | fitter_hour.hours / quantity |
| Note/Description | text details | fitter_hour.note / description |

## Unclear Fields
| Field | Why unclear |
|---|---|
| v4 fitterhours behavior | v4 endpoint returned 0 rows in verification; keep v3 as source until EK confirms otherwise |
| ProjectReference filtering | direct ProjectReference parameters did not filter, and searchAttribute=ProjectReference errored in verification |

## Relation Strategy

- Current resolved project relation is `fitter_hour.fd_project_id`.
- Source payload keeps both `ProjectID` and `ProjectReference`.
- `ProjectID` must resolve only against `project_masterdata_v4.ek_project_id`.
- `ProjectReference` must resolve only against `project_core.external_project_ref`.
- Runtime cross-matching between EK ProjectID and human project reference is not allowed.

## Known Pitfalls
- FD does not yet persist project-level `is_internal`, so the new internal/external retention model is not implemented yet.
- Existing synced project-hour values may be 12-month scoped and must not be presented as all EK hours.
- Project-targeted all-time reads should use EK ProjectID, not ProjectReference, based on verification.
