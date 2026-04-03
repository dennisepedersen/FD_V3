const express = require("express");
const path = require("path");
const pool = require("../db/pool");
const requirePortalHost = require("../middleware/requirePortalHost");
const { rateLimitRedis } = require("../middleware/rateLimitRedis");
const { createHttpError } = require("../middleware/errorHandler");
const invitationService = require("../services/invitationService");
const globalAdminAuthService = require("../services/globalAdminAuthService");
const env = require("../config/env");
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

router.post("/v1/invitations/:id/reissue-link", requirePortalHost, requireGlobalAdminSession, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) {
      throw createHttpError(400, "Missing invitation id");
    }

    const result = await invitationService.issueOnboardingLinkForInvitation({
      invitationId: id,
      actorId: req.globalAdmin.actorId,
      authSource: "portal_session",
    });

    const protocol = env.NODE_ENV === "production" ? "https" : "http";
    const onboardingLink = `${protocol}://${env.ROOT_DOMAIN}/onboarding?token=${result.onboarding_token}`;

    res.status(200).json({
      success: true,
      invitation_id: result.invitation_id,
      email: result.email,
      expires_at: result.expires_at,
      invitation_token: result.onboarding_token,
      onboarding_link: onboardingLink,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/v1/sync/overview", requirePortalHost, requireGlobalAdminSession, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const [tenantsResult, stuckJobsResult] = await Promise.all([
      client.query(
        `
          SELECT
            t.id AS tenant_id,
            t.slug,
            t.name,
            bs.status AS bootstrap_status,
            ds.status AS delta_status,
            MAX(ses.last_successful_sync_at) AS last_successful_sync_at,
            MAX(ses.last_attempt_at) AS last_attempt_at,
            COALESCE(SUM(ses.rows_persisted), 0) AS rows_persisted_total,
            COALESCE(SUM(CASE WHEN sfb.status IN ('pending', 'deferred', 'retrying') THEN 1 ELSE 0 END), 0) AS pending_failures,
            COALESCE(SUM(CASE WHEN sfb.status = 'failed' THEN 1 ELSE 0 END), 0) AS failed_backlog,
            MIN(sfb.next_retry_at) FILTER (WHERE sfb.status IN ('pending', 'deferred', 'retrying')) AS next_retry_at
          FROM tenant t
          LEFT JOIN LATERAL (
            SELECT status
            FROM sync_job sj
            WHERE sj.tenant_id = t.id
              AND sj.type = 'bootstrap'
            ORDER BY sj.created_at DESC
            LIMIT 1
          ) bs ON true
          LEFT JOIN LATERAL (
            SELECT status
            FROM sync_job sj
            WHERE sj.tenant_id = t.id
              AND sj.type = 'delta'
            ORDER BY sj.created_at DESC
            LIMIT 1
          ) ds ON true
          LEFT JOIN sync_endpoint_state ses ON ses.tenant_id = t.id
          LEFT JOIN sync_failure_backlog sfb ON sfb.tenant_id = t.id
          GROUP BY t.id, t.slug, t.name, bs.status, ds.status
          ORDER BY t.slug ASC
        `
      ),
      client.query(
        `
          SELECT
            sj.id,
            sj.tenant_id,
            t.slug,
            sj.type,
            sj.status,
            sj.started_at,
            sj.updated_at,
            sj.error_message
          FROM sync_job sj
          JOIN tenant t ON t.id = sj.tenant_id
          WHERE sj.status = 'running'
            AND sj.updated_at < now() - interval '3 minutes'
          ORDER BY sj.updated_at ASC
        `
      ),
    ]);

    res.status(200).json({
      success: true,
      tenants: tenantsResult.rows,
      stuck_jobs: stuckJobsResult.rows,
    });
  } catch (error) {
    next(error);
  } finally {
    client.release();
  }
});

router.get("/v1/sync/failures", requirePortalHost, requireGlobalAdminSession, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 1000);
    const { rows } = await client.query(
      `
        SELECT
          sfb.id,
          sfb.tenant_id,
          t.slug AS tenant_slug,
          sfb.endpoint_key,
          sfb.locator_type,
          sfb.locator_value,
          sfb.page_number,
          sfb.cursor_value,
          sfb.reference_value,
          sfb.failure_kind,
          sfb.error_message,
          sfb.attempts,
          sfb.first_failed_at,
          sfb.last_failed_at,
          sfb.next_retry_at,
          sfb.status,
          CASE
            WHEN sfb.status = 'failed' AND sfb.failure_kind = 'http_429' AND sfb.attempts >= 3 THEN true
            WHEN sfb.status = 'failed' AND sfb.failure_kind = 'permanent' THEN true
            ELSE false
          END AS manual_follow_up_required
        FROM sync_failure_backlog sfb
        JOIN tenant t ON t.id = sfb.tenant_id
        WHERE sfb.status IN ('pending', 'deferred', 'retrying', 'failed')
        ORDER BY
          CASE sfb.status WHEN 'failed' THEN 0 ELSE 1 END,
          sfb.last_failed_at DESC
        LIMIT $1
      `,
      [limit]
    );

    res.status(200).json({
      success: true,
      failures: rows,
    });
  } catch (error) {
    next(error);
  } finally {
    client.release();
  }
});

module.exports = router;