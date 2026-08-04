'use strict';

const RETENTION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ACTIVE_WORKSHEET_STATUSES = new Set(['notstarted', 'inprogress', 'partiallycompleted']);
const TERMINAL_WORKSHEET_STATUSES = new Set(['completed', 'closed', 'cancelled', 'canceled']);
const COMMON_FITTER_PATTERN = /\b(default|system|shared|common|faelles|fælles|pulje|pool|vikar)\b/i;

function pickAny(raw, keys) {
  for (const key of keys) {
    if (raw && Object.prototype.hasOwnProperty.call(raw, key)) {
      const value = raw[key];
      if (value !== undefined) return value;
    }
  }
  return null;
}

function asNullableText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function asNullableTimestamp(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2}T/.test(text) && !/(Z|[+-]\d{2}:\d{2})$/i.test(text)
    ? `${text}Z`
    : text;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function asNullableBigIntText(value) {
  const text = asNullableText(value);
  if (!text || !/^\d+$/.test(text)) return null;
  return text;
}

function normalizeCommonFitterHaystack(value) {
  return String(value || '')
    .replace(/\u00e6/gi, 'ae')
    .replace(/\u00c3\u00a6/gi, 'ae');
}

function addRetentionDays(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getTime() + RETENTION_DAYS * MS_PER_DAY).toISOString();
}

function normalizeStatus(value) {
  const text = asNullableText(value);
  return text ? text.replace(/[\s_-]+/g, '').toLowerCase() : null;
}

function mapWorksheetRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const worksheetId = asNullableText(pickAny(raw, ['id', 'ID', 'worksheetID', 'workSheetID', 'WorkSheetID']));
  if (!worksheetId) return null;

  const responsibleFitterId = asNullableText(pickAny(raw, [
    'responsibleFitterID',
    'ResponsibleFitterID',
    'fitterID',
    'FitterID',
  ]));
  const statusEnum = asNullableText(pickAny(raw, ['statusEnum', 'StatusEnum', 'status', 'Status']));

  return {
    worksheetId,
    ekProjectId: asNullableBigIntText(pickAny(raw, ['projectID', 'ProjectID'])),
    projectReference: asNullableText(pickAny(raw, ['projectReference', 'ProjectReference'])),
    fitterId: responsibleFitterId,
    responsibleFitterId,
    responsibleFitterName: asNullableText(pickAny(raw, ['responsibleFitterName', 'ResponsibleFitterName', 'fitterName', 'FitterName'])),
    statusEnum,
    startDate: asNullableTimestamp(pickAny(raw, ['startDate', 'StartDate', 'worksheetStartDate', 'WorksheetStartDate'])),
    completedDate: asNullableTimestamp(pickAny(raw, ['completedDate', 'CompletedDate'])),
    closedDate: asNullableTimestamp(pickAny(raw, ['closedDate', 'ClosedDate'])),
    sourceUpdatedAt: asNullableTimestamp(pickAny(raw, ['updatedDate', 'UpdatedDate'])),
    rawPayloadJson: raw,
  };
}

function classifyWorksheetLifecycle(row, now = new Date()) {
  const status = normalizeStatus(row && row.statusEnum);
  if (status && ACTIVE_WORKSHEET_STATUSES.has(status)) {
    return {
      isAccessCandidate: true,
      validUntil: null,
      reason: 'active_status',
    };
  }

  const authoritativeEnd = row && (row.closedDate || row.completedDate);
  const validUntil = authoritativeEnd ? addRetentionDays(authoritativeEnd) : null;
  const validUntilMs = validUntil ? new Date(validUntil).getTime() : null;
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();

  if (authoritativeEnd) {
    if (validUntilMs != null && validUntilMs >= nowMs) {
      return {
        isAccessCandidate: true,
        validUntil,
        reason: 'terminal_within_retention',
      };
    }
    return {
      isAccessCandidate: false,
      validUntil,
      reason: 'terminal_retention_expired',
    };
  }

  if (!status) {
    return {
      isAccessCandidate: true,
      validUntil: null,
      reason: 'active_status',
    };
  }

  if (TERMINAL_WORKSHEET_STATUSES.has(status)) {
    return {
      isAccessCandidate: false,
      validUntil: null,
      reason: 'terminal_without_timestamp',
    };
  }

  return {
    isAccessCandidate: false,
    validUntil: null,
    reason: 'unsupported_status',
  };
}

function isCommonOrSystemFitter(fitter) {
  const haystack = normalizeCommonFitterHaystack([
    fitter && fitter.fitter_id,
    fitter && fitter.external_id,
    fitter && fitter.name,
    fitter && fitter.username,
    fitter && fitter.email,
  ].filter(Boolean).join(' '));
  if (!haystack.trim()) return false;
  return COMMON_FITTER_PATTERN.test(haystack);
}

async function resolveWorksheetProject(client, { tenantId, worksheet }) {
  const params = [tenantId];
  const predicates = [];

  if (worksheet.ekProjectId) {
    params.push(worksheet.ekProjectId);
    predicates.push(`pm.ek_project_id = $${params.length}::bigint`);
  }
  if (worksheet.projectReference) {
    params.push(worksheet.projectReference);
    predicates.push(`lower(btrim(pc.external_project_ref)) = lower(btrim($${params.length}))`);
  }
  if (!predicates.length) {
    return { project: null, reason: 'missing_project_identifier' };
  }

  const { rows } = await client.query(
    `
      SELECT DISTINCT
        pc.project_id,
        pc.tenant_id,
        pc.external_project_ref,
        pm.ek_project_id
      FROM project_core pc
      LEFT JOIN project_masterdata_v4 pm
        ON pm.tenant_id = pc.tenant_id
       AND pm.project_id = pc.project_id
      WHERE pc.tenant_id = $1
        AND (${predicates.join(' OR ')})
      LIMIT 2
    `,
    params
  );

  if (rows.length !== 1) {
    return { project: null, reason: `project_mapping_${rows.length === 0 ? 'missing' : 'ambiguous'}` };
  }
  return { project: rows[0], reason: null };
}

async function resolveWorksheetFitter(client, { tenantId, worksheet }) {
  if (!worksheet.fitterId) {
    return { fitter: null, reason: 'missing_fitter_identifier' };
  }

  const { rows } = await client.query(
    `
      SELECT DISTINCT
        f.id,
        f.tenant_id,
        f.fitter_id,
        f.external_id,
        f.name,
        f.username,
        f.email,
        f.tenant_user_id,
        tu.status AS tenant_user_status,
        tu.login_status AS tenant_user_login_status
      FROM fitter f
      JOIN tenant_user tu
        ON tu.tenant_id = f.tenant_id
       AND tu.id = f.tenant_user_id
      WHERE f.tenant_id = $1
        AND (
          f.fitter_id = $2
          OR f.external_id = $2
        )
        AND tu.status = 'active'
        AND tu.login_status = 'active'
      LIMIT 2
    `,
    [tenantId, worksheet.fitterId]
  );

  if (rows.length !== 1) {
    return { fitter: null, reason: `fitter_mapping_${rows.length === 0 ? 'missing_or_inactive' : 'ambiguous'}` };
  }
  if (isCommonOrSystemFitter(rows[0])) {
    return { fitter: null, reason: 'common_or_system_fitter' };
  }
  return { fitter: rows[0], reason: null };
}

async function deleteEffectiveAssignmentIfNoActiveSources(client, { tenantId, projectId, userId }) {
  const { rows } = await client.query(
    `
      DELETE FROM project_assignment pa
      WHERE pa.tenant_id = $1
        AND pa.project_id = $2
        AND pa.tenant_user_id = $3
        AND NOT EXISTS (
          SELECT 1
          FROM project_assignment_source pas
          WHERE pas.tenant_id = pa.tenant_id
            AND pas.project_id = pa.project_id
            AND pas.tenant_user_id = pa.tenant_user_id
            AND (pas.valid_until IS NULL OR pas.valid_until > now())
        )
      RETURNING id, tenant_id, project_id, tenant_user_id, assignment_role, created_at, updated_at
    `,
    [tenantId, projectId, userId]
  );
  return rows[0] || null;
}

async function materializeEffectiveAssignment(client, { tenantId, projectId, userId, assignmentRole }) {
  const { rows } = await client.query(
    `
      INSERT INTO project_assignment (tenant_id, project_id, tenant_user_id, assignment_role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (project_id, tenant_user_id)
      DO UPDATE SET
        assignment_role = CASE
          WHEN EXISTS (
            SELECT 1
            FROM project_assignment_source pas
            WHERE pas.tenant_id = EXCLUDED.tenant_id
              AND pas.project_id = EXCLUDED.project_id
              AND pas.tenant_user_id = EXCLUDED.tenant_user_id
              AND pas.source_type = 'manual'
              AND (pas.valid_until IS NULL OR pas.valid_until > now())
          ) THEN project_assignment.assignment_role
          ELSE EXCLUDED.assignment_role
        END,
        updated_at = now()
      WHERE project_assignment.tenant_id = EXCLUDED.tenant_id
      RETURNING
        id,
        tenant_id,
        project_id,
        tenant_user_id,
        assignment_role,
        created_at,
        updated_at,
        (xmax = 0) AS inserted
    `,
    [tenantId, projectId, userId, assignmentRole || 'contributor']
  );
  return rows[0] || null;
}

async function upsertAssignmentSource(client, {
  tenantId,
  projectId,
  userId,
  sourceType,
  sourceKey,
  assignmentRole = 'contributor',
  validUntil = null,
  lastReconciliationId = null,
  payload = {},
}) {
  await client.query(
    `
      INSERT INTO project_assignment_source (
        tenant_id,
        project_id,
        tenant_user_id,
        source_type,
        source_key,
        assignment_role,
        valid_from,
        valid_until,
        last_observed_at,
        last_reconciliation_id,
        source_payload_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, now(), $7::timestamptz, now(), $8::uuid, $9::jsonb)
      ON CONFLICT (tenant_id, source_type, source_key)
      DO UPDATE SET
        project_id = EXCLUDED.project_id,
        tenant_user_id = EXCLUDED.tenant_user_id,
        assignment_role = EXCLUDED.assignment_role,
        valid_until = EXCLUDED.valid_until,
        last_observed_at = EXCLUDED.last_observed_at,
        last_reconciliation_id = EXCLUDED.last_reconciliation_id,
        source_payload_json = EXCLUDED.source_payload_json,
        updated_at = now()
    `,
    [
      tenantId,
      projectId,
      userId,
      sourceType,
      sourceKey,
      assignmentRole,
      validUntil,
      lastReconciliationId,
      JSON.stringify(payload || {}),
    ]
  );

  return materializeEffectiveAssignment(client, {
    tenantId,
    projectId,
    userId,
    assignmentRole,
  });
}

async function removeWorksheetSource(client, { tenantId, sourceKey }) {
  const { rows } = await client.query(
    `
      DELETE FROM project_assignment_source
      WHERE tenant_id = $1
        AND source_type = 'worksheet'
        AND source_key = $2
      RETURNING project_id, tenant_user_id
    `,
    [tenantId, sourceKey]
  );

  for (const row of rows) {
    await deleteEffectiveAssignmentIfNoActiveSources(client, {
      tenantId,
      projectId: row.project_id,
      userId: row.tenant_user_id,
    });
  }

  return rows.length;
}

async function upsertWorksheetRecord(client, {
  tenantId,
  worksheet,
  projectId = null,
  tenantUserId = null,
  isAccessCandidate = false,
  blockedReason = null,
  validUntil = null,
  reconciliationId = null,
}) {
  await client.query(
    `
      INSERT INTO ek_worksheet (
        tenant_id,
        worksheet_id,
        ek_project_id,
        project_reference,
        project_id,
        fitter_id,
        responsible_fitter_id,
        tenant_user_id,
        status_enum,
        start_date,
        completed_date,
        closed_date,
        valid_until,
        is_access_candidate,
        access_blocked_reason,
        source_updated_at,
        last_observed_at,
        last_reconciliation_id,
        raw_payload_json
      )
      VALUES (
        $1, $2, $3::bigint, $4, $5::uuid, $6, $7, $8::uuid, $9,
        $10::timestamptz, $11::timestamptz, $12::timestamptz, $13::timestamptz,
        $14::boolean, $15, $16::timestamptz, now(), $17::uuid, $18::jsonb
      )
      ON CONFLICT (tenant_id, worksheet_id)
      DO UPDATE SET
        ek_project_id = EXCLUDED.ek_project_id,
        project_reference = EXCLUDED.project_reference,
        project_id = EXCLUDED.project_id,
        fitter_id = EXCLUDED.fitter_id,
        responsible_fitter_id = EXCLUDED.responsible_fitter_id,
        tenant_user_id = EXCLUDED.tenant_user_id,
        status_enum = EXCLUDED.status_enum,
        start_date = EXCLUDED.start_date,
        completed_date = EXCLUDED.completed_date,
        closed_date = EXCLUDED.closed_date,
        valid_until = EXCLUDED.valid_until,
        is_access_candidate = EXCLUDED.is_access_candidate,
        access_blocked_reason = EXCLUDED.access_blocked_reason,
        source_updated_at = EXCLUDED.source_updated_at,
        last_observed_at = EXCLUDED.last_observed_at,
        last_reconciliation_id = EXCLUDED.last_reconciliation_id,
        raw_payload_json = EXCLUDED.raw_payload_json,
        updated_at = now()
    `,
    [
      tenantId,
      worksheet.worksheetId,
      worksheet.ekProjectId,
      worksheet.projectReference,
      projectId,
      worksheet.fitterId,
      worksheet.responsibleFitterId,
      tenantUserId,
      worksheet.statusEnum,
      worksheet.startDate,
      worksheet.completedDate,
      worksheet.closedDate,
      validUntil,
      isAccessCandidate,
      blockedReason,
      worksheet.sourceUpdatedAt,
      reconciliationId,
      JSON.stringify(worksheet.rawPayloadJson || {}),
    ]
  );
}

async function upsertWorksheetAssignments(client, {
  tenantId,
  rawRows,
  reconciliationId = null,
  now = new Date(),
}) {
  const result = {
    observed: 0,
    persisted: 0,
    sourcesUpserted: 0,
    sourcesRemoved: 0,
    blocked: 0,
    blockReasons: {},
  };

  const rows = Array.isArray(rawRows) ? rawRows : [];
  for (const raw of rows) {
    const worksheet = mapWorksheetRow(raw);
    if (!worksheet) {
      result.blocked += 1;
      result.blockReasons.invalid_payload = (result.blockReasons.invalid_payload || 0) + 1;
      continue;
    }
    result.observed += 1;

    const sourceKey = `worksheet:${worksheet.worksheetId}`;
    const lifecycle = classifyWorksheetLifecycle(worksheet, now);
    const projectResolution = await resolveWorksheetProject(client, { tenantId, worksheet });
    const fitterResolution = await resolveWorksheetFitter(client, { tenantId, worksheet });
    const blockedReason = !lifecycle.isAccessCandidate
      ? lifecycle.reason
      : projectResolution.reason || fitterResolution.reason;

    const projectId = projectResolution.project?.project_id || null;
    const tenantUserId = fitterResolution.fitter?.tenant_user_id || null;

    await upsertWorksheetRecord(client, {
      tenantId,
      worksheet,
      projectId,
      tenantUserId,
      isAccessCandidate: !blockedReason,
      blockedReason: blockedReason || null,
      validUntil: lifecycle.validUntil,
      reconciliationId,
    });
    result.persisted += 1;

    if (blockedReason) {
      result.blocked += 1;
      result.blockReasons[blockedReason] = (result.blockReasons[blockedReason] || 0) + 1;
      result.sourcesRemoved += await removeWorksheetSource(client, { tenantId, sourceKey });
      continue;
    }

    const existing = await client.query(
      `
        SELECT project_id, tenant_user_id
        FROM project_assignment_source
        WHERE tenant_id = $1
          AND source_type = 'worksheet'
          AND source_key = $2
        LIMIT 1
      `,
      [tenantId, sourceKey]
    );
    const existingRow = existing.rows[0] || null;
    if (existingRow
        && (String(existingRow.project_id) !== String(projectId)
          || String(existingRow.tenant_user_id) !== String(tenantUserId))) {
      result.sourcesRemoved += await removeWorksheetSource(client, { tenantId, sourceKey });
    }

    await upsertAssignmentSource(client, {
      tenantId,
      projectId,
      userId: tenantUserId,
      sourceType: 'worksheet',
      sourceKey,
      assignmentRole: 'contributor',
      validUntil: lifecycle.validUntil,
      lastReconciliationId: reconciliationId,
      payload: {
        worksheet_id: worksheet.worksheetId,
        ek_project_id: worksheet.ekProjectId,
        project_reference: worksheet.projectReference,
        fitter_id: worksheet.fitterId,
        status_enum: worksheet.statusEnum,
        valid_until: lifecycle.validUntil,
        retention_days: RETENTION_DAYS,
      },
    });
    result.sourcesUpserted += 1;
  }

  return result;
}

async function pruneExpiredWorksheetSources(client, { tenantId }) {
  const { rows } = await client.query(
    `
      DELETE FROM project_assignment_source
      WHERE tenant_id = $1
        AND source_type = 'worksheet'
        AND valid_until IS NOT NULL
        AND valid_until <= now()
      RETURNING project_id, tenant_user_id
    `,
    [tenantId]
  );

  for (const row of rows) {
    await deleteEffectiveAssignmentIfNoActiveSources(client, {
      tenantId,
      projectId: row.project_id,
      userId: row.tenant_user_id,
    });
  }

  return rows.length;
}

async function reconcileMissingWorksheetSources(client, { tenantId, reconciliationId }) {
  if (!reconciliationId) return 0;
  const { rows } = await client.query(
    `
      DELETE FROM project_assignment_source
      WHERE tenant_id = $1
        AND source_type = 'worksheet'
        AND (
          last_reconciliation_id IS NULL
          OR last_reconciliation_id <> $2::uuid
        )
      RETURNING project_id, tenant_user_id
    `,
    [tenantId, reconciliationId]
  );

  await client.query(
    `
      UPDATE ek_worksheet
      SET
        is_access_candidate = false,
        access_blocked_reason = 'missing_in_successful_reconciliation',
        updated_at = now()
      WHERE tenant_id = $1
        AND (
          last_reconciliation_id IS NULL
          OR last_reconciliation_id <> $2::uuid
        )
    `,
    [tenantId, reconciliationId]
  );

  for (const row of rows) {
    await deleteEffectiveAssignmentIfNoActiveSources(client, {
      tenantId,
      projectId: row.project_id,
      userId: row.tenant_user_id,
    });
  }

  return rows.length;
}

module.exports = {
  RETENTION_DAYS,
  ACTIVE_WORKSHEET_STATUSES,
  mapWorksheetRow,
  classifyWorksheetLifecycle,
  isCommonOrSystemFitter,
  materializeEffectiveAssignment,
  deleteEffectiveAssignmentIfNoActiveSources,
  upsertAssignmentSource,
  upsertWorksheetAssignments,
  pruneExpiredWorksheetSources,
  reconcileMissingWorksheetSources,
};
