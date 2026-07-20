---
name: fielddesk-investigation
description: Investigate Fielddesk defects, regressions, confusing behavior, failed checks, or suspected data/API/security issues without changing code. Use for read-only analysis that gathers evidence, tests hypotheses, identifies likely root cause, assesses impact, and recommends next steps.
---

# Fielddesk Investigation

## Overview

Use this skill for analysis only. Do not edit code, migrations, UI, data, config, or behavior while using it.

## Required Context

- Read `AGENTS.md`.
- Read `docs/00_MASTER.md`, `docs/DOC_INDEX.md`, and `docs/development/TESTING.md`.
- Read `docs/SECURITY_MODEL.md` before investigating tenant, auth, RBAC, RLS, audit, storage, file, export, or module access behavior.
- Read relevant module, route, service, repository, mapping, decision, test, and runbook docs for the suspected area.

## Workflow

1. Understand the problem:
   - restate the observed behavior, expected behavior, affected user/tenant/module, and known trigger.
   - separate facts from assumptions using `verified`, `observed`, `hypothesis`, and `unclear` where useful.
2. Identify relevant areas:
   - map the likely frontend, API route, service, repository, database, background job, integration, and test surfaces.
   - include tenant and permission boundaries when the behavior touches tenant-owned data.
3. Gather evidence:
   - inspect code, docs, tests, schemas, migrations, local outputs, and available logs.
   - review logs only when they are available in the current environment and do not expose secrets.
   - do not call production systems or external services unless explicitly approved.
4. Trace flows:
   - trace API request/response behavior from route to service/repository and back.
   - trace database reads/writes, tenant filters, joins, constraints, indexes, and transaction boundaries.
   - trace background jobs, sync, storage, mail, or tool-call context when relevant.
5. Form and verify hypotheses:
   - list plausible causes.
   - test each hypothesis with read-only evidence, focused commands, or existing tests when safe.
   - discard or downgrade hypotheses that are not supported.
6. Identify likely root cause:
   - state the strongest supported cause and why alternatives are less likely.
   - mark unresolved parts as `unclear` instead of guessing.
7. Assess impact:
   - describe affected tenants, roles, modules, data, checks, and user workflows as precisely as evidence allows.
   - call out tenant-security impact separately.
8. Recommend next steps:
   - propose one or more repair options with tradeoffs.
   - identify tests/checks that should validate the future fix.

## Stop Conditions

- Stop before changing files, data, migrations, config, or external systems.
- Stop if investigation requires secrets, production access, deploys, or data changes that were not explicitly approved.
- Stop if tenant isolation may be at risk and evidence is insufficient to continue safely.

## Final Response

Report documented findings, hypotheses, uncertainties, likely root cause, impact, recommended next steps, and checks or commands run. Be explicit about what was not verified.
