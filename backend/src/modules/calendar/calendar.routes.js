const express = require("express");
const requireTenantHost = require("../../middleware/requireTenantHost");
const requireAuth = require("../../middleware/requireAuth");
const { createHttpError } = require("../../middleware/errorHandler");
const moduleAccessService = require("../../services/moduleAccessService");
const resourceAbsenceService = require("./resourceAbsence.service");

const router = express.Router();

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

function requireCalendarAbsenceAccess(req, action) {
  try {
    return moduleAccessService.requireModuleAccess({
      tenant: req.context.tenant,
      auth: req.auth,
      moduleKey: "calendar_absence",
      action,
    });
  } catch (error) {
    if (error && error.statusCode === 403) {
      throw createHttpError(403, "calendar_absence_access_denied");
    }
    throw error;
  }
}

router.get("/api/calendar/absences", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId } = getTenantContext(req);
    requireCalendarAbsenceAccess(req, "read");

    const result = await resourceAbsenceService.listAbsencesForTenantRange({
      tenantId,
      from: req.query?.from,
      to: req.query?.to,
    });

    res.status(200).json({
      success: true,
      absences: result.absences,
    });
  } catch (error) {
    console.error("[calendar.routes] request_failed", {
      route: "/api/calendar/absences",
      method: "GET",
      tenant_id: req.context?.tenant?.id || req.auth?.tenant_id || null,
      user_id: req.auth?.sub || null,
      role: req.auth?.role || null,
      error_message: error?.message || null,
      error_stack: error?.stack || null,
    });
    next(error);
  }
});

router.get("/api/calendar/resources", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId } = getTenantContext(req);
    requireCalendarAbsenceAccess(req, "read");

    const result = await resourceAbsenceService.listResourcesForTenant({
      tenantId,
    });

    res.status(200).json({
      success: true,
      resources: result.resources,
    });
  } catch (error) {
    console.error("[calendar.routes] request_failed", {
      route: "/api/calendar/resources",
      method: "GET",
      tenant_id: req.context?.tenant?.id || req.auth?.tenant_id || null,
      user_id: req.auth?.sub || null,
      role: req.auth?.role || null,
      error_message: error?.message || null,
      error_stack: error?.stack || null,
    });
    next(error);
  }
});

router.post("/api/calendar/absences", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireCalendarAbsenceAccess(req, "create");

    const result = await resourceAbsenceService.createAbsenceForTenant({
      tenantId,
      fitterId: req.body?.fitter_id,
      absenceType: req.body?.absence_type,
      startDate: req.body?.start_date,
      endDate: req.body?.end_date,
      note: req.body?.note,
      visibilityScope: req.body?.visibility_scope,
      createdByUserId: userId,
      updatedByUserId: userId,
    });

    res.status(201).json({
      success: true,
      absence: result.absence,
    });
  } catch (error) {
    console.error("[calendar.routes] request_failed", {
      route: "/api/calendar/absences",
      method: "POST",
      tenant_id: req.context?.tenant?.id || req.auth?.tenant_id || null,
      user_id: req.auth?.sub || null,
      role: req.auth?.role || null,
      error_message: error?.message || null,
      error_stack: error?.stack || null,
    });
    next(error);
  }
});

module.exports = router;
