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

function threadPersonalStateSql(userParam) {
  return `
    CASE
      WHEN qt.status = 'CLOSED' THEN 'closed'
      WHEN msg.latest_message_id IS NULL THEN 'seen'
      WHEN msg.latest_message_user_id = ${userParam}::uuid THEN 'sent'
      WHEN qtp.last_seen_message_id = msg.latest_message_id THEN 'seen'
      ELSE 'new'
    END
  `;
}

async function listThreadsForProjects(client, { tenantId, userId, projectIds }) {
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
        msg.latest_message_id,
        msg.latest_message_user_id,
        msg.latest_message_at,
        msg.latest_message_preview,
        qtp.last_seen_at,
        qtp.last_seen_message_id,
        COALESCE(qtp.is_assigned, false) AS is_assigned_to_me,
        ${threadPersonalStateSql("$2")} AS personal_state,
        (
          qt.status <> 'CLOSED'
          AND msg.latest_message_id IS NOT NULL
          AND msg.latest_message_user_id IS DISTINCT FROM $2::uuid
          AND qtp.last_seen_message_id IS DISTINCT FROM msg.latest_message_id
        ) AS is_unread
      FROM qa_threads qt
      LEFT JOIN project_core pc
        ON pc.project_id = qt.project_id
       AND pc.tenant_id = qt.tenant_id
      LEFT JOIN tenant_user tu
        ON tu.id = qt.created_by_user_id
       AND tu.tenant_id = qt.tenant_id
      LEFT JOIN qa_thread_participants qtp
        ON qtp.tenant_id = qt.tenant_id
       AND qtp.thread_id = qt.id
       AND qtp.tenant_user_id = $2
       AND qtp.active = true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS message_count,
          (
            ARRAY_AGG(id ORDER BY created_at DESC, id DESC)
            FILTER (WHERE deleted_at IS NULL)
          )[1] AS latest_message_id,
          (
            ARRAY_AGG(user_id ORDER BY created_at DESC, id DESC)
            FILTER (WHERE deleted_at IS NULL)
          )[1] AS latest_message_user_id,
          MAX(created_at) FILTER (WHERE deleted_at IS NULL) AS latest_message_at,
          (
            ARRAY_AGG(LEFT(message, 200) ORDER BY created_at DESC, id DESC)
            FILTER (WHERE deleted_at IS NULL)
          )[1] AS latest_message_preview
        FROM qa_messages
        WHERE tenant_id = qt.tenant_id
          AND thread_id = qt.id
      ) msg ON true
      WHERE qt.tenant_id = $1
        AND qt.project_id = ANY($3::uuid[])
      ORDER BY qt.updated_at DESC, qt.created_at DESC
    `,
    [tenantId, userId, projectIds]
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
        tu.name AS created_by_name,
        msg.latest_message_id,
        msg.latest_message_user_id,
        msg.latest_message_at,
        qtp.last_seen_at,
        qtp.last_seen_message_id,
        COALESCE(qtp.is_assigned, false) AS is_assigned_to_me,
        ${threadPersonalStateSql("$3")} AS personal_state,
        (
          qt.status <> 'CLOSED'
          AND msg.latest_message_id IS NOT NULL
          AND msg.latest_message_user_id IS DISTINCT FROM $3::uuid
          AND qtp.last_seen_message_id IS DISTINCT FROM msg.latest_message_id
        ) AS is_unread
      FROM qa_threads qt
      LEFT JOIN project_core pc
        ON pc.project_id = qt.project_id
       AND pc.tenant_id = qt.tenant_id
      LEFT JOIN tenant_user tu
        ON tu.id = qt.created_by_user_id
       AND tu.tenant_id = qt.tenant_id
      LEFT JOIN qa_thread_participants qtp
        ON qtp.tenant_id = qt.tenant_id
       AND qtp.thread_id = qt.id
       AND qtp.tenant_user_id = $3
       AND qtp.active = true
      LEFT JOIN LATERAL (
        SELECT
          id AS latest_message_id,
          user_id AS latest_message_user_id,
          created_at AS latest_message_at
        FROM qa_messages
        WHERE tenant_id = qt.tenant_id
          AND thread_id = qt.id
          AND deleted_at IS NULL
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      ) msg ON true
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

async function listProjectParticipants(client, { tenantId, projectId }) {
  const { rows } = await client.query(
    `
      WITH project AS (
        SELECT
          pc.tenant_id,
          pc.project_id,
          pc.owner_user_id,
          pc.responsible_code,
          pc.team_leader_code
        FROM project_core pc
        WHERE pc.tenant_id = $1
          AND pc.project_id = $2
        LIMIT 1
      ),
      participant_candidates AS (
        SELECT owner_user_id AS tenant_user_id, 'project_owner' AS visibility_source
        FROM project
        WHERE owner_user_id IS NOT NULL

        UNION

        SELECT pa.tenant_user_id, 'project_assignment'
        FROM project p
        JOIN project_assignment pa
          ON pa.tenant_id = p.tenant_id
         AND pa.project_id = p.project_id

        UNION

        SELECT tu.id, 'responsible'
        FROM project p
        JOIN tenant_user tu
          ON tu.tenant_id = p.tenant_id
         AND lower(btrim(tu.username)) = lower(btrim(p.responsible_code))
        WHERE nullif(btrim(p.responsible_code), '') IS NOT NULL

        UNION

        SELECT tu.id, 'team_leader'
        FROM project p
        JOIN tenant_user tu
          ON tu.tenant_id = p.tenant_id
         AND lower(btrim(tu.username)) = lower(btrim(p.team_leader_code))
        WHERE nullif(btrim(p.team_leader_code), '') IS NOT NULL
      )
      SELECT DISTINCT
        tu.id AS tenant_user_id,
        tu.name,
        tu.username,
        tu.role,
        pc.visibility_source
      FROM participant_candidates pc
      JOIN tenant_user tu
        ON tu.tenant_id = $1
       AND tu.id = pc.tenant_user_id
       AND tu.status = 'active'
      ORDER BY tu.name ASC, tu.username ASC
    `,
    [tenantId, projectId]
  );

  return rows;
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

async function listParticipantsForThread(client, { tenantId, threadId }) {
  const { rows } = await client.query(
    `
      SELECT
        qtp.id,
        qtp.tenant_id,
        qtp.thread_id,
        qtp.project_id,
        qtp.tenant_user_id,
        qtp.participant_role,
        qtp.is_assigned,
        qtp.assigned_at,
        qtp.assigned_by_user_id,
        qtp.last_seen_at,
        qtp.last_seen_message_id,
        qtp.visibility_source,
        qtp.active,
        qtp.created_at,
        qtp.updated_at,
        tu.name,
        tu.username,
        tu.role
      FROM qa_thread_participants qtp
      LEFT JOIN tenant_user tu
        ON tu.id = qtp.tenant_user_id
       AND tu.tenant_id = qtp.tenant_id
      WHERE qtp.tenant_id = $1
        AND qtp.thread_id = $2
      ORDER BY qtp.is_assigned DESC, tu.name ASC, tu.username ASC
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

async function upsertThreadParticipant(client, {
  tenantId,
  threadId,
  projectId,
  tenantUserId,
  participantRole,
  isAssigned,
  assignedByUserId,
  lastSeenAt,
  lastSeenMessageId,
  visibilitySource,
}) {
  const { rows } = await client.query(
    `
      INSERT INTO qa_thread_participants (
        tenant_id,
        thread_id,
        project_id,
        tenant_user_id,
        participant_role,
        is_assigned,
        assigned_at,
        assigned_by_user_id,
        last_seen_at,
        last_seen_message_id,
        visibility_source,
        active
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        CASE WHEN $6 = true THEN now() ELSE NULL END,
        $7,
        $8,
        $9,
        $10,
        true
      )
      ON CONFLICT (tenant_id, thread_id, tenant_user_id)
      DO UPDATE SET
        participant_role = CASE
          WHEN qa_thread_participants.participant_role = 'creator' THEN qa_thread_participants.participant_role
          ELSE EXCLUDED.participant_role
        END,
        is_assigned = qa_thread_participants.is_assigned OR EXCLUDED.is_assigned,
        assigned_at = CASE
          WHEN qa_thread_participants.is_assigned = true THEN qa_thread_participants.assigned_at
          ELSE EXCLUDED.assigned_at
        END,
        assigned_by_user_id = COALESCE(qa_thread_participants.assigned_by_user_id, EXCLUDED.assigned_by_user_id),
        last_seen_at = COALESCE(EXCLUDED.last_seen_at, qa_thread_participants.last_seen_at),
        last_seen_message_id = COALESCE(EXCLUDED.last_seen_message_id, qa_thread_participants.last_seen_message_id),
        visibility_source = CASE
          WHEN qa_thread_participants.visibility_source = 'self' THEN qa_thread_participants.visibility_source
          ELSE EXCLUDED.visibility_source
        END,
        active = true,
        updated_at = now()
      RETURNING
        id,
        tenant_id,
        thread_id,
        project_id,
        tenant_user_id,
        participant_role,
        is_assigned,
        assigned_at,
        assigned_by_user_id,
        last_seen_at,
        last_seen_message_id,
        visibility_source,
        active,
        created_at,
        updated_at
    `,
    [
      tenantId,
      threadId,
      projectId,
      tenantUserId,
      participantRole,
      Boolean(isAssigned),
      assignedByUserId || null,
      lastSeenAt || null,
      lastSeenMessageId || null,
      visibilitySource || "explicit",
    ]
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

async function getLatestMessageForThread(client, { tenantId, threadId }) {
  const { rows } = await client.query(
    `
      SELECT
        id,
        tenant_id,
        thread_id,
        project_id,
        user_id,
        created_at
      FROM qa_messages
      WHERE tenant_id = $1
        AND thread_id = $2
        AND deleted_at IS NULL
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    [tenantId, threadId]
  );

  return rows[0] || null;
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
  getLatestMessageForThread,
  getProjectScopeForUser,
  getThreadSummaryForProjects,
  listParticipantsForThread,
  listProjectParticipants,
  listMessagesForThread,
  listThreadsForProjects,
  touchThread,
  updateThreadStatus,
  upsertThreadParticipant,
};
