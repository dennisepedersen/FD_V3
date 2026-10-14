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

function renderFielddeskEmailFrame({ logoUrl, contentHtml }) {
  const safeLogoUrl = htmlEscape(logoUrl);
  return `
    <div style="margin:0;padding:0;background:#f6f8f5;color:#0e1018;font-family:Inter,Arial,sans-serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f6f8f5;margin:0;padding:0;">
        <tr>
          <td align="center" style="padding:32px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:560px;background:#ffffff;border:1px solid #dde5dc;border-radius:18px;">
              <tr>
                <td style="padding:32px 32px 28px 32px;">
                  <img src="${safeLogoUrl}" width="220" alt="Fielddesk" style="display:block;width:220px;max-width:100%;height:auto;margin:0 0 28px 0;">
                  ${contentHtml}
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;
}

module.exports = { buildTenantAssetUrl, htmlEscape, renderFielddeskEmailFrame };
