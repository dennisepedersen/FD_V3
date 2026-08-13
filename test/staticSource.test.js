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

test('project page loads shared drawing engine before CCTV adapter and auth', () => {
  const project = read('backend/src/public/tenant/project.html');
  const engineIndex = project.indexOf('/tenant/drawing-engine.js');
  const adapterIndex = project.indexOf('/tenant/project-equipment-cctv-drawing-adapter.js');
  const authIndex = project.indexOf('/tenant/auth.js');
  assert.ok(engineIndex > -1);
  assert.ok(adapterIndex > engineIndex);
  assert.ok(authIndex > adapterIndex);
});

test('tenant asset versioning and routes include shared drawing engine assets', () => {
  const routes = read('backend/src/routes/tenantSurfaceRoutes.js');
  const version = read('backend/src/utils/tenantAssetVersion.js');
  assert.match(routes, /\/tenant\/drawing-engine\.js/);
  assert.match(routes, /\/tenant\/project-equipment-cctv-drawing-adapter\.js/);
  assert.match(version, /\/tenant\/drawing-engine\.js/);
  assert.match(version, /\/tenant\/project-equipment-cctv-drawing-adapter\.js/);
});

test('shared drawing engine is domain-neutral and CCTV mapping stays in adapter', () => {
  const engine = read('backend/src/public/tenant/drawing-engine.js');
  const adapter = read('backend/src/public/tenant/project-equipment-cctv-drawing-adapter.js');
  assert.doesNotMatch(engine, /camera|cctv|mac|serial|restarbejde|defect|obs|equipment/i);
  assert.match(adapter, /project_equipment_cctv_pin/);
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

test('tenant absence UI uses request backend contracts instead of legacy hardcoded types', () => {
  const html = read('backend/src/public/tenant/app.html');
  const auth = read('backend/src/public/tenant/auth.js');
  const routes = read('backend/src/modules/absence/absence.routes.js');
  assert.match(html, /data-calendar-tab="requests"/);
  assert.match(html, /id="absenceRequestTypeSelect"/);
  assert.match(html, /id="absenceManagerPanel"/);
  assert.match(html, /data-calendar-tab="team"/);
  assert.match(html, /data-absence-team-tab/);
  assert.match(html, /id="absenceTeamAgendaPanel"/);
  assert.match(html, />Teamkalender</);
  assert.match(html, /id="specialWindowsPanel"/);
  const requestForm = html.slice(html.indexOf('id="absenceRequestForm"'), html.indexOf('id="absenceAgendaPanel"'));
  assert.doesNotMatch(requestForm, /option value="vacation"|option value="sickness"|option value="course"/);
  assert.match(auth, /\/api\/calendar\/absence-types\/request-options/);
  assert.match(routes, /items: result\.items/);
  assert.match(auth, /Array\.isArray\(response\.items\)/);
  assert.match(auth, /requestTypesLoadError/);
  assert.match(auth, /Fravaerstyperne kunne ikke hentes\. Proev igen\./);
  assert.match(auth, /Der er ingen fravaerstyper tilgaengelige\. Kontakt din administrator\./);
  assert.match(auth, /allowed_duration_types\.some\(\(item\) => item === "full_days" \|\| item === "time_range"\)/);
  assert.match(html, /id="absenceDurationFullDays"[\s\S]*Hele dage/);
  assert.match(html, /id="absenceDurationTimeRange"[\s\S]*Bestemt tidsrum/);
  assert.match(auth, /full\.disabled = !allowed\.has\("full_days"\)/);
  assert.match(auth, /time\.disabled = !allowed\.has\("time_range"\)/);
  assert.match(auth, /const policy = String\(type && type\.comment_policy \? type\.comment_policy : "optional"\)/);
  assert.match(auth, /input\.required = policy === "required"/);
  assert.match(auth, /state\.calendar\.requestTypesLoaded = true;\s*state\.calendar\.requestTypesLoadError = "";/);
  assert.doesNotMatch(auth, /catch \(error\) \{[\s\S]{0,500}state\.calendar\.requestTypes = \[\]/);
  assert.match(auth, /\/api\/calendar\/absence-requests\/mine/);
  assert.match(auth, /\/api\/calendar\/absence-requests\/manager\/pending/);
  assert.match(auth, /\/api\/calendar\/events\/mine/);
  assert.match(auth, /\/api\/calendar\/events\/team/);
  assert.match(auth, /teamAgendaAccessDenied/);
  assert.match(auth, /setCalendarTabVisibility\("\[data-absence-team-tab\]", !state\.calendar\.teamAgendaAccessDenied\)/);
  assert.match(auth, /loadTeamAbsenceAgenda\(\{ silent: true \}\)/);
  assert.match(auth, /if \(error && error\.status === 403\) \{\s*state\.calendar\.teamAgendaAccessDenied = true;/);
  assert.match(auth, /appendText\(card, "p", "absenceName", event\.title \|\| "Fravaer"\)/);
  assert.doesNotMatch(auth, /absenceTeamAgendaSection/);
  assert.match(auth, /\/api\/calendar\/special-windows/);
  assert.match(auth, /"Idempotency-Key"/);
  assert.match(auth, /getAbsenceDomainErrorMessage/);
  assert.match(auth, /requestDraftSaving/);
  assert.match(auth, /requestSubmitting/);
  assert.match(auth, /setAbsenceRequestActionPending\(true\)/);
  assert.match(auth, /setAbsenceRequestActionPending\(false\)/);
  assert.match(auth, /managerDecisionSubmitting/);
  assert.match(auth, /setManagerDecisionPending\(true\)/);
  assert.match(auth, /dataset\.managerDecisionAction/);
  assert.match(auth, /label\.setAttribute\("for", reasonId\)/);
  assert.match(auth, /label\.textContent = "Besked til medarbejderen"/);
  assert.match(auth, /textarea\.maxLength = 500/);
  assert.match(auth, /textarea\.required = false/);
  assert.match(auth, /Valgfri besked ved godkendelse eller afvisning/);
  assert.match(auth, /textarea\.setAttribute\("aria-describedby", counterId\)/);
  assert.match(auth, /String\(textarea && textarea\.value \|\| ""\)\.length\} \/ 500/);
  assert.match(auth, /const decisionMessage = String\(reason \|\| ""\)\.trim\(\)/);
  assert.match(auth, /if \(decisionMessage\) payload\.reason = decisionMessage/);
  assert.match(auth, /renderManagerRequestDetail\(response && response\.request \? \{ \.\.\.response\.request, events: response\.events \|\| \[\] \} : response\)/);
  assert.match(auth, /renderAbsenceRequestDetail\(response && response\.request \? \{ \.\.\.response\.request, events: response\.events \|\| \[\] \} : response\)/);
  assert.match(auth, /Privat kommentar vedlagt\./);
  assert.doesNotMatch(auth, /Privat kommentar findes, men kraever saerskilt adgang\./);
  assert.doesNotMatch(auth, /outbox apply|sendRealMail|worksheet-sync|EK-sync/i);
});

test('tenant admin manager dropdown uses unfiltered active login candidates', () => {
  const auth = read('backend/src/public/tenant/auth.js');
  assert.match(auth, /managerCandidateUsers: \[\]/);
  assert.match(auth, /managerCandidatesLoaded: false/);
  assert.match(auth, /Array\.isArray\(state\.tenantAdmin\.managerCandidateUsers\)/);
  assert.match(auth, /state\.tenantAdmin\.managerCandidateUsers = state\.tenantAdmin\.users/);
  assert.match(auth, /loadTenantAdminManagerCandidateUsers\(\{ force: opts\.refreshManagerCandidates === true \}\)/);
  assert.match(auth, /apiFetch\("\/api\/tenant\/admin\/users", \{ method: "GET" \}\)/);
  assert.match(auth, /String\(candidate\.tenant_user_id\) === employeeUserId/);
});

test('tenant admin current manager inactive label uses backend status fields', () => {
  const auth = read('backend/src/public/tenant/auth.js');
  assert.match(auth, /function isTenantAdminCurrentManagerInactive\(user\)/);
  assert.match(auth, /user\.primary_manager_status/);
  assert.match(auth, /user\.primary_manager_login_status/);
  assert.match(auth, /isTenantAdminCurrentManagerInactive\(user\)\s*\? `[\s\S]*\(ikke aktiv login\)`/);
  assert.doesNotMatch(auth, /current\.textContent = `\$\{getTenantAdminManagerLabel\(user\)\} \(ikke aktiv login\)`/);
});

test('special-window preflight UI and admin scope controls are wired', () => {
  const html = read('backend/src/public/tenant/app.html');
  const auth = read('backend/src/public/tenant/auth.js');
  const routes = read('backend/src/modules/absence/absence.routes.js');

  assert.match(routes, /\/api\/calendar\/absence-requests\/preflight/);
  assert.ok(routes.indexOf('/api/calendar/absence-requests/preflight') < routes.indexOf('/api/calendar/absence-requests/:id'));
  assert.match(auth, /requestPreflightSeq/);
  assert.match(auth, /requestPreflightSignature/);
  assert.match(auth, /requestPreflightLoading/);
  assert.match(auth, /apiFetch\("\/api\/calendar\/absence-requests\/preflight"/);
  assert.match(auth, /state\.calendar\.requestPreflightSeq !== seq/);
  assert.match(auth, /Perioden kunne ikke kontrolleres\. Proev igen\./);
  assert.match(auth, /requestPreflight\.can_submit === false/);
  assert.match(auth, /button\.disabled = !type[\s\S]+getAbsenceRequestPreflightBlockMessage\(\)/);
  assert.match(auth, /Ferieonskeperiode: \$\{state\.calendar\.requestPreflight\.special_window\.name/);
  assert.match(html, /id="absenceRequestPreflightStatus"/);
  assert.match(html, /id="specialWindowKeyField"[^>]*hidden/);
  assert.match(html, /id="specialWindowKeyInput" maxlength="64" readonly/);
  assert.doesNotMatch(html, /id="specialWindowKeyInput"[^>]*required/);
  assert.match(html, /id="specialWindowClearTypeScopeBtn"[\s\S]*Ryd valg/);
  assert.match(html, /id="specialWindowClearUserScopeBtn"[\s\S]*Ryd valg/);
  assert.match(html, /id="specialWindowClearGroupScopeBtn"[\s\S]*Ryd valg/);
  assert.match(html, /Ingen valgte typer betyder alle ferieonskeegnede typer/);
  assert.match(auth, /clearSelectedValues\(byId\("specialWindowTypeScopeSelect"\)\)/);
  assert.match(auth, /clearSelectedValues\(byId\("specialWindowUserScopeSelect"\)\)/);
  assert.match(auth, /clearSelectedValues\(byId\("specialWindowGroupScopeSelect"\)\)/);
  assert.match(auth, /payload\.absence_type_ids = typeIds/);
  assert.doesNotMatch(auth, /key: String\(byId\("specialWindowKeyInput"\)/);
});