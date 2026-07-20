---
name: fielddesk-tenant-security-review
description: Review Fielddesk changes for tenant isolation, authorization, server-side scope enforcement, cross-tenant data access, exports, files, background jobs, and tenant-aware tests. Use for security audits, PR review slices, API/module reviews, or suspected tenant boundary issues.
---

# Fielddesk Tenant Security Review

## Overview

Use this skill for read-first tenant security review. Do not automatically fix major findings unless the user explicitly asks for implementation.

## Required Context

- Read `AGENTS.md`.
- Read `docs/SECURITY_MODEL.md`, `docs/ARCHITECTURE.md`, and `backend/docs/standards/fd_implementation_rules.md`.
- Read relevant route, service, repository, migration, module, storage, sync, and test files.

## Review Checklist

Check:

- how tenant context is resolved and compared with auth token claims.
- whether backend validates user role, module permission, project/resource scope, and tenant lifecycle before data access.
- whether client-supplied `tenant_id`, `project_id`, scope, role, or module key can manipulate access.
- whether every tenant-owned query filters by tenant and joins tenant-owned tables on `tenant_id`.
- whether reads, writes, exports, reports, file metadata, blob access, and signed URLs are tenant/project/resource scoped.
- whether background jobs, sync jobs, queues, mail, audit, and future tool calls preserve tenant context.
- whether error messages, logs, response shapes, counts, or timing leak data across tenants.
- whether tests cover cross-tenant denial, wrong-host/wrong-token mismatch, unauthorized role, and unsupported scope attempts.

## Severity

- Critical: proven or highly likely cross-tenant read/write, auth bypass, secret exposure, destructive unauthorized action, or public file/data leak.
- High: missing server-side authorization on sensitive tenant data, unsafe broad tenant access, or missing project/resource scope on write/export/file paths.
- Medium: incomplete defense-in-depth, missing negative tests for sensitive paths, ambiguous scope behavior, or error/log leakage with limited impact.
- Low: documentation gaps, minor hardening, or non-blocking consistency issues.

## Stop Conditions

- Stop before changing behavior unless implementation was explicitly requested.
- Stop and mark `unclear` if tenant isolation cannot be proven from docs, code, tests, or schema.
- Stop if the requested change would weaken tenant isolation, RBAC, audit, storage security, or secret handling.

## Final Response

Lead with findings ordered by severity. Each finding must include severity, file/location, why it matters, concrete risk or reproduction scenario, and a recommended fix. Then list tests/checks reviewed or run, assumptions, and any residual risk.
