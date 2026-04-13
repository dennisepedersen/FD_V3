# Query Manual Template

Status: template

## Query/Endpoint
- Name:
- API route(s):
- Query function(s):

## Purpose
- User-facing behavior and scope.

## Source of Truth
- Primary table(s)
- Supplemental table(s)

## SQL Shape
- Core CTEs
- Joins
- Filters
- Sorting
- Pagination

## Tenant and Access Rules
- tenant_id filters
- role/scope checks
- project access checks

## Performance Requirements
- Target indexes
- Expected row volume
- Known expensive predicates

## Risks
- Potential false matches
- stale data risk
- missing index risk

## Evidence
- code references
- schema/index references
