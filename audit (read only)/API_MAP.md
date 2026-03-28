# API_MAP.md — Fielddesk V2 API Audit

Generated: 2026-03-22
Source: `backend/server.js` + `backend/modules/qa/routes.js`
Status: VERIFIED from code

---

## Auth Context Types

The app detects request type via `detectAppType()`:
- **tenant** — normal tenant app request (subdomain or x-tenant-slug header)
- **admin** — requests to admin app (UNKNOWN: detection logic not fully read, likely path-based)
- **sandbox** — sandbox app (known sandbox route)

---

## Middleware

| Middleware | Function | File |
|---|---|---|
| `requireAppAuthMiddleware` | Validates Bearer token, enforces tenant match | `middleware/appAuth.js` |
| `requireAdminAppAuthMiddleware` | Like above, but fallback tenant=`_admin`, allowTenantBypass=true | `server.js` |
| `requireSyncSecretMiddleware` | Validates `x-sync-secret` header | `middleware/adminAuth.js` |
| `requireAppType(...)` | Checks `req.appType` matches allowed types | `server.js` |
| `requireGlobalAdmin` | Checks token role === 'global_admin' | `server.js` |
| `blockSandbox` | Returns 403 for sandbox app types | `server.js` |

---

## Public Endpoints (no auth)

### POST /api/auth/login
- **Input:** `{ username, password }`
- **Headers:** optional `x-tenant-slug`
- **Flow:**
  1. If appType=`sandbox` → 403
  2. If appType=`admin` → validates against `adminUser` object (env-configured)
  3. Else → tries `tenant_admin_credentials` table (bcrypt compare)
  4. Fallback → `defaultUsers` object (owner/member, env-configured)
- **Output:** `{ token, expiresAt, username, role }`
- **Tables hit:** `tenant_admin_credentials`

### POST /api/auth/sandbox
- **Input:** none (appType must be `sandbox`)
- **Output:** sandbox token with tenant_id=`dep`, role=`sandbox_user`
- **Tables hit:** none

### GET /api/tenant-admin/invite/:token
- **Input:** invite token in path
- **Output:** invite metadata + tenant info
- **Tables hit:** `tenant_admin_invites`, `tenants`, `tenant_first_admin_contacts`

### POST /api/tenant-admin/activate
- **Input:** `{ token, password }`
- **Output:** new tenant admin credentials created
- **Tables hit:** `tenant_admin_invites`, `tenant_admin_credentials`, `tenants`

---

## Tenant App Endpoints (`/api/*`, requireAppAuth)

### GET /api/me
- **Auth:** tenant, sandbox
- **Output:** resolved user identity, role, fdRole, ekRoles, features, permissions
- **Tables hit:** `tenant_user_mappings`, `users`, `tenant_features`
- **Notes:** Merges role-based features + DB tenant features

### GET /api/my-projects/open
- **Auth:** tenant, sandbox
- **Query:** `?scope=mine|team|...`
- **Output:** list of open projects
- **Tables hit:** `users`, `projects`, `tenant_user_mappings`
- **Notes:** scope=`mine` → DB lookup via `resolveUserUuidFirst`. Other scopes → in-memory fallback

### GET /api/projects
- **Auth:** tenant, sandbox
- **Query:** `?scope=mine|team|...`
- **Output:** list of projects
- **Tables hit:** `users`, `projects`, `tenant_user_mappings`
- **Notes:**
  - Contains DEV-only override for username `dep` (when not production + localhost)
  - ⚠ Hardcoded `dep` username fallback in dev path

### GET /api/projects/:projectId
- **Auth:** tenant, sandbox
- **Query:** `?refresh=live`
- **Output:** project detail, optionally live-refreshed from E-komplet
- **Tables hit:** `users`, `projects`, `tenant_user_mappings`
- **Notes:** live refresh fetches directly from E-komplet API; `dep` dev override also present

### GET /api/cases
- **Auth:** tenant, sandbox
- **Query:** `?scope=mine|...`
- **Output:** list of open projects (cases)
- **Tables hit:** `users`, `projects`, `tenant_user_mappings`
- **Notes:** Uses same logic as /api/projects; alias endpoint

### GET /api/time-entries
- **Auth:** tenant, sandbox
- **Query:** `?scope=mine|...`
- **Output:** time entries from in-memory state
- **Tables hit:** (in-memory only, no DB)
- **Notes:** ⚠ No DB backend — data comes from `getScopedTimeEntries()` (sync.js memory)

### GET /api/my-projects/:projectId/time-entries
- **Auth:** tenant, sandbox
- **Output:** fitterhours entries for a project
- **Tables hit:** `users`, `projects`, `tenant_user_mappings`, `ek_fitterhours`
- **Access check:** user must have project in their scoped project list

### GET /api/my-projects/:projectId/time-summary
- **Auth:** tenant, sandbox
- **Output:** aggregated time summary for a project
- **Tables hit:** `users`, `projects`, `tenant_user_mappings`, `ek_fitterhours`

### GET /api/time-categories
- **Auth:** tenant, sandbox
- **Output:** fitter categories
- **Tables hit:** `ek_fittercategories`

### GET /api/time/approval-dashboard
- **Auth:** tenant only
- **Output:** approval counts for time review
- **Tables hit:** `ek_fitterhours`
- **Access:** leader roles only (owner, tenant_admin, project_manager)

### GET /api/time/review-entries
- **Auth:** tenant only
- **Query:** `?limit=N`
- **Output:** time entries requiring review, with review reason
- **Tables hit:** `ek_fitterhours`
- **Access:** leader roles only

### GET /api/sync/time-status
- **Auth:** tenant, requireAppType('tenant')
- **Output:** sync state for fitterhours_bootstrap, fitterhours_delta, fittercategories
- **Tables hit:** `tenant_sync_state`, `tenant_fitterhours_bootstrap_state`

### GET /api/sync/state
- **Auth:** tenant, sandbox
- **Output:** in-memory sync state for tenant
- **Tables hit:** none (in-memory)

---

## Tenant Admin Endpoints (must be role=owner|global_admin)

### GET /api/tenant/onboarding/users
- **Auth:** tenant, role=owner|global_admin
- **Output:** users from E-komplet for onboarding
- **Tables hit:** `tenant_integration_credentials`, `tenant_user_mappings`, `users`

### POST /api/tenant/onboarding/users/mapping
- **Auth:** tenant, role=owner|global_admin, blockSandbox
- **Input:** `{ rows: [...], status: 'draft'|'approved' }`
- **Output:** save counts
- **Tables hit:** `tenant_user_mappings`

### GET /api/tenant/user-mapping/preview
- **Auth:** tenant, role=owner|global_admin
- **Output:** preview of user mapping
- **Tables hit:** `tenant_user_mappings`, `users`

### GET /api/tenant/integrations/ekomplet
- **Auth:** tenant, hasTenantIntegrationAccess
- **Output:** ekomplet integration config (masked api key)
- **Tables hit:** `tenant_integration_credentials`

### POST /api/tenant/integrations/ekomplet
- **Auth:** tenant, hasTenantIntegrationAccess, blockSandbox
- **Input:** `{ sitename, api_key }`
- **Output:** created integration row
- **Tables hit:** `tenant_integration_credentials`

### PUT /api/tenant/integrations/ekomplet
- **Auth:** tenant, hasTenantIntegrationAccess, blockSandbox
- **Input:** `{ sitename, api_key }`
- **Output:** updated integration row
- **Tables hit:** `tenant_integration_credentials`

### POST /api/tenant/integrations/ekomplet/test
- **Auth:** tenant, hasTenantIntegrationAccess, blockSandbox
- **Output:** test result + updated test status
- **Tables hit:** `tenant_integration_credentials`, `tenants`

### GET /api/tenant/integrations/ekomplet/status
- **Auth:** tenant, hasTenantIntegrationAccess
- **Output:** integration sync status view
- **Tables hit:** `tenant_integration_credentials`, `tenant_sync_state`

---

## QA Module Endpoints (`/api/qa/*`)

Mounted via `qaRoutes` from `modules/qa/routes.js`.
All require appAuth (middleware applied globally to `/api`).

### POST /api/qa/threads
- **Auth:** tenant, sandbox (not writable in sandbox)
- **Input:** `{ title, contextType, contextId }`
- **Output:** created thread
- **Tables hit:** `qa_threads`

### GET /api/qa/threads
- **Auth:** tenant, sandbox
- **Query:** `?contextType, contextId, status, limit`
- **Output:** list of threads
- **Tables hit:** `qa_threads`

### GET /api/qa/threads/:threadId
- **Auth:** tenant, sandbox
- **Output:** thread + messages
- **Tables hit:** `qa_threads`, `qa_messages`, `qa_thread_views`

### POST /api/qa/threads/:threadId/messages
- **Auth:** tenant, sandbox (not writable in sandbox)
- **Input:** `{ role, content }`
- **Output:** new message
- **Tables hit:** `qa_messages`, `ai_usage_logs`
- **Services:** calls AI provider (UNKNOWN: provider config not fully traced here)

### POST /api/qa/threads/:threadId/views
- **Auth:** tenant, sandbox (not writable in sandbox)
- **Input:** `{ lastViewedMessageId }`
- **Tables hit:** `qa_thread_views`

### PATCH /api/qa/threads/:threadId/status
- **Auth:** tenant, sandbox (not writable in sandbox)
- **Input:** `{ status }`
- **Tables hit:** `qa_threads`

---

## Internal Sync Endpoints (`/internal/*`, requireSyncSecret)

Protected by `x-sync-secret` header only — NOT by app token.

### POST /internal/sync/bootstrap
- **Input:** `{ tenantId, usersPageSize, projectsPageSize, usersMaxPages, projectsMaxPages }`
- **Output:** sync result
- **Tables hit:** `users`, `projects`, `tenant_sync_state`, `tenant_integration_credentials`

### POST /internal/sync/delta
- Same as bootstrap but delta mode

### POST /internal/sync/slow
- Same as bootstrap but slow-sync mode

### GET /internal/sync/debug
- **Query:** `?tenantId`
- **Output:** in-memory debug sample

### POST /internal/sync/fitterhours/bootstrap
- **Input:** `{ tenantId, pageSize }`
- **Output:** bootstrap run result
- **Tables hit:** `ek_fitterhours`, `tenant_fitterhours_bootstrap_state`, `tenant_integration_credentials`

### GET /internal/sync/fitterhours/bootstrap/status
- **Query:** `?tenantId`
- **Tables hit:** `tenant_fitterhours_bootstrap_state`

### POST /internal/sync/fitterhours/delta
- **Input:** `{ tenantId }`
- **Tables hit:** `ek_fitterhours`, `tenant_sync_state`, `tenant_integration_credentials`

### GET /internal/sync/time/health
- **Query:** `?tenantId`
- **Output:** health metrics for time module
- **Tables hit:** `tenant_sync_state`, `tenant_fitterhours_bootstrap_state`, `ek_fitterhours`

### POST /internal/sync/time/init-schema
- **Input:** `{ tenantId }`
- **Output:** schema init result + health
- Runs `initPostgresSchema()` — creates all tables

### GET /internal/ekomplet/raw
- **Query:** `?path=/api/...` + any other params
- **Output:** raw E-komplet API response (proxied)
- **Tables hit:** `tenant_integration_credentials` (UNKNOWN — may use global key from env)

### GET /internal/ekomplet/raw/projects/:version/:id
- **Params:** version=v3|v4, id=project id
- **Output:** raw E-komplet project data

---

## Global Admin Endpoints (`/admin/*`, requireAdminAppAuth + requireGlobalAdmin)

All require appType=`admin` AND valid admin token AND role=`global_admin`.

### GET /admin/tenants
- **Query:** `?status`
- **Output:** list of tenants
- **Tables hit:** `tenants`

### POST /admin/tenants
- **Input:** `{ tenant_id, name, status }`
- **Output:** created tenant
- **Tables hit:** `tenants`

### GET /admin/tenants/:id
- **Tables hit:** `tenants`

### PUT /admin/tenants/:id
- **Input:** `{ name?, status? }`
- **Tables hit:** `tenants`

### POST /admin/tenants/:id/advance-onboarding
- Advances `onboarding_state` via state machine
- **Tables hit:** `tenants`

### GET /admin/tenants/:id/tenant-admin
- **Tables hit:** `tenant_first_admin_contacts`, `tenants`

### POST /admin/tenants/:id/tenant-admin
- **Input:** `{ email, full_name, status }`
- **Tables hit:** `tenant_first_admin_contacts`, `tenants`

### PUT /admin/tenants/:id/tenant-admin
- **Tables hit:** `tenant_first_admin_contacts`, `tenants`

### GET /admin/tenants/:id/tenant-admin/invite
- **Tables hit:** `tenant_admin_invites`, `tenant_first_admin_contacts`, `tenants`

### POST /admin/tenants/:id/tenant-admin/invite
- **Input:** `{ expires_in_hours }`
- **Output:** invite token (plaintext, ONE TIME), invite_link
- **Tables hit:** `tenant_admin_invites`, `tenant_first_admin_contacts`, `tenants`

---

## Static / Frontend

- `GET /` → serves `public/index.html`
- `GET /manifest.webmanifest` → manifest file
- `GET /sw.js` → service worker
- All unknown routes → SPA fallback (index.html)

---

## Known Gaps / Findings

| # | Observation | Severity |
|---|---|---|
| 1 | `/api/time-entries` serves in-memory data only — no DB backend | HIGH |
| 2 | `/api/cases` is a duplicate alias of `/api/projects` | LOW |
| 3 | DEV hardcoded `dep` username override in `/api/projects` and `/api/projects/:id` | MEDIUM |
| 4 | `/internal/ekomplet/raw` uses global env API key — NOT per-tenant credential | UNKNOWN |
| 5 | `SANDBOX_TENANT_ID` hardcoded as `"dep"` in server.js | HIGH |
| 6 | No audit logging endpoints visible | CRITICAL UNKNOWN |
| 7 | QA module AI provider config (which LLM, key source) not traced fully | UNKNOWN |
