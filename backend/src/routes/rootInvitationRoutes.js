const express = require("express");
const requireRootHost = require("../middleware/requireRootHost");
const invitationService = require("../services/invitationService");
const { createHttpError } = require("../middleware/errorHandler");

const router = express.Router();

router.post("/v1/invitations/accept", requireRootHost, async (req, res, next) => {
  try {
    const { token, full_name, password, tenant_slug, tenant_name, tenant_domain } = req.body || {};

    if (!token || !full_name || !password || !tenant_slug || !tenant_name || !tenant_domain) {
      throw createHttpError(400, "Missing required invitation accept fields");
    }

    const result = await invitationService.acceptInvitation({
      token,
      full_name,
      password,
      tenant_slug,
      tenant_name,
      tenant_domain,
    });

    res.status(200).json({
      success: true,
      tenant_id: result.tenant_id,
      onboarding_token: result.onboarding_token,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
