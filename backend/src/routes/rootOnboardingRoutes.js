const express = require("express");
const path = require("path");
const requireRootHost = require("../middleware/requireRootHost");
const requireAuth = require("../middleware/requireAuth");
const onboardingService = require("../services/onboardingService");
const { createHttpError } = require("../middleware/errorHandler");

const router = express.Router();

router.get("/onboarding", requireRootHost, (req, res) => {
  res.sendFile(path.join(__dirname, "../ui/onboarding.html"));
});

router.get("/v1/onboarding/state", requireRootHost, requireAuth("onboarding"), async (req, res, next) => {
  try {
    const state = await onboardingService.getOnboardingState(req.auth.invitation_id);
    res.status(200).json({ success: true, state });
  } catch (error) {
    next(error);
  }
});

router.post("/v1/onboarding/ek/test", requireRootHost, requireAuth("onboarding"), async (req, res, next) => {
  try {
    const { ek_base_url, ek_api_key } = req.body || {};
    const result = await onboardingService.testEkConnection({
      invitationId: req.auth.invitation_id,
      ekBaseUrl: ek_base_url,
      ekApiKey: ek_api_key,
    });

    res.status(200).json({
      success: result.success,
      message: result.message,
      normalized_base_url: result.normalized_base_url,
      test_status: result.test_status,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/v1/onboarding/basic-info", requireRootHost, requireAuth("onboarding"), async (req, res, next) => {
  try {
    const { full_name, password, tenant_slug, tenant_name, tenant_domain } = req.body || {};
    await onboardingService.saveBasicInfo({
      invitationId: req.auth.invitation_id,
      fullName: full_name,
      password,
      tenantSlug: tenant_slug,
      tenantName: tenant_name,
      tenantDomain: tenant_domain,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post("/v1/onboarding/terms", requireRootHost, requireAuth("onboarding"), async (req, res, next) => {
  try {
    const { terms_version, accepted } = req.body || {};
    if (!terms_version) {
      throw createHttpError(400, "Missing terms_version");
    }

    await onboardingService.saveTerms({
      invitationId: req.auth.invitation_id,
      termsVersion: terms_version,
      accepted,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] || null,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post("/v1/onboarding/ek-integration", requireRootHost, requireAuth("onboarding"), async (req, res, next) => {
  try {
    const { ek_base_url, ek_api_key, skipped } = req.body || {};
    await onboardingService.saveEkIntegration({
      invitationId: req.auth.invitation_id,
      ekBaseUrl: ek_base_url,
      ekApiKey: ek_api_key,
      skipped,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post("/v1/onboarding/endpoint-selection", requireRootHost, requireAuth("onboarding"), async (req, res, next) => {
  try {
    const { endpoints } = req.body || {};
    await onboardingService.saveEndpointSelection({
      invitationId: req.auth.invitation_id,
      endpoints,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get("/v1/onboarding/review", requireRootHost, requireAuth("onboarding"), async (req, res, next) => {
  try {
    const review = await onboardingService.getOnboardingReview(req.auth.invitation_id);
    res.status(200).json({ success: true, review });
  } catch (error) {
    next(error);
  }
});

router.post("/v1/onboarding/complete", requireRootHost, requireAuth("onboarding"), async (req, res, next) => {
  try {
    const result = await onboardingService.completeOnboarding({
      invitationId: req.auth.invitation_id,
    });

    res.status(200).json({
      success: true,
      completed: true,
      auto_login: false,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
