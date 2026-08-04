"use strict";

async function findById(client, { tenantId, absenceTypeId }) {
  const { rows } = await client.query(
    `
      SELECT
        id,
        tenant_id,
        key,
        name,
        description,
        workflow_mode,
        comment_policy,
        visibility_policy,
        allowed_duration_types,
        special_window_eligible,
        is_active,
        sort_order,
        created_by_tenant_user_id,
        updated_by_tenant_user_id,
        created_at,
        updated_at
      FROM absence_type
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, absenceTypeId]
  );

  return rows[0] || null;
}

async function listActive(client, { tenantId }) {
  const { rows } = await client.query(
    `
      SELECT
        id,
        tenant_id,
        key,
        name,
        workflow_mode,
        comment_policy,
        visibility_policy,
        allowed_duration_types,
        special_window_eligible,
        sort_order
      FROM absence_type
      WHERE tenant_id = $1
        AND is_active = true
      ORDER BY sort_order ASC, name ASC, key ASC
    `,
    [tenantId]
  );

  return rows;
}

async function insertAbsenceType(client, {
  tenantId,
  key,
  name,
  description = null,
  workflowMode = "request",
  commentPolicy = "optional",
  visibilityPolicy = "private",
  allowedDurationTypes = ["full_days", "time_range"],
  specialWindowEligible = false,
  sortOrder = 100,
  actorUserId = null,
}) {
  const { rows } = await client.query(
    `
      INSERT INTO absence_type (
        tenant_id,
        key,
        name,
        description,
        workflow_mode,
        comment_policy,
        visibility_policy,
        allowed_duration_types,
        special_window_eligible,
        sort_order,
        created_by_tenant_user_id,
        updated_by_tenant_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9, $10, $11, $11)
      RETURNING
        id,
        tenant_id,
        key,
        name,
        workflow_mode,
        comment_policy,
        visibility_policy,
        allowed_duration_types,
        special_window_eligible,
        is_active,
        sort_order,
        created_at,
        updated_at
    `,
    [
      tenantId,
      key,
      name,
      description,
      workflowMode,
      commentPolicy,
      visibilityPolicy,
      allowedDurationTypes,
      specialWindowEligible === true,
      sortOrder,
      actorUserId,
    ]
  );

  return rows[0];
}

module.exports = {
  findById,
  insertAbsenceType,
  listActive,
};
