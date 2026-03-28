const express = require("express");
const requireRootHost = require("../middleware/requireRootHost");
const requireAuth = require("../middleware/requireAuth");
const onboardingService = require("../services/onboardingService");
const { createHttpError } = require("../middleware/errorHandler");

const router = express.Router();

router.get("/v1/onboarding/state", requireRootHost, requireAuth("onboarding"), async (req, res, next) => {
  try {
    if (req.auth.role !== "tenant_admin") {
      throw createHttpError(403, "deny_scope");
    }

    const state = await onboardingService.getOnboardingState(req.auth.tenant_id);
    res.status(200).json({ success: true, state });
  } catch (error) {
    next(error);
  }
});

router.post("/v1/onboarding/complete", requireRootHost, requireAuth("onboarding"), async (req, res, next) => {
  try {
    if (req.auth.role !== "tenant_admin") {
      throw createHttpError(403, "deny_scope");
    }

    const { ek_base_url, ek_api_key } = req.body || {};
    if (!ek_base_url || !ek_api_key) {
      throw createHttpError(400, "Missing onboarding configuration fields");
    }

    const result = await onboardingService.completeOnboarding({
      tenantId: req.auth.tenant_id,
      actorId: req.auth.sub,
      ekBaseUrl: ek_base_url,
      ekApiKey: ek_api_key,
    });

    res.status(200).json({ success: true, tenant_login_url: result.tenant_login_url });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
