'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://example.invalid/fielddesk_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'fielddesk.test';

const auditService = require('../backend/src/services/auditService');
const moduleAccessService = require('../backend/src/services/moduleAccessService');
const pool = require('../backend/src/db/pool');
const projectQueries = require('../backend/src/db/queries/project');
const projectAccessService = require('../backend/src/services/projectAccessService');
const tenantAdminRepository = require('../backend/src/modules/tenantAdmin/tenantAdmin.repository');
const tenantAdminService = require('../backend/src/modules/tenantAdmin/tenantAdmin.service');

function uuid(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function installPool() {
  const originalConnect = pool.connect;
  const queries = [];
  pool.connect = async () => ({
    async query(sql, params = []) {
      const text = String(sql);
      queries.push({ sql: text, params });
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(text)) return { rows: [] };
      return { rows: [] };
    },
    release() {},
  });
  return {
    queries,
    restore() {
      pool.connect = originalConnect;
    },
  };
}

function createAuth(role, tenantId, userId) {
  return { tenant_id: tenantId, sub: userId, role };
}

test('tenant_admin can create a project assignment and audit is written', async () => {
  const tenantId = uuid(1);
  const actorId = uuid(2);
  const projectId = uuid(3);
  const userId = uuid(4);
  const assignmentId = uuid(5);
  const poolMock = installPool();
  const audits = [];
  const original = {
    audit: auditService.logAuditEvent,
    findProject: tenantAdminRepository.findProject,
    findAssignableTenantUser: tenantAdminRepository.findAssignableTenantUser,
    upsert: tenantAdminRepository.upsertProjectAssignment,
  };

  auditService.logAuditEvent = async (event) => audits.push(event);
  tenantAdminRepository.findProject = async (_client, input) => {
    assert.deepEqual(input, { tenantId, projectId });
    return { project_id: projectId, tenant_id: tenantId, external_project_ref: 'REF-TEST' };
  };
  tenantAdminRepository.findAssignableTenantUser = async (_client, input) => {
    assert.deepEqual(input, { tenantId, userId });
    return { id: userId, tenant_id: tenantId, status: 'active', login_status: 'active' };
  };
  tenantAdminRepository.upsertProjectAssignment = async (_client, input) => {
    assert.deepEqual(input, { tenantId, projectId, userId, assignmentRole: 'contributor' });
    return { id: assignmentId, tenant_id: tenantId, project_id: projectId, tenant_user_id: userId, assignment_role: 'contributor', inserted: true };
  };

  try {
    const result = await tenantAdminService.assignProjectUser({ tenantId, actorId, projectId, userId });
    assert.equal(result.assignment.id, assignmentId);
    assert.equal(poolMock.queries.some((query) => /^\s*BEGIN\s*$/i.test(query.sql)), true);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].eventType, 'tenant_user_updated');
    assert.equal(audits[0].resourceType, 'project_assignment');
    assert.equal(audits[0].metadata.action, 'project_assignment_created');
  } finally {
    auditService.logAuditEvent = original.audit;
    tenantAdminRepository.findProject = original.findProject;
    tenantAdminRepository.findAssignableTenantUser = original.findAssignableTenantUser;
    tenantAdminRepository.upsertProjectAssignment = original.upsert;
    poolMock.restore();
  }
});

test('duplicate assignment is handled idempotently as an update', async () => {
  const tenantId = uuid(11);
  const actorId = uuid(12);
  const projectId = uuid(13);
  const userId = uuid(14);
  const assignmentId = uuid(15);
  const poolMock = installPool();
  const audits = [];
  const original = {
    audit: auditService.logAuditEvent,
    findProject: tenantAdminRepository.findProject,
    findAssignableTenantUser: tenantAdminRepository.findAssignableTenantUser,
    upsert: tenantAdminRepository.upsertProjectAssignment,
  };

  auditService.logAuditEvent = async (event) => audits.push(event);
  tenantAdminRepository.findProject = async () => ({ project_id: projectId, tenant_id: tenantId });
  tenantAdminRepository.findAssignableTenantUser = async () => ({ id: userId, tenant_id: tenantId, status: 'invited' });
  tenantAdminRepository.upsertProjectAssignment = async () => ({
    id: assignmentId,
    tenant_id: tenantId,
    project_id: projectId,
    tenant_user_id: userId,
    assignment_role: 'reviewer',
    inserted: false,
  });

  try {
    const result = await tenantAdminService.assignProjectUser({ tenantId, actorId, projectId, userId, assignmentRole: 'reviewer' });
    assert.equal(result.assignment.inserted, false);
    assert.equal(audits[0].metadata.action, 'project_assignment_updated');
  } finally {
    auditService.logAuditEvent = original.audit;
    tenantAdminRepository.findProject = original.findProject;
    tenantAdminRepository.findAssignableTenantUser = original.findAssignableTenantUser;
    tenantAdminRepository.upsertProjectAssignment = original.upsert;
    poolMock.restore();
  }
});

test('cross-tenant or unknown project and user are rejected', async () => {
  const tenantId = uuid(21);
  const actorId = uuid(22);
  const projectId = uuid(23);
  const userId = uuid(24);
  const poolMock = installPool();
  const original = {
    findProject: tenantAdminRepository.findProject,
    findAssignableTenantUser: tenantAdminRepository.findAssignableTenantUser,
  };

  tenantAdminRepository.findProject = async () => null;
  tenantAdminRepository.findAssignableTenantUser = async () => { throw new Error('should_not_lookup_user'); };

  try {
    await assert.rejects(
      tenantAdminService.assignProjectUser({ tenantId, actorId, projectId, userId }),
      (error) => error.statusCode === 404 && error.message === 'project_not_found'
    );
    tenantAdminRepository.findProject = async () => ({ project_id: projectId, tenant_id: tenantId });
    tenantAdminRepository.findAssignableTenantUser = async () => null;
    await assert.rejects(
      tenantAdminService.assignProjectUser({ tenantId, actorId, projectId, userId }),
      (error) => error.statusCode === 404 && error.message === 'tenant_user_not_found_or_not_assignable'
    );
  } finally {
    tenantAdminRepository.findProject = original.findProject;
    tenantAdminRepository.findAssignableTenantUser = original.findAssignableTenantUser;
    poolMock.restore();
  }
});

test('remove project assignment deletes direct access and writes audit', async () => {
  const tenantId = uuid(31);
  const actorId = uuid(32);
  const projectId = uuid(33);
  const userId = uuid(34);
  const assignmentId = uuid(35);
  const poolMock = installPool();
  const audits = [];
  const original = {
    audit: auditService.logAuditEvent,
    findProject: tenantAdminRepository.findProject,
    deleteAssignment: tenantAdminRepository.deleteProjectAssignment,
  };

  auditService.logAuditEvent = async (event) => audits.push(event);
  tenantAdminRepository.findProject = async () => ({ project_id: projectId, tenant_id: tenantId });
  tenantAdminRepository.deleteProjectAssignment = async (_client, input) => {
    assert.deepEqual(input, { tenantId, projectId, userId });
    return { id: assignmentId, tenant_id: tenantId, project_id: projectId, tenant_user_id: userId, assignment_role: 'contributor' };
  };

  try {
    const result = await tenantAdminService.removeProjectUserAssignment({ tenantId, actorId, projectId, userId });
    assert.equal(result.assignment.id, assignmentId);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].metadata.action, 'project_assignment_removed');
  } finally {
    auditService.logAuditEvent = original.audit;
    tenantAdminRepository.findProject = original.findProject;
    tenantAdminRepository.deleteProjectAssignment = original.deleteAssignment;
    poolMock.restore();
  }
});

test('tenant_admin module permissions deny project_leader and technician assignment writes', () => {
  const tenantId = uuid(41);
  const actorId = uuid(42);
  const tenant = { id: tenantId };

  assert.doesNotThrow(() => moduleAccessService.requireModuleAccess({
    tenant,
    auth: createAuth('tenant_admin', tenantId, actorId),
    moduleKey: 'tenant_admin',
    action: 'update',
  }));
  for (const role of ['project_leader', 'technician']) {
    assert.throws(
      () => moduleAccessService.requireModuleAccess({ tenant, auth: createAuth(role, tenantId, actorId), moduleKey: 'tenant_admin', action: 'update' }),
      (error) => error.statusCode === 403
    );
  }
});

test('routes protect assignment mutations with tenant_admin update access', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '../backend/src/modules/tenantAdmin/tenantAdmin.routes.js'), 'utf8');
  assert.match(routeSource, /router\.post\("\/api\/tenant\/admin\/projects\/:projectId\/assignments"[\s\S]+?requireTenantAdmin\(req, "update"\)/);
  assert.match(routeSource, /router\.delete\("\/api\/tenant\/admin\/projects\/:projectId\/assignments\/:userId"[\s\S]+?requireTenantAdmin\(req, "update"\)/);
});

test('project access service accepts and loses assignment-backed access through project query result', async () => {
  const tenantId = uuid(51);
  const userId = uuid(52);
  const projectId = uuid(53);
  const original = projectQueries.findProjectForUser;
  let hasAssignment = true;
  projectQueries.findProjectForUser = async (_client, input) => {
    assert.deepEqual(input, { tenantId, userId, projectId });
    return hasAssignment ? { project_id: projectId } : null;
  };

  try {
    const client = {};
    const allowed = await projectAccessService.requireProjectAccess({ client, tenantId, userId, projectId });
    assert.equal(allowed.project.project_id, projectId);
    hasAssignment = false;
    await assert.rejects(
      projectAccessService.requireProjectAccess({ client, tenantId, userId, projectId }),
      (error) => error.statusCode === 404 && error.message === 'project_not_found'
    );
  } finally {
    projectQueries.findProjectForUser = original;
  }
});

test('project owner, responsible and team leader access conditions remain alongside project_assignment', () => {
  const source = fs.readFileSync(path.join(__dirname, '../backend/src/db/queries/project.js'), 'utf8');
  assert.match(source, /pc\.owner_user_id = \$2/);
  assert.match(source, /pc\.responsible_code/);
  assert.match(source, /pc\.team_leader_code/);
  assert.match(source, /pa\.tenant_user_id = \$2/);
});

test('repository uses existing project_assignment table without migrations', () => {
  const source = fs.readFileSync(path.join(__dirname, '../backend/src/modules/tenantAdmin/tenantAdmin.repository.js'), 'utf8');
  assert.match(source, /INSERT INTO project_assignment/);
  assert.match(source, /ON CONFLICT \(project_id, tenant_user_id\)/);
  assert.match(source, /DELETE FROM project_assignment/);
  assert.doesNotMatch(source, /ALTER TABLE|CREATE TABLE|CREATE INDEX/i);
});