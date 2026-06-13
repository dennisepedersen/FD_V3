const crypto = require("crypto");
const env = require("../config/env");

const PROJECT_DETAIL_ENDPOINT = "/api/v4/projects/id/{EK ProjectID}";

function requiredString(value, name) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`${name} is required`);
  }
  return text;
}

function encryptionKey() {
  return crypto.createHash("sha256").update(env.JWT_SECRET).digest();
}

function decryptSecret(cipherText) {
  const [ivBase64, tagBase64, encryptedBase64] = String(cipherText || "").split(".");
  if (!ivBase64 || !tagBase64 || !encryptedBase64) {
    throw new Error("invalid_encrypted_ek_api_key_format");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivBase64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagBase64, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function normalizeBaseUrl(baseUrl) {
  const parsed = new URL(requiredString(baseUrl, "ek_base_url"));
  const cleanPath = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${cleanPath}`;
}

function buildProjectDetailUrl(baseUrl, ekProjectId) {
  return `${normalizeBaseUrl(baseUrl)}/api/v4/projects/id/${encodeURIComponent(String(ekProjectId))}`
    .replace(/([^:]\/)(\/+)/g, "$1");
}

function asNullableText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function asNullableNumeric(value) {
  if (value == null || value === "") return null;
  const normalized = typeof value === "string" ? value.replace(",", ".") : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function asNullableTimestamp(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2}T/.test(text) && !/(Z|[+-]\d{2}:\d{2})$/i.test(text)
    ? `${text}Z`
    : text;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function pickAny(raw, keys) {
  for (const key of keys) {
    if (raw && Object.prototype.hasOwnProperty.call(raw, key)) {
      const value = raw[key];
      if (value !== undefined) return value;
    }
  }
  return null;
}

function normalizeReference(value) {
  return String(value || "").trim().toLowerCase();
}

async function resolveTenantConfig(client, { tenant }) {
  const lookup = requiredString(tenant, "tenant").toLowerCase();
  const { rows } = await client.query(
    `
      SELECT
        t.id AS tenant_id,
        t.slug,
        tc.ek_base_url,
        tc.ek_api_key_encrypted,
        tcs.config_snapshot
      FROM tenant t
      JOIN tenant_config tc ON tc.tenant_id = t.id
      LEFT JOIN LATERAL (
        SELECT config_snapshot
        FROM tenant_config_snapshot
        WHERE tenant_id = t.id
        ORDER BY changed_at DESC
        LIMIT 1
      ) tcs ON true
      WHERE lower(t.slug) = $1
         OR t.id::text = $1
         OR EXISTS (
           SELECT 1
           FROM tenant_domain td
           WHERE td.tenant_id = t.id
             AND lower(td.domain) = $1
         )
      LIMIT 1
    `,
    [lookup]
  );

  const row = rows[0] || null;
  if (!row) {
    throw new Error("tenant_or_ek_config_not_found");
  }
  if (!row.ek_base_url || !row.ek_api_key_encrypted) {
    throw new Error("tenant_ek_config_incomplete");
  }

  return {
    tenantId: row.tenant_id,
    slug: row.slug,
    ekBaseUrl: row.ek_base_url,
    ekApiKey: decryptSecret(row.ek_api_key_encrypted),
    siteName: row.config_snapshot?.ek_site_name || row.slug || "Ekstern",
  };
}

async function resolveRefreshProject(client, {
  tenantId,
  ekProjectId = null,
  projectId = null,
  projectRef = null,
}) {
  if (!tenantId) {
    throw new Error("tenantId is required");
  }
  if (!ekProjectId && !projectId && !projectRef) {
    throw new Error("Provide ekProjectId, projectId, or projectRef");
  }

  const params = [tenantId];
  const filters = [
    "pm.tenant_id = $1",
    "pc.status = 'open'",
    "pc.is_closed = false",
    "pm.ek_project_id IS NOT NULL",
  ];

  if (ekProjectId) {
    params.push(String(ekProjectId));
    filters.push(`pm.ek_project_id = $${params.length}::bigint`);
  }
  if (projectId) {
    params.push(String(projectId));
    filters.push(`pc.project_id = $${params.length}::uuid`);
  }
  if (projectRef) {
    params.push(String(projectRef).trim());
    filters.push(`lower(pc.external_project_ref) = lower($${params.length})`);
  }

  const { rows } = await client.query(
    `
      SELECT
        pc.project_id,
        pc.external_project_ref,
        pc.status,
        pc.is_closed,
        pm.ek_project_id,
        pw.last_registration,
        pw.last_fitter_hour_date,
        GREATEST(
          COALESCE(pw.last_registration, '-infinity'::timestamptz),
          COALESCE(pw.last_fitter_hour_date, '-infinity'::timestamptz)
        ) AS activity_date
      FROM project_masterdata_v4 pm
      JOIN project_core pc
        ON pc.tenant_id = pm.tenant_id
       AND pc.project_id = pm.project_id
      LEFT JOIN project_wip pw
        ON pw.tenant_id = pc.tenant_id
       AND pw.project_id = pc.project_id
      WHERE ${filters.join("\n        AND ")}
      ORDER BY pc.updated_at DESC
      LIMIT 2
    `,
    params
  );

  if (rows.length !== 1) {
    throw new Error(`expected_one_open_fd_project:found:${rows.length}`);
  }
  return rows[0];
}

async function fetchEkProjectDetail({ tenantConfig, ekProjectId }) {
  const url = buildProjectDetailUrl(tenantConfig.ekBaseUrl, ekProjectId);
  const response = await fetch(url, {
    method: "GET",
    headers: {
      apikey: tenantConfig.ekApiKey,
      siteName: tenantConfig.siteName,
      Accept: "application/json",
    },
  });

  const bodyText = await response.text();
  let payload = null;
  try {
    payload = bodyText ? JSON.parse(bodyText) : null;
  } catch (_error) {
    throw new Error(`ek_project_detail_non_json:${response.status}`);
  }
  if (!response.ok) {
    const error = new Error(`ek_project_detail_http_${response.status}`);
    error.httpStatus = response.status;
    error.responseBody = bodyText.slice(0, 300);
    throw error;
  }

  return {
    endpoint: PROJECT_DETAIL_ENDPOINT,
    url,
    payload,
  };
}

function extractV4ProjectFitterHours(payload, { ekProjectId }) {
  if (!payload || typeof payload !== "object") {
    throw new Error("project_detail_payload_missing");
  }
  if (payload.hasErrors === true) {
    throw new Error(`project_detail_has_errors:${payload.errorMessage || "unknown"}`);
  }

  const rows = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.data?.data)
      ? payload.data.data
      : [];
  const total = payload.total ?? payload.data?.total ?? null;

  if (total != null && Number(total) !== 1) {
    throw new Error(`project_detail_expected_total_1:got:${total}`);
  }
  if (rows.length !== 1) {
    throw new Error(`project_detail_expected_one_row:got:${rows.length}`);
  }

  const project = rows[0];
  const projectId = asNullableText(pickAny(project, ["projectID", "ProjectID"]));
  if (String(projectId || "").trim() !== String(ekProjectId)) {
    throw new Error(`project_detail_project_id_mismatch:expected:${ekProjectId}:got:${projectId}`);
  }

  const fitterHours = project.fitterHours;
  if (!Array.isArray(fitterHours)) {
    throw new Error("project_detail_fitterHours_missing_or_not_array");
  }

  return {
    project,
    fitterHours,
    total: Number(total || rows.length),
    liveReference: asNullableText(pickAny(project, ["reference", "Reference"])),
  };
}

function mapV4ProjectDetailFitterHourRows({ fitterHours, ekProjectId, externalProjectRef }) {
  const mapped = [];
  const filteredOut = [];

  fitterHours.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") {
      filteredOut.push({ index, reason: "not_object" });
      return;
    }

    const rawProjectId = asNullableText(pickAny(raw, ["projectID", "ProjectID"]));
    if (rawProjectId && String(rawProjectId) !== String(ekProjectId)) {
      filteredOut.push({ index, reason: "wrong_project_id", projectId: rawProjectId });
      return;
    }

    const fitterHourId = asNullableText(pickAny(raw, ["fitterHourID", "FitterHourID", "id", "ID"]));
    if (!fitterHourId) {
      filteredOut.push({ index, reason: "missing_fitter_hour_id" });
      return;
    }

    const workDate = asNullableTimestamp(pickAny(raw, ["date", "Date", "workDate", "WorkDate"]));
    const hours = asNullableNumeric(pickAny(raw, ["hourSpent", "HourSpent", "hours", "Hours"]));
    if (!workDate && hours == null) {
      filteredOut.push({ index, reason: "missing_work_date_and_hours", fitterHourId });
      return;
    }

    const categoryIdRaw = asNullableText(pickAny(raw, ["fitterCategoryID", "FitterCategoryID"]));
    const categoryId = categoryIdRaw && categoryIdRaw !== "0" ? categoryIdRaw : null;
    const description = asNullableText(pickAny(raw, ["description", "Description"]));

    mapped.push({
      sourceKey: `id:${fitterHourId}`,
      fitterHourId,
      externalProjectRef,
      projectId: String(ekProjectId),
      fitterId: asNullableText(pickAny(raw, ["fitterID", "FitterID"])),
      fitterCategoryId: categoryId,
      workDate,
      hours,
      note: description,
      description,
      rawPayloadJson: {
        source: "ek_v4_project_detail_fitterHours",
        project: {
          projectID: Number(ekProjectId),
          reference: externalProjectRef,
        },
        row: raw,
      },
    });
  });

  return { mappedRows: mapped, filteredOutRows: filteredOut };
}

function detectDuplicateRemoteSourceKeys(mappedRows) {
  const counts = new Map();
  mappedRows.forEach((row) => {
    counts.set(row.sourceKey, (counts.get(row.sourceKey) || 0) + 1);
  });
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([sourceKey, count]) => ({ sourceKey, count }));
}

async function loadExistingRowsBySourceKey(client, { tenantId, sourceKeys }) {
  if (!sourceKeys.length) {
    return new Map();
  }
  const { rows } = await client.query(
    `
      SELECT
        id,
        source_key,
        fd_project_id,
        fitter_hour_id,
        external_project_ref,
        project_id,
        fitter_id,
        fitter_category_id,
        work_date,
        registration_date,
        hours,
        note,
        description
      FROM fitter_hour
      WHERE tenant_id = $1
        AND source_key = ANY($2::text[])
    `,
    [tenantId, sourceKeys]
  );
  return new Map(rows.map((row) => [row.source_key, row]));
}

async function summarizeExistingProjectRows(client, { tenantId, projectId }) {
  const { rows } = await client.query(
    `
      SELECT
        COUNT(*)::int AS row_count,
        MAX(work_date) AS max_work_date,
        MAX(registration_date) AS max_registration_date
      FROM fitter_hour
      WHERE tenant_id = $1
        AND fd_project_id = $2
    `,
    [tenantId, projectId]
  );
  const row = rows[0] || {};
  return {
    rowCount: Number(row.row_count || 0),
    maxWorkDate: row.max_work_date ? new Date(row.max_work_date).toISOString() : null,
    maxRegistrationDate: row.max_registration_date ? new Date(row.max_registration_date).toISOString() : null,
  };
}

function detectCrossProjectSourceKeyConflicts({ existingRowsBySourceKey, mappedRows, expectedProjectId }) {
  const conflicts = [];
  mappedRows.forEach((row) => {
    const existing = existingRowsBySourceKey.get(row.sourceKey);
    if (!existing || !existing.fd_project_id) return;
    if (String(existing.fd_project_id) !== String(expectedProjectId)) {
      conflicts.push({
        sourceKey: row.sourceKey,
        existingFdProjectId: existing.fd_project_id,
        incomingFdProjectId: expectedProjectId,
        existingExternalProjectRef: existing.external_project_ref,
        incomingExternalProjectRef: row.externalProjectRef,
      });
    }
  });
  return conflicts;
}

function detectFdProjectIdMismatch({ existingRowsBySourceKey, mappedRows, expectedProjectId }) {
  return mappedRows
    .map((row) => {
      const existing = existingRowsBySourceKey.get(row.sourceKey);
      if (!existing || !existing.fd_project_id) return null;
      if (String(existing.fd_project_id) === String(expectedProjectId)) return null;
      return {
        sourceKey: row.sourceKey,
        existingFdProjectId: existing.fd_project_id,
        expectedFdProjectId: expectedProjectId,
      };
    })
    .filter(Boolean);
}

function normalizeDbTimestamp(value) {
  return value ? new Date(value).toISOString() : null;
}

function toIsoOrNull(value) {
  if (!value) return null;
  const text = String(value);
  if (text === "-infinity" || text === "-Infinity" || text === "Infinity") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function numbersEqual(left, right) {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return Number(left) === Number(right);
}

function classifyExistingRowAction({ row, existingRowsBySourceKey, expectedProjectId }) {
  const existing = existingRowsBySourceKey.get(row.sourceKey);
  if (!existing) return "insert";
  if (existing.fd_project_id && String(existing.fd_project_id) !== String(expectedProjectId)) return "blocked";
  if (row.fitterHourId && String(existing.fitter_hour_id || "") !== String(row.fitterHourId)) return "update";
  if (row.externalProjectRef && String(existing.external_project_ref || "") !== String(row.externalProjectRef)) return "update";
  if (row.projectId && String(existing.project_id || "") !== String(row.projectId)) return "update";
  if (row.fitterId && String(existing.fitter_id || "") !== String(row.fitterId)) return "update";
  if (row.fitterCategoryId && String(existing.fitter_category_id || "") !== String(row.fitterCategoryId)) return "update";
  if (row.workDate && normalizeDbTimestamp(existing.work_date) !== row.workDate) return "update";
  if (row.hours != null && !numbersEqual(existing.hours, row.hours)) return "update";
  if (row.note && String(existing.note || "") !== row.note) return "update";
  if (row.description && String(existing.description || "") !== row.description) return "update";
  return "unchanged";
}

function classifyRefreshVolume({ expectedInserts }) {
  const count = Number(expectedInserts || 0);
  if (count > 500) return "LARGE";
  if (count > 100) return "MEDIUM";
  return "SMALL";
}

function summarizeDryRun({ mappedRows, existingRowsBySourceKey, expectedProjectId }) {
  const summary = {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    blocked: 0,
  };
  mappedRows.forEach((row) => {
    const action = classifyExistingRowAction({ row, existingRowsBySourceKey, expectedProjectId });
    if (action === "insert") summary.inserted += 1;
    else if (action === "update") summary.updated += 1;
    else if (action === "blocked") summary.blocked += 1;
    else summary.unchanged += 1;
  });
  return summary;
}

function resultStatusForGates({
  referenceMatch,
  duplicateSourceKeys,
  crossProjectConflicts,
  fdProjectIdMismatches,
}) {
  if (!referenceMatch) return "blocked_reference_mismatch";
  if (duplicateSourceKeys.length) return "blocked_duplicate_source_keys";
  if (crossProjectConflicts.length) return "blocked_cross_project_conflict";
  if (fdProjectIdMismatches.length) return "blocked_fd_project_mismatch";
  return "ready";
}

async function preCheckProjectFitterhoursRefresh(client, {
  tenantConfig,
  ekProjectId = null,
  projectId = null,
  projectRef = null,
}) {
  const project = await resolveRefreshProject(client, {
    tenantId: tenantConfig.tenantId,
    ekProjectId,
    projectId,
    projectRef,
  });
  const resolvedEkProjectId = String(project.ek_project_id);
  const fetched = await fetchEkProjectDetail({
    tenantConfig,
    ekProjectId: resolvedEkProjectId,
  });
  const extracted = extractV4ProjectFitterHours(fetched.payload, {
    ekProjectId: resolvedEkProjectId,
  });
  const liveReference = extracted.liveReference || project.external_project_ref;
  const referenceMatch = normalizeReference(project.external_project_ref) === normalizeReference(liveReference);
  const { mappedRows, filteredOutRows } = mapV4ProjectDetailFitterHourRows({
    fitterHours: extracted.fitterHours,
    ekProjectId: resolvedEkProjectId,
    externalProjectRef: liveReference,
  });
  const duplicateSourceKeys = detectDuplicateRemoteSourceKeys(mappedRows);
  const existingRowsBySourceKey = await loadExistingRowsBySourceKey(client, {
    tenantId: tenantConfig.tenantId,
    sourceKeys: mappedRows.map((row) => row.sourceKey),
  });
  const crossProjectConflicts = detectCrossProjectSourceKeyConflicts({
    existingRowsBySourceKey,
    mappedRows,
    expectedProjectId: project.project_id,
  });
  const fdProjectIdMismatches = detectFdProjectIdMismatch({
    existingRowsBySourceKey,
    mappedRows,
    expectedProjectId: project.project_id,
  });
  const existingProjectSummary = await summarizeExistingProjectRows(client, {
    tenantId: tenantConfig.tenantId,
    projectId: project.project_id,
  });
  const dryRun = summarizeDryRun({
    mappedRows,
    existingRowsBySourceKey,
    expectedProjectId: project.project_id,
  });
  const sizeClass = classifyRefreshVolume({ expectedInserts: dryRun.inserted });
  const status = resultStatusForGates({
    referenceMatch,
    duplicateSourceKeys,
    crossProjectConflicts,
    fdProjectIdMismatches,
  });

  return {
    status,
    endpoint: PROJECT_DETAIL_ENDPOINT,
    project: {
      fdProjectId: project.project_id,
      externalProjectRef: project.external_project_ref,
      status: project.status,
      isClosed: project.is_closed,
      ekProjectId: Number(resolvedEkProjectId),
      currentActivityDate: toIsoOrNull(project.activity_date),
      lastRegistration: toIsoOrNull(project.last_registration),
      lastFitterHourDate: toIsoOrNull(project.last_fitter_hour_date),
    },
    ekProjectDetail: {
      total: extracted.total,
      liveReference,
      remoteRows: extracted.fitterHours.length,
    },
    mapping: {
      mappedRows: mappedRows.length,
      filteredOutRows: filteredOutRows.length,
      filteredOutSamples: filteredOutRows.slice(0, 5),
    },
    existing: existingProjectSummary,
    gates: {
      referenceMatch,
      duplicateSourceKeysCount: duplicateSourceKeys.length,
      duplicateSourceKeySamples: duplicateSourceKeys.slice(0, 5),
      crossProjectConflictCount: crossProjectConflicts.length,
      crossProjectConflictSamples: crossProjectConflicts.slice(0, 5),
      fdProjectIdMismatchCount: fdProjectIdMismatches.length,
      fdProjectIdMismatchSamples: fdProjectIdMismatches.slice(0, 5),
      sizeClass,
    },
    dryRun,
    safety: {
      endpointUsed: PROJECT_DETAIL_ENDPOINT,
      v4FitterhoursEndpointUsed: false,
      v4FitterhoursQueryUsed: false,
      writesToFitterHourEnabled: false,
      materializerEnabled: false,
      syncStateUpdatesEnabled: false,
      schedulerUpdatesEnabled: false,
      deletesEnabled: false,
    },
  };
}

function runStatusFromPreCheckStatus(status) {
  return status === "ready" ? "ready" : "blocked";
}

async function recordRefreshRun(client, {
  tenantId,
  projectId,
  ekProjectId,
  externalProjectRef,
  triggerType = "maintenance",
  triggeredByUserId = null,
  preCheckResult,
  startedAt = new Date(),
  finishedAt = new Date(),
  errorCode = null,
  errorMessage = null,
}) {
  const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
  const { rows } = await client.query(
    `
      INSERT INTO targeted_fitterhours_refresh_runs (
        tenant_id,
        project_id,
        ek_project_id,
        external_project_ref,
        trigger_type,
        triggered_by_user_id,
        status,
        reference_match,
        live_reference,
        duplicate_source_keys_count,
        cross_project_conflict_count,
        fd_project_id_mismatch_count,
        size_class,
        remote_rows,
        mapped_rows,
        inserted,
        updated,
        unchanged,
        deleted,
        started_at,
        finished_at,
        duration_ms,
        error_code,
        error_message,
        raw_summary_json
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18,
        0, $19, $20, $21, $22, $23, $24::jsonb
      )
      RETURNING id
    `,
    [
      tenantId,
      projectId,
      ekProjectId,
      externalProjectRef,
      triggerType,
      triggeredByUserId,
      runStatusFromPreCheckStatus(preCheckResult.status),
      preCheckResult.gates.referenceMatch,
      preCheckResult.ekProjectDetail.liveReference,
      preCheckResult.gates.duplicateSourceKeysCount,
      preCheckResult.gates.crossProjectConflictCount,
      preCheckResult.gates.fdProjectIdMismatchCount,
      preCheckResult.gates.sizeClass,
      preCheckResult.ekProjectDetail.remoteRows,
      preCheckResult.mapping.mappedRows,
      preCheckResult.dryRun.inserted,
      preCheckResult.dryRun.updated,
      preCheckResult.dryRun.unchanged,
      startedAt,
      finishedAt,
      durationMs,
      errorCode,
      errorMessage,
      JSON.stringify(preCheckResult),
    ]
  );
  return rows[0]?.id || null;
}

async function updateRefreshStatus(client, {
  tenantId,
  projectId,
  ekProjectId,
  externalProjectRef,
  preCheckResult,
  errorCode = null,
  errorMessage = null,
}) {
  const status = preCheckResult.status;
  const isFailure = status !== "ready";
  await client.query(
    `
      INSERT INTO project_fitterhours_refresh_status (
        tenant_id,
        project_id,
        ek_project_id,
        external_project_ref,
        status,
        last_checked_at,
        last_remote_fitterhours_count,
        last_inserted,
        last_updated,
        last_unchanged,
        last_error_code,
        last_error_message,
        consecutive_failures,
        blocked_reason,
        blocked_payload_json
      )
      VALUES (
        $1, $2, $3, $4, $5, now(), $6, $7, $8, $9,
        $10, $11, CASE WHEN $12::boolean THEN 1 ELSE 0 END, $13, $14::jsonb
      )
      ON CONFLICT (tenant_id, project_id)
      DO UPDATE SET
        ek_project_id = EXCLUDED.ek_project_id,
        external_project_ref = EXCLUDED.external_project_ref,
        status = EXCLUDED.status,
        last_checked_at = EXCLUDED.last_checked_at,
        last_remote_fitterhours_count = EXCLUDED.last_remote_fitterhours_count,
        last_inserted = EXCLUDED.last_inserted,
        last_updated = EXCLUDED.last_updated,
        last_unchanged = EXCLUDED.last_unchanged,
        last_error_code = EXCLUDED.last_error_code,
        last_error_message = EXCLUDED.last_error_message,
        consecutive_failures = CASE
          WHEN $12::boolean THEN project_fitterhours_refresh_status.consecutive_failures + 1
          ELSE 0
        END,
        blocked_reason = EXCLUDED.blocked_reason,
        blocked_payload_json = EXCLUDED.blocked_payload_json,
        updated_at = now()
    `,
    [
      tenantId,
      projectId,
      ekProjectId,
      externalProjectRef,
      status,
      preCheckResult.ekProjectDetail.remoteRows,
      preCheckResult.dryRun.inserted,
      preCheckResult.dryRun.updated,
      preCheckResult.dryRun.unchanged,
      errorCode,
      errorMessage,
      isFailure,
      isFailure ? status : null,
      isFailure ? JSON.stringify(preCheckResult.gates) : null,
    ]
  );
}

module.exports = {
  PROJECT_DETAIL_ENDPOINT,
  resolveTenantConfig,
  resolveRefreshProject,
  fetchEkProjectDetail,
  extractV4ProjectFitterHours,
  mapV4ProjectDetailFitterHourRows,
  preCheckProjectFitterhoursRefresh,
  detectDuplicateRemoteSourceKeys,
  detectCrossProjectSourceKeyConflicts,
  detectFdProjectIdMismatch,
  classifyRefreshVolume,
  recordRefreshRun,
  updateRefreshStatus,
};
