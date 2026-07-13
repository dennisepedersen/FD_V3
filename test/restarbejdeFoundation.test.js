'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://example.invalid/fielddesk_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'fielddesk.test';

const repoRoot = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const auditService = require('../backend/src/services/auditService');
const moduleAccessService = require('../backend/src/services/moduleAccessService');
const pool = require('../backend/src/db/pool');
const projectQueries = require('../backend/src/db/queries/project');
const restarbejdeRepository = require('../backend/src/modules/restarbejde/restarbejde.repository');
const restarbejdeService = require('../backend/src/modules/restarbejde/restarbejde.service');

function uuid(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function auth(role, tenantId = uuid(1), userId = uuid(2)) {
  return { tenant_id: tenantId, sub: userId, role };
}

function requireAccess(role, action, tenantId = uuid(1)) {
  return moduleAccessService.requireModuleAccess({
    tenant: { id: tenantId },
    auth: auth(role, tenantId),
    moduleKey: 'project_restarbejde',
    action,
  });
}

function assertDenied(fn) {
  assert.throws(fn, (error) => error.statusCode === 403 && error.message === 'module_access_denied');
}

function assertBadRequest(fn, message) {
  assert.throws(fn, (error) => error.statusCode === 400 && error.message === message);
}

function installPool() {
  const originalConnect = pool.connect;
  const queries = [];
  pool.connect = async () => ({
    async query(sql, params = []) {
      queries.push({ sql: String(sql), params });
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(String(sql))) return { rows: [] };
      return { rows: [] };
    },
    release() {},
  });
  return {
    queries,
    restore() { pool.connect = originalConnect; },
  };
}

function item(overrides = {}) {
  return {
    id: uuid(50),
    tenant_id: uuid(1),
    project_id: uuid(3),
    kind: 'internal_defect',
    title: 'Mangel',
    description: null,
    trade_key: 'el',
    status: 'open',
    priority: 'normal',
    risk: null,
    location_text: null,
    assigned_tenant_user_id: null,
    responsible_text: null,
    deadline: null,
    percent_complete: 0,
    external_party: null,
    blocks_delivery: false,
    escalated: false,
    can_internal_team_act: null,
    comment: null,
    source: null,
    external_import_id: null,
    external_import_payload: {},
    created_at: '2026-07-14T00:00:00.000Z',
    updated_at: '2026-07-14T00:00:00.000Z',
    created_by_user_id: uuid(2),
    updated_by_user_id: uuid(2),
    closed_at: null,
    closed_by_user_id: null,
    archived_at: null,
    archived_by_user_id: null,
    ...overrides,
  };
}

function project(projectId = uuid(3)) {
  return { project_id: projectId, tenant_id: uuid(1), external_project_ref: '80548', name: 'Test project' };
}

test('project_restarbejde is permanent and has the expected role matrix', () => {
  const allActions = ['read', 'create', 'update', 'close', 'archive', 'restore', 'comment', 'manage_placements', 'manage_drawings', 'manage_photos', 'export', 'report'];
  for (const role of ['tenant_admin', 'project_leader']) {
    for (const action of allActions) {
      assert.equal(requireAccess(role, action).permission, `project_restarbejde:${action}`);
    }
  }
  for (const action of ['read', 'create', 'update', 'comment', 'manage_placements', 'manage_photos']) {
    assert.equal(requireAccess('technician', action).permission, `project_restarbejde:${action}`);
  }
  for (const action of ['close', 'archive', 'restore', 'manage_drawings', 'export', 'report']) {
    assertDenied(() => requireAccess('technician', action));
  }
});

test('restarbejde validation keeps internal_defect priority separate from obs risk', () => {
  const normalize = restarbejdeService._test.normalizePayload;
  assert.equal(normalize({ kind: 'internal_defect', title: 'A', trade_key: 'el' }, { actorUserId: uuid(2) }).priority, 'normal');
  assert.equal(normalize({ kind: 'internal_defect', title: 'A', trade_key: 'el' }, { actorUserId: uuid(2) }).percentComplete, 0);
  assert.throws(() => normalize({ kind: 'internal_defect', title: 'A', trade_key: 'el', risk: 'high' }, { actorUserId: uuid(2) }), /restarbejde_internal_defect_risk_not_allowed/);
  assert.throws(() => normalize({ kind: 'obs', title: 'O', trade_key: 'el' }, { actorUserId: uuid(2) }), /restarbejde_risk_required/);
  assert.throws(() => normalize({ kind: 'obs', title: 'O', trade_key: 'el', risk: 'high', priority: 'normal' }, { actorUserId: uuid(2) }), /restarbejde_obs_priority_not_allowed/);
  assert.throws(() => normalize({ kind: 'obs', title: 'O', trade_key: 'el', risk: 'high', percent_complete: 20 }, { actorUserId: uuid(2) }), /restarbejde_obs_percent_not_allowed/);
});

test('restarbejde validation enforces status and percent rules', () => {
  const normalize = restarbejdeService._test.normalizePayload;
  assert.throws(() => normalize({ kind: 'internal_defect', title: 'A', trade_key: 'el', status: 'resolved' }, { actorUserId: uuid(2) }), /invalid_restarbejde_status/);
  assert.throws(() => normalize({ kind: 'obs', title: 'O', trade_key: 'el', risk: 'high', status: 'closed' }, { actorUserId: uuid(2) }), /invalid_restarbejde_status/);
  assert.throws(() => normalize({ kind: 'internal_defect', title: 'A', trade_key: 'el', percent_complete: 101 }, { actorUserId: uuid(2) }), /invalid_restarbejde_percent_complete/);
  assert.throws(() => normalize({ kind: 'internal_defect', title: 'A', trade_key: 'el', status: 'closed' }, { actorUserId: uuid(2), canCloseInternalDefect: false }), /restarbejde_internal_defect_close_denied/);
  const closed = normalize({ kind: 'internal_defect', title: 'A', trade_key: 'el', status: 'closed', percent_complete: 25 }, { actorUserId: uuid(2), canCloseInternalDefect: true });
  assert.equal(closed.percentComplete, 100);
  assert.equal(closed.closedByUserId, uuid(2));
  const obsResolved = normalize({ kind: 'obs', title: 'O', trade_key: 'el', risk: 'medium', status: 'resolved' }, { actorUserId: uuid(2) });
  assert.equal(obsResolved.status, 'resolved');
  assert.equal(obsResolved.percentComplete, null);
});

test('restarbejde validation only accepts real JSON booleans', () => {
  const normalize = restarbejdeService._test.normalizePayload;
  const base = { kind: 'internal_defect', title: 'A', trade_key: 'el' };
  assert.equal(normalize({ ...base, blocks_delivery: true }, { actorUserId: uuid(2) }).blocksDelivery, true);
  assert.equal(normalize({ ...base, blocks_delivery: false }, { actorUserId: uuid(2) }).blocksDelivery, false);
  assert.equal(normalize({ ...base, escalated: true }, { actorUserId: uuid(2) }).escalated, true);
  assert.equal(normalize({ ...base, can_internal_team_act: true }, { actorUserId: uuid(2) }).canInternalTeamAct, true);
  assert.equal(normalize({ ...base, can_internal_team_act: null }, { actorUserId: uuid(2) }).canInternalTeamAct, null);

  const existing = item({ blocks_delivery: true, escalated: true, can_internal_team_act: false });
  const preserved = normalize({}, { existing, actorUserId: uuid(2) });
  assert.equal(preserved.blocksDelivery, true);
  assert.equal(preserved.escalated, true);
  assert.equal(preserved.canInternalTeamAct, false);

  for (const value of ['true', 'false', '0', '1', 'yes', 'no', 1, 0, [], {}]) {
    assertBadRequest(() => normalize({ ...base, blocks_delivery: value }, { actorUserId: uuid(2) }), 'invalid_restarbejde_blocks_delivery');
    assertBadRequest(() => normalize({ ...base, escalated: value }, { actorUserId: uuid(2) }), 'invalid_restarbejde_escalated');
    assertBadRequest(() => normalize({ ...base, can_internal_team_act: value }, { actorUserId: uuid(2) }), 'invalid_restarbejde_can_internal_team_act');
  }
});

test('restarbejde public CRUD rejects client-managed import metadata', () => {
  const normalize = restarbejdeService._test.normalizePayload;
  const base = { kind: 'internal_defect', title: 'A', trade_key: 'el' };
  const values = {
    source: 'prototype',
    external_import_id: 'row-1',
    external_import_payload: { raw: true },
  };

  for (const [field, value] of Object.entries(values)) {
    assertBadRequest(() => normalize({ ...base, [field]: value }, { actorUserId: uuid(2) }), 'restarbejde_import_metadata_server_managed');
    assertBadRequest(() => normalize({ [field]: value }, { existing: item(), actorUserId: uuid(2) }), 'restarbejde_import_metadata_server_managed');
  }

  const existing = item({ source: 'prototype', external_import_id: 'row-1', external_import_payload: { raw: true } });
  const updated = normalize({ title: 'A2' }, { existing, actorUserId: uuid(2) });
  assert.equal(updated.source, 'prototype');
  assert.equal(updated.externalImportId, 'row-1');
  assert.deepEqual(updated.externalImportPayload, { raw: true });
});

test('restarbejde deadline must be a real ISO calendar date', () => {
  const normalize = restarbejdeService._test.normalizePayload;
  const base = { kind: 'internal_defect', title: 'A', trade_key: 'el' };
  assert.equal(normalize({ ...base, deadline: '2026-07-14' }, { actorUserId: uuid(2) }).deadline, '2026-07-14');
  assert.equal(normalize({ ...base, deadline: '2028-02-29' }, { actorUserId: uuid(2) }).deadline, '2028-02-29');

  for (const deadline of ['2026-02-31', '2026-13-01', '2026-00-10', '26-07-14', '2026-07-14T00:00:00Z']) {
    assertBadRequest(() => normalize({ ...base, deadline }, { actorUserId: uuid(2) }), 'invalid_restarbejde_deadline');
  }
});

test('restarbejde list filters validate before database access', async () => {
  const normalizeFilters = restarbejdeService._test.normalizeListFilters;
  assert.deepEqual(normalizeFilters({ kind: 'internal_defect', status: 'open' }), { kind: 'internal_defect', status: 'open' });
  assert.deepEqual(normalizeFilters({ status: 'resolved' }), { kind: null, status: 'resolved' });
  assertBadRequest(() => normalizeFilters({ kind: 'punch' }), 'invalid_restarbejde_kind_filter');
  assertBadRequest(() => normalizeFilters({ kind: 'obs', status: 'closed' }), 'invalid_restarbejde_status_filter');
  assertBadRequest(() => normalizeFilters({ status: 'done' }), 'invalid_restarbejde_status_filter');

  const originalConnect = pool.connect;
  let poolTouched = false;
  pool.connect = async () => {
    poolTouched = true;
    throw new Error('pool_should_not_be_touched');
  };
  try {
    await assert.rejects(
      restarbejdeService.listItems({ tenantId: uuid(1), userId: uuid(2), projectId: uuid(3), kind: 'punch' }),
      (error) => error.statusCode === 400 && error.message === 'invalid_restarbejde_kind_filter'
    );
    assert.equal(poolTouched, false);
  } finally {
    pool.connect = originalConnect;
  }
});
test('service requires normal project access before listing repository data', async () => {
  const tenantId = uuid(1);
  const userId = uuid(2);
  const projectId = uuid(3);
  const poolMock = installPool();
  const original = {
    findProject: projectQueries.findProjectForUser,
    listItems: restarbejdeRepository.listItems,
  };
  let repositoryTouched = false;
  projectQueries.findProjectForUser = async (_client, params) => {
    assert.deepEqual(params, { tenantId, userId, projectId });
    return null;
  };
  restarbejdeRepository.listItems = async () => {
    repositoryTouched = true;
    return [];
  };
  try {
    await assert.rejects(
      restarbejdeService.listItems({ tenantId, userId, projectId }),
      (error) => error.statusCode === 404 && error.message === 'project_not_found'
    );
    assert.equal(repositoryTouched, false);
  } finally {
    projectQueries.findProjectForUser = original.findProject;
    restarbejdeRepository.listItems = original.listItems;
    poolMock.restore();
  }
});

test('service creates an item with tenant/project scope and audit', async () => {
  const tenantId = uuid(1);
  const userId = uuid(2);
  const projectId = uuid(3);
  const poolMock = installPool();
  const audits = [];
  const original = {
    findProject: projectQueries.findProjectForUser,
    insertItem: restarbejdeRepository.insertItem,
    audit: auditService.logAuditEvent,
  };
  projectQueries.findProjectForUser = async () => project(projectId);
  restarbejdeRepository.insertItem = async (_client, input) => {
    assert.equal(input.tenantId, tenantId);
    assert.equal(input.projectId, projectId);
    assert.equal(input.actorUserId, userId);
    assert.equal(input.payload.kind, 'obs');
    assert.equal(input.payload.risk, 'critical');
    return item({ id: uuid(60), kind: 'obs', status: 'blocking', priority: null, risk: 'critical', percent_complete: null });
  };
  auditService.logAuditEvent = async (event) => audits.push(event);
  try {
    const result = await restarbejdeService.createItem({
      tenantId,
      userId,
      projectId,
      input: { kind: 'obs', title: 'Afventer kunde', trade_key: 'el', risk: 'critical', status: 'blocking' },
    });
    assert.equal(result.item.kind, 'obs');
    assert.equal(audits.length, 1);
    assert.equal(audits[0].eventType, 'restarbejde.item_created');
    assert.equal(audits[0].moduleKey, 'project_restarbejde');
    assert.equal(audits[0].projectId, projectId);
    assert.equal(poolMock.queries.some((query) => /^\s*BEGIN\s*$/i.test(query.sql)), true);
  } finally {
    projectQueries.findProjectForUser = original.findProject;
    restarbejdeRepository.insertItem = original.insertItem;
    auditService.logAuditEvent = original.audit;
    poolMock.restore();
  }
});

test('technician can resolve OBS through update but cannot close internal defects', async () => {
  const tenantId = uuid(1);
  const userId = uuid(2);
  const projectId = uuid(3);
  const itemId = uuid(50);
  const poolMock = installPool();
  const original = {
    findProject: projectQueries.findProjectForUser,
    findItem: restarbejdeRepository.findItemById,
    updateItem: restarbejdeRepository.updateItem,
    audit: auditService.logAuditEvent,
  };
  projectQueries.findProjectForUser = async () => project(projectId);
  auditService.logAuditEvent = async () => {};
  restarbejdeRepository.findItemById = async () => item({ id: itemId, kind: 'obs', status: 'blocking', priority: null, risk: 'high', percent_complete: null });
  restarbejdeRepository.updateItem = async (_client, input) => item({ id: itemId, kind: 'obs', status: input.payload.status, priority: null, risk: 'high', percent_complete: null });
  try {
    const obs = await restarbejdeService.updateItem({ tenantId, userId, projectId, itemId, input: { status: 'resolved' }, canCloseInternalDefect: false });
    assert.equal(obs.item.status, 'resolved');

    restarbejdeRepository.findItemById = async () => item({ id: itemId, kind: 'internal_defect', status: 'ready_for_review', priority: 'normal', percent_complete: 80 });
    await assert.rejects(
      restarbejdeService.updateItem({ tenantId, userId, projectId, itemId, input: { status: 'closed' }, canCloseInternalDefect: false }),
      (error) => error.statusCode === 403 && error.message === 'restarbejde_internal_defect_close_denied'
    );
  } finally {
    projectQueries.findProjectForUser = original.findProject;
    restarbejdeRepository.findItemById = original.findItem;
    restarbejdeRepository.updateItem = original.updateItem;
    auditService.logAuditEvent = original.audit;
    poolMock.restore();
  }
});

test('archive and restore are soft state changes with audit', async () => {
  const tenantId = uuid(1);
  const userId = uuid(2);
  const projectId = uuid(3);
  const itemId = uuid(50);
  const poolMock = installPool();
  const audits = [];
  const original = {
    findProject: projectQueries.findProjectForUser,
    archiveItem: restarbejdeRepository.archiveItem,
    restoreItem: restarbejdeRepository.restoreItem,
    audit: auditService.logAuditEvent,
  };
  projectQueries.findProjectForUser = async () => project(projectId);
  restarbejdeRepository.archiveItem = async (_client, input) => item({ id: input.itemId, archived_at: '2026-07-14T12:00:00.000Z', archived_by_user_id: input.actorUserId });
  restarbejdeRepository.restoreItem = async (_client, input) => item({ id: input.itemId });
  auditService.logAuditEvent = async (event) => audits.push(event);
  try {
    const archived = await restarbejdeService.archiveItem({ tenantId, userId, projectId, itemId });
    assert.equal(archived.item.archived_by_user_id, userId);
    const restored = await restarbejdeService.restoreItem({ tenantId, userId, projectId, itemId });
    assert.equal(restored.item.archived_at, null);
    assert.deepEqual(audits.map((event) => event.eventType), ['restarbejde.item_archived', 'restarbejde.item_restored']);
  } finally {
    projectQueries.findProjectForUser = original.findProject;
    restarbejdeRepository.archiveItem = original.archiveItem;
    restarbejdeRepository.restoreItem = original.restoreItem;
    auditService.logAuditEvent = original.audit;
    poolMock.restore();
  }
});

test('summary progress averages only active internal defects and returns null when none exist', () => {
  assert.deepEqual(restarbejdeService._test.mapSummary({
    internal_defect_count: '2',
    internal_defect_closed_count: '1',
    internal_defect_progress: '75.4',
    obs_count: '9',
    archived_count: '3',
  }), {
    internal_defect_count: 2,
    internal_defect_closed_count: 1,
    progress_percent: 75,
    progress_contract: 'null_when_no_active_internal_defects',
    obs_count: 9,
    archived_count: 3,
  });
  assert.equal(restarbejdeService._test.mapSummary({ internal_defect_count: '0', obs_count: '4' }).progress_percent, null);
});

test('repository queries scope items by tenant and project', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: [] };
    },
  };
  await restarbejdeRepository.findItemById(client, { tenantId: uuid(1), projectId: uuid(2), itemId: uuid(3) });
  await restarbejdeRepository.listItems(client, { tenantId: uuid(1), projectId: uuid(2) });
  assert.match(calls[0].sql, /WHERE tenant_id = \$1\s+AND project_id = \$2\s+AND id = \$3/);
  assert.deepEqual(calls[0].params, [uuid(1), uuid(2), uuid(3)]);
  assert.match(calls[1].sql, /tenant_id = \$1 AND project_id = \$2 AND archived_at IS NULL/);
});

test('routes expose PR1 endpoints with module permissions only', () => {
  const routes = read('backend/src/modules/restarbejde/restarbejde.routes.js');
  assert.match(routes, /moduleKey: MODULE_KEY/);
  assert.match(routes, /requireRestarbejdeAccess\(req, "read"\)/);
  assert.match(routes, /requireRestarbejdeAccess\(req, "create"\)/);
  assert.match(routes, /requireRestarbejdeAccess\(req, "update"\)/);
  assert.match(routes, /requireRestarbejdeAccess\(req, "archive"\)/);
  assert.match(routes, /requireRestarbejdeAccess\(req, "restore"\)/);
  assert.doesNotMatch(routes, /drawing/i);
  assert.doesNotMatch(routes, /photo/i);
  assert.doesNotMatch(routes, /export\.csv/);
});

test('migration defines foundation constraints without drawing tables', () => {
  const migration = read('migrations/0038_project_restarbejde_foundation.sql');
  assert.match(migration, /CREATE TABLE project_restarbejde_item/);
  assert.match(migration, /ck_project_restarbejde_item_priority_risk/);
  assert.match(migration, /ck_project_restarbejde_item_percent/);
  assert.match(migration, /ck_project_restarbejde_item_closed_state/);
  assert.match(migration, /ck_project_restarbejde_item_import_source_required/);
  assert.match(migration, /WHERE source IS NOT NULL AND external_import_id IS NOT NULL/);
  assert.match(migration, /FOREIGN KEY \(project_id, tenant_id\) REFERENCES project_core/);
  assert.match(migration, /ON DELETE SET NULL \(assigned_tenant_user_id\)/);
  assert.match(migration, /ON DELETE SET NULL \(closed_by_user_id\)/);
  assert.match(migration, /ON DELETE SET NULL \(archived_by_user_id\)/);
  assert.doesNotMatch(migration, /project_restarbejde_drawing/);
  assert.doesNotMatch(migration, /project_restarbejde_pin/);
});
