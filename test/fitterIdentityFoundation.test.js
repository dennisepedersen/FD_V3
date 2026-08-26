'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://example.invalid/fielddesk_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const auditService = require('../backend/src/services/auditService');
const {
  normalizeEmailForIdentity,
  normalizeUuid,
  resolveCurrentFitter,
  resolveFitterIdentityLinksForBatch,
} = require('../backend/src/services/fitterIdentityService');

const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-000000000002';
const USER_A = '00000000-0000-4000-8000-000000000101';
const USER_B = '00000000-0000-4000-8000-000000000102';
const EK_A = '11111111-1111-4111-8111-111111111111';
const EK_B = '22222222-2222-4222-8222-222222222222';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeClient({ fitters = [], users = [] } = {}) {
  const state = {
    fitters: clone(fitters),
    users: clone(users),
    calls: [],
  };

  function activeUserById(tenantId, userId) {
    return state.users.find((user) => String(user.tenant_id) === String(tenantId) && String(user.id) === String(userId)) || null;
  }

  function loadFitter(tenantId, fitterId) {
    const fitter = state.fitters.find((row) => String(row.tenant_id) === String(tenantId) && String(row.fitter_id) === String(fitterId));
    if (!fitter) return null;
    const linkedUser = fitter.tenant_user_id ? activeUserById(tenantId, fitter.tenant_user_id) : null;
    return {
      ...fitter,
      linked_tenant_user_id: linkedUser ? linkedUser.id : null,
      linked_tenant_user_email: linkedUser ? linkedUser.email : null,
      linked_tenant_user_ek_user_id: linkedUser ? linkedUser.ek_user_id : null,
      linked_tenant_user_status: linkedUser ? linkedUser.status : null,
      linked_tenant_user_login_status: linkedUser ? linkedUser.login_status : null,
    };
  }

  const client = {
    state,
    async query(sql, params = []) {
      const text = String(sql);
      state.calls.push({ sql: text, params });

      if (text.includes('FROM fitter f') && text.includes('FOR UPDATE OF f')) {
        const [tenantId, fitterId] = params;
        const row = loadFitter(tenantId, fitterId);
        return { rows: row ? [row] : [] };
      }

      if (text.includes('FROM tenant_user') && text.includes('lower(btrim(email)) = $2')) {
        const [tenantId, email] = params;
        return {
          rows: state.users
            .filter((user) => String(user.tenant_id) === String(tenantId))
            .filter((user) => normalizeEmailForIdentity(user.email) === email)
            .filter((user) => user.status === 'active' && user.login_status === 'active')
            .slice(0, 2),
        };
      }

      if (text.includes('FROM fitter') && text.includes('OR ek_user_id = $3::uuid')) {
        const [tenantId, email, ekUserId] = params;
        return {
          rows: state.fitters
            .filter((fitter) => String(fitter.tenant_id) === String(tenantId))
            .filter((fitter) => fitter.is_active_derived !== false)
            .filter((fitter) => normalizeEmailForIdentity(fitter.email) === email || normalizeUuid(fitter.ek_user_id) === ekUserId)
            .sort((a, b) => String(a.fitter_id).localeCompare(String(b.fitter_id)))
            .slice(0, 2)
            .map((fitter) => ({
              fitter_id: fitter.fitter_id,
              tenant_user_id: fitter.tenant_user_id || null,
              ek_user_id: fitter.ek_user_id || null,
              identity_link_status: fitter.identity_link_status || 'unresolved',
            })),
        };
      }

      if (text.includes('FROM fitter') && text.includes('fitter_id <> $3')) {
        const [tenantId, tenantUserId, fitterId] = params;
        const row = state.fitters.find((fitter) => (
          String(fitter.tenant_id) === String(tenantId)
          && String(fitter.tenant_user_id) === String(tenantUserId)
          && String(fitter.fitter_id) !== String(fitterId)
          && ['auto_linked', 'manually_linked'].includes(fitter.identity_link_status)
          && fitter.is_active_derived !== false
        ));
        return { rows: row ? [{ fitter_id: row.fitter_id }] : [] };
      }

      if (text.includes('FROM tenant_user') && text.includes('ek_user_id = $2::uuid')) {
        const [tenantId, ekUserId, tenantUserId] = params;
        const row = state.users.find((user) => (
          String(user.tenant_id) === String(tenantId)
          && normalizeUuid(user.ek_user_id) === ekUserId
          && String(user.id) !== String(tenantUserId)
        ));
        return { rows: row ? [{ id: row.id }] : [] };
      }

      if (text.includes('UPDATE tenant_user')) {
        const [tenantId, tenantUserId, ekUserId, source] = params;
        const user = state.users.find((row) => String(row.tenant_id) === String(tenantId) && String(row.id) === String(tenantUserId));
        if (!user || (user.ek_user_id && normalizeUuid(user.ek_user_id) !== ekUserId)) return { rows: [] };
        user.ek_user_id = ekUserId;
        user.ek_user_link_source = user.ek_user_link_source || source;
        return { rows: [{ id: user.id, ek_user_id: user.ek_user_id }] };
      }

      if (text.includes("identity_link_status = 'auto_linked'")) {
        const [tenantId, fitterId, tenantUserId] = params;
        const fitter = state.fitters.find((row) => String(row.tenant_id) === String(tenantId) && String(row.fitter_id) === String(fitterId));
        if (fitter && !fitter.tenant_user_id) {
          fitter.tenant_user_id = tenantUserId;
          fitter.identity_link_status = 'auto_linked';
          fitter.identity_link_method = 'auto_email';
          fitter.identity_link_conflict_reason = null;
        }
        return { rows: [] };
      }

      if (text.includes("identity_link_status = 'unresolved'")) {
        const [tenantId, fitterId, reason] = params;
        const fitter = state.fitters.find((row) => String(row.tenant_id) === String(tenantId) && String(row.fitter_id) === String(fitterId));
        if (fitter && !fitter.tenant_user_id) {
          fitter.identity_link_status = 'unresolved';
          fitter.identity_link_method = null;
          fitter.identity_link_conflict_reason = reason;
        }
        return { rows: [] };
      }

      if (text.includes("identity_link_status = 'conflict'")) {
        const [tenantId, fitterId, reason] = params;
        const fitter = state.fitters.find((row) => String(row.tenant_id) === String(tenantId) && String(row.fitter_id) === String(fitterId));
        if (fitter) {
          fitter.identity_link_status = 'conflict';
          fitter.identity_link_method = 'conflict';
          fitter.identity_link_conflict_reason = reason;
        }
        return { rows: [] };
      }

      if (text.includes('SET identity_link_checked_at = now()')) {
        return { rows: [] };
      }

      if (text.includes('FROM fitter f') && text.includes('JOIN tenant_user tu') && text.includes("f.identity_link_status IN ('auto_linked', 'manually_linked')")) {
        const [tenantId, tenantUserId] = params;
        const user = activeUserById(tenantId, tenantUserId);
        if (!user || user.status !== 'active' || user.login_status !== 'active') return { rows: [] };
        const rows = state.fitters
          .filter((fitter) => String(fitter.tenant_id) === String(tenantId))
          .filter((fitter) => String(fitter.tenant_user_id) === String(tenantUserId))
          .filter((fitter) => ['auto_linked', 'manually_linked'].includes(fitter.identity_link_status))
          .filter((fitter) => fitter.is_active_derived !== false)
          .slice(0, 2);
        return { rows };
      }

      throw new Error(`Unexpected SQL in test client: ${text}`);
    },
  };

  return client;
}

async function withAuditCapture(fn) {
  const original = auditService.logAuditEvent;
  const audits = [];
  auditService.logAuditEvent = async (event) => {
    audits.push(event);
  };
  try {
    await fn(audits);
  } finally {
    auditService.logAuditEvent = original;
  }
}

test('normalizers preserve exact lowercase email and valid EK user GUID only', () => {
  assert.equal(normalizeEmailForIdentity(' Tech@Example.DK '), 'tech@example.dk');
  assert.equal(normalizeUuid(EK_A.toUpperCase()), EK_A);
  assert.equal(normalizeUuid('not-a-guid'), null);
});

test('unique active same-tenant email and EK userID auto-link fitter to tenant_user', async () => {
  await withAuditCapture(async (audits) => {
    const client = makeClient({
      users: [{ id: USER_A, tenant_id: TENANT_A, email: 'tech@example.dk', status: 'active', login_status: 'active', ek_user_id: null }],
      fitters: [{ tenant_id: TENANT_A, fitter_id: '100', email: ' Tech@Example.DK ', ek_user_id: EK_A, identity_link_status: 'unresolved', is_active_derived: true }],
    });

    const result = await resolveFitterIdentityLinksForBatch(client, {
      tenantId: TENANT_A,
      mappedRows: [{ fitterId: '100', ekUserId: EK_A }],
    });

    assert.equal(result.autoLinked, 1);
    assert.equal(client.state.fitters[0].tenant_user_id, USER_A);
    assert.equal(client.state.fitters[0].identity_link_status, 'auto_linked');
    assert.equal(client.state.users[0].ek_user_id, EK_A);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].eventType, 'tenant_user_identity_linked');
    assert.equal(audits[0].metadata.fitter_id, '100');
  });
});

test('identity sync is idempotent and does not re-audit an existing approved link', async () => {
  await withAuditCapture(async (audits) => {
    const client = makeClient({
      users: [{ id: USER_A, tenant_id: TENANT_A, email: 'tech@example.dk', status: 'active', login_status: 'active', ek_user_id: EK_A }],
      fitters: [{ tenant_id: TENANT_A, fitter_id: '100', email: 'tech@example.dk', ek_user_id: EK_A, tenant_user_id: USER_A, identity_link_status: 'auto_linked', is_active_derived: true }],
    });

    const result = await resolveFitterIdentityLinksForBatch(client, {
      tenantId: TENANT_A,
      mappedRows: [{ fitterId: '100', ekUserId: EK_A }],
    });

    assert.equal(result.preserved, 1);
    assert.equal(client.state.fitters[0].tenant_user_id, USER_A);
    assert.equal(audits.length, 0);
  });
});

test('missing email or name-only data remains unresolved and never falls back to names or initials', async () => {
  const client = makeClient({
    users: [{ id: USER_A, tenant_id: TENANT_A, email: 'tech@example.dk', name: 'Same Name', username: 'ABCD', status: 'active', login_status: 'active', ek_user_id: null }],
    fitters: [{ tenant_id: TENANT_A, fitter_id: '101', name: 'Same Name', username: 'ABCD', email: null, ek_user_id: EK_A, identity_link_status: 'unresolved', is_active_derived: true }],
  });

  const result = await resolveFitterIdentityLinksForBatch(client, {
    tenantId: TENANT_A,
    mappedRows: [{ fitterId: '101', ekUserId: EK_A }],
  });

  assert.equal(result.unresolved, 1);
  assert.equal(client.state.fitters[0].tenant_user_id || null, null);
  assert.equal(client.state.fitters[0].identity_link_conflict_reason, 'missing_email');
});

test('ambiguous same-tenant email or fitter identity is marked conflict', async () => {
  const duplicateUsers = makeClient({
    users: [
      { id: USER_A, tenant_id: TENANT_A, email: 'tech@example.dk', status: 'active', login_status: 'active', ek_user_id: null },
      { id: USER_B, tenant_id: TENANT_A, email: 'TECH@example.dk', status: 'active', login_status: 'active', ek_user_id: null },
    ],
    fitters: [{ tenant_id: TENANT_A, fitter_id: '102', email: 'tech@example.dk', ek_user_id: EK_A, identity_link_status: 'unresolved', is_active_derived: true }],
  });

  const duplicateUserResult = await resolveFitterIdentityLinksForBatch(duplicateUsers, {
    tenantId: TENANT_A,
    mappedRows: [{ fitterId: '102', ekUserId: EK_A }],
  });
  assert.equal(duplicateUserResult.conflicts, 1);
  assert.equal(duplicateUsers.state.fitters[0].identity_link_conflict_reason, 'ambiguous_tenant_user_email_match');

  const duplicateFitters = makeClient({
    users: [{ id: USER_A, tenant_id: TENANT_A, email: 'tech@example.dk', status: 'active', login_status: 'active', ek_user_id: null }],
    fitters: [
      { tenant_id: TENANT_A, fitter_id: '103', email: 'tech@example.dk', ek_user_id: EK_A, identity_link_status: 'unresolved', is_active_derived: true },
      { tenant_id: TENANT_A, fitter_id: '104', email: 'tech@example.dk', ek_user_id: EK_B, identity_link_status: 'unresolved', is_active_derived: true },
    ],
  });

  const duplicateFitterResult = await resolveFitterIdentityLinksForBatch(duplicateFitters, {
    tenantId: TENANT_A,
    mappedRows: [{ fitterId: '103', ekUserId: EK_A }],
  });
  assert.equal(duplicateFitterResult.conflicts, 1);
  assert.equal(duplicateFitters.state.fitters[0].identity_link_conflict_reason, 'ambiguous_fitter_identity_match');
});

test('existing approved fitter link is preserved and not moved to another email-matching user', async () => {
  const client = makeClient({
    users: [
      { id: USER_A, tenant_id: TENANT_A, email: 'old@example.dk', status: 'active', login_status: 'active', ek_user_id: null },
      { id: USER_B, tenant_id: TENANT_A, email: 'tech@example.dk', status: 'active', login_status: 'active', ek_user_id: null },
    ],
    fitters: [{ tenant_id: TENANT_A, fitter_id: '105', email: 'tech@example.dk', ek_user_id: EK_A, tenant_user_id: USER_A, identity_link_status: 'manually_linked', is_active_derived: true }],
  });

  const result = await resolveFitterIdentityLinksForBatch(client, {
    tenantId: TENANT_A,
    mappedRows: [{ fitterId: '105', ekUserId: EK_A }],
  });

  assert.equal(result.preserved, 1);
  assert.equal(client.state.fitters[0].tenant_user_id, USER_A);
  assert.equal(client.state.users[0].ek_user_id, EK_A);
  assert.equal(client.state.users[1].ek_user_id, null);
});

test('tenant_user already linked to another active fitter blocks auto-link', async () => {
  const client = makeClient({
    users: [{ id: USER_A, tenant_id: TENANT_A, email: 'tech@example.dk', status: 'active', login_status: 'active', ek_user_id: null }],
    fitters: [
      { tenant_id: TENANT_A, fitter_id: '106', email: 'tech@example.dk', ek_user_id: EK_A, identity_link_status: 'unresolved', is_active_derived: true },
      { tenant_id: TENANT_A, fitter_id: '107', email: 'other@example.dk', ek_user_id: EK_B, tenant_user_id: USER_A, identity_link_status: 'auto_linked', is_active_derived: true },
    ],
  });

  const result = await resolveFitterIdentityLinksForBatch(client, {
    tenantId: TENANT_A,
    mappedRows: [{ fitterId: '106', ekUserId: EK_A }],
  });

  assert.equal(result.conflicts, 1);
  assert.equal(client.state.fitters[0].tenant_user_id || null, null);
  assert.equal(client.state.fitters[0].identity_link_conflict_reason, 'tenant_user_already_linked');
});

test('same email or EK GUID in another tenant is ignored by auto-link', async () => {
  const client = makeClient({
    users: [{ id: USER_A, tenant_id: TENANT_B, email: 'tech@example.dk', status: 'active', login_status: 'active', ek_user_id: EK_A }],
    fitters: [{ tenant_id: TENANT_A, fitter_id: '108', email: 'tech@example.dk', ek_user_id: EK_A, identity_link_status: 'unresolved', is_active_derived: true }],
  });

  const result = await resolveFitterIdentityLinksForBatch(client, {
    tenantId: TENANT_A,
    mappedRows: [{ fitterId: '108', ekUserId: EK_A }],
  });

  assert.equal(result.unresolved, 1);
  assert.equal(client.state.fitters[0].tenant_user_id || null, null);
});

test('same-tenant EK user GUID collision is marked conflict', async () => {
  const client = makeClient({
    users: [
      { id: USER_A, tenant_id: TENANT_A, email: 'tech@example.dk', status: 'active', login_status: 'active', ek_user_id: null },
      { id: USER_B, tenant_id: TENANT_A, email: 'other@example.dk', status: 'active', login_status: 'active', ek_user_id: EK_A },
    ],
    fitters: [{ tenant_id: TENANT_A, fitter_id: '109', email: 'tech@example.dk', ek_user_id: EK_A, identity_link_status: 'unresolved', is_active_derived: true }],
  });

  const result = await resolveFitterIdentityLinksForBatch(client, {
    tenantId: TENANT_A,
    mappedRows: [{ fitterId: '109', ekUserId: EK_A }],
  });

  assert.equal(result.conflicts, 1);
  assert.equal(client.state.fitters[0].identity_link_conflict_reason, 'ek_user_id_collision');
});

test('current-user fitter resolution returns only a tenant-scoped approved active link', async () => {
  const client = makeClient({
    users: [
      { id: USER_A, tenant_id: TENANT_A, email: 'tech@example.dk', status: 'active', login_status: 'active', ek_user_id: EK_A },
      { id: USER_A, tenant_id: TENANT_B, email: 'tech@example.dk', status: 'active', login_status: 'active', ek_user_id: EK_B },
    ],
    fitters: [
      { tenant_id: TENANT_A, fitter_id: '110', name: 'Tenant A fitter', email: 'tech@example.dk', tenant_user_id: USER_A, identity_link_status: 'auto_linked', identity_link_method: 'auto_email', is_active_derived: true },
      { tenant_id: TENANT_B, fitter_id: '210', name: 'Tenant B fitter', email: 'tech@example.dk', tenant_user_id: USER_A, identity_link_status: 'auto_linked', identity_link_method: 'auto_email', is_active_derived: true },
    ],
  });

  const linked = await resolveCurrentFitter(client, { tenantId: TENANT_A, tenantUserId: USER_A });
  assert.equal(linked.ek_fitter_id, '110');
  assert.equal(linked.name, 'Tenant A fitter');

  const unlinked = await resolveCurrentFitter(makeClient({
    users: [{ id: USER_A, tenant_id: TENANT_A, email: 'tech@example.dk', status: 'active', login_status: 'active', ek_user_id: null }],
    fitters: [],
  }), { tenantId: TENANT_A, tenantUserId: USER_A });
  assert.equal(unlinked, null);
});

test('sync, migration, tenant admin UI and worksheet access preserve identity boundaries', () => {
  const syncWorker = fs.readFileSync(path.join(__dirname, '../backend/src/services/syncWorker.js'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/0047_tenant_user_ek_fitter_identity.sql'), 'utf8');
  const worksheetService = fs.readFileSync(path.join(__dirname, '../backend/src/services/worksheetAssignmentService.js'), 'utf8');
  const tenantAuthRoutes = fs.readFileSync(path.join(__dirname, '../backend/src/routes/tenantAuthRoutes.js'), 'utf8');
  const tenantAdminRepository = fs.readFileSync(path.join(__dirname, '../backend/src/modules/tenantAdmin/tenantAdmin.repository.js'), 'utf8');
  const tenantUi = fs.readFileSync(path.join(__dirname, '../backend/src/public/tenant/auth.js'), 'utf8');

  assert.match(syncWorker, /UserID", "UserId", "userID", "userId"/);
  assert.match(syncWorker, /\$\$\{base \+ 39\}::uuid, \$\$\{base \+ 40\}::jsonb/);
  assert.match(syncWorker, /resolveFitterIdentityLinksForBatch/);
  assert.doesNotMatch(syncWorker, /project_assignment_source[\s\S]+fitterhours/);

  assert.match(migration, /ADD COLUMN IF NOT EXISTS ek_user_id uuid/);
  assert.match(migration, /uq_tenant_user_tenant_ek_user/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS ck_audit_event_event_type/);
  assert.match(migration, /ADD CONSTRAINT ck_audit_event_event_type/);
  assert.match(migration, /uq_fitter_identity_active_tenant_user/);
  assert.doesNotMatch(migration, /DELETE FROM fitter|DELETE FROM fitter_hour|TRUNCATE/i);

  assert.match(worksheetService, /JOIN tenant_user tu[\s\S]+tu\.tenant_id = f\.tenant_id[\s\S]+tu\.id = f\.tenant_user_id/);
  assert.match(tenantAuthRoutes, /router\.get\("\/api\/me", requireTenantHost, requireAuth\("access"\)/);
  assert.doesNotMatch(tenantAuthRoutes, /req\.body[\s\S]+fitter_id|req\.query[\s\S]+fitter_id/);

  assert.match(tenantAdminRepository, /fielddesk_login_linked/);
  assert.match(tenantUi, /Fielddesk login koblet/);
  assert.doesNotMatch(tenantUi, /tenant_user_ek_user_id|ek_user_id/);
});
