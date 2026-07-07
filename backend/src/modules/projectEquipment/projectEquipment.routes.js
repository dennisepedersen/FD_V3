const express = require("express");
const requireTenantHost = require("../../middleware/requireTenantHost");
const requireAuth = require("../../middleware/requireAuth");
const { createHttpError } = require("../../middleware/errorHandler");
const moduleAccessService = require("../../services/moduleAccessService");
const projectEquipmentService = require("./projectEquipment.service");

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

function requireProjectEquipmentAccess(req, action) {
  try {
    return moduleAccessService.requireModuleAccess({
      tenant: req.context.tenant,
      auth: req.auth,
      moduleKey: "project_equipment_beta",
      action,
    });
  } catch (error) {
    if (error && error.statusCode === 403) {
      throw createHttpError(403, "project_equipment_access_denied");
    }
    throw error;
  }
}

function parseAllowList(value) {
  return new Set(String(value || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean));
}

function requireProjectEquipmentBetaScope(req) {
  const tenantAllowList = parseAllowList(process.env.PROJECT_EQUIPMENT_BETA_TENANT_IDS);
  const projectAllowList = parseAllowList(process.env.PROJECT_EQUIPMENT_BETA_PROJECT_IDS);
  const userAllowList = parseAllowList(process.env.PROJECT_EQUIPMENT_BETA_USER_IDS);
  const tenantId = String(req.context?.tenant?.id || "").toLowerCase();
  const projectId = String(req.params?.projectId || "").toLowerCase();
  const userId = String(req.auth?.sub || "").toLowerCase();

  if ((tenantAllowList.size > 0 && !tenantAllowList.has(tenantId))
    || (projectAllowList.size > 0 && !projectAllowList.has(projectId))
    || (userAllowList.size > 0 && !userAllowList.has(userId))) {
    throw createHttpError(403, "project_equipment_beta_scope_denied");
  }
}

function logRouteError(req, route, method, error) {
  console.error("[projectEquipment.routes] request_failed", {
    route,
    method,
    tenant_id: req.context?.tenant?.id || req.auth?.tenant_id || null,
    user_id: req.auth?.sub || null,
    role: req.auth?.role || null,
    project_id: req.params?.projectId || null,
    camera_id: req.params?.cameraRecordId || null,
    error_message: error?.message || null,
    error_stack: error?.stack || null,
  });
}

function csvEscape(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildCctvCsv(cameras) {
  const columns = ["camera_id", "mac", "serial_number", "model", "location", "status", "note"];
  const lines = [columns.join(",")];
  cameras.forEach((camera) => {
    lines.push([
      camera.camera_id,
      camera.mac_address,
      camera.serial_number,
      camera.model,
      camera.location_text,
      camera.status,
      camera.note,
    ].map(csvEscape).join(","));
  });
  return `${lines.join("\r\n")}\r\n`;
}

router.get("/api/projects/:projectId/equipment/cctv", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireProjectEquipmentAccess(req, "read");
    requireProjectEquipmentBetaScope(req);

    const result = await projectEquipmentService.listCctvForProject({
      tenantId,
      userId,
      projectId: req.params.projectId,
      query: req.query?.q,
    });

    res.status(200).json({
      success: true,
      project: result.project,
      summary: result.summary,
      cameras: result.cameras,
    });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/equipment/cctv", "GET", error);
    next(error);
  }
});

router.get("/api/projects/:projectId/equipment/cctv/check", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireProjectEquipmentAccess(req, "read");
    requireProjectEquipmentBetaScope(req);

    const result = await projectEquipmentService.checkCctv({
      tenantId,
      userId,
      projectId: req.params.projectId,
      query: req.query?.q || req.query?.query || req.query?.value,
    });

    res.status(200).json({
      success: true,
      found: result.found,
      camera: result.camera,
      matches: result.matches,
      project: result.project,
      project_id: result.project?.project_id || req.params.projectId,
      location: result.camera?.location_text || null,
      status: result.camera?.status || null,
      note: result.camera?.note || null,
      warning: result.warning,
    });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/equipment/cctv/check", "GET", error);
    next(error);
  }
});

router.get("/api/projects/:projectId/equipment/cctv/export.csv", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireProjectEquipmentAccess(req, "export");
    requireProjectEquipmentBetaScope(req);

    const result = await projectEquipmentService.exportCctvCsv({
      tenantId,
      userId,
      projectId: req.params.projectId,
    });

    const filenameRef = result.project?.external_project_ref || result.project?.project_id || "project";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="fielddesk-cctv-${String(filenameRef).replace(/[^a-zA-Z0-9_-]/g, "_")}.csv"`);
    res.status(200).send(buildCctvCsv(result.cameras));
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/equipment/cctv/export.csv", "GET", error);
    next(error);
  }
});

router.post("/api/projects/:projectId/equipment/cctv", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireProjectEquipmentAccess(req, "create");
    requireProjectEquipmentBetaScope(req);

    const result = await projectEquipmentService.createCctv({
      tenantId,
      userId,
      projectId: req.params.projectId,
      input: req.body,
    });

    res.status(201).json({
      success: true,
      project: result.project,
      camera: result.camera,
    });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/equipment/cctv", "POST", error);
    next(error);
  }
});

router.patch("/api/projects/:projectId/equipment/cctv/:cameraRecordId", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireProjectEquipmentAccess(req, "update");
    requireProjectEquipmentBetaScope(req);

    const result = await projectEquipmentService.updateCctv({
      tenantId,
      userId,
      projectId: req.params.projectId,
      cameraRecordId: req.params.cameraRecordId,
      input: req.body,
    });

    res.status(200).json({
      success: true,
      project: result.project,
      camera: result.camera,
    });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/equipment/cctv/:cameraRecordId", "PATCH", error);
    next(error);
  }
});

router.delete("/api/projects/:projectId/equipment/cctv/:cameraRecordId", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireProjectEquipmentAccess(req, "delete");
    requireProjectEquipmentBetaScope(req);

    const result = await projectEquipmentService.archiveCctv({
      tenantId,
      userId,
      projectId: req.params.projectId,
      cameraRecordId: req.params.cameraRecordId,
    });

    res.status(200).json({
      success: true,
      project: result.project,
      camera: result.camera,
    });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/equipment/cctv/:cameraRecordId", "DELETE", error);
    next(error);
  }
});

module.exports = router;
