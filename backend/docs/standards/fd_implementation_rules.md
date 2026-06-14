# FD Implementation Rules

Status: verified
Scope: backend dataflow, sync, mappings, query manuals

## Core Rules

1. No guessing. If a field, join, meaning, or flow is not proven from code, schema, payload, or verified docs, mark it as unclear.
2. Use only verified fields from:
- Code in backend
- Applied migrations/schema
- Observed payload handling in sync parsers
- Verified markdown in this repo
3. Backend is source of truth for mapping, scope, and business enforcement.
4. Frontend is never source of truth for data contracts or authorization semantics.
5. Tenant isolation must not be weakened.
- Every query must include tenant_id filtering.
- Cross-tenant joins must be impossible by query shape.
6. No fallback logic without explicit approval.
7. Docs and code must be updated in the same change when behavior changes.
8. No schema changes without explicit need and evidence from query/sync usage.
9. No auth model changes in data tasks unless explicitly requested.
10. EK discovery must prefer narrow read-only project-scoped probes over broad/full scans whenever a project-scoped endpoint exists.
11. Before adding a new EK sync path, run narrow read-only probes and record verified payload/filter behavior.
12. After EK API discovery, update the relevant docs and explicitly separate verified facts, assumptions/hypotheses, future options, and do-not-use-yet findings.

## Evidence Markers

Use these exact labels in docs:
- verified: directly proven from code/schema/payload
- observed: seen in logs/payload handling but not contract-guaranteed
- hypothesis: plausible but not proven
- unclear: not provable from current repository state
- future option: possible later direction, not current implementation permission
- do not use yet: discovered or tempting capability that is not approved for implementation/use

## Audit Workflow

1. Read relevant docs + code + schema first.
2. Write audit findings before changing logic.
3. Fix only proven mismatches.
4. Re-run quick validation (errors/tests where available).
5. Record residual risks and manual actions if needed.
