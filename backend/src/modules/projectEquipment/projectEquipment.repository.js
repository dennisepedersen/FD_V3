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
        ), '{}'::jsonb) AS image_slots,
        (
          SELECT jsonb_build_object(
            'pin_id', pin.id,
            'drawing_id', pin.drawing_id,
            'drawing_title', drawing.title,
            'x_percent', pin.x_percent,
            'y_percent', pin.y_percent,
            'label', pin.label,
            'updated_at', pin.updated_at
          )
          FROM project_equipment_cctv_pin pin
          JOIN project_equipment_drawing drawing
            ON drawing.tenant_id = pin.tenant_id
           AND drawing.id = pin.drawing_id
           AND drawing.deleted_at IS NULL
          WHERE pin.tenant_id = project_equipment_cctv.tenant_id
            AND pin.project_id = project_equipment_cctv.project_id
            AND pin.camera_record_id = project_equipment_cctv.id
            AND pin.deleted_at IS NULL
          ORDER BY pin.updated_at DESC
          LIMIT 1
        ) AS drawing_pin
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

async function listCctvImagesForProject(client, { tenantId, projectId }) {
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
        AND image.deleted_at IS NULL
      ORDER BY image.camera_record_id ASC, image.slot_type ASC
    `,
    [tenantId, projectId]
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

async function listCctvDrawingsForProject(client, { tenantId, projectId }) {
  const { rows } = await client.query(
    `
      SELECT
        drawing.id AS drawing_id,
        drawing.tenant_id,
        drawing.project_id,
        drawing.equipment_area,
        drawing.storage_object_id,
        drawing.title,
        drawing.created_by_user_id,
        drawing.created_at,
        drawing.updated_by_user_id,
        drawing.updated_at,
        storage.storage_provider,
        storage.storage_key,
        storage.original_filename,
        storage.content_type,
        storage.byte_size,
        storage.checksum_sha256,
        storage.metadata,
        COALESCE((
          SELECT COUNT(*)::int
          FROM project_equipment_cctv_pin pin
          WHERE pin.tenant_id = drawing.tenant_id
            AND pin.project_id = drawing.project_id
            AND pin.drawing_id = drawing.id
            AND pin.deleted_at IS NULL
        ), 0) AS pin_count
      FROM project_equipment_drawing drawing
      JOIN storage_object storage
        ON storage.tenant_id = drawing.tenant_id
       AND storage.id = drawing.storage_object_id
       AND storage.deleted_at IS NULL
      WHERE drawing.tenant_id = $1
        AND drawing.project_id = $2
        AND drawing.equipment_area = 'cctv'
        AND drawing.deleted_at IS NULL
      ORDER BY drawing.updated_at DESC, drawing.created_at DESC
    `,
    [tenantId, projectId]
  );

  return rows;
}

async function findCctvDrawingById(client, { tenantId, projectId, drawingId }) {
  const { rows } = await client.query(
    `
      SELECT
        drawing.id AS drawing_id,
        drawing.tenant_id,
        drawing.project_id,
        drawing.equipment_area,
        drawing.storage_object_id,
        drawing.title,
        drawing.created_by_user_id,
        drawing.created_at,
        drawing.updated_by_user_id,
        drawing.updated_at,
        storage.storage_provider,
        storage.storage_key,
        storage.original_filename,
        storage.content_type,
        storage.byte_size,
        storage.checksum_sha256,
        storage.metadata
      FROM project_equipment_drawing drawing
      JOIN storage_object storage
        ON storage.tenant_id = drawing.tenant_id
       AND storage.id = drawing.storage_object_id
       AND storage.deleted_at IS NULL
      WHERE drawing.tenant_id = $1
        AND drawing.project_id = $2
        AND drawing.id = $3
        AND drawing.equipment_area = 'cctv'
        AND drawing.deleted_at IS NULL
      LIMIT 1
    `,
    [tenantId, projectId, drawingId]
  );

  return rows[0] || null;
}

async function insertCctvDrawing(client, {
  tenantId,
  projectId,
  storageObjectId,
  title,
  actorUserId,
}) {
  const { rows } = await client.query(
    `
      INSERT INTO project_equipment_drawing (
        tenant_id,
        project_id,
        equipment_area,
        storage_object_id,
        title,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1, $2, 'cctv', $3, $4, $5, $5)
      RETURNING
        id AS drawing_id,
        tenant_id,
        project_id,
        equipment_area,
        storage_object_id,
        title,
        created_by_user_id,
        created_at,
        updated_by_user_id,
        updated_at
    `,
    [tenantId, projectId, storageObjectId, title, actorUserId]
  );

  return rows[0];
}

async function softDeleteCctvDrawing(client, { tenantId, projectId, drawingId, actorUserId }) {
  const { rows } = await client.query(
    `
      WITH active_drawing AS (
        SELECT drawing.id, drawing.storage_object_id
        FROM project_equipment_drawing drawing
        WHERE drawing.tenant_id = $1
          AND drawing.project_id = $2
          AND drawing.id = $3
          AND drawing.equipment_area = 'cctv'
          AND drawing.deleted_at IS NULL
        LIMIT 1
      ), deleted_pins AS (
        UPDATE project_equipment_cctv_pin pin
        SET deleted_at = now(),
            deleted_by_user_id = $4,
            updated_by_user_id = $4
        FROM active_drawing
        WHERE pin.tenant_id = $1
          AND pin.project_id = $2
          AND pin.drawing_id = active_drawing.id
          AND pin.deleted_at IS NULL
        RETURNING pin.id
      ), deleted_drawing AS (
        UPDATE project_equipment_drawing drawing
        SET deleted_at = now(),
            deleted_by_user_id = $4,
            updated_by_user_id = $4
        FROM active_drawing
        WHERE drawing.tenant_id = $1
          AND drawing.id = active_drawing.id
        RETURNING drawing.id AS drawing_id, drawing.storage_object_id
      ), deleted_storage AS (
        UPDATE storage_object storage
        SET deleted_at = now(),
            deleted_by_user_id = $4
        FROM deleted_drawing
        WHERE storage.tenant_id = $1
          AND storage.id = deleted_drawing.storage_object_id
          AND storage.deleted_at IS NULL
        RETURNING storage.id AS storage_object_id, storage.storage_key
      )
      SELECT deleted_drawing.drawing_id, deleted_storage.storage_object_id, deleted_storage.storage_key
      FROM deleted_drawing
      LEFT JOIN deleted_storage ON TRUE
      LIMIT 1
    `,
    [tenantId, projectId, drawingId, actorUserId || null]
  );

  return rows[0] || null;
}

async function listCctvPinsForDrawing(client, { tenantId, projectId, drawingId }) {
  const { rows } = await client.query(
    `
      SELECT
        pin.id AS pin_id,
        pin.tenant_id,
        pin.project_id,
        pin.drawing_id,
        pin.camera_record_id,
        pin.coordinate_mode,
        pin.x_percent,
        pin.y_percent,
        pin.label,
        pin.created_by_user_id,
        pin.created_at,
        pin.updated_by_user_id,
        pin.updated_at,
        camera.camera_id,
        camera.mac_address,
        camera.serial_number,
        camera.model,
        camera.location_text,
        camera.status,
        camera.note,
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
            WHERE image.tenant_id = camera.tenant_id
              AND image.project_id = camera.project_id
              AND image.camera_record_id = camera.id
              AND image.deleted_at IS NULL
          ) slot
        ), '{}'::jsonb) AS image_slots
      FROM project_equipment_cctv_pin pin
      JOIN project_equipment_cctv camera
        ON camera.tenant_id = pin.tenant_id
       AND camera.id = pin.camera_record_id
       AND camera.archived_at IS NULL
      JOIN project_equipment_drawing drawing
        ON drawing.tenant_id = pin.tenant_id
       AND drawing.id = pin.drawing_id
       AND drawing.deleted_at IS NULL
      WHERE pin.tenant_id = $1
        AND pin.project_id = $2
        AND pin.drawing_id = $3
        AND pin.deleted_at IS NULL
      ORDER BY camera.camera_id ASC, pin.created_at ASC
    `,
    [tenantId, projectId, drawingId]
  );

  return rows;
}

async function findCctvPinById(client, { tenantId, projectId, drawingId, pinId }) {
  const { rows } = await client.query(
    `
      SELECT
        pin.id AS pin_id,
        pin.tenant_id,
        pin.project_id,
        pin.drawing_id,
        pin.camera_record_id,
        pin.coordinate_mode,
        pin.x_percent,
        pin.y_percent,
        pin.label,
        pin.created_by_user_id,
        pin.created_at,
        pin.updated_by_user_id,
        pin.updated_at,
        camera.camera_id,
        camera.mac_address,
        camera.serial_number,
        camera.model,
        camera.location_text,
        camera.status,
        camera.note,
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
            WHERE image.tenant_id = camera.tenant_id
              AND image.project_id = camera.project_id
              AND image.camera_record_id = camera.id
              AND image.deleted_at IS NULL
          ) slot
        ), '{}'::jsonb) AS image_slots
      FROM project_equipment_cctv_pin pin
      JOIN project_equipment_cctv camera
        ON camera.tenant_id = pin.tenant_id
       AND camera.id = pin.camera_record_id
       AND camera.archived_at IS NULL
      WHERE pin.tenant_id = $1
        AND pin.project_id = $2
        AND pin.drawing_id = $3
        AND pin.id = $4
        AND pin.deleted_at IS NULL
      LIMIT 1
    `,
    [tenantId, projectId, drawingId, pinId]
  );

  return rows[0] || null;
}

async function findActiveCctvPinForCameraDrawing(client, { tenantId, projectId, drawingId, cameraRecordId }) {
  const { rows } = await client.query(
    `
      SELECT
        pin.id AS pin_id,
        pin.tenant_id,
        pin.project_id,
        pin.drawing_id,
        pin.camera_record_id,
        pin.coordinate_mode,
        pin.x_percent,
        pin.y_percent,
        pin.label,
        pin.created_by_user_id,
        pin.created_at,
        pin.updated_by_user_id,
        pin.updated_at
      FROM project_equipment_cctv_pin pin
      WHERE pin.tenant_id = $1
        AND pin.project_id = $2
        AND pin.drawing_id = $3
        AND pin.camera_record_id = $4
        AND pin.deleted_at IS NULL
      LIMIT 1
    `,
    [tenantId, projectId, drawingId, cameraRecordId]
  );

  return rows[0] || null;
}

async function insertCctvPin(client, {
  tenantId,
  projectId,
  drawingId,
  cameraRecordId,
  xPercent,
  yPercent,
  label,
  actorUserId,
}) {
  const { rows } = await client.query(
    `
      INSERT INTO project_equipment_cctv_pin (
        tenant_id,
        project_id,
        drawing_id,
        camera_record_id,
        coordinate_mode,
        x_percent,
        y_percent,
        label,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1, $2, $3, $4, 'percent', $5, $6, $7, $8, $8)
      RETURNING
        id AS pin_id,
        tenant_id,
        project_id,
        drawing_id,
        camera_record_id,
        coordinate_mode,
        x_percent,
        y_percent,
        label,
        created_by_user_id,
        created_at,
        updated_by_user_id,
        updated_at
    `,
    [tenantId, projectId, drawingId, cameraRecordId, xPercent, yPercent, label, actorUserId]
  );

  return rows[0];
}

async function updateCctvPin(client, {
  tenantId,
  projectId,
  drawingId,
  pinId,
  xPercent,
  yPercent,
  label,
  actorUserId,
}) {
  const { rows } = await client.query(
    `
      UPDATE project_equipment_cctv_pin
      SET x_percent = $5,
          y_percent = $6,
          label = $7,
          updated_by_user_id = $8
      WHERE tenant_id = $1
        AND project_id = $2
        AND drawing_id = $3
        AND id = $4
        AND deleted_at IS NULL
      RETURNING
        id AS pin_id,
        tenant_id,
        project_id,
        drawing_id,
        camera_record_id,
        coordinate_mode,
        x_percent,
        y_percent,
        label,
        created_by_user_id,
        created_at,
        updated_by_user_id,
        updated_at
    `,
    [tenantId, projectId, drawingId, pinId, xPercent, yPercent, label, actorUserId]
  );

  return rows[0] || null;
}

async function softDeleteCctvPin(client, { tenantId, projectId, drawingId, pinId, actorUserId }) {
  const { rows } = await client.query(
    `
      UPDATE project_equipment_cctv_pin
      SET deleted_at = now(),
          deleted_by_user_id = $5,
          updated_by_user_id = $5
      WHERE tenant_id = $1
        AND project_id = $2
        AND drawing_id = $3
        AND id = $4
        AND deleted_at IS NULL
      RETURNING
        id AS pin_id,
        tenant_id,
        project_id,
        drawing_id,
        camera_record_id,
        label
    `,
    [tenantId, projectId, drawingId, pinId, actorUserId || null]
  );

  return rows[0] || null;
}
module.exports = {
  archiveCctv,
  createCctv,
  findActiveCctvPinForCameraDrawing,
  findActiveConflict,
  findCctvById,
  findCctvDrawingById,
  findCctvImageSlot,
  findCctvPinById,
  getCctvSummary,
  insertCctvDrawing,
  insertCctvImageSlot,
  insertCctvPin,
  listCctvDrawingsForProject,
  listCctvForProject,
  listCctvImagesForCamera,
  listCctvImagesForProject,
  listCctvPinsForDrawing,
  searchCctv,
  softDeleteCctvDrawing,
  softDeleteCctvImageSlot,
  softDeleteCctvPin,
  updateCctv,
  updateCctvPin,
};