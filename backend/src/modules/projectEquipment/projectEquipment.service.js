const crypto = require("crypto");
const path = require("path");
const pool = require("../../db/pool");
const { withTransaction } = require("../../db/tx");
const { createHttpError } = require("../../middleware/errorHandler");
const auditService = require("../../services/auditService");
const storageObjectQueries = require("../../db/queries/storageObject");
const fileStorageService = require("../../services/fileStorageService");
const projectAccessService = require("../../services/projectAccessService");
const projectEquipmentRepository = require("./projectEquipment.repository");
const { buildCctvPdfReport } = require("./cctvPdfReport");

const ALLOWED_STATUSES = new Set(["registered", "planned", "mounted", "checked", "deviation"]);
const CCTV_IMAGE_SLOTS = Object.freeze(["projection", "installation"]);
const CCTV_IMAGE_SLOT_LABELS = Object.freeze({
  projection: "Projektering",
  installation: "Installation",
});
const MAX_CCTV_PDF_CAMERAS = 100;
const ALLOWED_IMAGE_TYPES = Object.freeze({
  "image/jpeg": Object.freeze([".jpg", ".jpeg"]),
  "image/png": Object.freeze([".png"]),
  "image/webp": Object.freeze([".webp"]),
});

function normalizeOptionalText(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeRequiredText(value, errorMessage) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw createHttpError(400, errorMessage);
  }
  return normalized;
}

function normalizeStatus(value) {
  const normalized = String(value || "registered").trim().toLowerCase() || "registered";
  if (!ALLOWED_STATUSES.has(normalized)) {
    throw createHttpError(400, "invalid_cctv_status");
  }
  return normalized;
}

function normalizeMacAddress(value) {
  const raw = normalizeOptionalText(value);
  if (!raw) {
    return {
      macAddress: null,
      macAddressNormalized: null,
    };
  }

  const normalized = raw.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(normalized)) {
    throw createHttpError(400, "invalid_mac_address");
  }

  return {
    macAddress: normalized.match(/.{1,2}/g).join(":"),
    macAddressNormalized: normalized,
  };
}

function normalizeCctvPayload(input, existing = null) {
  const body = input || {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);

  const macInput = has("mac_address")
    ? body.mac_address
    : has("mac")
      ? body.mac
      : existing?.mac_address;
  const mac = normalizeMacAddress(macInput);

  const cameraId = has("camera_id")
    ? normalizeRequiredText(body.camera_id, "camera_id_required")
    : has("visual_id")
      ? normalizeRequiredText(body.visual_id, "camera_id_required")
      : existing
        ? existing.camera_id
        : normalizeRequiredText(null, "camera_id_required");

  return {
    cameraId,
    macAddress: mac.macAddress,
    macAddressNormalized: mac.macAddressNormalized,
    serialNumber: has("serial_number")
      ? normalizeOptionalText(body.serial_number)
      : has("sn")
        ? normalizeOptionalText(body.sn)
        : existing?.serial_number || null,
    model: has("model")
      ? normalizeOptionalText(body.model)
      : has("type")
        ? normalizeOptionalText(body.type)
        : existing?.model || null,
    locationText: has("location_text")
      ? normalizeOptionalText(body.location_text)
      : has("location")
        ? normalizeOptionalText(body.location)
        : existing?.location_text || null,
    status: has("status") ? normalizeStatus(body.status) : existing?.status || "registered",
    note: has("note") ? normalizeOptionalText(body.note) : existing?.note || null,
  };
}

function getConflictField(conflict, payload) {
  if (payload.macAddressNormalized && conflict.mac_address_normalized === payload.macAddressNormalized) {
    return "mac_address";
  }
  if (
    payload.serialNumber
    && conflict.serial_number
    && String(conflict.serial_number).trim().toLowerCase() === String(payload.serialNumber).trim().toLowerCase()
  ) {
    return "serial_number";
  }
  return "unknown";
}

async function requireProject(client, { tenantId, userId, projectId }) {
  return projectAccessService.requireProjectAccess({
    client,
    tenantId,
    userId,
    projectId,
  });
}

async function assertNoActiveDuplicate(client, { tenantId, projectId, payload, excludeId }) {
  const conflict = await projectEquipmentRepository.findActiveConflict(client, {
    tenantId,
    projectId,
    macAddressNormalized: payload.macAddressNormalized,
    serialNumber: payload.serialNumber,
    excludeId,
  });

  if (!conflict) {
    return;
  }

  throw createHttpError(409, "project_equipment_cctv_duplicate", {
    field: getConflictField(conflict, payload),
    camera: {
      id: conflict.id,
      camera_id: conflict.camera_id,
      mac_address: conflict.mac_address,
      serial_number: conflict.serial_number,
      location_text: conflict.location_text,
      status: conflict.status,
    },
  });
}

function normalizeCctvImageSlot(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!CCTV_IMAGE_SLOTS.includes(normalized)) {
    throw createHttpError(400, "invalid_cctv_image_slot");
  }
  return normalized;
}

function normalizeImageContentType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_IMAGE_TYPES, normalized)) {
    throw createHttpError(400, "invalid_cctv_image_type");
  }
  return normalized;
}

function getOriginalFileExtension(filename) {
  const basename = path.basename(String(filename || "").trim()).toLowerCase();
  const ext = path.extname(basename);
  return ext || null;
}

function getStorageExtension({ contentType, originalFilename }) {
  const allowedExtensions = ALLOWED_IMAGE_TYPES[contentType] || [];
  const originalExt = getOriginalFileExtension(originalFilename);
  if (originalExt && !allowedExtensions.includes(originalExt)) {
    throw createHttpError(400, "invalid_cctv_image_extension");
  }
  return originalExt || allowedExtensions[0] || ".bin";
}

function validateCctvImageFile(file) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw createHttpError(400, "cctv_image_file_required");
  }
  const contentType = normalizeImageContentType(file.contentType);
  const maxBytes = fileStorageService.getMaxUploadBytes();
  if (file.buffer.length > maxBytes) {
    throw createHttpError(413, "cctv_image_too_large");
  }
  const extension = getStorageExtension({
    contentType,
    originalFilename: file.filename,
  });
  return {
    buffer: file.buffer,
    byteSize: file.buffer.length,
    contentType,
    extension,
    originalFilename: normalizeOptionalText(file.filename),
    checksumSha256: crypto.createHash("sha256").update(file.buffer).digest("hex"),
  };
}

function buildCctvImageStorageKey({ tenantId, projectId, cameraRecordId, slotType, extension }) {
  return [
    "tenants",
    tenantId,
    "projects",
    projectId,
    "project-equipment",
    "cctv",
    cameraRecordId,
    slotType,
    `${crypto.randomUUID()}${extension}`,
  ].join("/");
}

function validateCctvDrawingFile(file) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw createHttpError(400, "cctv_drawing_file_required");
  }
  const contentType = normalizeImageContentType(file.contentType);
  const maxBytes = fileStorageService.getMaxUploadBytes();
  if (file.buffer.length > maxBytes) {
    throw createHttpError(413, "cctv_drawing_too_large");
  }
  const extension = getStorageExtension({
    contentType,
    originalFilename: file.filename,
  });
  return {
    buffer: file.buffer,
    byteSize: file.buffer.length,
    contentType,
    extension,
    originalFilename: normalizeOptionalText(file.filename),
    checksumSha256: crypto.createHash("sha256").update(file.buffer).digest("hex"),
  };
}

function normalizeCctvDrawingTitle(value, fallbackFilename) {
  const title = normalizeOptionalText(value) || normalizeOptionalText(fallbackFilename) || "CCTV tegning";
  return title.slice(0, 160);
}

function buildCctvDrawingStorageKey({ tenantId, projectId, extension }) {
  return [
    "tenants",
    tenantId,
    "projects",
    projectId,
    "project-equipment",
    "cctv",
    "drawings",
    `${crypto.randomUUID()}${extension}`,
  ].join("/");
}

function normalizePercentCoordinate(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw createHttpError(400, `${fieldName}_invalid`);
  }
  return Number(number.toFixed(3));
}

function mapCctvDrawing(row) {
  if (!row) return null;
  return {
    id: row.drawing_id,
    title: row.title,
    storage_object_id: row.storage_object_id,
    filename: row.original_filename,
    content_type: row.content_type,
    byte_size: Number(row.byte_size || 0),
    pin_count: Number(row.pin_count || 0),
    uploaded_at: row.created_at,
    updated_at: row.updated_at,
    content_url: `/api/projects/${encodeURIComponent(row.project_id)}/equipment/cctv/drawings/${encodeURIComponent(row.drawing_id)}/content`,
  };
}

function mapCctvPin(row) {
  if (!row) return null;
  return {
    id: row.pin_id,
    drawing_id: row.drawing_id,
    camera_record_id: row.camera_record_id,
    x_percent: Number(row.x_percent),
    y_percent: Number(row.y_percent),
    label: row.label || row.camera_id || "Kamera",
    updated_at: row.updated_at,
    camera: {
      id: row.camera_record_id,
      camera_id: row.camera_id,
      mac_address: row.mac_address,
      serial_number: row.serial_number,
      model: row.model,
      location_text: row.location_text,
      status: row.status,
    },
  };
}
function mapCctvImage(row) {
  if (!row) return null;
  return {
    id: row.image_id,
    slot_type: row.slot_type,
    slot_label: CCTV_IMAGE_SLOT_LABELS[row.slot_type] || row.slot_type,
    has_image: true,
    storage_object_id: row.storage_object_id,
    filename: row.original_filename,
    content_type: row.content_type,
    byte_size: Number(row.byte_size || 0),
    uploaded_at: row.created_at,
    uploaded_by_user_id: row.created_by_user_id || null,
    content_url: `/api/projects/${encodeURIComponent(row.project_id)}/equipment/cctv/${encodeURIComponent(row.camera_record_id)}/images/${encodeURIComponent(row.slot_type)}/content`,
  };
}

function buildCctvImageSlots(rows) {
  const slots = {
    projection: {
      slot_type: "projection",
      slot_label: CCTV_IMAGE_SLOT_LABELS.projection,
      has_image: false,
      content_url: null,
    },
    installation: {
      slot_type: "installation",
      slot_label: CCTV_IMAGE_SLOT_LABELS.installation,
      has_image: false,
      content_url: null,
    },
  };
  rows.forEach((row) => {
    const mapped = mapCctvImage(row);
    if (mapped && Object.prototype.hasOwnProperty.call(slots, mapped.slot_type)) {
      slots[mapped.slot_type] = mapped;
    }
  });
  return slots;
}

async function requireCctvCamera(client, { tenantId, projectId, cameraRecordId }) {
  const camera = await projectEquipmentRepository.findCctvById(client, {
    tenantId,
    projectId,
    cameraRecordId,
  });
  if (!camera) {
    throw createHttpError(404, "project_equipment_cctv_not_found");
  }
  return camera;
}

async function deleteBlobBestEffort(storageKey) {
  if (!storageKey) return;
  try {
    await fileStorageService.deleteObject({ key: storageKey });
  } catch (error) {
    console.warn("[projectEquipment.service] storage_delete_best_effort_failed", {
      error_message: error?.message || null,
    });
  }
}
async function logEquipmentAuditEvent(client, {
  tenantId,
  userId,
  eventType,
  resourceId,
  projectId,
  reason,
  metadata,
}) {
  await auditService.logAuditEvent({
    client,
    tenantId,
    actorId: userId,
    actorType: "tenant_user",
    actorScope: "tenant",
    moduleKey: "project_equipment_beta",
    eventType,
    resourceType: metadata?.resource_type || "project_equipment_cctv",
    resourceId,
    projectId,
    outcome: "success",
    reason,
    metadata: {
      actor_user_id: userId,
      ...metadata,
    },
  });
}

async function listCctvForProject({ tenantId, userId, projectId, query }) {
  const client = await pool.connect();
  try {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const [summary, cameras] = await Promise.all([
      projectEquipmentRepository.getCctvSummary(client, {
        tenantId,
        projectId: projectContext.projectId,
      }),
      projectEquipmentRepository.listCctvForProject(client, {
        tenantId,
        projectId: projectContext.projectId,
        query: normalizeOptionalText(query),
      }),
    ]);

    return {
      project: projectContext.project,
      summary,
      cameras,
    };
  } finally {
    client.release();
  }
}

async function createCctv({ tenantId, userId, projectId, input }) {
  const payload = normalizeCctvPayload(input);

  return withTransaction(async (client) => {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    await assertNoActiveDuplicate(client, {
      tenantId,
      projectId: projectContext.projectId,
      payload,
    });

    const camera = await projectEquipmentRepository.createCctv(client, {
      tenantId,
      projectId: projectContext.projectId,
      ...payload,
      actorUserId: userId,
    });

    await logEquipmentAuditEvent(client, {
      tenantId,
      userId,
      eventType: "project_equipment_cctv_created",
      resourceId: camera.id,
      projectId: projectContext.projectId,
      reason: "project_equipment_cctv_created",
      metadata: {
        camera_id: camera.camera_id,
        status: camera.status,
        has_mac_address: Boolean(camera.mac_address_normalized),
        has_serial_number: Boolean(camera.serial_number),
      },
    });

    return {
      project: projectContext.project,
      camera,
    };
  });
}

async function updateCctv({ tenantId, userId, projectId, cameraRecordId, input }) {
  return withTransaction(async (client) => {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const existing = await projectEquipmentRepository.findCctvById(client, {
      tenantId,
      projectId: projectContext.projectId,
      cameraRecordId,
    });

    if (!existing) {
      throw createHttpError(404, "project_equipment_cctv_not_found");
    }

    const payload = normalizeCctvPayload(input, existing);
    await assertNoActiveDuplicate(client, {
      tenantId,
      projectId: projectContext.projectId,
      payload,
      excludeId: cameraRecordId,
    });

    const camera = await projectEquipmentRepository.updateCctv(client, {
      tenantId,
      projectId: projectContext.projectId,
      cameraRecordId,
      ...payload,
      actorUserId: userId,
    });

    if (!camera) {
      throw createHttpError(404, "project_equipment_cctv_not_found");
    }

    await logEquipmentAuditEvent(client, {
      tenantId,
      userId,
      eventType: camera.status === "checked" && existing.status !== "checked"
        ? "project_equipment_cctv_checked"
        : "project_equipment_cctv_updated",
      resourceId: camera.id,
      projectId: projectContext.projectId,
      reason: "project_equipment_cctv_updated",
      metadata: {
        camera_id: camera.camera_id,
        previous_status: existing.status,
        new_status: camera.status,
        changed_mac_address: existing.mac_address_normalized !== camera.mac_address_normalized,
        changed_serial_number: existing.serial_number !== camera.serial_number,
      },
    });

    return {
      project: projectContext.project,
      camera,
    };
  });
}

async function archiveCctv({ tenantId, userId, projectId, cameraRecordId }) {
  return withTransaction(async (client) => {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const camera = await projectEquipmentRepository.archiveCctv(client, {
      tenantId,
      projectId: projectContext.projectId,
      cameraRecordId,
      actorUserId: userId,
    });

    if (!camera) {
      throw createHttpError(404, "project_equipment_cctv_not_found");
    }

    await logEquipmentAuditEvent(client, {
      tenantId,
      userId,
      eventType: "project_equipment_cctv_archived",
      resourceId: camera.id,
      projectId: projectContext.projectId,
      reason: "project_equipment_cctv_archived",
      metadata: {
        camera_id: camera.camera_id,
        status: camera.status,
      },
    });

    return {
      project: projectContext.project,
      camera,
    };
  });
}

async function checkCctv({ tenantId, userId, projectId, query }) {
  const normalizedQuery = normalizeRequiredText(query, "query_required");
  const mac = (() => {
    try {
      return normalizeMacAddress(normalizedQuery).macAddressNormalized;
    } catch (_error) {
      return null;
    }
  })();

  const client = await pool.connect();
  try {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const matches = await projectEquipmentRepository.searchCctv(client, {
      tenantId,
      projectId: projectContext.projectId,
      query: normalizedQuery,
      macAddressNormalized: mac,
      limit: 10,
    });

    const exactMatches = matches.filter((camera) => ["mac", "serial_number", "camera_id"].includes(camera.match_type));
    const selected = exactMatches[0] || (matches.length === 1 ? matches[0] : null);
    const warning = matches.length > 1
      ? "multiple_possible_matches"
      : selected && !["mac", "serial_number", "camera_id"].includes(selected.match_type)
        ? "partial_match"
        : null;

    return {
      project: projectContext.project,
      found: Boolean(selected),
      camera: selected || null,
      matches,
      warning,
    };
  } finally {
    client.release();
  }
}

function getSlotImage(slots, slotType) {
  return slots && Object.prototype.hasOwnProperty.call(slots, slotType) ? slots[slotType] : null;
}

function streamToBuffer(stream, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    stream.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(createHttpError(413, "cctv_pdf_image_too_large"));
        stream.destroy();
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

async function getExportedByLabel(client, { tenantId, userId }) {
  const { rows } = await client.query(
    `
      SELECT name, email, username
      FROM tenant_user
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, userId]
  );
  const user = rows[0] || null;
  return user?.name || user?.username || user?.email || userId;
}

async function hydrateCctvPdfImages({ imageRowsByCameraId }) {
  const maxBytes = fileStorageService.getMaxUploadBytes();
  const hydrated = new Map();

  for (const [cameraId, slots] of imageRowsByCameraId.entries()) {
    const cameraSlots = {};
    for (const slotType of CCTV_IMAGE_SLOTS) {
      const image = getSlotImage(slots, slotType);
      if (!image) {
        cameraSlots[slotType] = { hasImage: false };
        continue;
      }

      const slot = {
        hasImage: true,
        contentType: image.content_type,
        byteSize: Number(image.byte_size || 0),
        filename: image.original_filename || null,
        buffer: null,
      };

      try {
        const object = await fileStorageService.getObjectStream({ key: image.storage_key });
        slot.buffer = await streamToBuffer(object.stream, maxBytes);
      } catch (error) {
        console.warn("[projectEquipment.service] cctv_pdf_image_fetch_failed", {
          camera_record_id: cameraId,
          slot_type: slotType,
          error_message: error?.message || null,
        });
      }
      cameraSlots[slotType] = slot;
    }
    hydrated.set(cameraId, cameraSlots);
  }

  return hydrated;
}
async function exportCctvCsv({ tenantId, userId, projectId }) {
  const client = await pool.connect();
  try {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const cameras = await projectEquipmentRepository.listCctvForProject(client, {
      tenantId,
      projectId: projectContext.projectId,
    });

    await logEquipmentAuditEvent(client, {
      tenantId,
      userId,
      eventType: "project_equipment_cctv_exported",
      resourceId: projectContext.projectId,
      projectId: projectContext.projectId,
      reason: "project_equipment_cctv_exported",
      metadata: {
        row_count: cameras.length,
      },
    });

    return {
      project: projectContext.project,
      cameras,
    };
  } finally {
    client.release();
  }
}

async function exportCctvPdf({ tenantId, userId, projectId }) {
  const client = await pool.connect();
  try {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const cameras = await projectEquipmentRepository.listCctvForProject(client, {
      tenantId,
      projectId: projectContext.projectId,
    });

    if (cameras.length > MAX_CCTV_PDF_CAMERAS) {
      throw createHttpError(413, "cctv_pdf_camera_limit_exceeded");
    }

    const imageRows = await projectEquipmentRepository.listCctvImagesForProject(client, {
      tenantId,
      projectId: projectContext.projectId,
    });
    const imageRowsByCameraId = new Map();
    imageRows.forEach((row) => {
      const cameraId = String(row.camera_record_id);
      const slots = imageRowsByCameraId.get(cameraId) || {};
      slots[row.slot_type] = row;
      imageRowsByCameraId.set(cameraId, slots);
    });

    const hydratedImages = await hydrateCctvPdfImages({ imageRowsByCameraId });
    const reportCameras = cameras.map((camera) => ({
      ...camera,
      reportSlots: {
        projection: hydratedImages.get(String(camera.id))?.projection || { hasImage: false },
        installation: hydratedImages.get(String(camera.id))?.installation || { hasImage: false },
      },
    }));
    const exportedBy = await getExportedByLabel(client, { tenantId, userId });
    const generatedAt = new Date();
    const pdf = await buildCctvPdfReport({
      project: projectContext.project,
      cameras: reportCameras,
      generatedAt,
      exportedBy,
    });

    await logEquipmentAuditEvent(client, {
      tenantId,
      userId,
      eventType: "project_equipment_cctv_pdf_exported",
      resourceId: projectContext.projectId,
      projectId: projectContext.projectId,
      reason: "project_equipment_cctv_pdf_exported",
      metadata: {
        row_count: cameras.length,
        projection_image_count: reportCameras.filter((camera) => camera.reportSlots.projection.hasImage).length,
        installation_image_count: reportCameras.filter((camera) => camera.reportSlots.installation.hasImage).length,
        byte_size: pdf.length,
      },
    });

    return {
      project: projectContext.project,
      generatedAt,
      pdf,
    };
  } finally {
    client.release();
  }
}
async function listCctvImages({ tenantId, userId, projectId, cameraRecordId }) {
  const client = await pool.connect();
  try {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const camera = await requireCctvCamera(client, {
      tenantId,
      projectId: projectContext.projectId,
      cameraRecordId,
    });
    const rows = await projectEquipmentRepository.listCctvImagesForCamera(client, {
      tenantId,
      projectId: projectContext.projectId,
      cameraRecordId: camera.id,
    });

    return {
      project: projectContext.project,
      camera,
      slots: buildCctvImageSlots(rows),
    };
  } finally {
    client.release();
  }
}

async function uploadCctvImage({ tenantId, userId, projectId, cameraRecordId, slotType, file }) {
  const normalizedSlotType = normalizeCctvImageSlot(slotType);
  const imageFile = validateCctvImageFile(file);
  let uploadedObject = null;
  let replacedStorageKey = null;

  try {
    const result = await withTransaction(async (client) => {
      const projectContext = await requireProject(client, { tenantId, userId, projectId });
      const camera = await requireCctvCamera(client, {
        tenantId,
        projectId: projectContext.projectId,
        cameraRecordId,
      });
      const existingImage = await projectEquipmentRepository.findCctvImageSlot(client, {
        tenantId,
        projectId: projectContext.projectId,
        cameraRecordId: camera.id,
        slotType: normalizedSlotType,
      });
      const storageKey = buildCctvImageStorageKey({
        tenantId,
        projectId: projectContext.projectId,
        cameraRecordId: camera.id,
        slotType: normalizedSlotType,
        extension: imageFile.extension,
      });

      uploadedObject = await fileStorageService.putObject({
        tenantId,
        projectId: projectContext.projectId,
        key: storageKey,
        buffer: imageFile.buffer,
        contentType: imageFile.contentType,
        metadata: {
          module_key: "project_equipment_beta",
          resource_type: "project_equipment_cctv_image",
          camera_record_id: camera.id,
          camera_id: camera.camera_id,
          slot_type: normalizedSlotType,
        },
      });

      const deletedPrevious = existingImage
        ? await projectEquipmentRepository.softDeleteCctvImageSlot(client, {
          tenantId,
          projectId: projectContext.projectId,
          cameraRecordId: camera.id,
          slotType: normalizedSlotType,
          actorUserId: userId,
        })
        : null;
      replacedStorageKey = deletedPrevious?.storage_key || null;

      const storageObject = await storageObjectQueries.insertStorageObject(client, {
        tenantId,
        projectId: projectContext.projectId,
        moduleKey: "project_equipment_beta",
        resourceType: "project_equipment_cctv_image",
        resourceId: camera.id,
        storageProvider: uploadedObject.provider,
        storageKey: uploadedObject.key,
        originalFilename: imageFile.originalFilename,
        contentType: imageFile.contentType,
        byteSize: imageFile.byteSize,
        checksumSha256: imageFile.checksumSha256,
        metadata: {
          slot_type: normalizedSlotType,
          camera_record_id: camera.id,
          camera_id: camera.camera_id,
        },
        actorUserId: userId,
      });

      const image = await projectEquipmentRepository.insertCctvImageSlot(client, {
        tenantId,
        projectId: projectContext.projectId,
        cameraRecordId: camera.id,
        storageObjectId: storageObject.id,
        slotType: normalizedSlotType,
        actorUserId: userId,
      });

      const imageRow = {
        ...image,
        storage_provider: storageObject.storage_provider,
        storage_key: storageObject.storage_key,
        original_filename: storageObject.original_filename,
        content_type: storageObject.content_type,
        byte_size: storageObject.byte_size,
        checksum_sha256: storageObject.checksum_sha256,
        metadata: storageObject.metadata,
      };

      await logEquipmentAuditEvent(client, {
        tenantId,
        userId,
        eventType: existingImage ? "project_equipment_cctv_image_replaced" : "project_equipment_cctv_image_uploaded",
        resourceId: image.image_id,
        projectId: projectContext.projectId,
        reason: existingImage ? "project_equipment_cctv_image_replaced" : "project_equipment_cctv_image_uploaded",
        metadata: {
          resource_type: "project_equipment_cctv_image",
          camera_record_id: camera.id,
          camera_id: camera.camera_id,
          slot_type: normalizedSlotType,
          storage_object_id: storageObject.id,
          content_type: storageObject.content_type,
          byte_size: Number(storageObject.byte_size || 0),
        },
      });

      return {
        project: projectContext.project,
        camera,
        slot: mapCctvImage(imageRow),
        replaced: Boolean(existingImage),
      };
    });

    await deleteBlobBestEffort(replacedStorageKey);
    return result;
  } catch (error) {
    if (uploadedObject?.key) {
      await deleteBlobBestEffort(uploadedObject.key);
    }
    throw error;
  }
}

async function getCctvImageContent({ tenantId, userId, projectId, cameraRecordId, slotType }) {
  const normalizedSlotType = normalizeCctvImageSlot(slotType);
  const client = await pool.connect();
  try {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const camera = await requireCctvCamera(client, {
      tenantId,
      projectId: projectContext.projectId,
      cameraRecordId,
    });
    const image = await projectEquipmentRepository.findCctvImageSlot(client, {
      tenantId,
      projectId: projectContext.projectId,
      cameraRecordId: camera.id,
      slotType: normalizedSlotType,
    });
    if (!image) {
      throw createHttpError(404, "project_equipment_cctv_image_not_found");
    }

    const object = await fileStorageService.getObjectStream({ key: image.storage_key });
    return {
      image: mapCctvImage(image),
      contentType: image.content_type || object.contentType,
      contentLength: image.byte_size || object.contentLength,
      stream: object.stream,
    };
  } finally {
    client.release();
  }
}

async function deleteCctvImage({ tenantId, userId, projectId, cameraRecordId, slotType }) {
  const normalizedSlotType = normalizeCctvImageSlot(slotType);
  let deletedStorageKey = null;
  const result = await withTransaction(async (client) => {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const camera = await requireCctvCamera(client, {
      tenantId,
      projectId: projectContext.projectId,
      cameraRecordId,
    });
    const deleted = await projectEquipmentRepository.softDeleteCctvImageSlot(client, {
      tenantId,
      projectId: projectContext.projectId,
      cameraRecordId: camera.id,
      slotType: normalizedSlotType,
      actorUserId: userId,
    });
    if (!deleted) {
      throw createHttpError(404, "project_equipment_cctv_image_not_found");
    }
    deletedStorageKey = deleted.storage_key;

    await logEquipmentAuditEvent(client, {
      tenantId,
      userId,
      eventType: "project_equipment_cctv_image_deleted",
      resourceId: camera.id,
      projectId: projectContext.projectId,
      reason: "project_equipment_cctv_image_deleted",
      metadata: {
        resource_type: "project_equipment_cctv_image",
        camera_record_id: camera.id,
        camera_id: camera.camera_id,
        slot_type: normalizedSlotType,
        storage_object_id: deleted.storage_object_id,
      },
    });

    return {
      project: projectContext.project,
      camera,
      slot_type: normalizedSlotType,
      deleted: true,
    };
  });

  await deleteBlobBestEffort(deletedStorageKey);
  return result;
}

async function listCctvDrawings({ tenantId, userId, projectId }) {
  const client = await pool.connect();
  try {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const drawings = await projectEquipmentRepository.listCctvDrawingsForProject(client, {
      tenantId,
      projectId: projectContext.projectId,
    });
    return {
      project: projectContext.project,
      drawings: drawings.map(mapCctvDrawing),
    };
  } finally {
    client.release();
  }
}

async function uploadCctvDrawing({ tenantId, userId, projectId, file, title }) {
  const drawingFile = validateCctvDrawingFile(file);
  const drawingTitle = normalizeCctvDrawingTitle(title, drawingFile.originalFilename);
  let uploadedObject = null;

  try {
    const result = await withTransaction(async (client) => {
      const projectContext = await requireProject(client, { tenantId, userId, projectId });
      const storageKey = buildCctvDrawingStorageKey({
        tenantId,
        projectId: projectContext.projectId,
        extension: drawingFile.extension,
      });

      uploadedObject = await fileStorageService.putObject({
        tenantId,
        projectId: projectContext.projectId,
        key: storageKey,
        buffer: drawingFile.buffer,
        contentType: drawingFile.contentType,
        metadata: {
          module_key: "project_equipment_beta",
          resource_type: "project_equipment_cctv_drawing",
          title: drawingTitle,
        },
      });

      const storageObject = await storageObjectQueries.insertStorageObject(client, {
        tenantId,
        projectId: projectContext.projectId,
        moduleKey: "project_equipment_beta",
        resourceType: "project_equipment_cctv_drawing",
        resourceId: projectContext.projectId,
        storageProvider: uploadedObject.provider,
        storageKey: uploadedObject.key,
        originalFilename: drawingFile.originalFilename,
        contentType: drawingFile.contentType,
        byteSize: drawingFile.byteSize,
        checksumSha256: drawingFile.checksumSha256,
        metadata: { title: drawingTitle },
        actorUserId: userId,
      });

      const drawing = await projectEquipmentRepository.insertCctvDrawing(client, {
        tenantId,
        projectId: projectContext.projectId,
        storageObjectId: storageObject.id,
        title: drawingTitle,
        actorUserId: userId,
      });

      await logEquipmentAuditEvent(client, {
        tenantId,
        userId,
        eventType: "project_equipment_cctv_drawing_uploaded",
        resourceId: drawing.drawing_id,
        projectId: projectContext.projectId,
        reason: "project_equipment_cctv_drawing_uploaded",
        metadata: {
          resource_type: "project_equipment_cctv_drawing",
          drawing_id: drawing.drawing_id,
          storage_object_id: storageObject.id,
          content_type: storageObject.content_type,
          byte_size: Number(storageObject.byte_size || 0),
        },
      });

      return {
        project: projectContext.project,
        drawing: mapCctvDrawing({
          ...drawing,
          storage_provider: storageObject.storage_provider,
          storage_key: storageObject.storage_key,
          original_filename: storageObject.original_filename,
          content_type: storageObject.content_type,
          byte_size: storageObject.byte_size,
          checksum_sha256: storageObject.checksum_sha256,
          metadata: storageObject.metadata,
          pin_count: 0,
        }),
      };
    });

    return result;
  } catch (error) {
    if (uploadedObject?.key) {
      await deleteBlobBestEffort(uploadedObject.key);
    }
    throw error;
  }
}

async function getCctvDrawingContent({ tenantId, userId, projectId, drawingId }) {
  const client = await pool.connect();
  try {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const drawing = await projectEquipmentRepository.findCctvDrawingById(client, {
      tenantId,
      projectId: projectContext.projectId,
      drawingId,
    });
    if (!drawing) {
      throw createHttpError(404, "project_equipment_cctv_drawing_not_found");
    }
    const object = await fileStorageService.getObjectStream({ key: drawing.storage_key });
    return {
      drawing: mapCctvDrawing(drawing),
      contentType: drawing.content_type || object.contentType,
      contentLength: drawing.byte_size || object.contentLength,
      stream: object.stream,
    };
  } finally {
    client.release();
  }
}

async function deleteCctvDrawing({ tenantId, userId, projectId, drawingId }) {
  let deletedStorageKey = null;
  const result = await withTransaction(async (client) => {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const deleted = await projectEquipmentRepository.softDeleteCctvDrawing(client, {
      tenantId,
      projectId: projectContext.projectId,
      drawingId,
      actorUserId: userId,
    });
    if (!deleted) {
      throw createHttpError(404, "project_equipment_cctv_drawing_not_found");
    }
    deletedStorageKey = deleted.storage_key;

    await logEquipmentAuditEvent(client, {
      tenantId,
      userId,
      eventType: "project_equipment_cctv_drawing_deleted",
      resourceId: deleted.drawing_id,
      projectId: projectContext.projectId,
      reason: "project_equipment_cctv_drawing_deleted",
      metadata: {
        resource_type: "project_equipment_cctv_drawing",
        drawing_id: deleted.drawing_id,
        storage_object_id: deleted.storage_object_id,
      },
    });

    return {
      project: projectContext.project,
      drawing_id: deleted.drawing_id,
      deleted: true,
    };
  });

  await deleteBlobBestEffort(deletedStorageKey);
  return result;
}

async function listCctvPins({ tenantId, userId, projectId, drawingId }) {
  const client = await pool.connect();
  try {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const drawing = await projectEquipmentRepository.findCctvDrawingById(client, {
      tenantId,
      projectId: projectContext.projectId,
      drawingId,
    });
    if (!drawing) {
      throw createHttpError(404, "project_equipment_cctv_drawing_not_found");
    }
    const pins = await projectEquipmentRepository.listCctvPinsForDrawing(client, {
      tenantId,
      projectId: projectContext.projectId,
      drawingId: drawing.drawing_id,
    });
    return {
      project: projectContext.project,
      drawing: mapCctvDrawing(drawing),
      pins: pins.map(mapCctvPin),
    };
  } finally {
    client.release();
  }
}

function normalizePinPayload(input, existing = null) {
  const body = input || {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  const xPercent = has("x_percent") ? normalizePercentCoordinate(body.x_percent, "x_percent") : Number(existing?.x_percent);
  const yPercent = has("y_percent") ? normalizePercentCoordinate(body.y_percent, "y_percent") : Number(existing?.y_percent);
  if (!Number.isFinite(xPercent) || !Number.isFinite(yPercent)) {
    throw createHttpError(400, "pin_coordinates_required");
  }
  return {
    xPercent,
    yPercent,
    label: has("label") ? normalizeOptionalText(body.label) : existing?.label || null,
  };
}

async function saveCctvPin({ tenantId, userId, projectId, drawingId, input }) {
  return withTransaction(async (client) => {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const drawing = await projectEquipmentRepository.findCctvDrawingById(client, {
      tenantId,
      projectId: projectContext.projectId,
      drawingId,
    });
    if (!drawing) {
      throw createHttpError(404, "project_equipment_cctv_drawing_not_found");
    }
    const cameraRecordId = normalizeRequiredText(input?.camera_record_id || input?.cameraRecordId, "camera_record_id_required");
    const camera = await requireCctvCamera(client, {
      tenantId,
      projectId: projectContext.projectId,
      cameraRecordId,
    });
    const payload = normalizePinPayload(input);
    const label = payload.label || camera.camera_id;
    const existing = await projectEquipmentRepository.findActiveCctvPinForCameraDrawing(client, {
      tenantId,
      projectId: projectContext.projectId,
      drawingId: drawing.drawing_id,
      cameraRecordId: camera.id,
    });
    const saved = existing
      ? await projectEquipmentRepository.updateCctvPin(client, {
        tenantId,
        projectId: projectContext.projectId,
        drawingId: drawing.drawing_id,
        pinId: existing.pin_id,
        ...payload,
        label,
        actorUserId: userId,
      })
      : await projectEquipmentRepository.insertCctvPin(client, {
        tenantId,
        projectId: projectContext.projectId,
        drawingId: drawing.drawing_id,
        cameraRecordId: camera.id,
        ...payload,
        label,
        actorUserId: userId,
      });

    const pin = await projectEquipmentRepository.findCctvPinById(client, {
      tenantId,
      projectId: projectContext.projectId,
      drawingId: drawing.drawing_id,
      pinId: saved.pin_id,
    });

    await logEquipmentAuditEvent(client, {
      tenantId,
      userId,
      eventType: existing ? "project_equipment_cctv_pin_updated" : "project_equipment_cctv_pin_created",
      resourceId: saved.pin_id,
      projectId: projectContext.projectId,
      reason: existing ? "project_equipment_cctv_pin_updated" : "project_equipment_cctv_pin_created",
      metadata: {
        resource_type: "project_equipment_cctv_pin",
        drawing_id: drawing.drawing_id,
        camera_record_id: camera.id,
        camera_id: camera.camera_id,
        x_percent: payload.xPercent,
        y_percent: payload.yPercent,
      },
    });

    return {
      project: projectContext.project,
      drawing: mapCctvDrawing(drawing),
      pin: mapCctvPin(pin),
      updated: Boolean(existing),
    };
  });
}

async function updateCctvPin({ tenantId, userId, projectId, drawingId, pinId, input }) {
  return withTransaction(async (client) => {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const drawing = await projectEquipmentRepository.findCctvDrawingById(client, {
      tenantId,
      projectId: projectContext.projectId,
      drawingId,
    });
    if (!drawing) {
      throw createHttpError(404, "project_equipment_cctv_drawing_not_found");
    }
    const existing = await projectEquipmentRepository.findCctvPinById(client, {
      tenantId,
      projectId: projectContext.projectId,
      drawingId: drawing.drawing_id,
      pinId,
    });
    if (!existing) {
      throw createHttpError(404, "project_equipment_cctv_pin_not_found");
    }
    const payload = normalizePinPayload(input, existing);
    const saved = await projectEquipmentRepository.updateCctvPin(client, {
      tenantId,
      projectId: projectContext.projectId,
      drawingId: drawing.drawing_id,
      pinId,
      ...payload,
      actorUserId: userId,
    });
    const pin = await projectEquipmentRepository.findCctvPinById(client, {
      tenantId,
      projectId: projectContext.projectId,
      drawingId: drawing.drawing_id,
      pinId: saved.pin_id,
    });

    await logEquipmentAuditEvent(client, {
      tenantId,
      userId,
      eventType: "project_equipment_cctv_pin_updated",
      resourceId: saved.pin_id,
      projectId: projectContext.projectId,
      reason: "project_equipment_cctv_pin_updated",
      metadata: {
        resource_type: "project_equipment_cctv_pin",
        drawing_id: drawing.drawing_id,
        camera_record_id: pin.camera_record_id,
        x_percent: payload.xPercent,
        y_percent: payload.yPercent,
      },
    });

    return {
      project: projectContext.project,
      drawing: mapCctvDrawing(drawing),
      pin: mapCctvPin(pin),
    };
  });
}

async function deleteCctvPin({ tenantId, userId, projectId, drawingId, pinId }) {
  return withTransaction(async (client) => {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const drawing = await projectEquipmentRepository.findCctvDrawingById(client, {
      tenantId,
      projectId: projectContext.projectId,
      drawingId,
    });
    if (!drawing) {
      throw createHttpError(404, "project_equipment_cctv_drawing_not_found");
    }
    const deleted = await projectEquipmentRepository.softDeleteCctvPin(client, {
      tenantId,
      projectId: projectContext.projectId,
      drawingId: drawing.drawing_id,
      pinId,
      actorUserId: userId,
    });
    if (!deleted) {
      throw createHttpError(404, "project_equipment_cctv_pin_not_found");
    }

    await logEquipmentAuditEvent(client, {
      tenantId,
      userId,
      eventType: "project_equipment_cctv_pin_deleted",
      resourceId: deleted.pin_id,
      projectId: projectContext.projectId,
      reason: "project_equipment_cctv_pin_deleted",
      metadata: {
        resource_type: "project_equipment_cctv_pin",
        drawing_id: drawing.drawing_id,
        camera_record_id: deleted.camera_record_id,
      },
    });

    return {
      project: projectContext.project,
      drawing_id: drawing.drawing_id,
      pin_id: deleted.pin_id,
      deleted: true,
    };
  });
}
module.exports = {
  archiveCctv,
  checkCctv,
  createCctv,
  deleteCctvDrawing,
  deleteCctvImage,
  deleteCctvPin,
  exportCctvCsv,
  exportCctvPdf,
  getCctvDrawingContent,
  getCctvImageContent,
  listCctvDrawings,
  listCctvForProject,
  listCctvImages,
  listCctvPins,
  normalizeMacAddress,
  saveCctvPin,
  updateCctv,
  updateCctvPin,
  uploadCctvDrawing,
  uploadCctvImage,
};