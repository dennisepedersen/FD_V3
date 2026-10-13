"use strict";

const express = require("express");
const requireTenantHost = require("../../middleware/requireTenantHost");
const requireAuth = require("../../middleware/requireAuth");
const { createHttpError } = require("../../middleware/errorHandler");
const moduleAccessService = require("../../services/moduleAccessService");
const timeControlService = require("./timeControl.service");
const { normalizeIsoDate } = require("./timeControl.dates");

const router = express.Router();

router.get("/api/tenant/admin/time-control/operations-status", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId } = getTenantContext(req);
    requireTenantAdmin(req, "read");
    res.status(200).json({ success: true, ...(await require("./timeControl.observability").getOverview({ tenantId })) });
  } catch (error) {
    logRouteError(req, "/api/tenant/admin/time-control/operations-status", "GET", error);
    next(error);
  }
});

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

router.patch("/api/tenant/admin/time-control/manager-recipients", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireTenantAdmin(req, "update");
    const settings = await timeControlService.setManagerRecipients({
      tenantId, actorId: userId, emails: req.body?.emails,
      expectedEmails: req.body?.expected_emails, reason: req.body?.reason,
    });
    res.status(200).json({ success: true, settings });
  } catch (error) {
    logRouteError(req, "/api/tenant/admin/time-control/manager-recipients", "PATCH", error);
    next(error);
  }
});

router.get("/api/tenant/admin/time-control/mail-test-preview", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId } = getTenantContext(req);
    requireTenantAdmin(req, "read");
    const plan = await timeControlService.getPocMailPlan({ tenantId, batchId: req.query?.batch_id });
    res.status(200).json({ success: true, plan });
  } catch (error) {
    logRouteError(req, "/api/tenant/admin/time-control/mail-test-preview", "GET", error);
    next(error);
  }
});

router.post("/api/tenant/admin/time-control/mail-tests/prepare", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireTenantAdmin(req, "update");
    const result = await require("./timeControl.mailTestSender").prepare({
      tenantId, actorId: userId, batchId: req.body?.batch_id,
    });
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    logRouteError(req, "/api/tenant/admin/time-control/mail-tests/prepare", "POST", error);
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

router.post("/api/tenant/admin/time-control/operation", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, tenantSlug, userId } = getTenantContext(req);
    requireTenantAdmin(req, "update");
    const body = req.body || {};
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.group_id || "") ||
        body.confirm !== `BEKRAEFT:timekontrol-drift:${tenantSlug}:${body.status}`) {
      throw createHttpError(400, "time_control_operation_confirmation_required");
    }
    const operation = await require("../../db/tx").withTransaction(client =>
      require("./timeControl.operation").setOperation(client, {
        tenantId, groupId: body.group_id, actorId: userId, coveredFrom: body.covered_from, status: body.status,
      }));
    res.status(200).json({ success: true, operation });
  } catch (error) {
    logRouteError(req, "/api/tenant/admin/time-control/operation", "POST", error);
    next(error);
  }
});

router.get("/api/tenant/admin/time-control/operation", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId } = getTenantContext(req);
    requireTenantAdmin(req, "read");
    const groups = await require("../../db/tx").withTransaction(async client => (await client.query(
      `SELECT o.*,s.status FROM time_control_operation o JOIN time_control_operation_state s
       ON s.tenant_id=o.tenant_id AND s.group_id=o.group_id AND s.operation_id=o.id
       WHERE o.tenant_id=$1 ORDER BY o.group_id`, [tenantId])).rows);
    res.status(200).json({ success: true, operations: groups });
  } catch (error) {
    logRouteError(req, "/api/tenant/admin/time-control/operation", "GET", error);
    next(error);
  }
});

router.post("/api/tenant/admin/time-control/catch-up", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireTenantAdmin(req, "sync");
    const pool = require("../../db/pool");
    const client = await pool.connect();
    try {
      const result = await require("./timeControl.orchestration").catchUp(client, { tenantId, actorId: userId });
      res.status(202).json({ success: true, ...result });
    } finally { client.release(); }
  } catch (error) {
    logRouteError(req, "/api/tenant/admin/time-control/catch-up", "POST", error);
    next(error);
  }
});

router.post("/api/tenant/admin/time-control/test-runs", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireTenantAdmin(req, "sync");
    const requestedType = String(req.body?.control_type || "manual").trim();
    if (!["daily_09", "friday_12", "manual", "friday_weekly_v1"].includes(requestedType)) {
      throw createHttpError(400, "time_control_type_invalid");
    }
    if (requestedType === "friday_weekly_v1") {
      try {
        if (req.body?.hours_dataset_ids != null) require("./timeControl.weekly").validateBindings(req.body.hours_dataset_ids);
        require("./timeControl.dates").weeklyPeriod(req.body?.date || req.body?.controlled_date);
      } catch (error) {
        throw createHttpError(400, error.message);
      }
    }
    const result = await timeControlService.runTimeControlWithPool({
      tenantId,
      actorId: userId,
      controlledDate: normalizeIsoDate(req.body?.date || req.body?.controlled_date),
      controlType: requestedType,
      triggeredBy: "manual_test",
      waitForSync: req.body?.wait_for_sync !== false,
      dryRun: true,
    }, {
      hoursDatasetId: req.body?.hours_dataset_id || null,
      hoursDatasetIds: req.body?.hours_dataset_ids || null,
      allowHistoricalSnapshot: req.body?.historical_snapshot === true,
    });
    res.status(202).json({ success: true, ...result });
  } catch (error) {
    logRouteError(req, "/api/tenant/admin/time-control/test-runs", "POST", error);
    next(error);
  }
});

module.exports = router;
