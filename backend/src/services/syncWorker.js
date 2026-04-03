const crypto = require("crypto");
const pool = require("../db/pool");
const { withTransaction } = require("../db/tx");
const syncJobQueries = require("../db/queries/syncJob");
const env = require("../config/env");

const POLL_INTERVAL_MS = 12_000;
const PAGE_SIZE = 200;
const MAX_JOB_RETRIES = 3;
const HTTP_RETRY_COUNT = 3;
const MAX_BACKLOG_ATTEMPTS = 8;
const BACKLOG_RETRY_BATCH_SIZE = 40;
const DELTA_INTERVAL_MS = 10 * 60 * 1000;
const DELTA_MAX_PAGES = 25;
const FITTERHOURS_DEFAULT_MONTHS_LOOKBACK = 12;
const PROJECT_START_DATE_COLUMN_CANDIDATES = [
  "project_start_date",
  "start_date",
  "project_start_at",
  "project_start",
  "startdate",
];
const FITTERHOURS_DATE_KEYS = [
  "date",
  "Date",
  "workDate",
  "WorkDate",
  "hourDate",
  "HourDate",
  "registrationDate",
  "RegistrationDate",
  "startDate",
  "StartDate",
  "endDate",
  "EndDate",
];
const SYNC_MODES = {
  BOOTSTRAP_INITIAL: "bootstrap_initial",
  DELTA: "delta",
  RETRY_BACKLOG: "retry_backlog",
  MANUAL_FULL_RESYNC: "manual_full_resync",
  SLOW_RECONCILIATION: "slow_reconciliation",
  RECONCILE_SCAN: "reconcile_scan",
};
const SYNC_STRATEGIES = {
  DELTA_SUPPORTED: "delta_supported",
  RECONCILE_SCAN: "reconcile_scan",
  BACKLOG_RETRY_ONLY: "backlog_retry_only",
  NOT_MATERIALIZED: "not_materialized",
};
const READ_ONLY_ENDPOINT_KEYS = new Set([
  "users",
  "fitters",
  "fitterhours",
  "worksheets",
  "invoices",
  "purchaseinvoices",
]);
const ENDPOINT_STRATEGY = {
  projects_v4: { supportsDelta: true, strategy: SYNC_STRATEGIES.DELTA_SUPPORTED, materialized: true },
  projects_v3: { supportsDelta: true, strategy: SYNC_STRATEGIES.DELTA_SUPPORTED, materialized: true },
  users: { supportsDelta: false, strategy: SYNC_STRATEGIES.RECONCILE_SCAN, materialized: false },
  fitters: { supportsDelta: false, strategy: SYNC_STRATEGIES.RECONCILE_SCAN, materialized: false },
  fitterhours: { supportsDelta: false, strategy: SYNC_STRATEGIES.RECONCILE_SCAN, materialized: false },
  invoices: { supportsDelta: false, strategy: SYNC_STRATEGIES.RECONCILE_SCAN, materialized: false },
  purchaseinvoices: { supportsDelta: false, strategy: SYNC_STRATEGIES.RECONCILE_SCAN, materialized: false },
  worksheets: { supportsDelta: false, strategy: SYNC_STRATEGIES.RECONCILE_SCAN, materialized: false },
};

let started = false;
let timer = null;
let tickInFlight = false;

function encryptionKey() {
  return crypto.createHash("sha256").update(env.JWT_SECRET).digest();
}

function decryptSecret(cipherText) {
  const [ivBase64, tagBase64, encryptedBase64] = String(cipherText || "").split(".");
  if (!ivBase64 || !tagBase64 || !encryptedBase64) {
    throw new Error("Invalid encrypted EK API key format");
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

function extractSiteName(snapshot) {
  const value = snapshot && snapshot.ek_site_name;
  return value && String(value).trim() ? String(value).trim() : "Ekstern";
}

function nowIso() {
  return new Date().toISOString();
}

function chunkArray(items, chunkSize) {
  const size = Math.max(1, Number(chunkSize) || 1);
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function isRetryableHttpStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(Number(status));
}

function classifyError(error) {
  const message = String(error && error.message ? error.message : "unknown_error");
  const statusMatch = message.match(/\((\d{3})\)/);
  const status = statusMatch ? Number(statusMatch[1]) : null;

  if (status === 429) {
    return { kind: "http_429", retryable: true, status };
  }

  if (status && isRetryableHttpStatus(status)) {
    return { kind: "transient", retryable: true, status };
  }

  if (status && status >= 400 && status < 500) {
    return { kind: "permanent", retryable: false, status };
  }

  if (/timeout|network|fetch|socket|econn|etimedout/i.test(message)) {
    return { kind: "transient", retryable: true, status: null };
  }

  return { kind: "transient", retryable: true, status: null };
}

function computeBacklogRetryAt(kind, attempts) {
  const base = kind === "http_429" ? 60_000 : 15_000;
  const cappedAttempts = Math.min(Math.max(1, attempts), 10);
  const waitMs = base * Math.pow(2, cappedAttempts - 1);
  return new Date(Date.now() + Math.min(waitMs, 6 * 60 * 60 * 1000));
}

function normalizeLocator({ page, cursor, reference }) {
  if (reference != null && String(reference).trim()) {
    return {
      locatorType: "reference",
      locatorValue: String(reference).trim(),
      pageNumber: page == null ? null : Number(page),
      cursorValue: cursor == null ? null : String(cursor),
      referenceValue: String(reference).trim(),
    };
  }

  if (cursor != null && String(cursor).trim()) {
    return {
      locatorType: "cursor",
      locatorValue: String(cursor).trim(),
      pageNumber: page == null ? null : Number(page),
      cursorValue: String(cursor).trim(),
      referenceValue: null,
    };
  }

  const pageNo = page == null ? null : Number(page);
  const pageValue = pageNo == null || Number.isNaN(pageNo) ? "unknown" : `page:${pageNo}`;
  return {
    locatorType: "page",
    locatorValue: pageValue,
    pageNumber: pageNo == null || Number.isNaN(pageNo) ? null : pageNo,
    cursorValue: null,
    referenceValue: null,
  };
}

async function heartbeat(jobId) {
  await withTransaction(async (client) => {
    await syncJobQueries.markJobHeartbeat(client, { jobId });
  });
}

function modeFromJobType(jobType, fallbackMode = SYNC_MODES.DELTA) {
  const normalized = String(jobType || "").trim().toLowerCase();
  if (!normalized) return fallbackMode;
  if (Object.values(SYNC_MODES).includes(normalized)) {
    return normalized;
  }
  if (normalized === "bootstrap") {
    return SYNC_MODES.BOOTSTRAP_INITIAL;
  }
  return fallbackMode;
}

async function markEndpointHeartbeat(client, { tenantId, endpointKey, jobId, currentMode }) {
  await ensureEndpointState(client, { tenantId, endpointKey });
  await client.query(
    `
      UPDATE sync_endpoint_state
      SET
        heartbeat_at = now(),
        last_attempt_at = now(),
        current_job_id = COALESCE($3, current_job_id),
        current_mode = COALESCE($4::text, current_mode),
        status = CASE WHEN status = 'idle' THEN 'running' ELSE status END,
        updated_at = now()
      WHERE tenant_id = $1
        AND endpoint_key = $2
    `,
    [tenantId, endpointKey, jobId || null, currentMode || null]
  );
}

async function ensureEndpointState(client, { tenantId, endpointKey }) {
  await client.query(
    `
      INSERT INTO sync_endpoint_state (tenant_id, endpoint_key)
      VALUES ($1, $2)
      ON CONFLICT (tenant_id, endpoint_key) DO NOTHING
    `,
    [tenantId, endpointKey]
  );
}

async function markEndpointState(client, {
  tenantId,
  endpointKey,
  status,
  jobId,
  currentJobId,
  currentMode,
  syncStrategy,
  lastAttemptAt,
  lastSuccessAt,
  lastSuccessfulPage,
  lastSuccessfulCursor,
  lastSeenRemoteCursor,
  updatedAfterWatermark,
  rowsFetchedDelta,
  rowsPersistedDelta,
  pagesProcessedLastJob,
  rowsFetchedLastJob,
  retryCount,
  pendingBacklogCount,
  failedPageCount,
  lastHttpStatus,
  heartbeatAt,
  nextPlannedAt,
  errorMessage,
}) {
  await ensureEndpointState(client, { tenantId, endpointKey });

  await client.query(
    `
      UPDATE sync_endpoint_state
      SET
        status = COALESCE($3::text, status),
        last_job_id = COALESCE($4, last_job_id),
        current_job_id = COALESCE($5, current_job_id),
        current_mode = COALESCE($6::text, current_mode),
        sync_strategy = COALESCE($7::text, sync_strategy),
        last_attempt_at = COALESCE($8, last_attempt_at),
        last_successful_sync_at = COALESCE($9, last_successful_sync_at),
        last_successful_page = COALESCE($10, last_successful_page),
        last_successful_cursor = COALESCE($11::text, last_successful_cursor),
        last_seen_remote_cursor = COALESCE($12::text, last_seen_remote_cursor),
        updated_after_watermark = COALESCE($13::timestamptz, updated_after_watermark),
        rows_fetched = rows_fetched + COALESCE($14, 0),
        rows_persisted = rows_persisted + COALESCE($15, 0),
        pages_processed_last_job = COALESCE($16, pages_processed_last_job),
        rows_fetched_last_job = COALESCE($17, rows_fetched_last_job),
        retry_count = COALESCE($18, retry_count),
        pending_backlog_count = COALESCE($19, pending_backlog_count),
        failed_page_count = COALESCE($20, failed_page_count),
        last_http_status = COALESCE($21, last_http_status),
        heartbeat_at = COALESCE($22::timestamptz, heartbeat_at),
        next_planned_at = COALESCE($23::timestamptz, next_planned_at),
        last_error = COALESCE($24::text, last_error),
        updated_at = now()
      WHERE tenant_id = $1 AND endpoint_key = $2
    `,
    [
      tenantId,
      endpointKey,
      status || null,
      jobId || null,
      currentJobId || null,
      currentMode || null,
      syncStrategy || null,
      lastAttemptAt || null,
      lastSuccessAt || null,
      lastSuccessfulPage == null ? null : Number(lastSuccessfulPage),
      lastSuccessfulCursor || null,
      lastSeenRemoteCursor || null,
      updatedAfterWatermark || null,
      rowsFetchedDelta == null ? 0 : Number(rowsFetchedDelta),
      rowsPersistedDelta == null ? 0 : Number(rowsPersistedDelta),
      pagesProcessedLastJob == null ? null : Number(pagesProcessedLastJob),
      rowsFetchedLastJob == null ? null : Number(rowsFetchedLastJob),
      retryCount == null ? null : Number(retryCount),
      pendingBacklogCount == null ? null : Number(pendingBacklogCount),
      failedPageCount == null ? null : Number(failedPageCount),
      lastHttpStatus == null ? null : Number(lastHttpStatus),
      heartbeatAt || null,
      nextPlannedAt || null,
      errorMessage || null,
    ]
  );
}

async function appendPageLog(client, {
  tenantId,
  jobId,
  endpointKey,
  mode,
  pageNumber,
  nextPage,
  status,
  rowsFetched,
  rowsPersisted,
  httpStatus,
  errorMessage,
  retryCount,
  startedAt,
  finishedAt,
  attemptNo,
}) {
  await client.query(
    `
      INSERT INTO sync_page_log (
        tenant_id,
        job_id,
        endpoint_key,
        mode,
        page_number,
        next_page,
        status,
        rows_fetched,
        rows_persisted,
        http_status,
        error_message,
        retry_count,
        started_at,
        finished_at,
        error_text,
        attempt_no
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    `,
    [
      tenantId,
      jobId,
      endpointKey,
      mode || null,
      pageNumber == null ? null : Number(pageNumber),
      nextPage == null ? null : Number(nextPage),
      status,
      rowsFetched == null ? 0 : Number(rowsFetched),
      rowsPersisted == null ? 0 : Number(rowsPersisted),
      httpStatus == null ? null : Number(httpStatus),
      errorMessage || null,
      retryCount == null ? Math.max(0, (attemptNo == null ? 1 : Number(attemptNo)) - 1) : Number(retryCount),
      startedAt || nowIso(),
      finishedAt || nowIso(),
      errorMessage || null,
      attemptNo == null ? 1 : Number(attemptNo),
    ]
  );
}

async function queueBacklogFailure(client, {
  tenantId,
  jobId,
  endpointKey,
  locator,
  failureKind,
  errorMessage,
  attempts,
  nextRetryAt,
  status,
}) {
  await client.query(
    `
      INSERT INTO sync_failure_backlog (
        tenant_id,
        endpoint_key,
        locator_type,
        locator_value,
        page_number,
        cursor_value,
        reference_value,
        failure_kind,
        error_message,
        attempts,
        first_failed_at,
        last_failed_at,
        next_retry_at,
        status,
        last_job_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, now(), now(), $11, $12, $13
      )
      ON CONFLICT (tenant_id, endpoint_key, locator_type, locator_value)
      DO UPDATE SET
        failure_kind = EXCLUDED.failure_kind,
        error_message = EXCLUDED.error_message,
        attempts = GREATEST(sync_failure_backlog.attempts, EXCLUDED.attempts),
        last_failed_at = now(),
        next_retry_at = EXCLUDED.next_retry_at,
        status = EXCLUDED.status,
        last_job_id = EXCLUDED.last_job_id
    `,
    [
      tenantId,
      endpointKey,
      locator.locatorType,
      locator.locatorValue,
      locator.pageNumber,
      locator.cursorValue,
      locator.referenceValue,
      failureKind,
      String(errorMessage || "sync_page_failed").slice(0, 2000),
      attempts,
      nextRetryAt || null,
      status,
      jobId,
    ]
  );
}

async function resolveBacklogFailure(client, { backlogId, jobId }) {
  await client.query(
    `
      UPDATE sync_failure_backlog
      SET
        status = 'resolved',
        next_retry_at = NULL,
        last_job_id = $2,
        updated_at = now()
      WHERE id = $1
    `,
    [backlogId, jobId]
  );
}

async function getEndpointState(client, { tenantId, endpointKey }) {
  const { rows } = await client.query(
    `
      SELECT
        tenant_id,
        endpoint_key,
        status,
        last_attempt_at,
        last_successful_sync_at,
        last_successful_page,
        last_successful_cursor,
        current_mode,
        sync_strategy,
        current_job_id,
        retry_count,
        pending_backlog_count,
        failed_page_count,
        pages_processed_last_job,
        rows_fetched_last_job,
        last_http_status,
        heartbeat_at,
        last_seen_remote_cursor,
        updated_after_watermark,
        rows_fetched,
        rows_persisted,
        next_planned_at,
        last_error,
        updated_at
      FROM sync_endpoint_state
      WHERE tenant_id = $1
        AND endpoint_key = $2
      LIMIT 1
    `,
    [tenantId, endpointKey]
  );

  return rows[0] || null;
}

async function listEnabledEndpoints(client, tenantId) {
  const { rows } = await client.query(
    `
      SELECT lower(endpoint_key) AS endpoint_key
      FROM tenant_endpoint_selection
      WHERE tenant_id = $1
        AND enabled = true
      ORDER BY endpoint_key ASC
    `,
    [tenantId]
  );
  return rows.map((row) => row.endpoint_key).filter(Boolean);
}

function orderEndpointExecution(endpointKeys) {
  const unique = [];
  const seen = new Set();

  for (const key of endpointKeys || []) {
    const normalized = String(key || "").trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }

  const ordered = [];
  if (seen.has("projects")) {
    ordered.push("projects");
  }

  for (const key of unique) {
    if (key === "projects" || key === "fitterhours") {
      continue;
    }
    ordered.push(key);
  }

  if (seen.has("fitterhours")) {
    ordered.push("fitterhours");
  }

  return ordered;
}

function parseTimestampCandidate(value) {
  if (value == null || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getTime();
}

function extractRowTimestamp(row) {
  if (!row || typeof row !== "object") {
    return null;
  }

  for (const key of FITTERHOURS_DATE_KEYS) {
    const candidate = parseTimestampCandidate(row[key]);
    if (candidate != null) {
      return candidate;
    }
  }

  const dynamicDateKeys = Object.keys(row).filter((key) => /date|time/i.test(key));
  for (const key of dynamicDateKeys) {
    const candidate = parseTimestampCandidate(row[key]);
    if (candidate != null) {
      return candidate;
    }
  }

  return null;
}

function shouldStopHistoricalPaging(rows, cutoffIso) {
  if (!cutoffIso) return false;
  const cutoffMs = parseTimestampCandidate(cutoffIso);
  if (cutoffMs == null) return false;

  const timestamps = rows
    .map((row) => extractRowTimestamp(row))
    .filter((value) => value != null);

  if (!timestamps.length) {
    return false;
  }

  const hasDataAtOrAfterCutoff = timestamps.some((timestamp) => timestamp >= cutoffMs);
  return !hasDataAtOrAfterCutoff;
}

function subtractMonthsIso(months) {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() - Number(months || 0));
  return date.toISOString();
}

async function computeFitterhoursCutoff(client, tenantId) {
  const baselineIso = subtractMonthsIso(FITTERHOURS_DEFAULT_MONTHS_LOOKBACK);
  const columnInfo = await client.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'project_core'
        AND column_name = ANY($1::text[])
      ORDER BY array_position($1::text[], column_name)
      LIMIT 1
    `,
    [PROJECT_START_DATE_COLUMN_CANDIDATES]
  );

  const projectStartDateColumn = columnInfo.rows[0]?.column_name || null;
  let activeProjectCount = 0;
  let olderThanBaselineCount = null;
  let oldestActiveProjectStartDate = null;

  if (projectStartDateColumn) {
    const sql = `
      SELECT
        COUNT(*)::int AS active_count,
        COUNT(*) FILTER (WHERE ${projectStartDateColumn} IS NOT NULL AND ${projectStartDateColumn} < $2::timestamptz)::int AS older_than_baseline_count,
        MIN(${projectStartDateColumn}) FILTER (WHERE ${projectStartDateColumn} IS NOT NULL) AS oldest_active_project_start_date
      FROM project_core
      WHERE tenant_id = $1
        AND status = 'open'
        AND COALESCE(is_closed, false) = false
    `;
    const { rows } = await client.query(sql, [tenantId, baselineIso]);
    const stats = rows[0] || {};
    activeProjectCount = Number(stats.active_count || 0);
    olderThanBaselineCount = Number(stats.older_than_baseline_count || 0);
    oldestActiveProjectStartDate = stats.oldest_active_project_start_date
      ? new Date(stats.oldest_active_project_start_date).toISOString()
      : null;
  } else {
    const { rows } = await client.query(
      `
        SELECT COUNT(*)::int AS active_count
        FROM project_core
        WHERE tenant_id = $1
          AND status = 'open'
          AND COALESCE(is_closed, false) = false
      `,
      [tenantId]
    );
    activeProjectCount = Number(rows[0]?.active_count || 0);
  }

  // Global fitterhours bootstrap is always capped at 12 months.
  const cutoffIso = baselineIso;

  return {
    cutoffIso,
    baselineIso,
    activeProjectCount,
    projectStartDateColumn,
    oldestActiveProjectStartDate,
    olderThanBaselineCount,
  };
}

function normalizeBase(baseUrl) {
  const parsed = new URL(String(baseUrl || "").trim());
  const cleanPath = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${cleanPath}`;
}

function buildProjectEndpointVariants(baseUrl) {
  const normalized = normalizeBase(baseUrl);
  const variants = [
    `${normalized}/api/v4.0/projects`,
    `${normalized}/api/v3.0/projects`,
    `${normalized}/api/v4/projects`,
    `${normalized}/api/v3/projects`,
  ].map((url) => url.replace(/([^:]\/)(\/+)/g, "$1"));
  return [...new Set(variants)];
}

function buildProjectSourceEndpointVariants(baseUrl) {
  const normalized = normalizeBase(baseUrl);
  const v4 = [
    `${normalized}/api/v4.0/projects`,
    `${normalized}/api/v4/projects`,
  ].map((url) => url.replace(/([^:]\/)(\/+)/g, "$1"));
  const v3 = [
    `${normalized}/Management/WorkInProgress`,
    `${normalized}/api/v3.0/Management/WorkInProgress`,
    `${normalized}/api/v3/Management/WorkInProgress`,
  ].map((url) => url.replace(/([^:]\/)(\/+)/g, "$1"));

  return {
    projects_v4: [...new Set(v4)],
    projects_v3: [...new Set(v3)],
  };
}

function buildGenericEndpointVariants(baseUrl, endpointKey) {
  const normalized = normalizeBase(baseUrl);
  const safeKey = String(endpointKey || "").trim().toLowerCase();
  const variants = [
    `${normalized}/api/v4.0/${safeKey}`,
    `${normalized}/api/v3.0/${safeKey}`,
    `${normalized}/api/v4/${safeKey}`,
    `${normalized}/api/v3/${safeKey}`,
  ].map((url) => url.replace(/([^:]\/)(\/+)/g, "$1"));
  return [...new Set(variants)];
}

function buildProjectDetailEndpointVariants(baseUrl, reference) {
  const normalized = normalizeBase(baseUrl);
  const encodedRef = encodeURIComponent(String(reference || "").trim());
  const variants = [
    `${normalized}/api/v4.0/projects/ref/${encodedRef}`,
    `${normalized}/api/v3.0/projects/ref/${encodedRef}`,
    `${normalized}/api/v4/projects/ref/${encodedRef}`,
    `${normalized}/api/v3/projects/ref/${encodedRef}`,
  ].map((url) => url.replace(/([^:]\/)(\/+)/g, "$1"));
  return [...new Set(variants)];
}

function parsePagedPayload(payload) {
  let rows = [];
  let nextPage = null;

  if (Array.isArray(payload)) {
    rows = payload;
  } else if (payload && Array.isArray(payload.data)) {
    if (payload.data.length > 0 && payload.data[0] && Array.isArray(payload.data[0].data)) {
      rows = payload.data[0].data;
      nextPage = payload.data[0].nextPage ?? null;
    } else {
      rows = payload.data;
    }
  } else if (payload && payload.data && Array.isArray(payload.data.items)) {
    rows = payload.data.items;
  } else if (payload && Array.isArray(payload.items)) {
    rows = payload.items;
  } else if (payload && payload.result && Array.isArray(payload.result)) {
    rows = payload.result;
  }

  if (nextPage == null && payload && typeof payload.nextPage !== "undefined") {
    nextPage = payload.nextPage;
  }
  if (nextPage == null && payload && payload.pagination && typeof payload.pagination.nextPage !== "undefined") {
    nextPage = payload.pagination.nextPage;
  }

  return {
    rows: Array.isArray(rows) ? rows : [],
    nextPage: nextPage == null ? null : Number(nextPage),
  };
}

function parseProjectDetailPayload(payload) {
  const candidates = [];

  if (payload && typeof payload === "object") {
    candidates.push(payload);
  }

  if (payload && payload.data) {
    if (Array.isArray(payload.data)) {
      candidates.push(...payload.data.filter((item) => item && typeof item === "object"));
      for (const item of payload.data) {
        if (item && Array.isArray(item.data)) {
          candidates.push(...item.data.filter((row) => row && typeof row === "object"));
        }
      }
    } else if (typeof payload.data === "object") {
      candidates.push(payload.data);
    }
  }

  if (payload && payload.result) {
    if (Array.isArray(payload.result)) {
      candidates.push(...payload.result.filter((item) => item && typeof item === "object"));
    } else if (typeof payload.result === "object") {
      candidates.push(payload.result);
    }
  }

  const scoreFields = [
    "reference",
    "projectID",
    "projectId",
    "ProjectID",
    "Responsible",
    "responsible",
    "TeamLeader",
    "teamLeader",
  ];

  let best = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    if (!candidate || Array.isArray(candidate) || typeof candidate !== "object") {
      continue;
    }
    let score = 0;
    for (const field of scoreFields) {
      if (Object.prototype.hasOwnProperty.call(candidate, field)) {
        score += 1;
      }
    }
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function mapProjectStatus(rawStatus, isClosedHint) {
  if (isClosedHint === true) return "closed";
  if (isClosedHint === false) return "open";
  const value = String(rawStatus || "").trim().toLowerCase();
  if (!value) return null;
  if (value === "closed") return "closed";
  if (value === "open") return "open";
  return null;
}

function pickTrimmedText(raw, keys) {
  for (let i = 0; i < keys.length; i += 1) {
    const value = raw[keys[i]];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function pickDateValue(raw, keys) {
  for (let i = 0; i < keys.length; i += 1) {
    const value = raw[keys[i]];
    if (!value) continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return null;
}

function pickBooleanValue(raw, keys) {
  for (let i = 0; i < keys.length; i += 1) {
    const value = raw[keys[i]];
    if (value == null) continue;
    if (typeof value === "boolean") return value;
    const text = String(value).trim().toLowerCase();
    if (["true", "1", "yes", "ja"].includes(text)) return true;
    if (["false", "0", "no", "nej"].includes(text)) return false;
  }
  return null;
}

function mapProjectRow(raw, { sourceEndpointKey } = {}) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const externalRef =
    raw.reference ??
    raw.Reference ??
    raw.projectReference ??
    raw.ProjectReference ??
    raw.projectNumber ??
    raw.ProjectNumber ??
    raw.projectNo ??
    raw.ProjectNo ??
    raw.ProjectID ??
    raw.projectID ??
    raw.projectId ??
    raw.ID ??
    raw.id ??
    null;

  if (externalRef == null || String(externalRef).trim() === "") {
    return null;
  }

  const name =
    raw.ProjectName ??
    raw.projectName ??
    raw.name1 ??
    raw.projectTitle ??
    raw.Name ??
    raw.name ??
    `Project ${externalRef}`;

  const statusRaw =
    raw.Status ??
    raw.status ??
    raw.ProjectStatus ??
    raw.projectStatus ??
    raw.state ??
    raw.Stage ??
    null;

  const isClosedV4 = pickBooleanValue(raw, ["isClosed", "IsClosed"]);
  const isWorkInProgressV3 = pickBooleanValue(raw, ["IsWorkInProgress", "isWorkInProgress"]);

  let resolvedStatus = null;
  let resolvedIsClosed = null;

  if (sourceEndpointKey === "projects_v4") {
    // v4 is authoritative: isClosed decides open/closed deterministically.
    if (isClosedV4 === true) {
      resolvedStatus = "closed";
      resolvedIsClosed = true;
    } else if (isClosedV4 === false) {
      resolvedStatus = "open";
      resolvedIsClosed = false;
    } else {
      resolvedStatus = mapProjectStatus(statusRaw, null);
      resolvedIsClosed = null;
    }
  } else if (sourceEndpointKey === "projects_v3") {
    // v3 WorkInProgress endpoint only proves active/open when true.
    if (isWorkInProgressV3 === true) {
      resolvedStatus = "open";
      resolvedIsClosed = false;
    } else {
      resolvedStatus = null;
      resolvedIsClosed = null;
    }
  } else {
    resolvedStatus = mapProjectStatus(statusRaw, isClosedV4);
    resolvedIsClosed = isClosedV4;
  }

  const responsibleCode = pickTrimmedText(raw, [
    "Responsible",
    "responsible",
    "ResponsibleCode",
    "responsibleCode",
    "responsible_code",
  ]);

  const responsibleId = pickTrimmedText(raw, [
    "ResponsibleID",
    "responsibleID",
    "responsibleId",
    "responsible_id",
  ]);

  const responsibleName = pickTrimmedText(raw, [
    "ResponsibleName",
    "responsibleName",
    "responsible_name",
    "ResponsibleFullName",
    "responsibleFullName",
  ]);

  const teamLeaderCode = pickTrimmedText(raw, [
    "TeamLeader",
    "teamLeader",
    "team_leader",
    "Teamleader",
    "teamleader",
  ]);

  const teamLeaderId = pickTrimmedText(raw, [
    "TeamLeaderID",
    "teamLeaderID",
    "teamLeaderId",
    "team_leader_id",
  ]);

  const teamLeaderName = pickTrimmedText(raw, [
    "TeamLeaderName",
    "teamLeaderName",
    "team_leader_name",
    "TeamleaderName",
    "teamleaderName",
  ]);

  const activityDate = pickDateValue(raw, [
    "lastHourRegistrationDate",
    "lastOrderDate",
    "lastInvoiceDate",
    "endDate",
    "startDate",
    "updatedDate",
  ]);

  return {
    externalProjectRef: String(externalRef).trim(),
    name: String(name).trim() || `Project ${externalRef}`,
    status: resolvedStatus,
    isClosed: resolvedIsClosed,
    activityDate,
    responsibleCode,
    responsibleName,
    responsibleId,
    teamLeaderCode,
    teamLeaderName,
    teamLeaderId,
  };
}

function mergeIdentityFields(baseRow, detailRow) {
  if (!detailRow) return baseRow;
  return {
    ...baseRow,
    status: baseRow.status || detailRow.status,
    isClosed: baseRow.isClosed == null ? detailRow.isClosed : baseRow.isClosed,
    activityDate: baseRow.activityDate || detailRow.activityDate,
    responsibleCode: baseRow.responsibleCode || detailRow.responsibleCode,
    responsibleName: baseRow.responsibleName || detailRow.responsibleName,
    responsibleId: baseRow.responsibleId || detailRow.responsibleId,
    teamLeaderCode: baseRow.teamLeaderCode || detailRow.teamLeaderCode,
    teamLeaderName: baseRow.teamLeaderName || detailRow.teamLeaderName,
    teamLeaderId: baseRow.teamLeaderId || detailRow.teamLeaderId,
  };
}

function requiresIdentityEnrichment(row) {
  return !row.responsibleCode || String(row.responsibleCode).trim() === "";
}

async function upsertProjectBatch(client, { tenantId, mappedRows, sourceEndpointKey }) {
  if (!mappedRows.length) return;

  const fromV4 = sourceEndpointKey === "projects_v4";
  const fromV3 = sourceEndpointKey === "projects_v3";

  const rowChunks = chunkArray(mappedRows, 100);
  for (const chunk of rowChunks) {
    const values = [];
    const params = [];
    chunk.forEach((row, index) => {
      const offset = index * 14;
      params.push(
        tenantId,
        row.externalProjectRef,
        row.name,
        row.status,
        row.activityDate,
        row.isClosed,
        row.responsibleCode,
        row.responsibleName,
        row.responsibleId,
        row.teamLeaderCode,
        row.teamLeaderName,
        row.teamLeaderId,
        fromV4,
        fromV3
      );
      values.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14})`
      );
    });

    const sql = `
      INSERT INTO project_core (
        tenant_id,
        external_project_ref,
        name,
        status,
        activity_date,
        is_closed,
        responsible_code,
        responsible_name,
        responsible_id,
        team_leader_code,
        team_leader_name,
        team_leader_id,
        has_v4,
        has_v3
      )
      VALUES ${values.join(",\n")}
      ON CONFLICT (tenant_id, external_project_ref)
      WHERE external_project_ref IS NOT NULL
      DO UPDATE SET
        name = EXCLUDED.name,
        status = CASE
          WHEN EXCLUDED.has_v4 THEN COALESCE(EXCLUDED.status, project_core.status)
          WHEN EXCLUDED.has_v3 AND project_core.has_v4 THEN project_core.status
          WHEN EXCLUDED.has_v3 AND EXCLUDED.status = 'open' THEN 'open'
          ELSE project_core.status
        END,
        activity_date = COALESCE(EXCLUDED.activity_date, project_core.activity_date),
        is_closed = CASE
          WHEN EXCLUDED.has_v4 THEN COALESCE(EXCLUDED.is_closed, project_core.is_closed)
          WHEN EXCLUDED.has_v3 AND project_core.has_v4 THEN project_core.is_closed
          WHEN EXCLUDED.has_v3 AND EXCLUDED.is_closed = false THEN false
          ELSE project_core.is_closed
        END,
        responsible_code = EXCLUDED.responsible_code,
        responsible_name = EXCLUDED.responsible_name,
        responsible_id = EXCLUDED.responsible_id,
        team_leader_code = EXCLUDED.team_leader_code,
        team_leader_name = EXCLUDED.team_leader_name,
        team_leader_id = EXCLUDED.team_leader_id,
        has_v4 = project_core.has_v4 OR EXCLUDED.has_v4,
        has_v3 = project_core.has_v3 OR EXCLUDED.has_v3,
        updated_at = now()
    `;

    await client.query(sql, params);
  }
}

async function fetchProjectsPage({ endpointBase, page, pageSize, headers, updatedAfter }) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  if (updatedAfter) {
    params.set("updatedAfter", String(updatedAfter));
  }

  const url = `${endpointBase}?${params.toString()}`;
  const payload = await fetchJsonWithRetry(url, { headers });
  return parsePagedPayload(payload);
}

async function fetchEndpointPage({ endpointBase, page, pageSize, headers, updatedAfter }) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  if (updatedAfter) {
    params.set("updatedAfter", String(updatedAfter));
  }

  const url = `${endpointBase}?${params.toString()}`;
  const payload = await fetchJsonWithRetry(url, { headers });
  return parsePagedPayload(payload);
}

async function discoverCompatibleProjectEndpoints({ endpointBases, headers }) {
  const compatible = [];
  let lastError = null;

  for (const endpointBase of endpointBases) {
    try {
      await fetchProjectsPage({ endpointBase, page: 1, pageSize: 1, headers, updatedAfter: null });
      compatible.push(endpointBase);
    } catch (error) {
      lastError = error;
      if (/\(404\)|\(400\)/.test(String(error.message || ""))) {
        continue;
      }
      console.error(`[syncWorker] endpoint probe failed endpoint=${endpointBase} msg=${error.message}`);
    }
  }

  if (!compatible.length) {
    throw lastError || new Error("No compatible E-Komplet /projects endpoint found");
  }

  return compatible;
}

async function discoverCompatibleEndpoints({ endpointBases, headers }) {
  const compatible = [];
  let lastError = null;

  for (const endpointBase of endpointBases) {
    try {
      await fetchEndpointPage({ endpointBase, page: 1, pageSize: 1, headers, updatedAfter: null });
      compatible.push(endpointBase);
    } catch (error) {
      lastError = error;
      if (/\(404\)|\(400\)/.test(String(error.message || ""))) {
        continue;
      }
      console.error(`[syncWorker] endpoint probe failed endpoint=${endpointBase} msg=${error.message}`);
    }
  }

  if (!compatible.length) {
    throw lastError || new Error("No compatible E-Komplet endpoint found");
  }

  return compatible;
}

async function fetchJsonWithRetry(url, { headers }) {
  let lastError = null;

  for (let attempt = 1; attempt <= HTTP_RETRY_COUNT; attempt += 1) {
    try {
      const response = await fetch(url, { method: "GET", headers });
      if (response.ok) {
        return await response.json();
      }

      if (response.status === 429 && attempt < HTTP_RETRY_COUNT) {
        const retryHeader = response.headers.get("retry-after");
        const waitMs = retryHeader ? Math.min(Number(retryHeader) * 1000, 30_000) : attempt * 1200;
        await new Promise((resolve) => setTimeout(resolve, Number.isFinite(waitMs) ? waitMs : 1200));
        continue;
      }

      const body = await response.text().catch(() => "");
      throw new Error(`E-Komplet request failed (${response.status}) ${body.slice(0, 300)}`);
    } catch (error) {
      lastError = error;
      if (attempt < HTTP_RETRY_COUNT) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }

  throw lastError || new Error("E-Komplet request failed");
}

async function resolveTenantSyncConfig(client, tenantId) {
  const sql = `
    SELECT
      tc.tenant_id,
      tc.ek_base_url,
      tc.ek_api_key_encrypted,
      tcs.config_snapshot
    FROM tenant_config tc
    LEFT JOIN LATERAL (
      SELECT config_snapshot
      FROM tenant_config_snapshot
      WHERE tenant_id = tc.tenant_id
      ORDER BY changed_at DESC
      LIMIT 1
    ) tcs ON true
    WHERE tc.tenant_id = $1
    LIMIT 1
  `;

  const { rows } = await client.query(sql, [tenantId]);
  const row = rows[0] || null;
  if (!row) {
    throw new Error("Tenant EK config missing");
  }

  return {
    ekBaseUrl: row.ek_base_url,
    ekApiKey: decryptSecret(row.ek_api_key_encrypted),
    siteName: extractSiteName(row.config_snapshot || {}),
  };
}

async function fetchProjectDetailByReference({ ekBaseUrl, headers, reference }) {
  const endpoints = buildProjectDetailEndpointVariants(ekBaseUrl, reference);
  for (const endpoint of endpoints) {
    try {
      const payload = await fetchJsonWithRetry(endpoint, { headers });
      const detailRaw = parseProjectDetailPayload(payload);
      const mapped = mapProjectRow(detailRaw);
      if (mapped) {
        return mapped;
      }
    } catch (error) {
      if (/\(404\)|\(400\)/.test(String(error.message || ""))) {
        continue;
      }
      throw error;
    }
  }
  return null;
}

async function enrichProjectIdentityFields({ ekBaseUrl, headers, rows }) {
  const enrichedRows = [];
  let enrichedCount = 0;

  for (const row of rows) {
    if (!requiresIdentityEnrichment(row) || !row.externalProjectRef) {
      enrichedRows.push(row);
      continue;
    }

    try {
      const detailMapped = await fetchProjectDetailByReference({
        ekBaseUrl,
        headers,
        reference: row.externalProjectRef,
      });
      if (detailMapped) {
        const merged = mergeIdentityFields(row, detailMapped);
        if ((merged.responsibleCode || "") !== (row.responsibleCode || "")) {
          enrichedCount += 1;
        }
        enrichedRows.push(merged);
      } else {
        enrichedRows.push(row);
      }
    } catch (error) {
      console.error(
        `[syncWorker] detail enrich failed ref=${row.externalProjectRef} ${String(error.message || "unknown")}`
      );
      enrichedRows.push(row);
    }
  }

  return { rows: enrichedRows, enrichedCount };
}

function computeRetryBackoffMs(retryCount) {
  const baseMs = 15_000;
  return baseMs * Math.pow(2, Math.max(0, retryCount - 1));
}

async function getProjectSourceEndpointsAndHeaders({ cfg }) {
  const sourceVariants = buildProjectSourceEndpointVariants(cfg.ekBaseUrl);
  const headers = {
    apikey: cfg.ekApiKey,
    siteName: cfg.siteName,
    Accept: "application/json",
  };

  const sources = [
    {
      endpointKey: "projects_v4",
      endpointBases: sourceVariants.projects_v4,
      strategy: ENDPOINT_STRATEGY.projects_v4,
    },
    {
      endpointKey: "projects_v3",
      endpointBases: sourceVariants.projects_v3,
      strategy: ENDPOINT_STRATEGY.projects_v3,
    },
  ];

  return {
    sources,
    headers,
  };
}

async function getGenericEndpointsAndHeaders({ cfg, endpointKey }) {
  const endpointBases = buildGenericEndpointVariants(cfg.ekBaseUrl, endpointKey);
  const headers = {
    apikey: cfg.ekApiKey,
    siteName: cfg.siteName,
    Accept: "application/json",
  };

  return {
    endpointBases,
    headers,
  };
}

async function runReadOnlyEndpoint({ job, cfg, endpointKey, mode, cutoffContext = null }) {
  const normalizedMode = modeFromJobType(mode, SYNC_MODES.SLOW_RECONCILIATION);
  const strategyMeta = ENDPOINT_STRATEGY[endpointKey] || {
    supportsDelta: false,
    strategy: SYNC_STRATEGIES.NOT_MATERIALIZED,
    materialized: false,
  };
  const { endpointBases, headers } = await getGenericEndpointsAndHeaders({ cfg, endpointKey });
  const compatibleEndpoints = await discoverCompatibleEndpoints({ endpointBases, headers });

  const state = await withTransaction(async (client) => getEndpointState(client, {
    tenantId: job.tenant_id,
    endpointKey,
  }));

  let updatedAfter = null;
  if (normalizedMode === SYNC_MODES.DELTA && strategyMeta.supportsDelta && state && state.updated_after_watermark) {
    updatedAfter = state.updated_after_watermark;
  }

  let pagesProcessed = 0;
  let rowsFetchedTotal = 0;
  let retriesQueued = 0;
  let lastSuccessfulPage = state && state.last_successful_page ? Number(state.last_successful_page) : null;
  const cutoffIso = cutoffContext && cutoffContext.cutoffIso ? cutoffContext.cutoffIso : null;

  await withTransaction(async (client) => {
    await markEndpointState(client, {
      tenantId: job.tenant_id,
      endpointKey,
      status: "running",
      jobId: job.id,
      currentJobId: job.id,
      currentMode: normalizedMode,
      syncStrategy: strategyMeta.materialized ? strategyMeta.strategy : SYNC_STRATEGIES.NOT_MATERIALIZED,
      lastAttemptAt: nowIso(),
      lastSuccessAt: null,
      lastSuccessfulPage: null,
      lastSuccessfulCursor: null,
      lastSeenRemoteCursor: null,
      updatedAfterWatermark: null,
      rowsFetchedDelta: 0,
      rowsPersistedDelta: 0,
      pagesProcessedLastJob: 0,
      rowsFetchedLastJob: 0,
      retryCount: 0,
      pendingBacklogCount: null,
      failedPageCount: null,
      lastHttpStatus: null,
      heartbeatAt: nowIso(),
      nextPlannedAt: normalizedMode === SYNC_MODES.DELTA ? new Date(Date.now() + DELTA_INTERVAL_MS).toISOString() : null,
      errorMessage: null,
    });
  });

  for (const endpointBase of compatibleEndpoints) {
    let page = state && state.last_successful_page ? Number(state.last_successful_page) + 1 : 1;
    if (normalizedMode === SYNC_MODES.BOOTSTRAP_INITIAL || normalizedMode === SYNC_MODES.MANUAL_FULL_RESYNC) {
      page = 1;
    }

    while (true) {
      await heartbeat(job.id);
      await withTransaction(async (client) => {
        await markEndpointHeartbeat(client, {
          tenantId: job.tenant_id,
          endpointKey,
          jobId: job.id,
          currentMode: normalizedMode,
        });
      });

      try {
        const parsed = await fetchEndpointPage({
          endpointBase,
          page,
          pageSize: PAGE_SIZE,
          headers,
          updatedAfter,
        });

        const rowsFetched = parsed.rows.length;
        const stopForCutoff = endpointKey === "fitterhours"
          ? shouldStopHistoricalPaging(parsed.rows, cutoffIso)
          : false;

        await withTransaction(async (client) => {
          await appendPageLog(client, {
            tenantId: job.tenant_id,
            jobId: job.id,
            endpointKey,
            mode: normalizedMode,
            pageNumber: page,
            nextPage: parsed.nextPage,
            status: "success",
            rowsFetched,
            rowsPersisted: 0,
            httpStatus: 200,
            errorMessage: "persist_skipped:no_supported_table",
            retryCount: 0,
            startedAt: nowIso(),
            finishedAt: nowIso(),
            attemptNo: 1,
          });

          await markEndpointState(client, {
            tenantId: job.tenant_id,
            endpointKey,
            status: "running",
            jobId: job.id,
            currentJobId: job.id,
            currentMode: normalizedMode,
            syncStrategy: strategyMeta.materialized ? strategyMeta.strategy : SYNC_STRATEGIES.NOT_MATERIALIZED,
            lastAttemptAt: nowIso(),
            lastSuccessAt: null,
            lastSuccessfulPage: page,
            lastSuccessfulCursor: parsed.nextPage == null ? null : String(parsed.nextPage),
            lastSeenRemoteCursor: parsed.nextPage == null ? null : String(parsed.nextPage),
            updatedAfterWatermark: null,
            rowsFetchedDelta: rowsFetched,
            rowsPersistedDelta: 0,
            pagesProcessedLastJob: null,
            rowsFetchedLastJob: null,
            retryCount: null,
            pendingBacklogCount: null,
            failedPageCount: null,
            lastHttpStatus: 200,
            heartbeatAt: nowIso(),
            nextPlannedAt: null,
            errorMessage: "persist_skipped:no_supported_table",
          });
        });

        if (rowsFetched === 0) {
          console.log(
            `[syncWorker] endpoint=${endpointKey} source=${endpointBase} page=${page} nextPage=${parsed.nextPage} pageCount=unknown rowsPersisted=0 collectedOrPersistedTotal=${rowsFetchedTotal}`
          );
          break;
        }

        pagesProcessed += 1;
        rowsFetchedTotal += rowsFetched;
        lastSuccessfulPage = page;

        await withTransaction(async (client) => {
          await syncJobQueries.markJobProgress(client, {
            jobId: job.id,
            rowsProcessed: rowsFetchedTotal,
            pagesProcessed,
          });
        });

        console.log(
          `[syncWorker] endpoint=${endpointKey} source=${endpointBase} page=${page} nextPage=${parsed.nextPage} pageCount=unknown rowsPersisted=0 collectedOrPersistedTotal=${rowsFetchedTotal}`
        );

        if (stopForCutoff) {
          console.log(
            `[syncWorker] endpoint=${endpointKey} cutoff_reached=true cutoff=${cutoffIso} stop_at_page=${page}`
          );
          break;
        }

        page += 1;
      } catch (error) {
        const classification = classifyError(error);
        const nextRetryAt = classification.retryable ? computeBacklogRetryAt(classification.kind, 1) : null;
        const status = classification.retryable ? "deferred" : "failed";

        await withTransaction(async (client) => {
          await appendPageLog(client, {
            tenantId: job.tenant_id,
            jobId: job.id,
            endpointKey,
            mode: normalizedMode,
            pageNumber: page,
            nextPage: null,
            status: "failed",
            rowsFetched: 0,
            rowsPersisted: 0,
            httpStatus: classification.status,
            errorMessage: String(error.message || "sync_page_failed").slice(0, 2000),
            retryCount: 0,
            startedAt: nowIso(),
            finishedAt: nowIso(),
            attemptNo: 1,
          });

          await queueBacklogFailure(client, {
            tenantId: job.tenant_id,
            jobId: job.id,
            endpointKey,
            locator: normalizeLocator({ page }),
            failureKind: classification.kind,
            errorMessage: error.message,
            attempts: 1,
            nextRetryAt,
            status,
          });

          await markEndpointState(client, {
            tenantId: job.tenant_id,
            endpointKey,
            status: "partial",
            jobId: job.id,
            currentJobId: job.id,
            currentMode: normalizedMode,
            syncStrategy: strategyMeta.materialized ? strategyMeta.strategy : SYNC_STRATEGIES.NOT_MATERIALIZED,
            lastAttemptAt: nowIso(),
            lastSuccessAt: null,
            lastSuccessfulPage: lastSuccessfulPage,
            lastSuccessfulCursor: null,
            lastSeenRemoteCursor: null,
            updatedAfterWatermark: null,
            rowsFetchedDelta: 0,
            rowsPersistedDelta: 0,
            pagesProcessedLastJob: null,
            rowsFetchedLastJob: null,
            retryCount: 1,
            pendingBacklogCount: null,
            failedPageCount: null,
            lastHttpStatus: classification.status,
            heartbeatAt: nowIso(),
            nextPlannedAt: nextRetryAt,
            errorMessage: String(error.message || "sync_page_failed").slice(0, 2000),
          });
        });

        retriesQueued += 1;
        page += 1;
      }
    }
  }

  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE status IN ('pending', 'deferred', 'retrying'))::int AS pending_count,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count
        FROM sync_failure_backlog
        WHERE tenant_id = $1
          AND endpoint_key = $2
      `,
      [job.tenant_id, endpointKey]
    );
    const backlogCounts = rows[0] || { pending_count: 0, failed_count: 0 };

    await markEndpointState(client, {
      tenantId: job.tenant_id,
      endpointKey,
      status: Number(backlogCounts.pending_count || 0) > 0 ? "partial" : "success",
      jobId: job.id,
      currentJobId: null,
      currentMode: normalizedMode,
      syncStrategy: strategyMeta.materialized ? strategyMeta.strategy : SYNC_STRATEGIES.NOT_MATERIALIZED,
      lastAttemptAt: nowIso(),
      lastSuccessAt: nowIso(),
      lastSuccessfulPage: lastSuccessfulPage,
      lastSuccessfulCursor: null,
      lastSeenRemoteCursor: null,
      updatedAfterWatermark: normalizedMode === SYNC_MODES.DELTA && strategyMeta.supportsDelta ? nowIso() : null,
      rowsFetchedDelta: 0,
      rowsPersistedDelta: 0,
      pagesProcessedLastJob: pagesProcessed,
      rowsFetchedLastJob: rowsFetchedTotal,
      retryCount: retriesQueued,
      pendingBacklogCount: Number(backlogCounts.pending_count || 0),
      failedPageCount: Number(backlogCounts.failed_count || 0),
      lastHttpStatus: null,
      heartbeatAt: nowIso(),
      nextPlannedAt: new Date(Date.now() + DELTA_INTERVAL_MS).toISOString(),
      errorMessage: "persist_skipped:no_supported_table",
    });
  });

  return {
    pagesProcessed,
    rowsProcessed: 0,
    retriesQueued,
  };
}

async function persistProjectsPage({
  job,
  cfg,
  endpointBase,
  headers,
  endpointKey,
  mode,
  page,
  updatedAfter,
}) {
  const parsed = await fetchProjectsPage({ endpointBase, page, pageSize: PAGE_SIZE, headers, updatedAfter });
  const mappedRows = parsed.rows
    .map((row) => mapProjectRow(row, { sourceEndpointKey: endpointKey }))
    .filter((row) => Boolean(row && row.status));

  const enriched = await enrichProjectIdentityFields({
    ekBaseUrl: cfg.ekBaseUrl,
    headers,
    rows: mappedRows,
  });

  await withTransaction(async (client) => {
    await upsertProjectBatch(client, {
      tenantId: job.tenant_id,
      mappedRows: enriched.rows,
      sourceEndpointKey: endpointKey,
    });

    await appendPageLog(client, {
      tenantId: job.tenant_id,
      jobId: job.id,
      endpointKey,
      mode,
      pageNumber: page,
      nextPage: parsed.nextPage,
      status: "success",
      rowsFetched: mappedRows.length,
      rowsPersisted: enriched.rows.length,
      httpStatus: 200,
      errorMessage: null,
      retryCount: 0,
      startedAt: nowIso(),
      finishedAt: nowIso(),
      attemptNo: 1,
    });

    await markEndpointState(client, {
      tenantId: job.tenant_id,
      endpointKey,
      status: "running",
      jobId: job.id,
      currentJobId: job.id,
      currentMode: mode,
      syncStrategy: ENDPOINT_STRATEGY[endpointKey]?.strategy || SYNC_STRATEGIES.DELTA_SUPPORTED,
      lastAttemptAt: nowIso(),
      lastSuccessAt: null,
      lastSuccessfulPage: page,
      lastSuccessfulCursor: parsed.nextPage == null ? null : String(parsed.nextPage),
      lastSeenRemoteCursor: parsed.nextPage == null ? null : String(parsed.nextPage),
      updatedAfterWatermark: null,
      rowsFetchedDelta: mappedRows.length,
      rowsPersistedDelta: enriched.rows.length,
      pagesProcessedLastJob: null,
      rowsFetchedLastJob: null,
      retryCount: null,
      pendingBacklogCount: null,
      failedPageCount: null,
      lastHttpStatus: 200,
      heartbeatAt: nowIso(),
      nextPlannedAt: null,
      errorMessage: null,
    });
  });

  return {
    parsed,
    rowsFetched: mappedRows.length,
    rowsPersisted: enriched.rows.length,
    enrichedCount: enriched.enrichedCount,
  };
}

async function logProjectsPageFailure({ job, endpointKey, mode, page, error, attempts }) {
  const classification = classifyError(error);
  const status = classification.retryable ? "deferred" : "failed";
  const nextRetryAt = classification.retryable ? computeBacklogRetryAt(classification.kind, attempts) : null;
  const locator = normalizeLocator({ page });

  await withTransaction(async (client) => {
    await appendPageLog(client, {
      tenantId: job.tenant_id,
      jobId: job.id,
      endpointKey,
      mode,
      pageNumber: page,
      nextPage: null,
      status: "failed",
      rowsFetched: 0,
      rowsPersisted: 0,
      httpStatus: classification.status,
      errorMessage: String(error.message || "sync_page_failed").slice(0, 2000),
      retryCount: Math.max(0, attempts - 1),
      startedAt: nowIso(),
      finishedAt: nowIso(),
      attemptNo: attempts,
    });

    await queueBacklogFailure(client, {
      tenantId: job.tenant_id,
      jobId: job.id,
      endpointKey,
      locator,
      failureKind: classification.kind,
      errorMessage: error.message,
      attempts,
      nextRetryAt,
      status,
    });

    await markEndpointState(client, {
      tenantId: job.tenant_id,
      endpointKey,
      status: "partial",
      jobId: job.id,
      currentJobId: job.id,
      currentMode: mode,
      syncStrategy: ENDPOINT_STRATEGY[endpointKey]?.strategy || SYNC_STRATEGIES.RECONCILE_SCAN,
      lastAttemptAt: nowIso(),
      lastSuccessAt: null,
      lastSuccessfulPage: null,
      lastSuccessfulCursor: null,
      lastSeenRemoteCursor: null,
      updatedAfterWatermark: null,
      rowsFetchedDelta: 0,
      rowsPersistedDelta: 0,
      pagesProcessedLastJob: null,
      rowsFetchedLastJob: null,
      retryCount: attempts,
      pendingBacklogCount: null,
      failedPageCount: null,
      lastHttpStatus: classification.status,
      heartbeatAt: nowIso(),
      nextPlannedAt: nextRetryAt,
      errorMessage: String(error.message || "sync_page_failed").slice(0, 2000),
    });
  });

  return { classification, status, nextRetryAt };
}

async function runProjectsEndpoint({ job, cfg, mode }) {
  const normalizedMode = modeFromJobType(mode, SYNC_MODES.DELTA);
  const { sources, headers } = await getProjectSourceEndpointsAndHeaders({ cfg });

  let pagesProcessed = 0;
  let rowsProcessed = 0;
  let retriesQueued = 0;

  for (const source of sources) {
    const endpointKey = source.endpointKey;
    const compatibleEndpoints = await discoverCompatibleProjectEndpoints({
      endpointBases: source.endpointBases,
      headers,
    });

    const state = await withTransaction(async (client) =>
      getEndpointState(client, {
        tenantId: job.tenant_id,
        endpointKey,
      })
    );

    const hasKnownWatermark = Boolean(state && state.updated_after_watermark);
    const hasBacklog = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `
          SELECT COUNT(*)::int AS c
          FROM sync_failure_backlog
          WHERE tenant_id = $1
            AND endpoint_key = $2
            AND status IN ('pending', 'deferred', 'retrying')
        `,
        [job.tenant_id, endpointKey]
      );
      return Number(rows[0]?.c || 0) > 0;
    });

    const isStrictDelta = normalizedMode === SYNC_MODES.DELTA && hasKnownWatermark && !hasBacklog;
    const updatedAfter = isStrictDelta ? state.updated_after_watermark : null;
    let page = state && state.last_successful_page ? Number(state.last_successful_page) + 1 : 1;
    if (normalizedMode === SYNC_MODES.BOOTSTRAP_INITIAL || normalizedMode === SYNC_MODES.MANUAL_FULL_RESYNC) {
      page = 1;
    }

    await withTransaction(async (client) => {
      await markEndpointState(client, {
        tenantId: job.tenant_id,
        endpointKey,
        status: "running",
        jobId: job.id,
        currentJobId: job.id,
        currentMode: normalizedMode,
        syncStrategy: source.strategy.strategy,
        lastAttemptAt: nowIso(),
        lastSuccessAt: null,
        lastSuccessfulPage: null,
        lastSuccessfulCursor: null,
        lastSeenRemoteCursor: null,
        updatedAfterWatermark: null,
        rowsFetchedDelta: 0,
        rowsPersistedDelta: 0,
        pagesProcessedLastJob: 0,
        rowsFetchedLastJob: 0,
        retryCount: 0,
        pendingBacklogCount: null,
        failedPageCount: null,
        lastHttpStatus: null,
        heartbeatAt: nowIso(),
        nextPlannedAt: normalizedMode === SYNC_MODES.DELTA ? new Date(Date.now() + DELTA_INTERVAL_MS).toISOString() : null,
        errorMessage: null,
      });
    });

    let sourcePagesProcessed = 0;
    let sourceRowsFetched = 0;
    let sourceRowsPersisted = 0;
    let sourceRetries = 0;
    let lastSuccessfulPage = state && state.last_successful_page ? Number(state.last_successful_page) : null;

    for (const endpointBase of compatibleEndpoints) {
      while (true) {
        await heartbeat(job.id);
        await withTransaction(async (client) => {
          await markEndpointHeartbeat(client, {
            tenantId: job.tenant_id,
            endpointKey,
            jobId: job.id,
            currentMode: normalizedMode,
          });
        });

        try {
          const result = await persistProjectsPage({
            job,
            cfg,
            endpointBase,
            headers,
            endpointKey,
            mode: normalizedMode,
            page,
            updatedAfter,
          });

          if (result.rowsFetched === 0) {
            console.log(
              `[syncWorker] endpoint=${endpointKey} source=${endpointBase} currentPage=${page} nextPage=${result.parsed.nextPage} pageCount=unknown rowsPersisted=0 collectedOrPersistedTotal=${rowsProcessed}`
            );
            break;
          }

          sourcePagesProcessed += 1;
          sourceRowsFetched += result.rowsFetched;
          sourceRowsPersisted += result.rowsPersisted;
          pagesProcessed += 1;
          rowsProcessed += result.rowsPersisted;
          lastSuccessfulPage = page;

          await withTransaction(async (client) => {
            await syncJobQueries.markJobProgress(client, {
              jobId: job.id,
              rowsProcessed,
              pagesProcessed,
            });
          });

          console.log(
            `[syncWorker] endpoint=${endpointKey} source=${endpointBase} currentPage=${page} nextPage=${result.parsed.nextPage} pageCount=unknown rowsPersisted=${result.rowsPersisted} collectedOrPersistedTotal=${rowsProcessed}`
          );

          page += 1;
        } catch (error) {
          const attemptNo = 1;
          const failure = await logProjectsPageFailure({
            job,
            endpointKey,
            mode: normalizedMode,
            page,
            error,
            attempts: attemptNo,
          });

          sourceRetries += 1;
          retriesQueued += 1;

          console.error(
            `[syncWorker] page failed endpoint=${endpointKey} source=${endpointBase} mode=${normalizedMode} page=${page} status=${failure.classification.kind} msg=${error.message}`
          );

          page += 1;
        }
      }
    }

    const backlogCounts = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `
          SELECT
            COUNT(*) FILTER (WHERE status IN ('pending', 'deferred', 'retrying'))::int AS pending_count,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count
          FROM sync_failure_backlog
          WHERE tenant_id = $1
            AND endpoint_key = $2
        `,
        [job.tenant_id, endpointKey]
      );
      return rows[0] || { pending_count: 0, failed_count: 0 };
    });

    await withTransaction(async (client) => {
      await markEndpointState(client, {
        tenantId: job.tenant_id,
        endpointKey,
        status: Number(backlogCounts.pending_count || 0) > 0 ? "partial" : "success",
        jobId: job.id,
        currentJobId: null,
        currentMode: normalizedMode,
        syncStrategy: source.strategy.strategy,
        lastAttemptAt: nowIso(),
        lastSuccessAt: nowIso(),
        lastSuccessfulPage,
        lastSuccessfulCursor: null,
        lastSeenRemoteCursor: null,
        updatedAfterWatermark: source.strategy.supportsDelta ? nowIso() : null,
        rowsFetchedDelta: 0,
        rowsPersistedDelta: 0,
        pagesProcessedLastJob: sourcePagesProcessed,
        rowsFetchedLastJob: sourceRowsFetched,
        retryCount: sourceRetries,
        pendingBacklogCount: Number(backlogCounts.pending_count || 0),
        failedPageCount: Number(backlogCounts.failed_count || 0),
        lastHttpStatus: null,
        heartbeatAt: nowIso(),
        nextPlannedAt: new Date(Date.now() + DELTA_INTERVAL_MS).toISOString(),
        errorMessage: Number(backlogCounts.pending_count || 0) > 0 ? "backlog_pending" : null,
      });
    });
  }

  return { pagesProcessed, rowsProcessed, retriesQueued };
}

async function runProjectsBacklogRetryRound({ job, cfg, endpointKey }) {
  const dueFailures = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `
        SELECT
          id,
          locator_type,
          locator_value,
          page_number,
          cursor_value,
          reference_value,
          attempts,
          status
        FROM sync_failure_backlog
        WHERE tenant_id = $1
          AND endpoint_key = $2
          AND status IN ('pending', 'deferred', 'retrying')
          AND (next_retry_at IS NULL OR next_retry_at <= now())
        ORDER BY last_failed_at ASC
        LIMIT $3
      `,
      [job.tenant_id, endpointKey, BACKLOG_RETRY_BATCH_SIZE]
    );
    return rows;
  });

  if (!dueFailures.length) {
    return { retried: 0, resolved: 0, stillFailed: 0 };
  }

  const { sources, headers } = await getProjectSourceEndpointsAndHeaders({ cfg });
  const source = sources.find((item) => item.endpointKey === endpointKey);
  if (!source) {
    return { retried: 0, resolved: 0, stillFailed: dueFailures.length };
  }
  const compatibleEndpoints = await discoverCompatibleProjectEndpoints({ endpointBases: source.endpointBases, headers });

  let retried = 0;
  let resolved = 0;
  let stillFailed = 0;

  for (const failure of dueFailures) {
    retried += 1;
    const nextAttempt = Number(failure.attempts || 0) + 1;
    const page = failure.page_number || 1;

    try {
      let parsed = null;
      let lastEndpointError = null;
      for (const endpointBase of compatibleEndpoints) {
        try {
          parsed = await fetchProjectsPage({
            endpointBase,
            page,
            pageSize: PAGE_SIZE,
            headers,
            updatedAfter: null,
          });
          break;
        } catch (error) {
          lastEndpointError = error;
        }
      }

      if (!parsed) {
        throw lastEndpointError || new Error("retry page fetch failed on all endpoints");
      }

      const mappedRows = parsed.rows.map(mapProjectRow).filter(Boolean);
      const enriched = await enrichProjectIdentityFields({
        ekBaseUrl: cfg.ekBaseUrl,
        headers,
        rows: mappedRows,
      });

      await withTransaction(async (client) => {
        await upsertProjectBatch(client, {
          tenantId: job.tenant_id,
          mappedRows: enriched.rows,
          sourceEndpointKey: endpointKey,
        });

        await resolveBacklogFailure(client, {
          backlogId: failure.id,
          jobId: job.id,
        });

        await appendPageLog(client, {
          tenantId: job.tenant_id,
          jobId: job.id,
          endpointKey,
          mode: SYNC_MODES.RETRY_BACKLOG,
          pageNumber: page,
          nextPage: parsed.nextPage,
          status: "retry_success",
          rowsFetched: mappedRows.length,
          rowsPersisted: enriched.rows.length,
          httpStatus: 200,
          errorMessage: null,
          retryCount: Math.max(0, nextAttempt - 1),
          startedAt: nowIso(),
          finishedAt: nowIso(),
          attemptNo: nextAttempt,
        });
      });

      resolved += 1;
    } catch (error) {
      const classification = classifyError(error);
      const terminal = !classification.retryable || nextAttempt >= MAX_BACKLOG_ATTEMPTS;
      const nextStatus = terminal ? "failed" : "deferred";
      const nextRetryAt = terminal ? null : computeBacklogRetryAt(classification.kind, nextAttempt);

      await withTransaction(async (client) => {
        await client.query(
          `
            UPDATE sync_failure_backlog
            SET
              failure_kind = $2,
              error_message = $3,
              attempts = $4,
              last_failed_at = now(),
              next_retry_at = $5,
              status = $6,
              last_job_id = $7,
              updated_at = now()
            WHERE id = $1
          `,
          [
            failure.id,
            classification.kind,
            String(error.message || "sync_retry_failed").slice(0, 2000),
            nextAttempt,
            nextRetryAt,
            nextStatus,
            job.id,
          ]
        );

        await appendPageLog(client, {
          tenantId: job.tenant_id,
          jobId: job.id,
          endpointKey,
          mode: SYNC_MODES.RETRY_BACKLOG,
          pageNumber: page,
          nextPage: null,
          status: "retry_failed",
          rowsFetched: 0,
          rowsPersisted: 0,
          httpStatus: classification.status,
          errorMessage: String(error.message || "sync_retry_failed").slice(0, 2000),
          retryCount: Math.max(0, nextAttempt - 1),
          startedAt: nowIso(),
          finishedAt: nowIso(),
          attemptNo: nextAttempt,
        });
      });

      stillFailed += 1;
    }
  }

  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE status IN ('pending', 'deferred', 'retrying'))::int AS pending_count,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count
        FROM sync_failure_backlog
        WHERE tenant_id = $1
          AND endpoint_key = $2
      `,
      [job.tenant_id, endpointKey]
    );
    const counts = rows[0] || { pending_count: 0, failed_count: 0 };

    await markEndpointState(client, {
      tenantId: job.tenant_id,
      endpointKey,
      status: Number(counts.pending_count || 0) > 0 ? "partial" : "success",
      jobId: job.id,
      currentJobId: null,
      currentMode: SYNC_MODES.RETRY_BACKLOG,
      syncStrategy: ENDPOINT_STRATEGY[endpointKey]?.strategy || SYNC_STRATEGIES.DELTA_SUPPORTED,
      lastAttemptAt: nowIso(),
      lastSuccessAt: null,
      lastSuccessfulPage: null,
      lastSuccessfulCursor: null,
      lastSeenRemoteCursor: null,
      updatedAfterWatermark: null,
      rowsFetchedDelta: 0,
      rowsPersistedDelta: 0,
      pagesProcessedLastJob: null,
      rowsFetchedLastJob: null,
      retryCount: retried,
      pendingBacklogCount: Number(counts.pending_count || 0),
      failedPageCount: Number(counts.failed_count || 0),
      lastHttpStatus: null,
      heartbeatAt: nowIso(),
      nextPlannedAt: null,
      errorMessage: Number(counts.pending_count || 0) > 0 ? "backlog_pending" : null,
    });
  });

  return {
    retried,
    resolved,
    stillFailed,
  };
}

async function runReadOnlyBacklogRetryRound({ job, cfg, endpointKey }) {
  const dueFailures = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `
        SELECT
          id,
          page_number,
          attempts
        FROM sync_failure_backlog
        WHERE tenant_id = $1
          AND endpoint_key = $2
          AND status IN ('pending', 'deferred', 'retrying')
          AND (next_retry_at IS NULL OR next_retry_at <= now())
        ORDER BY last_failed_at ASC
        LIMIT $3
      `,
      [job.tenant_id, endpointKey, BACKLOG_RETRY_BATCH_SIZE]
    );
    return rows;
  });

  if (!dueFailures.length) {
    return { retried: 0, resolved: 0, stillFailed: 0 };
  }

  const { endpointBases, headers } = await getGenericEndpointsAndHeaders({ cfg, endpointKey });
  const compatibleEndpoints = await discoverCompatibleEndpoints({ endpointBases, headers });

  let retried = 0;
  let resolved = 0;
  let stillFailed = 0;

  for (const failure of dueFailures) {
    retried += 1;
    const nextAttempt = Number(failure.attempts || 0) + 1;
    const page = failure.page_number || 1;

    try {
      let parsed = null;
      let lastEndpointError = null;

      for (const endpointBase of compatibleEndpoints) {
        try {
          parsed = await fetchEndpointPage({
            endpointBase,
            page,
            pageSize: PAGE_SIZE,
            headers,
            updatedAfter: null,
          });
          break;
        } catch (error) {
          lastEndpointError = error;
        }
      }

      if (!parsed) {
        throw lastEndpointError || new Error("retry page fetch failed on all endpoints");
      }

      await withTransaction(async (client) => {
        await resolveBacklogFailure(client, {
          backlogId: failure.id,
          jobId: job.id,
        });

        await appendPageLog(client, {
          tenantId: job.tenant_id,
          jobId: job.id,
          endpointKey,
          mode: SYNC_MODES.RETRY_BACKLOG,
          pageNumber: page,
          nextPage: parsed.nextPage,
          status: "retry_success",
          rowsFetched: parsed.rows.length,
          rowsPersisted: 0,
          httpStatus: 200,
          errorMessage: "persist_skipped:no_supported_table",
          retryCount: Math.max(0, nextAttempt - 1),
          startedAt: nowIso(),
          finishedAt: nowIso(),
          attemptNo: nextAttempt,
        });
      });

      resolved += 1;
    } catch (error) {
      const classification = classifyError(error);
      const terminal = !classification.retryable || nextAttempt >= MAX_BACKLOG_ATTEMPTS;
      const nextStatus = terminal ? "failed" : "deferred";
      const nextRetryAt = terminal ? null : computeBacklogRetryAt(classification.kind, nextAttempt);

      await withTransaction(async (client) => {
        await client.query(
          `
            UPDATE sync_failure_backlog
            SET
              failure_kind = $2,
              error_message = $3,
              attempts = $4,
              last_failed_at = now(),
              next_retry_at = $5,
              status = $6,
              last_job_id = $7,
              updated_at = now()
            WHERE id = $1
          `,
          [
            failure.id,
            classification.kind,
            String(error.message || "sync_retry_failed").slice(0, 2000),
            nextAttempt,
            nextRetryAt,
            nextStatus,
            job.id,
          ]
        );

        await appendPageLog(client, {
          tenantId: job.tenant_id,
          jobId: job.id,
          endpointKey,
          mode: SYNC_MODES.RETRY_BACKLOG,
          pageNumber: page,
          nextPage: null,
          status: "retry_failed",
          rowsFetched: 0,
          rowsPersisted: 0,
          httpStatus: classification.status,
          errorMessage: String(error.message || "sync_retry_failed").slice(0, 2000),
          retryCount: Math.max(0, nextAttempt - 1),
          startedAt: nowIso(),
          finishedAt: nowIso(),
          attemptNo: nextAttempt,
        });
      });

      stillFailed += 1;
    }
  }

  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE status IN ('pending', 'deferred', 'retrying'))::int AS pending_count,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count
        FROM sync_failure_backlog
        WHERE tenant_id = $1
          AND endpoint_key = $2
      `,
      [job.tenant_id, endpointKey]
    );
    const counts = rows[0] || { pending_count: 0, failed_count: 0 };
    await markEndpointState(client, {
      tenantId: job.tenant_id,
      endpointKey,
      status: Number(counts.pending_count || 0) > 0 ? "partial" : "success",
      jobId: job.id,
      currentJobId: null,
      currentMode: SYNC_MODES.RETRY_BACKLOG,
      syncStrategy: ENDPOINT_STRATEGY[endpointKey]?.materialized
        ? ENDPOINT_STRATEGY[endpointKey].strategy
        : SYNC_STRATEGIES.NOT_MATERIALIZED,
      lastAttemptAt: nowIso(),
      lastSuccessAt: null,
      lastSuccessfulPage: null,
      lastSuccessfulCursor: null,
      lastSeenRemoteCursor: null,
      updatedAfterWatermark: null,
      rowsFetchedDelta: 0,
      rowsPersistedDelta: 0,
      pagesProcessedLastJob: null,
      rowsFetchedLastJob: null,
      retryCount: retried,
      pendingBacklogCount: Number(counts.pending_count || 0),
      failedPageCount: Number(counts.failed_count || 0),
      lastHttpStatus: null,
      heartbeatAt: nowIso(),
      nextPlannedAt: null,
      errorMessage: Number(counts.pending_count || 0) > 0 ? "backlog_pending" : null,
    });
  });

  return {
    retried,
    resolved,
    stillFailed,
  };
}

async function scheduleDeltaJobs() {
  await withTransaction(async (client) => {
    await client.query(
      `
        INSERT INTO sync_job (tenant_id, type, status, rows_processed, pages_processed)
        SELECT t.id, 'delta', 'queued', 0, 0
        FROM tenant t
        WHERE EXISTS (
          SELECT 1
          FROM tenant_endpoint_selection tes
          WHERE tes.tenant_id = t.id
            AND tes.enabled = true
        )
          AND EXISTS (
            SELECT 1
            FROM sync_job sj_bootstrap
            WHERE sj_bootstrap.tenant_id = t.id
              AND sj_bootstrap.type IN ('bootstrap_initial', 'bootstrap')
              AND sj_bootstrap.status = 'success'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM sync_job sj_active
            WHERE sj_active.tenant_id = t.id
              AND sj_active.type = 'delta'
              AND sj_active.status IN ('queued', 'running')
          )
          AND COALESCE(
            (
              SELECT MAX(sj_done.created_at)
              FROM sync_job sj_done
              WHERE sj_done.tenant_id = t.id
                AND sj_done.type = 'delta'
            ),
            to_timestamp(0)
          ) <= now() - make_interval(secs => $1)
      `,
      [Math.floor(DELTA_INTERVAL_MS / 1000)]
    );
  });
}

async function processSyncJob(job) {
  console.log(`[syncWorker] job picked ${job.id} tenant=${job.tenant_id} type=${job.type}`);
  console.log(`[syncWorker] job started ${job.id}`);

  const tenantClient = await pool.connect();
  let tenantClientReleased = false;
  let rowsProcessed = 0;
  let pagesProcessed = 0;

  try {
    const endpoints = await listEnabledEndpoints(tenantClient, job.tenant_id);
    const executionEndpoints = orderEndpointExecution(endpoints);
    if (executionEndpoints.length === 0) {
      tenantClient.release();
      tenantClientReleased = true;
      await withTransaction(async (client) => {
        await syncJobQueries.markJobSuccess(client, {
          jobId: job.id,
          rowsProcessed: 0,
          pagesProcessed: 0,
        });
      });
      console.log(`[syncWorker] job completed ${job.id} no enabled endpoints`);
      return;
    }

    const cfg = await resolveTenantSyncConfig(tenantClient, job.tenant_id);
    tenantClient.release();
    tenantClientReleased = true;

    const jobMode = modeFromJobType(job.type, SYNC_MODES.DELTA);

    // Backlog is always processed first to avoid hidden restart-from-page-1 behavior.
    for (const endpointKey of executionEndpoints) {
      if (endpointKey === "projects") {
        for (const projectEndpointKey of ["projects_v4", "projects_v3"]) {
          const retryRound = await runProjectsBacklogRetryRound({ job, cfg, endpointKey: projectEndpointKey });
          console.log(
            `[syncWorker] retry round job=${job.id} endpoint=${projectEndpointKey} retried=${retryRound.retried} resolved=${retryRound.resolved} stillFailed=${retryRound.stillFailed}`
          );
        }
        continue;
      }

      if (READ_ONLY_ENDPOINT_KEYS.has(endpointKey)) {
        const retryRound = await runReadOnlyBacklogRetryRound({ job, cfg, endpointKey });
        console.log(
          `[syncWorker] retry round job=${job.id} endpoint=${endpointKey} retried=${retryRound.retried} resolved=${retryRound.resolved} stillFailed=${retryRound.stillFailed}`
        );
      }
    }

    if (jobMode === SYNC_MODES.RETRY_BACKLOG) {
      await withTransaction(async (client) => {
        await syncJobQueries.markJobSuccess(client, {
          jobId: job.id,
          rowsProcessed,
          pagesProcessed,
        });
      });
      console.log(`[syncWorker] job completed ${job.id} mode=${jobMode} rows=${rowsProcessed} pages=${pagesProcessed}`);
      return;
    }

    for (const endpointKey of executionEndpoints) {
      if (endpointKey === "projects") {
        const result = await runProjectsEndpoint({
          job,
          cfg,
          mode: jobMode,
        });

        rowsProcessed += result.rowsProcessed;
        pagesProcessed += result.pagesProcessed;
        continue;
      }

      if (READ_ONLY_ENDPOINT_KEYS.has(endpointKey)) {
        const strategyMeta = ENDPOINT_STRATEGY[endpointKey] || {
          supportsDelta: false,
          strategy: SYNC_STRATEGIES.RECONCILE_SCAN,
        };
        const endpointMode = jobMode === SYNC_MODES.DELTA && !strategyMeta.supportsDelta
          ? SYNC_MODES.SLOW_RECONCILIATION
          : jobMode;

        const cutoffContext = endpointKey === "fitterhours"
          ? await withTransaction(async (client) => computeFitterhoursCutoff(client, job.tenant_id))
          : null;

        if (cutoffContext && cutoffContext.cutoffIso) {
          console.log(
            `[syncWorker] endpoint=fitterhours cutoff=${cutoffContext.cutoffIso} baseline=${cutoffContext.baselineIso} startDateColumn=${cutoffContext.projectStartDateColumn || "none"} activeProjects=${cutoffContext.activeProjectCount} oldestActiveStart=${cutoffContext.oldestActiveProjectStartDate || "null"} olderThanBaseline=${cutoffContext.olderThanBaselineCount == null ? "unknown" : cutoffContext.olderThanBaselineCount}`
          );
        }

        const result = await runReadOnlyEndpoint({
          job,
          cfg,
          endpointKey,
          mode: endpointMode,
          cutoffContext,
        });

        rowsProcessed += result.rowsProcessed;
        pagesProcessed += result.pagesProcessed;
        continue;
      }

      await withTransaction(async (client) => {
        await markEndpointState(client, {
          tenantId: job.tenant_id,
          endpointKey,
          status: "partial",
          jobId: job.id,
          currentJobId: null,
          currentMode: jobMode,
          syncStrategy: SYNC_STRATEGIES.NOT_MATERIALIZED,
          lastAttemptAt: nowIso(),
          lastSuccessAt: null,
          lastSuccessfulPage: null,
          lastSuccessfulCursor: null,
          lastSeenRemoteCursor: null,
          updatedAfterWatermark: null,
          rowsFetchedDelta: 0,
          rowsPersistedDelta: 0,
          pagesProcessedLastJob: 0,
          rowsFetchedLastJob: 0,
          retryCount: 0,
          pendingBacklogCount: 0,
          failedPageCount: 0,
          lastHttpStatus: null,
          heartbeatAt: nowIso(),
          nextPlannedAt: null,
          errorMessage: `endpoint_unsupported:${endpointKey}`,
        });
      });
    }

    await withTransaction(async (client) => {
      await syncJobQueries.markJobSuccess(client, {
        jobId: job.id,
        rowsProcessed,
        pagesProcessed,
      });
    });

    console.log(`[syncWorker] job completed ${job.id} rows=${rowsProcessed} pages=${pagesProcessed}`);
  } catch (error) {
    try {
      if (tenantClientReleased) {
        throw new Error("already-released");
      }
      tenantClient.release();
    } catch (_releaseError) {
      // no-op
    }

    const nextRetryCount = (job.retry_count || 0) + 1;
    const exceeded = nextRetryCount >= MAX_JOB_RETRIES;
    const nextStatus = exceeded ? "failed" : "queued";
    const retryAt = exceeded ? null : new Date(Date.now() + computeRetryBackoffMs(nextRetryCount));

    await withTransaction(async (client) => {
      await syncJobQueries.markJobFailure(client, {
        jobId: job.id,
        errorMessage: String(error.message || "sync worker failure").slice(0, 2000),
        nextStatus,
        nextRetryAt: retryAt,
        nextRetryCount,
      });
    });

    console.error(`[syncWorker] job failed ${job.id} retry=${nextRetryCount}/${MAX_JOB_RETRIES} ${error.message}`);
  }
}

async function pollOnce() {
  if (tickInFlight) return;
  tickInFlight = true;

  try {
    await scheduleDeltaJobs();
    const job = await withTransaction(async (client) => syncJobQueries.claimNextSyncJob(client));
    if (!job) {
      return;
    }

    await processSyncJob(job);
  } catch (error) {
    console.error(`[syncWorker] poll error ${error.message}`);
  } finally {
    tickInFlight = false;
  }
}

function startSyncWorker() {
  if (started || env.NODE_ENV === "test") {
    return;
  }

  started = true;
  timer = setInterval(() => {
    pollOnce().catch((error) => {
      console.error(`[syncWorker] unhandled poll error ${error.message}`);
    });
  }, POLL_INTERVAL_MS);

  pollOnce().catch((error) => {
    console.error(`[syncWorker] initial poll error ${error.message}`);
  });

  console.log(`[syncWorker] started interval=${POLL_INTERVAL_MS}ms`);
}

function stopSyncWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
}

module.exports = {
  startSyncWorker,
  stopSyncWorker,
};
