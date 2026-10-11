"use strict";

const express = require("express");
const requireTenantHost = require("../../middleware/requireTenantHost");
const requireAuth = require("../../middleware/requireAuth");
const { createHttpError } = require("../../middleware/errorHandler");
const moduleAccessService = require("../../services/moduleAccessService");
const timeControlService = require("./timeControl.service");
const { normalizeIsoDate } = require("./timeControl.dates");

const router = express.Router();

function getTenantContext(req) {
  if (!req.auth || !req.context || !req.context.tenant) throw createHttpError(403, "tenant_context_mismatch");
  if (String(req.auth.tenant_id) !== String(req.context.tenant.id)) throw createHttpError(403, "tenant_context_mismatch");
  return { tenantId: req.context.tenant.id, tenantSlug: req.context.tenant.slug, userId: req.auth.sub };
}

function requireTenantAdmin(req, action) {
  try {
    moduleAccessService.requireModuleAccess({ tenant: req.context.tenant, auth: req.auth, moduleKey: "tenant_admin", action });
  } catch (error) {
    if (error && error.statusCode === 403) throw createHttpError(403, "tenant_admin_access_denied");
    throw error;
  }
}

function logRouteError(req, route, method, error) {
  console.error("[timeControl.routes] request_failed", {
    route,
    method,
    tenant_id: req.context?.tenant?.id || req.auth?.tenant_id || null,
    user_id: req.auth?.sub || null,
    role: req.auth?.role || null,
    error_message: error?.message || null,
  });
}

router.get("/api/tenant/admin/time-control/status", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId } = getTenantContext(req);
    requireTenantAdmin(req, "read");
    res.status(200).json({ success: true, ...(await timeControlService.getOverview({ tenantId })) });
  } catch (error) {
    logRouteError(req, "/api/tenant/admin/time-control/status", "GET", error);
    next(error);
  }
});

router.patch("/api/tenant/admin/time-control/settings", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, tenantSlug, userId } = getTenantContext(req);
    requireTenantAdmin(req, "update");
    const settings = await timeControlService.setMode({
      tenantId,
      tenantSlug,
      actorId: userId,
      mode: req.body?.mode,
      confirm: req.body?.confirm,
    });
    res.status(200).json({ success: true, settings });
  } catch (error) {
    logRouteError(req, "/api/tenant/admin/time-control/settings", "PATCH", error);
    next(error);
  }
});

router.patch("/api/tenant/admin/time-control/employees/:configId/recipient", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireTenantAdmin(req, "update");
    const config = await timeControlService.approveEmployeeRecipient({
      tenantId, actorId: userId, configId: req.params.configId,
      fitterId: req.body?.fitter_id, groupId: req.body?.group_id,
      email: req.body?.email, source: req.body?.email_source,
      reason: req.body?.reason, expectedVersion: req.body?.expected_version,
    });
    res.status(200).json({ success: true, config });
  } catch (error) {
    logRouteError(req, "/api/tenant/admin/time-control/employees/:configId/recipient", "PATCH", error);
    next(error);
  }
});

router.post("/api/tenant/admin/time-control/test-runs", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireTenantAdmin(req, "sync");
    const requestedType = String(req.body?.control_type || "manual").trim();
    const result = await timeControlService.runTimeControlWithPool({
      tenantId,
      actorId: userId,
      controlledDate: normalizeIsoDate(req.body?.date || req.body?.controlled_date),
      controlType: ["daily_09", "friday_12", "manual"].includes(requestedType) ? requestedType : "manual",
      triggeredBy: "manual_test",
      waitForSync: req.body?.wait_for_sync !== false,
    });
    res.status(202).json({ success: true, ...result });
  } catch (error) {
    logRouteError(req, "/api/tenant/admin/time-control/test-runs", "POST", error);
    next(error);
  }
});

module.exports = router;
