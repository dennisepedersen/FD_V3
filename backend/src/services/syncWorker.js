const crypto = require("crypto");
const pool = require("../db/pool");
const { withTransaction } = require("../db/tx");
const syncJobQueries = require("../db/queries/syncJob");
const env = require("../config/env");

const POLL_INTERVAL_MS = 12_000;
const PAGE_SIZE = 200;
const MAX_JOB_RETRIES = 3;
const HTTP_RETRY_COUNT = 3;

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
  if (isClosedHint === false && !rawStatus) return "open";
  const value = String(rawStatus || "").trim().toLowerCase();
  if (!value) return "open";
  if (/(archiv|deleted|slettet)/.test(value)) return "archived";
  if (/(closed|complete|done|afsluttet|lukket)/.test(value)) return "closed";
  return "open";
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

function mapProjectRow(raw) {
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

  const isClosed = pickBooleanValue(raw, ["isClosed", "IsClosed"]);

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
    status: mapProjectStatus(statusRaw, isClosed),
    isClosed,
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

async function upsertProjectBatch(client, { tenantId, mappedRows }) {
  if (!mappedRows.length) return;

  const values = [];
  const params = [];
  mappedRows.forEach((row, index) => {
    const offset = index * 12;
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
      row.teamLeaderId
    );
    values.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12})`
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
      team_leader_id
    )
    VALUES ${values.join(",\n")}
    ON CONFLICT (tenant_id, external_project_ref)
    WHERE external_project_ref IS NOT NULL
    DO UPDATE SET
      name = EXCLUDED.name,
      status = EXCLUDED.status,
      activity_date = COALESCE(EXCLUDED.activity_date, project_core.activity_date),
      is_closed = COALESCE(EXCLUDED.is_closed, project_core.is_closed),
      responsible_code = EXCLUDED.responsible_code,
      responsible_name = EXCLUDED.responsible_name,
      responsible_id = EXCLUDED.responsible_id,
      team_leader_code = EXCLUDED.team_leader_code,
      team_leader_name = EXCLUDED.team_leader_name,
      team_leader_id = EXCLUDED.team_leader_id,
      updated_at = now()
  `;

  await client.query(sql, params);
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

async function isProjectsSyncEnabled(client, tenantId) {
  const { rows } = await client.query(
    `
      SELECT 1
      FROM tenant_endpoint_selection
      WHERE tenant_id = $1
        AND endpoint_key = 'projects'
        AND enabled = true
      LIMIT 1
    `,
    [tenantId]
  );
  return rows.length > 0;
}

async function fetchAllProjects({ ekBaseUrl, ekApiKey, siteName, onPage }) {
  const endpointVariants = buildProjectEndpointVariants(ekBaseUrl);
  const headers = {
    apikey: ekApiKey,
    siteName,
    Accept: "application/json",
  };

  let page = 1;
  let totalRows = 0;
  let pagesFetched = 0;
  let successfulEndpoints = 0;
  let lastError = null;

  for (const endpoint of endpointVariants) {
    const url = `${endpoint}?page=1&pageSize=${PAGE_SIZE}`;
    try {
      const payload = await fetchJsonWithRetry(url, { headers });
      const first = parsePagedPayload(payload);
      successfulEndpoints += 1;
      page = 1;

      const mappedFirst = first.rows.map(mapProjectRow).filter(Boolean);
      totalRows += mappedFirst.length;
      pagesFetched += 1;
      await onPage({ page, rows: mappedFirst, totalRows, pagesFetched, endpoint, headers });

      let nextPage = first.nextPage;
      while (nextPage != null) {
        page = Number(nextPage);
        const pageUrl = `${endpoint}?page=${page}&pageSize=${PAGE_SIZE}`;
        const pagePayload = await fetchJsonWithRetry(pageUrl, { headers });
        const parsed = parsePagedPayload(pagePayload);
        const mapped = parsed.rows.map(mapProjectRow).filter(Boolean);

        totalRows += mapped.length;
        pagesFetched += 1;
        await onPage({ page, rows: mapped, totalRows, pagesFetched, endpoint, headers });

        if (parsed.nextPage == null || Number(parsed.nextPage) === page) {
          nextPage = null;
        } else {
          nextPage = Number(parsed.nextPage);
        }
      }
    } catch (error) {
      lastError = error;
      if (/\(404\)|\(400\)/.test(String(error.message || ""))) {
        console.log(`[syncWorker] endpoint skipped ${endpoint} ${error.message}`);
        continue;
      }
      console.error(`[syncWorker] endpoint failed ${endpoint} ${error.message}`);
      continue;
    }
  }

  if (successfulEndpoints === 0) {
    throw lastError || new Error("No compatible E-Komplet /projects endpoint found");
  }

  return { totalRows, pagesFetched, endpointCount: successfulEndpoints };
}

function computeRetryBackoffMs(retryCount) {
  const baseMs = 15_000;
  return baseMs * Math.pow(2, Math.max(0, retryCount - 1));
}

async function processBootstrapJob(job) {
  console.log(`[syncWorker] job picked ${job.id} tenant=${job.tenant_id}`);
  console.log(`[syncWorker] job started ${job.id}`);

  const tenantClient = await pool.connect();
  let tenantClientReleased = false;
  let rowsProcessed = 0;
  let pagesProcessed = 0;

  try {
    const projectsEnabled = await isProjectsSyncEnabled(tenantClient, job.tenant_id);
    if (!projectsEnabled) {
      tenantClient.release();
      tenantClientReleased = true;
      await withTransaction(async (client) => {
        await syncJobQueries.markJobSuccess(client, {
          jobId: job.id,
          rowsProcessed: 0,
          pagesProcessed: 0,
        });
      });
      console.log(`[syncWorker] job completed ${job.id} projects endpoint not enabled`);
      return;
    }

    const cfg = await resolveTenantSyncConfig(tenantClient, job.tenant_id);
    tenantClient.release();
    tenantClientReleased = true;

    await fetchAllProjects({
      ekBaseUrl: cfg.ekBaseUrl,
      ekApiKey: cfg.ekApiKey,
      siteName: cfg.siteName,
      onPage: async ({ page, rows, totalRows, pagesFetched, endpoint, headers }) => {
        const enriched = await enrichProjectIdentityFields({
          ekBaseUrl: cfg.ekBaseUrl,
          headers,
          rows,
        });

        await withTransaction(async (client) => {
          await upsertProjectBatch(client, {
            tenantId: job.tenant_id,
            mappedRows: enriched.rows,
          });

          rowsProcessed = totalRows;
          pagesProcessed = pagesFetched;
          await syncJobQueries.markJobProgress(client, {
            jobId: job.id,
            rowsProcessed,
            pagesProcessed,
          });
        });

        console.log(
          `[syncWorker] page persisted job=${job.id} endpoint=${endpoint} page=${page} totalRows=${rowsProcessed} enriched=${enriched.enrichedCount}`
        );
      },
    });

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
    const job = await withTransaction(async (client) => syncJobQueries.claimNextBootstrapJob(client));
    if (!job) {
      return;
    }

    await processBootstrapJob(job);
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
