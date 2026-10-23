"use strict";
const express = require("express");
const requireTenantHost = require("../../middleware/requireTenantHost");
const requireAuth = require("../../middleware/requireAuth");
const access = require("../../services/moduleAccessService");
const { createHttpError } = require("../../middleware/errorHandler");
const routing = require("./operationalMailRouting");
const router = express.Router();
function context(req, action) {
  if (!req.context?.tenant || !req.auth || req.context.tenant.id !== req.auth.tenant_id) throw createHttpError(403, "tenant_context_mismatch");
  if (req.auth.role !== "tenant_admin") throw createHttpError(403, "tenant_admin_access_denied");
  access.requireModuleAccess({ tenant: req.context.tenant, auth: req.auth, moduleKey: "tenant_admin", action });
  if (Object.keys(req.query || {}).length) throw createHttpError(400, "operational_mail_routing_input_invalid");
  return { tenantId: req.context.tenant.id, actorId: req.auth.sub };
}
router.get("/api/tenant/admin/operational-mail-routing", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const actor = context(req, "read");
    res.set("Cache-Control", "no-store").json({ success: true, mail_types: await routing.list(actor) });
  } catch (error) { next(error); }
});
router.put("/api/tenant/admin/operational-mail-routing/:mailType", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const actor = context(req, "update");
    res.set("Cache-Control", "no-store").json({ success: true, setting: await routing.save(actor, req.params.mailType, req.body) });
  } catch (error) { next(error); }
});
module.exports = router;
