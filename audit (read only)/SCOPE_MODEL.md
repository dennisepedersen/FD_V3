# SCOPE_MODEL.md
## Fielddesk V2 — Scope and Access Control Audit

**Audit type:** Read-only. No code changes.
**Source of truth:** `backend/server.js`, `backend/sync.js`, `backend/public/config/navigationRegistry.js`, `backend/public/router.js`
**Date:** 2026-03

---

## 1. Scope Values

Three scope identifiers are used across the codebase. Only `mine` and `all` are explicitly enforced in backend logic. `team` is accepted as a query param but routes through the same logic path as `mine` for most endpoints.

| Scope   | Description                                           | Enforced in DB? |
|---------|-------------------------------------------------------|-----------------|
| `mine`  | Filter to projects where user is responsible/assigned | Yes (DB lookup) |
| `team`  | Intended as team/group subset                         | No — falls to in-memory |
| `all`   | All open projects; only accessible to owner/admin     | In-memory only  |

Default scope when query param is absent: `mine`.

---

## 2. Scope-Gated Endpoints

### `GET /api/projects?scope=`
- **Default:** `mine`
- **scope=mine:** → `resolveUserUuidFirst()` → DB lookup (`getOpenProjectsForUser`) → `getScopedOpenProjects()` as fallback
- **scope≠mine (all/team):** → `getScopedOpenProjects({ user, scope })` from in-memory snapshot
- **Owner + scope=all:** returns all open projects from in-memory snapshot
- **All others + scope=all:** filtered to `matchesResponsible(project, user)`

### `GET /api/my-projects/open?scope=`
- **Default:** `mine`
- **scope=mine:** Same as above — DB lookup first, in-memory fallback
- **scope≠mine:** `getScopedOpenProjects()` from in-memory snapshot only

### `GET /api/cases?scope=`
- `getScopedCases()` — delegates entirely to `getScopedOpenProjects()` — same behavior

### `GET /api/time-entries?scope=`
- `getScopedTimeEntries()` — **in-memory only**
- No DB backend
- Filters `fitterhours` in-memory snapshot by project ID match to scoped projects
- **INCONSISTENCY:** `mine` scope for projects uses DB; `mine` scope for time-entries uses in-memory only

### `GET /api/approval-dashboard?scope=`
- Requires leader role: `owner`, `tenant_admin`, or `project_manager`
- Non-leaders → 403 before any scope resolution

### `GET /api/review-entries`
- Role-gated: same leader roles required

---

## 3. Backend Scope Implementation

### `getScopedOpenProjects({ user, scope })`
Location: `backend/sync.js` line ~998

```
Input:  { user, scope = "mine" }
Logic:
  1. Get tenantData from in-memory tenantStateById map
  2. Filter to open projects (status != closed)
  3. If user.role === "owner" OR "global_admin" AND scope === "all":
     → return all open projects
  4. Else: filter openProjects where matchesResponsible(project, user)
Output: filtered project array
```

**Critical note:** Role check for `scope=all` is **not** documented in API contracts — it is implicit in the implementation. Non-owner roles receive filtered results regardless of scope param.

### `getScopedCases({ user, scope })`
- Thin wrapper around `getScopedOpenProjects`. No separate case model exists.

### `getScopedTimeEntries({ user, scope })`
Location: `backend/sync.js` line ~1017

```
Input:  { user, scope = "mine" }
Logic:
  1. Call getScopedOpenProjects to get scoped project IDs/numbers
  2. Build Sets from project id and number
  3. Filter tenantData.fitterhours where any project reference field matches these
Output: filtered fitterhours entries
```

---

## 4. User Identity Resolution for Scope

For `scope=mine` the DB path requires user UUID resolution:

```
resolveUserUuidFirst({ tenantId, appAuthUser, resolvedUser, manualMappings })
  → tries to find UUID from:
    1. resolvedUser.uuid (from appAuth token)
    2. Manual identity mapping file (identity_manual_mapping.json)
    3. DB lookup by email or username in users table
  → falls back to in-memory scoped lookup if UUID not found

getOpenProjectsForUser({ tenantId, userUuid })
  → DB query: projects WHERE assigned_user_uuid = $userUuid AND status ≠ closed
```

Fallback chain on identity failure:
1. UUID found → DB query
2. No UUID → `getScopedOpenProjects()` from in-memory

**INCONSISTENCY:** Dev override in `mine` scope — when on localhost AND `NODE_ENV !== "production"`, `username` is set to `"dep"` on `/api/projects` and related routes.

---

## 5. Role-Based Scope Restrictions

| Role              | scope=mine | scope=all | approval-dashboard | review-entries |
|-------------------|------------|-----------|-------------------|----------------|
| `owner`           | ✅ own     | ✅ all    | ✅                | ✅             |
| `tenant_admin`    | ✅ own     | ✅ filtered | ✅              | ✅             |
| `project_manager` | ✅ own     | ✅ filtered | ✅              | ✅             |
| `foreman`         | ✅ own     | ✅ filtered | ❌ 403           | ❌ 403         |
| `technician`      | ✅ own     | ✅ filtered | ❌ 403           | ❌ 403         |
| `support`         | ✅ own     | ✅ filtered | ❌ 403           | ❌ 403         |
| `sandbox_user`    | ✅ read-only | ✅ read-only | ❌ 403        | ❌ 403         |

**Note:** `scope=all` does NOT give all projects unless role is `owner` or `global_admin`. For all other roles it returns the same filtered set as `mine`.

---

## 6. Feature Flags

### Storage
Feature flags are stored per-tenant in the `tenant_features` table:

```sql
tenant_features (
  tenant_id TEXT NOT NULL,
  feature_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, feature_key)
)
```

### Resolution
`listEnabledTenantFeatures({ tenantId })` → returns enabled feature keys as string array.

Merged with role-based defaults in `GET /api/me` response:
```json
{
  "features": ["time", "projects", ...],
  "permissions": ["can_review_time", ...]
}
```

### Frontend Enforcement
`canAccessModule(ctx, moduleConfig)` in `backend/public/router.js`:

```
Check 1: moduleConfig.feature_key → must be in ctx.features[]
Check 2: moduleConfig.required_permissions → each must be in ctx.permissions[]
If either fails → redirect to default route
```

### Known Navigation Modules (from navigationRegistry.js)

| Module key       | feature_key            | required_permissions   |
|------------------|------------------------|------------------------|
| dashboard        | (none / always on)     | —                      |
| projects         | `projects`             | —                      |
| calendar         | `calendar`             | —                      |
| time             | `time`                 | —                      |
| time-review      | `time`                 | `can_review_time`      |
| contacts         | `contacts`             | —                      |
| contracts        | `contracts`            | —                      |
| qa               | `qa`                   | —                      |

---

## 7. App Type Scopes

Three distinct app contexts exist, each with its own scope behavior:

| App type   | Tenant  | Read/Write | Scope behavior          |
|------------|---------|------------|-------------------------|
| `tenant`   | dynamic | read+write | Full scope enforcement  |
| `admin`    | `_admin` | write only | No project scope        |
| `sandbox`  | `dep`   | read-only  | Sandbox user scope      |

- **Sandbox:** `assertWritablePlatformContext()` blocks all write operations
- **Admin:** routes only accept internal admin operations
- **Tenant:** full user + scope resolution pipeline

---

## 8. In-Memory State vs DB

| Data type        | Scope source     | DB-backed?   |
|------------------|------------------|--------------|
| Open projects    | mine (UUID path) | ✅ primary   |
| Open projects    | all/team         | ❌ in-memory |
| Cases            | mine/all         | ❌ in-memory (delegates to projects) |
| Time entries     | mine/all         | ❌ in-memory only |
| Users            | sync state       | ✅ via pg    |
| Fitter hours     | full sync        | ✅ ek_fitterhours table |

---

## 9. Known Gaps and Inconsistencies

| #  | File              | Issue                                                                 | Severity   |
|----|-------------------|-----------------------------------------------------------------------|------------|
| G1 | sync.js           | `getScopedTimeEntries` has no DB path — in-memory only for all scopes | HIGH       |
| G2 | server.js         | `scope=team` has no distinct logic — treated same as `mine` for non-owners | MEDIUM |
| G3 | server.js         | Dev override sets `username="dep"` when localhost + not production    | HIGH       |
| G4 | sync.js           | `scope=all` only gives true "all" to owner/global_admin — undocumented silently | MEDIUM |
| G5 | navigationRegistry| Feature key enforcement is frontend-only — no backend middleware enforces feature flags on API routes | HIGH |
| G6 | tenant_features   | Table exists but seeding is not confirmed — new tenants may have no features enabled by default | MEDIUM |
| G7 | platformContext.js | Actor ID fallback is `"username:dep"` — not a canonical stable identifier | HIGH |
| G8 | time-entries      | No persistent storage; data lost on server restart                    | HIGH       |

---

## 10. V3 Reconstruction Notes

For V3 rebuild:
- Scope must be a first-class backend concept with DB enforcement for all data types
- Feature flags must be enforced at the API/middleware layer, not just frontend
- `team` scope requires a real definition (team/group membership model)
- Actor/user identity must resolve to a stable UUID before any scope evaluation
- Time entries must be DB-backed before scope enforcement is meaningful
- Sandbox and dev bypass paths must be environment-gated with no fallback to production data

---

*This file is read-only audit output. No code changes were made.*
