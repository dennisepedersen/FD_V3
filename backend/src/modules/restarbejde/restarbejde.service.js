const crypto = require("crypto");
const path = require("path");
const pool = require("../../db/pool");
const { withTransaction } = require("../../db/tx");
const { createHttpError } = require("../../middleware/errorHandler");
const auditService = require("../../services/auditService");
const storageObjectQueries = require("../../db/queries/storageObject");
const fileStorageService = require("../../services/fileStorageService");
const projectAccessService = require("../../services/projectAccessService");
const repository = require("./restarbejde.repository");

const MODULE_KEY = "project_restarbejde";
const ITEM_RESOURCE_TYPE = "project_restarbejde_item";
const DRAWING_RESOURCE_TYPE = "project_restarbejde_drawing";
const PLACEMENT_RESOURCE_TYPE = "project_restarbejde_placement";
const ATTACHMENT_RESOURCE_TYPE = "project_restarbejde_attachment";
const KINDS = Object.freeze(["internal_defect", "obs"]);
const INTERNAL_DEFECT_STATUSES = Object.freeze(["open", "in_progress", "ready_for_review", "closed"]);
const OBS_STATUSES = Object.freeze(["open", "monitoring", "blocking", "resolved"]);
const PRIORITIES = Object.freeze(["low", "normal", "high", "critical"]);
const RISKS = Object.freeze(["low", "medium", "high", "critical"]);
const CLIENT_MANAGED_IMPORT_FIELDS = Object.freeze(["source", "external_import_id", "external_import_payload"]);
const ALLOWED_IMAGE_TYPES = Object.freeze({
  "image/jpeg": Object.freeze([".jpg", ".jpeg"]),
  "image/png": Object.freeze([".png"]),
  "image/webp": Object.freeze([".webp"]),
});
const PDF_CONTENT_TYPE = "application/pdf";
const DEFAULT_PDF_MAX_UPLOAD_MB = 50;
const DEFAULT_DOCUMENT_MAX_UPLOAD_MB = 25;
const ATTACHMENT_TYPES = Object.freeze(["photo", "document", "other"]);
let pdfJsModulePromise = null;

function normalizeOptionalText(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeRequiredText(value, message) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) throw createHttpError(400, message);
  return normalized;
}

function getOriginalFileExtension(filename) {
  const basename = path.basename(String(filename || "").trim()).toLowerCase();
  return path.extname(basename) || null;
}

function getAllowedExtension({ contentType, originalFilename, allowedTypes, errorKey }) {
  const allowedExtensions = allowedTypes[contentType] || [];
  const originalExt = getOriginalFileExtension(originalFilename);
  if (originalExt && !allowedExtensions.includes(originalExt)) {
    throw createHttpError(400, errorKey);
  }
  return originalExt || allowedExtensions[0] || ".bin";
}

function getPdfMaxUploadBytes() {
  const configured = Number(process.env.FD_DRAWING_PDF_MAX_UPLOAD_MB || DEFAULT_PDF_MAX_UPLOAD_MB);
  const mb = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_PDF_MAX_UPLOAD_MB;
  return Math.floor(mb * 1024 * 1024);
}

function getDocumentMaxUploadBytes() {
  return Math.floor(DEFAULT_DOCUMENT_MAX_UPLOAD_MB * 1024 * 1024);
}

function validateUploadBuffer(file, requiredKey) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw createHttpError(400, requiredKey);
  }
}

function validateDrawingFile(file) {
  validateUploadBuffer(file, "restarbejde_drawing_file_required");
  const contentType = String(file.contentType || "").trim().toLowerCase();
  const originalFilename = normalizeOptionalText(file.filename);

  if (contentType === PDF_CONTENT_TYPE) {
    if (getOriginalFileExtension(originalFilename) !== ".pdf") {
      throw createHttpError(400, "invalid_restarbejde_drawing_extension");
    }
    if (file.buffer.length > getPdfMaxUploadBytes()) {
      throw createHttpError(413, "restarbejde_drawing_file_too_large");
    }
    return {
      buffer: file.buffer,
      byteSize: file.buffer.length,
      contentType,
      extension: ".pdf",
      originalFilename,
      sourceType: "pdf",
      checksumSha256: crypto.createHash("sha256").update(file.buffer).digest("hex"),
    };
  }

  if (!Object.prototype.hasOwnProperty.call(ALLOWED_IMAGE_TYPES, contentType)) {
    throw createHttpError(400, "invalid_restarbejde_drawing_mime");
  }
  if (file.buffer.length > fileStorageService.getMaxUploadBytes()) {
    throw createHttpError(413, "restarbejde_drawing_file_too_large");
  }
  const extension = getAllowedExtension({
    contentType,
    originalFilename,
    allowedTypes: ALLOWED_IMAGE_TYPES,
    errorKey: "invalid_restarbejde_drawing_extension",
  });
  return {
    buffer: file.buffer,
    byteSize: file.buffer.length,
    contentType,
    extension,
    originalFilename,
    sourceType: "image",
    checksumSha256: crypto.createHash("sha256").update(file.buffer).digest("hex"),
  };
}

function validateAttachmentFile(file, attachmentType) {
  validateUploadBuffer(file, "restarbejde_attachment_file_required");
  const contentType = String(file.contentType || "").trim().toLowerCase();
  const originalFilename = normalizeOptionalText(file.filename);
  if (attachmentType === "photo") {
    if (!Object.prototype.hasOwnProperty.call(ALLOWED_IMAGE_TYPES, contentType)) {
      throw createHttpError(400, "invalid_restarbejde_attachment_mime");
    }
    if (file.buffer.length > fileStorageService.getMaxUploadBytes()) {
      throw createHttpError(413, "restarbejde_attachment_file_too_large");
    }
    const extension = getAllowedExtension({
      contentType,
      originalFilename,
      allowedTypes: ALLOWED_IMAGE_TYPES,
      errorKey: "invalid_restarbejde_attachment_extension",
    });
    return { buffer: file.buffer, byteSize: file.buffer.length, contentType, extension, originalFilename, checksumSha256: crypto.createHash("sha256").update(file.buffer).digest("hex") };
  }
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(contentType)) {
    throw createHttpError(400, "invalid_restarbejde_attachment_mime");
  }
  if (file.buffer.length > getDocumentMaxUploadBytes()) {
    throw createHttpError(413, "restarbejde_attachment_file_too_large");
  }
  return {
    buffer: file.buffer,
    byteSize: file.buffer.length,
    contentType,
    extension: getOriginalFileExtension(originalFilename) || ".bin",
    originalFilename,
    checksumSha256: crypto.createHash("sha256").update(file.buffer).digest("hex"),
  };
}

async function getPdfJsModule() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfJsModulePromise;
}

async function getPdfPageCount(buffer) {
  const pdfjs = await getPdfJsModule();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true, isEvalSupported: false });
  const document = await loadingTask.promise;
  try {
    return Number(document.numPages || 0);
  } finally {
    await document.destroy();
  }
}

function normalizeTitle(value, fallback, errorKey = "restarbejde_title_required") {
  return normalizeRequiredText(normalizeOptionalText(value) || normalizeOptionalText(fallback), errorKey).slice(0, 160);
}

function normalizeAttachmentType(value) {
  const normalized = normalizeOptionalText(value) || "photo";
  if (!ATTACHMENT_TYPES.includes(normalized)) {
    throw createHttpError(400, "unsupported_restarbejde_attachment_type");
  }
  return normalized;
}

function normalizeLabel(value) {
  return normalizeOptionalText(value)?.slice(0, 80) || null;
}

function normalizePageNumber(value, drawing) {
  const pageNumber = Number(value == null || value === "" ? 1 : value);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw createHttpError(400, "invalid_restarbejde_page_number");
  }
  if (drawing?.source_type === "image" && pageNumber !== 1) {
    throw createHttpError(400, "invalid_restarbejde_page_number");
  }
  if (drawing?.page_count && pageNumber > Number(drawing.page_count)) {
    throw createHttpError(400, "invalid_restarbejde_page_number");
  }
  return pageNumber;
}

function normalizePercentCoordinate(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw createHttpError(400, "invalid_restarbejde_coordinate");
  }
  return Number(number.toFixed(3));
}

function buildStorageKey({ tenantId, projectId, category, resourceId, extension }) {
  return [
    "tenants",
    tenantId,
    "projects",
    projectId,
    "restarbejde",
    category,
    resourceId || "project",
    `${crypto.randomUUID()}${extension}`,
  ].join("/");
}

async function deleteBlobBestEffort(storageKey) {
  if (!storageKey) return;
  try {
    await fileStorageService.deleteObject({ key: storageKey });
  } catch (error) {
    console.warn("[restarbejde.service] storage_cleanup_failed", { storage_key: storageKey, error_message: error?.message || null });
  }
}

function mapDrawing(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    project_id: row.project_id,
    title: row.title,
    source_type: row.source_type,
    storage_object_id: row.storage_object_id,
    original_filename: row.original_filename,
    mime_type: row.mime_type || row.content_type,
    file_size_bytes: row.file_size_bytes == null ? Number(row.byte_size || 0) : Number(row.file_size_bytes),
    page_count: Number(row.page_count || 1),
    placement_count: row.placement_count == null ? undefined : Number(row.placement_count || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by_user_id: row.created_by_user_id,
    updated_by_user_id: row.updated_by_user_id,
    archived_at: row.archived_at,
    archived_by_user_id: row.archived_by_user_id,
    content_url: `/api/projects/${encodeURIComponent(row.project_id)}/restarbejde/drawings/${encodeURIComponent(row.id)}/content`,
  };
}

function mapPlacement(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    project_id: row.project_id,
    item_id: row.item_id,
    drawing_id: row.drawing_id,
    page_number: Number(row.page_number),
    x_percent: Number(row.x_percent),
    y_percent: Number(row.y_percent),
    label: row.label,
    item: row.item_title ? { id: row.item_id, kind: row.item_kind, title: row.item_title, status: row.item_status } : undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by_user_id: row.created_by_user_id,
    updated_by_user_id: row.updated_by_user_id,
    archived_at: row.archived_at,
    archived_by_user_id: row.archived_by_user_id,
  };
}

function mapAttachment(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    project_id: row.project_id,
    item_id: row.item_id,
    storage_object_id: row.storage_object_id,
    attachment_type: row.attachment_type,
    original_filename: row.original_filename,
    mime_type: row.mime_type || row.content_type,
    file_size_bytes: row.file_size_bytes == null ? Number(row.byte_size || 0) : Number(row.file_size_bytes),
    caption: row.caption,
    created_at: row.created_at,
    created_by_user_id: row.created_by_user_id,
    archived_at: row.archived_at,
    archived_by_user_id: row.archived_by_user_id,
    content_url: `/api/projects/${encodeURIComponent(row.project_id)}/restarbejde/items/${encodeURIComponent(row.item_id)}/attachments/${encodeURIComponent(row.id)}/content`,
  };
}

function normalizeOptionalUuid(value, message) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw createHttpError(400, message);
  }
  return normalized;
}

function normalizeKind(value, existing) {
  const normalized = normalizeOptionalText(value === undefined ? existing?.kind : value);
  if (!normalized || !KINDS.includes(normalized)) {
    throw createHttpError(400, "invalid_restarbejde_kind");
  }
  if (existing && normalized !== existing.kind) {
    throw createHttpError(400, "restarbejde_kind_immutable");
  }
  return normalized;
}

function normalizeStatus(value, kind, existing) {
  const normalized = normalizeOptionalText(value === undefined ? existing?.status : value) || "open";
  const allowed = kind === "internal_defect" ? INTERNAL_DEFECT_STATUSES : OBS_STATUSES;
  if (!allowed.includes(normalized)) {
    throw createHttpError(400, "invalid_restarbejde_status");
  }
  return normalized;
}

function normalizePriority(value, kind, existing) {
  if (kind === "obs") {
    if (value !== undefined && value !== null && normalizeOptionalText(value)) {
      throw createHttpError(400, "restarbejde_obs_priority_not_allowed");
    }
    return null;
  }
  const normalized = normalizeOptionalText(value === undefined ? existing?.priority : value) || "normal";
  if (!PRIORITIES.includes(normalized)) {
    throw createHttpError(400, "invalid_restarbejde_priority");
  }
  return normalized;
}

function normalizeRisk(value, kind, existing) {
  if (kind === "internal_defect") {
    if (value !== undefined && value !== null && normalizeOptionalText(value)) {
      throw createHttpError(400, "restarbejde_internal_defect_risk_not_allowed");
    }
    return null;
  }
  const normalized = normalizeOptionalText(value === undefined ? existing?.risk : value);
  if (!normalized) {
    throw createHttpError(400, "restarbejde_risk_required");
  }
  if (!RISKS.includes(normalized)) {
    throw createHttpError(400, "invalid_restarbejde_risk");
  }
  return normalized;
}

function normalizePercentComplete(value, kind, status, existing) {
  if (kind === "obs") {
    if (value !== undefined && value !== null && value !== "") {
      throw createHttpError(400, "restarbejde_obs_percent_not_allowed");
    }
    return null;
  }
  if (status === "closed") {
    return 100;
  }
  const raw = value === undefined || value === null || value === "" ? existing?.percent_complete ?? 0 : value;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw createHttpError(400, "invalid_restarbejde_percent_complete");
  }
  return parsed;
}

function normalizeOptionalDate(value) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw createHttpError(400, "invalid_restarbejde_deadline");
  }
  const [year, month, day] = normalized.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw createHttpError(400, "invalid_restarbejde_deadline");
  }
  return normalized;
}

function normalizeOptionalBoolean(value, message) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") throw createHttpError(400, message);
  return value;
}

function normalizeBoolean(value, message) {
  if (typeof value !== "boolean") throw createHttpError(400, message);
  return value;
}

function rejectClientManagedImportMetadata(body) {
  for (const field of CLIENT_MANAGED_IMPORT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      throw createHttpError(400, "restarbejde_import_metadata_server_managed");
    }
  }
}

function normalizeListFilters({ kind, status } = {}) {
  const normalizedKind = normalizeOptionalText(kind);
  if (normalizedKind && !KINDS.includes(normalizedKind)) {
    throw createHttpError(400, "invalid_restarbejde_kind_filter");
  }

  const normalizedStatus = normalizeOptionalText(status);
  if (!normalizedStatus) return { kind: normalizedKind, status: null };

  const allowedStatuses = normalizedKind === "internal_defect"
    ? INTERNAL_DEFECT_STATUSES
    : normalizedKind === "obs"
      ? OBS_STATUSES
      : [...new Set([...INTERNAL_DEFECT_STATUSES, ...OBS_STATUSES])];

  if (!allowedStatuses.includes(normalizedStatus)) {
    throw createHttpError(400, "invalid_restarbejde_status_filter");
  }

  return { kind: normalizedKind, status: normalizedStatus };
}

function normalizePayload(input, { existing = null, actorUserId, canCloseInternalDefect = false } = {}) {
  const body = input || {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  rejectClientManagedImportMetadata(body);
  const kind = normalizeKind(has("kind") ? body.kind : undefined, existing);
  const status = normalizeStatus(has("status") ? body.status : undefined, kind, existing);
  const isClosingInternal = kind === "internal_defect" && status === "closed";
  const isLeavingClosedInternal = existing?.kind === "internal_defect" && existing?.status === "closed" && status !== "closed";

  if ((isClosingInternal || isLeavingClosedInternal) && !canCloseInternalDefect) {
    throw createHttpError(403, "restarbejde_internal_defect_close_denied");
  }

  const closedAt = isClosingInternal ? existing?.closed_at || new Date().toISOString() : null;
  const closedByUserId = isClosingInternal ? existing?.closed_by_user_id || actorUserId : null;

  return {
    kind,
    title: has("title") ? normalizeRequiredText(body.title, "restarbejde_title_required") : existing?.title || normalizeRequiredText(null, "restarbejde_title_required"),
    description: has("description") ? normalizeOptionalText(body.description) : existing?.description || null,
    tradeKey: has("trade_key") ? normalizeRequiredText(body.trade_key, "restarbejde_trade_key_required") : existing?.trade_key || normalizeRequiredText(null, "restarbejde_trade_key_required"),
    status,
    priority: normalizePriority(has("priority") ? body.priority : undefined, kind, existing),
    risk: normalizeRisk(has("risk") ? body.risk : undefined, kind, existing),
    locationText: has("location_text") ? normalizeOptionalText(body.location_text) : existing?.location_text || null,
    assignedTenantUserId: has("assigned_tenant_user_id") ? normalizeOptionalUuid(body.assigned_tenant_user_id, "invalid_restarbejde_assigned_user") : existing?.assigned_tenant_user_id || null,
    responsibleText: has("responsible_text") ? normalizeOptionalText(body.responsible_text) : existing?.responsible_text || null,
    deadline: has("deadline") ? normalizeOptionalDate(body.deadline) : existing?.deadline || null,
    percentComplete: normalizePercentComplete(has("percent_complete") ? body.percent_complete : undefined, kind, status, existing),
    externalParty: has("external_party") ? normalizeOptionalText(body.external_party) : existing?.external_party || null,
    blocksDelivery: has("blocks_delivery") ? normalizeBoolean(body.blocks_delivery, "invalid_restarbejde_blocks_delivery") : Boolean(existing?.blocks_delivery),
    escalated: has("escalated") ? normalizeBoolean(body.escalated, "invalid_restarbejde_escalated") : Boolean(existing?.escalated),
    canInternalTeamAct: has("can_internal_team_act") ? normalizeOptionalBoolean(body.can_internal_team_act, "invalid_restarbejde_can_internal_team_act") : existing?.can_internal_team_act ?? null,
    comment: has("comment") ? normalizeOptionalText(body.comment) : existing?.comment || null,
    source: existing?.source || null,
    externalImportId: existing?.external_import_id || null,
    externalImportPayload: existing?.external_import_payload || {},
    closedAt,
    closedByUserId,
  };
}

function mapItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    project_id: row.project_id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    trade_key: row.trade_key,
    status: row.status,
    priority: row.priority,
    risk: row.risk,
    location_text: row.location_text,
    assigned_tenant_user_id: row.assigned_tenant_user_id,
    responsible_text: row.responsible_text,
    deadline: row.deadline,
    percent_complete: row.percent_complete == null ? null : Number(row.percent_complete),
    external_party: row.external_party,
    blocks_delivery: Boolean(row.blocks_delivery),
    escalated: Boolean(row.escalated),
    can_internal_team_act: row.can_internal_team_act,
    comment: row.comment,
    source: row.source,
    external_import_id: row.external_import_id,
    external_import_payload: row.external_import_payload || {},
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by_user_id: row.created_by_user_id,
    updated_by_user_id: row.updated_by_user_id,
    closed_at: row.closed_at,
    closed_by_user_id: row.closed_by_user_id,
    archived_at: row.archived_at,
    archived_by_user_id: row.archived_by_user_id,
  };
}

function mapSummary(row) {
  const internalCount = Number(row?.internal_defect_count || 0);
  const progressValue = row?.internal_defect_progress == null ? null : Math.round(Number(row.internal_defect_progress));
  return {
    internal_defect_count: internalCount,
    internal_defect_closed_count: Number(row?.internal_defect_closed_count || 0),
    progress_percent: internalCount > 0 ? progressValue : null,
    progress_contract: "null_when_no_active_internal_defects",
    obs_count: Number(row?.obs_count || 0),
    archived_count: Number(row?.archived_count || 0),
  };
}

async function requireProject(client, { tenantId, userId, projectId }) {
  return projectAccessService.requireProjectAccess({ client, tenantId, userId, projectId });
}

async function audit(client, { tenantId, userId, eventType, resourceType = ITEM_RESOURCE_TYPE, resourceId, projectId, metadata }) {
  await auditService.logAuditEvent({
    client,
    tenantId,
    actorId: userId,
    actorType: "tenant_user",
    actorScope: "tenant",
    moduleKey: MODULE_KEY,
    eventType,
    resourceType,
    resourceId,
    projectId,
    outcome: "success",
    reason: eventType,
    metadata,
  });
}

async function listItems({ tenantId, userId, projectId, includeArchived = false, kind, status }) {
  const filters = normalizeListFilters({ kind, status });
  const client = await pool.connect();
  try {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const rows = await repository.listItems(client, {
      tenantId,
      projectId: projectContext.projectId,
      includeArchived,
      kind: filters.kind,
      status: filters.status,
    });
    return { project: projectContext.project, items: rows.map(mapItem) };
  } finally {
    client.release();
  }
}

async function getItem({ tenantId, userId, projectId, itemId }) {
  const client = await pool.connect();
  try {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const row = await repository.findItemById(client, { tenantId, projectId: projectContext.projectId, itemId, includeArchived: false });
    if (!row) throw createHttpError(404, "restarbejde_item_not_found");
    return { project: projectContext.project, item: mapItem(row) };
  } finally {
    client.release();
  }
}

async function createItem({ tenantId, userId, projectId, input, canCloseInternalDefect = false }) {
  return withTransaction(async (client) => {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const payload = normalizePayload(input, { actorUserId: userId, canCloseInternalDefect });
    const row = await repository.insertItem(client, {
      tenantId,
      projectId: projectContext.projectId,
      payload,
      actorUserId: userId,
    });
    await audit(client, {
      tenantId,
      userId,
      eventType: "restarbejde.item_created",
      resourceId: row.id,
      projectId: projectContext.projectId,
      metadata: { kind: row.kind, status: row.status, title: row.title },
    });
    if (row.status === "closed") {
      await audit(client, {
        tenantId,
        userId,
        eventType: "restarbejde.item_status_changed",
        resourceId: row.id,
        projectId: projectContext.projectId,
        metadata: { kind: row.kind, from_status: null, to_status: row.status },
      });
    }
    return { project: projectContext.project, item: mapItem(row) };
  });
}

async function updateItem({ tenantId, userId, projectId, itemId, input, canCloseInternalDefect = false }) {
  return withTransaction(async (client) => {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const existing = await repository.findItemById(client, { tenantId, projectId: projectContext.projectId, itemId, includeArchived: false });
    if (!existing) throw createHttpError(404, "restarbejde_item_not_found");
    const payload = normalizePayload(input, { existing, actorUserId: userId, canCloseInternalDefect });
    const row = await repository.updateItem(client, {
      tenantId,
      projectId: projectContext.projectId,
      itemId,
      payload,
      actorUserId: userId,
    });
    await audit(client, {
      tenantId,
      userId,
      eventType: "restarbejde.item_updated",
      resourceId: row.id,
      projectId: projectContext.projectId,
      metadata: { kind: row.kind, status: row.status, previous_status: existing.status },
    });
    if (existing.status !== row.status) {
      await audit(client, {
        tenantId,
        userId,
        eventType: "restarbejde.item_status_changed",
        resourceId: row.id,
        projectId: projectContext.projectId,
        metadata: { kind: row.kind, from_status: existing.status, to_status: row.status },
      });
    }
    return { project: projectContext.project, item: mapItem(row) };
  });
}

async function archiveItem({ tenantId, userId, projectId, itemId }) {
  return withTransaction(async (client) => {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const row = await repository.archiveItem(client, { tenantId, projectId: projectContext.projectId, itemId, actorUserId: userId });
    if (!row) throw createHttpError(404, "restarbejde_item_not_found");
    await audit(client, {
      tenantId,
      userId,
      eventType: "restarbejde.item_archived",
      resourceId: row.id,
      projectId: projectContext.projectId,
      metadata: { kind: row.kind, status: row.status },
    });
    return { project: projectContext.project, item: mapItem(row) };
  });
}

async function restoreItem({ tenantId, userId, projectId, itemId }) {
  return withTransaction(async (client) => {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const row = await repository.restoreItem(client, { tenantId, projectId: projectContext.projectId, itemId, actorUserId: userId });
    if (!row) throw createHttpError(404, "restarbejde_item_not_found");
    await audit(client, {
      tenantId,
      userId,
      eventType: "restarbejde.item_restored",
      resourceId: row.id,
      projectId: projectContext.projectId,
      metadata: { kind: row.kind, status: row.status },
    });
    return { project: projectContext.project, item: mapItem(row) };
  });
}

async function getSummary({ tenantId, userId, projectId }) {
  const client = await pool.connect();
  try {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const summary = await repository.getSummary(client, { tenantId, projectId: projectContext.projectId });
    return { project: projectContext.project, summary: mapSummary(summary) };
  } finally {
    client.release();
  }
}


async function listDrawings({ tenantId, userId, projectId, includeArchived = false }) {
  const client = await pool.connect();
  try {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const rows = await repository.listDrawings(client, { tenantId, projectId: projectContext.projectId, includeArchived });
    return { project: projectContext.project, drawings: rows.map(mapDrawing) };
  } finally {
    client.release();
  }
}

async function getDrawing({ tenantId, userId, projectId, drawingId }) {
  const client = await pool.connect();
  try {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const row = await repository.findDrawingById(client, { tenantId, projectId: projectContext.projectId, drawingId, includeArchived: false });
    if (!row) throw createHttpError(404, "restarbejde_drawing_not_found");
    return { project: projectContext.project, drawing: mapDrawing(row) };
  } finally {
    client.release();
  }
}

async function uploadDrawing({ tenantId, userId, projectId, file, title }) {
  const drawingFile = validateDrawingFile(file);
  const drawingTitle = normalizeTitle(title, drawingFile.originalFilename, "restarbejde_drawing_title_required");
  let pageCount = 1;
  if (drawingFile.sourceType === "pdf") {
    pageCount = await getPdfPageCount(drawingFile.buffer);
    if (!Number.isInteger(pageCount) || pageCount < 1) {
      throw createHttpError(400, "invalid_restarbejde_drawing_pdf");
    }
  }

  let uploadedObject = null;
  try {
    return await withTransaction(async (client) => {
      const projectContext = await requireProject(client, { tenantId, userId, projectId });
      const storageKey = buildStorageKey({ tenantId, projectId: projectContext.projectId, category: "drawings", extension: drawingFile.extension });
      uploadedObject = await fileStorageService.putObject({
        tenantId,
        projectId: projectContext.projectId,
        key: storageKey,
        buffer: drawingFile.buffer,
        contentType: drawingFile.contentType,
        metadata: { module_key: MODULE_KEY, resource_type: DRAWING_RESOURCE_TYPE, title: drawingTitle, source_type: drawingFile.sourceType },
      });
      const storageObject = await storageObjectQueries.insertStorageObject(client, {
        tenantId,
        projectId: projectContext.projectId,
        moduleKey: MODULE_KEY,
        resourceType: DRAWING_RESOURCE_TYPE,
        resourceId: projectContext.projectId,
        storageProvider: uploadedObject.provider,
        storageKey: uploadedObject.key,
        originalFilename: drawingFile.originalFilename,
        contentType: drawingFile.contentType,
        byteSize: drawingFile.byteSize,
        checksumSha256: drawingFile.checksumSha256,
        metadata: { title: drawingTitle, source_type: drawingFile.sourceType, page_count: pageCount },
        actorUserId: userId,
      });
      const drawing = await repository.insertDrawing(client, {
        tenantId,
        projectId: projectContext.projectId,
        payload: {
          title: drawingTitle,
          sourceType: drawingFile.sourceType,
          storageObjectId: storageObject.id,
          originalFilename: drawingFile.originalFilename,
          mimeType: drawingFile.contentType,
          fileSizeBytes: drawingFile.byteSize,
          pageCount,
        },
        actorUserId: userId,
      });
      await audit(client, {
        tenantId,
        userId,
        eventType: "restarbejde.drawing_created",
        resourceType: DRAWING_RESOURCE_TYPE,
        resourceId: drawing.id,
        projectId: projectContext.projectId,
        metadata: { drawing_id: drawing.id, storage_object_id: storageObject.id, source_type: drawing.source_type, filename: drawing.original_filename, mime_type: drawing.mime_type, byte_size: Number(drawing.file_size_bytes || 0), page_count: Number(drawing.page_count || 1) },
      });
      return { project: projectContext.project, drawing: mapDrawing({ ...drawing, storage_provider: storageObject.storage_provider, storage_key: storageObject.storage_key, content_type: storageObject.content_type, byte_size: storageObject.byte_size, checksum_sha256: storageObject.checksum_sha256, metadata: storageObject.metadata, placement_count: 0 }) };
    });
  } catch (error) {
    if (uploadedObject?.key) await deleteBlobBestEffort(uploadedObject.key);
    throw error;
  }
}

async function getDrawingContent({ tenantId, userId, projectId, drawingId }) {
  const client = await pool.connect();
  try {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const drawing = await repository.findDrawingById(client, { tenantId, projectId: projectContext.projectId, drawingId, includeArchived: false });
    if (!drawing) throw createHttpError(404, "restarbejde_drawing_not_found");
    const object = await fileStorageService.getObjectStream({ key: drawing.storage_key });
    return { project: projectContext.project, drawing: mapDrawing(drawing), contentType: drawing.mime_type || object.contentType, contentLength: drawing.file_size_bytes || object.contentLength, stream: object.stream };
  } finally {
    client.release();
  }
}

async function archiveDrawing({ tenantId, userId, projectId, drawingId }) {
  return withTransaction(async (client) => {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const row = await repository.archiveDrawing(client, { tenantId, projectId: projectContext.projectId, drawingId, actorUserId: userId });
    if (!row) throw createHttpError(404, "restarbejde_drawing_not_found");
    await audit(client, { tenantId, userId, eventType: "restarbejde.drawing_archived", resourceType: DRAWING_RESOURCE_TYPE, resourceId: row.id, projectId: projectContext.projectId, metadata: { drawing_id: row.id, source_type: row.source_type } });
    return { project: projectContext.project, drawing: mapDrawing(row) };
  });
}

async function restoreDrawing({ tenantId, userId, projectId, drawingId }) {
  return withTransaction(async (client) => {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const row = await repository.restoreDrawing(client, { tenantId, projectId: projectContext.projectId, drawingId, actorUserId: userId });
    if (!row) throw createHttpError(404, "restarbejde_drawing_not_found");
    await audit(client, { tenantId, userId, eventType: "restarbejde.drawing_restored", resourceType: DRAWING_RESOURCE_TYPE, resourceId: row.id, projectId: projectContext.projectId, metadata: { drawing_id: row.id, source_type: row.source_type } });
    return { project: projectContext.project, drawing: mapDrawing(row) };
  });
}

async function listPlacements({ tenantId, userId, projectId, drawingId }) {
  const client = await pool.connect();
  try {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const drawing = await repository.findDrawingById(client, { tenantId, projectId: projectContext.projectId, drawingId, includeArchived: false });
    if (!drawing) throw createHttpError(404, "restarbejde_drawing_not_found");
    const rows = await repository.listPlacementsForDrawing(client, { tenantId, projectId: projectContext.projectId, drawingId });
    return { project: projectContext.project, drawing: mapDrawing(drawing), placements: rows.map(mapPlacement) };
  } finally {
    client.release();
  }
}

async function normalizePlacementPayload(client, { tenantId, projectId, drawing, input, existing = null }) {
  const body = input || {};
  if (existing && Object.prototype.hasOwnProperty.call(body, "item_id") && String(body.item_id) !== String(existing.item_id)) {
    throw createHttpError(400, "restarbejde_placement_item_immutable");
  }
  const itemId = normalizeOptionalUuid(existing ? existing.item_id : body.item_id, "invalid_restarbejde_item_id");
  if (!itemId) throw createHttpError(400, "restarbejde_item_required");
  const item = await repository.findItemById(client, { tenantId, projectId, itemId, includeArchived: false });
  if (!item) throw createHttpError(404, "restarbejde_item_not_found");
  if (drawing.archived_at) throw createHttpError(400, "restarbejde_drawing_archived");
  return {
    itemId,
    pageNumber: normalizePageNumber(body.page_number === undefined ? existing?.page_number : body.page_number, drawing),
    xPercent: normalizePercentCoordinate(body.x_percent === undefined ? existing?.x_percent : body.x_percent, "x_percent"),
    yPercent: normalizePercentCoordinate(body.y_percent === undefined ? existing?.y_percent : body.y_percent, "y_percent"),
    label: Object.prototype.hasOwnProperty.call(body, "label") ? normalizeLabel(body.label) : normalizeLabel(existing?.label),
  };
}

async function createPlacement({ tenantId, userId, projectId, drawingId, input }) {
  return withTransaction(async (client) => {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const drawing = await repository.findDrawingById(client, { tenantId, projectId: projectContext.projectId, drawingId, includeArchived: false });
    if (!drawing) throw createHttpError(404, "restarbejde_drawing_not_found");
    const payload = await normalizePlacementPayload(client, { tenantId, projectId: projectContext.projectId, drawing, input });
    const row = await repository.insertPlacement(client, { tenantId, projectId: projectContext.projectId, drawingId, payload, actorUserId: userId });
    await audit(client, { tenantId, userId, eventType: "restarbejde.placement_created", resourceType: PLACEMENT_RESOURCE_TYPE, resourceId: row.id, projectId: projectContext.projectId, metadata: { item_id: row.item_id, drawing_id: row.drawing_id, placement_id: row.id, page_number: Number(row.page_number), x_percent: Number(row.x_percent), y_percent: Number(row.y_percent) } });
    return { project: projectContext.project, drawing: mapDrawing(drawing), placement: mapPlacement(row) };
  });
}

async function updatePlacement({ tenantId, userId, projectId, drawingId, placementId, input }) {
  return withTransaction(async (client) => {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const drawing = await repository.findDrawingById(client, { tenantId, projectId: projectContext.projectId, drawingId, includeArchived: false });
    if (!drawing) throw createHttpError(404, "restarbejde_drawing_not_found");
    const existing = await repository.findPlacementById(client, { tenantId, projectId: projectContext.projectId, drawingId, placementId, includeArchived: false });
    if (!existing) throw createHttpError(404, "restarbejde_placement_not_found");
    const payload = await normalizePlacementPayload(client, { tenantId, projectId: projectContext.projectId, drawing, input, existing });
    const row = await repository.updatePlacement(client, { tenantId, projectId: projectContext.projectId, drawingId, placementId, payload, actorUserId: userId });
    await audit(client, { tenantId, userId, eventType: "restarbejde.placement_updated", resourceType: PLACEMENT_RESOURCE_TYPE, resourceId: row.id, projectId: projectContext.projectId, metadata: { item_id: row.item_id, drawing_id: row.drawing_id, placement_id: row.id, previous: { page_number: Number(existing.page_number), x_percent: Number(existing.x_percent), y_percent: Number(existing.y_percent) }, next: { page_number: Number(row.page_number), x_percent: Number(row.x_percent), y_percent: Number(row.y_percent) } } });
    return { project: projectContext.project, drawing: mapDrawing(drawing), placement: mapPlacement(row) };
  });
}

async function archivePlacement({ tenantId, userId, projectId, drawingId, placementId }) {
  return withTransaction(async (client) => {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const row = await repository.archivePlacement(client, { tenantId, projectId: projectContext.projectId, drawingId, placementId, actorUserId: userId });
    if (!row) throw createHttpError(404, "restarbejde_placement_not_found");
    await audit(client, { tenantId, userId, eventType: "restarbejde.placement_archived", resourceType: PLACEMENT_RESOURCE_TYPE, resourceId: row.id, projectId: projectContext.projectId, metadata: { item_id: row.item_id, drawing_id: row.drawing_id, placement_id: row.id } });
    return { project: projectContext.project, placement: mapPlacement(row) };
  });
}

async function restorePlacement({ tenantId, userId, projectId, drawingId, placementId }) {
  return withTransaction(async (client) => {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const drawing = await repository.findDrawingById(client, { tenantId, projectId: projectContext.projectId, drawingId, includeArchived: false });
    if (!drawing) throw createHttpError(404, "restarbejde_drawing_not_found");
    const row = await repository.restorePlacement(client, { tenantId, projectId: projectContext.projectId, drawingId, placementId, actorUserId: userId });
    if (!row) throw createHttpError(404, "restarbejde_placement_not_found");
    await audit(client, { tenantId, userId, eventType: "restarbejde.placement_restored", resourceType: PLACEMENT_RESOURCE_TYPE, resourceId: row.id, projectId: projectContext.projectId, metadata: { item_id: row.item_id, drawing_id: row.drawing_id, placement_id: row.id } });
    return { project: projectContext.project, placement: mapPlacement(row) };
  });
}

async function listAttachments({ tenantId, userId, projectId, itemId }) {
  const client = await pool.connect();
  try {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const item = await repository.findItemById(client, { tenantId, projectId: projectContext.projectId, itemId, includeArchived: false });
    if (!item) throw createHttpError(404, "restarbejde_item_not_found");
    const rows = await repository.listAttachmentsForItem(client, { tenantId, projectId: projectContext.projectId, itemId });
    return { project: projectContext.project, item: mapItem(item), attachments: rows.map(mapAttachment) };
  } finally {
    client.release();
  }
}

async function uploadAttachment({ tenantId, userId, projectId, itemId, file, attachmentType, caption, allowNonPhoto = false }) {
  const normalizedType = normalizeAttachmentType(attachmentType);
  if (normalizedType !== "photo" && !allowNonPhoto) {
    throw createHttpError(403, "restarbejde_attachment_type_denied");
  }
  const attachmentFile = validateAttachmentFile(file, normalizedType);
  const normalizedCaption = normalizeOptionalText(caption)?.slice(0, 240) || null;
  let uploadedObject = null;
  try {
    return await withTransaction(async (client) => {
      const projectContext = await requireProject(client, { tenantId, userId, projectId });
      const item = await repository.findItemById(client, { tenantId, projectId: projectContext.projectId, itemId, includeArchived: false });
      if (!item) throw createHttpError(404, "restarbejde_item_not_found");
      const storageKey = buildStorageKey({ tenantId, projectId: projectContext.projectId, category: "attachments", resourceId: itemId, extension: attachmentFile.extension });
      uploadedObject = await fileStorageService.putObject({ tenantId, projectId: projectContext.projectId, key: storageKey, buffer: attachmentFile.buffer, contentType: attachmentFile.contentType, metadata: { module_key: MODULE_KEY, resource_type: ATTACHMENT_RESOURCE_TYPE, item_id: itemId, attachment_type: normalizedType } });
      const storageObject = await storageObjectQueries.insertStorageObject(client, { tenantId, projectId: projectContext.projectId, moduleKey: MODULE_KEY, resourceType: ATTACHMENT_RESOURCE_TYPE, resourceId: itemId, storageProvider: uploadedObject.provider, storageKey: uploadedObject.key, originalFilename: attachmentFile.originalFilename, contentType: attachmentFile.contentType, byteSize: attachmentFile.byteSize, checksumSha256: attachmentFile.checksumSha256, metadata: { item_id: itemId, attachment_type: normalizedType, caption: normalizedCaption }, actorUserId: userId });
      const attachment = await repository.insertAttachment(client, { tenantId, projectId: projectContext.projectId, itemId, payload: { storageObjectId: storageObject.id, attachmentType: normalizedType, originalFilename: attachmentFile.originalFilename, mimeType: attachmentFile.contentType, fileSizeBytes: attachmentFile.byteSize, caption: normalizedCaption }, actorUserId: userId });
      await audit(client, { tenantId, userId, eventType: "restarbejde.attachment_created", resourceType: ATTACHMENT_RESOURCE_TYPE, resourceId: attachment.id, projectId: projectContext.projectId, metadata: { item_id: itemId, attachment_id: attachment.id, storage_object_id: storageObject.id, attachment_type: normalizedType, filename: attachment.original_filename, mime_type: attachment.mime_type } });
      return { project: projectContext.project, item: mapItem(item), attachment: mapAttachment({ ...attachment, storage_provider: storageObject.storage_provider, storage_key: storageObject.storage_key, content_type: storageObject.content_type, byte_size: storageObject.byte_size, checksum_sha256: storageObject.checksum_sha256, metadata: storageObject.metadata }) };
    });
  } catch (error) {
    if (uploadedObject?.key) await deleteBlobBestEffort(uploadedObject.key);
    throw error;
  }
}

async function getAttachmentContent({ tenantId, userId, projectId, itemId, attachmentId }) {
  const client = await pool.connect();
  try {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const item = await repository.findItemById(client, { tenantId, projectId: projectContext.projectId, itemId, includeArchived: false });
    if (!item) throw createHttpError(404, "restarbejde_item_not_found");
    const attachment = await repository.findAttachmentById(client, { tenantId, projectId: projectContext.projectId, itemId, attachmentId, includeArchived: false });
    if (!attachment) throw createHttpError(404, "restarbejde_attachment_not_found");
    const object = await fileStorageService.getObjectStream({ key: attachment.storage_key });
    return { project: projectContext.project, item: mapItem(item), attachment: mapAttachment(attachment), contentType: attachment.mime_type || object.contentType, contentLength: attachment.file_size_bytes || object.contentLength, stream: object.stream };
  } finally {
    client.release();
  }
}

async function archiveAttachment({ tenantId, userId, projectId, itemId, attachmentId }) {
  return withTransaction(async (client) => {
    const projectContext = await requireProject(client, { tenantId, userId, projectId });
    const item = await repository.findItemById(client, { tenantId, projectId: projectContext.projectId, itemId, includeArchived: false });
    if (!item) throw createHttpError(404, "restarbejde_item_not_found");
    const row = await repository.archiveAttachment(client, { tenantId, projectId: projectContext.projectId, itemId, attachmentId, actorUserId: userId });
    if (!row) throw createHttpError(404, "restarbejde_attachment_not_found");
    await audit(client, { tenantId, userId, eventType: "restarbejde.attachment_archived", resourceType: ATTACHMENT_RESOURCE_TYPE, resourceId: row.id, projectId: projectContext.projectId, metadata: { item_id: itemId, attachment_id: row.id, attachment_type: row.attachment_type } });
    return { project: projectContext.project, item: mapItem(item), attachment: mapAttachment(row) };
  });
}
module.exports = {
  archiveAttachment,
  archiveDrawing,
  archiveItem,
  archivePlacement,
  createItem,
  createPlacement,
  getAttachmentContent,
  getDrawing,
  getDrawingContent,
  getItem,
  getSummary,
  listAttachments,
  listDrawings,
  listItems,
  listPlacements,
  restoreDrawing,
  restoreItem,
  restorePlacement,
  updateItem,
  updatePlacement,
  uploadAttachment,
  uploadDrawing,
  _test: {
    mapAttachment,
    mapDrawing,
    mapPlacement,
    mapSummary,
    normalizeAttachmentType,
    normalizeListFilters,
    normalizePageNumber,
    normalizePayload,
    normalizePercentCoordinate,
    validateAttachmentFile,
    validateDrawingFile,
  },
};
