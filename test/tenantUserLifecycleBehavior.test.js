'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://example.invalid/fielddesk_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'fielddesk.test';

const pool = require('../backend/src/db/pool');
const auditService = require('../backend/src/services/auditService');
const tenantAdminRepository = require('../backend/src/modules/tenantAdmin/tenantAdmin.repository');
const tenantAdminService = require('../backend/src/modules/tenantAdmin/tenantAdmin.service');
const invitationService = require('../backend/src/modules/tenantAdmin/tenantUserInvitation.service');

function installPool(queryHandler) {
  const originalConnect = pool.connect;
  const queries = [];
  pool.connect = async () => ({
    async query(sql, params) {
      const text = String(sql);
      queries.push({ sql: text, params: params || [] });
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(text)) {
        return { rows: [] };
      }
      return queryHandler(text, params || []);
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

function uuid(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

test('manual PATCH lifecycle transitions require dedicated endpoints', () => {
  assert.throws(
    () => tenantAdminService._test.normalizeStatus('deactivated'),
    /tenant_user_lifecycle_transition_requires_dedicated_endpoint/
  );
  assert.throws(
    () => tenantAdminService._test.assertManualStatusPatchAllowed({
      currentStatus: 'pending_reactivation',
      requestedStatus: 'active',
    }),
    /tenant_user_lifecycle_transition_requires_dedicated_endpoint/
  );
});

test('normal invitation completion treats revoked token as stale and does not update user', async () => {
  const state = {
    user: { status: 'deactivated', login_status: 'disabled', session_version: 4 },
    invitation: { status: 'revoked', revoked_at: new Date().toISOString() },
  };
  const fake = installPool((sql) => {
    if (sql.includes('UPDATE tenant_user_invitation_token i')) {
      return { rows: state.invitation.status === 'pending' ? [{ id: 'invite-a', expires_at: '2026-07-15T00:00:00.000Z' }] : [] };
    }
    if (sql.includes('UPDATE tenant_user')) {
      state.user.status = 'invited';
      return { rows: [{ id: 'user-a' }] };
    }
    return { rows: [] };
  });

  try {
    const result = await invitationService._test.markInvitationSent({
      tenantId: uuid(1),
      userId: uuid(2),
      invitationId: uuid(3),
      actorId: uuid(4),
      provider: 'test',
    });
    assert.equal(result.status, 'stale');
    assert.equal(state.user.status, 'deactivated');
    assert.equal(state.user.session_version, 4);
    assert.equal(state.invitation.status, 'revoked');
    assert.equal(fake.queries.some((q) => q.sql.includes('UPDATE tenant_user\n        SET login_status')), false);
  } finally {
    fake.restore();
  }
});

test('old reactivation resend completion cannot overwrite the current invitation', async () => {
  const state = {
    user: { status: 'pending_reactivation', login_status: 'pending_reactivation' },
    invitationA: { status: 'revoked' },
    invitationB: { status: 'pending' },
  };
  const fake = installPool((sql) => {
    if (sql.includes('UPDATE tenant_user_invitation_token i')) {
      return { rows: state.invitationA.status === 'pending' ? [{ id: 'invite-a', expires_at: '2026-07-15T00:00:00.000Z' }] : [] };
    }
    if (sql.includes('UPDATE tenant_user')) {
      state.user.status = 'active';
      return { rows: [{ id: 'user-a' }] };
    }
    return { rows: [] };
  });

  try {
    const result = await invitationService._test.markReactivationInvitationSent({
      tenantId: uuid(1),
      userId: uuid(2),
      invitationId: uuid(3),
      actorId: uuid(4),
      provider: 'test',
    });
    assert.equal(result.status, 'stale');
    assert.equal(state.invitationA.status, 'revoked');
    assert.equal(state.invitationB.status, 'pending');
    assert.equal(state.user.status, 'pending_reactivation');
  } finally {
    fake.restore();
  }
});

test('invitation flow type must match tenant user lifecycle state', () => {
  assert.throws(
    () => invitationService._test.assertInvitationFlowMatchesUser({
      flow_type: 'initial_setup',
      user_status: 'deactivated',
      login_status: 'disabled',
    }),
    /invite_lifecycle_state_mismatch/
  );
  assert.throws(
    () => invitationService._test.assertInvitationFlowMatchesUser({
      flow_type: 'reactivation',
      user_status: 'invited',
      login_status: 'pending_invite',
    }),
    /invite_lifecycle_state_mismatch/
  );
  assert.equal(invitationService._test.assertInvitationFlowMatchesUser({
    flow_type: 'reactivation',
    user_status: 'pending_reactivation',
    login_status: 'pending_reactivation',
  }), 'reactivation');
});

test('accept rejects stale lifecycle mismatch before token update', async () => {
  const fake = installPool((sql) => {
    if (sql.includes('FROM tenant_user_invitation_token i')) {
      return {
        rows: [{
          id: uuid(10),
          tenant_id: uuid(1),
          tenant_user_id: uuid(2),
          invitation_status: 'sent',
          expires_at: '2099-01-01T00:00:00.000Z',
          used_at: null,
          revoked_at: null,
          email: 'user@example.test',
          name: 'User',
          user_status: 'deactivated',
          login_status: 'disabled',
          flow_type: 'initial_setup',
        }],
      };
    }
    if (sql.includes('UPDATE tenant_user_invitation_token')) {
      return { rows: [{ id: uuid(10) }] };
    }
    return { rows: [] };
  });

  try {
    await assert.rejects(
      () => invitationService.acceptTenantUserInvitation({
        tenantId: uuid(1),
        token: 'token-value',
        password: 'new-password-123',
      }),
      /invite_lifecycle_state_mismatch/
    );
    assert.equal(fake.queries.some((q) => q.sql.includes('SET status = \'used\'')), false);
  } finally {
    fake.restore();
  }
});

test('tenant lifecycle advisory lock serializes concurrent admin deactivation', async () => {
  const tenantId = uuid(1);
  const adminA = uuid(101);
  const adminB = uuid(102);
  const users = new Map([
    [adminA, { id: adminA, tenant_id: tenantId, role: 'tenant_admin', status: 'active', login_status: 'active', session_version: 0 }],
    [adminB, { id: adminB, tenant_id: tenantId, role: 'tenant_admin', status: 'active', login_status: 'active', session_version: 0 }],
  ]);
  const original = {
    connect: pool.connect,
    audit: auditService.logAuditEvent,
    acquire: tenantAdminRepository.acquireTenantLifecycleLock,
    find: tenantAdminRepository.findTenantUserForUpdate,
    count: tenantAdminRepository.countActiveTenantAdmins,
    revoke: tenantAdminRepository.revokeOpenTenantUserInvitations,
    deactivate: tenantAdminRepository.deactivateTenantUser,
    lifecycle: tenantAdminRepository.insertTenantUserLifecycleEvent,
  };
  let locked = false;
  const waiters = [];
  function releaseLock() {
    locked = false;
    const next = waiters.shift();
    if (next) next();
  }

  pool.connect = async () => ({
    async query(sql) {
      if (/COMMIT|ROLLBACK/.test(String(sql))) releaseLock();
      return { rows: [] };
    },
    release() {},
  });
  auditService.logAuditEvent = async () => {};
  tenantAdminRepository.acquireTenantLifecycleLock = async () => {
    if (locked) await new Promise((resolve) => waiters.push(resolve));
    locked = true;
  };
  tenantAdminRepository.findTenantUserForUpdate = async (_client, { userId }) => ({ ...users.get(userId) });
  tenantAdminRepository.countActiveTenantAdmins = async () => Array.from(users.values())
    .filter((user) => user.role === 'tenant_admin' && user.status === 'active' && user.login_status === 'active')
    .length;
  tenantAdminRepository.revokeOpenTenantUserInvitations = async () => 0;
  tenantAdminRepository.insertTenantUserLifecycleEvent = async () => ({});
  tenantAdminRepository.deactivateTenantUser = async (_client, { userId }) => {
    const user = users.get(userId);
    if (!user || user.status !== 'active') return null;
    user.status = 'deactivated';
    user.login_status = 'disabled';
    user.session_version += 1;
    return { ...user };
  };

  try {
    const results = await Promise.allSettled([
      tenantAdminService.deactivateUser({ tenantId, actorId: adminB, userId: adminA, reason: 'left' }),
      tenantAdminService.deactivateUser({ tenantId, actorId: adminA, userId: adminB, reason: 'left' }),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    assert.equal(Array.from(users.values()).filter((user) => user.status === 'active').length, 1);
  } finally {
    pool.connect = original.connect;
    auditService.logAuditEvent = original.audit;
    tenantAdminRepository.acquireTenantLifecycleLock = original.acquire;
    tenantAdminRepository.findTenantUserForUpdate = original.find;
    tenantAdminRepository.countActiveTenantAdmins = original.count;
    tenantAdminRepository.revokeOpenTenantUserInvitations = original.revoke;
    tenantAdminRepository.deactivateTenantUser = original.deactivate;
    tenantAdminRepository.insertTenantUserLifecycleEvent = original.lifecycle;
  }
});