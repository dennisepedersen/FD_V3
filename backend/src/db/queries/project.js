async function listProjectsForUser(client, { tenantId, userId }) {
  const sql = `
    SELECT DISTINCT
      pc.project_id,
      pc.external_project_ref,
      pc.name,
      pc.status,
      pc.owner_user_id,
      pc.created_at,
      pc.updated_at
    FROM project_core pc
    LEFT JOIN project_assignment pa
      ON pa.tenant_id = pc.tenant_id
     AND pa.project_id = pc.project_id
    WHERE pc.tenant_id = $1
      AND (
        pc.owner_user_id = $2
        OR pa.tenant_user_id = $2
      )
    ORDER BY pc.updated_at DESC, pc.name ASC
    LIMIT 100
  `;

  const { rows } = await client.query(sql, [tenantId, userId]);
  return rows;
}

module.exports = {
  listProjectsForUser,
};
