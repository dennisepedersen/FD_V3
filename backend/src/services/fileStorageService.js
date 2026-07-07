const { BlobServiceClient } = require("@azure/storage-blob");

const SUPPORTED_PROVIDER = "azure_blob";
const DEFAULT_MAX_UPLOAD_MB = 10;
const MAX_METADATA_VALUE_LENGTH = 256;

let cachedContainerClient = null;
let cachedConfigKey = null;

function createConfigError(message) {
  const error = new Error(message);
  error.code = message;
  return error;
}

function normalizeRequiredString(value, fieldName) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw createConfigError(`${fieldName}_required`);
  }
  return normalized;
}

function getStorageProvider() {
  return String(process.env.FD_STORAGE_PROVIDER || "").trim().toLowerCase();
}

function requireAzureConfig() {
  const provider = getStorageProvider();
  if (!provider) {
    throw createConfigError("fd_storage_provider_required");
  }
  if (provider !== SUPPORTED_PROVIDER) {
    throw createConfigError("fd_storage_provider_unsupported");
  }

  return {
    provider,
    connectionString: normalizeRequiredString(
      process.env.FD_AZURE_STORAGE_CONNECTION_STRING,
      "fd_azure_storage_connection_string"
    ),
    containerName: normalizeRequiredString(
      process.env.FD_AZURE_STORAGE_CONTAINER,
      "fd_azure_storage_container"
    ),
  };
}

function getContainerClient() {
  const config = requireAzureConfig();
  const configKey = `${config.connectionString}|${config.containerName}`;
  if (cachedContainerClient && cachedConfigKey === configKey) {
    return cachedContainerClient;
  }

  const blobServiceClient = BlobServiceClient.fromConnectionString(config.connectionString);
  cachedContainerClient = blobServiceClient.getContainerClient(config.containerName);
  cachedConfigKey = configKey;
  return cachedContainerClient;
}

function getMaxUploadBytes() {
  const raw = String(process.env.FD_STORAGE_MAX_UPLOAD_MB || "").trim();
  const parsed = raw ? Number(raw) : DEFAULT_MAX_UPLOAD_MB;
  const maxMb = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_UPLOAD_MB;
  return Math.floor(maxMb * 1024 * 1024);
}

function normalizeObjectKey(key) {
  const normalized = normalizeRequiredString(key, "storage_key").replace(/\\/g, "/");
  if (
    normalized.startsWith("/")
    || normalized.includes("//")
    || normalized.split("/").some((part) => part === "." || part === "..")
    || /[\x00-\x1F\x7F]/.test(normalized)
    || normalized.length > 1024
  ) {
    throw createConfigError("invalid_storage_key");
  }
  return normalized;
}

function normalizeContentType(contentType) {
  const normalized = normalizeRequiredString(contentType, "content_type").toLowerCase();
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(normalized)) {
    throw createConfigError("invalid_content_type");
  }
  return normalized;
}

function assertBufferWithinLimit(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw createConfigError("storage_buffer_required");
  }
  const maxBytes = getMaxUploadBytes();
  if (buffer.length > maxBytes) {
    throw createConfigError("storage_upload_too_large");
  }
}

function normalizeAzureMetadataKey(key) {
  return String(key || "")
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^[^a-zA-Z_]+/, "")
    .slice(0, 64);
}

function normalizeAzureMetadataValue(value) {
  return String(value == null ? "" : value)
    .replace(/[^\x20-\x7E]/g, "")
    .slice(0, MAX_METADATA_VALUE_LENGTH);
}

function buildAzureMetadata({ tenantId, projectId, metadata }) {
  const azureMetadata = {
    fd_tenant_id: normalizeAzureMetadataValue(tenantId),
  };

  if (projectId) {
    azureMetadata.fd_project_id = normalizeAzureMetadataValue(projectId);
  }

  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    Object.entries(metadata).forEach(([key, value]) => {
      const normalizedKey = normalizeAzureMetadataKey(key);
      if (normalizedKey && !Object.prototype.hasOwnProperty.call(azureMetadata, normalizedKey)) {
        azureMetadata[normalizedKey] = normalizeAzureMetadataValue(value);
      }
    });
  }

  return azureMetadata;
}

async function putObject({ tenantId, projectId, key, buffer, contentType, metadata }) {
  const normalizedTenantId = normalizeRequiredString(tenantId, "tenant_id");
  const normalizedKey = normalizeObjectKey(key);
  const normalizedContentType = normalizeContentType(contentType);
  assertBufferWithinLimit(buffer);

  const containerClient = getContainerClient();
  const blobClient = containerClient.getBlockBlobClient(normalizedKey);
  const uploadResponse = await blobClient.uploadData(buffer, {
    blobHTTPHeaders: {
      blobContentType: normalizedContentType,
    },
    metadata: buildAzureMetadata({
      tenantId: normalizedTenantId,
      projectId,
      metadata,
    }),
  });

  return {
    provider: SUPPORTED_PROVIDER,
    key: normalizedKey,
    contentType: normalizedContentType,
    byteSize: buffer.length,
    etag: uploadResponse.etag || null,
    lastModified: uploadResponse.lastModified || null,
  };
}

async function getObjectStream({ key }) {
  const normalizedKey = normalizeObjectKey(key);
  const containerClient = getContainerClient();
  const blobClient = containerClient.getBlobClient(normalizedKey);
  const response = await blobClient.download(0);
  return {
    provider: SUPPORTED_PROVIDER,
    key: normalizedKey,
    stream: response.readableStreamBody,
    contentType: response.contentType || null,
    contentLength: response.contentLength || null,
    etag: response.etag || null,
    lastModified: response.lastModified || null,
  };
}

async function getObjectProperties({ key }) {
  const normalizedKey = normalizeObjectKey(key);
  const containerClient = getContainerClient();
  const blobClient = containerClient.getBlobClient(normalizedKey);
  const properties = await blobClient.getProperties();
  return {
    provider: SUPPORTED_PROVIDER,
    key: normalizedKey,
    contentType: properties.contentType || null,
    contentLength: properties.contentLength || null,
    etag: properties.etag || null,
    lastModified: properties.lastModified || null,
    metadata: properties.metadata || {},
  };
}

async function deleteObject({ key }) {
  const normalizedKey = normalizeObjectKey(key);
  const containerClient = getContainerClient();
  const blobClient = containerClient.getBlobClient(normalizedKey);
  const response = await blobClient.deleteIfExists();
  return {
    provider: SUPPORTED_PROVIDER,
    key: normalizedKey,
    deleted: Boolean(response.succeeded),
  };
}

module.exports = {
  deleteObject,
  getMaxUploadBytes,
  getObjectProperties,
  getObjectStream,
  putObject,
};
