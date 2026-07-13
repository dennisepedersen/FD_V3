const express = require("express");
const requireTenantHost = require("../../middleware/requireTenantHost");
const requireAuth = require("../../middleware/requireAuth");
const { createHttpError } = require("../../middleware/errorHandler");
const moduleAccessService = require("../../services/moduleAccessService");
const restarbejdeService = require("./restarbejde.service");

const router = express.Router();
const MODULE_KEY = "project_restarbejde";

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

function requireRestarbejdeAccess(req, action) {
  try {
    return moduleAccessService.requireModuleAccess({
      tenant: req.context.tenant,
      auth: req.auth,
      moduleKey: MODULE_KEY,
      action,
    });
  } catch (error) {
    if (error && error.statusCode === 403) {
      throw createHttpError(403, "restarbejde_access_denied");
    }
    throw error;
  }
}

function hasRestarbejdeAccess(req, action) {
  try {
    requireRestarbejdeAccess(req, action);
    return true;
  } catch (error) {
    if (error && error.statusCode === 403) return false;
    throw error;
  }
}

function includeArchived(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function logRouteError(req, route, method, error) {
  console.error("[restarbejde.routes] request_failed", {
    route,
    method,
    tenant_id: req.context?.tenant?.id || req.auth?.tenant_id || null,
    user_id: req.auth?.sub || null,
    role: req.auth?.role || null,
    project_id: req.params?.projectId || null,
    item_id: req.params?.itemId || null,
    error_message: error?.message || null,
  });
}

router.get("/api/projects/:projectId/restarbejde/items", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireRestarbejdeAccess(req, "read");
    const showArchived = includeArchived(req.query?.include_archived);
    if (showArchived) requireRestarbejdeAccess(req, "archive");
    const result = await restarbejdeService.listItems({
      tenantId,
      userId,
      projectId: req.params.projectId,
      includeArchived: showArchived,
      kind: req.query?.kind,
      status: req.query?.status,
    });
    res.status(200).json({ success: true, project: result.project, items: result.items });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/restarbejde/items", "GET", error);
    next(error);
  }
});

router.post("/api/projects/:projectId/restarbejde/items", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireRestarbejdeAccess(req, "create");
    const result = await restarbejdeService.createItem({
      tenantId,
      userId,
      projectId: req.params.projectId,
      input: req.body,
      canCloseInternalDefect: hasRestarbejdeAccess(req, "close"),
    });
    res.status(201).json({ success: true, project: result.project, item: result.item });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/restarbejde/items", "POST", error);
    next(error);
  }
});

router.get("/api/projects/:projectId/restarbejde/items/:itemId", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireRestarbejdeAccess(req, "read");
    const result = await restarbejdeService.getItem({
      tenantId,
      userId,
      projectId: req.params.projectId,
      itemId: req.params.itemId,
    });
    res.status(200).json({ success: true, project: result.project, item: result.item });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/restarbejde/items/:itemId", "GET", error);
    next(error);
  }
});

router.patch("/api/projects/:projectId/restarbejde/items/:itemId", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireRestarbejdeAccess(req, "update");
    const result = await restarbejdeService.updateItem({
      tenantId,
      userId,
      projectId: req.params.projectId,
      itemId: req.params.itemId,
      input: req.body,
      canCloseInternalDefect: hasRestarbejdeAccess(req, "close"),
    });
    res.status(200).json({ success: true, project: result.project, item: result.item });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/restarbejde/items/:itemId", "PATCH", error);
    next(error);
  }
});

router.post("/api/projects/:projectId/restarbejde/items/:itemId/archive", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireRestarbejdeAccess(req, "archive");
    const result = await restarbejdeService.archiveItem({
      tenantId,
      userId,
      projectId: req.params.projectId,
      itemId: req.params.itemId,
    });
    res.status(200).json({ success: true, project: result.project, item: result.item });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/restarbejde/items/:itemId/archive", "POST", error);
    next(error);
  }
});

router.post("/api/projects/:projectId/restarbejde/items/:itemId/restore", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireRestarbejdeAccess(req, "restore");
    const result = await restarbejdeService.restoreItem({
      tenantId,
      userId,
      projectId: req.params.projectId,
      itemId: req.params.itemId,
    });
    res.status(200).json({ success: true, project: result.project, item: result.item });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/restarbejde/items/:itemId/restore", "POST", error);
    next(error);
  }
});

router.get("/api/projects/:projectId/restarbejde/summary", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireRestarbejdeAccess(req, "read");
    const result = await restarbejdeService.getSummary({
      tenantId,
      userId,
      projectId: req.params.projectId,
    });
    res.status(200).json({ success: true, project: result.project, summary: result.summary });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/restarbejde/summary", "GET", error);
    next(error);
  }
});

module.exports = router;
