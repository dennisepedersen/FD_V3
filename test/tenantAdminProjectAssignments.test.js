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
const employeeManagerRelationRepository = require('../backend/src/modules/absence/employeeManagerRelation.repository');

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

test('tenant admin can update existing user role and audit role change', async () => {
  const tenantId = uuid(101);
  const actorId = uuid(102);
  const userId = uuid(103);
  const poolMock = installPool();
  const audits = [];
  const original = {
    audit: auditService.logAuditEvent,
    lock: tenantAdminRepository.acquireTenantLifecycleLock,
    findTenantUser: tenantAdminRepository.findTenantUser,
    updateTenantUser: tenantAdminRepository.updateManualTenantUser,
    updateFitter: tenantAdminRepository.updateManualFitterForTenantUser,
  };

  auditService.logAuditEvent = async (event) => audits.push(event);
  tenantAdminRepository.acquireTenantLifecycleLock = async (_client, input) => assert.deepEqual(input, { tenantId });
  tenantAdminRepository.findTenantUser = async (_client, input) => {
    assert.deepEqual(input, { tenantId, userId });
    return { id: userId, tenant_id: tenantId, email: 'tbt@example.test', name: 'TBT', role: 'project_leader', status: 'active', login_status: 'active' };
  };
  tenantAdminRepository.updateManualTenantUser = async (_client, input) => {
    assert.equal(input.tenantId, tenantId);
    assert.equal(input.userId, userId);
    assert.equal(input.role, 'technician');
    return { id: userId, tenant_id: tenantId, email: 'tbt@example.test', name: 'TBT', role: input.role, status: 'active', login_status: 'active' };
  };
  tenantAdminRepository.updateManualFitterForTenantUser = async (_client, input) => {
    assert.equal(input.tenantId, tenantId);
    assert.equal(input.userId, userId);
    assert.equal(input.role, 'technician');
    return null;
  };

  try {
    const result = await tenantAdminService.updateManualUser({ tenantId, actorId, userId, role: 'technician' });
    assert.equal(result.user.role, 'technician');
    assert.equal(audits.length, 2);
    assert.equal(audits[0].eventType, 'role_changed');
    assert.equal(audits[0].resourceType, 'tenant_user');
    assert.deepEqual(audits[0].metadata, { target_user_id: userId, old_role: 'project_leader', new_role: 'technician' });
    assert.equal(audits[1].eventType, 'tenant_user_updated');
    assert.deepEqual(audits[1].metadata.fields, ['role']);
    assert.equal(poolMock.queries.some((query) => /^\s*BEGIN\s*$/i.test(query.sql)), true);
  } finally {
    auditService.logAuditEvent = original.audit;
    tenantAdminRepository.acquireTenantLifecycleLock = original.lock;
    tenantAdminRepository.findTenantUser = original.findTenantUser;
    tenantAdminRepository.updateManualTenantUser = original.updateTenantUser;
    tenantAdminRepository.updateManualFitterForTenantUser = original.updateFitter;
    poolMock.restore();
  }
});

test('role update blocks invalid roles and last active tenant admin downgrade', async () => {
  const tenantId = uuid(111);
  const actorId = uuid(112);
  const userId = uuid(113);

  await assert.rejects(
    tenantAdminService.updateManualUser({ tenantId, actorId, userId, role: 'owner' }),
    (error) => error.statusCode === 400 && error.message === 'invalid_role'
  );

  const poolMock = installPool();
  const original = {
    lock: tenantAdminRepository.acquireTenantLifecycleLock,
    findTenantUser: tenantAdminRepository.findTenantUser,
    countAdmins: tenantAdminRepository.countActiveTenantAdmins,
    updateTenantUser: tenantAdminRepository.updateManualTenantUser,
  };

  tenantAdminRepository.acquireTenantLifecycleLock = async () => {};
  tenantAdminRepository.findTenantUser = async () => ({ id: userId, tenant_id: tenantId, role: 'tenant_admin', status: 'active', login_status: 'active' });
  tenantAdminRepository.countActiveTenantAdmins = async () => 1;
  tenantAdminRepository.updateManualTenantUser = async () => { throw new Error('should_not_update_last_admin'); };

  try {
    await assert.rejects(
      tenantAdminService.updateManualUser({ tenantId, actorId, userId, role: 'technician' }),
      (error) => error.statusCode === 409 && error.message === 'last_active_tenant_admin'
    );
  } finally {
    tenantAdminRepository.acquireTenantLifecycleLock = original.lock;
    tenantAdminRepository.findTenantUser = original.findTenantUser;
    tenantAdminRepository.countActiveTenantAdmins = original.countAdmins;
    tenantAdminRepository.updateManualTenantUser = original.updateTenantUser;
    poolMock.restore();
  }
});

test('role update does not change primary manager relation', async () => {
  const tenantId = uuid(121);
  const actorId = uuid(122);
  const userId = uuid(123);
  const poolMock = installPool();
  const original = {
    audit: auditService.logAuditEvent,
    lock: tenantAdminRepository.acquireTenantLifecycleLock,
    findTenantUser: tenantAdminRepository.findTenantUser,
    updateTenantUser: tenantAdminRepository.updateManualTenantUser,
    updateFitter: tenantAdminRepository.updateManualFitterForTenantUser,
    findCurrent: employeeManagerRelationRepository.findCurrentPrimaryForEmployee,
    endPrimary: employeeManagerRelationRepository.endActivePrimaryRelationsForEmployee,
    insertRelation: employeeManagerRelationRepository.insertRelation,
  };

  auditService.logAuditEvent = async () => {};
  tenantAdminRepository.acquireTenantLifecycleLock = async () => {};
  tenantAdminRepository.findTenantUser = async () => ({ id: userId, tenant_id: tenantId, role: 'technician', status: 'active', login_status: 'active' });
  tenantAdminRepository.updateManualTenantUser = async () => ({ id: userId, tenant_id: tenantId, role: 'project_leader', status: 'active', login_status: 'active' });
  tenantAdminRepository.updateManualFitterForTenantUser = async () => null;
  employeeManagerRelationRepository.findCurrentPrimaryForEmployee = async () => { throw new Error('role_update_must_not_read_manager_relation'); };
  employeeManagerRelationRepository.endActivePrimaryRelationsForEmployee = async () => { throw new Error('role_update_must_not_end_manager_relation'); };
  employeeManagerRelationRepository.insertRelation = async () => { throw new Error('role_update_must_not_insert_manager_relation'); };

  try {
    const result = await tenantAdminService.updateManualUser({ tenantId, actorId, userId, role: 'project_leader' });
    assert.equal(result.user.role, 'project_leader');
  } finally {
    auditService.logAuditEvent = original.audit;
    tenantAdminRepository.acquireTenantLifecycleLock = original.lock;
    tenantAdminRepository.findTenantUser = original.findTenantUser;
    tenantAdminRepository.updateManualTenantUser = original.updateTenantUser;
    tenantAdminRepository.updateManualFitterForTenantUser = original.updateFitter;
    employeeManagerRelationRepository.findCurrentPrimaryForEmployee = original.findCurrent;
    employeeManagerRelationRepository.endActivePrimaryRelationsForEmployee = original.endPrimary;
    employeeManagerRelationRepository.insertRelation = original.insertRelation;
    poolMock.restore();
  }
});

test('tenant admin can set primary manager for technician employee without role coupling', async () => {
  const tenantId = uuid(131);
  const actorId = uuid(132);
  const employeeId = uuid(133);
  const managerId = uuid(134);
  const relationId = uuid(135);
  const poolMock = installPool();
  const audits = [];
  const original = {
    audit: auditService.logAuditEvent,
    findTenantUser: tenantAdminRepository.findTenantUser,
    findCurrent: employeeManagerRelationRepository.findCurrentPrimaryForEmployee,
    endPrimary: employeeManagerRelationRepository.endActivePrimaryRelationsForEmployee,
    insertRelation: employeeManagerRelationRepository.insertRelation,
  };

  auditService.logAuditEvent = async (event) => audits.push(event);
  tenantAdminRepository.findTenantUser = async (_client, input) => {
    assert.equal(input.tenantId, tenantId);
    if (input.userId === employeeId) return { id: employeeId, tenant_id: tenantId, role: 'technician', status: 'active', login_status: 'active', name: 'TBT' };
    if (input.userId === managerId) return { id: managerId, tenant_id: tenantId, role: 'technician', status: 'active', login_status: 'active', name: 'DEP' };
    return null;
  };
  employeeManagerRelationRepository.findCurrentPrimaryForEmployee = async (_client, input) => {
    assert.equal(input.tenantId, tenantId);
    assert.equal(input.employeeTenantUserId, employeeId);
    assert.match(input.asOfDate, /^\d{4}-\d{2}-\d{2}$/);
    return null;
  };
  employeeManagerRelationRepository.endActivePrimaryRelationsForEmployee = async (_client, input) => {
    assert.equal(input.tenantId, tenantId);
    assert.equal(input.employeeTenantUserId, employeeId);
    assert.equal(input.actorUserId, actorId);
    assert.match(input.validTo, /^\d{4}-\d{2}-\d{2}$/);
    return [];
  };
  employeeManagerRelationRepository.insertRelation = async (_client, input) => {
    assert.equal(input.tenantId, tenantId);
    assert.equal(input.employeeTenantUserId, employeeId);
    assert.equal(input.managerTenantUserId, managerId);
    assert.equal(input.relationType, 'primary');
    assert.equal(input.actorUserId, actorId);
    return { id: relationId, tenant_id: tenantId, employee_tenant_user_id: employeeId, manager_tenant_user_id: managerId, relation_type: 'primary', valid_from: input.validFrom, valid_to: null, is_active: true };
  };

  try {
    const result = await tenantAdminService.setPrimaryManager({ tenantId, actorId, employeeUserId: employeeId, managerUserId: managerId });
    assert.equal(result.employee.role, 'technician');
    assert.equal(result.manager.role, 'technician');
    assert.equal(result.relation.id, relationId);
    assert.equal(result.changed, true);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].moduleKey, 'employee_manager_relation');
    assert.equal(audits[0].eventType, 'employee_manager_relation.created');
    assert.deepEqual(audits[0].metadata, { employee_tenant_user_id: employeeId, manager_tenant_user_id: managerId, relation_type: 'primary' });
  } finally {
    auditService.logAuditEvent = original.audit;
    tenantAdminRepository.findTenantUser = original.findTenantUser;
    employeeManagerRelationRepository.findCurrentPrimaryForEmployee = original.findCurrent;
    employeeManagerRelationRepository.endActivePrimaryRelationsForEmployee = original.endPrimary;
    employeeManagerRelationRepository.insertRelation = original.insertRelation;
    poolMock.restore();
  }
});

test('primary manager rejects self-manager and cross-tenant manager lookup', async () => {
  const tenantId = uuid(141);
  const actorId = uuid(142);
  const employeeId = uuid(143);
  const managerId = uuid(144);

  await assert.rejects(
    tenantAdminService.setPrimaryManager({ tenantId, actorId, employeeUserId: employeeId, managerUserId: employeeId }),
    (error) => error.statusCode === 400 && error.message === 'employee_manager_relation_self_manager_not_allowed'
  );

  const poolMock = installPool();
  const original = { findTenantUser: tenantAdminRepository.findTenantUser };
  tenantAdminRepository.findTenantUser = async (_client, input) => {
    if (input.userId === employeeId) return { id: employeeId, tenant_id: tenantId, role: 'technician', status: 'active', login_status: 'active' };
    return null;
  };

  try {
    await assert.rejects(
      tenantAdminService.setPrimaryManager({ tenantId, actorId, employeeUserId: employeeId, managerUserId: managerId }),
      (error) => error.statusCode === 404 && error.message === 'manager_tenant_user_not_found'
    );
  } finally {
    tenantAdminRepository.findTenantUser = original.findTenantUser;
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
  assert.doesNotThrow(() => moduleAccessService.requireModuleAccess({
    tenant,
    auth: createAuth('tenant_admin', tenantId, actorId),
    moduleKey: 'employee_manager_relation',
    action: 'manage',
  }));
  for (const role of ['project_leader', 'technician']) {
    assert.throws(
      () => moduleAccessService.requireModuleAccess({ tenant, auth: createAuth(role, tenantId, actorId), moduleKey: 'tenant_admin', action: 'update' }),
      (error) => error.statusCode === 403
    );
    assert.throws(
      () => moduleAccessService.requireModuleAccess({ tenant, auth: createAuth(role, tenantId, actorId), moduleKey: 'employee_manager_relation', action: 'manage' }),
      (error) => error.statusCode === 403,
      'employee_manager_relation manage access must remain tenant-admin only by role'
    );
  }
});

test('routes protect assignment mutations with tenant_admin update access', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '../backend/src/modules/tenantAdmin/tenantAdmin.routes.js'), 'utf8');
  assert.match(routeSource, /router\.post\("\/api\/tenant\/admin\/projects\/:projectId\/assignments"[\s\S]+?requireTenantAdmin\(req, "update"\)/);
  assert.match(routeSource, /router\.delete\("\/api\/tenant\/admin\/projects\/:projectId\/assignments\/:userId"[\s\S]+?requireTenantAdmin\(req, "update"\)/);
});

test('routes protect user role and primary manager changes', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '../backend/src/modules/tenantAdmin/tenantAdmin.routes.js'), 'utf8');
  assert.match(routeSource, /router\.patch\("\/api\/tenant\/admin\/users\/:userId"[\s\S]+?requireTenantAdmin\(req, "update"\)/);
  assert.match(routeSource, /router\.patch\("\/api\/tenant\/admin\/users\/:userId\/primary-manager"[\s\S]+?requireTenantAdmin\(req, "update"\)[\s\S]+?requireEmployeeManagerRelationManage\(req\)/);
});
test('project list route forwards q to tenant admin service', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '../backend/src/modules/tenantAdmin/tenantAdmin.routes.js'), 'utf8');
  assert.match(routeSource, /router\.get\("\/api\/tenant\/admin\/projects"[\s\S]+?search: req\.query\?\.q/);
});

test('project repository searches project ref, name, responsible and team leader', async () => {
  const tenantId = uuid(61);
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return { rows: [] };
    },
  };

  await tenantAdminRepository.listProjects(client, { tenantId, search: '80548' });

  assert.equal(queries.length, 1);
  assert.equal(queries[0].params[0], tenantId);
  assert.equal(queries[0].params[1], '%80548%');
  assert.match(queries[0].sql, /external_project_ref/);
  assert.match(queries[0].sql, /pc\.name/);
  assert.match(queries[0].sql, /responsible_code/);
  assert.match(queries[0].sql, /team_leader_code/);
  assert.match(queries[0].sql, /LIMIT 250/);
});

test('tenant admin users UI exposes role and primary manager controls separately', () => {
  const source = fs.readFileSync(path.join(__dirname, '../backend/src/public/tenant/auth.js'), 'utf8');

  assert.match(source, /TENANT_ADMIN_ROLE_OPTIONS/);
  assert.match(source, /Tekniker/);
  assert.match(source, /Projektleder/);
  assert.match(source, /Tenant-administrator/);
  assert.match(source, /Rolle i Fielddesk/);
  assert.match(source, /Personaleleder/);
  assert.match(source, /roleUpdating: new Set\(\)/);
  assert.match(source, /managerUpdating: new Set\(\)/);
  assert.match(source, /updateTenantAdminUserRole/);
  assert.match(source, /apiFetch\(`\/api\/tenant\/admin\/users\/\$\{encodeURIComponent\(userId\)\}`/);
  assert.match(source, /updateTenantAdminUserPrimaryManager/);
  assert.match(source, /\/primary-manager`/);
  assert.match(source, /manager_tenant_user_id: normalizedManagerId/);
  assert.match(source, /candidate\.tenant_user_id\) === employeeUserId/);
  assert.match(source, /status === "active" && loginStatus === "active"/);
});
test('tenant admin project assignment UI has project search and no role selector', () => {
  const html = fs.readFileSync(path.join(__dirname, '../backend/src/public/tenant/app.html'), 'utf8');
  const section = html.slice(html.indexOf('tenantAdminProjectAssignmentsSection'), html.indexOf('resourceGroupToolbarSection'));

  assert.match(section, /tenantAdminProjectSearchInput/);
  assert.match(section, /S.g projekt/);
  assert.doesNotMatch(section, /tenantAdminAssignmentRoleSelect/);
  assert.doesNotMatch(section, />Owner</);
  assert.doesNotMatch(section, />Reviewer</);
});

test('tenant admin assignment UI searches projects with debounce and guarded request ordering', () => {
  const source = fs.readFileSync(path.join(__dirname, '../backend/src/public/tenant/auth.js'), 'utf8');

  assert.match(source, /tenantAdminProjectSearchInput\.addEventListener\("input"/);
  assert.match(source, /window\.clearTimeout\(state\.tenantAdmin\.projectSearchTimer\)/);
  assert.match(source, /window\.setTimeout\([\s\S]+loadTenantAdminProjects\(\{ force: true \}\)[\s\S]+180/);
  assert.match(source, /state\.tenantAdmin\.projectSearchRequestSeq/);
  assert.match(source, /apiFetch\(`\/api\/tenant\/admin\/projects\$\{query\}`/);
  assert.match(source, /previousProjectId && projects\.some/);
});

test('tenant admin assignment create payload is contributor without visible role levels', () => {
  const source = fs.readFileSync(path.join(__dirname, '../backend/src/public/tenant/auth.js'), 'utf8');
  const appHtml = fs.readFileSync(path.join(__dirname, '../backend/src/public/tenant/app.html'), 'utf8');
  const section = appHtml.slice(appHtml.indexOf('tenantAdminProjectAssignmentsSection'), appHtml.indexOf('resourceGroupToolbarSection'));

  assert.match(source, /assignment_role: "contributor"/);
  assert.doesNotMatch(source, /tenantAdminAssignmentRoleSelect/);
  assert.doesNotMatch(section, /Owner|Reviewer|Bidragsyder/);
  assert.match(source, /tag\.textContent = "Direkte adgang"/);
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

test('repository lists current primary manager tenant-scoped for tenant admin users', () => {
  const source = fs.readFileSync(path.join(__dirname, '../backend/src/modules/tenantAdmin/tenantAdmin.repository.js'), 'utf8');
  assert.match(source, /current_primary_manager AS/);
  assert.match(source, /FROM employee_manager_relation emr/);
  assert.match(source, /manager\.tenant_id = emr\.tenant_id/);
  assert.match(source, /cpm\.employee_tenant_user_id = tu\.id/);
  assert.match(source, /primary_manager_tenant_user_id/);
  assert.match(source, /primary_manager_login_status/);
});
test('repository writes manual project access through assignment sources', () => {
  const source = fs.readFileSync(path.join(__dirname, '../backend/src/modules/tenantAdmin/tenantAdmin.repository.js'), 'utf8');
  assert.match(source, /upsertAssignmentSource/);
  assert.match(source, /sourceType: "manual"/);
  assert.match(source, /DELETE FROM project_assignment_source/);
  assert.match(source, /deleteEffectiveAssignmentIfNoActiveSources/);
  assert.doesNotMatch(source, /ALTER TABLE|CREATE TABLE|CREATE INDEX/i);
});