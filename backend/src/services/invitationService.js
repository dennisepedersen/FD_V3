const crypto = require("crypto");
const pool = require("../db/pool");
const { withTransaction } = require("../db/tx");
const invitationQueries = require("../db/queries/invitation");
const onboardingQueries = require("../db/queries/onboarding");
const auditQueries = require("../db/queries/audit");
const { issueOnboardingToken } = require("./jwtService");

function hashInvitationToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateInvitationToken() {
  return crypto.randomBytes(32).toString("hex");
}

function isRawPlaceholder(value) {
  return typeof value === "string" && /^\{\{[^{}]+\}\}$/.test(value.trim());
}

function ensureNoRawPlaceholder(value, fieldName) {
  if (isRawPlaceholder(value)) {
    const error = new Error("invalid_placeholder_value");
    error.statusCode = 400;
    error.details = { field: fieldName };
    throw error;
  }
}

function validateCreateInput(input) {
  if (!input.email || String(input.email).trim() === "") {
    throw Object.assign(new Error("Missing field: email"), { statusCode: 400 });
  }

  ensureNoRawPlaceholder(input.email, "email");
  ensureNoRawPlaceholder(input.companyName, "company_name");
  ensureNoRawPlaceholder(input.desiredSlug, "desired_slug");
  ensureNoRawPlaceholder(input.adminName, "admin_name");
  ensureNoRawPlaceholder(input.invitationNote, "invitation_note");

  if (input.desiredSlug && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(String(input.desiredSlug).trim().toLowerCase())) {
    throw Object.assign(new Error("desired_slug format is invalid"), { statusCode: 400 });
  }
}

function parseExpiresAt(expiresAt, expiresInHours) {
  if (expiresAt) {
    const parsed = new Date(expiresAt);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      throw Object.assign(new Error("expires_at must be a valid future datetime"), { statusCode: 400 });
    }
    return parsed;
  }

  const ttlHours = Number.isInteger(expiresInHours) && expiresInHours > 0 ? expiresInHours : 72;
  return new Date(Date.now() + ttlHours * 60 * 60 * 1000);
}

function validateAcceptInput(input) {
  if (!input.token || String(input.token).trim() === "") {
    throw Object.assign(new Error("Missing field: token"), { statusCode: 400 });
  }
}

async function createInvitation({
  email,
  actorId,
  authSource,
  expiresInHours,
  expiresAt,
  companyName,
  desiredSlug,
  adminName,
  allowSkipEk,
  invitationNote,
}) {
  validateCreateInput({ email, companyName, desiredSlug, adminName, invitationNote });

  const token = generateInvitationToken();
  const tokenHash = hashInvitationToken(token);
  const expiry = parseExpiresAt(expiresAt, expiresInHours);

  try {
    const result = await withTransaction(async (client) => {
      const invitation = await invitationQueries.createInvitation(client, {
        email,
        tokenHash,
        expiresAt: expiry,
        companyName: companyName ? String(companyName).trim() : null,
        desiredSlug: desiredSlug ? String(desiredSlug).trim().toLowerCase() : null,
        adminName: adminName ? String(adminName).trim() : null,
        allowSkipEk: Boolean(allowSkipEk),
        invitationNote: invitationNote ? String(invitationNote).trim() : null,
      });

      await auditQueries.insertAuditEvent(client, {
        actorId,
        actorScope: "global",
        tenantId: null,
        eventType: "onboarding_created",
        targetType: "tenant_invitation",
        targetId: invitation.id,
        outcome: "success",
        reason: "onboarding_invitation_created",
        metadata: {
          email: invitation.email,
          expires_at: invitation.expires_at,
          company_name: invitation.company_name,
          desired_slug: invitation.desired_slug,
          admin_name: invitation.admin_name,
          allow_skip_ek: invitation.allow_skip_ek,
          auth_source: authSource || "unknown",
        },
      });

      return invitation;
    });

    return {
      invitation_id: result.id,
      email: result.email,
      expires_at: result.expires_at,
      company_name: result.company_name,
      desired_slug: result.desired_slug,
      admin_name: result.admin_name,
      allow_skip_ek: result.allow_skip_ek,
      invitation_note: result.invitation_note,
      token,
    };
  } catch (error) {
    if (error && error.code === "23505") {
      throw Object.assign(new Error("Pending invitation already exists for email"), { statusCode: 409 });
    }
    throw error;
  }
}

async function listInvitations({ status } = {}) {
  const client = await pool.connect();
  try {
    return await invitationQueries.listInvitations(client, { status });
  } finally {
    client.release();
  }
}

async function getInvitationStatus(invitationId) {
  const client = await pool.connect();
  try {
    return await invitationQueries.getInvitationStatusById(client, invitationId);
  } finally {
    client.release();
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
        throw Object.assign(new Error("Invitation has already been used"), { statusCode: 403 });
      }

      if (invitation.revoked_at) {
        throw Object.assign(new Error("Invitation is revoked"), { statusCode: 403 });
      }

      if (new Date(invitation.expires_at).getTime() <= Date.now()) {
        throw Object.assign(new Error("Invitation has expired"), { statusCode: 403 });
      }

      let session = await onboardingQueries.getOnboardingSessionForUpdate(client, invitation.id);

      if (session && session.status !== "started") {
        throw Object.assign(new Error("Invitation has already been used"), { statusCode: 403 });
      }

      if (!session) {
        session = await onboardingQueries.createOnboardingSession(client, {
          invitationId: invitation.id,
          email: invitation.email,
          invitationData: {
            company_name: invitation.company_name || null,
            desired_slug: invitation.desired_slug || null,
            admin_name: invitation.admin_name || null,
            allow_skip_ek: Boolean(invitation.allow_skip_ek),
            invitation_note: invitation.invitation_note || null,
            expires_at: invitation.expires_at,
          },
        });

        await auditQueries.insertAuditEvent(client, {
          actorId: invitation.id,
          actorScope: "global",
          tenantId: null,
          eventType: "onboarding_started",
          targetType: "onboarding_session",
          targetId: session.id,
          outcome: "success",
          reason: "onboarding_session_started",
          metadata: {
            invitation_id: invitation.id,
            email: invitation.email,
            allow_skip_ek: Boolean(invitation.allow_skip_ek),
          },
        });
      }

      const onboardingToken = issueOnboardingToken({
        invitationId: invitation.id,
        email: invitation.email,
      });

      await auditQueries.insertAuditEvent(client, {
        actorId: invitation.id,
        actorScope: "global",
        tenantId: invitation.tenant_id || null,
        eventType: "invitation_accept_success",
        targetType: "tenant_invitation",
        targetId: invitation.id,
        outcome: "success",
        reason: "invitation_accept_success",
        metadata: {
          invitation_id: invitation.id,
          email: invitation.email,
        },
      });

      return {
        invitation_id: invitation.id,
        email: invitation.email,
        company_name: invitation.company_name || null,
        desired_slug: invitation.desired_slug || null,
        admin_name: invitation.admin_name || null,
        allow_skip_ek: Boolean(invitation.allow_skip_ek),
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
          eventType: "onboarding_started",
          targetType: "tenant_invitation",
          targetId: tokenHash,
          outcome: "fail",
          reason: "onboarding_start_fail",
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
  createInvitation,
  acceptInvitation,
  listInvitations,
  getInvitationStatus,
};
