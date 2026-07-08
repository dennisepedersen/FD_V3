const Busboy = require("busboy");
const express = require("express");
const requireTenantHost = require("../../middleware/requireTenantHost");
const requireAuth = require("../../middleware/requireAuth");
const { createHttpError } = require("../../middleware/errorHandler");
const moduleAccessService = require("../../services/moduleAccessService");
const projectEquipmentService = require("./projectEquipment.service");
const fileStorageService = require("../../services/fileStorageService");

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


function parseSingleImageUpload(req) {
  return new Promise((resolve, reject) => {
    if (!String(req.headers["content-type"] || "").toLowerCase().includes("multipart/form-data")) {
      reject(createHttpError(400, "multipart_form_data_required"));
      return;
    }

    let busboy;
    try {
      busboy = Busboy({
        headers: req.headers,
        limits: {
          files: 1,
          fileSize: fileStorageService.getMaxUploadBytes(),
          fields: 4,
          parts: 6,
        },
      });
    } catch (_error) {
      reject(createHttpError(400, "invalid_multipart_request"));
      return;
    }

    let fileSeen = false;
    let fileTooLarge = false;
    let uploadError = null;
    let fileInfo = null;
    const chunks = [];

    busboy.on("file", (fieldName, file, info) => {
      if (fieldName !== "file") {
        file.resume();
        return;
      }
      if (fileSeen) {
        uploadError = createHttpError(400, "single_file_required");
        file.resume();
        return;
      }
      fileSeen = true;
      fileInfo = {
        filename: info?.filename || null,
        contentType: info?.mimeType || null,
      };
      file.on("data", (chunk) => chunks.push(chunk));
      file.on("limit", () => {
        fileTooLarge = true;
        file.resume();
      });
    });

    busboy.on("filesLimit", () => {
      uploadError = createHttpError(400, "single_file_required");
    });
    busboy.on("error", () => reject(createHttpError(400, "invalid_multipart_request")));
    busboy.on("finish", () => {
      if (uploadError) {
        reject(uploadError);
        return;
      }
      if (!fileSeen) {
        reject(createHttpError(400, "cctv_image_file_required"));
        return;
      }
      if (fileTooLarge) {
        reject(createHttpError(413, "cctv_image_too_large"));
        return;
      }
      resolve({
        filename: fileInfo?.filename || null,
        contentType: fileInfo?.contentType || null,
        buffer: Buffer.concat(chunks),
      });
    });

    req.pipe(busboy);
  });
}

function safeInlineFilename(filename) {
  const normalized = String(filename || "cctv-image").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  return normalized || "cctv-image";
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

function formatCctvMacForDisplay(value) {
  const raw = String(value || "").trim();
  const compact = raw.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(compact)) {
    return raw;
  }
  return compact.match(/.{1,2}/g).join(":");
}
function safeAttachmentFilename(value, fallback) {
  const normalized = String(value || fallback || "fielddesk-cctv")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
  return normalized || fallback || "fielddesk-cctv";
}
function buildCctvCsv(cameras) {
  const columns = ["camera_id", "mac", "serial_number", "model", "location", "status", "note"];
  const lines = [columns.join(",")];
  cameras.forEach((camera) => {
    lines.push([
      camera.camera_id,
      formatCctvMacForDisplay(camera.mac_address),
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

router.get("/api/projects/:projectId/equipment/cctv/export.pdf", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireProjectEquipmentAccess(req, "export");
    requireProjectEquipmentBetaScope(req);

    const result = await projectEquipmentService.exportCctvPdf({
      tenantId,
      userId,
      projectId: req.params.projectId,
    });

    const filenameRef = result.project?.external_project_ref || result.project?.project_id || "project";
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = safeAttachmentFilename(`Fielddesk-CCTV-${filenameRef}-${dateStamp}.pdf`, "Fielddesk-CCTV.pdf");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(result.pdf.length));
    res.status(200).send(result.pdf);
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/equipment/cctv/export.pdf", "GET", error);
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

router.get("/api/projects/:projectId/equipment/cctv/:cameraRecordId/images", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireProjectEquipmentAccess(req, "read");
    requireProjectEquipmentBetaScope(req);

    const result = await projectEquipmentService.listCctvImages({
      tenantId,
      userId,
      projectId: req.params.projectId,
      cameraRecordId: req.params.cameraRecordId,
    });

    res.status(200).json({
      success: true,
      project: result.project,
      camera: result.camera,
      slots: result.slots,
    });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/equipment/cctv/:cameraRecordId/images", "GET", error);
    next(error);
  }
});

router.post("/api/projects/:projectId/equipment/cctv/:cameraRecordId/images/:slotType", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireProjectEquipmentAccess(req, "update");
    requireProjectEquipmentBetaScope(req);
    const file = await parseSingleImageUpload(req);

    const result = await projectEquipmentService.uploadCctvImage({
      tenantId,
      userId,
      projectId: req.params.projectId,
      cameraRecordId: req.params.cameraRecordId,
      slotType: req.params.slotType,
      file,
    });

    res.status(result.replaced ? 200 : 201).json({
      success: true,
      project: result.project,
      camera: result.camera,
      slot: result.slot,
      replaced: result.replaced,
    });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/equipment/cctv/:cameraRecordId/images/:slotType", "POST", error);
    next(error);
  }
});

router.get("/api/projects/:projectId/equipment/cctv/:cameraRecordId/images/:slotType/content", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireProjectEquipmentAccess(req, "read");
    requireProjectEquipmentBetaScope(req);

    const result = await projectEquipmentService.getCctvImageContent({
      tenantId,
      userId,
      projectId: req.params.projectId,
      cameraRecordId: req.params.cameraRecordId,
      slotType: req.params.slotType,
    });

    res.setHeader("Content-Type", result.contentType || "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `inline; filename="${safeInlineFilename(result.image?.filename)}"`);
    if (result.contentLength != null) {
      res.setHeader("Content-Length", String(result.contentLength));
    }
    result.stream.on("error", next);
    result.stream.pipe(res);
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/equipment/cctv/:cameraRecordId/images/:slotType/content", "GET", error);
    next(error);
  }
});

router.delete("/api/projects/:projectId/equipment/cctv/:cameraRecordId/images/:slotType", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireProjectEquipmentAccess(req, "delete");
    requireProjectEquipmentBetaScope(req);

    const result = await projectEquipmentService.deleteCctvImage({
      tenantId,
      userId,
      projectId: req.params.projectId,
      cameraRecordId: req.params.cameraRecordId,
      slotType: req.params.slotType,
    });

    res.status(200).json({
      success: true,
      project: result.project,
      camera: result.camera,
      slot_type: result.slot_type,
      deleted: result.deleted,
    });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/equipment/cctv/:cameraRecordId/images/:slotType", "DELETE", error);
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
