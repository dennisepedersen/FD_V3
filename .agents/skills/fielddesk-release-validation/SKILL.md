---
name: fielddesk-release-validation
description: Validate Fielddesk release readiness, PR completion, local checks, migration status, deployment gates, and post-change verification. Use for readiness checks, release validation, merge/deploy preparation, or final validation after larger Fielddesk changes.
---

# Fielddesk Release Validation

## Overview

Use this skill to report what is ready, what was verified, and what remains blocked without inventing deploy or production access.

## Required Context

- Read `AGENTS.md`.
- Read `docs/AI_DEVELOPMENT_WORKFLOW.md`, `docs/development/TESTING.md`, and relevant runbooks in `docs/runbooks/`.
- For migrations, read the database migration skill and migration docs first.

## Workflow

1. Inspect repo state:
   - current branch, `git status --short`, and whether merge/rebase is in progress when relevant.
   - changed files and whether unrelated user changes exist.
2. Run local checks appropriate to scope:
   - `npm test`.
   - `npm run check`.
   - focused `npm run check:*` commands for narrower validation.
3. Validate migrations without applying them:
   - `npm run check:migrations`.
   - never alter old migrations to silence checksum or line-ending issues.
4. Validate PR/deploy only when explicitly in scope:
   - PR checks may use GitHub tooling when available and approved.
   - Render/deploy/live checks require explicit approval and correct environment separation.
5. Report exact outcomes:
   - command, result, and important failure lines.
   - unrun checks and why they were not run.
   - blockers versus residual risks.

## Stop Conditions

- Stop before merge, push, deploy, production migration, restart, environment change, or production checksum action unless explicitly approved.
- Stop if local state makes readiness unsafe to claim.
- Stop if required credentials or environment identity cannot be verified without exposing secrets.

## Final Response

State readiness plainly. Include changed files, branch/status context, each check run with result, external checks not run, blockers, limitations, and exact next steps.
