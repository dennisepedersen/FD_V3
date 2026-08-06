'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

test('tenant admin invite checkbox flow keeps create before invite and validates response target', () => {
  const auth = read('backend/src/public/tenant/auth.js');
  const createIndex = auth.indexOf('apiFetch("/api/tenant/admin/users"');
  const inviteIndex = auth.indexOf('sendTenantAdminUserInvite(createdUser');
  assert.ok(createIndex > -1);
  assert.ok(inviteIndex > createIndex);
  assert.match(auth, /const shouldSendInvite = Boolean/);
  assert.match(auth, /createdUser\.tenant_user_id \|\| createdUser\.fitter_row_id/);
  assert.match(auth, /Brugeren blev oprettet, men oprettelseslinket kunne ikke sendes/);
});

test('public tenant files do not expose invitation storage fields', () => {
  const publicText = [
    read('backend/src/public/tenant/auth.js'),
    read('backend/src/public/tenant/accept-invite.html'),
    read('backend/src/public/tenant/app.html'),
  ].join('\n');
  assert.doesNotMatch(publicText, /token_hash|accept_url/);
});

test('sync worker is disabled in NODE_ENV=test to keep checks DB-free', () => {
  const worker = read('backend/src/services/syncWorker.js');
  assert.match(worker, /env\.NODE_ENV === "test"/);
});

test('project page loads shared drawing engine before adapters and auth', () => {
  const project = read('backend/src/public/tenant/project.html');
  const engineIndex = project.indexOf('/tenant/drawing-engine.js');
  const cctvAdapterIndex = project.indexOf('/tenant/project-equipment-cctv-drawing-adapter.js');
  const restarbejdeAdapterIndex = project.indexOf('/tenant/project-restarbejde-drawing-adapter.js');
  const authIndex = project.indexOf('/tenant/auth.js');
  assert.ok(engineIndex > -1);
  assert.ok(cctvAdapterIndex > engineIndex);
  assert.ok(restarbejdeAdapterIndex > cctvAdapterIndex);
  assert.ok(authIndex > restarbejdeAdapterIndex);
});

test('tenant asset versioning and routes include shared drawing engine assets', () => {
  const routes = read('backend/src/routes/tenantSurfaceRoutes.js');
  const version = read('backend/src/utils/tenantAssetVersion.js');
  assert.match(routes, /\/tenant\/drawing-engine\.js/);
  assert.match(routes, /\/tenant\/project-equipment-cctv-drawing-adapter\.js/);
  assert.match(routes, /\/tenant\/project-restarbejde-drawing-adapter\.js/);
  assert.match(version, /\/tenant\/drawing-engine\.js/);
  assert.match(version, /\/tenant\/project-equipment-cctv-drawing-adapter\.js/);
  assert.match(version, /\/tenant\/project-restarbejde-drawing-adapter\.js/);
});

test('shared drawing engine is domain-neutral and CCTV mapping stays in adapter', () => {
  const engine = read('backend/src/public/tenant/drawing-engine.js');
  const adapter = read('backend/src/public/tenant/project-equipment-cctv-drawing-adapter.js');
  assert.doesNotMatch(engine, /camera|cctv|mac|serial|restarbejde|defect|obs|equipment/i);
  assert.match(adapter, /project_equipment_cctv_pin/);
});

test('Restarbejde frontend is a project tab with its own drawing adapter', () => {
  const project = read('backend/src/public/tenant/project.html');
  const auth = read('backend/src/public/tenant/auth.js');
  const adapter = read('backend/src/public/tenant/project-restarbejde-drawing-adapter.js');
  assert.match(project, /data-project-module-tab="restarbejde"/);
  assert.match(project, /data-project-module-panel="restarbejde"/);
  assert.match(auth, /function restarbejdeCan/);
  assert.match(auth, /restarbejde\/items/);
  assert.match(auth, /FielddeskRestarbejdeDrawingAdapter/);
  assert.match(auth, /archiveRestarbejdeDrawing/);
  assert.match(auth, /restoreRestarbejdeDrawing/);
  assert.match(auth, /archiveRestarbejdePlacement/);
  assert.match(adapter, /project_restarbejde_placement/);
  assert.match(adapter, /x_percent/);
  assert.match(adapter, /y_percent/);
});
test('tenant user lifecycle migration is append-only and session-version backed', () => {
  const migration = read('migrations/0037_tenant_user_lifecycle.sql');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0/);
  assert.match(migration, /status IN \('active', 'suspended', 'invited', 'deleted', 'deactivated', 'pending_reactivation'\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS tenant_user_lifecycle_event/);
  assert.match(migration, /trg_tenant_user_lifecycle_event_prevent_update/);
  assert.match(migration, /trg_tenant_user_lifecycle_event_prevent_delete/);
  assert.match(migration, /tenant_user_reactivation_invite_failed/);
});

test('access auth checks active DB status and session version after JWT verification', () => {
  const auth = read('backend/src/middleware/requireAuth.js');
  const jwt = read('backend/src/services/jwtService.js');
  const login = read('backend/src/routes/tenantAuthRoutes.js');
  assert.match(jwt, /session_version: Number\(sessionVersion \|\| 0\)/);
  assert.match(jwt, /Number\.isInteger\(payload\.session_version\)/);
  assert.match(auth, /findSessionTenantUserById/);
  assert.match(auth, /user\.status === "active"/);
  assert.match(auth, /user\.login_status === "active"/);
  assert.match(auth, /session_revoked/);
  assert.match(login, /sessionVersion: user\.session_version/);
});

test('tenant lifecycle service protects deactivation and reactivation invariants', () => {
  const service = read('backend/src/modules/tenantAdmin/tenantAdmin.service.js');
  const invitations = read('backend/src/modules/tenantAdmin/tenantUserInvitation.service.js');
  const ui = read('backend/src/public/tenant/auth.js');
  assert.match(service, /self_deactivation_not_allowed/);
  assert.match(service, /last_active_tenant_admin/);
  assert.match(service, /revokeOpenTenantUserInvitations/);
  assert.match(service, /tenant_user_sessions_revoked/);
  assert.match(service, /tenant_user_requires_reactivation/);
  assert.match(invitations, /sendTenantUserReactivationInvitation/);
  assert.match(invitations, /active_user_cannot_be_reactivated/);
  assert.match(invitations, /status = 'pending_reactivation'/);
  assert.match(invitations, /tenant_user_reactivated/);
  assert.match(ui, /Deaktiver bruger/);
  assert.match(ui, /Genaktiver med oprettelseslink/);
  assert.match(ui, /Gensend genaktiveringslink/);
  assert.match(ui, /Begrundelse er paakraevet/);
});
