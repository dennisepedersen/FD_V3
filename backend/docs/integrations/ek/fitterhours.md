# EK Fitterhours Contract

Contract status: verified
Endpoint family: /api/v3.0/fitterhours (+ v3/v4 variants)
Consumer: backend/src/services/syncWorker.js, backend/src/db/queries/fitterHour.js

## Purpose
- Store time rows for active projects into fitter_hour.
- Power project drawer summary/breakdown and /api/fitterhours endpoint.

## Verified Ingestion Rules
- pageSize starts at 50 for read endpoints; fallback to 25 on 429.
- Rows are mapped and filtered before persist:
- project reference must match active project reference keys
- effective date must be >= computed cutoff (12 months baseline)
- year must be 2025 or 2026 (hard-coded)
- IsIntern must be false

## Verified Fields Used
| EK field | FD field | Table column |
|---|---|---|
| FitterHourID | fitter_hour_id | fitter_hour.fitter_hour_id |
| ProjectID/ProjectReference | external_project_ref/project_id | fitter_hour.external_project_ref / fitter_hour.project_id |
| FitterID | fitter identity | fitter_hour.fitter_id |
| FitterCategoryID/Reference | category identity | fitter_hour.fitter_category_id / fitter_category_reference |
| Date/WorkDate/RegistrationDate | work/registration date | fitter_hour.work_date / registration_date |
| Hours/Quantity | numeric hours | fitter_hour.hours / quantity |
| Note/Description | text details | fitter_hour.note / description |

## Unclear Fields
| Field | Why unclear |
|---|---|
| Year hard filter (2025/2026) business rule | implemented but no explicit decision file existed before this audit |

## Relation Strategy (verified)
- Queries match fitter_hour rows to projects by normalized text comparison against:
- project_core.external_project_ref
- project_masterdata_v4.ek_project_id::text
- fitter_hour.external_project_ref
- fitter_hour.project_id

## Known Pitfalls
- Relation is text-based OR-join, not FK-based.
- Functional normalization in joins can become expensive without matching indexes.
