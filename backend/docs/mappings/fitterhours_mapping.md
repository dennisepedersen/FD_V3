# Fitterhours Mapping

Status: verified

## Source Endpoint
- fitterhours

## Mapping Table
| EK field | FD field | Column | Type | Status | Note |
|---|---|---|---|---|---|
| FitterHourID | fitter_hour_id | fitter_hour.fitter_hour_id | text | verified | optional; source_key fallback exists |
| ProjectID/ProjectReference | external_project_ref/project_id | fitter_hour.external_project_ref / project_id | text | verified | normalized for joins |
| FitterID | fitter_id | fitter_hour.fitter_id | text | verified | joins to fitter table |
| Username/Initials | fitter_username | fitter_hour.fitter_username | text | verified | display fallback |
| FitterSalaryID | fitter_salary_id | fitter_hour.fitter_salary_id | text | verified | optional identity signal |
| FitterCategoryID/Reference | fitter category ids | fitter_hour.fitter_category_id / fitter_category_reference | text | verified | joins to fitter_category |
| Date/WorkDate/RegistrationDate | work/registration timestamps | fitter_hour.work_date / registration_date | timestamptz | verified | effective date used in filtering |
| Hours/Quantity | hours/quantity | fitter_hour.hours / quantity | numeric | verified | |
| Unit | unit | fitter_hour.unit | text | verified | |
| Note/Description | note/description | fitter_hour.note / description | text | verified | |
| full row payload | raw payload | fitter_hour.raw_payload_json | jsonb | verified | stored as-is |

## Keys
- Upsert key: (tenant_id, source_key)
- source_key uses fitter_hour_id when present, else deterministic SHA-256 fingerprint.
