---
name: fielddesk-ai-tool-design
description: Design future Fielddesk AI-tools and tool-call contracts with tenant validation, authorization, structured inputs/outputs, compact responses, fail-closed errors, direct and programmatic tool-calling support, and clear read-only versus side-effect boundaries. Use whenever proposing or specifying a new AI tool.
---

# Fielddesk AI Tool Design

## Overview

Use this skill to design small, secure Fielddesk backend tools before implementation. The AI model, client JavaScript, mobile app, or Programmatic Tool Calling program is never the security boundary.

## Required Context

- Read `AGENTS.md`.
- Read `docs/codex/README.md`, especially the future AI-tools section.
- Read `docs/SECURITY_MODEL.md`, `docs/ARCHITECTURE.md`, `docs/DATA_POLICY.md`, and relevant module/API/storage docs.

## Design Rules

- Prefer one small bounded function over broad catch-all tools.
- Define clear input and output schemas before implementation.
- Keep output compact, structured, and purpose-specific.
- Reduce large raw datasets in backend code before model use.
- Validate tenant context, authenticated user, role, module permission, and project/resource scope inside the backend for every call.
- Never rely on AI instructions, client code, hidden prompts, or programmatic callers for authorization.
- Mark each tool as read-only or side-effecting.
- Allow direct tool calling and Programmatic Tool Calling only when the same backend authorization and approval rules apply.
- Use fail-closed error behavior with non-leaky errors such as unauthorized, forbidden, not found, unsupported scope, or limit exceeded.
- Require an explicit approval boundary and audit design before side-effect tools can create, update, delete, export, send, sync, or trigger tenant-impacting work.

## Workflow

1. Define purpose:
   - state the user problem and what the tool must not do.
   - reject broad designs such as project-wide raw dumps.
2. Define contract:
   - specify name, input fields, output fields, limits, sorting, filters, and compactness rules.
   - define error responses and empty-state behavior.
3. Define security:
   - describe tenant resolution, user authorization, module permission, project/resource scope, and audit needs.
   - state whether the tool is read-only or has side effects.
4. Define calling modes:
   - state whether direct tool calling is allowed.
   - state whether Programmatic Tool Calling is allowed.
   - state whether Fielddesk web, mobile, or later Edge One may call it.
   - state where user approval is required.
5. Define data reduction:
   - describe how raw rows, documents, messages, files, logs, or integration payloads are filtered and summarized before model use.
   - set limits that prevent large unbounded outputs.
6. Validate design:
   - compare against existing Fielddesk docs, data policy, module contracts, and tenant security rules.
   - identify required tests before implementation.

## Stop Conditions

- Stop if the tool would expose raw tenant datasets without backend reduction.
- Stop if tenant or authorization enforcement is delegated to the AI, frontend, or caller program.
- Stop if a side-effecting tool lacks explicit approval and audit boundaries.
- Stop if the required module/data ownership contract is undocumented or contradictory.

## Final Response

Provide a concise tool contract with purpose, input, output, authorization, tenant scope, error behavior, side-effect status, calling modes, approval boundary, data-reduction strategy, required tests, assumptions, and open questions.
