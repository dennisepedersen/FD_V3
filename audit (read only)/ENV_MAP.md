# ENV_MAP.md — Fielddesk V2 Environment Variables Audit

Generated: 2026-03-22
Source: `backend/server.js`, `backend/db/postgres.js`, `backend/sync.js`, `backend/ekomplet.js`, `backend/services/timeSyncService.js`
Status: VERIFIED from code grep

---

## All Environment Variables

### Database

| Variable | Used In | Default | Critical | Notes |
|---|---|---|---|---|
| `DATABASE_URL` | `db/postgres.js`, scripts | `""` | YES | PostgreSQL connection string. If empty → Postgres disabled (in-memory fallback) |
| `PGSSL` | `db/postgres.js` | `"require"` | YES | SSL mode for Postgres. `disable` = no SSL. Affects prod security. |

---

### Authentication / Token

| Variable | Used In | Default | Critical | Notes |
|---|---|---|---|---|
| `APP_AUTH_SECRET` | `server.js`, `sync.js`, `timeSyncService.js` | `"change-this-secret-in-render"` | YES | Primary HMAC-SHA256 secret for app token signing |
| `AUTH_TOKEN_SECRET` | `server.js`, `sync.js`, `timeSyncService.js` | fallback to `APP_AUTH_SECRET` | YES | Legacy alias for APP_AUTH_SECRET |
| `TOKEN_TTL_HOURS` | `server.js` | `0` (uses AUTH_TOKEN_TTL_MS fallback) | NO | Token TTL in hours |
| `AUTH_TOKEN_TTL_MS` | `server.js` | 8 hours | NO | Token TTL in milliseconds |
| `AUTH_LEGACY_ENABLED` | `server.js` | `"false"` | NO | If `"true"` → allows dev identity bypass in user resolution |

> ⚠ Default `APP_AUTH_SECRET` is `"change-this-secret-in-render"` — must be overridden in production.

---

### Global Admin

| Variable | Used In | Default | Critical | Notes |
|---|---|---|---|---|
| `FD_ADMIN_USERNAME` | `server.js` | `""` | YES (for admin) | Global admin username. Empty = admin login disabled. |
| `ADMIN_USERNAME` | `server.js` | fallback to `FD_ADMIN_USERNAME` | YES (for admin) | Legacy alias |
| `FD_ADMIN_PASSWORD` | `server.js` | `""` | YES (for admin) | Global admin password. Empty = admin login disabled. |
| `ADMIN_PASSWORD` | `server.js` | fallback to `FD_ADMIN_PASSWORD` | YES (for admin) | Legacy alias |

> Note: When both `FD_ADMIN_USERNAME` and `FD_ADMIN_PASSWORD` are empty — global admin login returns 503. Admin is effectively disabled. (Confirmed FIELDESK_STATUS.md runtime truth.)

---

### Tenant / Fallback Identity

| Variable | Used In | Default | Critical | Notes |
|---|---|---|---|---|
| `FD_OWNER_TENANT_SLUG` | `server.js` | `"dep"` | YES | Default tenant slug used as fallback when no subdomain/header present |
| `FD_TENANT_ID` | `server.js` | fallback to `FD_OWNER_TENANT_SLUG` | YES | Legacy alias |

> ⚠ Default fallback tenant slug is hardcoded `"dep"`.

---

### Default Users (Legacy / Fallback Auth)

| Variable | Used In | Default | Critical | Notes |
|---|---|---|---|---|
| `FD_OWNER_USERNAME` | `server.js` | `"owner"` | NO | username for legacy owner user |
| `FD_OWNER_PASSWORD` | `server.js` | `"change-me-owner"` | YES | ⚠ Hardcoded default — must be overridden |
| `FD_MEMBER_USERNAME` | `server.js` | `"member"` | NO | username for legacy member user |
| `FD_MEMBER_PASSWORD` | `server.js` | `"change-me-member"` | YES | ⚠ Hardcoded default — must be overridden |

> These users are a legacy in-memory fallback. They exist when no `tenant_admin_credentials` match is found.

---

### Sync / Internal API

| Variable | Used In | Default | Critical | Notes |
|---|---|---|---|---|
| `SYNC_SECRET` | `server.js` | `""` | YES | Secret for `/internal/*` sync endpoints. Empty = sync endpoints unprotected (will deny all — no bypass) |
| `FD_PLATFORM_ADMIN_KEY` | `server.js` | fallback to `SYNC_SECRET` | YES | Legacy alias |

> Note: If `SYNC_SECRET` is empty, `requireSyncSecret` middleware rejects all requests (provided string won't match empty expected). Still effectively blocks — but empty secret also means sync is never callable.

---

### Credentials Encryption

| Variable | Used In | Default | Critical | Notes |
|---|---|---|---|---|
| `FD_CREDENTIALS_SECRET` | `server.js`, `sync.js`, `timeSyncService.js` | fallback to `APP_AUTH_SECRET` | YES | AES-256-GCM key source for encrypting integration API keys. SHA256-hashed before use. |

> ⚠ Falls back to `APP_AUTH_SECRET` if not set. This means auth token signing and credential encryption share the same key by default, which is a security concern.

---

### E-Komplet (Global Env Key — Legacy Harvester)

| Variable | Used In | Default | Critical | Notes |
|---|---|---|---|---|
| `EKOMPLET_APIKEY` | `ekomplet.js`, `scripts/harvest.js` | none | YES (harvester) | API key for global (non-per-tenant) E-komplet calls |
| `EKOMPLET_SITENAME` | `ekomplet.js`, `scripts/harvest.js` | none | YES (harvester) | Sitename for global E-komplet calls |

> ⚠ These are GLOBAL keys — not per-tenant. Used in harvester scripts and `/internal/ekomplet/raw` endpoint. This conflicts with the per-tenant `tenant_integration_credentials` model.

---

### Server

| Variable | Used In | Default | Critical | Notes |
|---|---|---|---|---|
| `PORT` | `server.js` | `3000` | NO | HTTP server port |
| `NODE_ENV` | `server.js` | undefined | YES | Controls dev-only fallbacks (`development` = enables dep username override) |

---

## Critical Variables Checklist (Production)

| Variable | Production Required | Risk if Missing |
|---|---|---|
| `DATABASE_URL` | YES | App falls back to in-memory; no persistence |
| `APP_AUTH_SECRET` | YES | Tokens signed with default secret — forgeable |
| `FD_CREDENTIALS_SECRET` | YES | Integration API keys encrypted with auth secret fallback |
| `SYNC_SECRET` | YES | Internal sync endpoints entirely uncallable |
| `NODE_ENV=production` | YES | Dev `dep` username override active on localhost |
| `FD_OWNER_PASSWORD` | YES | Default password is `"change-me-owner"` |
| `FD_MEMBER_PASSWORD` | YES | Default password is `"change-me-member"` |
| `FD_OWNER_TENANT_SLUG` | YES | Defaults to `"dep"` — should be set explicitly |

---

## Legacy Variables (May Be Retired)

| Variable | Alias For | Status |
|---|---|---|
| `AUTH_TOKEN_SECRET` | `APP_AUTH_SECRET` | Legacy alias, keep for compat |
| `FD_TENANT_ID` | `FD_OWNER_TENANT_SLUG` | Legacy alias |
| `ADMIN_USERNAME` | `FD_ADMIN_USERNAME` | Legacy alias |
| `ADMIN_PASSWORD` | `FD_ADMIN_PASSWORD` | Legacy alias |
| `FD_PLATFORM_ADMIN_KEY` | `SYNC_SECRET` | Legacy alias |
| `AUTH_TOKEN_TTL_MS` | `TOKEN_TTL_HOURS` | Legacy alias |

---

## Known Gaps / Findings

| # | Observation | Severity |
|---|---|---|
| 1 | `APP_AUTH_SECRET` has insecure default — production MUST override | CRITICAL |
| 2 | `FD_CREDENTIALS_SECRET` defaults to `APP_AUTH_SECRET` — same key for auth + encryption | HIGH |
| 3 | `FD_OWNER_TENANT_SLUG` defaults to `"dep"` — hardcoded tenant | HIGH |
| 4 | `EKOMPLET_APIKEY` and `EKOMPLET_SITENAME` are GLOBAL keys, not per-tenant | MEDIUM |
| 5 | `NODE_ENV` not set → dev username fallback to dep may trigger | MEDIUM |
| 6 | No QA/AI provider key visible in env scan (UNKNOWN — may be in service file) | UNKNOWN |
