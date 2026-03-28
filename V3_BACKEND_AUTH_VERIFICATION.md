# V3_BACKEND_AUTH_VERIFICATION

## Executive Summary

Verification/debug pass completed for Phase-1 backend auth foundation.
Result: core flows are aligned with blueprint and schema after targeted fixes.
Current readiness: GO for controlled local integration testing (with required runtime setup gaps addressed below).

## Found Errors

1. Audit write in failure handlers could mask primary business errors.
- Area: invitation accept fail path, onboarding complete fail path.
- Risk: if audit insert failed, API could return wrong error cause.

2. Tenant resolution deny behavior depended on audit DB availability.
- Area: tenantResolution deny branches.
- Risk: intended 403/404/410 deny could become 500 if audit write failed.

3. Onboarding state endpoint did not enforce onboarding lifecycle.
- Area: getOnboardingState.
- Risk: onboarding token could query state after lifecycle drift.

4. Production error response could expose internal 500-level messages.
- Area: central error handler.
- Risk: information disclosure via raw error message.

## Fixed Errors

1. Preserved primary errors on fail-audit paths.
- File: backend/src/services/invitationService.js
- Change: wrapped fail-audit write in nested try/catch and ignored audit insert failure.
- Added explicit revoked invitation guard in accept flow.

2. Preserved primary errors on onboarding fail-audit path.
- File: backend/src/services/onboardingService.js
- Change: wrapped fail-audit write in nested try/catch and ignored audit insert failure.

3. Enforced onboarding lifecycle for state endpoint.
- File: backend/src/services/onboardingService.js
- Change: getOnboardingState now returns 403 if tenant.status is not onboarding.

4. Made tenant-resolution deny deterministic.
- File: backend/src/middleware/tenantResolution.js
- Change: deny audit writes are best-effort and cannot change deny outcome.

5. Hardened production error responses.
- File: backend/src/middleware/errorHandler.js
- Change: for status >=500 in production, response message is forced to "Internal Server Error".

## Verification Checklist

### A. Schema alignment
- Query/table names match schema.sql for:
  - tenant, tenant_domain, tenant_invitation, tenant_user, tenant_config, tenant_config_snapshot, audit_event.
- Status values align with check constraints:
  - tenant.status: onboarding/active etc.
  - invitation.status checks respected.
  - user.status active enforced for login.
- Audit event_type usage aligns with schema-constrained values:
  - invitation_accepted, login_success, login_fail, tenant_status_changed, tenant_config_changed, support_access_denied.

### B. Transaction correctness
- Invitation accept runs in single withTransaction boundary.
- Onboarding complete runs in single withTransaction boundary.
- Success audit writes are inside transaction for both flows.
- On failure, transaction rolls back and failure audit is attempted out-of-transaction without overriding primary error.

### C. Host routing correctness
- root-only routes guarded by requireRootHost.
- tenant-only route guarded by requireTenantHost.
- tenantResolution middleware is registered globally before routes.
- onboarding endpoints are root-only.

### D. JWT correctness
- access and onboarding tokens have explicit type claim.
- requireAuth verifies expected token type via verifyToken.
- required payload claims validated: sub, tenant_id, role, email, actor_scope.
- no insecure default secret; JWT_SECRET is required at startup.

### E. Password flow
- bcrypt hashing and verify used.
- no plaintext compare path.
- login cannot bypass password check.
- configured bcrypt cost is 12.

### F. Error handling
- centralized errorHandler is active.
- JSON error format is consistent.
- no stack trace in production.
- internal 500 details are hidden in production.

### G. Audit coverage
- invitation accept success/fail hooks present.
- onboarding complete success/fail hooks present.
- login success/fail hooks present.
- tenant resolution deny hook present.
- no password or raw invitation token logged.

## Remaining Known Gaps (Drift / Local Run Prereqs)

1. package/dependency manifest is not included in this phase deliverables.
- Missing explicit dependency installation workflow in-repo (express, pg, jsonwebtoken, bcrypt).

2. No startup scripts documented in codebase files delivered here.
- Need a run command convention for local boot.

3. No env sample file in this deliverable scope.
- Required vars are enforced in code: DATABASE_URL, JWT_SECRET, ROOT_DOMAIN.
- Optional/used: PORT, NODE_ENV, INVITATION_JWT_SECRET.

4. DB bootstrap/migration execution is not wired in backend runtime.
- Migrations must be applied manually before running backend.

5. Operational DB connectivity checks at startup are not implemented.
- App fails on query-time if DB is unavailable.

## Go / No-Go

- GO for local test, conditioned on:
  - dependencies installed,
  - environment variables set,
  - migrations applied,
  - PostgreSQL reachable.
