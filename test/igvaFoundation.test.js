'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('migrations/0048_igva_foundation_summary.sql', 'utf8');
const schema = fs.readFileSync('schema.sql', 'utf8');
const queries = fs.readFileSync('backend/src/db/queries/igvaPoc.js', 'utf8');
const projectQueries = fs.readFileSync('backend/src/db/queries/project.js', 'utf8');
const routes = fs.readFileSync('backend/src/routes/tenantSurfaceRoutes.js', 'utf8');
const syncWorker = fs.readFileSync('backend/src/services/syncWorker.js', 'utf8');
const docs = fs.readFileSync('backend/docs/architecture/igva_next_generation.md', 'utf8');
const purchaseLineDocs = fs.readFileSync('backend/docs/mappings/fd_purchase_line_model.md', 'utf8');
const igvaPocService = require('../backend/src/services/igvaPocService');

function getFunctionSource(source, name) {
  const marker = 'function ' + name;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, 'Expected function ' + name);
  const nextFunction = source.slice(start + marker.length).search(/\n(?:async )?function /);
  return nextFunction === -1 ? source.slice(start) : source.slice(start, start + marker.length + nextFunction);
}

test('IGVA foundation migration is additive and tenant scoped', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS igva_project_manager_completion/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS igva_project_manager_completion_event/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS igva_project_summary/);
  assert.match(migration, /PRIMARY KEY \(tenant_id, project_id\)/);
  assert.match(migration, /FOREIGN KEY \(project_id, tenant_id\) REFERENCES project_core\(project_id, tenant_id\)/);
  assert.match(migration, /FOREIGN KEY \(changed_by, tenant_id\) REFERENCES tenant_user\(id, tenant_id\)/);
  assert.match(migration, /prevent_update_delete_append_only\(\)/);
  assert.match(migration, /igva\.manager_completion_changed/);
  assert.match(migration, /igva\.summary_refreshed/);
  assert.match(migration, /igva\.summary_refresh_failed/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/i);
});

test('schema mirrors IGVA foundation tables and audit event types', () => {
  assert.match(schema, /CREATE TABLE igva_project_manager_completion/);
  assert.match(schema, /CREATE TABLE igva_project_manager_completion_event/);
  assert.match(schema, /CREATE TABLE igva_project_summary/);
  assert.match(schema, /igva\.manager_completion_changed/);
  assert.match(schema, /igva\.summary_refreshed/);
  assert.match(schema, /igva\.summary_refresh_failed/);
});

test('IGVA summary queries join by project and tenant', () => {
  assert.match(queries, /LEFT JOIN igva_project_manager_completion imc[\s\S]+?ON imc\.project_id = pc\.project_id[\s\S]+?AND imc\.tenant_id = pc\.tenant_id/);
  assert.match(queries, /LEFT JOIN igva_project_summary ips[\s\S]+?ON ips\.project_id = pc\.project_id[\s\S]+?AND ips\.tenant_id = pc\.tenant_id/);
  assert.match(queries, /WHERE pc\.tenant_id = \$1/);
  assert.match(queries, /INSERT INTO igva_project_summary/);
  assert.match(queries, /ON CONFLICT \(tenant_id, project_id\) DO UPDATE/);
  assert.match(queries, /\$3::boolean = true/);
  assert.match(queries, /summary_json = COALESCE\(summary_json, '\{\}'::jsonb\) - 'project_manager_completion' - 'project_manager_completion_percent'/);
});

test('normal project queries expose lightweight IGVA summary with tenant-scoped joins', () => {
  assert.match(projectQueries, /LEFT JOIN igva_project_summary ips[\s\S]+?ON ips\.project_id = pc\.project_id[\s\S]+?AND ips\.tenant_id = pc\.tenant_id/);
  assert.match(projectQueries, /ips\.expected_completion_percent AS igva_summary_expected_completion_percent/);
  assert.match(projectQueries, /ips\.manager_completion_percent AS igva_summary_manager_completion_percent/);
  assert.match(projectQueries, /ips\.source_synced_at AS igva_summary_source_synced_at/);
  assert.doesNotMatch(projectQueries, /ips\.summary_json AS/);
});

test('manager completion routes are authenticated, DEP gated and project scoped', () => {
  assert.match(routes, /router\.patch\("\/api\/projects\/:projectId\/igva\/manager-completion", requireTenantHost, requireAuth\("access"\), requireIgvaPocOnlineAccess/);
  assert.match(routes, /router\.get\("\/api\/projects\/:projectId\/igva\/manager-completion\/history", requireTenantHost, requireAuth\("access"\), requireIgvaPocOnlineAccess/);
  assert.match(routes, /hasAccessContextMismatch\(req\)/);
  assert.match(routes, /projectAccessService\.requireProjectAccess/);
  assert.match(routes, /tenantId: req\.context\.tenant\.id/);
  assert.match(routes, /userId: req\.auth\.sub/);
});

test('background sync has a lightweight IGVA summary endpoint at the end of existing flow', () => {
  assert.match(syncWorker, /const IGVA_SUMMARY_ENDPOINT_KEY = "igva_project_summary"/);
  assert.match(syncWorker, /igva_project_summary: \{/);
  assert.match(syncWorker, /materialized: true/);
  assert.match(syncWorker, /orderEndpointExecution/);
  assert.match(syncWorker, /ordered\.push\(IGVA_SUMMARY_ENDPOINT_KEY\)/);
  assert.match(syncWorker, /refreshIgvaProjectSummaries/);
  assert.match(syncWorker, /markEndpointState\(client, \{/);
  assert.match(syncWorker, /status: \"partial\"/);
});

test('summary payload keeps overview data compact and excludes heavy expected history rows', () => {
  const calculatedAt = new Date('2026-09-07T12:00:00.000Z');
  const project = {
    project_id: 'project-1',
    ek_project_id: 25906,
    external_project_ref: '80396-003',
    name: 'NNPR/KNSF',
    lifecycle: { status: 'open', is_closed: false },
    source_totals: {
      turnover_actual: 4383492,
      turnover_expected: 9300525,
      materials_actual: 1958069.67,
      labor_actual_total: 1303893,
    },
    data_quality: 'VERIFIED_WITH_PROBABLE_COMPONENT',
    data_sources: {
      expected_history: { status: 'VERIFIED', rows: [{ id: 1 }], events: [{ row_id: 1 }] },
      actual_materials: { status: 'VERIFIED_WITH_PROBABLE_COMPONENT', rows: 17 },
      actual_labor: { status: 'LEGACY_VERIFIED' },
      expected_values: { status: 'VERIFIED' },
    },
    calculation: {
      budget_completion: { percent: null },
      expected_completion: { percent: 66.5 },
      components: [
        { key: 'labor', expected_progress_raw: 0.695, expected_progress_capped: 0.695 },
        { key: 'materials', expected_progress_raw: 0.646, expected_progress_capped: 0.646 },
      ],
      totals: { actual_cost: 3261962.67, expected_cost: 4934568 },
    },
  };
  const row = {
    project_manager_completion_percent: 65,
    project_manager_completion_comment: 'OK',
    project_manager_completion_changed_at: '2026-09-07T09:00:00.000Z',
    project_manager_completion_changed_by: 'user-1',
    source_updated_at: '2026-09-07T08:00:00.000Z',
  };

  const summary = igvaPocService._test.buildIgvaSummaryPayload(project, row, calculatedAt);
  assert.equal(summary.expected_completion_percent, 66.5);
  assert.equal(summary.manager_completion_percent, 65);
  assert.equal(summary.material_completion_percent, 64.6);
  assert.equal(Object.hasOwn(summary.summary_json, 'project_manager_completion'), false);
  assert.equal(Object.hasOwn(summary.summary_json, 'project_manager_completion_percent'), false);
  assert.equal(summary.summary_json.data_sources.expected_history.status, 'VERIFIED');
  assert.equal(Object.hasOwn(summary.summary_json.data_sources.expected_history, 'rows'), false);
  assert.equal(Object.hasOwn(summary.summary_json.data_sources.expected_history, 'events'), false);
  assert.equal(summary.source_metadata.actual_materials_rows, 17);
});

test('summary payload caps component completion percent but preserves raw overrun', () => {
  const calculatedAt = new Date('2026-09-15T12:00:00.000Z');
  const project = {
    project_id: 'project-overrun',
    ek_project_id: 38364,
    external_project_ref: '38364',
    name: 'Material overrun regression',
    source_totals: {
      turnover_expected: 1000,
      materials_actual: 125,
      materials_expected_total: 100,
    },
    data_quality: 'PARTIAL',
    data_sources: {},
    calculation: {
      budget_completion: { percent: null },
      expected_completion: { percent: 100 },
      components: [
        { key: 'materials', expected_progress_raw: 1.25, expected_progress_capped: 1, actual_cost: 125, expected_cost: 100 },
      ],
      totals: { actual_cost: 125, expected_cost: 100 },
    },
  };

  const summary = igvaPocService._test.buildIgvaSummaryPayload(project, {}, calculatedAt);
  const material = summary.summary_json.calculation.components.find((item) => item.key === 'materials');

  assert.equal(summary.expected_completion_percent, 100);
  assert.equal(summary.material_completion_percent, 100);
  assert.equal(material.expected_progress_raw, 1.25);
  assert.equal(material.expected_progress_capped, 1);
  assert.equal(summary.cost_actual, 125);
  assert.equal(summary.cost_expected, 100);
});

test('manager completion validation bounds percent and comment size', () => {
  assert.equal(igvaPocService._test.normalizeCompletionPercent(66.5), 66.5);
  assert.throws(() => igvaPocService._test.normalizeCompletionPercent(-1), /invalid_igva_manager_completion_percent/);
  assert.throws(() => igvaPocService._test.normalizeCompletionPercent(101), /invalid_igva_manager_completion_percent/);
  assert.equal(igvaPocService._test.normalizeOptionalComment('  ok  '), 'ok');
  assert.throws(() => igvaPocService._test.normalizeOptionalComment('x'.repeat(1001)), /igva_manager_completion_comment_too_long/);
});

test('IGVA foundation documentation records design intent without future feature implementation', () => {
  assert.match(docs, /lightweight `igva_project_summary`/);
  assert.match(docs, /Project manager completion/);
  assert.match(docs, /summary_json/);
  assert.match(docs, /source_synced_at/);
  assert.match(docs, /ETC\/EAC/);
  assert.match(docs, /Selective Material Control/);
  assert.match(purchaseLineDocs, /Current Foundation Persistence/);
  assert.match(purchaseLineDocs, /does not persist full purchase-line source rows yet/);
});


test('IGVA summary bootstrap is tenant/project based with missing and stale summaries first', () => {
  assert.ok(queries.includes('async function listIgvaProjectsForSummaryRefresh(client, { tenantId, projectIds = null, limit = 10, freshnessMaxAgeHours = 24 } = {})'));
  assert.ok(queries.includes('WHERE pc.tenant_id = $1'));
  assert.ok(queries.includes('pm.ek_project_id IS NOT NULL'));
  assert.ok(queries.includes('ips.project_id IS NULL'));
  assert.ok(queries.includes("ips.economy_status = 'failed'"));
  assert.ok(queries.includes("ips.economy_status = 'partial' AND ips.last_error = 'ek_rate_limited_429'"));
  assert.ok(queries.includes('pm.source_updated_at IS NOT NULL AND pm.source_updated_at > COALESCE(ips.source_synced_at'));
  assert.ok(queries.includes('ips.source_synced_at < (now() - make_interval(secs => $4))'));
  assert.doesNotMatch(getFunctionSource(queries, 'listIgvaProjectsForSummaryRefresh'), /tenant_user|userId|responsible_code =/);
});

test('IGVA summary refresh is bounded, throttled and defers 429 without stopping queue', () => {
  const serviceSource = fs.readFileSync('backend/src/services/igvaPocService.js', 'utf8');
  assert.ok(serviceSource.includes('IGVA_SUMMARY_REFRESH_PROJECT_LIMIT) || 50'));
  assert.match(serviceSource, /IGVA_SUMMARY_REFRESH_CONCURRENCY/);
  assert.match(serviceSource, /IGVA_SUMMARY_REFRESH_THROTTLE_MS/);
  assert.match(serviceSource, /function findRateLimitedSource/);
  assert.match(serviceSource, /status: 'rate_limited'/);
  assert.match(serviceSource, /economyStatus: 'partial'/);
  assert.match(serviceSource, /finally \{\s*await delay\(SUMMARY_REFRESH_THROTTLE_MS\)/);
  assert.equal(igvaPocService._test.classifySummaryRefreshError(Object.assign(new Error('http 429'), { statusCode: 429 })).economyStatus, 'partial');
});

test('sync worker reports IGVA summary rate limits as deferred endpoint state', () => {
  assert.ok(syncWorker.includes('result.failed > 0 || result.deferred > 0'));
  assert.ok(syncWorker.includes('pendingBacklogCount: result.deferred || 0'));
  assert.ok(syncWorker.includes('lastHttpStatus: result.rate_limited ? 429 : null'));
  assert.match(syncWorker, /igva_summary_deferred_rate_limited/);
});

test('purchase invoice line client exposes updatedAfter for safe delta change detection', () => {
  const ekClientSource = fs.readFileSync('backend/src/services/igvaPocEkClient.js', 'utf8');
  assert.ok(ekClientSource.includes('readPurchaseInvoiceLinesByProject(fetchImpl, config, ekProjectId, options = {})'));
  assert.ok(ekClientSource.includes("params.set('updatedAfter', String(options.updatedAfter))"));
  assert.match(docs, /purchaseinvoicelines.*updatedAfter/);
  assert.match(docs, /full direct ProjectID line read for recalculation/);
});

test('IGVA detail read-through updates the persisted compact summary to avoid live-detail drift', () => {
  const serviceSource = fs.readFileSync('backend/src/services/igvaPocService.js', 'utf8');
  const listBody = getFunctionSource(serviceSource, 'listIgvaPocProjects');
  assert.ok(listBody.includes('buildIgvaSummaryPayload(project, row, calculatedAt)'));
  assert.match(listBody, /refresh_trigger: 'detail_read_through'/);
  assert.ok(listBody.includes('upsertIgvaProjectSummary(client, {'));
  assert.match(docs, /detail read-through[\s\S]+compact summary update/);
});
