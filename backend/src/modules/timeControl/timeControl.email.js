"use strict";

const { buildTenantAssetUrl, htmlEscape, renderFielddeskEmailFrame } = require("../../services/fielddeskEmailFrame");

const TEMPLATE_KEYS = new Set([
  "time_control.missing_hours.employee", "time_control.employee_weekly_reminder_v1",
  "time_control.friday_weekly_summary_v1", "time_control.friday_manager_summary", "time_control.internal_error",
]);

function renderTimeControlHtml({ html, text, origin }) {
  const content = html || htmlEscape(text).split(/\n\s*\n/)
    .map(part => `<p>${part.replace(/\n/g, "<br>")}</p>`).join("");
  const contentHtml = content
    .replace(/<p>/g, '<p style="margin:0 0 16px 0;font-size:16px;line-height:1.55;white-space:pre-line;overflow-wrap:anywhere;">');
  const frame = renderFielddeskEmailFrame({ contentHtml,
    logoUrl: buildTenantAssetUrl({ acceptUrl: origin, assetPath: "/tenant/assets/FD_logo.png" }) });
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:0;">${frame}</body></html>`;
}

async function brandTimeControlEmail(client, { tenantId, rendered, rootDomain }) {
  const { rows } = await client.query("SELECT slug FROM tenant WHERE id = $1", [tenantId]);
  const slug = rows[0]?.slug;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug || "") ||
      !/^[a-z0-9.-]+$/.test(rootDomain || "")) throw new Error("time_control_email_origin_invalid");
  return { ...rendered, html: renderTimeControlHtml({ ...rendered, origin: `https://${slug}.${rootDomain}` }) };
}

module.exports = { TEMPLATE_KEYS, brandTimeControlEmail, renderTimeControlHtml };
