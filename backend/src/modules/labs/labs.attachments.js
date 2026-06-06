const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const env = require("../../config/env");
const { createHttpError } = require("../../middleware/errorHandler");

const ALLOWED_EXTENSIONS = new Set(["pdf", "png", "jpg", "jpeg", "txt", "md"]);
const MAX_MULTIPART_OVERHEAD_BYTES = 128 * 1024;

function storageRoot() {
  return env.LABS_ATTACHMENT_STORAGE_DIR
    ? path.resolve(env.LABS_ATTACHMENT_STORAGE_DIR)
    : path.resolve(__dirname, "../../../../.tmp/labs-attachments");
}

function sanitizeFilename(value) {
  const base = path.basename(String(value || "attachment").replace(/\0/g, ""));
  return base.replace(/[^a-zA-Z0-9._ -]/g, "_").trim() || "attachment";
}

function getExtension(fileName) {
  const extension = path.extname(fileName || "").replace(".", "").toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw createHttpError(400, "labs_attachment_file_type_not_allowed", {
      allowed_extensions: Array.from(ALLOWED_EXTENSIONS),
    });
  }
  return extension;
}

function parseContentDisposition(value) {
  const result = {};
  String(value || "")
    .split(";")
    .map((part) => part.trim())
    .forEach((part) => {
      const [rawKey, ...rawValueParts] = part.split("=");
      if (!rawKey || rawValueParts.length === 0) {
        return;
      }
      const key = rawKey.trim().toLowerCase();
      let parsedValue = rawValueParts.join("=").trim();
      if (parsedValue.startsWith('"') && parsedValue.endsWith('"')) {
        parsedValue = parsedValue.slice(1, -1);
      }
      result[key] = parsedValue;
    });
  return result;
}

function splitHeaderAndBody(partBuffer) {
  const separator = Buffer.from("\r\n\r\n");
  const index = partBuffer.indexOf(separator);
  if (index < 0) {
    return null;
  }

  return {
    headerText: partBuffer.slice(0, index).toString("utf8"),
    body: partBuffer.slice(index + separator.length),
  };
}

function parseMultipart(buffer, boundary) {
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const parts = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    const boundaryIndex = buffer.indexOf(boundaryBuffer, cursor);
    if (boundaryIndex < 0) {
      break;
    }

    let partStart = boundaryIndex + boundaryBuffer.length;
    if (buffer.slice(partStart, partStart + 2).toString() === "--") {
      break;
    }
    if (buffer.slice(partStart, partStart + 2).toString() === "\r\n") {
      partStart += 2;
    }

    const nextBoundaryIndex = buffer.indexOf(boundaryBuffer, partStart);
    if (nextBoundaryIndex < 0) {
      break;
    }

    let partBuffer = buffer.slice(partStart, nextBoundaryIndex);
    if (partBuffer.slice(-2).toString() === "\r\n") {
      partBuffer = partBuffer.slice(0, -2);
    }

    const split = splitHeaderAndBody(partBuffer);
    if (!split) {
      cursor = nextBoundaryIndex;
      continue;
    }

    const headers = {};
    split.headerText.split("\r\n").forEach((line) => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex <= 0) {
        return;
      }
      headers[line.slice(0, separatorIndex).trim().toLowerCase()] = line.slice(separatorIndex + 1).trim();
    });

    const disposition = parseContentDisposition(headers["content-disposition"]);
    parts.push({
      name: disposition.name,
      fileName: disposition.filename,
      contentType: headers["content-type"] || "application/octet-stream",
      body: split.body,
    });

    cursor = nextBoundaryIndex;
  }

  return parts;
}

async function readRequestBuffer(req, maxBytes) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw createHttpError(413, "labs_attachment_upload_too_large", {
        max_bytes: env.LABS_ATTACHMENT_MAX_BYTES,
      });
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function parseSingleAttachmentUpload(req) {
  const contentType = String(req.headers["content-type"] || "");
  const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
  if (!contentType.toLowerCase().includes("multipart/form-data") || !boundaryMatch) {
    throw createHttpError(415, "labs_attachment_requires_multipart_form_data");
  }

  const requestBuffer = await readRequestBuffer(
    req,
    env.LABS_ATTACHMENT_MAX_BYTES + MAX_MULTIPART_OVERHEAD_BYTES
  );
  const parts = parseMultipart(requestBuffer, boundaryMatch[1]);
  const filePart = parts.find((part) => part.fileName);
  if (!filePart) {
    throw createHttpError(400, "labs_attachment_file_required");
  }

  if (filePart.body.length <= 0) {
    throw createHttpError(400, "labs_attachment_empty_file");
  }

  if (filePart.body.length > env.LABS_ATTACHMENT_MAX_BYTES) {
    throw createHttpError(413, "labs_attachment_file_too_large", {
      max_bytes: env.LABS_ATTACHMENT_MAX_BYTES,
    });
  }

  const fileName = sanitizeFilename(filePart.fileName);
  const fileExtension = getExtension(fileName);
  const descriptionPart = parts.find((part) => part.name === "description" && !part.fileName);
  const attachmentTypePart = parts.find((part) => part.name === "attachment_type" && !part.fileName);
  const attachmentType = String(attachmentTypePart?.body?.toString("utf8") || "file").trim() === "screenshot"
    ? "screenshot"
    : "file";

  return {
    buffer: filePart.body,
    fileName,
    fileExtension,
    contentType: filePart.contentType,
    sizeBytes: filePart.body.length,
    attachmentType,
    description: String(descriptionPart?.body?.toString("utf8") || "").trim() || null,
  };
}

async function saveAttachmentBuffer({ ideaId, fileExtension, buffer }) {
  const id = crypto.randomUUID();
  const directory = path.join(storageRoot(), String(ideaId));
  await fs.mkdir(directory, { recursive: true });

  const storageObjectId = `${id}.${fileExtension}`;
  const absolutePath = path.join(directory, storageObjectId);
  await fs.writeFile(absolutePath, buffer, { flag: "wx" });

  return {
    storageObjectId,
    absolutePath,
  };
}

function attachmentPath({ ideaId, storageObjectId }) {
  return path.join(storageRoot(), String(ideaId), path.basename(String(storageObjectId || "")));
}

module.exports = {
  ALLOWED_EXTENSIONS,
  attachmentPath,
  parseSingleAttachmentUpload,
  saveAttachmentBuffer,
};
