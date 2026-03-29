const express = require("express");
const requireRootHost = require("../middleware/requireRootHost");
const requireGlobalAdmin = require("../middleware/requireGlobalAdmin");
const invitationService = require("../services/invitationService");
const { createHttpError } = require("../middleware/errorHandler");

const router = express.Router();

router.post("/v1/invitations", requireRootHost, requireGlobalAdmin, async (req, res, next) => {
  try {
    const {
      email,
      company_name,
      desired_slug,
      admin_name,
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
      companyName: company_name,
      desiredSlug: desired_slug,
      adminName: admin_name,
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

router.post("/v1/invitations/accept", requireRootHost, async (req, res, next) => {
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

module.exports = router;
