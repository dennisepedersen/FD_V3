function json(value) {
  return JSON.stringify(value == null ? null : value);
}

function mapIdea(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    tags_json: row.tags_json || [],
    latest_analysis: row.latest_analysis || null,
    attachment_count: Number(row.attachment_count || 0),
    active_attachment_count: Number(row.active_attachment_count || 0),
  };
}

async function listIdeas(client, { status, limit }) {
  const values = [];
  const filters = [];

  if (status) {
    values.push(status);
    filters.push(`li.status = $${values.length}`);
  }

  values.push(limit);
  const limitPlaceholder = `$${values.length}`;

  const { rows } = await client.query(
    `
      SELECT
        li.*,
        COALESCE(att.total_count, 0)::int AS attachment_count,
        COALESCE(att.active_count, 0)::int AS active_attachment_count,
        latest.analysis AS latest_analysis
      FROM labs_idea li
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS total_count,
          COUNT(*) FILTER (WHERE archived_at IS NULL)::int AS active_count
        FROM labs_attachment la
        WHERE la.idea_id = li.id
      ) att ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_build_object(
          'id', la.id,
          'analysis_version', la.analysis_version,
          'status', la.status,
          'summary', la.summary,
          'recommendation', la.recommendation,
          'score', la.score,
          'critical_open_questions', la.critical_open_questions_json,
          'noncritical_open_questions', la.noncritical_open_questions_json,
          'created_at', la.created_at,
          'completed_at', la.completed_at,
          'analysis_freshness', la.analysis_freshness
        ) AS analysis
        FROM labs_analysis la
        WHERE la.idea_id = li.id
        ORDER BY la.created_at DESC
        LIMIT 1
      ) latest ON true
      ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
      ORDER BY li.updated_at DESC, li.created_at DESC
      LIMIT ${limitPlaceholder}
    `,
    values
  );

  return rows.map(mapIdea);
}

async function findIdeaById(client, { ideaId }) {
  const { rows } = await client.query(
    `
      SELECT
        li.*,
        COALESCE(att.total_count, 0)::int AS attachment_count,
        COALESCE(att.active_count, 0)::int AS active_attachment_count,
        latest.analysis AS latest_analysis
      FROM labs_idea li
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS total_count,
          COUNT(*) FILTER (WHERE archived_at IS NULL)::int AS active_count
        FROM labs_attachment la
        WHERE la.idea_id = li.id
      ) att ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_build_object(
          'id', la.id,
          'analysis_version', la.analysis_version,
          'status', la.status,
          'summary', la.summary,
          'recommendation', la.recommendation,
          'score', la.score,
          'critical_open_questions', la.critical_open_questions_json,
          'noncritical_open_questions', la.noncritical_open_questions_json,
          'created_at', la.created_at,
          'completed_at', la.completed_at,
          'analysis_freshness', la.analysis_freshness
        ) AS analysis
        FROM labs_analysis la
        WHERE la.idea_id = li.id
        ORDER BY la.created_at DESC
        LIMIT 1
      ) latest ON true
      WHERE li.id = $1
      LIMIT 1
    `,
    [ideaId]
  );

  return mapIdea(rows[0]);
}

async function createIdea(client, {
  title,
  moduleKey,
  problem,
  desiredFunction,
  priority,
  description,
  source,
  tags,
  actorId,
  status,
}) {
  const { rows } = await client.query(
    `
      INSERT INTO labs_idea (
        title,
        module_key,
        problem,
        desired_function,
        priority,
        description,
        status,
        source,
        tags_json,
        created_by_global_actor_id,
        updated_by_global_actor_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $10)
      RETURNING *
    `,
    [title, moduleKey, problem, desiredFunction, priority, description, status, source, json(tags), actorId]
  );

  return mapIdea(rows[0]);
}

async function updateIdea(client, {
  ideaId,
  title,
  moduleKey,
  problem,
  desiredFunction,
  priority,
  description,
  source,
  tags,
  status,
  actorId,
}) {
  const { rows } = await client.query(
    `
      UPDATE labs_idea
      SET title = $2,
          module_key = $3,
          problem = $4,
          desired_function = $5,
          priority = $6,
          description = $7,
          source = $8,
          tags_json = $9::jsonb,
          status = $10,
          updated_by_global_actor_id = $11
      WHERE id = $1
      RETURNING *
    `,
    [ideaId, title, moduleKey, problem, desiredFunction, priority, description, source, json(tags), status, actorId]
  );

  return mapIdea(rows[0]);
}

async function updateIdeaStatus(client, {
  ideaId,
  status,
  actorId,
  reasonField,
  reason,
  timestampField,
  actorField,
}) {
  const allowedReasonFields = new Set(["rejected_reason", "reopened_reason", "parked_reason"]);
  const allowedTimestampFields = new Set(["approved_for_spec_at", "rejected_at", "reopened_at", "parked_at"]);
  const allowedActorFields = new Set(["approved_for_spec_by", "rejected_by", "reopened_by", "parked_by"]);

  const assignments = [
    "status = $2",
    "updated_by_global_actor_id = $3",
  ];
  const values = [ideaId, status, actorId];

  if (timestampField) {
    if (!allowedTimestampFields.has(timestampField)) {
      throw new Error("invalid_labs_timestamp_field");
    }
    assignments.push(`${timestampField} = now()`);
  }

  if (actorField) {
    if (!allowedActorFields.has(actorField)) {
      throw new Error("invalid_labs_actor_field");
    }
    assignments.push(`${actorField} = $3`);
  }

  if (reasonField) {
    if (!allowedReasonFields.has(reasonField)) {
      throw new Error("invalid_labs_reason_field");
    }
    values.push(reason || null);
    assignments.push(`${reasonField} = $${values.length}`);
  }

  const { rows } = await client.query(
    `
      UPDATE labs_idea
      SET ${assignments.join(", ")}
      WHERE id = $1
      RETURNING *
    `,
    values
  );

  return mapIdea(rows[0]);
}

async function nextAnalysisVersion(client, { ideaId }) {
  const { rows } = await client.query(
    `
      SELECT COALESCE(MAX(analysis_version), 0) + 1 AS next_version
      FROM labs_analysis
      WHERE idea_id = $1
    `,
    [ideaId]
  );

  return Number(rows[0]?.next_version || 1);
}

async function createAnalysis(client, {
  ideaId,
  analysisVersion,
  status,
  schemaVersion,
  analysisJson,
  summary,
  recommendation,
  score,
  subscores,
  openQuestions,
  criticalOpenQuestions,
  noncriticalOpenQuestions,
  conflicts,
  docsRead,
  evidenceLevel,
  modelProvider,
  modelName,
  promptVersion,
  inputSnapshot,
  attachmentMetadataSnapshot,
  actorId,
  failureCode,
  failureSummary,
}) {
  const completedAt = status === "completed" ? "now()" : "NULL";
  const failedAt = status === "failed" ? "now()" : "NULL";
  const { rows } = await client.query(
    `
      INSERT INTO labs_analysis (
        idea_id,
        analysis_version,
        status,
        schema_version,
        analysis_json,
        summary,
        recommendation,
        score,
        subscores_json,
        open_questions_json,
        critical_open_questions_json,
        noncritical_open_questions_json,
        conflicts_json,
        docs_read_json,
        evidence_level,
        model_provider,
        model_name,
        prompt_version,
        input_snapshot_json,
        attachment_metadata_snapshot_json,
        created_by_global_actor_id,
        completed_at,
        failed_at,
        failure_code,
        failure_summary
      )
      VALUES (
        $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, $10::jsonb,
        $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15, $16, $17,
        $18, $19::jsonb, $20::jsonb, $21, ${completedAt}, ${failedAt}, $22, $23
      )
      RETURNING *
    `,
    [
      ideaId,
      analysisVersion,
      status,
      schemaVersion,
      json(analysisJson),
      summary,
      recommendation,
      score,
      json(subscores),
      json(openQuestions),
      json(criticalOpenQuestions),
      json(noncriticalOpenQuestions),
      json(conflicts),
      json(docsRead),
      evidenceLevel,
      modelProvider,
      modelName,
      promptVersion,
      json(inputSnapshot),
      json(attachmentMetadataSnapshot),
      actorId,
      failureCode || null,
      failureSummary || null,
    ]
  );

  return rows[0];
}

async function listAnalyses(client, { ideaId }) {
  const { rows } = await client.query(
    `
      SELECT *
      FROM labs_analysis
      WHERE idea_id = $1
      ORDER BY analysis_version DESC
    `,
    [ideaId]
  );
  return rows;
}

async function listAttachments(client, { ideaId, includeArchived = false }) {
  const { rows } = await client.query(
    `
      SELECT
        id,
        idea_id,
        storage_object_id,
        file_name,
        content_type,
        file_extension,
        size_bytes,
        attachment_type,
        description,
        created_by_global_actor_id,
        created_at,
        archived_at,
        archived_by
      FROM labs_attachment
      WHERE idea_id = $1
        ${includeArchived ? "" : "AND archived_at IS NULL"}
      ORDER BY created_at DESC
    `,
    [ideaId]
  );
  return rows;
}

async function countActiveAttachments(client, { ideaId }) {
  const { rows } = await client.query(
    `
      SELECT COUNT(*)::int AS count
      FROM labs_attachment
      WHERE idea_id = $1
        AND archived_at IS NULL
    `,
    [ideaId]
  );
  return Number(rows[0]?.count || 0);
}

async function createAttachment(client, {
  ideaId,
  storageObjectId,
  fileName,
  contentType,
  fileExtension,
  sizeBytes,
  attachmentType,
  description,
  actorId,
}) {
  const { rows } = await client.query(
    `
      INSERT INTO labs_attachment (
        idea_id,
        storage_object_id,
        file_name,
        content_type,
        file_extension,
        size_bytes,
        attachment_type,
        description,
        created_by_global_actor_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `,
    [ideaId, storageObjectId, fileName, contentType, fileExtension, sizeBytes, attachmentType, description, actorId]
  );
  return rows[0];
}

async function findAttachmentById(client, { attachmentId }) {
  const { rows } = await client.query(
    `
      SELECT *
      FROM labs_attachment
      WHERE id = $1
      LIMIT 1
    `,
    [attachmentId]
  );
  return rows[0] || null;
}

async function archiveAttachment(client, { attachmentId, actorId }) {
  const { rows } = await client.query(
    `
      UPDATE labs_attachment
      SET archived_at = now(),
          archived_by = $2
      WHERE id = $1
        AND archived_at IS NULL
      RETURNING *
    `,
    [attachmentId, actorId]
  );
  return rows[0] || null;
}

async function createHistory(client, {
  ideaId,
  eventType,
  fromStatus,
  toStatus,
  changedFields,
  reason,
  actorId,
}) {
  const { rows } = await client.query(
    `
      INSERT INTO labs_idea_history (
        idea_id,
        event_type,
        from_status,
        to_status,
        changed_fields_json,
        reason,
        created_by_global_actor_id
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
      RETURNING *
    `,
    [ideaId, eventType, fromStatus || null, toStatus || null, json(changedFields || {}), reason || null, actorId]
  );
  return rows[0];
}

async function listHistory(client, { ideaId }) {
  const { rows } = await client.query(
    `
      SELECT *
      FROM labs_idea_history
      WHERE idea_id = $1
      ORDER BY created_at DESC
    `,
    [ideaId]
  );
  return rows;
}

module.exports = {
  archiveAttachment,
  countActiveAttachments,
  createAnalysis,
  createAttachment,
  createHistory,
  createIdea,
  findAttachmentById,
  findIdeaById,
  listAnalyses,
  listAttachments,
  listHistory,
  listIdeas,
  nextAnalysisVersion,
  updateIdea,
  updateIdeaStatus,
};
