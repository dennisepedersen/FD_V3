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
  assert.match(auth, /Fraværstyperne kunne ikke hentes\. Prøv igen\./);
  assert.match(auth, /Der er ingen fraværstyper tilgængelige\. Kontakt din administrator\./);
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
  assert.match(auth, /appendText\(card, "p", "absenceName", event\.title \|\| "Fravær"\)/);
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
  assert.match(auth, /renderManagerRequestDetail\(response && response\.request \? \{ \.\.\.response\.request, events: response\.events \|\| \[\] \} : response, detail\)/);
  assert.match(auth, /renderAbsenceRequestDetail\(response && response\.request \? \{ \.\.\.response\.request, events: response\.events \|\| \[\] \} : response, detail\)/);
  assert.match(auth, /Kommentar vedlagt\./);
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
  assert.match(auth, /Perioden kunne ikke kontrolleres\. Prøv igen\./);
  assert.match(auth, /requestPreflight\.can_submit === false/);
  assert.match(auth, /getAbsencePreflightDomainText/);
  assert.match(auth, /Der kan først søges fra/);
  assert.match(auth, /Fristen for ferieønsker var/);
  assert.match(auth, /vacation_day_quota_exempt/);
  assert.match(auth, /vacation_day_quota_collective/);
  assert.match(auth, /vacation_day_quota_split_required/);
  assert.match(auth, /Denne anmodning bruger/);
  assert.match(auth, /Efter denne anmodning har du brugt/);
  assert.match(auth, /usedDisplay = Math\.min\(total, used\)/);
  assert.match(auth, /active_collective_count/);
  assert.match(auth, /vil ogs\\u00e5 indg\\u00e5 i den f\\u00e6lles behandling/);
  assert.match(auth, /f\\u00e6lles behandling af ferie\\u00f8nsker/);
  assert.doesNotMatch(auth, /Blokeret af kontrol|validation failed|domain blocked|late-policy/i);
  assert.match(auth, /button\.disabled = !type[\s\S]+getAbsenceRequestPreflightBlockMessage\(\)/);
  assert.match(auth, /function isManagerDecisionBlockedBeforeReview\(request\)/);
  assert.match(auth, /Kan behandles fra \$\{formatDisplayDate\(request\.special_window\.review_start_date\)\}/);
  assert.match(auth, /approveButton\.disabled = state\.calendar\.managerDecisionSubmitting \|\| blockedBeforeReview/);
  assert.match(auth, /rejectButton\.disabled = state\.calendar\.managerDecisionSubmitting \|\| blockedBeforeReview/);
  assert.match(auth, /Ferieønskeperiode: \$\{state\.calendar\.requestPreflight\.special_window\.name/);
  assert.match(html, /id="absenceRequestPreflightStatus"/);
  assert.match(html, /id="specialWindowKeyField"[^>]*hidden/);
  assert.match(html, /id="specialWindowKeyInput" maxlength="64" readonly/);
  assert.doesNotMatch(html, /id="specialWindowKeyInput"[^>]*required/);
  assert.match(html, /id="specialWindowClearTypeScopeBtn"[\s\S]*Ryd valg/);
  assert.match(html, /id="specialWindowClearUserScopeBtn"[\s\S]*Ryd valg/);
  assert.match(html, /id="specialWindowClearGroupScopeBtn"[\s\S]*Ryd valg/);
  assert.match(html, /Ingen valgte typer betyder alle ferieønskeegnede typer/);
  assert.match(auth, /clearSelectedValues\(byId\("specialWindowTypeScopeSelect"\)\)/);
  assert.match(auth, /clearSelectedValues\(byId\("specialWindowUserScopeSelect"\)\)/);
  assert.match(auth, /clearSelectedValues\(byId\("specialWindowGroupScopeSelect"\)\)/);
  assert.match(auth, /payload\.absence_type_ids = typeIds/);
  assert.doesNotMatch(auth, /key: String\(byId\("specialWindowKeyInput"\)/);
});

test('absence item actions use focused modal instead of inline detail panels', () => {
  const html = read('backend/src/public/tenant/app.html');
  const auth = read('backend/src/public/tenant/auth.js');

  assert.match(html, /id="absenceActionModal"/);
  assert.match(html, /id="absenceActionModalBody"/);
  assert.match(html, /class="fdModalPanel absenceActionPanel"/);
  assert.doesNotMatch(html, /id="absenceRequestDetail"/);
  assert.doesNotMatch(html, /id="absenceManagerDetail"/);
  assert.doesNotMatch(html, /id="specialWindowReviewPanel"/);
  assert.match(auth, /function openAbsenceActionModal\(kind, trigger\)/);
  assert.match(auth, /function closeAbsenceActionModal\(\)/);
  assert.match(auth, /loadMineAbsenceRequestDetail\(request\.id, event\.currentTarget\)/);
  assert.match(auth, /loadManagerRequestDetail\(request\.id, event\.currentTarget\)/);
  assert.match(auth, /openSpecialWindowEdit\(item\.id, event\.currentTarget\)/);
  assert.match(auth, /loadSpecialWindowReview\(item\.id, event\.currentTarget\)/);
  assert.match(auth, /getAbsenceActionBody\("manager", trigger/);
  assert.match(auth, /getAbsenceActionBody\("special-window-review", trigger/);
  assert.match(auth, /tenantAdminActiveModal\.modal === absenceActionModal/);
  assert.match(auth, /data-absence-modal-close/);
  assert.match(auth, /confirmAbsenceAction/);
  assert.doesNotMatch(auth, /window\.confirm\("Vil du godkende anmodningen/);
  assert.doesNotMatch(auth, /window\.confirm\("Vil du annullere denne fraværsanmodning/);
  assert.doesNotMatch(auth, /window\.confirm\("Vil du arkivere ferieønskeperioden/);
});

test('absence UI polish exposes focused feedback, split preview and contrast hooks', () => {
  const html = read('backend/src/public/tenant/app.html');
  const auth = read('backend/src/public/tenant/auth.js');
  const calendarHtml = html.slice(html.indexOf('id="calendarView"'), html.indexOf('id="absenceActionModal"'));

  assert.match(html, /\.absenceWorkspaceTabs \.calendarTab\[aria-selected="true"\]/);
  assert.match(html, /\.calendarField select\[multiple\]/);
  assert.match(html, /\.calendarField input:disabled/);
  assert.match(html, /\.appShell \.absenceStatus-approved/);
  assert.match(html, /\.absenceStatus-rejected/);
  assert.match(auth, /function appendRequestStatusBadge\(parent, request\)/);
  assert.match(auth, /appendRequestStatusBadge\(header, request\)/);
  assert.match(auth, /showAbsencePreflightFeedback/);
  assert.match(auth, /Du kan ikke sende anmodningen endnu/);
  assert.match(auth, /Deadline er overskredet/);
  assert.match(auth, /Perioden skal deles/);
  assert.match(auth, /Fielddesk foreslår/);
  assert.match(auth, /Del anmodningen automatisk/);
  assert.match(auth, /confirmAbsenceSplitSuggestion/);
  assert.match(auth, /Opret \$\{segments\.length\} anmodninger/);
  assert.match(auth, /\/api\/calendar\/absence-requests\/split-submit/);
  assert.match(auth, /requestSplitIdempotencyKey/);
  assert.doesNotMatch(auth, /absence-split-create/);
  assert.match(auth, /requestSplitSubmitting/);
  assert.match(auth, /Fielddesk har kontrolleret perioden server-side/);
  assert.match(auth, /Noget gik galt\. Prøv igen\./);
  assert.match(auth, /function refreshCalendarWorkspace\(reason, options = \{\}\)/);
  assert.match(auth, /window\.addEventListener\("focus"/);
  assert.match(auth, /visibility-return/);
  assert.match(auth, /const visibilityScope = absenceType === "sickness" \? "manager_full" : selectedVisibilityScope/);
  assert.match(auth, /absenceVisibilitySelect\.disabled = isSickness/);
  assert.match(auth, /private noter vises ikke i kalenderen/);
  assert.match(auth, /requestPreflightModalKey/);
  assert.match(auth, /maybeShowAbsencePreflightModal/);
  assert.match(auth, /formatRequestLifecycleText/);
  assert.match(auth, /appendSpecialWindowRequestHelp/);
  assert.match(html, /--absence-tab-width: 172px/);
  assert.match(html, /absenceRequestFormGrid/);
  assert.match(html, /absencePreflightNotice/);
  assert.match(html, /font-size: 16px/);
  assert.doesNotMatch(html, /color-scheme: dark/);
  assert.match(auth, /function enhanceMultiSelectToggle\(select\)/);
  assert.match(auth, /option\.selected = !option\.selected/);
  assert.match(auth, /enhanceMultiSelectToggle\(typeSelect\)/);
  assert.match(auth, /enhanceMultiSelectToggle\(userSelect\)/);
  assert.match(auth, /enhanceMultiSelectToggle\(groupSelect\)/);
  assert.doesNotMatch(calendarHtml, /Fravaer|Planlaegning|Ferieonske|Direkte fravaer|Fraværsaarsag|Begraenset|Oekonomi/);
});

test("split submit endpoint is routed before dynamic absence request ids", () => {
  const routes = read("backend/src/modules/absence/absence.routes.js");
  assert.ok(routes.indexOf("/api/calendar/absence-requests/split-submit") > -1);
  assert.ok(routes.indexOf("/api/calendar/absence-requests/split-submit") < routes.indexOf("/api/calendar/absence-requests/:id"));
  assert.match(routes, /requireAbsenceRequestAccess\(req, "create_own"\)/);
  assert.match(routes, /requireAbsenceRequestAccess\(req, "submit_own"\)/);
});

test("tenant mobile form controls keep 16px minimum without viewport zoom hacks", () => {
  const surfaces = [
    ["app", read("backend/src/public/tenant/app.html")],
    ["project", read("backend/src/public/tenant/project.html")],
    ["login", read("backend/src/public/tenant/login.html")],
    ["accept-invite", read("backend/src/public/tenant/accept-invite.html")],
  ];

  for (const [name, source] of surfaces) {
    assert.doesNotMatch(source, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1|minimum-scale\s*=\s*1/i, `${name} must preserve user zoom`);
    assert.match(source, /Fielddesk mobile form-control rule/, `${name} must document the central mobile control rule`);
    assert.match(source, /@media \(hover: none\), \(max-width: 767px\) \{[\s\S]*input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)[\s\S]*font-size: 16px;/, `${name} must keep text-entry controls at 16px on touch/mobile`);
  }

  const app = surfaces.find(([name]) => name === "app")[1];
  assert.match(app, /\.fdCaseSearch input,[^}]*\.fdMobileSearch input,[^}]*\.appShell\.caseOverviewActive \.topSearch input \{[^}]*font-size: 16px;/);
  assert.doesNotMatch(app, /\.fdCaseSearch input,[^}]*\.appShell\.caseOverviewActive \.topSearch input \{[^}]*font-size: 1[0-5]px;/);

  const ruleDoc = read("docs/ui/MOBILE_FORM_CONTROLS.md");
  assert.match(ruleDoc, /font-size: 16px/);
  assert.match(ruleDoc, /user-scalable=no/);

  const project = surfaces.find(([name]) => name === "project")[1];
  assert.match(project, /\.qaInput,[\s\S]*\.qaSelect,[\s\S]*\.qaTextarea,[\s\S]*\.equipmentMacSegment[\s\S]*font-size: 16px;/);
});

test("global datepicker asset is routed, versioned and loaded before tenant auth", () => {
  const routes = read("backend/src/routes/tenantSurfaceRoutes.js");
  const version = read("backend/src/utils/tenantAssetVersion.js");
  const app = read("backend/src/public/tenant/app.html");
  const picker = read("backend/src/public/tenant/fd-datepicker.js");

  assert.match(routes, /\/tenant\/fd-datepicker\.js/);
  assert.match(version, /\/tenant\/fd-datepicker\.js/);
  assert.ok(app.indexOf('/tenant/fd-datepicker.js') > -1);
  assert.ok(app.indexOf('/tenant/fd-datepicker.js') < app.indexOf('/tenant/auth.js'));
  assert.match(picker, /FDDatePicker/);
  assert.match(picker, /FDDateRangePicker/);
  assert.match(picker, /normalizeDecorations/);
  assert.match(picker, /@media \(hover: none\), \(max-width: 767px\)/);
  assert.match(picker, /font-size: 16px/);
  assert.match(picker, /Escape/);
  assert.match(picker, /ArrowLeft/);
  assert.doesNotMatch(picker, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i);
});

test("absence request pilot maps only own and preflight datepicker decorations", () => {
  const auth = read("backend/src/public/tenant/auth.js");
  assert.match(auth, /requestDateRangePicker: null/);
  assert.match(auth, /requestTimeDatePicker: null/);
  assert.match(auth, /new api\.FDDateRangePicker/);
  assert.match(auth, /new api\.FDDatePicker/);
  assert.match(auth, /absenceRequestStartDateInput/);
  assert.match(auth, /absenceRequestEndDateInput/);
  assert.match(auth, /absenceRequestTimeDateInput/);
  assert.match(auth, /await Promise\.all\(\[loadAbsenceRequestTypes\(options\), loadMineAbsenceRequests\(options\), loadAbsenceAgenda\(options\)\]\)/);
  assert.match(auth, /state\.calendar\.mineRequests/);
  assert.match(auth, /state\.calendar\.agendaEvents/);
  assert.match(auth, /state\.calendar\.requestPreflight/);
  assert.match(auth, /getAbsenceRequestPreflightCandidate\(\)/);
  const start = auth.indexOf("function buildAbsenceRequestDateDecorations()");
  const end = auth.indexOf("function refreshAbsenceRequestDatePickers()", start);
  assert.ok(start > -1 && end > start);
  const mapping = auth.slice(start, end);
  assert.doesNotMatch(mapping, /teamEvents|managerRequests|specialWindows|events\/team|manager\/pending|review-overview/);
  assert.match(mapping, /can_submit === false/);
  assert.match(mapping, /disabled/);
  assert.match(mapping, /getAbsencePreflightDomainText\(preflight\)\.label/);
  assert.doesNotMatch(mapping, /Blokeret af kontrol|Perioden kan ikke sendes med de valgte oplysninger/i);
});
test("calendar planning UI uses shared datepickers, tab counts and domain overlap text", () => {
  const html = read("backend/src/public/tenant/app.html");
  const auth = read("backend/src/public/tenant/auth.js");

  assert.match(auth, /directFilterDateRangePicker: null/);
  assert.match(auth, /directCreateDateRangePicker: null/);
  assert.match(auth, /specialWindowAbsenceDateRangePicker: null/);
  assert.match(auth, /specialWindowOpenDatePicker: null/);
  assert.match(auth, /specialWindowDeadlineDatePicker: null/);
  assert.match(auth, /specialWindowReviewStartDatePicker: null/);
  assert.match(auth, /function initializeCalendarDatePickers\(\)/);
  assert.match(auth, /new api\.FDDateRangePicker\(\{[\s\S]*startInput: absenceFromInput[\s\S]*endInput: absenceToInput/);
  assert.match(auth, /new api\.FDDateRangePicker\(\{[\s\S]*startInput: absenceStartDateInput[\s\S]*endInput: absenceEndDateInput/);
  assert.match(auth, /new api\.FDDateRangePicker\(\{[\s\S]*specialWindowAbsenceStartInput[\s\S]*specialWindowAbsenceEndInput/);
  assert.match(auth, /specialWindowOpenDatePicker = new api\.FDDatePicker/);
  assert.match(auth, /specialWindowDeadlineDatePicker = new api\.FDDatePicker/);
  assert.match(auth, /specialWindowReviewStartDatePicker = new api\.FDDatePicker/);
  assert.match(auth, /initializeAbsenceRequestDatePickers\(\);\s*initializeCalendarDatePickers\(\);/);

  assert.match(auth, /function setCalendarTabLabel/);
  assert.match(auth, /function updateCalendarTabCounts/);
  assert.match(auth, /setCalendarTabLabel\("manager", "Afventer behandling"/);
  assert.match(auth, /renderMineAbsenceRequests[\s\S]{0,2000}updateCalendarTabCounts\(\)/);
  assert.match(auth, /renderManagerRequests[\s\S]{0,2000}updateCalendarTabCounts\(\)/);
  assert.match(auth, /renderAbsenceList[\s\S]{0,2000}updateCalendarTabCounts\(\)/);

  assert.match(auth, /function describeDirectAbsencePreflight/);
  assert.match(auth, /Hele perioden er allerede d\\u00e6kket/);
  assert.match(auth, /Fielddesk opretter kun den manglende periode/);
  assert.match(auth, /Intet nyt at registrere/);
  assert.match(auth, /preflight\.already_covered === true/);
  assert.match(auth, /message: messages/);
  assert.match(auth, /Array\.isArray\(options && options\.message\)/);

  assert.doesNotMatch(html, /Legacy tenant-admin flow/);
  assert.match(html, /Registr&eacute;r frav&aelig;r direkte for en medarbejder\./);
});