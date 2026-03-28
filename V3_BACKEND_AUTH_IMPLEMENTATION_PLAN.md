# V3_BACKEND_AUTH_IMPLEMENTATION_PLAN

## Scope

Implemented in this phase only:
- tenant resolution middleware
- invitation accept flow
- onboarding flow (root-only)
- tenant login flow
- JWT issue/verify
- audit logging hooks for these flows

Out of scope:
- frontend and UI
- global admin login flow
- RBAC/scope system beyond resolved tenant + authenticated tenant user
- legacy V2 compatibility paths

## Folder structure

- backend/src/server.js
- backend/src/app.js
- backend/src/config/env.js
- backend/src/db/pool.js
- backend/src/db/tx.js
- backend/src/db/queries/tenant.js
- backend/src/db/queries/invitation.js
- backend/src/db/queries/user.js
- backend/src/db/queries/audit.js
- backend/src/services/jwtService.js
- backend/src/services/passwordService.js
- backend/src/services/invitationService.js
- backend/src/services/onboardingService.js
- backend/src/middleware/tenantResolution.js
- backend/src/middleware/requireRootHost.js
- backend/src/middleware/requireTenantHost.js
- backend/src/middleware/requireAuth.js
- backend/src/middleware/errorHandler.js
- backend/src/routes/rootInvitationRoutes.js
- backend/src/routes/rootOnboardingRoutes.js
- backend/src/routes/tenantAuthRoutes.js
- backend/src/routes/rootHealthRoutes.js

## Route ownership

Root-domain only:
- GET /health
- POST /v1/invitations/accept
- GET /v1/onboarding/state
- POST /v1/onboarding/complete

Tenant-domain only:
- POST /v1/auth/login

Rules:
- onboarding is root-only
- tenant-domain is active tenant only with verified+active domain
- root and tenant routes are never dual-scoped

## Middleware order

1. express.json
2. tenantResolution
3. route-level host guards:
- requireRootHost on root routes
- requireTenantHost on tenant routes
4. requireAuth (only onboarding routes)
5. route handler
6. errorHandler

## Transaction boundaries

Single DB transaction:
- invitation accept flow:
  - validate invitation state
  - create tenant (onboarding)
  - create tenant_domain (verified=false, active=false)
  - create tenant_user (tenant_admin)
  - mark invitation accepted
  - write audit success/fail
- onboarding complete flow:
  - validate onboarding tenant state
  - upsert tenant_config
  - insert tenant_config_snapshot
  - set tenant.status=active
  - set tenant_domain.verified=true and active=true
  - write audit success/fail

No transaction required:
- tenant login flow (single user lookup + verify + token issue + audit write)

## Token types

Access token:
- type=access
- claims include sub, tenant_id, role, email, actor_scope=tenant
- used for tenant auth/app in later phases

Onboarding token:
- type=onboarding
- claims include sub, tenant_id, role, email, actor_scope=tenant
- short lifetime
- accepted only on root onboarding routes

Invitation token:
- treated as opaque input token
- verified by sha256(token) against tenant_invitation.token_hash

## Audit write points

Because schema event_type is constrained, hook names map to allowed event_type values:
- invitation_accept_success -> event_type=invitation_accepted, outcome=success
- invitation_accept_fail -> event_type=invitation_accepted, outcome=fail
- onboarding_complete_success -> event_type=tenant_status_changed, outcome=success
- onboarding_complete_fail -> event_type=tenant_status_changed, outcome=fail
- login_success -> event_type=login_success, outcome=success
- login_fail -> event_type=login_fail, outcome=fail
- tenant_resolution_denied (practical) -> event_type=support_access_denied, outcome=deny, reason=tenant_resolution_denied

No secrets are logged in audit metadata.

## Small assumptions (explicit)

- Invitation accept request includes tenant_slug, tenant_name, tenant_domain, full_name, password, token.
- Invitation email from tenant_invitation.email is the tenant_admin login email.
- Onboarding complete request includes ek_base_url and ek_api_key.
- ek_api_key is encrypted in app layer before saving to tenant_config.
- INVITATION_JWT_SECRET is optional; if omitted, JWT_SECRET is used for onboarding token signing.

## Security choices

- bcrypt is used for password hashing and verification.
- bcrypt cost factor: 12.
- fail-fast startup for missing critical env: DATABASE_URL, JWT_SECRET, ROOT_DOMAIN.
- no fallback tenant, no plaintext password handling, no default credentials.
