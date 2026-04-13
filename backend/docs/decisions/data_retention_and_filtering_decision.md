# Decision: Data Retention and Filtering

Status: verified + observed
Date: 2026-04-11

## Projects
- Keep open has_v4 projects.
- Keep closed projects only for 6 months after closed_observed_at.
- Delete retention-eligible closed projects after v4 terminal pass and no backlog/retries.

## Fitterhours
- Keep only rows linked to active project references.
- Apply cutoff baseline: now - 12 months.
- Additional hard filter currently present: year in {2025, 2026} and IsIntern=false.

## Bootstrap vs Delta
- Bootstrap: full run from page 1.
- Delta: scheduled every ~10 minutes, backlog first.
- projects_v4 still full-scanned to maintain closure truth.

## Risk / Follow-up
- Year filter should be validated against business semantics; tracked in missing_business_semantics audit.
