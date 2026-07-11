'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

test('tenant admin invite checkbox flow keeps create before invite and validates response target', () => {
  const auth = read('backend/src/public/tenant/auth.js');
  const createIndex = auth.indexOf('apiFetch("/api/tenant/admin/users"');
  const inviteIndex = auth.indexOf('sendTenantAdminUserInvite(createdUser');
  assert.ok(createIndex > -1);
  assert.ok(inviteIndex > createIndex);
  assert.match(auth, /const shouldSendInvite = Boolean/);
  assert.match(auth, /createdUser\.tenant_user_id \|\| createdUser\.fitter_row_id/);
  assert.match(auth, /Brugeren blev oprettet, men oprettelseslinket kunne ikke sendes/);
});

test('public tenant files do not expose invitation storage fields', () => {
  const publicText = [
    read('backend/src/public/tenant/auth.js'),
    read('backend/src/public/tenant/accept-invite.html'),
    read('backend/src/public/tenant/app.html'),
  ].join('\n');
  assert.doesNotMatch(publicText, /token_hash|accept_url/);
});

test('sync worker is disabled in NODE_ENV=test to keep checks DB-free', () => {
  const worker = read('backend/src/services/syncWorker.js');
  assert.match(worker, /env\.NODE_ENV === "test"/);
});