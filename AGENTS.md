# Fielddesk Codex Rules

Fielddesk V3 is a modular, multi-tenant SaaS platform for project and case
management. The current stack is Node/Express, PostgreSQL migrations, and
static tenant/admin UI served by the backend.

## Hard Rules

- Tenant isolation is a critical security requirement. No implicit tenant, no
  default tenant, no fallback user, and no fallback allow.
- Backend code is the source of truth for tenant context, authentication,
  authorization, RBAC, audit, data contracts, and storage access.
- Never treat client-supplied `tenant_id`, `project_id`, role, or scope as
  authoritative by itself. Derive tenant and actor context server-side.
- Every tenant-owned database query must be tenant-scoped. Cross-tenant joins
  must be impossible by query shape, normally by joining on both entity id and
  `tenant_id`.
- Existing deployed migrations must never be edited. Database changes require a
  new migration using the repository's existing numbering and naming pattern.
- Do not change unrelated functionality, UI, copy, formatting, migrations, or
  docs as a side effect.
- Respect the current architecture and design direction in `docs/00_MASTER.md`,
  `docs/ARCHITECTURE.md`, `docs/SECURITY_MODEL.md`, and relevant module docs.
- If existing architecture or documented design decisions seem wrong or
  unsuitable, stop, explain the issue, propose a solution, and wait for approval
  before changing the architecture.
- User-facing product text is Danish by default unless the surrounding surface
  clearly uses another language.
- Do not deploy, restart services, run production migrations, change production
  config, push, merge, or perform destructive actions without explicit approval.

## Working Rules

- Before security, tenant, auth, RBAC, RLS, storage, sync, migration, or module
  work, read the relevant current docs first.
- Keep scope narrow. If the requested behavior conflicts with current docs or
  necessary information is missing, stop and report the conflict or gap.
- Distinguish documented facts from assumptions. Use the repo evidence labels
  where relevant: `verified`, `observed`, `hypothesis`, and `unclear`.
- Prefer existing repository patterns, route structure, service/repository
  boundaries, SQL style, and UI conventions.
- Add or update tests when behavior changes. Do not stop after a failed check:
  diagnose, repair within scope, and validate again.
- Run relevant checks before finishing. For normal repo-safe validation, prefer
  root commands from `docs/development/TESTING.md`: `npm test` and
  `npm run check`, or narrower `npm run check:*` commands when scope warrants.
- Always report exactly what was changed and exactly which checks were run.
  Never claim a test, build, migration, deploy, or live verification ran unless
  it actually did.
