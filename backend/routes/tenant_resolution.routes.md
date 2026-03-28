# tenant_resolution.routes

Scope: domain ownership map and lifecycle gates per route family.

## Domain families

- Root domain: central platform entry, invitation flow, and onboarding flow
- Tenant domain: auth and app routes for active tenants only

## Root-domain only endpoints

- GET /v1/platform/entry
- POST /v1/invitations
- POST /v1/invitations/{invitationId}/revoke
- POST /v1/invitations/accept
- GET /v1/onboarding/state
- POST /v1/onboarding/complete

## Tenant-domain only endpoints

- POST /v1/auth/login
- POST /v1/auth/refresh
- POST /v1/auth/logout
- /v1/app/* (reserved for later phases)

## Tenant resolution outcomes

1. root host
- tenant lookup: not executed
- allowed routes: root-domain only list

2. tenant host with no matching tenant
- result: 404 not_found

3. tenant host with matching tenant status invited
- allowed routes: none
- all tenant routes: 403 deny_lifecycle

4. tenant host with matching tenant status onboarding
- allowed routes: none
- all tenant routes: 403 deny_lifecycle

5. tenant host with matching tenant status active
- allowed routes: /v1/auth/* and app routes (subject to auth and RBAC)

6. tenant host with matching tenant status suspended
- result: 410 gone_suspended

7. tenant host with matching tenant status deleted
- result: 410 gone_deleted

## Domain integrity requirements

- Tenant route access requires tenant_domain verified=true and active=true.
- Missing/inactive/unverified tenant_domain on tenant host returns 404 not_found.
- No implicit slug fallback and no default tenant.
