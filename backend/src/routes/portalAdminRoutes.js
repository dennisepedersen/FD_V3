const express = require("express");
const path = require("path");
const requirePortalHost = require("../middleware/requirePortalHost");
const { rateLimitRedis } = require("../middleware/rateLimitRedis");
const { createHttpError } = require("../middleware/errorHandler");
const invitationService = require("../services/invitationService");
const globalAdminAuthService = require("../services/globalAdminAuthService");
const {
  PORTAL_SESSION_COOKIE_NAME,
  portalSessionCookieOptions,
  getGlobalAdminSession,
  requireGlobalAdminSession,
} = require("../middleware/requireGlobalAdminSession");

const router = express.Router();
const portalLoginRateLimit = rateLimitRedis({
  windowMs: 60 * 1000,
  maxRequests: 10,
});

router.get("/", requirePortalHost, async (req, res, next) => {
  try {
    const session = await getGlobalAdminSession(req);
    if (!session) {
      res.clearCookie(PORTAL_SESSION_COOKIE_NAME, portalSessionCookieOptions());
      return res.redirect("/login");
    }

    return res.redirect("/invitations");
  } catch (error) {
    return next(error);
  }
});

router.get("/login", requirePortalHost, async (req, res, next) => {
  try {
    const session = await getGlobalAdminSession(req);
    if (session) {
      return res.redirect("/invitations");
    }

    return res.sendFile(path.join(__dirname, "../ui/portal-login.html"));
  } catch (error) {
    return next(error);
  }
});

router.get("/invitations", requirePortalHost, async (req, res, next) => {
  try {
    const session = await getGlobalAdminSession(req);
    if (!session) {
      res.clearCookie(PORTAL_SESSION_COOKIE_NAME, portalSessionCookieOptions());
      return res.redirect("/login");
    }

    return res.sendFile(path.join(__dirname, "../ui/portal-invitations.html"));
  } catch (error) {
    return next(error);
  }
});

router.get("/v1/portal/auth/me", requirePortalHost, requireGlobalAdminSession, async (req, res) => {
  res.status(200).json({
    success: true,
    user: {
      id: req.globalAdmin.actorId,
      username: req.globalAdmin.username,
      display_name: req.globalAdmin.displayName,
    },
  });
});

router.post("/v1/portal/auth/login", requirePortalHost, portalLoginRateLimit, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      throw createHttpError(400, "Missing login fields");
    }

    const result = await globalAdminAuthService.authenticatePortalLogin({
      username,
      password,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] || null,
    });

    res.cookie(PORTAL_SESSION_COOKIE_NAME, result.token, portalSessionCookieOptions());
    res.status(200).json({
      success: true,
      user: result.user,
      bootstrap_created: result.bootstrap_created,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/v1/portal/auth/logout", requirePortalHost, requireGlobalAdminSession, async (req, res, next) => {
  try {
    await globalAdminAuthService.writeLogoutAudit({
      userId: req.globalAdmin.actorId,
      username: req.globalAdmin.username,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] || null,
    });
    res.clearCookie(PORTAL_SESSION_COOKIE_NAME, portalSessionCookieOptions());
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post("/v1/invitations", requirePortalHost, requireGlobalAdminSession, async (req, res, next) => {
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
      authSource: "portal_session",
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
      expiry_model: result.expires_at ? "absolute_datetime" : "relative_hours",
      invitation_token: result.token,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/v1/invitations", requirePortalHost, requireGlobalAdminSession, async (req, res, next) => {
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

router.get("/v1/invitations/:id/status", requirePortalHost, requireGlobalAdminSession, async (req, res, next) => {
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