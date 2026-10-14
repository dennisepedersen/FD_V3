'use strict';

const { buildTenantAssetUrl, htmlEscape, renderFielddeskEmailFrame } = require('../../services/fielddeskEmailFrame');

function buildInviteEmail({ user, acceptUrl, expiresAt }) {
  const name = user.name || user.email;
  const expiresText = new Date(expiresAt).toLocaleString('da-DK');
  const logoUrl = buildTenantAssetUrl({ acceptUrl, assetPath: '/tenant/assets/FD_logo.png' });
  const text = [
    `Hej ${name}`,
    '',
    'Du er inviteret til at oprette din Fielddesk-adgang.',
    `Åbn linket, og vælg din adgangskode: ${acceptUrl}`,
    '',
    `Linket udløber ${expiresText}.`,
    'Hvis du ikke forventede denne invitation, kan du ignorere mailen.',
  ].join('\n');

  const safeName = htmlEscape(name);
  const safeUrl = htmlEscape(acceptUrl);
  const safeExpiresText = htmlEscape(expiresText);
  const html = renderFielddeskEmailFrame({ logoUrl, contentHtml:
    `<p style="margin:0 0 16px 0;font-size:16px;line-height:1.55;">Hej ${safeName}</p>
                  <p style="margin:0 0 18px 0;font-size:16px;line-height:1.55;">Du er inviteret til at oprette din Fielddesk-adgang.</p>
                  <p style="margin:0 0 24px 0;"><a href="${safeUrl}" style="display:inline-block;background:#2f6b4f;color:#ffffff;text-decoration:none;border-radius:10px;padding:12px 18px;font-weight:700;">Opret adgangskode</a></p>
                  <p style="margin:0 0 14px 0;font-size:14px;line-height:1.55;color:#4b5f53;">Linket udløber ${safeExpiresText}.</p>
                  <p style="margin:0;font-size:14px;line-height:1.55;color:#4b5f53;">Hvis knappen ikke virker, kan du kopiere dette link til din browser:<br><a href="${safeUrl}" style="color:#2f6b4f;word-break:break-all;">${safeUrl}</a></p>`
    });

  return {
    subject: 'Opret din Fielddesk-adgang',
    text,
    html,
  };
}

module.exports = {
  buildInviteEmail,
  buildTenantAssetUrl,
  htmlEscape,
};
