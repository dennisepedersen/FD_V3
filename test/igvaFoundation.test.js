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
        { key: 'labor', expected_progress_raw: 0.695 },
        { key: 'materials', expected_progress_raw: 0.646 },
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
