# Decision: Database Indexing

Status: verified decision
Date: 2026-04-11

## Decision Basis
Indexes are selected from real query predicates in:
- backend/src/db/queries/project.js
- backend/src/db/queries/fitterHour.js
- backend/src/db/queries/fitterBusiness.js

## Added in this audit
- project_core tenant+team_leader_code functional index
- project_core tenant/open-closed/updated composite index for scope mine filtering and ordering
- fitter_hour normalized project ref expression indexes for external_project_ref and project_id
- project_core normalized external ref index
- project_masterdata_v4 ek_project_id text index for fitterhours relation joins

## Not Added (by design)
- Broad indexes without matching predicates.
- Duplicate indexes covered by existing unique constraints.

## Multi-tenant Principle
- tenant_id remains leading column on new indexes where query patterns include tenant filter.
