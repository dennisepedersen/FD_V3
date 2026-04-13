# Dashboard Queries Manual

Status: verified

## Covered Query Functions
- getProjectDrawerOutput
- getProjectDetailHoursOutput
- listFitterCategoryBusinessRows
- listFitterResourceGroupMembershipSnapshot

## Project Drawer/Breakdown Source of Truth
- project_core + project_masterdata_v4 identify target project reference keys.
- fitter_hour provides rows.
- fitter and fitter_category enrich labels and classification.

## Join Strategy
- Text-normalized OR-join between project refs and fitter_hour external_project_ref/project_id.
- This is currently required because fitter_hour does not FK to project_core.project_id.

## Filters
- category text heuristics classify absence/non-project/allowance
- project hour candidate requires not internal-only and invoice-relevant

## Risks
- OR-join with normalization is expensive on larger datasets.
- Heuristic category classification depends on naming conventions and may drift.

## Index Requirements
- tenant+normalized project refs on project_core and fitter_hour (added via migration in this audit).
- fitter_hour tenant/date and tenant/category indexes already exist.
