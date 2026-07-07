const STORAGE_OBJECT_COLUMNS = `
  id,
  tenant_id,
  project_id,
  module_key,
  resource_type,
  resource_id,
  storage_provider,
  storage_key,
  original_filename,
  content_type,
  byte_size,
  checksum_sha256,
  metadata,
  created_by_user_id,
  deleted_by_user_id,
  created_at,
  updated_at,
  deleted_at
`;

async function insertStorageObject(client, {
  tenantId,
  projectId,
  moduleKey,
  resourceType,
  resourceId,
  storageProvider,
  storageKey,
  originalFilename,
  contentType,
  byteSize,
  checksumSha256,
  metadata,
  actorUserId,
}) {
  const { rows } = await client.query(
    `
      INSERT INTO storage_object (
        tenant_id,
        project_id,
        module_key,
        resource_type,
        resource_id,
        storage_provider,
        storage_key,
        original_filename,
        content_type,
        byte_size,
        checksum_sha256,
        metadata,
        created_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
      RETURNING ${STORAGE_OBJECT_COLUMNS}
    `,
    [
      tenantId,
      projectId || null,
      moduleKey || null,
      resourceType || null,
      resourceId || null,
      storageProvider,
      storageKey,
      originalFilename || null,
      contentType,
      byteSize,
      checksumSha256 || null,
      JSON.stringify(metadata || {}),
      actorUserId || null,
    ]
  );

  return rows[0];
}

async function findStorageObjectById(client, { tenantId, storageObjectId, includeDeleted = false }) {
  const deletedSql = includeDeleted ? "" : "AND deleted_at IS NULL";
  const { rows } = await client.query(
    `
      SELECT ${STORAGE_OBJECT_COLUMNS}
      FROM storage_object
      WHERE tenant_id = $1
        AND id = $2
        ${deletedSql}
      LIMIT 1
    `,
    [tenantId, storageObjectId]
  );

  return rows[0] || null;
}

async function findStorageObjectByKey(client, { storageProvider, storageKey, includeDeleted = false }) {
  const deletedSql = includeDeleted ? "" : "AND deleted_at IS NULL";
  const { rows } = await client.query(
    `
      SELECT ${STORAGE_OBJECT_COLUMNS}
      FROM storage_object
      WHERE storage_provider = $1
        AND storage_key = $2
        ${deletedSql}
      LIMIT 1
    `,
    [storageProvider, storageKey]
  );

  return rows[0] || null;
}

async function markStorageObjectDeleted(client, { tenantId, storageObjectId, actorUserId }) {
  const { rows } = await client.query(
    `
      UPDATE storage_object
      SET deleted_at = now(),
          deleted_by_user_id = $3
      WHERE tenant_id = $1
        AND id = $2
        AND deleted_at IS NULL
      RETURNING ${STORAGE_OBJECT_COLUMNS}
    `,
    [tenantId, storageObjectId, actorUserId || null]
  );

  return rows[0] || null;
}

module.exports = {
  findStorageObjectById,
  findStorageObjectByKey,
  insertStorageObject,
  markStorageObjectDeleted,
};
