async function resolveActiveTenantBySlugAndHost(client, { slug, host }) {
  const sql = `
    SELECT
      t.id,
      t.slug,
      t.name,
      t.status,
      td.domain,
      td.verified,
      td.active
    FROM tenant t
    JOIN tenant_domain td ON td.tenant_id = t.id
    WHERE lower(t.slug) = lower($1)
      AND lower(td.domain) = lower($2)
    LIMIT 1
  `;

  const { rows } = await client.query(sql, [slug, host]);
  return rows[0] || null;
}

async function createTenant(client, { slug, name }) {
  const sql = `
    INSERT INTO tenant (slug, name, status)
    VALUES ($1, $2, 'onboarding')
    RETURNING id, slug, name, status
  `;
  const { rows } = await client.query(sql, [slug, name]);
  return rows[0];
}

async function createTenantDomain(client, { tenantId, domain, verified, active }) {
  const sql = `
    INSERT INTO tenant_domain (tenant_id, domain, verified, active)
    VALUES ($1, $2, $3, $4)
    RETURNING id, tenant_id, domain, verified, active
  `;
  const { rows } = await client.query(sql, [tenantId, domain, verified, active]);
  return rows[0];
}

async function getTenantForUpdate(client, tenantId) {
  const { rows } = await client.query(
    `SELECT id, slug, name, status FROM tenant WHERE id = $1 FOR UPDATE`,
    [tenantId]
  );
  return rows[0] || null;
}

async function getTenantDomainForUpdate(client, tenantId) {
  const { rows } = await client.query(
    `SELECT id, tenant_id, domain, verified, active
     FROM tenant_domain
     WHERE tenant_id = $1
     ORDER BY created_at ASC
     LIMIT 1
     FOR UPDATE`,
    [tenantId]
  );
  return rows[0] || null;
}

async function activateTenant(client, tenantId) {
  await client.query(
    `UPDATE tenant
     SET status = 'active', updated_at = now()
     WHERE id = $1`,
    [tenantId]
  );
}

async function activateAndVerifyTenantDomain(client, tenantId) {
  await client.query(
    `UPDATE tenant_domain
     SET verified = true, active = true, updated_at = now()
     WHERE tenant_id = $1`,
    [tenantId]
  );
}

module.exports = {
  resolveActiveTenantBySlugAndHost,
  createTenant,
  createTenantDomain,
  getTenantForUpdate,
  getTenantDomainForUpdate,
  activateTenant,
  activateAndVerifyTenantDomain,
};
