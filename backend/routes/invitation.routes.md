# invitation.routes

Scope: root-domain only invitation lifecycle.

## Route definitions

1. POST /v1/invitations
- Domain: root only
- Auth required: yes (global_admin JWT)
- Actor scope/role: actor_scope=global, role=global_admin
- Behavior: create pending invitation with token_hash + expires_at

2. POST /v1/invitations/{invitationId}/revoke
- Domain: root only
- Auth required: yes (global_admin JWT)
- Actor scope/role: actor_scope=global, role=global_admin
- Behavior: set invitation status revoked

3. POST /v1/invitations/accept
- Domain: root only
- Auth required: no (token-based acceptance)
- Behavior: validate token hash + pending + not expired, then transactional onboarding start:
  - create tenant (status=onboarding)
  - create first tenant_user as tenant_admin
  - create tenant_domain (verified=false, active=false)
  - mark invitation accepted
  - issue tenant JWT

4. GET /v1/onboarding/state
- Domain: root only
- Auth required: yes (tenant_admin onboarding JWT)
- Behavior: return onboarding readiness for the tenant from JWT tenant_id context

5. POST /v1/onboarding/complete
- Domain: root only
- Auth required: yes (tenant_admin onboarding JWT)
- Behavior: require tenant.status=onboarding and tenant_domain.verified=true, then set:
  - tenant.status=active
  - tenant_domain.active=true

## Explicit denies

- Tenant-domain call to any invitation route: 403 deny_wrong_domain
- Tenant-domain call to any onboarding route: 403 deny_wrong_domain
- Invitation accept on expired/revoked/non-pending invitation: 403 deny_invitation_state
- Re-accept same invitation: 403 deny_invitation_state
- Any plaintext token persistence: forbidden by design

## Audit points

- invitation create success: invitation_created
- invitation revoke success: invitation_revoked
- invitation accept success: invitation_accepted
- tenant_admin creation via accept: role_changed
