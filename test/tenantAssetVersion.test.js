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

test('tenant html gets stable versioned tenant asset URLs', () => {
  const html = [
    '<script src="/tenant/drawing-engine.js"></script>',
    '<script src="/tenant/project-equipment-cctv-drawing-adapter.js?v=old"></script>',
    '<script src="/tenant/auth.js"></script>',
    '<script src="/tenant/auth.js?v=old"></script>',
  ].join('');
  const out = versionTenantHtml(html, { RENDER_GIT_COMMIT: 'commit/with space' });
  assert.equal(out, [
    '<script src="/tenant/drawing-engine.js?v=commitwithspace"></script>',
    '<script src="/tenant/project-equipment-cctv-drawing-adapter.js?v=commitwithspace"></script>',
    '<script src="/tenant/auth.js?v=commitwithspace"></script>',
    '<script src="/tenant/auth.js?v=commitwithspace"></script>',
  ].join(''));
  assert.doesNotMatch(out, /v=(?:undefined|null)?["']/);
});