# FD UI/UX Principles

Status: current UI/UX governance principles
Scope: shared product design rules for humans, Codex, and future AI agents
Last updated: 2026-06-04

This document describes Fielddesk UI/UX principles across current static tenant/admin surfaces and future module/app-shell work. It does not define a frontend framework.

## 1. Product Character

Fielddesk UI must feel operational, compact, trustworthy, and field-ready.

It is not a marketing surface. It is a daily work tool for project leaders, technicians, tenant admins, and future module users.

## 2. Existing Principles

Current principles already present in FD docs and module definitions:

- Mobile first for field-facing workflows.
- Backend-owned permissions; frontend only renders allowed data.
- Project-centered module surfaces where relevant.
- Compact operational dashboards.
- Dashboard summaries should lead to action, not become full worklists.
- Prototype UX may inform product design, but prototype storage/security assumptions do not carry over.
- Static tenant/admin pages are current surfaces; final app shell/framework remains open.

## 3. Decided Shared Principles

### Mobile First

Field workflows must work on narrow screens first. Desktop may provide denser views, tables, drawing tools, and multi-panel workspaces, but mobile cannot be an afterthought.

### Drawer First

Use drawers for detail, create/edit, contextual inspection, and secondary flows when the user should stay anchored in a list, dashboard, project, or drawing context.

Use full pages for primary workspaces such as project detail, placement/drawing work, report preview, and admin areas.

### Progressive Disclosure

Show the next useful decision first. Advanced settings, filters, metadata, raw integration details, audit trails, and diagnostics should be discoverable without crowding the main workflow.

### Cards Before Tables Where Scanning Matters

Use cards for mobile scanning, dashboard summaries, KPI panels, and repeated work items with actions.

Use tables/data grids for dense comparison, admin lists, finance/economy data, integration logs, audit views, and batch operations.

### Consistent Actions

Actions should keep stable wording, placement, and visual priority across modules:

- Primary action: top right on desktop, bottom/action bar or prominent header action on mobile.
- Secondary actions: near the object they affect or in a contextual menu.
- Destructive actions: visually separated, confirmation required, and backed by audit where relevant.
- Export/report actions: explicit and permission-aware.

### Dashboard Principles

Dashboards must answer:

- What needs attention now?
- What changed?
- What is blocked?
- What can I do from here?

Dashboard widgets should be small, comparable, and action-oriented. Avoid turning a dashboard into a long unstructured list.

### Form Principles

Forms should:

- Ask only for required fields first.
- Group advanced or rare fields.
- Show validation close to the field.
- Preserve user input on validation failure.
- Avoid making optional enrichment data mandatory.
- Clearly separate save, cancel, delete/archive, and export actions.

### Module Navigation Principles

Module navigation is discovery, not authorization.

Navigation should be driven by backend-owned module registry, tenant entitlement, permissions, and project context. Hidden navigation must never be treated as route security.

### Report And Preview Principles

Preview before final export when the output is user-facing, audit-sensitive, or shareable.

Reports must clearly distinguish live data, derived outputs, snapshots, and verified/approved outputs when those states exist.

### Empty, Error, And Loading States

States must be useful and honest:

- Empty states should explain what is missing and offer the next allowed action.
- Error states must not expose secrets, cross-tenant existence, raw tokens, or sensitive backend details.
- Loading states should not move layout unpredictably.
- If optional integration data is missing, show degraded-but-honest UI instead of fake content.

## 4. Placement And Module Workspace Principles

For drawing/PDF/placement workflows:

- Do not fake previews.
- Do not show markers outside the rendered surface.
- Use stable coordinates relative to the rendered page/image.
- Support zoom/pan without losing task context.
- On mobile, simplify controls and avoid dense sidebars.
- Placement changes should be reversible where practical.

## 5. Accessibility And Usability Direction

Minimum direction:

- Text must not overlap or rely on tiny clickable targets.
- Critical actions need clear labels or recognizable icons with accessible names.
- Color must not be the only status signal.
- Interactive elements must have stable size and layout.
- Long labels should wrap or truncate intentionally.

## 6. What Fielddesk UI Must Not Do

- Do not make frontend visibility the security model.
- Do not hide unavailable permissions as the only control.
- Do not use marketing-style hero pages for operational modules.
- Do not put massive decorative layouts in dashboards.
- Do not make mobile users operate desktop tables squeezed onto a phone.
- Do not show stale integration data as current truth.
- Do not treat generated reports as source data.
- Do not use localStorage/base64/dataUrl as production file truth.

## 7. Open Decisions

- Final frontend framework and app shell.
- Final navigation registry shape.
- Final token/session storage model for tenant UI.
- Final theming and tenant branding boundaries.
- Final accessibility standard/checklist.
- Final component library.
- Offline/PWA behavior.

## Related Docs

- `docs/ARCHITECTURE.md`
- `docs/SECURITY_MODEL.md`
- `docs/MODULE_CONTRACT.md`
- `docs/MODULE_MAP.md`
- `docs/PROJECT_CONTEXT_CONTRACT.md`
- `docs/REPORT_ENGINE_CONTRACT.md`
- `docs/STORAGE_CONTRACT.md`
- `docs/modules/restarbejde/MODULE_DEFINITION.md`
