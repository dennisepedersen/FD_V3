# TENANT_MAP.md — Fielddesk V2 Tenant Audit

Generated: 2026-03-22
Source: `backend/server.js`, `backend/db/postgres.js`, `FIELDESK_STATUS.md`, `docs/decisions/DECISIONS.md`
Status: VERIFIED where noted; UNKNOWN where noted

---

## Tenant Model Overview

- Tenants are identified by `tenant_id` (TEXT, lowercase slug)
- `tenant_id` serves as both the primary key and the slug
- No separate `slug` column in current `tenants` CREATE TABLE
  > ⚠ postgres.js seed INSERT references a `slug` column that does not exist in the CREATE TABLE definition — MISMATCH

---

## Known Tenants (Verified / Hardcoded)

### 1. `dep`
| Property | Value |
|---|---|
| tenant_id | `dep` |
| name | `DEP Internal Test` |
| status | `active` |
| source | Hardcoded seed INSERT in `postgres.js` + `SANDBOX_TENANT_ID = "dep"` in server.js |
| Default fallback tenant | YES (`FD_OWNER_TENANT_SLUG` defaults to `"dep"`) |
| Sandbox tenant | YES — sandbox tokens are issued with `tenant_id = "dep"` |
| Active tenant admin | UNKNOWN (via `defaultUsers` owner/member or via `tenant_admin_credentials`) |

> ⚠ `dep` appears in 4 distinct hardcoded locations:
> 1. `SANDBOX_TENANT_ID = "dep"` (server.js)
> 2. `defaultTenantSlug` fallback = `"dep"` (via `FD_OWNER_TENANT_SLUG`)
> 3. Seed INSERT in postgres.js: `INSERT INTO tenants ... VALUES ('dep', 'dep', 'DEP Internal Test', 'active')`
> 4. Dev override path uses `username: "dep"` when no user is resolved

### 2. `hoyrup-clemmensen`
| Property | Value |
|---|---|
| tenant_id | `hoyrup-clemmensen` |
| name | UNKNOWN (not in code — only in docs) |
| status | `active` (verified in FIELDESK_STATUS.md 2026-03-20) |
| Tenant admin email | `dep@hoyrup-clemmensen.dk` (verified) |
| Auth model | `tenant_admin_credentials` (verified) |
| Source | FIELDESK_STATUS.md runtime truth + DECISIONS.md |
| Canonical owner-relation | NOT verified |

> This is the only confirmed production-like tenant as of 2026-03-20.

---

## All Other Tenants

**UNKNOWN** — no further tenants exist in code or docs.
Any additional tenants are created at runtime via `/admin/tenants` (global admin endpoint).

---

## Subdomain / Slug Model

Tenant resolution order in `getTenantSlugFromRequest()`:

1. `x-tenant-slug` header (explicit)
2. Subdomain extraction from `Host` header (requires ≥ 3 domain parts)
3. Fallback to `defaultTenantSlug` (env `FD_OWNER_TENANT_SLUG`, defaults to `"dep"`)

Example:
- `hoyrup-clemmensen.fielddesk.dk` → tenant_id = `hoyrup-clemmensen`
- `localhost:3000` → empty → falls back to default
- Header `x-tenant-slug: hoyrup-clemmensen` → tenant_id = `hoyrup-clemmensen`

---

## Tenant Lifecycle States (from `pre_decisions.md`)

| State | Meaning |
|---|---|
| `draft` | Tenant being set up |
| `active` | Operational |
| `suspended` | Temporarily disabled |
| `sandbox` | UNKNOWN – not yet implemented |
| `archived` | Permanently disabled (soft delete) |

**Onboarding States** (from postgres.js `advanceTenantOnboardingState`):
- `draft` → UNKNOWN next state (logic not read in full)
- States tracked in `tenants.onboarding_state`

---

## Tenant Data Isolation

- All tenant data is isolated via `WHERE tenant_id = $1` in every query
- No cross-tenant queries observed in code
- No RLS policies — isolation is application-layer only

> ⚠ If a query is missing `tenant_id` filter, data leaks. No DB-level safety net.

---

## Tenant Provisioning Flow

1. Global admin logs in (`/api/auth/login`, appType=`admin`)
2. Creates tenant via `POST /admin/tenants`
3. Sets first admin contact via `POST /admin/tenants/:id/tenant-admin`
4. Generates invite link via `POST /admin/tenants/:id/tenant-admin/invite`
5. Tenant admin activates via `GET /api/tenant-admin/invite/:token` → `POST /api/tenant-admin/activate`
6. Tenant admin sets integration credentials via `/api/tenant/integrations/ekomplet`
7. Sync triggered via `/internal/sync/bootstrap`

> Current runtime truth (2026-03-20): Global admin login is DISABLED (no env credentials set).
> Tenant provisioning flow therefore NOT operative in runtime.
> `hoyrup-clemmensen` was provisioned via unknown mechanism (pre-code or direct DB insert).

---

## Hardcoded Tenant References

| Location | Hardcoded Value | Risk |
|---|---|---|
| `server.js` line 118 | `SANDBOX_TENANT_ID = "dep"` | Sandbox always uses `dep` tenant |
| `server.js` line 81-83 | `defaultTenantSlug = "dep"` | All requests without tenant header default to `dep` |
| `postgres.js` seed | `VALUES ('dep', 'dep', 'DEP Internal Test', 'active')` | Ensures `dep` always exists |
| `server.js` dev override | `username: "dep"` in dev path | Dev fallback tied to internal user |

---

## Known Gaps / Findings

| # | Observation | Severity |
|---|---|---|
| 1 | Only 2 tenants are known: `dep` and `hoyrup-clemmensen` | INFO |
| 2 | `dep` is hardcoded in 4 places — will survive into V3 unless explicitly removed | HIGH |
| 3 | Sandbox users always get `dep` as tenant — sandbox is not tenant-neutral | MEDIUM |
| 4 | `slug` column mismatch in tenants table vs seed INSERT | HIGH (runtime error) |
| 5 | No lifecycle enforcement for `suspended`, `archived` in API layer (UNKNOWN if enforced) | UNKNOWN |
| 6 | Tenant provisioning requires global admin which is disabled | HIGH |
| 7 | `hoyrup-clemmensen` canonical owner-relation unverified | UNKNOWN |
