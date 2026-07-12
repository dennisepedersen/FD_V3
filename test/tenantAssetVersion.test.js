'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getTenantAssetVersion, versionTenantHtml } = require('../backend/src/utils/tenantAssetVersion');

test('tenant asset version prefers render git commit and sanitizes value', () => {
  const env = {
    RENDER_GIT_COMMIT: 'abc123 !@# deploy',
    RENDER_DEPLOY_ID: 'dep-later',
  };
  assert.equal(getTenantAssetVersion(env), 'abc123deploy');
});

test('tenant asset version falls back without producing empty undefined or null', () => {
  assert.equal(getTenantAssetVersion({}), 'dev');
  assert.equal(getTenantAssetVersion({ RENDER_GIT_COMMIT: '   ' }), 'dev');
  assert.notEqual(getTenantAssetVersion({ RENDER_GIT_COMMIT: 'null' }), '');
});

test('tenant html gets stable versioned auth asset URL', () => {
  const html = '<script src="/tenant/auth.js"></script><script src="/tenant/auth.js?v=old"></script>';
  const out = versionTenantHtml(html, { RENDER_GIT_COMMIT: 'commit/with space' });
  assert.equal(out, '<script src="/tenant/auth.js?v=commitwithspace"></script><script src="/tenant/auth.js?v=commitwithspace"></script>');
  assert.doesNotMatch(out, /v=(?:undefined|null)?["']/);
});