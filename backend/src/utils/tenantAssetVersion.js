'use strict';

function getTenantAssetVersion(env = process.env) {
  const raw = env.RENDER_GIT_COMMIT
    || env.SOURCE_VERSION
    || env.COMMIT_SHA
    || env.RENDER_DEPLOY_ID
    || env.npm_package_version
    || 'dev';
  return String(raw).trim().replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64) || 'dev';
}

function versionTenantHtml(html, env = process.env) {
  const version = encodeURIComponent(getTenantAssetVersion(env));
  return String(html)
    .replace(/\/tenant\/drawing-engine\.js(?:\?v=[^"']*)?/g, `/tenant/drawing-engine.js?v=${version}`)
    .replace(/\/tenant\/project-equipment-cctv-drawing-adapter\.js(?:\?v=[^"']*)?/g, `/tenant/project-equipment-cctv-drawing-adapter.js?v=${version}`)
    .replace(/\/tenant\/project-restarbejde-drawing-adapter\.js(?:\?v=[^"']*)?/g, `/tenant/project-restarbejde-drawing-adapter.js?v=${version}`)
    .replace(/\/tenant\/auth\.js(?:\?v=[^"']*)?/g, `/tenant/auth.js?v=${version}`);
}

module.exports = {
  getTenantAssetVersion,
  versionTenantHtml,
};
