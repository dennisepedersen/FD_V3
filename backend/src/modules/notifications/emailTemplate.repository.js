"use strict";

function normalizeAllowedVariables(value) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function assertTenantOverrideAllowed(row) {
  if (!row || !row.tenant_id) return row;
  const systemAllowed = normalizeAllowedVariables(row.system_allowed_variables_json);
  if (systemAllowed.length === 0) {
    throw new Error(`email_template_system_template_required:${row.template_key}:${row.locale}`);
  }
  const systemSet = new Set(systemAllowed);
  for (const variable of normalizeAllowedVariables(row.allowed_variables_json)) {
    if (!systemSet.has(variable)) {
      throw new Error(`email_template_override_variable_not_allowed:${variable}`);
    }
  }
  const { system_allowed_variables_json: _ignored, ...template } = row;
  return template;
}

async function findActiveTemplate(client, { tenantId, templateKey, locale = "da-DK" }) {
  const { rows } = await client.query(
    `
      SELECT
        candidate.id,
        candidate.tenant_id,
        candidate.template_key,
        candidate.locale,
        candidate.version,
        candidate.is_active,
        candidate.subject_template,
        candidate.html_template,
        candidate.text_template,
        candidate.allowed_variables_json,
        system_template.allowed_variables_json AS system_allowed_variables_json,
        candidate.created_at,
        candidate.updated_at
      FROM email_template candidate
      LEFT JOIN email_template system_template
        ON system_template.tenant_id IS NULL
       AND system_template.template_key = candidate.template_key
       AND system_template.locale = candidate.locale
       AND system_template.is_active = true
      WHERE candidate.template_key = $2
        AND candidate.locale = $3
        AND candidate.is_active = true
        AND (candidate.tenant_id = $1 OR candidate.tenant_id IS NULL)
      ORDER BY
        CASE WHEN candidate.tenant_id = $1 THEN 0 ELSE 1 END,
        candidate.version DESC
      LIMIT 1
    `,
    [tenantId, templateKey, locale]
  );

  return assertTenantOverrideAllowed(rows[0] || null);
}

module.exports = {
  _test: {
    assertTenantOverrideAllowed,
  },
  findActiveTemplate,
};