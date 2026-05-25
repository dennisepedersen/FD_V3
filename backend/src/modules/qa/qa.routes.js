const express = require("express");
const requireTenantHost = require("../../middleware/requireTenantHost");
const requireAuth = require("../../middleware/requireAuth");
const { createHttpError } = require("../../middleware/errorHandler");
const moduleAccessService = require("../../services/moduleAccessService");
const qaService = require("./qa.service");

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

router.get("/api/projects/:projectId/qa/threads", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    moduleAccessService.requireModuleAccess({
      tenant: req.context.tenant,
      auth: req.auth,
      moduleKey: "qa",
      action: "read",
    });
    const projectId = String(req.params.projectId || "").trim();
    if (!projectId) {
      throw createHttpError(400, "project_id_required");
    }

    const result = await qaService.listThreadsForProject({
      tenantId,
      userId,
      projectId,
    });

    res.status(200).json({
      success: true,
      project: result.project,
      project_ids: result.projectIds,
      summary: result.summary,
      threads: result.threads,
    });
  } catch (error) {
    console.error("[qa.routes] request_failed", {
      route: "/api/projects/:projectId/qa/threads",
      tenant_id: req.context?.tenant?.id || req.auth?.tenant_id || null,
      user_id: req.auth?.sub || null,
      project_id: req.params?.projectId || null,
      error_message: error?.message || null,
      error_stack: error?.stack || null,
    });
    next(error);
  }
});

router.get("/api/qa/threads/:threadId", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    moduleAccessService.requireModuleAccess({
      tenant: req.context.tenant,
      auth: req.auth,
      moduleKey: "qa",
      action: "read",
    });
    const threadId = String(req.params.threadId || "").trim();
    if (!threadId) {
      throw createHttpError(400, "thread_id_required");
    }

    const result = await qaService.getThreadDetail({
      tenantId,
      userId,
      threadId,
    });

    res.status(200).json({
      success: true,
      thread: result.thread,
      messages: result.messages,
    });
  } catch (error) {
    console.error("[qa.routes] request_failed", {
      route: "/api/qa/threads/:threadId",
      tenant_id: req.context?.tenant?.id || req.auth?.tenant_id || null,
      user_id: req.auth?.sub || null,
      thread_id: req.params?.threadId || null,
      error_message: error?.message || null,
      error_stack: error?.stack || null,
    });
    next(error);
  }
});

router.post("/api/projects/:projectId/qa/threads", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);

    moduleAccessService.requireModuleAccess({
      tenant: req.context.tenant,
      auth: req.auth,
      moduleKey: "qa",
      action: "create",
    });
    const projectId = String(req.params.projectId || "").trim();
    if (!projectId) {
      throw createHttpError(400, "project_id_required");
    }

    const result = await qaService.createThread({
      tenantId,
      userId,
      projectId,
      title: req.body?.title,
      message: req.body?.message,
      priority: req.body?.priority,
    });

    res.status(201).json({
      success: true,
      thread: result.thread,
      message: result.message,
    });
  } catch (error) {
    console.error("[qa.routes] request_failed", {
      route: "/api/projects/:projectId/qa/threads",
      tenant_id: req.context?.tenant?.id || req.auth?.tenant_id || null,
      user_id: req.auth?.sub || null,
      project_id: req.params?.projectId || null,
      error_message: error?.message || null,
      error_stack: error?.stack || null,
    });
    next(error);
  }
});

router.post("/api/qa/threads/:threadId/messages", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    moduleAccessService.requireModuleAccess({
      tenant: req.context.tenant,
      auth: req.auth,
      moduleKey: "qa",
      action: "create",
    });
    const threadId = String(req.params.threadId || "").trim();
    if (!threadId) {
      throw createHttpError(400, "thread_id_required");
    }

    const result = await qaService.addMessage({
      tenantId,
      userId,
      threadId,
      message: req.body?.message,
    });

    res.status(201).json({
      success: true,
      thread: result.thread,
      message: result.message,
    });
  } catch (error) {
    console.error("[qa.routes] request_failed", {
      route: "/api/qa/threads/:threadId/messages",
      tenant_id: req.context?.tenant?.id || req.auth?.tenant_id || null,
      user_id: req.auth?.sub || null,
      thread_id: req.params?.threadId || null,
      error_message: error?.message || null,
      error_stack: error?.stack || null,
    });
    next(error);
  }
});

router.patch("/api/qa/threads/:threadId/status", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    moduleAccessService.requireModuleAccess({
      tenant: req.context.tenant,
      auth: req.auth,
      moduleKey: "qa",
      action: "update",
    });
    const threadId = String(req.params.threadId || "").trim();
    if (!threadId) {
      throw createHttpError(400, "thread_id_required");
    }

    const result = await qaService.updateStatus({
      tenantId,
      userId,
      threadId,
      status: req.body?.status,
    });

    res.status(200).json({
      success: true,
      thread: result.thread,
    });
  } catch (error) {
    console.error("[qa.routes] request_failed", {
      route: "/api/qa/threads/:threadId/status",
      tenant_id: req.context?.tenant?.id || req.auth?.tenant_id || null,
      user_id: req.auth?.sub || null,
      thread_id: req.params?.threadId || null,
      error_message: error?.message || null,
      error_stack: error?.stack || null,
    });
    next(error);
  }
});

module.exports = router;
