"use strict";

const express = require("express");
const requireTenantHost = require("../../middleware/requireTenantHost");
const requireAuth = require("../../middleware/requireAuth");
const { createHttpError } = require("../../middleware/errorHandler");
const moduleAccessService = require("../../services/moduleAccessService");
const specialWindowService = require("./specialWindow.service");

const router = express.Router();
const MODULE_KEY = "absence_special_window";
const ABSENCE_REQUEST_MODULE_KEY = "absence_request";

function hasAccessContextMismatch(req) {
  if (!req.auth || !req.context || !req.context.tenant) return true;
  return String(req.auth.tenant_id) !== String(req.context.tenant.id);
}

function getTenantContext(req) {
  if (hasAccessContextMismatch(req)) throw createHttpError(403, "tenant_context_mismatch");
  return {
    tenantId: req.context.tenant.id,
    userId: req.auth.sub,
  };
}

function requireAccess(req, moduleKey, action, deniedCode) {
  try {
    return moduleAccessService.requireModuleAccess({
      tenant: req.context.tenant,
      auth: req.auth,
      moduleKey,
      action,
    });
  } catch (error) {
    if (error && error.statusCode === 403) throw createHttpError(403, deniedCode);
    throw error;
  }
}

function hasAccess(req, moduleKey, action) {
  try {
    requireAccess(req, moduleKey, action, "special_window_access_denied");
    return true;
  } catch (error) {
    if (error && error.statusCode === 403) return false;
    throw error;
  }
}

function requireSpecialWindowManage(req) {
  return requireAccess(req, MODULE_KEY, "manage", "special_window_access_denied");
}

function requireReviewAccess(req) {
  if (hasAccess(req, MODULE_KEY, "manage") || hasAccess(req, MODULE_KEY, "review")) return true;
  throw createHttpError(403, "special_window_review_access_denied");
}

function canReadPrivateComment(req) {
  return hasAccess(req, ABSENCE_REQUEST_MODULE_KEY, "read_private_comment");
}

function logRouteError(route, method, req, error) {
  console.error("[specialWindow.routes] request_failed", {
    route,
    method,
    tenant_id: req.context?.tenant?.id || req.auth?.tenant_id || null,
    user_id: req.auth?.sub || null,
    role: req.auth?.role || null,
    error_message: error?.message || null,
    error_stack: error?.stack || null,
  });
}

router.get("/api/calendar/special-windows", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId } = getTenantContext(req);
    requireSpecialWindowManage(req);
    const result = await specialWindowService.listSpecialWindows({ tenantId, filters: req.query || {} });
    res.status(200).json({ success: true, windows: result.windows, limit: result.limit, offset: result.offset });
  } catch (error) {
    logRouteError("/api/calendar/special-windows", "GET", req, error);
    next(error);
  }
});

router.post("/api/calendar/special-windows", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireSpecialWindowManage(req);
    const result = await specialWindowService.createSpecialWindow({ tenantId, actorId: userId, body: req.body || {} });
    res.status(201).json({ success: true, window: result.window });
  } catch (error) {
    logRouteError("/api/calendar/special-windows", "POST", req, error);
    next(error);
  }
});

router.get("/api/calendar/special-windows/:id", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId } = getTenantContext(req);
    requireSpecialWindowManage(req);
    const result = await specialWindowService.getSpecialWindow({ tenantId, specialWindowId: req.params.id });
    res.status(200).json({ success: true, window: result.window });
  } catch (error) {
    logRouteError("/api/calendar/special-windows/:id", "GET", req, error);
    next(error);
  }
});

router.patch("/api/calendar/special-windows/:id", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireSpecialWindowManage(req);
    const result = await specialWindowService.updateSpecialWindow({ tenantId, actorId: userId, specialWindowId: req.params.id, body: req.body || {} });
    res.status(200).json({ success: true, window: result.window });
  } catch (error) {
    logRouteError("/api/calendar/special-windows/:id", "PATCH", req, error);
    next(error);
  }
});

router.post("/api/calendar/special-windows/:id/archive", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireSpecialWindowManage(req);
    const result = await specialWindowService.archiveSpecialWindow({ tenantId, actorId: userId, specialWindowId: req.params.id, body: req.body || {} });
    res.status(200).json({ success: true, window: result.window });
  } catch (error) {
    logRouteError("/api/calendar/special-windows/:id/archive", "POST", req, error);
    next(error);
  }
});

router.get("/api/calendar/special-windows/:id/review-overview", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId } = getTenantContext(req);
    requireReviewAccess(req);
    const result = await specialWindowService.getReviewOverview({
      tenantId,
      specialWindowId: req.params.id,
      filters: req.query || {},
      includePrivateComment: canReadPrivateComment(req),
    });
    res.status(200).json({ success: true, window: result.window, requests: result.requests, limit: result.limit, offset: result.offset });
  } catch (error) {
    logRouteError("/api/calendar/special-windows/:id/review-overview", "GET", req, error);
    next(error);
  }
});

module.exports = router;