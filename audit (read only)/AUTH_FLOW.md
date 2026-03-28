# AUTH_FLOW.md — Fielddesk V2 Auth Audit

Generated: 2026-03-22
Source: `backend/server.js`, `backend/middleware/appAuth.js`, `backend/middleware/adminAuth.js`
Status: VERIFIED from code

---

## Token Format

Custom HMAC-SHA256 token (NOT JWT):

```
base64url(JSON payload) . base64url(HMAC-SHA256 signature)
```

Payload fields:
```json
{
  "tenant_id": "hoyrup-clemmensen",
  "username": "dep@hoyrup-clemmensen.dk",
  "role": "tenant_admin",
  "exp": 1234567890
}
```

- `exp` is Unix timestamp (seconds)
- NO `iat` (issued_at) field
- NO `nbf` (not before) field
- Verified by HMAC, NOT asymmetric key

> ⚠ Custom token format — not JWT. No standard library verification. No key rotation support.

---

## Token Secret Priority

1. `process.env.APP_AUTH_SECRET`
2. → fallback to `process.env.AUTH_TOKEN_SECRET`
3. → fallback to `"change-this-secret-in-render"` (insecure default)

---

## Login Flows

### Flow 1: Tenant Admin Login

```
POST /api/auth/login
  ↓
  getTenantSlugFromRequest()
    → x-tenant-slug header
    → subdomain extraction
    → fallback to defaultTenantSlug ("dep")
  ↓
  getTenantAdminCredentialByLogin({ tenantId, login: username })
    → SELECT FROM tenant_admin_credentials
  ↓
  bcrypt.compare(password, password_hash)
  ↓
  check status === 'active'
  ↓
  markTenantAdminCredentialLogin()  ← updates last_login_at
  ↓
  createAppToken({ tenant_id, username (email-local-part), email, role: 'tenant_admin', exp })
  ↓
  return { token, expiresAt, username, role }
```

### Flow 2: Legacy User Login (fallback)

If no `tenant_admin_credentials` match:

```
POST /api/auth/login
  ↓
  findUser(username) → matches defaultUsers { owner, member } from env
  ↓
  password === user.password (PLAINTEXT COMPARE — no bcrypt)
  ↓
  createAppToken({ tenant_id: tenantSlug, username, role: 'owner'|'member', exp })
```

> ⚠ Legacy user login uses PLAINTEXT password comparison (not bcrypt). This is the `defaultUsers` fallback — owner and member users from env vars.

### Flow 3: Global Admin Login

```
POST /api/auth/login  (appType must be "admin")
  ↓
  check adminUser.username and adminUser.password are configured (from env)
    → if NOT configured → return 503 "admin_auth_not_configured"
  ↓
  plain string compare username + password
  ↓
  createAppToken({ tenant_id: "_admin", username, role: 'global_admin', exp })
```

> Note: Global admin token has `tenant_id = "_admin"` (NOT a real tenant).
> ⚠ Global admin password also uses PLAINTEXT compare (not bcrypt).

### Flow 4: Sandbox Login

```
POST /api/auth/sandbox  (appType must be "sandbox")
  ↓
  createAppToken({ tenant_id: "dep", username: "sandbox_guest", role: "sandbox_user", exp })
```

No credentials required.

---

## Token Validation Flow (`requireAppAuth` middleware)

```
HTTP Request with Authorization: Bearer <token>
  ↓
  verifyAppToken(token, secret)
    → split on "."
    → HMAC verify signature
    → JSON.parse payload
    → returns null if invalid
  ↓
  check exp > now
  ↓
  getTenantSlugFromRequest(req)  ← from header/subdomain
  ↓
  if !allowTenantBypass:
    tokenTenantSlug must match requestTenantSlug (if both present)
  ↓
  resolveAuthIdentity(payload)
    → if username contains "@" → extract local part as username
    → email set
  ↓
  req.appAuth = {
    tenant_id,
    username,
    login_username,
    email,
    role,
    exp
  }
  ↓
  next()
```

---

## Tenant Resolution

`getTenantSlugFromRequest(req, fallbackTenantSlug)`:

1. Check `x-tenant-slug` header → use if present
2. Extract subdomain from `Host` header:
   - `hoyrup-clemmensen.fielddesk.dk` → `hoyrup-clemmensen`
   - `localhost` / `127.0.0.1` → returns `""` (empty — no subdomain)
3. If empty → return `""` (caller uses fallback)

---

## Role Resolution

### Auth Roles (from token)

| Role | Source |
|---|---|
| `global_admin` | Global admin login |
| `tenant_admin` | tenant_admin_credentials |
| `owner` | Legacy defaultUsers |
| `member` | Legacy defaultUsers |
| `sandbox_user` | Sandbox login |

### FD Roles (resolved from E-komplet roles)

Mapping in `backend/config/roleMapping.js`:

| E-komplet Role | FD Role |
|---|---|
| Direktion | owner |
| Administrator | tenant_admin |
| Afdelingsleder | tenant_admin |
| Projektleder | project_manager |
| Entrepriseleder | project_manager |
| Sagsansvarlig | project_manager |
| Serviceleder | project_manager |
| Formand | foreman |
| Montør / Montør - Opret sag | technician |
| Tekniker | technician |
| Lager / Indkøb / Kalkulation / Kvalitetssikring | support |

**FD Role Priority (highest → lowest):**
owner → tenant_admin → project_manager → foreman → technician → support

### Effective Role Logic (in `/api/me`)

```
fdRole = resolvedUser.fd_role || "technician"
authRole = req.appAuth.role

if fdRole === "technician" AND authRole in [owner, tenant_admin, project_manager]:
  effectiveFdRole = authRole  ← auth role takes precedence
else:
  effectiveFdRole = fdRole
```

---

## Feature / Permission Defaults by Role

From `defaultFeaturesForRole()` and `defaultPermissionsForRole()` in `server.js`:

> UNKNOWN — these functions are defined in server.js but not fully read in this pass.
> They return arrays of feature keys and permission keys based on token role.

---

## Invite / Activation Flow (Tenant Admin Onboarding)

```
[Global Admin]
  POST /admin/tenants/:id/tenant-admin/invite
    → generate crypto.randomBytes(32) token
    → hash token (SHA256)
    → store hash in tenant_admin_invites
    → return plaintext token (once only) + invite_link

[New Tenant Admin]
  GET /api/tenant-admin/invite/:token
    → hash token, lookup in tenant_admin_invites
    → verify: not expired, status=pending|sent
    → return tenant/admin info for display

  POST /api/tenant-admin/activate
    → { token, password }
    → verify invite again
    → bcrypt.hash(password)
    → INSERT INTO tenant_admin_credentials
    → markTenantAdminInviteAccepted()
    → return new tenant admin token
```

---

## Sync Authentication (Internal Endpoints)

`requireSyncSecret` middleware:
- Reads `x-sync-secret` header
- Compares to `syncSecret` (env `SYNC_SECRET` or `FD_PLATFORM_ADMIN_KEY`)
- If no match → 401

> Not bearer token based — separate shared secret.

---

## PlatformContext (QA module)

`buildPlatformContext(req)` in `core/platformContext.js`:

```
{
  requestId,
  appType,
  tenantId: req.appAuth.tenant_id,
  actor: {
    id: actorId,           ← from token uuid fields if present, else "username:<name>"
    idSource: "token_uuid" | "token_username_fallback" | "missing",
    username,
    role
  },
  auth: req.appAuth
}
```

> ⚠ Actor ID falls back to `"username:<name>"` — not a stable canonical ID. Marked as TODO(P1) in code.

---

## Known Gaps / Findings

| # | Observation | Severity |
|---|---|---|
| 1 | Custom token format (not JWT) — no standard tooling, no key rotation | MEDIUM |
| 2 | No `iat` in token — issued_at not tracked | LOW |
| 3 | Legacy user login uses PLAINTEXT password comparison (not bcrypt) | HIGH |
| 4 | Global admin login uses PLAINTEXT password comparison (not bcrypt) | HIGH |
| 5 | Default token secret `"change-this-secret-in-render"` shipped in code | CRITICAL |
| 6 | Actor ID is `"username:dep"` fallback — not stable nor canonical | MEDIUM |
| 7 | No token revocation mechanism (no blacklist, no refresh tokens) | MEDIUM |
| 8 | No brute-force protection on login endpoint | MEDIUM |
| 9 | Sandbox login requires no credentials — anyone can get a sandbox token for `dep` tenant | HIGH |
| 10 | `defaultFeaturesForRole()` and `defaultPermissionsForRole()` not fully traced | UNKNOWN |
