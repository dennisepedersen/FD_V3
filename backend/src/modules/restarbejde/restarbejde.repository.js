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

module.exports = {
  archiveItem,
  findItemById,
  getSummary,
  insertItem,
  listItems,
  restoreItem,
  updateItem,
};
