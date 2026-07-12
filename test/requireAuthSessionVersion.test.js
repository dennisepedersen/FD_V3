'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://example.invalid/fielddesk_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const requireAuthPath = require.resolve('../backend/src/middleware/requireAuth');
const TENANT_ID = 'tenant-1';
const USER_ID = 'user-1';

function makeUser(overrides = {}) {
  return {
    id: USER_ID,
    tenant_id: TENANT_ID,
    email: 'user@example.test',
    role: 'technician',
    status: 'active',
    login_status: 'active',
    session_version: 0,
    ...overrides,
  };
}

function makePayload(overrides = {}) {
  return {
    sub: USER_ID,
    tenant_id: TENANT_ID,
    role: 'technician',
    email: 'user@example.test',
    session_version: 0,
    type: 'access',
    ...overrides,
  };
}

function loadMiddleware({ payload, user }) {
  delete require.cache[requireAuthPath];

  const calls = {
    released: false,
    lookupArgs: null,
  };
  const fakeClient = {
    release() {
      calls.released = true;
    },
  };
  const fakePool = {
    async connect() {
      return fakeClient;
    },
  };
  const fakeUserQueries = {
    async findSessionTenantUserById(client, args) {
      assert.equal(client, fakeClient);
      calls.lookupArgs = args;
      return user;
    },
  };
  const fakeJwtService = {
    verifyToken(token, expectedType) {
      assert.equal(token, 'test-token');
      assert.equal(expectedType, 'access');
      return payload;
    },
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (parent && parent.filename === requireAuthPath) {
      if (request === '../db/pool') return fakePool;
      if (request === '../db/queries/user') return fakeUserQueries;
      if (request === '../services/jwtService') return fakeJwtService;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return { middleware: require(requireAuthPath)('access'), calls };
  } finally {
    Module._load = originalLoad;
  }
}

async function runAccessAuth({ payload = makePayload(), user = makeUser() }) {
  const { middleware, calls } = loadMiddleware({ payload, user });
  const req = { headers: { authorization: 'Bearer test-token' } };
  let nextError;

  await middleware(req, {}, (error) => {
    nextError = error || null;
  });

  return { req, nextError, calls };
}

async function assertAccepted({ dbVersion, tokenVersion, expectedVersion = Number(dbVersion ?? 0) }) {
  const result = await runAccessAuth({
    user: makeUser({ session_version: dbVersion }),
    payload: makePayload({ session_version: tokenVersion }),
  });

  assert.equal(result.nextError, null);
  assert.equal(result.req.auth.session_version, expectedVersion);
  assert.deepEqual(result.calls.lookupArgs, { tenantId: TENANT_ID, userId: USER_ID });
  assert.equal(result.calls.released, true);
}

async function assertRejected({ dbVersion = 0, tokenVersion, user = makeUser({ session_version: dbVersion }), message = 'session_revoked', payload }) {
  const tokenPayload = payload || (Object.prototype.hasOwnProperty.call(arguments[0], 'tokenVersion')
    ? makePayload({ session_version: tokenVersion })
    : (() => {
      const value = makePayload();
      delete value.session_version;
      return value;
    })());
  const result = await runAccessAuth({ user, payload: tokenPayload });

  assert.ok(result.nextError);
  assert.equal(result.nextError.statusCode, 401);
  assert.equal(result.nextError.message, message);
  assert.equal(result.calls.released, true);
}

test('access auth accepts DB session_version 0 with JWT session_version 0', async () => {
  await assertAccepted({ dbVersion: 0, tokenVersion: 0 });
});

test('access auth accepts numeric string JWT session_version 0', async () => {
  await assertAccepted({ dbVersion: 0, tokenVersion: '0', expectedVersion: 0 });
});

test('access auth accepts DB session_version 1 with JWT session_version 1', async () => {
  await assertAccepted({ dbVersion: 1, tokenVersion: 1 });
});

test('access auth rejects stale JWT session_version after DB version bump', async () => {
  await assertRejected({ dbVersion: 1, tokenVersion: 0 });
});

test('access auth rejects missing JWT session_version', async () => {
  await assertRejected({ dbVersion: 0 });
});

test('access auth rejects null JWT session_version', async () => {
  await assertRejected({ dbVersion: 0, tokenVersion: null });
});

test('access auth rejects non-numeric JWT session_version', async () => {
  await assertRejected({ dbVersion: 0, tokenVersion: 'not-a-number' });
});

test('access auth rejects fractional JWT session_version', async () => {
  await assertRejected({ dbVersion: 0, tokenVersion: 0.5 });
});

test('access auth rejects inactive users before session-version comparison', async () => {
  await assertRejected({
    user: makeUser({ status: 'deactivated', login_status: 'disabled', session_version: 0 }),
    tokenVersion: 0,
    message: 'tenant_user_inactive',
  });
});

test('access auth rejects wrong tenant or missing user before session-version comparison', async () => {
  await assertRejected({
    user: makeUser({ tenant_id: 'other-tenant', session_version: 0 }),
    tokenVersion: 0,
    message: 'tenant_user_not_found',
  });
  await assertRejected({
    user: null,
    tokenVersion: 0,
    message: 'tenant_user_not_found',
  });
});