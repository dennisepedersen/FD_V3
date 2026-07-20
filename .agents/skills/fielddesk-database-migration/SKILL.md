---
name: fielddesk-database-migration
description: Design, implement, or review Fielddesk PostgreSQL schema changes and SQL migration files. Use for any task that adds, changes, validates, audits, or explains migrations, constraints, indexes, tenant-scoped tables, RLS direction, or production migration risk.
---

# Fielddesk Database Migration

## Overview

Use this skill to make database changes safely in Fielddesk. The goal is to preserve deployed migration history, keep tenant-owned data isolated, and make the smallest schema change that matches a verified product or data need.

## Required Context

- Read `AGENTS.md`.
- Read `docs/development/TESTING.md`.
- Read `docs/ARCHITECTURE.md` and `docs/SECURITY_MODEL.md` when tenant-owned data, auth, RBAC, RLS, audit, or storage is involved.
- Read `backend/docs/standards/fd_implementation_rules.md`.
- Read relevant module, mapping, decision, or integration docs before changing module or imported data tables.

## Workflow

1. Inspect current state:
   - list `migrations/*.sql` and find the highest migration number.
   - inspect `schema.sql` and existing migrations for the affected tables.
   - search backend queries and tests for affected columns, constraints, and indexes.
2. Confirm scope:
   - identify whether data is tenant-owned, platform/global, imported, derived, audit, or file metadata.
   - verify whether `tenant_id` is required and how it is enforced.
   - stop if the requested schema change lacks a documented data need.
3. Design the migration:
   - never edit an existing deployed migration.
   - create the next numbered file using `0000_lower_snake_case.sql`.
   - preserve the known legacy duplicate `0002` exception; never create a new duplicate number.
   - include tenant-aware constraints, composite foreign keys, uniqueness, and indexes matching actual query predicates.
   - consider existing production data, nullability, backfill order, locks, idempotency where appropriate, rollback/failure modes, and audit needs.
4. Implement narrowly:
   - update only the new migration and any required schema/test/docs files.
   - avoid behavior changes unless explicitly requested.
5. Validate:
   - run `npm run check:migrations`.
   - run `npm test` and/or focused tests when code behavior changes.
   - run `npm run check` when the migration affects shared contracts or release readiness.

## Stop Conditions

- A deployed migration would need to be edited.
- Tenant scope, ownership, or authorization cannot be proven.
- Existing production data impact is unclear and could cause data loss or long blocking locks.
- The change requires production migration execution, checksum repair, deploy, or DB access that was not explicitly approved.
- Docs and code disagree on the current architecture in a security-relevant way.

## Final Response

- State the migration number/name, affected tables, and whether data is tenant-owned.
- State tenant-scope reasoning, constraints/index decisions, and production data risks.
- List exactly which checks ran and their results.
- Separate verified facts from assumptions or open questions.
