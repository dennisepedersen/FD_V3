"use strict";

const express = require("express");
const requireTenantHost = require("../../middleware/requireTenantHost");
const requireAuth = require("../../middleware/requireAuth");
const { createHttpError } = require("../../middleware/errorHandler");
const service = require("./approvalControl.service");
const mailJob = require("./approvalControl.mailJob");
const control = require("./approvalControl.control");
const access = require("../../services/moduleAccessService");
const router = express.Router();

function context(req) {
  if (!req.context?.tenant || !req.auth || req.auth.tenant_id !== req.context.tenant.id) throw createHttpError(403, "tenant_context_mismatch");
  return { tenantId: req.context.tenant.id, tenantSlug: req.context.tenant.slug, userId: req.auth.sub };
}

function fail(error, res, next) {
  if (error.statusCode >= 500 && ["approval_control_source_unavailable", "approval_control_audit_unavailable"].includes(error.message)) {
    return res.status(error.statusCode).json({ error: { message: error.message } });
  }
  return next(error);
}

function adminContext(req, action) {
  const actor = context(req);
  if (req.auth.role !== "tenant_admin") throw createHttpError(403, "approval_control_control_access_denied");
  access.requireModuleAccess({ tenant: req.context.tenant, auth: req.auth, moduleKey: "tenant_admin", action });
  if (Object.keys(req.query || {}).length) throw createHttpError(400, "approval_control_control_input_invalid");
  return actor;
}

router.get("/api/approval-control/admin/control", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try { res.set("Cache-Control", "no-store").json({ success: true, control: await control.status(adminContext(req, "read")) }); }
  catch (error) { fail(error, res, next); }
});
router.post("/api/approval-control/admin/control", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try { res.set("Cache-Control", "no-store").json({ success: true, control: await control.change(adminContext(req, "update"), req.body) }); }
  catch (error) { fail(error, res, next); }
});

router.get("/api/approval-control/status", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    if (Object.keys(req.query || {}).length) throw createHttpError(400, "approval_control_preview_input_invalid");
    res.set("Cache-Control", "no-store");
    const actor = context(req);
    res.status(200).json({ success: true, ...(await service.status(actor)), operations: await mailJob.status(actor) });
  } catch (error) { fail(error, res, next); }
});

router.post("/api/approval-control/preview", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const actor = context(req);
    if (Object.keys(req.query || {}).length) throw createHttpError(400, "approval_control_preview_input_invalid");
    const result = await service.preview(actor, req.body);
    res.set("Cache-Control", "no-store");
    res.status(200).json({ success: true, ...result });
  } catch (error) { fail(error, res, next); }
});

router.get("/api/approval-control/runs/:runId", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    if (Object.keys(req.query || {}).length) throw createHttpError(400, "approval_control_preview_input_invalid");
    res.set("Cache-Control", "no-store");
    res.status(200).json({ success: true, run: await mailJob.getRun(context(req), req.params.runId) });
  } catch (error) { fail(error, res, next); }
});

module.exports = router;
