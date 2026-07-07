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
      SELECT ${PROJECT_EQUIPMENT_CCTV_COLUMNS}
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

module.exports = {
  archiveCctv,
  createCctv,
  findActiveConflict,
  findCctvById,
  getCctvSummary,
  listCctvForProject,
  searchCctv,
  updateCctv,
};
