const projectQueries = require("../../db/queries/project");

async function getProjectScopeForUser(client, { tenantId, userId, projectId }) {
  const project = await projectQueries.findProjectForUser(client, {
    tenantId,
    userId,
    projectId,
  });

  if (!project) {
    return null;
  }

  const { rows } = await client.query(
    `
      SELECT merged_entity_id::text AS project_id
      FROM merge_links
      WHERE tenant_id = $1
        AND entity_type = 'project'
        AND master_entity_id = $2
        AND merge_status = 'confirmed'
    `,
    [tenantId, projectId]
  );

  const projectIds = [projectId];
  rows.forEach((row) => {
    if (row && row.project_id) {
      projectIds.push(String(row.project_id));
    }
  });

  return {
    project,
    projectIds: Array.from(new Set(projectIds)),
  };
}

async function getThreadSummaryForProjects(client, { tenantId, projectIds }) {
  const { rows } = await client.query(
    `
      SELECT status, COUNT(*)::int AS count
      FROM qa_threads
      WHERE tenant_id = $1
        AND project_id = ANY($2::uuid[])
      GROUP BY status
    `,
    [tenantId, projectIds]
  );

  const summary = {
    NEW: 0,
    WAITING: 0,
    ANSWERED: 0,
    CLOSED: 0,
  };

  rows.forEach((row) => {
    if (Object.prototype.hasOwnProperty.call(summary, row.status)) {
      summary[row.status] = Number(row.count || 0);
    }
  });

  return summary;
}

async function listThreadsForProjects(client, { tenantId, projectIds }) {
  const { rows } = await client.query(
    `
      SELECT
        qt.id,
        qt.tenant_id,
        qt.project_id,
        qt.title,
        qt.status,
        qt.priority,
        qt.created_by_user_id,
        qt.created_at,
        qt.updated_at,
        pc.name AS project_name,
        pc.external_project_ref,
        tu.name AS created_by_name,
        COALESCE(msg.message_count, 0) AS message_count,
        msg.latest_message_at,
        msg.latest_message_preview
      FROM qa_threads qt
      LEFT JOIN project_core pc
        ON pc.project_id = qt.project_id
       AND pc.tenant_id = qt.tenant_id
      LEFT JOIN tenant_user tu
        ON tu.id = qt.created_by_user_id
       AND tu.tenant_id = qt.tenant_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS message_count,
          MAX(created_at) FILTER (WHERE deleted_at IS NULL) AS latest_message_at,
          (
            ARRAY_AGG(LEFT(message, 200) ORDER BY created_at DESC)
            FILTER (WHERE deleted_at IS NULL)
          )[1] AS latest_message_preview
        FROM qa_messages
        WHERE tenant_id = qt.tenant_id
          AND thread_id = qt.id
      ) msg ON true
      WHERE qt.tenant_id = $1
        AND qt.project_id = ANY($2::uuid[])
      ORDER BY qt.updated_at DESC, qt.created_at DESC
    `,
    [tenantId, projectIds]
  );

  return rows;
}

async function findThreadForUser(client, { tenantId, userId, threadId }) {
  const { rows } = await client.query(
    `
      WITH current_actor AS (
        SELECT lower(nullif(btrim(username), '')) AS username_ci
        FROM tenant_user
        WHERE tenant_id = $1
          AND id = $3
        LIMIT 1
      ),
      accessible_projects AS (
        SELECT DISTINCT pc.project_id
        FROM project_core pc
        CROSS JOIN current_actor cu
        LEFT JOIN project_assignment pa
          ON pa.tenant_id = pc.tenant_id
         AND pa.project_id = pc.project_id
        WHERE pc.tenant_id = $1
          AND (
            (COALESCE(pc.is_closed, false) = false AND pc.has_v4 = true)
            OR (
              pc.is_closed = true
              AND pc.closed_observed_at IS NOT NULL
              AND pc.closed_observed_at > (now() - interval '6 months')
            )
          )
          AND (
            (cu.username_ci IS NOT NULL AND lower(btrim(coalesce(pc.responsible_code, ''))) = cu.username_ci)
            OR
            (cu.username_ci IS NOT NULL AND lower(btrim(coalesce(pc.team_leader_code, ''))) = cu.username_ci)
            OR
            pc.owner_user_id = $3
            OR pa.tenant_user_id = $3
          )
      )
      SELECT
        qt.id,
        qt.tenant_id,
        qt.project_id,
        qt.title,
        qt.status,
        qt.priority,
        qt.created_by_user_id,
        qt.created_at,
        qt.updated_at,
        pc.name AS project_name,
        pc.external_project_ref,
        tu.name AS created_by_name
      FROM qa_threads qt
      LEFT JOIN project_core pc
        ON pc.project_id = qt.project_id
       AND pc.tenant_id = qt.tenant_id
      LEFT JOIN tenant_user tu
        ON tu.id = qt.created_by_user_id
       AND tu.tenant_id = qt.tenant_id
      WHERE qt.tenant_id = $1
        AND qt.id = $2
        AND EXISTS (
          SELECT 1
          FROM accessible_projects ap
          WHERE ap.project_id = qt.project_id
             OR EXISTS (
               SELECT 1
               FROM merge_links ml
               WHERE ml.tenant_id = $1
                 AND ml.entity_type = 'project'
                 AND ml.merge_status = 'confirmed'
                 AND ml.master_entity_id = ap.project_id
                 AND ml.merged_entity_id = qt.project_id
             )
        )
      LIMIT 1
    `,
    [tenantId, threadId, userId]
  );

  return rows[0] || null;
}

async function listMessagesForThread(client, { tenantId, threadId }) {
  const { rows } = await client.query(
    `
      SELECT
        qm.id,
        qm.tenant_id,
        qm.thread_id,
        qm.project_id,
        qm.user_id,
        qm.message,
        qm.created_at,
        qm.edited_at,
        qm.deleted_at,
        tu.name AS user_name
      FROM qa_messages qm
      LEFT JOIN tenant_user tu
        ON tu.id = qm.user_id
       AND tu.tenant_id = qm.tenant_id
      WHERE qm.tenant_id = $1
        AND qm.thread_id = $2
      ORDER BY qm.created_at ASC, qm.id ASC
    `,
    [tenantId, threadId]
  );

  return rows;
}

async function createThread(client, { tenantId, projectId, title, priority, createdByUserId }) {
  const { rows } = await client.query(
    `
      INSERT INTO qa_threads (
        tenant_id,
        project_id,
        title,
        status,
        priority,
        created_by_user_id
      )
      VALUES ($1, $2, $3, 'NEW', $4, $5)
      RETURNING id, tenant_id, project_id, title, status, priority, created_by_user_id, created_at, updated_at
    `,
    [tenantId, projectId, title, priority, createdByUserId]
  );

  return rows[0];
}

async function createMessage(client, { tenantId, threadId, projectId, userId, message }) {
  const { rows } = await client.query(
    `
      INSERT INTO qa_messages (
        tenant_id,
        thread_id,
        project_id,
        user_id,
        message
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, tenant_id, thread_id, project_id, user_id, message, created_at, edited_at, deleted_at
    `,
    [tenantId, threadId, projectId, userId, message]
  );

  return rows[0];
}

async function touchThread(client, { tenantId, threadId }) {
  await client.query(
    `
      UPDATE qa_threads
      SET updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [tenantId, threadId]
  );
}

async function updateThreadStatus(client, { tenantId, threadId, status }) {
  const { rows } = await client.query(
    `
      UPDATE qa_threads
      SET status = $3,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING id, tenant_id, project_id, title, status, priority, created_by_user_id, created_at, updated_at
    `,
    [tenantId, threadId, status]
  );

  return rows[0] || null;
}

module.exports = {
  createMessage,
  createThread,
  findThreadForUser,
  getProjectScopeForUser,
  getThreadSummaryForProjects,
  listMessagesForThread,
  listThreadsForProjects,
  touchThread,
  updateThreadStatus,
};