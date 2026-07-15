const Busboy = require("busboy");
const express = require("express");
const requireTenantHost = require("../../middleware/requireTenantHost");
const requireAuth = require("../../middleware/requireAuth");
const { createHttpError } = require("../../middleware/errorHandler");
const moduleAccessService = require("../../services/moduleAccessService");
const fileStorageService = require("../../services/fileStorageService");
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

function safeInlineFilename(filename) {
  const normalized = String(filename || "restarbejde-file").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  return normalized || "restarbejde-file";
}

function parseSingleUpload(req, { fileRequiredKey = "restarbejde_file_required", fileTooLargeKey = "restarbejde_file_too_large", maxBytes = fileStorageService.getMaxUploadBytes() } = {}) {
  return new Promise((resolve, reject) => {
    if (!String(req.headers["content-type"] || "").toLowerCase().includes("multipart/form-data")) {
      reject(createHttpError(400, "multipart_form_data_required"));
      return;
    }

    let busboy;
    try {
      busboy = Busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: maxBytes, fields: 8, parts: 10 },
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
    const fields = {};

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
      fileInfo = { filename: info?.filename || null, contentType: info?.mimeType || null };
      file.on("data", (chunk) => chunks.push(chunk));
      file.on("limit", () => {
        fileTooLarge = true;
        file.resume();
      });
    });

    busboy.on("field", (name, value) => {
      fields[name] = value;
    });
    busboy.on("filesLimit", () => {
      uploadError = createHttpError(400, "single_file_required");
    });
    busboy.on("error", () => reject(createHttpError(400, "invalid_multipart_request")));
    busboy.on("finish", () => {
      if (uploadError) return reject(uploadError);
      if (!fileSeen) return reject(createHttpError(400, fileRequiredKey));
      if (fileTooLarge) return reject(createHttpError(413, fileTooLargeKey));
      resolve({ filename: fileInfo?.filename || null, contentType: fileInfo?.contentType || null, buffer: Buffer.concat(chunks), fields });
    });

    req.pipe(busboy);
  });
}

function getContentDispositionHeader(result, fallbackName) {
  const disposition = result.contentDisposition === "inline" ? "inline" : "attachment";
  const filename = safeInlineFilename(result.drawing?.original_filename || result.attachment?.original_filename || fallbackName);
  return `${disposition}; filename="${filename}"`;
}

function streamContent(res, next, result, fallbackName) {
  res.setHeader("Content-Type", result.contentType || "application/octet-stream");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Disposition", getContentDispositionHeader(result, fallbackName));
  if (result.contentLength != null) {
    res.setHeader("Content-Length", String(result.contentLength));
  }
  result.stream.on("error", next);
  result.stream.pipe(res);
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


router.get("/api/projects/:projectId/restarbejde/drawings", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireRestarbejdeAccess(req, "read");
    const showArchived = includeArchived(req.query?.include_archived);
    if (showArchived) requireRestarbejdeAccess(req, "manage_drawings");
    const result = await restarbejdeService.listDrawings({ tenantId, userId, projectId: req.params.projectId, includeArchived: showArchived });
    res.status(200).json({ success: true, project: result.project, drawings: result.drawings });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/restarbejde/drawings", "GET", error);
    next(error);
  }
});

router.post("/api/projects/:projectId/restarbejde/drawings", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireRestarbejdeAccess(req, "manage_drawings");
    const file = await parseSingleUpload(req, { fileRequiredKey: "restarbejde_drawing_file_required", fileTooLargeKey: "restarbejde_drawing_file_too_large", maxBytes: 50 * 1024 * 1024 });
    const result = await restarbejdeService.uploadDrawing({ tenantId, userId, projectId: req.params.projectId, file, title: file.fields?.title });
    res.status(201).json({ success: true, project: result.project, drawing: result.drawing });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/restarbejde/drawings", "POST", error);
    next(error);
  }
});

router.get("/api/projects/:projectId/restarbejde/drawings/:drawingId", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireRestarbejdeAccess(req, "read");
    const result = await restarbejdeService.getDrawing({ tenantId, userId, projectId: req.params.projectId, drawingId: req.params.drawingId });
    res.status(200).json({ success: true, project: result.project, drawing: result.drawing });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/restarbejde/drawings/:drawingId", "GET", error);
    next(error);
  }
});

router.get("/api/projects/:projectId/restarbejde/drawings/:drawingId/content", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireRestarbejdeAccess(req, "read");
    const result = await restarbejdeService.getDrawingContent({ tenantId, userId, projectId: req.params.projectId, drawingId: req.params.drawingId });
    streamContent(res, next, result, "restarbejde-drawing");
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/restarbejde/drawings/:drawingId/content", "GET", error);
    next(error);
  }
});

router.post("/api/projects/:projectId/restarbejde/drawings/:drawingId/archive", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireRestarbejdeAccess(req, "manage_drawings");
    const result = await restarbejdeService.archiveDrawing({ tenantId, userId, projectId: req.params.projectId, drawingId: req.params.drawingId });
    res.status(200).json({ success: true, project: result.project, drawing: result.drawing });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/restarbejde/drawings/:drawingId/archive", "POST", error);
    next(error);
  }
});

router.post("/api/projects/:projectId/restarbejde/drawings/:drawingId/restore", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireRestarbejdeAccess(req, "manage_drawings");
    const result = await restarbejdeService.restoreDrawing({ tenantId, userId, projectId: req.params.projectId, drawingId: req.params.drawingId });
    res.status(200).json({ success: true, project: result.project, drawing: result.drawing });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/restarbejde/drawings/:drawingId/restore", "POST", error);
    next(error);
  }
});

router.get("/api/projects/:projectId/restarbejde/drawings/:drawingId/placements", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireRestarbejdeAccess(req, "read");
    const result = await restarbejdeService.listPlacements({ tenantId, userId, projectId: req.params.projectId, drawingId: req.params.drawingId });
    res.status(200).json({ success: true, project: result.project, drawing: result.drawing, placements: result.placements });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/restarbejde/drawings/:drawingId/placements", "GET", error);
    next(error);
  }
});

router.post("/api/projects/:projectId/restarbejde/drawings/:drawingId/placements", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireRestarbejdeAccess(req, "manage_placements");
    const result = await restarbejdeService.createPlacement({ tenantId, userId, projectId: req.params.projectId, drawingId: req.params.drawingId, input: req.body });
    res.status(201).json({ success: true, project: result.project, drawing: result.drawing, placement: result.placement });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/restarbejde/drawings/:drawingId/placements", "POST", error);
    next(error);
  }
});

router.patch("/api/projects/:projectId/restarbejde/drawings/:drawingId/placements/:placementId", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireRestarbejdeAccess(req, "manage_placements");
    const result = await restarbejdeService.updatePlacement({ tenantId, userId, projectId: req.params.projectId, drawingId: req.params.drawingId, placementId: req.params.placementId, input: req.body });
    res.status(200).json({ success: true, project: result.project, drawing: result.drawing, placement: result.placement });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/restarbejde/drawings/:drawingId/placements/:placementId", "PATCH", error);
    next(error);
  }
});

router.post("/api/projects/:projectId/restarbejde/drawings/:drawingId/placements/:placementId/archive", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireRestarbejdeAccess(req, "manage_placements");
    const result = await restarbejdeService.archivePlacement({ tenantId, userId, projectId: req.params.projectId, drawingId: req.params.drawingId, placementId: req.params.placementId });
    res.status(200).json({ success: true, project: result.project, placement: result.placement });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/restarbejde/drawings/:drawingId/placements/:placementId/archive", "POST", error);
    next(error);
  }
});

router.post("/api/projects/:projectId/restarbejde/drawings/:drawingId/placements/:placementId/restore", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireRestarbejdeAccess(req, "restore");
    const result = await restarbejdeService.restorePlacement({ tenantId, userId, projectId: req.params.projectId, drawingId: req.params.drawingId, placementId: req.params.placementId });
    res.status(200).json({ success: true, project: result.project, placement: result.placement });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/restarbejde/drawings/:drawingId/placements/:placementId/restore", "POST", error);
    next(error);
  }
});

router.get("/api/projects/:projectId/restarbejde/items/:itemId/attachments", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireRestarbejdeAccess(req, "read");
    const result = await restarbejdeService.listAttachments({ tenantId, userId, projectId: req.params.projectId, itemId: req.params.itemId });
    res.status(200).json({ success: true, project: result.project, item: result.item, attachments: result.attachments });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/restarbejde/items/:itemId/attachments", "GET", error);
    next(error);
  }
});

router.post("/api/projects/:projectId/restarbejde/items/:itemId/attachments", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireRestarbejdeAccess(req, "manage_photos");
    const file = await parseSingleUpload(req, { fileRequiredKey: "restarbejde_attachment_file_required", fileTooLargeKey: "restarbejde_attachment_file_too_large", maxBytes: 25 * 1024 * 1024 });
    const result = await restarbejdeService.uploadAttachment({ tenantId, userId, projectId: req.params.projectId, itemId: req.params.itemId, file, attachmentType: file.fields?.attachment_type, caption: file.fields?.caption, allowNonPhoto: hasRestarbejdeAccess(req, "manage_drawings") });
    res.status(201).json({ success: true, project: result.project, item: result.item, attachment: result.attachment });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/restarbejde/items/:itemId/attachments", "POST", error);
    next(error);
  }
});

router.get("/api/projects/:projectId/restarbejde/items/:itemId/attachments/:attachmentId/content", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireRestarbejdeAccess(req, "read");
    const result = await restarbejdeService.getAttachmentContent({ tenantId, userId, projectId: req.params.projectId, itemId: req.params.itemId, attachmentId: req.params.attachmentId });
    streamContent(res, next, result, "restarbejde-attachment");
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/restarbejde/items/:itemId/attachments/:attachmentId/content", "GET", error);
    next(error);
  }
});

router.post("/api/projects/:projectId/restarbejde/items/:itemId/attachments/:attachmentId/archive", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireRestarbejdeAccess(req, "archive");
    const result = await restarbejdeService.archiveAttachment({ tenantId, userId, projectId: req.params.projectId, itemId: req.params.itemId, attachmentId: req.params.attachmentId });
    res.status(200).json({ success: true, project: result.project, item: result.item, attachment: result.attachment });
  } catch (error) {
    logRouteError(req, "/api/projects/:projectId/restarbejde/items/:itemId/attachments/:attachmentId/archive", "POST", error);
    next(error);
  }
});
router._test = { getContentDispositionHeader, parseSingleUpload, safeInlineFilename };
module.exports = router;
