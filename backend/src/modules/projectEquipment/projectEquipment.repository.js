const PROJECT_EQUIPMENT_CCTV_COLUMNS = `
  id,
  tenant_id,
  project_id,
  equipment_area,
  camera_id,
  mac_address,
  mac_address_normalized,
  serial_number,
  model,
  location_text,
  status,
  note,
  created_by_user_id,
  updated_by_user_id,
  created_at,
  updated_at,
  archived_at
`;

async function listCctvForProject(client, { tenantId, projectId, query }) {
  const values = [tenantId, projectId];
  let filterSql = "";
  const normalizedQuery = query ? String(query).trim().toLowerCase() : "";

  if (normalizedQuery) {
    values.push(`%${normalizedQuery}%`);
    filterSql = `
      AND (
        lower(camera_id) LIKE $${values.length}
        OR lower(COALESCE(mac_address, '')) LIKE $${values.length}
        OR lower(COALESCE(mac_address_normalized, '')) LIKE $${values.length}
        OR lower(COALESCE(serial_number, '')) LIKE $${values.length}
        OR lower(COALESCE(model, '')) LIKE $${values.length}
        OR lower(COALESCE(location_text, '')) LIKE $${values.length}
        OR lower(COALESCE(note, '')) LIKE $${values.length}
      )
    `;
  }

  const { rows } = await client.query(
    `
      SELECT
        ${PROJECT_EQUIPMENT_CCTV_COLUMNS},
        COALESCE((
          SELECT jsonb_object_agg(slot.slot_type, slot.image_summary)
          FROM (
            SELECT
              image.slot_type,
              jsonb_build_object(
                'slot_type', image.slot_type,
                'storage_object_id', image.storage_object_id,
                'filename', storage.original_filename,
                'content_type', storage.content_type,
                'byte_size', storage.byte_size,
                'uploaded_at', image.created_at
              ) AS image_summary
            FROM project_equipment_cctv_image image
            JOIN storage_object storage
              ON storage.tenant_id = image.tenant_id
             AND storage.id = image.storage_object_id
             AND storage.deleted_at IS NULL
            WHERE image.tenant_id = project_equipment_cctv.tenant_id
              AND image.project_id = project_equipment_cctv.project_id
              AND image.camera_record_id = project_equipment_cctv.id
              AND image.deleted_at IS NULL
          ) slot
        ), '{}'::jsonb) AS image_slots
      FROM project_equipment_cctv
      WHERE tenant_id = $1
        AND project_id = $2
        AND archived_at IS NULL
        ${filterSql}
      ORDER BY camera_id ASC, created_at ASC
    `,
    values
  );

  return rows;
}

async function getCctvSummary(client, { tenantId, projectId }) {
  const { rows } = await client.query(
    `
      SELECT status, COUNT(*)::int AS count
      FROM project_equipment_cctv
      WHERE tenant_id = $1
        AND project_id = $2
        AND archived_at IS NULL
      GROUP BY status
    `,
    [tenantId, projectId]
  );

  const summary = {
    registered: 0,
    planned: 0,
    mounted: 0,
    checked: 0,
    deviation: 0,
  };

  rows.forEach((row) => {
    if (Object.prototype.hasOwnProperty.call(summary, row.status)) {
      summary[row.status] = Number(row.count || 0);
    }
  });

  return summary;
}

async function findCctvById(client, { tenantId, projectId, cameraRecordId, includeArchived = false }) {
  const values = [tenantId, projectId, cameraRecordId];
  const archivedSql = includeArchived ? "" : "AND archived_at IS NULL";
  const { rows } = await client.query(
    `
      SELECT ${PROJECT_EQUIPMENT_CCTV_COLUMNS}
      FROM project_equipment_cctv
      WHERE tenant_id = $1
        AND project_id = $2
        AND id = $3
        ${archivedSql}
      LIMIT 1
    `,
    values
  );

  return rows[0] || null;
}

async function findActiveConflict(client, {
  tenantId,
  projectId,
  macAddressNormalized,
  serialNumber,
  excludeId,
}) {
  const values = [tenantId, projectId];
  const clauses = [];

  if (macAddressNormalized) {
    values.push(macAddressNormalized);
    clauses.push(`mac_address_normalized = $${values.length}`);
  }

  if (serialNumber) {
    values.push(serialNumber);
    clauses.push(`lower(serial_number) = lower($${values.length})`);
  }

  if (excludeId) {
    values.push(excludeId);
  }

  if (!clauses.length) {
    return null;
  }

  const excludeSql = excludeId ? `AND id <> $${values.length}` : "";
  const { rows } = await client.query(
    `
      SELECT ${PROJECT_EQUIPMENT_CCTV_COLUMNS}
      FROM project_equipment_cctv
      WHERE tenant_id = $1
        AND project_id = $2
        AND archived_at IS NULL
        AND (${clauses.join(" OR ")})
        ${excludeSql}
      ORDER BY created_at ASC
      LIMIT 1
    `,
    values
  );

  return rows[0] || null;
}

async function createCctv(client, {
  tenantId,
  projectId,
  cameraId,
  macAddress,
  macAddressNormalized,
  serialNumber,
  model,
  locationText,
  status,
  note,
  actorUserId,
}) {
  const { rows } = await client.query(
    `
      INSERT INTO project_equipment_cctv (
        tenant_id,
        project_id,
        camera_id,
        mac_address,
        mac_address_normalized,
        serial_number,
        model,
        location_text,
        status,
        note,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
      RETURNING ${PROJECT_EQUIPMENT_CCTV_COLUMNS}
    `,
    [
      tenantId,
      projectId,
      cameraId,
      macAddress,
      macAddressNormalized,
      serialNumber,
      model,
      locationText,
      status,
      note,
      actorUserId,
    ]
  );

  return rows[0];
}

async function updateCctv(client, {
  tenantId,
  projectId,
  cameraRecordId,
  cameraId,
  macAddress,
  macAddressNormalized,
  serialNumber,
  model,
  locationText,
  status,
  note,
  actorUserId,
}) {
  const { rows } = await client.query(
    `
      UPDATE project_equipment_cctv
      SET camera_id = $4,
          mac_address = $5,
          mac_address_normalized = $6,
          serial_number = $7,
          model = $8,
          location_text = $9,
          status = $10,
          note = $11,
          updated_by_user_id = $12
      WHERE tenant_id = $1
        AND project_id = $2
        AND id = $3
        AND archived_at IS NULL
      RETURNING ${PROJECT_EQUIPMENT_CCTV_COLUMNS}
    `,
    [
      tenantId,
      projectId,
      cameraRecordId,
      cameraId,
      macAddress,
      macAddressNormalized,
      serialNumber,
      model,
      locationText,
      status,
      note,
      actorUserId,
    ]
  );

  return rows[0] || null;
}

async function archiveCctv(client, { tenantId, projectId, cameraRecordId, actorUserId }) {
  const { rows } = await client.query(
    `
      UPDATE project_equipment_cctv
      SET archived_at = now(),
          updated_by_user_id = $4
      WHERE tenant_id = $1
        AND project_id = $2
        AND id = $3
        AND archived_at IS NULL
      RETURNING ${PROJECT_EQUIPMENT_CCTV_COLUMNS}
    `,
    [tenantId, projectId, cameraRecordId, actorUserId]
  );

  return rows[0] || null;
}

async function searchCctv(client, {
  tenantId,
  projectId,
  query,
  macAddressNormalized,
  limit = 10,
}) {
  const normalizedQuery = String(query || "").trim();
  const likeQuery = `%${normalizedQuery.toLowerCase()}%`;
  const values = [tenantId, projectId, normalizedQuery, likeQuery, macAddressNormalized || null, limit];

  const { rows } = await client.query(
    `
      SELECT
        ${PROJECT_EQUIPMENT_CCTV_COLUMNS},
        CASE
          WHEN $5::text IS NOT NULL AND mac_address_normalized = $5::text THEN 'mac'
          WHEN lower(serial_number) = lower($3) THEN 'serial_number'
          WHEN lower(camera_id) = lower($3) THEN 'camera_id'
          WHEN length($3) >= 3 AND lower(serial_number) LIKE $4 THEN 'serial_number_partial'
          WHEN length($3) >= 3 AND lower(camera_id) LIKE $4 THEN 'camera_id_partial'
          ELSE 'partial'
        END AS match_type
      FROM project_equipment_cctv
      WHERE tenant_id = $1
        AND project_id = $2
        AND archived_at IS NULL
        AND (
          ($5::text IS NOT NULL AND mac_address_normalized = $5::text)
          OR lower(serial_number) = lower($3)
          OR lower(camera_id) = lower($3)
          OR (
            length($3) >= 3
            AND (
              lower(serial_number) LIKE $4
              OR lower(camera_id) LIKE $4
              OR lower(COALESCE(location_text, '')) LIKE $4
            )
          )
        )
      ORDER BY
        CASE
          WHEN $5::text IS NOT NULL AND mac_address_normalized = $5::text THEN 1
          WHEN lower(serial_number) = lower($3) THEN 2
          WHEN lower(camera_id) = lower($3) THEN 3
          ELSE 4
        END,
        camera_id ASC
      LIMIT $6
    `,
    values
  );

  return rows;
}

async function listCctvImagesForCamera(client, { tenantId, projectId, cameraRecordId }) {
  const { rows } = await client.query(
    `
      SELECT
        image.id AS image_id,
        image.tenant_id,
        image.project_id,
        image.camera_record_id,
        image.storage_object_id,
        image.slot_type,
        image.created_by_user_id,
        image.created_at,
        image.updated_by_user_id,
        image.updated_at,
        storage.storage_provider,
        storage.storage_key,
        storage.original_filename,
        storage.content_type,
        storage.byte_size,
        storage.checksum_sha256,
        storage.metadata
      FROM project_equipment_cctv_image image
      JOIN storage_object storage
        ON storage.tenant_id = image.tenant_id
       AND storage.id = image.storage_object_id
       AND storage.deleted_at IS NULL
      WHERE image.tenant_id = $1
        AND image.project_id = $2
        AND image.camera_record_id = $3
        AND image.deleted_at IS NULL
      ORDER BY image.slot_type ASC
    `,
    [tenantId, projectId, cameraRecordId]
  );

  return rows;
}

async function findCctvImageSlot(client, { tenantId, projectId, cameraRecordId, slotType }) {
  const { rows } = await client.query(
    `
      SELECT
        image.id AS image_id,
        image.tenant_id,
        image.project_id,
        image.camera_record_id,
        image.storage_object_id,
        image.slot_type,
        image.created_by_user_id,
        image.created_at,
        image.updated_by_user_id,
        image.updated_at,
        storage.storage_provider,
        storage.storage_key,
        storage.original_filename,
        storage.content_type,
        storage.byte_size,
        storage.checksum_sha256,
        storage.metadata
      FROM project_equipment_cctv_image image
      JOIN storage_object storage
        ON storage.tenant_id = image.tenant_id
       AND storage.id = image.storage_object_id
       AND storage.deleted_at IS NULL
      WHERE image.tenant_id = $1
        AND image.project_id = $2
        AND image.camera_record_id = $3
        AND image.slot_type = $4
        AND image.deleted_at IS NULL
      LIMIT 1
    `,
    [tenantId, projectId, cameraRecordId, slotType]
  );

  return rows[0] || null;
}

async function insertCctvImageSlot(client, {
  tenantId,
  projectId,
  cameraRecordId,
  storageObjectId,
  slotType,
  actorUserId,
}) {
  const { rows } = await client.query(
    `
      INSERT INTO project_equipment_cctv_image (
        tenant_id,
        project_id,
        camera_record_id,
        storage_object_id,
        slot_type,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $6)
      RETURNING
        id AS image_id,
        tenant_id,
        project_id,
        camera_record_id,
        storage_object_id,
        slot_type,
        created_by_user_id,
        created_at,
        updated_by_user_id,
        updated_at
    `,
    [tenantId, projectId, cameraRecordId, storageObjectId, slotType, actorUserId]
  );

  return rows[0];
}

async function softDeleteCctvImageSlot(client, { tenantId, projectId, cameraRecordId, slotType, actorUserId }) {
  const { rows } = await client.query(
    `
      WITH active_slot AS (
        SELECT image.id, image.storage_object_id
        FROM project_equipment_cctv_image image
        WHERE image.tenant_id = $1
          AND image.project_id = $2
          AND image.camera_record_id = $3
          AND image.slot_type = $4
          AND image.deleted_at IS NULL
        LIMIT 1
      ), deleted_image AS (
        UPDATE project_equipment_cctv_image image
        SET deleted_at = now(),
            deleted_by_user_id = $5,
            updated_by_user_id = $5
        FROM active_slot
        WHERE image.id = active_slot.id
          AND image.tenant_id = $1
        RETURNING image.storage_object_id
      ), deleted_storage AS (
        UPDATE storage_object storage
        SET deleted_at = now(),
            deleted_by_user_id = $5
        FROM deleted_image
        WHERE storage.tenant_id = $1
          AND storage.id = deleted_image.storage_object_id
          AND storage.deleted_at IS NULL
        RETURNING storage.id AS storage_object_id, storage.storage_key
      )
      SELECT storage_object_id, storage_key
      FROM deleted_storage
      LIMIT 1
    `,
    [tenantId, projectId, cameraRecordId, slotType, actorUserId || null]
  );

  return rows[0] || null;
}
module.exports = {
  archiveCctv,
  createCctv,
  findActiveConflict,
  findCctvImageSlot,
  findCctvById,
  insertCctvImageSlot,
  getCctvSummary,
  listCctvImagesForCamera,
  listCctvForProject,
  searchCctv,
  softDeleteCctvImageSlot,
  updateCctv,
};
