# tenant_resolution middleware blueprint

Purpose: resolve domain context before login and tenant app routing.

## Input

- HTTP Host header

## Sequence

1. normalize_host
- Lowercase and normalize host.
- Invalid host format: 400 bad_request.

2. classify_domain
- Determine root domain or tenant subdomain.
- Set request.domain_scope to root or tenant.

3. root_domain_path
- If root, skip tenant lookup.
- Permit only root-domain routes, including invitation and onboarding flow.

4. tenant_domain_path
- Extract slug from subdomain.
- Lookup tenant by slug and tenant_domain mapping.
- Require tenant_domain.verified=true and tenant_domain.active=true.

5. status_gate
- tenant.status=invited: deny all tenant-domain routes with 403 deny_lifecycle.
- tenant.status=onboarding: deny all tenant-domain routes with 403 deny_lifecycle.
- tenant.status=active: allow auth/app routing.
- tenant.status=suspended: deny 410 gone_suspended.
- tenant.status=deleted: deny 410 gone_deleted.

6. attach_context
- Attach tenant_id, slug, status to request context for downstream auth and policy middleware.

## Route guard contract

- Root-domain only routes on tenant domain: 403 deny_wrong_domain.
- Tenant-domain only routes on root domain: 403 deny_wrong_domain.
- Invitation accept and onboarding are root-only and never run on tenant host.
- Tenant-domain /v1/auth/* and /v1/app/* are valid only for active tenants with verified+active tenant_domain.
- No tenant fallback, no implicit tenant, no default slug.

## Interaction with auth middleware

- tenant_resolution executes before auth middleware on tenant routes.
- auth middleware must validate tenant_id claim against resolved tenant context.
- global_admin has no implicit access to tenant-domain app routes.

## Audit expectations

- Deny decisions from resolution/lifecycle gates are logged with outcome=deny.
- Support-access attempts in phase 1 log support_access_denied.
