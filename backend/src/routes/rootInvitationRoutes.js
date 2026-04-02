const express = require("express");
const path = require("path");
const requireRootHost = require("../middleware/requireRootHost");
const requireGlobalAdmin = require("../middleware/requireGlobalAdmin");
const { rateLimitRedis } = require("../middleware/rateLimitRedis");
const invitationService = require("../services/invitationService");
const { createHttpError } = require("../middleware/errorHandler");

const router = express.Router();
const invitationAcceptRateLimit = rateLimitRedis({
  windowMs: 60 * 1000,
  maxRequests: 10,
});

// Global admin HTML UI
router.get("/admin/invitations", requireRootHost, (req, res) => {
  res.sendFile(path.join(__dirname, "../ui/root-invitations.html"));
});

router.post("/v1/invitations", requireRootHost, requireGlobalAdmin, async (req, res, next) => {
  try {
    const {
      email,
      company_name,
      desired_slug,
      admin_name,
      suggested_login,
      allow_skip_ek,
      invitation_note,
      expires_at,
      expires_in_hours,
    } = req.body || {};
    if (!email) {
      throw createHttpError(400, "Missing required invitation create fields");
    }

    const result = await invitationService.createInvitation({
      email,
      actorId: req.globalAdmin.actorId,
      authSource: req.globalAdmin.authType || "header_admin",
      companyName: company_name,
      desiredSlug: desired_slug,
      adminName: admin_name,
      suggestedLogin: suggested_login,
      allowSkipEk: allow_skip_ek,
      invitationNote: invitation_note,
      expiresAt: expires_at,
      expiresInHours: Number.isInteger(expires_in_hours) ? expires_in_hours : undefined,
    });

    res.status(201).json({
      success: true,
      invitation_id: result.invitation_id,
      email: result.email,
      company_name: result.company_name,
      desired_slug: result.desired_slug,
      admin_name: result.admin_name,
      suggested_login: result.suggested_login,
      allow_skip_ek: result.allow_skip_ek,
      invitation_note: result.invitation_note,
      expires_at: result.expires_at,
      expiry_model: expires_at ? "absolute_datetime" : "relative_hours",
      invitation_token: result.token,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/v1/invitations/accept", requireRootHost, invitationAcceptRateLimit, async (req, res, next) => {
  try {
    const { token } = req.body || {};

    if (!token) {
      throw createHttpError(400, "Missing required invitation accept fields");
    }

    const result = await invitationService.acceptInvitation({
      token,
    });

    res.status(200).json({
      success: true,
      invitation_id: result.invitation_id,
      email: result.email,
      company_name: result.company_name,
      desired_slug: result.desired_slug,
      admin_name: result.admin_name,
      allow_skip_ek: result.allow_skip_ek,
      onboarding_token: result.onboarding_token,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/v1/invitations", requireRootHost, requireGlobalAdmin, async (req, res, next) => {
  try {
    const { status } = req.query;
    const allowed = ["pending", "accepted", "revoked"];
    const filter = allowed.includes(status) ? status : undefined;
    const invitations = await invitationService.listInvitations({ status: filter });
    res.status(200).json({ success: true, invitations });
  } catch (error) {
    next(error);
  }
});

router.get("/v1/invitations/:id/status", requireRootHost, requireGlobalAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) {
      throw createHttpError(400, "Missing invitation id");
    }

    const invitation = await invitationService.getInvitationStatus(id);
    if (!invitation) {
      throw createHttpError(404, "Invitation not found");
    }

    res.status(200).json({
      success: true,
      invitation: {
        id: invitation.id,
        email: invitation.email,
        status: invitation.status,
        expires_at: invitation.expires_at,
        created_at: invitation.created_at,
        accepted_at: invitation.accepted_at,
        revoked_at: invitation.revoked_at,
        company_name: invitation.company_name,
        desired_slug: invitation.desired_slug,
        admin_name: invitation.admin_name,
        allow_skip_ek: invitation.allow_skip_ek,
        invitation_note: invitation.invitation_note,
        suggested_login: invitation.suggested_login,
      },
      tenant: invitation.tenant_id
        ? {
            id: invitation.tenant_id,
            slug: invitation.tenant_slug,
            name: invitation.tenant_name,
            status: invitation.tenant_status,
            domain: invitation.tenant_domain,
          }
        : null,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
