# Code vs Docs Mismatch

Date: 2026-04-11
Status: verified

## Mismatch 1
- Docs expected backend/docs contracts to exist.
- Reality: backend/docs folder was missing.
- Action: full required docs tree created and populated.

## Mismatch 2
- Existing historical docs in audit (read only) describe V2 schema/endpoints not matching current V3 backend structure.
- Action: treated as historical context only, not source of truth for V3 implementation decisions.

## Mismatch 3
- Previous revision then over-corrected by documenting nextPage as primary progression.
- Verified platform rule for this codebase is count-based page/pageSize progression.
- Action now:
- sync loops continue only when fetched rows == pageSize
- sync loops stop when fetched rows == 0 or < pageSize
- nextPage kept as secondary parsed/logged metadata only

## Mismatch 4
- Query patterns use normalized text joins on project references but schema lacked matching functional indexes.
- Action: added targeted index migration.
