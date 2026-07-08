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

const ALLOWED_STATUSES = new Set(["registered", "planned", "mounted", "checked", "deviation"]);
const CCTV_IMAGE_SLOTS = Object.freeze(["projection", "installation"]);
const CCTV_IMAGE_SLOT_LABELS = Object.freeze({
  projection: "Projektering",
  installation: "Installation",
});
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
module.exports = {
  archiveCctv,
  checkCctv,
  createCctv,
  deleteCctvImage,
  exportCctvCsv,
  getCctvImageContent,
  listCctvForProject,
  listCctvImages,
  normalizeMacAddress,
  updateCctv,
  uploadCctvImage,
};
