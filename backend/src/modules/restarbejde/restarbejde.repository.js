const ITEM_COLUMNS = `
  id,
  tenant_id,
  project_id,
  kind,
  title,
  description,
  trade_key,
  status,
  priority,
  risk,
  location_text,
  assigned_tenant_user_id,
  responsible_text,
  deadline,
  percent_complete,
  external_party,
  blocks_delivery,
  escalated,
  can_internal_team_act,
  comment,
  source,
  external_import_id,
  external_import_payload,
  created_at,
  updated_at,
  created_by_user_id,
  updated_by_user_id,
  closed_at,
  closed_by_user_id,
  archived_at,
  archived_by_user_id
`;
const DRAWING_COLUMNS = `
  drawing.id,
  drawing.tenant_id,
  drawing.project_id,
  drawing.title,
  drawing.source_type,
  drawing.storage_object_id,
  drawing.original_filename,
  drawing.mime_type,
  drawing.file_size_bytes,
  drawing.page_count,
  drawing.created_at,
  drawing.updated_at,
  drawing.created_by_user_id,
  drawing.updated_by_user_id,
  drawing.archived_at,
  drawing.archived_by_user_id,
  storage.storage_provider,
  storage.storage_key,
  storage.content_type,
  storage.byte_size,
  storage.checksum_sha256,
  storage.metadata
`;

const PLACEMENT_COLUMNS = `
  id,
  tenant_id,
  project_id,
  item_id,
  drawing_id,
  page_number,
  x_percent,
  y_percent,
  label,
  created_at,
  updated_at,
  created_by_user_id,
  updated_by_user_id,
  archived_at,
  archived_by_user_id
`;

const ATTACHMENT_COLUMNS = `
  attachment.id,
  attachment.tenant_id,
  attachment.project_id,
  attachment.item_id,
  attachment.storage_object_id,
  attachment.attachment_type,
  attachment.original_filename,
  attachment.mime_type,
  attachment.file_size_bytes,
  attachment.caption,
  attachment.created_at,
  attachment.created_by_user_id,
  attachment.archived_at,
  attachment.archived_by_user_id,
  storage.storage_provider,
  storage.storage_key,
  storage.content_type,
  storage.byte_size,
  storage.checksum_sha256,
  storage.metadata
`;
async function listItems(client, { tenantId, projectId, includeArchived = false, kind, status }) {
  const params = [tenantId, projectId];
  const filters = ["tenant_id = $1", "project_id = $2"];
  if (!includeArchived) {
    filters.push("archived_at IS NULL");
  }
  if (kind) {
    params.push(kind);
    filters.push(`kind = $${params.length}`);
  }
  if (status) {
    params.push(status);
    filters.push(`status = $${params.length}`);
  }

  const { rows } = await client.query(
    `
      SELECT ${ITEM_COLUMNS}
      FROM project_restarbejde_item
      WHERE ${filters.join(" AND ")}
      ORDER BY archived_at ASC NULLS FIRST, updated_at DESC, created_at DESC
    `,
    params
  );
  return rows;
}

async function findItemById(client, { tenantId, projectId, itemId, includeArchived = true }) {
  const archivedSql = includeArchived ? "" : "AND archived_at IS NULL";
  const { rows } = await client.query(
    `
      SELECT ${ITEM_COLUMNS}
      FROM project_restarbejde_item
      WHERE tenant_id = $1
        AND project_id = $2
        AND id = $3
        ${archivedSql}
      LIMIT 1
    `,
    [tenantId, projectId, itemId]
  );
  return rows[0] || null;
}

async function insertItem(client, { tenantId, projectId, payload, actorUserId }) {
  const { rows } = await client.query(
    `
      INSERT INTO project_restarbejde_item (
        tenant_id,
        project_id,
        kind,
        title,
        description,
        trade_key,
        status,
        priority,
        risk,
        location_text,
        assigned_tenant_user_id,
        responsible_text,
        deadline,
        percent_complete,
        external_party,
        blocks_delivery,
        escalated,
        can_internal_team_act,
        comment,
        source,
        external_import_id,
        external_import_payload,
        created_by_user_id,
        updated_by_user_id,
        closed_at,
        closed_by_user_id
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21, $22::jsonb,
        $23, $23, $24, $25
      )
      RETURNING ${ITEM_COLUMNS}
    `,
    [
      tenantId,
      projectId,
      payload.kind,
      payload.title,
      payload.description,
      payload.tradeKey,
      payload.status,
      payload.priority,
      payload.risk,
      payload.locationText,
      payload.assignedTenantUserId,
      payload.responsibleText,
      payload.deadline,
      payload.percentComplete,
      payload.externalParty,
      payload.blocksDelivery,
      payload.escalated,
      payload.canInternalTeamAct,
      payload.comment,
      payload.source,
      payload.externalImportId,
      JSON.stringify(payload.externalImportPayload || {}),
      actorUserId,
      payload.closedAt,
      payload.closedByUserId,
    ]
  );
  return rows[0];
}

async function updateItem(client, { tenantId, projectId, itemId, payload, actorUserId }) {
  const { rows } = await client.query(
    `
      UPDATE project_restarbejde_item
      SET title = $4,
          description = $5,
          trade_key = $6,
          status = $7,
          priority = $8,
          risk = $9,
          location_text = $10,
          assigned_tenant_user_id = $11,
          responsible_text = $12,
          deadline = $13,
          percent_complete = $14,
          external_party = $15,
          blocks_delivery = $16,
          escalated = $17,
          can_internal_team_act = $18,
          comment = $19,
          source = $20,
          external_import_id = $21,
          external_import_payload = $22::jsonb,
          updated_by_user_id = $23,
          closed_at = $24,
          closed_by_user_id = $25
      WHERE tenant_id = $1
        AND project_id = $2
        AND id = $3
      RETURNING ${ITEM_COLUMNS}
    `,
    [
      tenantId,
      projectId,
      itemId,
      payload.title,
      payload.description,
      payload.tradeKey,
      payload.status,
      payload.priority,
      payload.risk,
      payload.locationText,
      payload.assignedTenantUserId,
      payload.responsibleText,
      payload.deadline,
      payload.percentComplete,
      payload.externalParty,
      payload.blocksDelivery,
      payload.escalated,
      payload.canInternalTeamAct,
      payload.comment,
      payload.source,
      payload.externalImportId,
      JSON.stringify(payload.externalImportPayload || {}),
      actorUserId,
      payload.closedAt,
      payload.closedByUserId,
    ]
  );
  return rows[0] || null;
}

async function archiveItem(client, { tenantId, projectId, itemId, actorUserId }) {
  const { rows } = await client.query(
    `
      UPDATE project_restarbejde_item
      SET archived_at = now(),
          archived_by_user_id = $4,
          updated_by_user_id = $4
      WHERE tenant_id = $1
        AND project_id = $2
        AND id = $3
        AND archived_at IS NULL
      RETURNING ${ITEM_COLUMNS}
    `,
    [tenantId, projectId, itemId, actorUserId]
  );
  return rows[0] || null;
}

async function restoreItem(client, { tenantId, projectId, itemId, actorUserId }) {
  const { rows } = await client.query(
    `
      UPDATE project_restarbejde_item
      SET archived_at = NULL,
          archived_by_user_id = NULL,
          updated_by_user_id = $4
      WHERE tenant_id = $1
        AND project_id = $2
        AND id = $3
        AND archived_at IS NOT NULL
      RETURNING ${ITEM_COLUMNS}
    `,
    [tenantId, projectId, itemId, actorUserId]
  );
  return rows[0] || null;
}

async function getSummary(client, { tenantId, projectId }) {
  const { rows } = await client.query(
    `
      SELECT
        COUNT(*) FILTER (WHERE kind = 'internal_defect' AND archived_at IS NULL) AS internal_defect_count,
        COUNT(*) FILTER (WHERE kind = 'internal_defect' AND archived_at IS NULL AND status = 'closed') AS internal_defect_closed_count,
        AVG(percent_complete) FILTER (WHERE kind = 'internal_defect' AND archived_at IS NULL) AS internal_defect_progress,
        COUNT(*) FILTER (WHERE kind = 'obs' AND archived_at IS NULL) AS obs_count,
        COUNT(*) FILTER (WHERE archived_at IS NOT NULL) AS archived_count
      FROM project_restarbejde_item
      WHERE tenant_id = $1
        AND project_id = $2
    `,
    [tenantId, projectId]
  );
  return rows[0] || {};
}


async function listDrawings(client, { tenantId, projectId, includeArchived = false }) {
  const archivedSql = includeArchived ? "" : "AND drawing.archived_at IS NULL";
  const { rows } = await client.query(
    `
      SELECT ${DRAWING_COLUMNS},
        COALESCE((
          SELECT COUNT(*)::int
          FROM project_restarbejde_placement placement
          JOIN project_restarbejde_item item
            ON item.tenant_id = placement.tenant_id
           AND item.project_id = placement.project_id
           AND item.id = placement.item_id
           AND item.archived_at IS NULL
          WHERE placement.tenant_id = drawing.tenant_id
            AND placement.project_id = drawing.project_id
            AND placement.drawing_id = drawing.id
            AND placement.archived_at IS NULL
        ), 0) AS placement_count
      FROM project_restarbejde_drawing drawing
      JOIN storage_object storage
        ON storage.tenant_id = drawing.tenant_id
       AND storage.id = drawing.storage_object_id
       AND storage.deleted_at IS NULL
      WHERE drawing.tenant_id = $1
        AND drawing.project_id = $2
        ${archivedSql}
      ORDER BY drawing.archived_at ASC NULLS FIRST, drawing.updated_at DESC, drawing.created_at DESC
    `,
    [tenantId, projectId]
  );
  return rows;
}

async function findDrawingById(client, { tenantId, projectId, drawingId, includeArchived = false }) {
  const archivedSql = includeArchived ? "" : "AND drawing.archived_at IS NULL";
  const { rows } = await client.query(
    `
      SELECT ${DRAWING_COLUMNS}
      FROM project_restarbejde_drawing drawing
      JOIN storage_object storage
        ON storage.tenant_id = drawing.tenant_id
       AND storage.id = drawing.storage_object_id
       AND storage.deleted_at IS NULL
      WHERE drawing.tenant_id = $1
        AND drawing.project_id = $2
        AND drawing.id = $3
        ${archivedSql}
      LIMIT 1
    `,
    [tenantId, projectId, drawingId]
  );
  return rows[0] || null;
}

async function insertDrawing(client, { tenantId, projectId, payload, actorUserId }) {
  const { rows } = await client.query(
    `
      INSERT INTO project_restarbejde_drawing (
        id,
        tenant_id,
        project_id,
        title,
        source_type,
        storage_object_id,
        original_filename,
        mime_type,
        file_size_bytes,
        page_count,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
      RETURNING
        id,
        tenant_id,
        project_id,
        title,
        source_type,
        storage_object_id,
        original_filename,
        mime_type,
        file_size_bytes,
        page_count,
        created_at,
        updated_at,
        created_by_user_id,
        updated_by_user_id,
        archived_at,
        archived_by_user_id
    `,
    [
      payload.id,
      tenantId,
      projectId,
      payload.title,
      payload.sourceType,
      payload.storageObjectId,
      payload.originalFilename,
      payload.mimeType,
      payload.fileSizeBytes,
      payload.pageCount,
      actorUserId,
    ]
  );
  return rows[0];
}

async function archiveDrawing(client, { tenantId, projectId, drawingId, actorUserId }) {
  const { rows } = await client.query(
    `
      UPDATE project_restarbejde_drawing
      SET archived_at = now(),
          archived_by_user_id = $4,
          updated_by_user_id = $4
      WHERE tenant_id = $1
        AND project_id = $2
        AND id = $3
        AND archived_at IS NULL
      RETURNING
        id,
        tenant_id,
        project_id,
        title,
        source_type,
        storage_object_id,
        original_filename,
        mime_type,
        file_size_bytes,
        page_count,
        created_at,
        updated_at,
        created_by_user_id,
        updated_by_user_id,
        archived_at,
        archived_by_user_id
    `,
    [tenantId, projectId, drawingId, actorUserId]
  );
  return rows[0] || null;
}

async function restoreDrawing(client, { tenantId, projectId, drawingId, actorUserId }) {
  const { rows } = await client.query(
    `
      UPDATE project_restarbejde_drawing
      SET archived_at = NULL,
          archived_by_user_id = NULL,
          updated_by_user_id = $4
      WHERE tenant_id = $1
        AND project_id = $2
        AND id = $3
        AND archived_at IS NOT NULL
      RETURNING
        id,
        tenant_id,
        project_id,
        title,
        source_type,
        storage_object_id,
        original_filename,
        mime_type,
        file_size_bytes,
        page_count,
        created_at,
        updated_at,
        created_by_user_id,
        updated_by_user_id,
        archived_at,
        archived_by_user_id
    `,
    [tenantId, projectId, drawingId, actorUserId]
  );
  return rows[0] || null;
}

async function listPlacementsForDrawing(client, { tenantId, projectId, drawingId, includeArchived = false }) {
  const archivedSql = includeArchived ? "" : "AND placement.archived_at IS NULL";
  const { rows } = await client.query(
    `
      SELECT placement.${PLACEMENT_COLUMNS.replace(/,\n  /g, ",\n        placement.")},
        item.kind AS item_kind,
        item.title AS item_title,
        item.status AS item_status
      FROM project_restarbejde_placement placement
      JOIN project_restarbejde_item item
        ON item.tenant_id = placement.tenant_id
       AND item.project_id = placement.project_id
       AND item.id = placement.item_id
       AND item.archived_at IS NULL
      JOIN project_restarbejde_drawing drawing
        ON drawing.tenant_id = placement.tenant_id
       AND drawing.project_id = placement.project_id
       AND drawing.id = placement.drawing_id
       AND drawing.archived_at IS NULL
      WHERE placement.tenant_id = $1
        AND placement.project_id = $2
        AND placement.drawing_id = $3
        ${archivedSql}
      ORDER BY placement.page_number ASC, placement.created_at ASC
    `,
    [tenantId, projectId, drawingId]
  );
  return rows;
}

async function findPlacementById(client, { tenantId, projectId, drawingId, placementId, includeArchived = false }) {
  const archivedSql = includeArchived ? "" : "AND archived_at IS NULL";
  const { rows } = await client.query(
    `
      SELECT ${PLACEMENT_COLUMNS}
      FROM project_restarbejde_placement
      WHERE tenant_id = $1
        AND project_id = $2
        AND drawing_id = $3
        AND id = $4
        ${archivedSql}
      LIMIT 1
    `,
    [tenantId, projectId, drawingId, placementId]
  );
  return rows[0] || null;
}

async function insertPlacement(client, { tenantId, projectId, drawingId, payload, actorUserId }) {
  const { rows } = await client.query(
    `
      INSERT INTO project_restarbejde_placement (
        tenant_id,
        project_id,
        item_id,
        drawing_id,
        page_number,
        x_percent,
        y_percent,
        label,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
      RETURNING ${PLACEMENT_COLUMNS}
    `,
    [tenantId, projectId, payload.itemId, drawingId, payload.pageNumber, payload.xPercent, payload.yPercent, payload.label, actorUserId]
  );
  return rows[0];
}

async function updatePlacement(client, { tenantId, projectId, drawingId, placementId, payload, actorUserId }) {
  const { rows } = await client.query(
    `
      UPDATE project_restarbejde_placement
      SET page_number = $5,
          x_percent = $6,
          y_percent = $7,
          label = $8,
          updated_by_user_id = $9
      WHERE tenant_id = $1
        AND project_id = $2
        AND drawing_id = $3
        AND id = $4
        AND archived_at IS NULL
      RETURNING ${PLACEMENT_COLUMNS}
    `,
    [tenantId, projectId, drawingId, placementId, payload.pageNumber, payload.xPercent, payload.yPercent, payload.label, actorUserId]
  );
  return rows[0] || null;
}

async function archivePlacement(client, { tenantId, projectId, drawingId, placementId, actorUserId }) {
  const { rows } = await client.query(
    `
      UPDATE project_restarbejde_placement
      SET archived_at = now(),
          archived_by_user_id = $5,
          updated_by_user_id = $5
      WHERE tenant_id = $1
        AND project_id = $2
        AND drawing_id = $3
        AND id = $4
        AND archived_at IS NULL
      RETURNING ${PLACEMENT_COLUMNS}
    `,
    [tenantId, projectId, drawingId, placementId, actorUserId]
  );
  return rows[0] || null;
}

async function restorePlacement(client, { tenantId, projectId, drawingId, placementId, actorUserId }) {
  const { rows } = await client.query(
    `
      UPDATE project_restarbejde_placement
      SET archived_at = NULL,
          archived_by_user_id = NULL,
          updated_by_user_id = $5
      WHERE tenant_id = $1
        AND project_id = $2
        AND drawing_id = $3
        AND id = $4
        AND archived_at IS NOT NULL
      RETURNING ${PLACEMENT_COLUMNS}
    `,
    [tenantId, projectId, drawingId, placementId, actorUserId]
  );
  return rows[0] || null;
}

async function listAttachmentsForItem(client, { tenantId, projectId, itemId, includeArchived = false }) {
  const archivedSql = includeArchived ? "" : "AND attachment.archived_at IS NULL";
  const { rows } = await client.query(
    `
      SELECT ${ATTACHMENT_COLUMNS}
      FROM project_restarbejde_attachment attachment
      JOIN project_restarbejde_item item
        ON item.tenant_id = attachment.tenant_id
       AND item.project_id = attachment.project_id
       AND item.id = attachment.item_id
       AND item.archived_at IS NULL
      JOIN storage_object storage
        ON storage.tenant_id = attachment.tenant_id
       AND storage.id = attachment.storage_object_id
       AND storage.deleted_at IS NULL
      WHERE attachment.tenant_id = $1
        AND attachment.project_id = $2
        AND attachment.item_id = $3
        ${archivedSql}
      ORDER BY attachment.created_at DESC
    `,
    [tenantId, projectId, itemId]
  );
  return rows;
}

async function findAttachmentById(client, { tenantId, projectId, itemId, attachmentId, includeArchived = false }) {
  const archivedSql = includeArchived ? "" : "AND attachment.archived_at IS NULL";
  const { rows } = await client.query(
    `
      SELECT ${ATTACHMENT_COLUMNS}
      FROM project_restarbejde_attachment attachment
      JOIN storage_object storage
        ON storage.tenant_id = attachment.tenant_id
       AND storage.id = attachment.storage_object_id
       AND storage.deleted_at IS NULL
      WHERE attachment.tenant_id = $1
        AND attachment.project_id = $2
        AND attachment.item_id = $3
        AND attachment.id = $4
        ${archivedSql}
      LIMIT 1
    `,
    [tenantId, projectId, itemId, attachmentId]
  );
  return rows[0] || null;
}

async function insertAttachment(client, { tenantId, projectId, itemId, payload, actorUserId }) {
  const { rows } = await client.query(
    `
      INSERT INTO project_restarbejde_attachment (
        id,
        tenant_id,
        project_id,
        item_id,
        storage_object_id,
        attachment_type,
        original_filename,
        mime_type,
        file_size_bytes,
        caption,
        created_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING
        id,
        tenant_id,
        project_id,
        item_id,
        storage_object_id,
        attachment_type,
        original_filename,
        mime_type,
        file_size_bytes,
        caption,
        created_at,
        created_by_user_id,
        archived_at,
        archived_by_user_id
    `,
    [payload.id, tenantId, projectId, itemId, payload.storageObjectId, payload.attachmentType, payload.originalFilename, payload.mimeType, payload.fileSizeBytes, payload.caption, actorUserId]
  );
  return rows[0];
}

async function archiveAttachment(client, { tenantId, projectId, itemId, attachmentId, actorUserId }) {
  const { rows } = await client.query(
    `
      UPDATE project_restarbejde_attachment
      SET archived_at = now(),
          archived_by_user_id = $5
      WHERE tenant_id = $1
        AND project_id = $2
        AND item_id = $3
        AND id = $4
        AND archived_at IS NULL
      RETURNING
        id,
        tenant_id,
        project_id,
        item_id,
        storage_object_id,
        attachment_type,
        original_filename,
        mime_type,
        file_size_bytes,
        caption,
        created_at,
        created_by_user_id,
        archived_at,
        archived_by_user_id
    `,
    [tenantId, projectId, itemId, attachmentId, actorUserId]
  );
  return rows[0] || null;
}
module.exports = {
  archiveAttachment,
  archiveDrawing,
  archiveItem,
  archivePlacement,
  findAttachmentById,
  findDrawingById,
  findItemById,
  findPlacementById,
  getSummary,
  insertAttachment,
  insertDrawing,
  insertItem,
  insertPlacement,
  listAttachmentsForItem,
  listDrawings,
  listItems,
  listPlacementsForDrawing,
  restoreDrawing,
  restoreItem,
  restorePlacement,
  updateItem,
  updatePlacement,
};
