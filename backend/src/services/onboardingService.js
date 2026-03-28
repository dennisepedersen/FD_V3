const crypto = require("crypto");
const env = require("../config/env");
const pool = require("../db/pool");
const { withTransaction } = require("../db/tx");
const tenantQueries = require("../db/queries/tenant");
const auditQueries = require("../db/queries/audit");

function encryptionKey() {
  return crypto.createHash("sha256").update(env.JWT_SECRET).digest();
}

function encryptSecret(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

async function getOnboardingState(tenantId) {
  const client = await pool.connect();
  try {
    const tenant = await tenantQueries.getTenantForUpdate(client, tenantId);
    if (!tenant) {
      throw Object.assign(new Error("Tenant not found"), { statusCode: 404 });
    }

    const domain = await tenantQueries.getTenantDomainForUpdate(client, tenantId);
    if (!domain) {
      throw Object.assign(new Error("Tenant domain not found"), { statusCode: 404 });
    }

    if (tenant.status !== "onboarding") {
      throw Object.assign(new Error("Tenant is not in onboarding"), { statusCode: 403 });
    }

    return {
      tenant_id: tenant.id,
      tenant_status: tenant.status,
      domain: domain.domain,
      domain_verified: domain.verified,
      domain_active: domain.active,
    };
  } finally {
    client.release();
  }
}

async function completeOnboarding({ tenantId, actorId, ekBaseUrl, ekApiKey }) {
  try {
    return await withTransaction(async (client) => {
      const tenant = await tenantQueries.getTenantForUpdate(client, tenantId);
      if (!tenant) {
        throw Object.assign(new Error("Tenant not found"), { statusCode: 404 });
      }

      if (tenant.status !== "onboarding") {
        throw Object.assign(new Error("Tenant is not in onboarding"), { statusCode: 403 });
      }

      const domain = await tenantQueries.getTenantDomainForUpdate(client, tenantId);
      if (!domain) {
        throw Object.assign(new Error("Tenant domain not found"), { statusCode: 404 });
      }

      const encryptedApiKey = encryptSecret(ekApiKey);

      await client.query(
        `INSERT INTO tenant_config (tenant_id, ek_base_url, ek_api_key_encrypted, status)
         VALUES ($1, $2, $3, 'configured')
         ON CONFLICT (tenant_id)
         DO UPDATE SET
           ek_base_url = EXCLUDED.ek_base_url,
           ek_api_key_encrypted = EXCLUDED.ek_api_key_encrypted,
           status = 'configured',
           updated_at = now()`,
        [tenantId, ekBaseUrl, encryptedApiKey]
      );

      await client.query(
        `INSERT INTO tenant_config_snapshot (
          tenant_id,
          changed_by_actor_id,
          changed_by_actor_scope,
          config_snapshot,
          reason
        ) VALUES ($1, $2, 'tenant', $3::jsonb, $4)`,
        [
          tenantId,
          actorId,
          JSON.stringify({
            ek_base_url: ekBaseUrl,
            ek_api_key_encrypted: "stored",
          }),
          "onboarding_complete",
        ]
      );

      await tenantQueries.activateTenant(client, tenantId);
      await tenantQueries.activateAndVerifyTenantDomain(client, tenantId);

      await auditQueries.insertAuditEvent(client, {
        actorId,
        actorScope: "tenant",
        tenantId,
        eventType: "tenant_config_changed",
        targetType: "tenant_config",
        targetId: tenantId,
        outcome: "success",
        reason: "onboarding_complete_success",
        metadata: { ek_base_url: ekBaseUrl },
      });

      await auditQueries.insertAuditEvent(client, {
        actorId,
        actorScope: "tenant",
        tenantId,
        eventType: "tenant_status_changed",
        targetType: "tenant",
        targetId: tenantId,
        outcome: "success",
        reason: "onboarding_complete_success",
        metadata: {
          from_status: "onboarding",
          to_status: "active",
        },
      });

      return {
        tenant_id: tenantId,
        tenant_login_url: `https://${domain.domain}/login`,
      };
    });
  } catch (error) {
    const client = await pool.connect();
    try {
      try {
        await auditQueries.insertAuditEvent(client, {
          actorId: actorId || "system:onboarding",
          actorScope: actorId ? "tenant" : "system",
          tenantId,
          eventType: "tenant_status_changed",
          targetType: "tenant",
          targetId: tenantId,
          outcome: "fail",
          reason: "onboarding_complete_fail",
          metadata: {},
        });
      } catch (auditError) {
        // Preserve primary flow error if audit write fails.
      }
    } finally {
      client.release();
    }
    throw error;
  }
}

module.exports = {
  getOnboardingState,
  completeOnboarding,
};
