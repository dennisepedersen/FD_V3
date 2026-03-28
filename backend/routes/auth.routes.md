# auth.routes

Scope: tenant-domain only routes for authentication.

## Route definitions

1. POST /v1/auth/login
- Domain: tenant only
- Auth required: no (credential login endpoint)
- Tenant resolution required before handler: yes
- Lifecycle allowed: active only
- Behavior: verify tenant_user credentials and return JWT

2. POST /v1/auth/refresh
- Domain: tenant only
- Auth required: yes (valid tenant JWT)
- Tenant resolution required before handler: yes
- Lifecycle allowed: active only
- Behavior: re-issue JWT with same actor scope and tenant context

3. POST /v1/auth/logout
- Domain: tenant only
- Auth required: yes (valid tenant JWT)
- Tenant resolution required before handler: yes
- Lifecycle allowed: active only
- Behavior: invalidate current session token according to token policy

## Explicit denies

- Root domain call to any /v1/auth/* route: 403 deny_wrong_domain
- Tenant lifecycle invited/onboarding calling any /v1/auth/* route: 403 deny_lifecycle
- Tenant lifecycle suspended/deleted calling any /v1/auth/* route: 410 lifecycle_denied
- Global admin token on /v1/auth/* tenant route: 403 deny_scope

## Audit points

- login success: login_success
- login failure: login_fail
