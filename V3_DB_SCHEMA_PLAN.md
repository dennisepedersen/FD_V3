# V3_DB_SCHEMA_PLAN

Status: Phase-1 only database blueprint for Fielddesk V3.
Scope lock: no API routes, no frontend, no auth implementation in this phase.

## 1) Scope and boundaries

This plan includes only approved Phase-1 tables:
- tenant
- tenant_domain
- tenant_invitation
- tenant_user
- team
- team_membership
- tenant_config
- tenant_config_snapshot
- audit_event
- sync_job
- project_core
- project_wip
- project_assignment

Excluded on purpose:
- legacy tables
- seed/demo data
- placeholder tables without explicit Phase-1 purpose
- support_session (explicitly out of Phase-1)

## 2) Core design choices (short)

- PostgreSQL with strict constraints and explicit indexes.
- Tenant isolation is schema-level enforced through:
  - mandatory tenant_id on tenant-owned tables
  - composite foreign keys `(entity_id, tenant_id)` to force tenant consistency across relations
  - no fallback tenant mechanics
- Lifecycle and role/status values are constrained with CHECK constraints.
- Case-insensitive uniqueness is enforced with unique indexes on `lower(...)` for slug/domain/email/name where relevant.
- Immutable and append-only requirements are guarded with DB triggers (not application convention only).

## 3) Table-by-table blueprint

## tenant

Purpose:
- canonical tenant identity and lifecycle.

Primary key:
- id

Unique:
- lower(slug)

Lifecycle/status field:
- status: invited | onboarding | active | suspended | deleted

Immutable fields:
- id
- slug
- created_at

Key checks/indexes:
- slug format check
- status check
- index on status

## tenant_domain

Purpose:
- verified and active host/domain mapping per tenant.

Primary key:
- id

Foreign keys:
- tenant_id -> tenant.id

Unique:
- lower(domain) globally
- one active domain per tenant via partial unique index on tenant_id where active=true

Lifecycle/status fields:
- verified (boolean)
- active (boolean)

Immutable fields:
- id
- tenant_id
- domain
- created_at

Key checks/indexes:
- active requires verified
- simple domain format check (lowercase, no spaces, no double dots, must include dot+tld)
- tenant lookup and verification indexes

## tenant_invitation

Purpose:
- secure invitation lifecycle and acceptance handoff into tenant onboarding.

Primary key:
- id

Foreign keys:
- tenant_id -> tenant.id (nullable until accepted)

Unique:
- token_hash
- one pending invite per email (case-insensitive, partial index)

Lifecycle/status field:
- status: pending | accepted | expired | revoked

Immutable fields:
- id
- email
- token_hash
- expires_at
- created_at

Key checks/indexes:
- status consistency checks for accepted/revoked/pending timestamps
- explicit expired-state consistency check (expired cannot also be accepted/revoked or tenant-bound)
- expires_at > created_at
- indexes for pending/expiry and tenant linkage

## tenant_user

Purpose:
- tenant-bound user principal with role and lifecycle state.

Primary key:
- id

Foreign keys:
- tenant_id -> tenant.id

Unique:
- (tenant_id, lower(email))
- helper unique for composite FK support: (id, tenant_id)

Lifecycle/status field:
- status: active | suspended | invited | deleted

Immutable fields:
- id
- tenant_id
- email
- created_at

Key checks/indexes:
- role check: tenant_admin | project_leader | technician
- status check
- tenant/role/status index

## team

Purpose:
- tenant-scoped team container for team-based scope semantics.

Primary key:
- id

Foreign keys:
- tenant_id -> tenant.id

Unique:
- (tenant_id, lower(name))
- helper unique for composite FK support: (id, tenant_id)

Lifecycle/status field:
- status: active | inactive

Immutable fields:
- id
- tenant_id
- created_at

Key checks/indexes:
- status check
- tenant/status index

## team_membership

Purpose:
- membership relation between team and tenant user.

Primary key:
- (team_id, tenant_user_id)

Foreign keys:
- tenant_id -> tenant.id
- (team_id, tenant_id) -> team(id, tenant_id)
- (tenant_user_id, tenant_id) -> tenant_user(id, tenant_id)

Lifecycle/status fields:
- none

Immutable fields:
- all relation keys are immutable by design

Key checks/indexes:
- membership_role check: member | lead
- tenant/user and tenant/team indexes
- UPDATE blocked by dedicated create/delete-model trigger (team_membership is not append-only)

## tenant_config

Purpose:
- current tenant integration config (single current row per tenant).

Primary key:
- tenant_id

Foreign keys:
- tenant_id -> tenant.id

Unique:
- implicit via primary key

Lifecycle/status field:
- status: not_configured | configured | test_ok | test_failed

Immutable fields:
- tenant_id

Key checks/indexes:
- base url must start with https://
- status check
- status index

## tenant_config_snapshot

Purpose:
- append-only historical snapshots for config changes.

Primary key:
- id

Foreign keys:
- tenant_id -> tenant.id

Unique:
- seq identity (globally unique ordering)

Lifecycle/status fields:
- changed_by_actor_scope: global | tenant | system

Immutable fields:
- all columns (append-only row model)

Key checks/indexes:
- jsonb object check for snapshot
- reason non-blank
- tenant + changed_at index
- UPDATE/DELETE blocked by trigger

## audit_event

Purpose:
- append-only audit trail for critical security and lifecycle events.

Primary key:
- id

Foreign keys:
- tenant_id -> tenant.id (nullable for global/system events)

Lifecycle/status fields:
- actor_scope: global | tenant | system
- outcome: success | fail | deny

Immutable fields:
- all columns (append-only row model)

Key checks/indexes:
- restricted event_type list aligned to Phase-1 support decision: only `support_access_denied` is kept for deny logging; support grant/request events are excluded
- jsonb metadata object check
- indexes by tenant/time, actor_scope/time, event_type/time
- UPDATE/DELETE blocked by trigger

## sync_job

Purpose:
- tenant-scoped sync execution journal (bootstrap/delta jobs).

Primary key:
- id

Foreign keys:
- tenant_id -> tenant.id

Lifecycle/status fields:
- type: bootstrap | delta
- status: queued | running | success | failed

Immutable fields:
- id
- tenant_id
- type
- created_at

Key checks/indexes:
- non-negative counters
- tenant/status/type indexes

## project_core

Purpose:
- canonical project identity and stable baseline fields.

Primary key:
- project_id

Foreign keys:
- tenant_id -> tenant.id
- (owner_user_id, tenant_id) -> tenant_user(id, tenant_id)

Unique:
- helper unique for composite FK support: (project_id, tenant_id)
- (tenant_id, external_project_ref) unique when external_project_ref is not null

Lifecycle/status field:
- status: open | closed | archived

Immutable fields:
- project_id
- tenant_id
- created_at

Key checks/indexes:
- tenant/status index
- owner lookup index

## project_wip

Purpose:
- mutable working state layered on top of project_core.

Primary key:
- project_id

Foreign keys:
- (project_id, tenant_id) -> project_core(project_id, tenant_id)
- (updated_by_user_id, tenant_id) -> tenant_user(id, tenant_id)

Lifecycle/status field:
- none (state fields are domain mutable)

Immutable fields:
- project_id
- tenant_id

Key checks/indexes:
- risk_level check: low | medium | high | critical (nullable)
- indexes for tenant stage and updater lookup
- updated_at is automatically maintained by `set_updated_at` trigger

## project_assignment

Purpose:
- tenant-scoped mapping between project and tenant user for scope and ownership semantics.

Primary key:
- id

Foreign keys:
- tenant_id -> tenant.id
- (project_id, tenant_id) -> project_core(project_id, tenant_id)
- (tenant_user_id, tenant_id) -> tenant_user(id, tenant_id)

Unique:
- (project_id, tenant_user_id)

Lifecycle/status field:
- assignment_role: owner | contributor | reviewer

Immutable fields:
- id
- tenant_id
- project_id
- tenant_user_id
- created_at

Key checks/indexes:
- role check
- tenant/user and tenant/project indexes

## 4) Tenant lifecycle support (invited/onboarding/active/suspended/deleted)

How lifecycle is represented:
- source of truth is tenant.status in table tenant.
- related table behavior is constrained to align with lifecycle intent.

Lifecycle support summary:
- invited:
  - represented directly by tenant.status='invited'
  - invitation rows can exist in pending state without tenant link, then bind on acceptance
- onboarding:
  - represented directly by tenant.status='onboarding'
  - tenant_domain starts as verified=false, active=false
- active:
  - represented directly by tenant.status='active'
  - exactly one active domain can exist per tenant (partial unique index)
- suspended:
  - represented directly by tenant.status='suspended'
  - domain active flag can be forced false by application flow; schema ensures active implies verified
- deleted:
  - represented directly by tenant.status='deleted' (soft-delete lifecycle)
  - references remain intact for audit/history, no hard dependency on physical delete

## 5) Immutability and append-only policy

Implemented in DB layer:
- immutable columns enforced by trigger `prevent_immutable_update` on relevant tables
- append-only tables enforce no UPDATE/DELETE via trigger `prevent_update_delete_append_only`

Tables with append-only row semantics:
- tenant_config_snapshot
- audit_event

Membership policy:
- team_membership follows create/delete semantics (no UPDATE); this is enforced with a dedicated non-append-only trigger.

## 6) Naming and structural consistency

Conventions used:
- table names: singular snake_case
- primary keys: `id` except project identity as `project_id` where domain clarity requires it
- tenant ownership marker: `tenant_id` on tenant-scoped tables
- constraint naming: `pk_`, `fk_`, `uq_`, `ck_`, `ix_` prefixes for readability

## 7) Deliverables mapping

- schema snapshot: schema.sql
- initial migration: migrations/0001_init.sql
- rationale document: V3_DB_SCHEMA_PLAN.md

No extra artifacts are included in this phase.
