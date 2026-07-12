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

function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

test('tenant lifecycle repository exports advisory lock and service uses it', async () => {
  const tenantId = uuid(1);
  const userId = uuid(2);
  const actorId = uuid(3);
  const queries = [];
  const lifecycleEvents = [];
  const original = {
    connect: pool.connect,
    audit: auditService.logAuditEvent,
    find: tenantAdminRepository.findTenantUserForUpdate,
    count: tenantAdminRepository.countActiveTenantAdmins,
    revoke: tenantAdminRepository.revokeOpenTenantUserInvitations,
    deactivate: tenantAdminRepository.deactivateTenantUser,
    lifecycle: tenantAdminRepository.insertTenantUserLifecycleEvent,
  };

  assert.equal(typeof tenantAdminRepository.acquireTenantLifecycleLock, 'function');

  pool.connect = async () => ({
    async query(sql, params = []) {
      const text = String(sql);
      queries.push({ sql: text, params });
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(text)) return { rows: [] };
      if (text.includes('pg_advisory_xact_lock') && text.includes('hashtextextended($1::text, 0)')) {
        return { rows: [{}] };
      }
      return { rows: [] };
    },
    release() {},
  });
  auditService.logAuditEvent = async () => {};
  tenantAdminRepository.findTenantUserForUpdate = async () => ({
    id: userId,
    tenant_id: tenantId,
    role: 'technician',
    status: 'active',
    login_status: 'active',
    session_version: 0,
  });
  tenantAdminRepository.countActiveTenantAdmins = async () => 1;
  tenantAdminRepository.revokeOpenTenantUserInvitations = async () => 0;
  tenantAdminRepository.deactivateTenantUser = async () => ({
    id: userId,
    tenant_id: tenantId,
    role: 'technician',
    status: 'deactivated',
    login_status: 'disabled',
    session_version: 1,
    deactivated_reason: 'left',
    deactivated_by_user_id: actorId,
    deactivated_at: '2026-07-12T00:00:00.000Z',
  });
  tenantAdminRepository.insertTenantUserLifecycleEvent = async (_client, event) => {
    lifecycleEvents.push(event);
    return { id: uuid(100 + lifecycleEvents.length), ...event };
  };

  try {
    const directClient = {
      async query(sql, params = []) {
        queries.push({ sql: String(sql), params });
        return { rows: [] };
      },
    };
    await tenantAdminRepository.acquireTenantLifecycleLock(directClient, { tenantId });
    assert.equal(
      queries.some((query) => query.sql.includes('pg_advisory_xact_lock')
        && query.sql.includes('hashtextextended($1::text, 0)')
        && query.params[0] === tenantId),
      true
    );

    queries.length = 0;
    const result = await tenantAdminService.deactivateUser({ tenantId, actorId, userId, reason: 'left' });
    assert.equal(result.user.status, 'deactivated');
    assert.equal(
      queries.some((query) => query.sql.includes('pg_advisory_xact_lock')
        && query.sql.includes('hashtextextended($1::text, 0)')
        && query.params[0] === tenantId),
      true
    );
    assert.equal(lifecycleEvents.some((event) => event.eventType === 'deactivated'), true);
    assert.equal(lifecycleEvents.some((event) => event.eventType === 'sessions_revoked'), true);
  } finally {
    pool.connect = original.connect;
    auditService.logAuditEvent = original.audit;
    tenantAdminRepository.findTenantUserForUpdate = original.find;
    tenantAdminRepository.countActiveTenantAdmins = original.count;
    tenantAdminRepository.revokeOpenTenantUserInvitations = original.revoke;
    tenantAdminRepository.deactivateTenantUser = original.deactivate;
    tenantAdminRepository.insertTenantUserLifecycleEvent = original.lifecycle;
  }
});

function installStatefulCompletionPool(state) {
  return installPool((sql, params) => {
    if (sql.includes('FROM tenant_user_invitation_token') && sql.includes('FOR UPDATE')) {
      const invitation = state.invitations[params[2]];
      if (!invitation || invitation.tenant_user_id !== params[1] || invitation.tenant_id !== params[0]) return { rows: [] };
      return {
        rows: [{
          id: params[2],
          tenant_id: invitation.tenant_id,
          tenant_user_id: invitation.tenant_user_id,
          invitation_status: invitation.status,
          expires_at: invitation.expires_at,
          sent_at: invitation.sent_at,
          used_at: invitation.used_at,
          revoked_at: invitation.revoked_at,
          send_error: invitation.send_error,
          flow_type: invitation.flow_type,
        }],
      };
    }
    if (sql.includes('FROM tenant_user') && sql.includes('FOR UPDATE')) {
      const user = state.users[params[1]];
      return { rows: user && user.tenant_id === params[0] ? [{ id: params[1], tenant_id: user.tenant_id, ...user }] : [] };
    }
    if (sql.includes('UPDATE tenant_user_invitation_token')) {
      const invitation = state.invitations[params[2]];
      if (!invitation || invitation.status !== 'pending' || invitation.used_at || invitation.revoked_at) return { rows: [] };
      if (sql.includes("= 'sent'")) {
        invitation.status = 'sent';
        invitation.sent_at = '2026-07-12T00:00:00.000Z';
        invitation.send_error = null;
        return { rows: [{ id: params[2], expires_at: invitation.expires_at, sent_at: invitation.sent_at }] };
      }
      if (sql.includes("= 'send_failed'")) {
        invitation.status = 'send_failed';
        invitation.send_error = params[3];
        return { rows: [{ id: params[2] }] };
      }
    }
    if (sql.includes('UPDATE tenant_user')) {
      const user = state.users[params[1]];
      if (!user) return { rows: [] };
      if (sql.includes("login_status = 'invited'")) {
        if (!['active', 'invited'].includes(user.status) || !['pending_invite', 'imported_no_login', 'invited'].includes(user.login_status)) {
          return { rows: [] };
        }
        user.status = user.status === 'active' ? 'active' : 'invited';
        user.login_status = 'invited';
        user.last_invited_at = '2026-07-12T00:00:00.000Z';
        return { rows: [{ id: params[1] }] };
      }
      if (sql.includes("login_status = 'pending_invite'")) {
        if (!['active', 'invited'].includes(user.status) || !['pending_invite', 'imported_no_login', 'invited'].includes(user.login_status)) {
          return { rows: [] };
        }
        user.login_status = 'pending_invite';
        return { rows: [{ id: params[1] }] };
      }
      if (sql.includes("login_status = 'pending_reactivation'")) {
        if (user.status !== 'pending_reactivation' || user.login_status !== 'pending_reactivation') {
          return { rows: [] };
        }
        user.status = 'pending_reactivation';
        user.login_status = 'pending_reactivation';
        user.last_invited_at = '2026-07-12T00:00:00.000Z';
        return { rows: [{ id: params[1] }] };
      }
    }
    return { rows: [] };
  });
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

test('normal invitation stale completion leaves pending invitation and user state untouched', async () => {
  const tenantId = uuid(1);
  const userId = uuid(2);
  const invitationId = uuid(3);
  const state = {
    users: {
      [userId]: { tenant_id: tenantId, status: 'deactivated', login_status: 'disabled', session_version: 4 },
    },
    invitations: {
      [invitationId]: {
        tenant_id: tenantId,
        tenant_user_id: userId,
        status: 'pending',
        flow_type: 'initial_setup',
        expires_at: '2026-07-15T00:00:00.000Z',
        sent_at: null,
        send_error: null,
        used_at: null,
        revoked_at: null,
      },
    },
  };
  const originalUser = cloneState(state.users[userId]);
  const auditEvents = [];
  const originalAudit = auditService.logAuditEvent;
  const fake = installStatefulCompletionPool(state);
  auditService.logAuditEvent = async (event) => auditEvents.push(event);

  try {
    const result = await invitationService._test.markInvitationSent({
      tenantId,
      userId,
      invitationId,
      actorId: uuid(4),
      provider: 'test',
    });
    assert.equal(result.status, 'stale');
    assert.deepEqual(state.users[userId], originalUser);
    assert.equal(state.invitations[invitationId].status, 'pending');
    assert.equal(state.invitations[invitationId].sent_at, null);
    assert.equal(state.invitations[invitationId].send_error, null);
    assert.equal(fake.queries.some((q) => q.sql.includes('UPDATE tenant_user_invitation_token')), false);
    assert.equal(fake.queries.some((q) => q.sql.includes('UPDATE tenant_user')), false);
    assert.equal(auditEvents.some((event) => event.eventType === 'tenant_user_invite_sent'), false);
  } finally {
    auditService.logAuditEvent = originalAudit;
    fake.restore();
  }
});

test('normal invitation send failure stale completion leaves revoked invitation untouched', async () => {
  const tenantId = uuid(1);
  const userId = uuid(2);
  const invitationId = uuid(3);
  const state = {
    users: {
      [userId]: { tenant_id: tenantId, status: 'invited', login_status: 'pending_invite' },
    },
    invitations: {
      [invitationId]: {
        tenant_id: tenantId,
        tenant_user_id: userId,
        status: 'revoked',
        flow_type: 'initial_setup',
        expires_at: '2026-07-15T00:00:00.000Z',
        sent_at: null,
        send_error: null,
        used_at: null,
        revoked_at: '2026-07-12T00:00:00.000Z',
      },
    },
  };
  const originalState = cloneState(state);
  const auditEvents = [];
  const originalAudit = auditService.logAuditEvent;
  const fake = installStatefulCompletionPool(state);
  auditService.logAuditEvent = async (event) => auditEvents.push(event);

  try {
    const result = await invitationService._test.markInvitationSendFailed({
      tenantId,
      userId,
      invitationId,
      actorId: uuid(4),
      error: new Error('smtp down'),
    });
    assert.equal(result.status, 'stale');
    assert.deepEqual(state, originalState);
    assert.notEqual(state.invitations[invitationId].status, 'send_failed');
    assert.equal(auditEvents.some((event) => event.eventType === 'tenant_user_invite_send_failed'), false);
  } finally {
    auditService.logAuditEvent = originalAudit;
    fake.restore();
  }
});

test('old reactivation resend completion leaves revoked A and current B untouched', async () => {
  const tenantId = uuid(1);
  const userId = uuid(2);
  const invitationA = uuid(3);
  const invitationB = uuid(4);
  const state = {
    users: {
      [userId]: { tenant_id: tenantId, status: 'pending_reactivation', login_status: 'pending_reactivation' },
    },
    invitations: {
      [invitationA]: {
        tenant_id: tenantId,
        tenant_user_id: userId,
        status: 'revoked',
        flow_type: 'reactivation',
        expires_at: '2026-07-15T00:00:00.000Z',
        sent_at: null,
        send_error: null,
        used_at: null,
        revoked_at: '2026-07-12T00:00:00.000Z',
      },
      [invitationB]: {
        tenant_id: tenantId,
        tenant_user_id: userId,
        status: 'pending',
        flow_type: 'reactivation',
        expires_at: '2026-07-15T00:05:00.000Z',
        sent_at: null,
        send_error: null,
        used_at: null,
        revoked_at: null,
      },
    },
  };
  const originalState = cloneState(state);
  const auditEvents = [];
  const lifecycleEvents = [];
  const originalAudit = auditService.logAuditEvent;
  const originalLifecycle = tenantAdminRepository.insertTenantUserLifecycleEvent;
  const fake = installStatefulCompletionPool(state);
  auditService.logAuditEvent = async (event) => auditEvents.push(event);
  tenantAdminRepository.insertTenantUserLifecycleEvent = async (_client, event) => lifecycleEvents.push(event);

  try {
    const result = await invitationService._test.markReactivationInvitationSent({
      tenantId,
      userId,
      invitationId: invitationA,
      actorId: uuid(5),
      provider: 'test',
    });
    assert.equal(result.status, 'stale');
    assert.deepEqual(state, originalState);
    assert.notEqual(state.invitations[invitationA].status, 'sent');
    assert.notEqual(state.invitations[invitationA].status, 'send_failed');
    assert.equal(state.invitations[invitationB].status, 'pending');
    assert.equal(auditEvents.length, 0);
    assert.equal(lifecycleEvents.length, 0);
  } finally {
    auditService.logAuditEvent = originalAudit;
    tenantAdminRepository.insertTenantUserLifecycleEvent = originalLifecycle;
    fake.restore();
  }
});

test('completion row-count conflict rolls back invitation update atomically', async () => {
  const tenantId = uuid(1);
  const userId = uuid(2);
  const invitationId = uuid(3);
  const state = {
    users: {
      [userId]: { tenant_id: tenantId, status: 'invited', login_status: 'pending_invite' },
    },
    invitations: {
      [invitationId]: {
        tenant_id: tenantId,
        tenant_user_id: userId,
        status: 'pending',
        flow_type: 'initial_setup',
        expires_at: '2026-07-15T00:00:00.000Z',
        sent_at: null,
        send_error: null,
        used_at: null,
        revoked_at: null,
      },
    },
  };
  let snapshot = null;
  const originalConnect = pool.connect;
  const originalAudit = auditService.logAuditEvent;
  const auditEvents = [];
  pool.connect = async () => ({
    async query(sql, params = []) {
      const text = String(sql);
      if (/^\s*BEGIN\s*$/i.test(text)) {
        snapshot = cloneState(state);
        return { rows: [] };
      }
      if (/^\s*ROLLBACK\s*$/i.test(text)) {
        state.users = snapshot.users;
        state.invitations = snapshot.invitations;
        return { rows: [] };
      }
      if (/^\s*COMMIT\s*$/i.test(text)) return { rows: [] };
      if (text.includes('FROM tenant_user_invitation_token') && text.includes('FOR UPDATE')) {
        const invitation = state.invitations[params[2]];
        return { rows: [{
          id: params[2],
          tenant_id: invitation.tenant_id,
          tenant_user_id: invitation.tenant_user_id,
          invitation_status: invitation.status,
          expires_at: invitation.expires_at,
          sent_at: invitation.sent_at,
          used_at: invitation.used_at,
          revoked_at: invitation.revoked_at,
          send_error: invitation.send_error,
          flow_type: invitation.flow_type,
        }] };
      }
      if (text.includes('FROM tenant_user') && text.includes('FOR UPDATE')) {
        const user = state.users[params[1]];
        return { rows: [{ id: params[1], tenant_id: user.tenant_id, ...user }] };
      }
      if (text.includes('UPDATE tenant_user_invitation_token')) {
        state.invitations[params[2]].status = 'sent';
        state.invitations[params[2]].sent_at = '2026-07-12T00:00:00.000Z';
        return { rows: [{ id: params[2], expires_at: state.invitations[params[2]].expires_at, sent_at: state.invitations[params[2]].sent_at }] };
      }
      if (text.includes('UPDATE tenant_user')) {
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() {},
  });
  auditService.logAuditEvent = async (event) => auditEvents.push(event);

  try {
    await assert.rejects(
      () => invitationService._test.markInvitationSent({
        tenantId,
        userId,
        invitationId,
        actorId: uuid(4),
        provider: 'test',
      }),
      /invite_completion_state_conflict/
    );
    assert.equal(state.invitations[invitationId].status, 'pending');
    assert.equal(state.invitations[invitationId].sent_at, null);
    assert.equal(state.users[userId].login_status, 'pending_invite');
    assert.equal(auditEvents.length, 0);
  } finally {
    pool.connect = originalConnect;
    auditService.logAuditEvent = originalAudit;
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