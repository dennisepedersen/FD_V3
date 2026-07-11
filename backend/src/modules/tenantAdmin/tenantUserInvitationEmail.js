'use strict';

function htmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildTenantAssetUrl({ acceptUrl, assetPath }) {
  const origin = new URL(acceptUrl).origin;
  const normalizedPath = String(assetPath || '').replace(/^\/+/, '');
  return `${origin}/${normalizedPath}`;
}

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
  const safeLogoUrl = htmlEscape(logoUrl);
  const safeExpiresText = htmlEscape(expiresText);
  const html = `
    <div style="margin:0;padding:0;background:#f6f8f5;color:#0e1018;font-family:Inter,Arial,sans-serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f6f8f5;margin:0;padding:0;">
        <tr>
          <td align="center" style="padding:32px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:560px;background:#ffffff;border:1px solid #dde5dc;border-radius:18px;">
              <tr>
                <td style="padding:32px 32px 28px 32px;">
                  <img src="${safeLogoUrl}" width="220" alt="Fielddesk" style="display:block;width:220px;max-width:100%;height:auto;margin:0 0 28px 0;">
                  <p style="margin:0 0 16px 0;font-size:16px;line-height:1.55;">Hej ${safeName}</p>
                  <p style="margin:0 0 18px 0;font-size:16px;line-height:1.55;">Du er inviteret til at oprette din Fielddesk-adgang.</p>
                  <p style="margin:0 0 24px 0;"><a href="${safeUrl}" style="display:inline-block;background:#2f6b4f;color:#ffffff;text-decoration:none;border-radius:10px;padding:12px 18px;font-weight:700;">Opret adgangskode</a></p>
                  <p style="margin:0 0 14px 0;font-size:14px;line-height:1.55;color:#4b5f53;">Linket udløber ${safeExpiresText}.</p>
                  <p style="margin:0;font-size:14px;line-height:1.55;color:#4b5f53;">Hvis knappen ikke virker, kan du kopiere dette link til din browser:<br><a href="${safeUrl}" style="color:#2f6b4f;word-break:break-all;">${safeUrl}</a></p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;

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