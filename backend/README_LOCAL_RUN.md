# Fielddesk V3 Phase-1 Backend - Local Integration Testing

This guide walks through setting up and running the Phase-1 backend locally for integration testing.

## Step 1: Install Dependencies

```bash
cd backend
npm install
```

This installs: `express`, `pg`, `jsonwebtoken`, `bcrypt`.

## Step 2: Create Local PostgreSQL Database

Ensure PostgreSQL is running locally. Create a database for local testing:

```bash
createdb fielddesk_v3
```

Or using psql:
```bash
psql -U postgres
CREATE DATABASE fielddesk_v3;
\q
```

Default connection assumes `postgres:postgres` on `localhost:5432`. Adjust in step 4 if your setup differs.

## Step 3: Run Initial Migration

Apply the Phase-1 schema and initial setup:

```bash
psql -U postgres -d fielddesk_v3 -f ../migrations/0001_init.sql
```

This creates:
- Schema tables: `tenant`, `tenant_domain`, `tenant_invitation`, `tenant_user`, `tenant_config`, `tenant_config_snapshot`, `audit_event`, etc.
- Triggers and constraints for data integrity
- Indexes for performance

Verify tables were created:
```bash
psql -U postgres -d fielddesk_v3 -c "\dt"
```

You should see ~14 tables listed.

## Step 4: Set Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

Edit `.env` and update:
- `DATABASE_URL`: Ensure it matches your PostgreSQL connection (default is `postgresql://postgres:postgres@localhost:5432/fielddesk_v3`)
- `JWT_SECRET`: Use any strong random string for local testing (e.g., `local-dev-secret-12345`)
- `ROOT_DOMAIN`: Keep as `localhost:3000` for local testing
- `PORT`: Optional, defaults to 3000
- `NODE_ENV`: Set to `development` to see full error traces

Example `.env` for local testing:
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/fielddesk_v3
JWT_SECRET=local-dev-secret
ROOT_DOMAIN=localhost:3000
PORT=3000
NODE_ENV=development
```

## Step 5: Start the Backend

```bash
npm start
```

or for development mode with better error output:

```bash
npm run dev
```

Expected output:
```
Fielddesk V3 backend listening on port 3000
Database connection verified
```

If you see "Database connection successful", DB connectivity is working. If you see "Database connectivity check failed", verify your `DATABASE_URL` and PostgreSQL is running.

The backend is now running and ready for requests.

## Step 6: Test `/health` Endpoint

The root-only health check endpoint verifies the backend is running (does not require DB):

```bash
curl -X GET http://localhost:3000/health \
  -H "Host: localhost:3000"
```

Expected response (200 OK):
```json
{
  "status": "ok"
}
```

If you get `{"error": {"message": "deny_wrong_domain"}}`, the Host header must match `ROOT_DOMAIN`.

## Step 7: Test Root Invitation Flow

This tests tenant invitation acceptance and initial tenant creation.

**Setup:** Create an invitation in the database manually first (or use a test script). For testing, we'll use a pre-created invitation token. You need:
- A `token_hash` in the `tenant_invitation` table (SHA256 hashed)
- The raw `token` to send in the request

For local testing, generate a test token:
```bash
node -e "const crypto = require('crypto'); const token = crypto.randomBytes(32).toString('hex'); const hash = crypto.createHash('sha256').update(token).digest('hex'); console.log('Token:', token); console.log('Hash:', hash);"
```

Insert the test invitation into DB:
```bash
psql -U postgres -d fielddesk_v3 << EOF
INSERT INTO tenant_invitation 
  (email, token_hash, expires_at, status)
VALUES 
  ('test-admin@example.com', '<insert-hash-above>', NOW() + interval '1 day', 'pending');
EOF
```

Then call the accept invitation endpoint:

```bash
curl -X POST http://localhost:3000/v1/invitations/accept \
  -H "Host: localhost:3000" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "<insert-token-above>",
    "full_name": "Test Admin",
    "password": "TestPassword123!",
    "tenant_slug": "test-tenant",
    "tenant_name": "Test Tenant",
    "tenant_domain": "test-tenant.localhost"
  }'
```

Expected response (200 OK):
```json
{
  "success": true,
  "tenant_id": "<uuid>",
  "onboarding_token": "<jwt-token>"
}
```

The response includes:
- `tenant_id`: The newly created tenant UUID
- `onboarding_token`: A JWT token for the tenant admin to use in onboarding flow

Verify in DB:
```bash
psql -U postgres -d fielddesk_v3 -c "SELECT id, slug, name, status FROM tenant WHERE slug='test-tenant';"
```

You should see the tenant with `status='onboarding'`.

## Step 8: Test Onboarding Flow

The onboarding flow moves the tenant from `onboarding` status to `active`.

**Prerequisites:**
- A tenant in `onboarding` status (created in step 7)
- The `onboarding_token` from step 7

**A. Get Onboarding State:**

```bash
curl -X GET http://localhost:3000/v1/onboarding/state \
  -H "Host: localhost:3000" \
  -H "Authorization: Bearer <onboarding-token-from-step-7>"
```

Expected response (200 OK):
```json
{
  "success": true,
  "state": {
    "tenant_id": "<uuid>",
    "tenant_status": "onboarding",
    "tenant_domain_verified": false,
    "tenant_domain_active": false,
    "config_status": "not_configured"
  }
}
```

**B. Complete Onboarding:**

```bash
curl -X POST http://localhost:3000/v1/onboarding/complete \
  -H "Host: localhost:3000" \
  -H "Authorization: Bearer <onboarding-token-from-step-7>" \
  -H "Content-Type: application/json" \
  -d '{
    "ek_base_url": "https://api.e-komplet.example.com",
    "ek_api_key": "test-api-key-12345"
  }'
```

Expected response (200 OK):
```json
{
  "success": true,
  "tenant_login_url": "http://test-tenant.localhost:3000/v1/auth/login"
}
```

Verify in DB:
```bash
psql -U postgres -d fielddesk_v3 << EOF
SELECT id, slug, status FROM tenant WHERE slug='test-tenant';
SELECT tenant_id, status FROM tenant_config;
EOF
```

Tenant should now have `status='active'` and config should be `status='configured'`.

## Step 9: Test Tenant Login Flow

The login flow issues an access token for an authenticated tenant user.

**Prerequisites:**
- A tenant with `status='active'` (from step 8)
- The tenant domain must be verified and active
- A tenant_user with the login email and password set in step 7

**Flow:**

1. The tenant admin created in step 7 has email `test-admin@example.com` and password `TestPassword123!`.

2. Log in via the tenant domain:

```bash
curl -X POST http://test-tenant.localhost:3000/v1/auth/login \
  -H "Host: test-tenant.localhost:3000" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test-admin@example.com",
    "password": "TestPassword123!"
  }'
```

Expected response (200 OK):
```json
{
  "success": true,
  "access_token": "<jwt-access-token>",
  "token_type": "Bearer"
}
```

The `access_token` can now be used in subsequent requests to tenant-scoped endpoints (future phases).

Verify token claims (decode without verifying):
```bash
node -e "const jwt = require('jsonwebtoken'); console.log(JSON.stringify(jwt.decode('<access-token>'), null, 2));"
```

Expected claims include:
```json
{
  "sub": "<user-id>",
  "tenant_id": "<tenant-id>",
  "email": "test-admin@example.com",
  "role": "tenant_admin",
  "actor_scope": "tenant",
  "type": "access",
  "iat": ...,
  "exp": ...
}
```

---

## Known Limitations (Phase-1)

### What is NOT implemented in Phase-1:

1. **Global Admin Login**
   - No endpoint for global admin to create tenants or invitations
   - Invitations must be created manually (via direct DB insert or later via admin API)

2. **RBAC / Scope System**
   - Only two scopes: `global` (system) and `tenant` (authenticated user in tenant)
   - No granular role-based features (that's Phase-2+)
   - No permission checks within tenant

3. **Support Session Flows**
   - No support access or support session flows
   - Explicitly excluded from Phase-1

4. **Tenant User Management**
   - No endpoints to add/remove/update users in a tenant
   - Only the initial tenant_admin is created during invitation accept

5. **E-Komplet Integration**
   - Config is stored but not tested against actual E-komplet API
   - `ek_api_key` is encrypted and stored; actual sync is Phase-2+

6. **Frontend / UI**
   - No web interface; all testing via API/curl
   - Authentication is token-based (JWT), not session-based

### What WILL fail if attempted:

- Requests without `Host` header matching `ROOT_DOMAIN` or a tenant domain
- Requests with invalid/expired tokens
- Requests with wrong token type (e.g., access token on onboarding endpoint)
- Login with wrong password or non-existent user
- Onboarding state query if tenant is not in `onboarding` status

---

## Troubleshooting

### "Database connection failed" at startup

- Ensure PostgreSQL is running: `psql -U postgres -c "SELECT 1;"`
- Check `DATABASE_URL` in `.env` is correct
- Verify database exists: `psql -U postgres -l | grep fielddesk_v3`

### "deny_wrong_domain" error on /health

- Ensure `-H "Host: localhost:3000"` is included in curl commands
- Or set `ROOT_DOMAIN` to match your curling host

### "Unauthorized" or "invalid_token" on onboarding endpoints

- Ensure the onboarding token is valid (not expired, correct type)
- Verify `NODE_ENV=development` in `.env` to see full error details

### Migration fails with "permission denied"

- Ensure PostgreSQL user has createdb/superuser privileges
- Or create tables using a superuser account

### Port 3000 already in use

- Change `PORT` in `.env` to an available port (e.g., 3001)

---

## Next Steps

After successful Phase-1 integration tests:
- Phase-2: Add admin API, tenant user management, RBAC
- Phase-3: E-komplet sync flows
- Phase-4: Support sessions, advanced features
