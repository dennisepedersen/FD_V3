'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { _test: gateTest } = require('../backend/src/services/igvaPocOnlineGate');

const routeSource = fs.readFileSync('backend/src/routes/tenantSurfaceRoutes.js', 'utf8');
const publicShell = [
  fs.readFileSync('backend/src/public/tenant/igva-poc.html', 'utf8'),
  fs.readFileSync('backend/src/public/tenant/igva-poc.js', 'utf8'),
].join('\\n');

function withGateEnabled(fn) {
  const previous = process.env.IGVA_POC_ONLINE_ENABLED;
  delete process.env.IGVA_POC_ONLINE_ENABLED;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env.IGVA_POC_ONLINE_ENABLED;
    else process.env.IGVA_POC_ONLINE_ENABLED = previous;
  }
}

test('IGVA online gate allows H&C + DEP identity for data/API access', () => {
  withGateEnabled(() => {
    assert.equal(gateTest.isAllowedTenant({ slug: 'hoyrup-clemmensen' }), true);
    assert.equal(gateTest.isAllowedUser({ username: 'dep' }), true);
    assert.equal(gateTest.isAllowedUser({ username: 'DEP' }), true);
  });
});

test('IGVA online gate denies H&C + another valid user for data/API access', () => {
  withGateEnabled(() => {
    assert.equal(gateTest.isAllowedTenant({ slug: 'hoyrup-clemmensen' }), true);
    assert.equal(gateTest.isAllowedUser({ username: 'other-user' }), false);
  });
});

test('IGVA online gate denies DEP username on another tenant', () => {
  withGateEnabled(() => {
    assert.equal(gateTest.isAllowedTenant({ slug: 'another-tenant' }), false);
    assert.equal(gateTest.isAllowedUser({ username: 'dep' }), true);
  });
});

test('IGVA online gate can be disabled by environment flag', () => {
  const previous = process.env.IGVA_POC_ONLINE_ENABLED;
  process.env.IGVA_POC_ONLINE_ENABLED = 'false';
  try {
    assert.equal(gateTest.isAllowedTenant({ slug: 'hoyrup-clemmensen' }), false);
  } finally {
    if (previous === undefined) delete process.env.IGVA_POC_ONLINE_ENABLED;
    else process.env.IGVA_POC_ONLINE_ENABLED = previous;
  }
});

test('IGVA project_ref accepts EK-style refs and rejects ambiguous input', () => {
  assert.equal(gateTest.normalizeProjectRefParam(' 80396-003 '), '80396-003');
  assert.equal(gateTest.normalizeProjectRefParam('80288-001-004'), '80288-001-004');
  assert.equal(gateTest.normalizeProjectRefParam(undefined), null);
  assert.throws(() => gateTest.normalizeProjectRefParam(['80396-003']), /invalid_igva_project_ref/);
  assert.throws(() => gateTest.normalizeProjectRefParam('../secrets'), /invalid_igva_project_ref/);
  assert.throws(() => gateTest.normalizeProjectRefParam('x'.repeat(65)), /invalid_igva_project_ref/);
});

test('IGVA online shell is tenant-gated but not user-authenticated under localStorage bearer auth', () => {
  assert.match(routeSource, /router\.get\("\/igva-poc", requireTenantHost, requireIgvaPocTenantShellAccess, sendTenantHtml/);
  assert.match(routeSource, /router\.get\("\/tenant\/igva-poc\.js", requireTenantHost, requireIgvaPocTenantShellAccess/);
  assert.doesNotMatch(routeSource, /router\.get\("\/igva-poc", requireTenantHost, requireAuth/);
  assert.doesNotMatch(routeSource, /router\.get\("\/tenant\/igva-poc\.js", requireTenantHost, requireAuth/);
});

test('IGVA online API uses server-side bearer auth, DEP allowlist and project_ref validation', () => {
  assert.match(routeSource, /router\.get\("\/api\/igva-poc\/projects", requireTenantHost, requireAuth\("access"\), requireIgvaPocOnlineAccess/);
  assert.match(routeSource, /normalizeProjectRefParam\(req\.query\.project_ref\)/);
  assert.match(routeSource, /includeEconomy: Boolean\(projectRef\)/);
  assert.match(routeSource, /igva_poc_project_not_found/);
});

test('IGVA online shell contains no embedded production project data or secrets', () => {
  assert.doesNotMatch(publicShell, /80396-003|80279-003|25906|20785|1958069|1105437/);
  assert.doesNotMatch(publicShell, /FielddeskLocal|DATABASE_URL|PGPASSWORD|api[_-]?key|secret|credential/i);
});