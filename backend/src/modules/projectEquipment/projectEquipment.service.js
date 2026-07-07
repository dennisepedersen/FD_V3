const pool = require("../../db/pool");
const { withTransaction } = require("../../db/tx");
const { createHttpError } = require("../../middleware/errorHandler");
const auditService = require("../../services/auditService");
const projectAccessService = require("../../services/projectAccessService");
const projectEquipmentRepository = require("./projectEquipment.repository");

const ALLOWED_STATUSES = new Set(["registered", "planned", "mounted", "checked", "deviation"]);

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
    resourceType: "project_equipment_cctv",
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

module.exports = {
  archiveCctv,
  checkCctv,
  createCctv,
  exportCctvCsv,
  listCctvForProject,
  normalizeMacAddress,
  updateCctv,
};
