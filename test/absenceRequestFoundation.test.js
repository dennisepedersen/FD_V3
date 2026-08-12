'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://example.invalid/fielddesk_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'fielddesk.test';

const moduleAccessService = require('../backend/src/services/moduleAccessService');
const auditService = require('../backend/src/services/auditService');
const absenceTypeRepository = require('../backend/src/modules/absence/absenceType.repository');
const absenceRequestRepository = require('../backend/src/modules/absence/absenceRequest.repository');
const absenceSpecialWindowRepository = require('../backend/src/modules/absence/absenceSpecialWindow.repository');
const employeeManagerRelationRepository = require('../backend/src/modules/absence/employeeManagerRelation.repository');
const {
  ABSENCE_AUDIT_EVENT_TYPES,
  ABSENCE_DURATION_TYPES,
  ABSENCE_REQUEST_EVENT_TYPES,
  ABSENCE_REQUEST_STATUSES,
} = require('../backend/src/modules/absence/absence.constants');

const repoRoot = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const migration = () => read('migrations/0041_absence_request_foundation.sql');

function uuid(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function auth(role, tenantId = uuid(1), userId = uuid(2), permissions = []) {
  return { tenant_id: tenantId, sub: userId, role, permissions };
}

function requireAccess(role, moduleKey, action, permissions = [], tenantId = uuid(1)) {
  return moduleAccessService.requireModuleAccess({
    tenant: { id: tenantId },
    auth: auth(role, tenantId, uuid(2), permissions),
    moduleKey,
    action,
  });
}

function assertDenied(fn) {
  assert.throws(fn, (error) => error.statusCode === 403 && error.message === 'module_access_denied');
}

function createClient(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      return { rows };
    },
  };
}

test('0041 migration is the next absence request foundation and keeps 0040 distinct', () => {
  const migrationFiles = fs.readdirSync(path.join(repoRoot, 'migrations')).filter((name) => name.endsWith('.sql')).sort();
  assert.equal(migrationFiles.includes('0040_worksheet_project_assignment_sources.sql'), true);
  assert.equal(migrationFiles.includes('0041_absence_request_foundation.sql'), true);
  assert.equal(migrationFiles.filter((name) => name.startsWith('0041_')).length, 1);
  assert.match(migration(), /CREATE TABLE absence_type/);
  assert.match(migration(), /CREATE TABLE absence_request/);
  assert.match(migration(), /CREATE TABLE absence_request_event/);
  assert.match(migration(), /CREATE TABLE absence_special_window/);
  assert.match(migration(), /CREATE TABLE absence_special_window_scope/);
  assert.match(migration(), /CREATE TABLE employee_manager_relation/);
});

test('migration tenant foreign keys are composite where tenant-owned objects relate', () => {
  const sql = migration();
  assert.match(sql, /FOREIGN KEY \(employee_tenant_user_id, tenant_id\) REFERENCES tenant_user\(id, tenant_id\)/);
  assert.match(sql, /FOREIGN KEY \(absence_type_id, tenant_id\) REFERENCES absence_type\(id, tenant_id\)/);
  assert.match(sql, /FOREIGN KEY \(assigned_manager_tenant_user_id, tenant_id\) REFERENCES tenant_user\(id, tenant_id\)/);
  assert.match(sql, /FOREIGN KEY \(special_window_id, tenant_id\) REFERENCES absence_special_window\(id, tenant_id\)/);
  assert.match(sql, /FOREIGN KEY \(absence_request_id, tenant_id\) REFERENCES absence_request\(id, tenant_id\)/);
  assert.match(sql, /FOREIGN KEY \(resource_group_id, tenant_id\) REFERENCES resource_groups\(id, tenant_id\)/);
  assert.match(sql, /FOREIGN KEY \(scope_tenant_user_id, tenant_id\) REFERENCES tenant_user\(id, tenant_id\)/);
  assert.match(sql, /FOREIGN KEY \(employee_tenant_user_id, tenant_id\) REFERENCES tenant_user\(id, tenant_id\)/);
  assert.match(sql, /FOREIGN KEY \(manager_tenant_user_id, tenant_id\) REFERENCES tenant_user\(id, tenant_id\)/);
});

test('migration defines request duration and comment constraints', () => {
  const sql = migration();
  assert.match(sql, /ck_absence_request_duration_type CHECK \(duration_type IN \('full_days', 'partial_day', 'time_range'\)\)/);
  assert.match(sql, /ck_absence_request_status CHECK \(status IN \('draft', 'submitted', 'ready_for_review', 'under_review', 'approved', 'rejected', 'change_proposed', 'cancelled'\)\)/);
  assert.match(sql, /char_length\(employee_comment\) <= 250/);
  assert.match(sql, /ck_absence_request_full_days_shape[\s\S]+end_date IS NOT NULL[\s\S]+end_date >= start_date[\s\S]+start_time IS NULL[\s\S]+end_time IS NULL/);
  assert.match(sql, /ck_absence_request_time_range_shape[\s\S]+start_time IS NOT NULL[\s\S]+end_time IS NOT NULL[\s\S]+end_time > start_time/);
  assert.match(sql, /ck_absence_request_partial_day_shape[\s\S]+day_part IN \('morning', 'afternoon'\)/);
});

test('migration defines absence type, special window and manager constraints', () => {
  const sql = migration();
  assert.match(sql, /ck_absence_type_allowed_duration_types[\s\S]+allowed_duration_types <@ ARRAY\['full_days', 'partial_day', 'time_range'\]::text\[\]/);
  assert.match(sql, /ck_absence_special_window_absence_range CHECK \(absence_end_date >= absence_start_date\)/);
  assert.match(sql, /ck_absence_special_window_submission_range CHECK \(submission_deadline >= submission_open_date\)/);
  assert.match(sql, /ck_absence_special_window_review_after_deadline CHECK \(review_start_date >= submission_deadline\)/);
  assert.match(sql, /ck_absence_special_window_scope_shape/);
  assert.match(sql, /ck_employee_manager_relation_not_self CHECK \(employee_tenant_user_id <> manager_tenant_user_id\)/);
  assert.match(sql, /uq_employee_manager_relation_open_primary[\s\S]+WHERE is_active = true AND relation_type = 'primary' AND valid_to IS NULL/);
});

test('migration makes request events append-only and adds expected indexes', () => {
  const sql = migration();
  assert.match(sql, /trg_absence_request_event_prevent_update[\s\S]+prevent_update_delete_append_only/);
  assert.match(sql, /trg_absence_request_event_prevent_delete[\s\S]+prevent_update_delete_append_only/);
  assert.match(sql, /ix_absence_request_employee_created/);
  assert.match(sql, /ix_absence_request_manager_status/);
  assert.match(sql, /ix_absence_request_tenant_status_dates/);
  assert.match(sql, /ix_absence_request_event_request_created/);
  assert.match(sql, /ix_absence_special_window_tenant_review_ready/);
  assert.match(sql, /ix_employee_manager_relation_manager_active/);
});

test('permission matrix grants own requests but not managed/private actions by role alone', () => {
  for (const role of ['tenant_admin', 'project_leader', 'technician']) {
    assert.equal(requireAccess(role, 'absence_request', 'create_own').permission, 'absence_request:create_own');
    assert.equal(requireAccess(role, 'absence_request', 'read_own').permission, 'absence_request:read_own');
    assert.equal(requireAccess(role, 'absence_request', 'submit_own').permission, 'absence_request:submit_own');
    assertDenied(() => requireAccess(role, 'absence_request', 'read_private_comment'));
  }

  for (const role of ['tenant_admin', 'project_leader', 'technician']) {
    assertDenied(() => requireAccess(role, 'absence_request', 'read_managed'));
    assertDenied(() => requireAccess(role, 'absence_request', 'approve_managed'));
    assertDenied(() => requireAccess(role, 'absence_request', 'reject_managed'));
  }
});

test('admin foundation permissions are explicit and do not include private comments', () => {
  assert.equal(requireAccess('tenant_admin', 'absence_type', 'manage').permission, 'absence_type:manage');
  assert.equal(requireAccess('tenant_admin', 'absence_special_window', 'manage').permission, 'absence_special_window:manage');
  assertDenied(() => requireAccess('tenant_admin', 'absence_special_window', 'review'));
  assert.equal(requireAccess('tenant_admin', 'employee_manager_relation', 'manage').permission, 'employee_manager_relation:manage');
  assert.equal(requireAccess('tenant_admin', 'absence_request', 'administrative_override').permission, 'absence_request:administrative_override');
  assertDenied(() => requireAccess('tenant_admin', 'absence_request', 'read_private_comment'));
});

test('separate private-comment and managed actions can be granted explicitly and remain tenant-scoped', () => {
  assert.equal(
    requireAccess('technician', 'absence_request', 'read_private_comment', ['absence_request:read_private_comment']).permission,
    'absence_request:read_private_comment'
  );
  assert.equal(
    requireAccess('project_leader', 'absence_request', 'approve_managed', ['absence_request:approve_managed']).permission,
    'absence_request:approve_managed'
  );
  assert.equal(
    requireAccess('project_leader', 'absence_special_window', 'review', ['absence_special_window:review']).permission,
    'absence_special_window:review'
  );
  assertDenied(() => moduleAccessService.requireModuleAccess({
    tenant: { id: uuid(10) },
    auth: auth('technician', uuid(11), uuid(12), ['absence_request:read_private_comment']),
    moduleKey: 'absence_request',
    action: 'read_private_comment',
  }));
});

test('resource group manager role does not grant absence approval', () => {
  const source = read('backend/src/services/moduleAccessService.js');
  assert.doesNotMatch(source, /resource_group_managers[\s\S]+approve_managed/);
  assertDenied(() => requireAccess('technician', 'absence_request', 'approve_managed'));
});

test('audit service and migration include PR2 audit keys', () => {
  const sql = migration();
  const pr2EventTypes = ABSENCE_AUDIT_EVENT_TYPES.filter((eventType) => ![
    'absence_request.late_submitted',
    'absence_special_window.scope_changed',
  ].includes(eventType));
  for (const eventType of ABSENCE_AUDIT_EVENT_TYPES) {
    assert.equal(auditService.ALLOWED_EVENT_TYPES.includes(eventType), true, eventType);
  }
  for (const eventType of pr2EventTypes) {
    assert.match(sql, new RegExp(eventType.replace(/[.]/g, '\\.')));
  }
});

test('absence constants mirror migration status, duration and event contracts', () => {
  const sql = migration();
  for (const status of ABSENCE_REQUEST_STATUSES) assert.match(sql, new RegExp(`'${status}'`));
  for (const durationType of ABSENCE_DURATION_TYPES) assert.match(sql, new RegExp(`'${durationType}'`));
  for (const eventType of ABSENCE_REQUEST_EVENT_TYPES) assert.match(sql, new RegExp(`'${eventType}'`));
  assert.equal(ABSENCE_REQUEST_STATUSES.includes('awaiting_window_close'), false);
});

test('absence repositories scope find and list queries by tenant', async () => {
  const client = createClient([]);
  await absenceTypeRepository.findById(client, { tenantId: uuid(1), absenceTypeId: uuid(2) });
  await absenceTypeRepository.listActive(client, { tenantId: uuid(1) });
  await absenceTypeRepository.listActive(client, { tenantId: uuid(1), workflowMode: 'request' });
  await absenceRequestRepository.findById(client, { tenantId: uuid(1), absenceRequestId: uuid(3) });
  await absenceRequestRepository.listForEmployee(client, { tenantId: uuid(1), employeeTenantUserId: uuid(4) });
  await absenceSpecialWindowRepository.findById(client, { tenantId: uuid(1), specialWindowId: uuid(5) });
  await employeeManagerRelationRepository.findActiveManagersForEmployee(client, { tenantId: uuid(1), employeeTenantUserId: uuid(6), asOfDate: '2026-08-05' });

  for (const call of client.calls) {
    assert.match(call.sql, /tenant_id = \$1/);
    assert.equal(call.params[0], uuid(1));
  }
  assert.match(client.calls[2].sql, /workflow_mode = \$2::text/);
  assert.deepEqual(client.calls[2].params, [uuid(1), 'request']);
  assert.match(client.calls[2].sql, /ORDER BY sort_order ASC, name ASC, id ASC/);
});

test('request event history is returned chronologically', async () => {
  const client = createClient([]);
  await absenceRequestRepository.listEvents(client, { tenantId: uuid(1), absenceRequestId: uuid(2) });
  assert.match(client.calls[0].sql, /ORDER BY created_at ASC, id ASC/);
  assert.deepEqual(client.calls[0].params, [uuid(1), uuid(2)]);
});

test('request insert keeps fitter optional and event metadata parameterized', async () => {
  const client = createClient([{ id: uuid(9) }]);
  await absenceRequestRepository.insertRequest(client, {
    tenantId: uuid(1),
    employeeTenantUserId: uuid(2),
    absenceTypeId: uuid(3),
    durationType: 'full_days',
    startDate: '2026-08-10',
    endDate: '2026-08-12',
  });
  await absenceRequestRepository.insertEvent(client, {
    tenantId: uuid(1),
    absenceRequestId: uuid(9),
    eventType: 'created',
    metadata: { source: 'test' },
  });
  assert.equal(client.calls[0].params[2], null);
  assert.equal(client.calls[1].params[7], JSON.stringify({ source: 'test' }));
});
