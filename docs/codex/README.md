# Fielddesk Codex Working Structure

Status: current Codex guidance
Scope: repository-based guidance for Codex work, repo-specific Skills,
subagent usage, MCP direction, and future Fielddesk AI-tools

## Purpose

This folder keeps durable Codex guidance in the repository instead of relying on
chat history. It complements the canonical Fielddesk docs, especially
`docs/00_MASTER.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY_MODEL.md`,
`docs/AI_GOVERNANCE.md`, and `docs/development/TESTING.md`.

## AGENTS.md

`AGENTS.md` is the short always-read rule set for Codex. It should contain only
rules that apply to almost every task: tenant isolation, migration safety,
scope control, Danish user-facing text, validation, and final reporting.

Do not put long procedures in `AGENTS.md`. Put repeatable procedures in Skills.

## Skills

Repo-specific Skills live in `.agents/skills/`.

Current Skills:

- `fielddesk-task-orchestrator` - coordinate longer Fielddesk tasks across
  relevant Skills, validation, commits, and approval boundaries.
- `fielddesk-database-migration` - create or review tenant-safe SQL migrations.
- `fielddesk-tenant-security-review` - review tenant isolation and access risks.
- `fielddesk-feature-implementation` - implement scoped Fielddesk changes.
- `fielddesk-investigation` - investigate defects and regressions without
  changing code.
- `fielddesk-ai-tool-design` - design secure, tenant-scoped AI-tool contracts.
- `fielddesk-pr-review` - review PRs/local diffs for real risks.
- `fielddesk-review-validation` - coordinate post-implementation review, repair,
  and validation before merge or handoff.
- `fielddesk-release-validation` - validate checks, PR/release gates, and
  readiness.

Add a new Skill only when a repeated Fielddesk task has distinct procedure,
validation, or stop conditions that would otherwise be re-explained in prompts.
Use lowercase hyphenated names, keep frontmatter short, and keep detailed steps
inside `SKILL.md`. Avoid copying `AGENTS.md`; link back to it instead.

Use `fielddesk-task-orchestrator` for longer tasks that need one main workflow
to clarify target state, choose relevant Skills, coordinate subagents when useful,
reuse validation, continue through green internal steps, and stop at the next
approval boundary. By default, ordinary development work should reach a local
commit ready for push unless the prompt defines another final state. It should
ask at most three combined questions, and only when scope, target state,
security, or approval boundaries are genuinely unclear. Push, merge, deploy,
production migration/config changes, destructive actions, and force-push still
require explicit approval for the concrete target.

Use `fielddesk-review-validation` after larger implementations are complete. It
coordinates scope review, tenant/security checks, repair loops, and validation;
it can point to `fielddesk-pr-review` for detailed findings,
`fielddesk-feature-implementation` for in-scope repairs, and
`fielddesk-release-validation` for final readiness gates.

Recurring Codex mistakes should become durable guidance in this order:

1. If it applies almost everywhere, update `AGENTS.md`.
2. If it applies to one repeated workflow, update or add a Skill.
3. If it is architecture/product truth, update the canonical doc or decision.
4. If it is temporary task context, keep it in the prompt or PR notes.

## Subagents

The current Codex environment exposes runtime subagent tools, but this task did
not find a documented repo configuration format for declaring persistent
subagent roles. Do not invent `.agents` role schemas until Codex documents a
supported format.

Recommended runtime roles for larger tasks:

| Role | Scope | Expected result |
| --- | --- | --- |
| Architecture and planning | Cross-module design, docs, scope boundaries | Condensed plan, conflicts, assumptions |
| Database and migrations | Schema, SQL, indexes, data risk | Migration risks and validation needs |
| Backend and API | Routes, services, repositories, contracts | Implementation notes or focused findings |
| Frontend and UX | Tenant/admin UI, mobile/desktop behavior | UI impact, screenshots/check notes when run |
| Tenant security | Tenant resolution, RBAC, project/resource scope | Findings by severity |
| Tests and validation | Unit/static/check coverage | Commands run, failures, missing coverage |

Use subagents for larger features, complex migrations, tenant security reviews,
and cross-cutting refactors. Do not use them automatically for small fixes.
Each delegated role must keep its scope, avoid editing other agents' areas
without coordination, and return condensed findings to the main agent.

The main agent remains responsible for the overall plan, conflict handling,
integration, final validation, and final report.

## MCP And External Systems

Do not add new MCP connections to Render, production databases, logs, storage,
mail, or other external systems as part of ordinary repo work. GitHub is already
part of the workflow where available.

Future read-only MCP candidates may include GitHub PR/check metadata, Render
service status/log reads, database migration status reads, and passive health
checks. Any write action needs explicit approval, including deploys, restarts,
environment variable changes, production migrations, user/account changes,
mail sends, and data repair jobs.

Tenant and environment separation must be explicit. Production access should be
strictly limited, audited where possible, and never inferred from local config.
No autonomous tool should be able to delete tenant data, change credentials,
rotate secrets, update production checksums, run production migrations, merge,
deploy, or send tenant-facing communication without a clear approval boundary.

## Future Fielddesk AI-Tools

Future AI-tools should be small backend functions with structured inputs and
outputs. They should be callable directly, through Programmatic Tool Calling,
from Fielddesk web, from mobile, and later from Edge One. The backend validates
tenant, user, role, module permission, and project/resource access on every
call; JavaScript programs and AI models are never the security boundary.

Avoid broad tools such as `get_everything_about_project()`. Prefer narrow,
read-only tools first:

| Tool | Purpose | Input | Compact output | Auth and behavior |
| --- | --- | --- | --- | --- |
| `get_project_summary` | Summarize one accessible project | `project_id`, optional sections | status, owner, dates, key metrics | tenant/project read access; read-only; direct/programmatic allowed |
| `get_overdue_activities` | Find overdue work for a project or user scope | `project_id` or scope, limit | list of overdue items with dates | tenant/project scope; read-only; direct/programmatic allowed |
| `get_blocking_qa` | Find QA threads blocking progress | `project_id`, status filters, limit | thread ids, titles, status, participants | module and project QA read access; read-only |
| `get_equipment_counts` | Count project equipment by type/status | `project_id`, equipment type | grouped counts and exceptions | project/module access; read-only |
| `get_resource_availability` | Return resource availability windows | date range, resource ids or group ids | availability buckets, conflicts | resource visibility policy; read-only |
| `get_project_messages_summary` | Summarize project communication | `project_id`, date range, limit | themes, unresolved asks, latest timestamps | project/message permission; read-only |
| `get_project_risks` | Return structured project risk indicators | `project_id`, risk categories | risk list, severity, evidence refs | project/module permissions; read-only |
| `get_document_metadata` | List accessible file/document metadata | `project_id`, module/resource filters | ids, names, types, dates, owners | storage metadata access; read-only |

Each tool contract must define purpose, input, output, authorization, error
behavior, side effects, direct/programmatic eligibility, whether user approval
is required, and how large raw data is reduced before model use.

Standard error behavior should be fail-closed and non-leaky: return stable
errors such as unauthorized, forbidden, not found, unsupported scope, or limit
exceeded without revealing whether another tenant's data exists.

Side-effect tools should not execute autonomously by default. Actions such as
creating tasks, updating statuses, sending messages, exporting files, or
triggering sync should require an explicit user approval boundary and audit
event design before implementation.
