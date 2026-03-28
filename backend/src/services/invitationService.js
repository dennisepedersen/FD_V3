const crypto = require("crypto");
const pool = require("../db/pool");
const { withTransaction } = require("../db/tx");
const invitationQueries = require("../db/queries/invitation");
const tenantQueries = require("../db/queries/tenant");
const userQueries = require("../db/queries/user");
const auditQueries = require("../db/queries/audit");
const { hashPassword } = require("./passwordService");
const { issueOnboardingToken } = require("./jwtService");

function hashInvitationToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function validateAcceptInput(input) {
  const required = ["token", "full_name", "password", "tenant_slug", "tenant_name", "tenant_domain"];
  for (const key of required) {
    if (!input[key] || String(input[key]).trim() === "") {
      throw Object.assign(new Error(`Missing field: ${key}`), { statusCode: 400 });
    }
  }
}

async function acceptInvitation(input) {
  validateAcceptInput(input);

  const tokenHash = hashInvitationToken(input.token);

  try {
    return await withTransaction(async (client) => {
      const invitation = await invitationQueries.findInvitationByTokenHashForUpdate(client, tokenHash);

      if (!invitation) {
        throw Object.assign(new Error("Invitation not found"), { statusCode: 403 });
      }

      if (invitation.status !== "pending") {
        throw Object.assign(new Error("Invitation is not pending"), { statusCode: 403 });
      }

      if (invitation.revoked_at) {
        throw Object.assign(new Error("Invitation is revoked"), { statusCode: 403 });
      }

      if (new Date(invitation.expires_at).getTime() <= Date.now()) {
        throw Object.assign(new Error("Invitation has expired"), { statusCode: 403 });
      }

      const tenant = await tenantQueries.createTenant(client, {
        slug: input.tenant_slug.toLowerCase(),
        name: input.tenant_name.trim(),
      });

      await tenantQueries.createTenantDomain(client, {
        tenantId: tenant.id,
        domain: input.tenant_domain.toLowerCase(),
        verified: false,
        active: false,
      });

      const passwordHash = await hashPassword(input.password);
      const user = await userQueries.createTenantAdminUser(client, {
        tenantId: tenant.id,
        email: invitation.email,
        name: input.full_name.trim(),
        passwordHash,
      });

      await invitationQueries.markInvitationAccepted(client, {
        invitationId: invitation.id,
        tenantId: tenant.id,
      });

      await auditQueries.insertAuditEvent(client, {
        actorId: user.id,
        actorScope: "tenant",
        tenantId: tenant.id,
        eventType: "invitation_accepted",
        targetType: "tenant_invitation",
        targetId: invitation.id,
        outcome: "success",
        reason: "invitation_accept_success",
        metadata: {
          tenant_slug: tenant.slug,
          tenant_domain: input.tenant_domain.toLowerCase(),
        },
      });

      const onboardingToken = issueOnboardingToken({
        userId: user.id,
        tenantId: tenant.id,
        role: user.role,
        email: user.email,
      });

      return {
        tenant_id: tenant.id,
        onboarding_token: onboardingToken,
      };
    });
  } catch (error) {
    const client = await pool.connect();
    try {
      try {
        await auditQueries.insertAuditEvent(client, {
          actorId: "system:invitation_accept",
          actorScope: "system",
          tenantId: null,
          eventType: "invitation_accepted",
          targetType: "tenant_invitation",
          targetId: tokenHash,
          outcome: "fail",
          reason: "invitation_accept_fail",
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
  acceptInvitation,
};
