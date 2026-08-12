"use strict";

const express = require("express");
const requireTenantHost = require("../../middleware/requireTenantHost");
const requireAuth = require("../../middleware/requireAuth");
const { createHttpError } = require("../../middleware/errorHandler");
const moduleAccessService = require("../../services/moduleAccessService");
const absenceRequestService = require("./absenceRequest.service");
const absenceTypeService = require("./absenceType.service");

const router = express.Router();
const MODULE_KEY = "absence_request";

function hasAccessContextMismatch(req) {
  if (!req.auth || !req.context || !req.context.tenant) {
    return true;
  }

  return String(req.auth.tenant_id) !== String(req.context.tenant.id);
}

function getTenantContext(req) {
  if (hasAccessContextMismatch(req)) {
    throw createHttpError(403, "tenant_context_mismatch");
  }

  return {
    tenantId: req.context.tenant.id,
    userId: req.auth.sub,
  };
}

function requireAbsenceRequestAccess(req, action) {
  try {
    return moduleAccessService.requireModuleAccess({
      tenant: req.context.tenant,
      auth: req.auth,
      moduleKey: MODULE_KEY,
      action,
    });
  } catch (error) {
    if (error && error.statusCode === 403) {
      throw createHttpError(403, "absence_request_access_denied");
    }
    throw error;
  }
}

function hasAbsenceRequestAccess(req, action) {
  try {
    requireAbsenceRequestAccess(req, action);
    return true;
  } catch (error) {
    if (error && error.statusCode === 403) {
      return false;
    }
    throw error;
  }
}

function idempotencyKey(req) {
  return req.get("Idempotency-Key") || req.get("X-Idempotency-Key") || null;
}

function logRouteError(route, method, req, error) {
  console.error("[absence.routes] request_failed", {
    route,
    method,
    tenant_id: req.context?.tenant?.id || req.auth?.tenant_id || null,
    user_id: req.auth?.sub || null,
    role: req.auth?.role || null,
    error_message: error?.message || null,
    error_stack: error?.stack || null,
  });
}

router.get("/api/calendar/absence-requests/mine", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireAbsenceRequestAccess(req, "read_own");

    const result = await absenceRequestService.listMine({
      tenantId,
      userId,
      filters: req.query || {},
    });

    res.status(200).json({
      success: true,
      requests: result.requests,
      limit: result.limit,
      offset: result.offset,
    });
  } catch (error) {
    logRouteError("/api/calendar/absence-requests/mine", "GET", req, error);
    next(error);
  }
});

router.get("/api/calendar/absence-types/request-options", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId } = getTenantContext(req);
    requireAbsenceRequestAccess(req, "create_own");

    const result = await absenceTypeService.listRequestOptions({ tenantId });

    res.status(200).json({
      success: true,
      items: result.items,
    });
  } catch (error) {
    logRouteError("/api/calendar/absence-types/request-options", "GET", req, error);
    next(error);
  }
});

router.get("/api/calendar/absence-requests/manager/pending", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    const result = await absenceRequestService.listManagedPending({
      tenantId,
      userId,
      filters: req.query || {},
    });

    res.status(200).json({
      success: true,
      requests: result.requests,
      statuses: result.statuses,
      limit: result.limit,
      offset: result.offset,
    });
  } catch (error) {
    logRouteError("/api/calendar/absence-requests/manager/pending", "GET", req, error);
    next(error);
  }
});

router.get("/api/calendar/absence-requests/manager/:id", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    const result = await absenceRequestService.getManagedDetail({
      tenantId,
      userId,
      absenceRequestId: req.params.id,
      includePrivateComment: hasAbsenceRequestAccess(req, "read_private_comment"),
    });

    res.status(200).json({
      success: true,
      request: result.request,
      events: result.events,
    });
  } catch (error) {
    logRouteError("/api/calendar/absence-requests/manager/:id", "GET", req, error);
    next(error);
  }
});
router.post("/api/calendar/absence-requests", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireAbsenceRequestAccess(req, "create_own");

    const result = await absenceRequestService.createDraft({
      tenantId,
      userId,
      body: req.body || {},
      idempotencyKey: idempotencyKey(req),
    });

    res.status(result.idempotent ? 200 : 201).json({
      success: true,
      request: result.request,
    });
  } catch (error) {
    logRouteError("/api/calendar/absence-requests", "POST", req, error);
    next(error);
  }
});

router.get("/api/calendar/absence-requests/:id", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireAbsenceRequestAccess(req, "read_own");

    const result = await absenceRequestService.getMineDetail({
      tenantId,
      userId,
      absenceRequestId: req.params.id,
      includeHistory: hasAbsenceRequestAccess(req, "read_own_history"),
    });

    res.status(200).json({
      success: true,
      request: result.request,
      events: result.events,
    });
  } catch (error) {
    logRouteError("/api/calendar/absence-requests/:id", "GET", req, error);
    next(error);
  }
});

router.patch("/api/calendar/absence-requests/:id", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireAbsenceRequestAccess(req, "update_own_draft");

    const result = await absenceRequestService.updateDraft({
      tenantId,
      userId,
      absenceRequestId: req.params.id,
      body: req.body || {},
    });

    res.status(200).json({
      success: true,
      request: result.request,
    });
  } catch (error) {
    logRouteError("/api/calendar/absence-requests/:id", "PATCH", req, error);
    next(error);
  }
});

router.post("/api/calendar/absence-requests/:id/submit", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireAbsenceRequestAccess(req, "submit_own");

    const result = await absenceRequestService.submitDraft({
      tenantId,
      userId,
      absenceRequestId: req.params.id,
      body: req.body || {},
      idempotencyKey: idempotencyKey(req),
    });

    res.status(200).json({
      success: true,
      request: result.request,
    });
  } catch (error) {
    logRouteError("/api/calendar/absence-requests/:id/submit", "POST", req, error);
    next(error);
  }
});

router.post("/api/calendar/absence-requests/:id/approve", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    const result = await absenceRequestService.approveManaged({
      tenantId,
      userId,
      absenceRequestId: req.params.id,
      body: req.body || {},
      hasBeforeReviewOverride: hasAbsenceRequestAccess(req, "approve_before_review_date"),
      idempotencyKey: idempotencyKey(req),
    });

    res.status(200).json({
      success: true,
      request: result.request,
    });
  } catch (error) {
    logRouteError("/api/calendar/absence-requests/:id/approve", "POST", req, error);
    next(error);
  }
});

router.post("/api/calendar/absence-requests/:id/reject", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    const result = await absenceRequestService.rejectManaged({
      tenantId,
      userId,
      absenceRequestId: req.params.id,
      body: req.body || {},
      hasBeforeReviewOverride: hasAbsenceRequestAccess(req, "approve_before_review_date"),
      idempotencyKey: idempotencyKey(req),
    });

    res.status(200).json({
      success: true,
      request: result.request,
    });
  } catch (error) {
    logRouteError("/api/calendar/absence-requests/:id/reject", "POST", req, error);
    next(error);
  }
});
router.post("/api/calendar/absence-requests/:id/cancel", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireAbsenceRequestAccess(req, "cancel_own");

    const result = await absenceRequestService.cancelOwn({
      tenantId,
      userId,
      absenceRequestId: req.params.id,
      body: req.body || {},
    });

    res.status(200).json({
      success: true,
      request: result.request,
    });
  } catch (error) {
    logRouteError("/api/calendar/absence-requests/:id/cancel", "POST", req, error);
    next(error);
  }
});

module.exports = router;
