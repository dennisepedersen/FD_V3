# V3_AUTH_AND_ONBOARDING_PLAN

Status: Phase-2 blueprint after approved schema v1.
Scope: auth + tenant resolution + invitation/onboarding only.
Out of scope: frontend, UI, legacy auth paths, API implementation code.

## 1. Hard decisions (locked)

- JWT standard is mandatory for authenticated flows.
- No fallback tenant resolution is allowed.
- No plaintext password compare is allowed.
- Tenant resolution runs before login and before all tenant app routes.
- Root domain serves central entry + invitation flow + onboarding flow.
- Global admin is a platform identity and is never stored as tenant_user.
- tenant_admin is created only by accepted invitation flow.
- Pending invitation can only be completed through root-domain invitation acceptance flow.
- onboarding lifecycle can only access root onboarding flow.
- active lifecycle can access normal login + app flow.
- suspended and deleted lifecycles are denied with explicit semantics.

## 2. Route map (authoritative)

Root-domain only:
- GET /v1/platform/entry
- POST /v1/invitations
- POST /v1/invitations/{invitationId}/revoke
- POST /v1/invitations/accept
- GET /v1/onboarding/state
- POST /v1/onboarding/complete

Tenant-domain only:
- POST /v1/auth/login
- POST /v1/auth/refresh
- POST /v1/auth/logout
- /v1/app/* (reserved for later phases)

Cross-domain policy:
- No route is dual-scoped.
- Root-only routes on tenant domain return deny.
- Tenant-only routes on root domain return deny.

## 3. Middleware order (global to route)

1. request_id_middleware
2. host_parsing_middleware
3. tenant_resolution_middleware
4. route_scope_gate_middleware (root-only vs tenant-only)
5. lifecycle_gate_middleware
6. jwt_verify_middleware (authenticated routes only)
7. actor_scope_and_role_policy_middleware
8. handler
9. audit_write_middleware (same request context)

Execution rules:
- If any middleware denies, handler is not executed.
- Deny is fail-closed and explicit.

## 4. JWT payload model

Header:
- alg: HS256 (phase 2 default)
- typ: JWT

Claims (mandatory):
- sub: user id (tenant_user.id for tenant actors, platform id for global admin)
- actor_scope: global | tenant
- tenant_id: uuid for tenant scope, null for global scope
- role: global_admin | tenant_admin | project_leader | technician
- iat: issued at
- exp: expiry

Validation rules:
- Signature valid, exp valid, required claims present.
- actor_scope=global requires tenant_id=null and role=global_admin.
- actor_scope=tenant requires tenant_id not null and role in tenant roles.
- Any claim mismatch returns deny.

## 5. Tenant resolution flow

Input:
- Host header

Resolution:
1. Detect root domain vs tenant subdomain.
2. If root domain: set request.scope_domain=root and stop tenant lookup.
3. If tenant domain: extract slug from subdomain.
4. Resolve tenant by slug through tenant + tenant_domain mapping.
5. If no tenant: 404 not_found.
6. If tenant.status=suspended: 410 gone_suspended.
7. If tenant.status=deleted: 410 gone_deleted.
8. If tenant.status=active: attach tenant context and continue.
9. If tenant.status in invited|onboarding: 403 deny_lifecycle.

Additional domain rule:
- Tenant-domain routing requires tenant_domain.active=true and tenant_domain.verified=true.
- If tenant domain record is missing/inactive/unverified: deny as 404 not_found.

## 6. Lifecycle gate matrix

- invited:
  - allowed endpoint: root POST /v1/invitations/accept
  - denied endpoints: all tenant-domain routes and all non-accept root routes
- onboarding:
  - allowed endpoints: root GET /v1/onboarding/state, root POST /v1/onboarding/complete
  - denied endpoints: all tenant-domain routes including /v1/auth/* and /v1/app/*
- active:
  - allowed endpoints: tenant-domain /v1/auth/* and /v1/app/* according to RBAC/scope
- suspended:
  - allowed endpoints: none (tenant app/login denied)
- deleted:
  - allowed endpoints: none (tenant app/login denied)

## 7. Login flow (tenant domain only)

Route:
- POST /v1/auth/login

Preconditions:
- request.scope_domain=tenant
- tenant resolved
- tenant.status=active

Steps:
1. Validate request payload (email, password).
2. Lookup tenant_user by tenant_id + lower(email).
3. Require tenant_user.status=active.
4. Verify password_hash using secure hash verification.
5. Build JWT claims with actor_scope=tenant.
6. Return signed JWT.

Failure behavior:
- Unknown user, bad password, suspended/deleted user, lifecycle mismatch all return deny.

## 8. Invitation accept flow (root domain only)

Route:
- POST /v1/invitations/accept

Preconditions:
- request.scope_domain=root
- invitation status is pending
- expires_at is in the future
- token hash matches stored token_hash

Transactional steps:
1. Lock invitation row.
2. Re-validate pending + not expired + not revoked.
3. Create tenant with status=onboarding.
4. Create tenant_user first admin with role=tenant_admin, status=active.
5. Create tenant_domain with verified=false, active=false.
6. Mark invitation accepted, set accepted_at, set tenant_id.
7. Issue tenant JWT for created tenant_admin.
8. Commit transaction.

Postconditions:
- tenant_admin exists only because invitation was accepted.

## 9. Onboarding completion flow (root domain only)

Routes:
- GET /v1/onboarding/state
- POST /v1/onboarding/complete

Preconditions:
- request.scope_domain=root
- tenant.status=onboarding
- requester authenticated as tenant_admin in same tenant
- tenant context is derived from onboarding JWT claim tenant_id (not from tenant host)

POST /v1/onboarding/complete steps:
1. Validate onboarding payload.
2. Validate tenant_domain record exists for tenant.
3. Require domain verified=true.
4. Set tenant.status=active.
5. Set tenant_domain.active=true.
6. Commit.

Guarantee:
- active state is not reachable before verified domain + explicit completion.
- tenant-domain auth/app is not reachable before tenant.status=active and tenant_domain verified+active.

## 10. Deny paths (explicit)

- Missing or invalid JWT on protected routes: 401 unauthorized.
- Root-only route on tenant domain: 403 deny_wrong_domain.
- Tenant-only route on root domain: 403 deny_wrong_domain.
- Unknown tenant slug/domain: 404 not_found.
- Suspended tenant: 410 gone_suspended.
- Deleted tenant: 410 gone_deleted.
- invited lifecycle on tenant domain: 403 deny_lifecycle.
- onboarding lifecycle on tenant domain: 403 deny_lifecycle.
- global_admin token on tenant data route: 403 deny_scope.

## 11. Audit_event logging points

Required events used in this phase:
- invitation_created
- invitation_accepted
- invitation_revoked
- login_success
- login_fail
- tenant_status_changed
- role_changed
- support_access_denied (if support endpoint is attempted)

Write points:
- POST /v1/invitations success -> invitation_created
- POST /v1/invitations/{id}/revoke success -> invitation_revoked
- POST /v1/invitations/accept success -> invitation_accepted + role_changed
- POST /v1/auth/login success -> login_success
- POST /v1/auth/login fail -> login_fail
- POST /v1/onboarding/complete success -> tenant_status_changed
- Any support-access attempt in phase 1 -> support_access_denied with outcome=deny

Audit guarantees:
- Events written in same request context.
- No secret values in metadata.
