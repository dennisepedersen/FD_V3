const express = require("express");
const requireTenantHost = require("../../middleware/requireTenantHost");
const requireAuth = require("../../middleware/requireAuth");
const moduleAccessService = require("../../services/moduleAccessService");
const { rateLimitRedis } = require("../../middleware/rateLimitRedis");
const { createHttpError } = require("../../middleware/errorHandler");
const tenantAdminService = require("./tenantAdmin.service");
const tenantUserInvitationService = require("./tenantUserInvitation.service");

const router = express.Router();
const invitationAcceptRateLimit = rateLimitRedis({
  windowMs: 60 * 1000,
  maxRequests: 10,
});
const invitationSendRateLimit = rateLimitRedis({
  windowMs: 60 * 1000,
  maxRequests: 6,
});

function getTenantContext(req) {
  if (!req.auth || !req.context || !req.context.tenant) {
    throw createHttpError(403, "tenant_context_mismatch");
  }
  if (String(req.auth.tenant_id) !== String(req.context.tenant.id)) {
    throw createHttpError(403, "tenant_context_mismatch");
  }
  return {
    tenantId: req.context.tenant.id,
    userId: req.auth.sub,
  };
}

function requireTenantAdmin(req, action) {
  try {
    moduleAccessService.requireModuleAccess({
      tenant: req.context.tenant,
      auth: req.auth,
      moduleKey: "tenant_admin",
      action,
    });
  } catch (error) {
    if (error && error.statusCode === 403) {
      throw createHttpError(403, "tenant_admin_access_denied");
    }
    throw error;
  }
}

function logRouteError(req, route, method, error) {
  console.error("[tenantAdmin.routes] request_failed", {
    route,
    method,
    tenant_id: req.context?.tenant?.id || req.auth?.tenant_id || null,
    user_id: req.auth?.sub || null,
    role: req.auth?.role || null,
    error_message: error?.message || null,
  });
}

router.get("/api/tenant/invitations/account-setup", requireTenantHost, invitationAcceptRateLimit, async (req, res, next) => {
  try {
    const result = await tenantUserInvitationService.validateTenantUserInvitation({
      tenantId: req.context.tenant.id,
      token: req.query?.token,
    });
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    logRouteError(req, "/api/tenant/invitations/account-setup", "GET", error);
    next(error);
  }
});

router.post("/api/tenant/invitations/account-setup/accept", requireTenantHost, invitationAcceptRateLimit, async (req, res, next) => {
  try {
    const result = await tenantUserInvitationService.acceptTenantUserInvitation({
      tenantId: req.context.tenant.id,
      token: req.body?.token,
      password: req.body?.password,
    });
    res.status(200).json({ success: true, user: result.user });
  } catch (error) {
    logRouteError(req, "/api/tenant/invitations/account-setup/accept", "POST", error);
    next(error);
  }
});
router.get("/api/tenant/admin/users", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId } = getTenantContext(req);
    requireTenantAdmin(req, "read");
    const result = await tenantAdminService.listUsers({
      tenantId,
      search: req.query?.q,
    });
    res.status(200).json({ success: true, users: result.users });
  } catch (error) {
    logRouteError(req, "/api/tenant/admin/users", "GET", error);
    next(error);
  }
});

router.post("/api/tenant/admin/users", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireTenantAdmin(req, "create");
    const result = await tenantAdminService.createManualUser({
      tenantId,
      actorId: userId,
      email: req.body?.email,
      name: req.body?.name,
      role: req.body?.role,
      status: req.body?.status,
      shortCode: req.body?.short_code,
      username: req.body?.username,
      note: req.body?.note,
    });
    res.status(201).json({ success: true, user: result.user, fitter: result.fitter });
  } catch (error) {
    logRouteError(req, "/api/tenant/admin/users", "POST", error);
    next(error);
  }
});

router.post("/api/tenant/admin/users/:userId/invitations", requireTenantHost, requireAuth("access"), invitationSendRateLimit, async (req, res, next) => {
  try {
    const { tenantId, userId: actorId } = getTenantContext(req);
    requireTenantAdmin(req, "invite");
    const result = await tenantUserInvitationService.sendTenantUserInvitation({
      tenantId,
      actorId,
      userId: req.params.userId,
      requestProtocol: req.protocol,
      requestHost: req.get("host"),
      tenantSlug: req.context.tenant.slug,
    });
    res.status(202).json({ success: true, invitation: result.invitation });
  } catch (error) {
    logRouteError(req, "/api/tenant/admin/users/:userId/invitations", "POST", error);
    if (error && error.invitation) {
      return res.status(error.statusCode || 503).json({
        success: false,
        error: { message: error.code || error.message || "mail_send_failed" },
        invitation: error.invitation,
      });
    }
    next(error);
  }
});
router.patch("/api/tenant/admin/users/:userId", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId: actorId } = getTenantContext(req);
    requireTenantAdmin(req, "update");
    const patch = {
      tenantId,
      actorId,
      userId: req.params.userId,
    };
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "name")) patch.name = req.body.name;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "role")) patch.role = req.body.role;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "status")) patch.status = req.body.status;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "short_code")) patch.shortCode = req.body.short_code;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "username")) patch.username = req.body.username;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "note")) patch.note = req.body.note;

    const result = await tenantAdminService.updateManualUser(patch);
    res.status(200).json({ success: true, user: result.user });
  } catch (error) {
    logRouteError(req, "/api/tenant/admin/users/:userId", "PATCH", error);
    next(error);
  }
});

router.get("/api/tenant/admin/resource-groups", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId } = getTenantContext(req);
    requireTenantAdmin(req, "read");
    const result = await tenantAdminService.listResourceGroups({
      tenantId,
      includeArchived: req.query?.include_archived,
      search: req.query?.q,
    });
    res.status(200).json({ success: true, groups: result.groups });
  } catch (error) {
    logRouteError(req, "/api/tenant/admin/resource-groups", "GET", error);
    next(error);
  }
});

router.get("/api/tenant/admin/integrations/sync-status", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId } = getTenantContext(req);
    requireTenantAdmin(req, "read");
    const result = await tenantAdminService.getSyncStatus({ tenantId });
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    logRouteError(req, "/api/tenant/admin/integrations/sync-status", "GET", error);
    next(error);
  }
});

router.post("/api/tenant/admin/integrations/:source/:entity/sync", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireTenantAdmin(req, "sync");
    const result = await tenantAdminService.requestSync({
      tenantId,
      actorId: userId,
      source: req.params.source,
      entity: req.params.entity,
    });
    const syncRun = result.syncRun;
    res.status(syncRun.reused ? 200 : 202).json({
      success: true,
      syncRunId: syncRun.id,
      status: syncRun.status,
      endpointKey: syncRun.endpoint_key,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      startedAt: syncRun.started_at || null,
      finishedAt: syncRun.finished_at || null,
      reused: syncRun.reused === true,
    });
  } catch (error) {
    logRouteError(req, "/api/tenant/admin/integrations/:source/:entity/sync", "POST", error);
    next(error);
  }
});

module.exports = router;
