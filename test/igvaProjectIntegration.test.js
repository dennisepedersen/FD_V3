'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const projectHtml = fs.readFileSync('backend/src/public/tenant/project.html', 'utf8');
const appHtml = fs.readFileSync('backend/src/public/tenant/app.html', 'utf8');
const authJs = fs.readFileSync('backend/src/public/tenant/auth.js', 'utf8');
const igvaJs = fs.readFileSync('backend/src/public/tenant/igva-poc.js', 'utf8');
const routeSource = fs.readFileSync('backend/src/routes/tenantSurfaceRoutes.js', 'utf8');

function indexOfOrThrow(source, needle) {
  const index = source.indexOf(needle);
  assert.notEqual(index, -1, `Expected to find ${needle}`);
  return index;
}

function getFunctionBody(source, name) {
  const declaration = `function ${name}`;
  const start = source.lastIndexOf(declaration);
  assert.notEqual(start, -1, `Expected to find ${declaration}`);
  const openBrace = source.indexOf("{", start);
  assert.notEqual(openBrace, -1, `Expected to find body for ${name}`);
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openBrace + 1, index);
    }
  }
  assert.fail(`Expected ${name} body to close`);
}

test('project detail tabs default to Overblik and keep required module order', () => {
  const overblik = indexOfOrThrow(projectHtml, 'data-project-module-tab="activity" aria-selected="true">Overblik');
  const documentation = indexOfOrThrow(projectHtml, 'data-project-module-tab="equipment" aria-selected="false">Dokumentation');
  const qa = indexOfOrThrow(projectHtml, 'data-project-module-tab="qa" aria-selected="false">Q&amp;A');
  const igva = indexOfOrThrow(projectHtml, 'data-project-module-tab="igva" aria-selected="false">IGVA');
  assert.ok(overblik < documentation);
  assert.ok(documentation < qa);
  assert.ok(qa < igva);
  const activityPanel = projectHtml.slice(indexOfOrThrow(projectHtml, 'id="activityModule"'), indexOfOrThrow(projectHtml, 'id="igvaSection"'));
  const qaPanel = projectHtml.slice(indexOfOrThrow(projectHtml, 'id="qaSection"'), indexOfOrThrow(projectHtml, 'id="equipmentSection"'));
  assert.match(activityPanel, /data-project-module-panel="activity"/);
  assert.doesNotMatch(activityPanel.slice(0, 180), /hidden/);
  assert.match(qaPanel, /data-project-module-panel="qa"/);
  assert.match(qaPanel.slice(0, 220), /hidden/);
});

test('project detail embeds IGVA without standalone project selector controls', () => {
  const sectionStart = indexOfOrThrow(projectHtml, 'id="igvaSection"');
  const sectionEnd = indexOfOrThrow(projectHtml.slice(sectionStart), '<script src="/tenant/igva-poc.js"></script>') + sectionStart;
  const section = projectHtml.slice(sectionStart, sectionEnd);
  assert.match(section, /id="igvaDashboard"/);
  assert.match(section, /id="igvaTechnicalRows"/);
  assert.match(section, /id="igvaDrawerShell"/);
  assert.doesNotMatch(section, /id="igvaProjectSearch"|id="igvaProjectSelect"|Vis alle/);
  assert.ok(indexOfOrThrow(projectHtml, '<script src="/tenant/igva-poc.js"></script>') < indexOfOrThrow(projectHtml, '<script src="/tenant/auth.js"></script>'));
});

test('embedded IGVA uses current project route and does not rely on client project_ref selector', () => {
  assert.match(authJs, /path\.match\(\/\^\\\/\(\?:project\|sager\)\\\/\(\[\^\/\]\+\)\(\?:\\\/igva\)\?\$\/\)/);
  assert.match(authJs, /function getInitialProjectModuleFromPath/);
  assert.match(authJs, /path\.endsWith\("\/igva"\)/);
  assert.match(authJs, /new Set\(\["activity", "equipment", "qa", "igva"\]\)/);
  assert.match(authJs, /endpoint: "\/api\/projects\/" \+ encodeURIComponent\(String\(projectId\)\) \+ "\/igva"/);
  assert.match(igvaJs, /window\.FielddeskIgvaPoc = \{/);
  assert.match(igvaJs, /async function initEmbeddedProject/);
  assert.match(igvaJs, /state\.mode === 'embedded' && state\.embeddedEndpoint/);
  assert.match(igvaJs, /document\.body\.dataset\.page === 'igva-poc'/);
});

test('project IGVA API is DEP-gated and derives project_ref from server project access', () => {
  assert.match(routeSource, /router\.get\("\/api\/projects\/:projectId\/igva", requireTenantHost, requireAuth\("access"\), requireIgvaPocOnlineAccess/);
  assert.match(routeSource, /projectAccessService\.requireProjectAccess/);
  assert.match(routeSource, /tenantId: req\.context\.tenant\.id/);
  assert.match(routeSource, /userId: req\.auth\.sub/);
  assert.match(routeSource, /external_project_ref/);
  assert.match(routeSource, /server_resolved_project_route/);
});

test('left nav economy opens IGVA overview with active projects as default and optional completed projects', () => {
  assert.match(routeSource, /router\.get\("\/oekonomi", requireTenantHost, sendTenantHtml\("app\.html"\)\)/);
  assert.match(routeSource, /router\.get\("\/projekter", requireTenantHost, sendTenantHtml\("app\.html"\)\)/);
  assert.match(appHtml, /href="\/oekonomi" data-view-link="finance"/);
  assert.match(appHtml, /id="financeView"/);
  assert.match(appHtml, /id="igvaFinanceShowCompleted"/);
  assert.match(authJs, /if \(view === "finance"\) return "\/oekonomi";/);
  assert.match(authJs, /caseOverviewActive", activeView === "projects" \|\| activeView === "finance"/);
  assert.match(authJs, /path === "\/oekonomi"/);
  assert.match(authJs, /includeCompleted: window\.localStorage\.getItem\("fielddesk_igva_finance_show_completed"\) === "true"/);
  assert.match(authJs, /const activeProjects = sortProjects\(all\.filter\(\(project\) => !isIgvaFinanceClosed\(project\)\)\)/);
});

test('economy route renders finance view instead of leaving dashboard active', () => {
  const routeBody = getFunctionBody(authJs, 'getCurrentAppViewFromHash');
  const activeBody = getFunctionBody(authJs, 'setActiveAppView');
  assert.match(routeBody, /path === "\/oekonomi"\) return "finance"/);
  assert.match(routeBody, /path === "\/projekter"/);
  assert.match(activeBody, /view === "finance"/);
  assert.match(activeBody, /dashboardView\.hidden = activeView !== "dashboard"/);
  assert.match(activeBody, /financeView\.hidden = activeView !== "finance"/);
  assert.match(activeBody, /if \(activeView === "finance"\) loadIgvaFinanceOverview\(\)/);
});

test('economy navigation links use SPA routing and browser history rerenders views', () => {
  const navigationBody = getFunctionBody(authJs, 'wireCaseNavigation');
  const navigateBody = getFunctionBody(authJs, 'navigateToView');
  assert.match(appHtml, /href="\/oekonomi" data-view-link="finance"/);
  assert.match(appHtml, /class="moduleCard" href="\/oekonomi" data-view-link="finance"/);
  assert.match(navigationBody, /view === "finance"/);
  assert.match(navigationBody, /event\.preventDefault\(\)/);
  assert.match(navigationBody, /navigateToView\(view\)/);
  assert.match(navigateBody, /window\.history\.pushState/);
  assert.match(navigateBody, /setActiveAppView\(view\)/);
  assert.match(authJs, /window\.addEventListener\("popstate", \(\) => \{\s*setActiveAppView\(getCurrentAppViewFromHash\(\)\);\s*\}\);/);
  assert.match(authJs, /navigateToView\(getCurrentAppViewFromHash\(\), \{ replace: true \}\)/);
});

test('completed IGVA overview grouping uses observed close date only and no guessed updated date', () => {
  const start = indexOfOrThrow(authJs, 'function getIgvaFinanceClosedDate');
  const end = indexOfOrThrow(authJs.slice(start), 'function getIgvaProjectUrl') + start;
  const closedDateFunction = authJs.slice(start, end);
  assert.match(closedDateFunction, /closed_observed_at/);
  assert.doesNotMatch(closedDateFunction, /updated_at|source_updated_at/);
  assert.match(authJs, /function groupCompletedIgvaProjects/);
  assert.match(authJs, /closedDate\.getFullYear\(\)/);
  assert.match(authJs, /bDate\.getTime\(\) - aDate\.getTime\(\)/);
});

test('IGVA overview does not bulk fetch project economy details', () => {
  const start = indexOfOrThrow(authJs, 'async function loadIgvaFinanceOverview');
  const end = indexOfOrThrow(authJs.slice(start), '\n    function renderDashboard') + start;
  const body = authJs.slice(start, end);
  assert.match(body, /apiFetch\("\/api\/igva-poc\/projects", \{ method: "GET" \}\)/);
  assert.doesNotMatch(body, /project_ref|economy=detail|\/api\/projects\/[^"]+\/igva/);
  assert.match(routeSource, /includeEconomy: Boolean\(projectRef\)/);
});

test('standalone POC shell is deprecated and hidden from normal navigation', () => {
  assert.match(routeSource, /Deprecated POC shell/);
  assert.match(routeSource, /router\.get\("\/igva-poc"/);
  assert.doesNotMatch(appHtml, /href="\/igva-poc"/);
  assert.doesNotMatch(projectHtml, /href="\/igva-poc"/);
});
