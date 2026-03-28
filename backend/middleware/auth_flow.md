# auth_flow middleware blueprint

Purpose: deterministic auth middleware sequence for tenant and global actors.

## Middleware stack

1. parse_authorization_header
- Extract Bearer token if present.
- If malformed header on protected route: 401 unauthorized.

2. verify_jwt_signature_and_exp
- Validate JWT signature and exp.
- If invalid: 401 unauthorized.

3. validate_claim_shape
- Require claims: sub, actor_scope, tenant_id, role, iat, exp.
- Reject missing or malformed claims.

4. enforce_actor_scope_consistency
- If actor_scope=global then tenant_id must be null and role must be global_admin.
- If actor_scope=tenant then tenant_id must be non-null and role must be one of tenant_admin/project_leader/technician.
- Any mismatch: 403 deny_scope.

5. bind_actor_context
- actor_scope=global: bind platform actor context only.
- actor_scope=tenant: bind tenant actor context, then continue with tenant checks.

6. enforce_tenant_actor_binding (tenant scope only)
- tenant_id in token must match resolved tenant context.
- sub must resolve to tenant_user in same tenant.
- tenant_user.status must be active.
- Mismatch: 403 deny_scope.

7. route_policy_enforcement
- Apply required_scope + allowed_roles for route.
- No implicit elevation.

## Login-specific behavior

- /v1/auth/login does not require incoming JWT.
- Password verification is hash-based only.
- Plaintext compare is forbidden.
- On success issue JWT with fixed claim model.

## Onboarding-specific behavior

- /v1/onboarding/state and /v1/onboarding/complete are root-domain routes.
- Onboarding routes require tenant_admin JWT with actor_scope=tenant.
- Tenant context for onboarding is read from JWT tenant_id, not tenant host resolution.
- If tenant.status is not onboarding on onboarding routes: 403 deny_lifecycle.

## Token issuance rules

- global_admin token:
  - actor_scope=global
  - tenant_id=null
  - role=global_admin
- tenant token:
  - actor_scope=tenant
  - tenant_id=<tenant uuid>
  - role in tenant roles

## Fail-closed rules

- Any middleware error stops request.
- Handler is never reached after deny.
- Audit logging records login_success/login_fail where relevant.
