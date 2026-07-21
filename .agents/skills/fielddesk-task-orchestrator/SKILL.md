---
name: fielddesk-task-orchestrator
description: Coordinate longer Fielddesk tasks end-to-end by clarifying scope and target state, selecting relevant repo Skills, using subagents where useful, tracking validation coverage, continuing through green internal steps, and stopping at the next real approval boundary. Use for larger implementation, investigation, review, migration, release-prep, or multi-step governance tasks that need orchestration across existing Fielddesk Skills.
---

# Fielddesk Task Orchestrator

## Overview

Use this as the main-agent workflow for longer Fielddesk tasks. It coordinates existing Skills; it does not replace their domain procedures or create a parallel implementation, review, migration, or release process.

## Start

1. Read `AGENTS.md` and the user request.
2. Define the expected final state:
   - local change only.
   - local commit ready for push.
   - pushed feature branch.
   - merge-ready branch.
   - approved merge or other external action.
3. Ask at most three combined questions only when the answer materially changes scope, target state, security, or approval boundaries.
4. If the prompt already defines those points, do not ask again.

Default for ordinary Fielddesk development tasks: complete the work, review and repair in scope, run relevant checks, inspect the diff, create one local commit, and stop before push.

## Skill Selection

Select only Skills the task actually needs.

- Defect analysis without edits: `fielddesk-investigation`.
- Scoped product/platform work: `fielddesk-feature-implementation`, then relevant reviews and `fielddesk-review-validation`.
- Schema or migration work: `fielddesk-database-migration`, tenant/security review when relevant, then review and release validation.
- AI-tool design: `fielddesk-ai-tool-design`, implementation only if approved, then tenant/security and review validation.
- Final PR, merge, release, or deploy readiness: `fielddesk-release-validation`.

Do not run all Skills sequentially as a default checklist.

## Execution Loop

1. Keep one visible task state: scope, current branch/worktree, intended files, validation already covering the current diff, blockers, and next approval boundary.
2. Continue automatically through green internal steps such as completed analysis, clean review, passing checks, ready commit, or branch comparison.
3. For findings inside the approved scope:
   - record the finding internally.
   - repair it.
   - rerun affected checks.
   - continue.
4. Stop only when a repair needs new scope, an architecture change needs approval, a real conflict cannot be resolved safely, checks cannot be made green within scope, or the next action requires approval.

## Validation Reuse

Before running a check, note what it covers:

- commit or diff.
- files or areas.
- result.
- whether later changes can affect it.

Do not repeat green checks when the covered diff is unchanged and later changes cannot affect the check. Docs-only changes do not automatically require full product checks. Code changes require affected checks and any needed merge/release gates again.

## Subagents

Use subagents only when the task has larger or independent streams, such as tenant/security review, migration review, frontend/mobile review, architecture investigation, or validation.

The main agent must define each subagent scope, prevent overlapping edits, collect condensed results, decide next steps, and own integration, final validation, and reporting. Subagents return findings to the main agent; they do not stop the workflow for user decisions.

## Approval Boundaries

Normally allowed within the original task scope:

- reading, analysis, safe worktrees, implementation, in-scope repair, tests/checks, documentation updates, staging, and local commits.

Require explicit approval unless already granted for the concrete target:

- push to an external remote.
- merge or push to `main`.
- deploy, restart, production migration, or production config change.
- external communication.
- destructive Git or filesystem actions.
- force-push.

When approval is needed, provide one combined approval text for the next safe external actions only when remote, branch, scope, risks, and merge strategy are explicit and validation is current.

## Final Report At Approval Stop

Keep the report short and current:

## Current State

- branch, HEAD, local changes, and status versus remote/main.

## Completed

- implementation, repairs, reviews, and commits.

## Valid Checks

- check, covered diff or commit, and result.

## Open Risks

- only real remaining risks.

## Next Actions

- actions that can now be performed safely.

## Approval Text

- one complete text the user can approve directly.
