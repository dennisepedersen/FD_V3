'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInviteEmail, buildTenantAssetUrl, htmlEscape } = require('../backend/src/modules/tenantAdmin/tenantUserInvitationEmail');

test('invitation email renders branded HTML and text fallback without leaking token into logo URL', () => {
  const acceptUrl = 'https://hoyrup-clemmensen.fielddesk.dk/accept-invite?token=dummy-token';
  const email = buildInviteEmail({
    user: { name: 'Test Bruger', email: 'test@example.com' },
    acceptUrl,
    expiresAt: '2026-07-15T12:00:00.000Z',
  });

  assert.equal(email.subject, 'Opret din Fielddesk-adgang');
  assert.match(email.text, /Åbn linket, og vælg din adgangskode:/);
  assert.match(email.text, /Linket udløber/);
  assert.match(email.html, /https:\/\/hoyrup-clemmensen\.fielddesk\.dk\/tenant\/assets\/FD_logo\.png/);
  assert.doesNotMatch(email.html.match(/FD_logo\.png[^"<]*/)[0], /token=/);
  assert.match(email.html, /alt="Fielddesk"/);
  assert.match(email.html, /max-width:100%/);
  assert.match(email.html, /Opret adgangskode/);
  assert.match(email.html, /accept-invite\?token=dummy-token/);
});

test('tenant asset URL uses the accept URL origin', () => {
  assert.equal(
    buildTenantAssetUrl({ acceptUrl: 'https://tenant.example.test/accept-invite?token=x', assetPath: '/tenant/assets/FD_logo.png' }),
    'https://tenant.example.test/tenant/assets/FD_logo.png'
  );
});

test('email HTML escaping protects display fields', () => {
  assert.equal(htmlEscape('<Dennis & Fielddesk>'), '&lt;Dennis &amp; Fielddesk&gt;');
});