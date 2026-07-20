---
name: fielddesk-pr-review
description: Review Fielddesk pull requests or local diffs for functional bugs, tenant isolation, authorization, migration risk, API contracts, tests, regressions, and unrelated changes. Use when the user asks for review, PR readiness, review comments, or risk assessment.
---

# Fielddesk PR Review

## Overview

Use a code-review stance. Prioritize real risks and behavioral regressions over style preferences.

## Required Context

- Read `AGENTS.md`.
- Read current architecture/security/testing docs relevant to the diff.
- Inspect the actual PR diff or local diff before making findings.
- Read surrounding code for each suspected issue.

## Review Areas

Check for:

- functional errors and missed edge cases.
- tenant isolation and tenant-scoped query shape.
- authorization, role checks, module permissions, and project/resource scope.
- data loss, migration, rollback, checksum, constraint, and index risks.
- race conditions, idempotency, retries, and transaction boundaries.
- error handling, logging, audit events, and secret exposure.
- API contract and response-shape regressions.
- type/syntax/runtime risks.
- missing tests, especially negative tenant/auth tests.
- unrelated changes, redesign, broad refactors, or UI side effects.
- mobile and desktop UI consequences when relevant.

## Finding Format

Each finding must include:

- severity: Critical, High, Medium, or Low.
- file and location.
- why it is a problem.
- concrete reproduction or risk scenario.
- recommended fix.

Do not list cosmetic preferences unless they create a real product, security, or maintenance risk.

## Stop Conditions

- Stop before editing code unless the user explicitly asks to fix findings.
- If the diff cannot be inspected reliably, report that limitation.
- If a suspected issue depends on unknown production state, label it as a risk or assumption rather than a proven defect.

## Final Response

Lead with findings ordered by severity. If there are no findings, say so clearly and list remaining test gaps or residual risks. Keep summaries secondary to the issues.
