#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { repoRoot } = require('./lib/file-utils');

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

const files = {
  routes: read('backend/src/routes/tenantSurfaceRoutes.js'),
  assetVersion: read('backend/src/utils/tenantAssetVersion.js'),
  invitationService: read('backend/src/modules/tenantAdmin/tenantUserInvitation.service.js'),
  invitationEmail: read('backend/src/modules/tenantAdmin/tenantUserInvitationEmail.js'),
  auth: read('backend/src/public/tenant/auth.js'),
  accept: read('backend/src/public/tenant/accept-invite.html'),
  app: read('backend/src/app.js'),
  syncWorker: read('backend/src/services/syncWorker.js'),
};

const assertions = [
  ['tenant asset helper imported by routes', files.routes.includes('../utils/tenantAssetVersion')],
  ['asset version uses Render commit/deploy fallbacks', files.assetVersion.includes('RENDER_GIT_COMMIT') && files.assetVersion.includes('RENDER_DEPLOY_ID')],
  ['asset version is URL-encoded in HTML', files.assetVersion.includes('encodeURIComponent(getTenantAssetVersion')],
  ['HTML no-cache header exists', files.routes.includes('no-cache, must-revalidate')],
  ['versioned auth.js immutable header exists', files.routes.includes('public, max-age=31536000, immutable')],
  ['unversioned auth.js remains no-cache', files.routes.includes('req.query && req.query.v') && files.routes.includes('no-cache, must-revalidate')],
  ['accept invite logo remains', files.accept.includes('/tenant/assets/FD_logo.png')],
  ['accept invite form eyebrow removed', !files.accept.includes('<p class="eyebrow">Fielddesk</p>')],
  ['password minimum visible and backend constant 10', files.accept.includes('Adgangskoden skal v&aelig;re mindst 10 tegn.') && files.invitationService.includes('MIN_PASSWORD_LENGTH = 10')],
  ['checkbox flow reads state before reset', files.auth.indexOf('const shouldSendInvite = Boolean') > -1 && files.auth.indexOf('const shouldSendInvite = Boolean') < files.auth.indexOf('resetTenantAdminUserCreateForm();', files.auth.indexOf('async function submitTenantAdminUserCreate'))],
  ['checkbox create happens before invite', files.auth.indexOf('apiFetch("/api/tenant/admin/users"') < files.auth.indexOf('sendTenantAdminUserInvite(createdUser')],
  ['created invite target is validated', files.auth.includes('createdUser.tenant_user_id || createdUser.fitter_row_id')],
  ['partial invite failure message exists', files.auth.includes('Brugeren blev oprettet, men oprettelseslinket kunne ikke sendes')],
  ['mailtemplate has HTML and text fallback', files.invitationEmail.includes('html = `') && files.invitationEmail.includes("join('\\n')")],
  ['mailtemplate logo uses tenant origin helper', files.invitationEmail.includes('buildTenantAssetUrl') && files.invitationEmail.includes('/tenant/assets/FD_logo.png')],
  ['sync worker is disabled in NODE_ENV=test', files.syncWorker.includes('env.NODE_ENV === "test"')],
  ['app import starts worker only through startSyncWorker call', files.app.includes('startSyncWorker();')],
  ['public tenant surface does not contain token_hash or accept_url', !/token_hash|accept_url/.test(files.auth + files.accept + files.app)],
];

const failed = assertions.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error('Static assertions: FAIL');
  failed.forEach((name) => console.error(`- ${name}`));
  process.exit(1);
}
console.log(`Static assertions: pass (${assertions.length} assertions)`);