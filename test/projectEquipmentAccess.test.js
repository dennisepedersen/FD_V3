'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://example.invalid/fielddesk_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'fielddesk.test';

const repoRoot = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const pool = require('../backend/src/db/pool');
const projectQueries = require('../backend/src/db/queries/project');
const projectEquipmentRepository = require('../backend/src/modules/projectEquipment/projectEquipment.repository');
const projectEquipmentService = require('../backend/src/modules/projectEquipment/projectEquipment.service');
const projectAccessService = require('../backend/src/services/projectAccessService');

function uuid(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function freshModuleAccess(enabledValue) {
  const modulePath = path.join(repoRoot, 'backend/src/services/moduleAccessService.js');
  const previous = process.env.PROJECT_EQUIPMENT_BETA_ENABLED;
  if (enabledValue === undefined) {
    delete process.env.PROJECT_EQUIPMENT_BETA_ENABLED;
  } else {
    process.env.PROJECT_EQUIPMENT_BETA_ENABLED = enabledValue;
  }
  delete require.cache[require.resolve(modulePath)];
  const service = require(modulePath);
  if (previous === undefined) {
    delete process.env.PROJECT_EQUIPMENT_BETA_ENABLED;
  } else {
    process.env.PROJECT_EQUIPMENT_BETA_ENABLED = previous;
  }
  return service;
}

function assertDenied(fn, message, statusCode = 403) {
  assert.throws(fn, (error) => {
    assert.equal(error.statusCode, statusCode);
    assert.equal(error.message, message);
    return true;
  });
}

function requireEquipmentAccess({ role, action, tenantId = uuid(1), authTenantId = uuid(1), userId = uuid(2) }) {
  const moduleAccessService = freshModuleAccess('true');
  return moduleAccessService.requireModuleAccess({
    tenant: { id: tenantId },
    auth: { tenant_id: authTenantId, sub: userId, role },
    moduleKey: 'project_equipment_beta',
    action,
  });
}

test('project equipment global kill switch denies access unless explicitly enabled', () => {
  for (const value of [undefined, '', 'false', '0', 'no', 'off', 'banana']) {
    const moduleAccessService = freshModuleAccess(value);
    assertDenied(() => moduleAccessService.requireModuleAccess({
      tenant: { id: uuid(1) },
      auth: { tenant_id: uuid(1), sub: uuid(2), role: 'tenant_admin' },
      moduleKey: 'project_equipment_beta',
      action: 'read',
    }), 'module_access_denied');
  }
});

test('project equipment RBAC keeps existing role permissions', () => {
  const actions = ['read', 'create', 'update', 'delete', 'export'];

  for (const role of ['tenant_admin', 'project_leader']) {
    for (const action of actions) {
      const access = requireEquipmentAccess({ role, action });
      assert.equal(access.permission, `project_equipment_beta:${action}`);
    }
  }

  for (const action of ['read', 'create', 'update', 'export']) {
    const access = requireEquipmentAccess({ role: 'technician', action });
    assert.equal(access.permission, `project_equipment_beta:${action}`);
  }

  assertDenied(() => requireEquipmentAccess({ role: 'technician', action: 'delete' }), 'module_access_denied');
});

test('project equipment module access rejects tenant context mismatch', () => {
  assertDenied(() => requireEquipmentAccess({
    role: 'tenant_admin',
    action: 'read',
    tenantId: uuid(1),
    authTenantId: uuid(99),
  }), 'module_access_denied');
});

test('project equipment service lists CCTV without tenant project or user allowlist env vars', async () => {
  const tenantId = uuid(10);
  const userId = uuid(11);
  const projectId = uuid(12);
  const project = { project_id: projectId, name: 'Accessible project', external_project_ref: 'TEST-ACCESS' };
  const original = {
    connect: pool.connect,
    findProjectForUser: projectQueries.findProjectForUser,
    getCctvSummary: projectEquipmentRepository.getCctvSummary,
    listCctvForProject: projectEquipmentRepository.listCctvForProject,
  };
  const previousEnv = {
    tenant: process.env.PROJECT_EQUIPMENT_BETA_TENANT_IDS,
    project: process.env.PROJECT_EQUIPMENT_BETA_PROJECT_IDS,
    user: process.env.PROJECT_EQUIPMENT_BETA_USER_IDS,
  };
  delete process.env.PROJECT_EQUIPMENT_BETA_TENANT_IDS;
  delete process.env.PROJECT_EQUIPMENT_BETA_PROJECT_IDS;
  delete process.env.PROJECT_EQUIPMENT_BETA_USER_IDS;

  const calls = [];
  pool.connect = async () => ({ release() {} });
  projectQueries.findProjectForUser = async (_client, params) => {
    calls.push({ name: 'findProjectForUser', params });
    assert.deepEqual(params, { tenantId, userId, projectId });
    return project;
  };
  projectEquipmentRepository.getCctvSummary = async (_client, params) => {
    calls.push({ name: 'getCctvSummary', params });
    assert.deepEqual(params, { tenantId, projectId });
    return { registered: 0, planned: 0, mounted: 0, checked: 0, deviation: 0 };
  };
  projectEquipmentRepository.listCctvForProject = async (_client, params) => {
    calls.push({ name: 'listCctvForProject', params });
    assert.deepEqual(params, { tenantId, projectId, query: null });
    return [];
  };

  try {
    const result = await projectEquipmentService.listCctvForProject({ tenantId, userId, projectId });
    assert.equal(result.project, project);
    assert.deepEqual(result.cameras, []);
    assert.deepEqual(calls.map((call) => call.name), [
      'findProjectForUser',
      'getCctvSummary',
      'listCctvForProject',
    ]);
  } finally {
    pool.connect = original.connect;
    projectQueries.findProjectForUser = original.findProjectForUser;
    projectEquipmentRepository.getCctvSummary = original.getCctvSummary;
    projectEquipmentRepository.listCctvForProject = original.listCctvForProject;
    if (previousEnv.tenant === undefined) delete process.env.PROJECT_EQUIPMENT_BETA_TENANT_IDS;
    else process.env.PROJECT_EQUIPMENT_BETA_TENANT_IDS = previousEnv.tenant;
    if (previousEnv.project === undefined) delete process.env.PROJECT_EQUIPMENT_BETA_PROJECT_IDS;
    else process.env.PROJECT_EQUIPMENT_BETA_PROJECT_IDS = previousEnv.project;
    if (previousEnv.user === undefined) delete process.env.PROJECT_EQUIPMENT_BETA_USER_IDS;
    else process.env.PROJECT_EQUIPMENT_BETA_USER_IDS = previousEnv.user;
  }
});

test('project equipment service denies CCTV when normal project access is missing', async () => {
  const tenantId = uuid(20);
  const userId = uuid(21);
  const projectId = uuid(22);
  const original = {
    connect: pool.connect,
    findProjectForUser: projectQueries.findProjectForUser,
    getCctvSummary: projectEquipmentRepository.getCctvSummary,
    listCctvForProject: projectEquipmentRepository.listCctvForProject,
  };
  let repositoryTouched = false;
  pool.connect = async () => ({ release() {} });
  projectQueries.findProjectForUser = async (_client, params) => {
    assert.deepEqual(params, { tenantId, userId, projectId });
    return null;
  };
  projectEquipmentRepository.getCctvSummary = async () => {
    repositoryTouched = true;
    return {};
  };
  projectEquipmentRepository.listCctvForProject = async () => {
    repositoryTouched = true;
    return [];
  };

  try {
    await assert.rejects(
      () => projectEquipmentService.listCctvForProject({ tenantId, userId, projectId }),
      (error) => {
        assert.equal(error.statusCode, 404);
        assert.equal(error.message, 'project_not_found');
        return true;
      }
    );
    assert.equal(repositoryTouched, false);
  } finally {
    pool.connect = original.connect;
    projectQueries.findProjectForUser = original.findProjectForUser;
    projectEquipmentRepository.getCctvSummary = original.getCctvSummary;
    projectEquipmentRepository.listCctvForProject = original.listCctvForProject;
  }
});

test('project access service preserves tenant scoped lookup contract', async () => {
  const tenantId = uuid(30);
  const userId = uuid(31);
  const projectId = uuid(32);
  const original = projectQueries.findProjectForUser;
  const project = { project_id: projectId, tenant_id: tenantId };
  projectQueries.findProjectForUser = async (_client, params) => {
    assert.deepEqual(params, { tenantId, userId, projectId });
    return project;
  };
  try {
    const result = await projectAccessService.requireProjectAccess({ client: {}, tenantId, userId, projectId });
    assert.equal(result.project, project);
    assert.equal(result.tenantId, tenantId);
    assert.equal(result.userId, userId);
    assert.equal(result.projectId, projectId);
  } finally {
    projectQueries.findProjectForUser = original;
  }
});

test('project equipment routes do not read legacy allowlist env vars', () => {
  const routes = read('backend/src/modules/projectEquipment/projectEquipment.routes.js');
  assert.doesNotMatch(routes, /PROJECT_EQUIPMENT_BETA_TENANT_IDS/);
  assert.doesNotMatch(routes, /PROJECT_EQUIPMENT_BETA_PROJECT_IDS/);
  assert.doesNotMatch(routes, /PROJECT_EQUIPMENT_BETA_USER_IDS/);
  assert.doesNotMatch(routes, /requireProjectEquipmentBetaScope/);
  assert.doesNotMatch(routes, /parseAllowList/);
  assert.match(routes, /requireProjectEquipmentAccess\(req, "read"\)/);
  assert.match(routes, /requireProjectEquipmentAccess\(req, "create"\)/);
  assert.match(routes, /requireProjectEquipmentAccess\(req, "update"\)/);
  assert.match(routes, /requireProjectEquipmentAccess\(req, "delete"\)/);
  assert.match(routes, /requireProjectEquipmentAccess\(req, "export"\)/);
});