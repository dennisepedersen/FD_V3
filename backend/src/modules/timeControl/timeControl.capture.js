"use strict";

const pool = require("../../db/pool");
const ekRefresh = require("../../services/fitterhoursRefreshService");
const coverage = require("./timeControl.coverage");

const ENDPOINT = "/api/v4/paginatedfitterhours";
const PAGE_SIZE = 10;
const MAX_PAGES_PER_PASS = 1000;
const MAX_PAGE_CALLS_PER_DAY = 2000;
const MAX_ATTEMPTS_PER_REQUEST = 3;
const CAPTURE_DEADLINE_MS = 120000;
const MAX_REQUEST_TIMEOUT_MS = 15000;
const CONTRACT_REFERENCE = "backend/docs/integrations/ek/fitterhours.md#Timekontrol-Period-Coverage";

async function traceStep(trace, step, status, counts = {}, errorCode = null) {
  if (trace === null) return;
  try { await trace(step, status, counts, errorCode); }
  catch (cause) {
    const error = new Error("time_control_trace_failed", { cause });
    error.code = "time_control_trace_failed";
    throw error;
  }
}

function reject(reason) {
  throw new Error(`time_control_capture_invalid:${reason}`);
}

function asDate(value, name) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) reject(`${name}_shape`);
  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) reject(`${name}_value`);
  return value;
}

function numberId(value, name, nullable = false) {
  if (nullable && value == null) return null;
  const number = typeof value === "number" ? value
    : typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < (nullable ? 0 : 1)) reject(`row_${name}`);
  return number;
}

function projectRow(row, day) {
  if (!row || typeof row !== "object" || Array.isArray(row)) reject("row_shape");
  if (typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}T00:00:00$/.test(row.date) ||
      row.date.slice(0, 10) !== day) reject("row_date");
  if (typeof row.hours !== "number" || !Number.isFinite(row.hours)) reject("row_hours");
  if (row.categoryReference != null && typeof row.categoryReference !== "string") reject("row_category_reference");
  if (row.projectReference != null && typeof row.projectReference !== "string") reject("row_project_reference");
  return {
    id: String(numberId(row.id, "id")),
    date: row.date,
    hours: row.hours,
    fitterId: numberId(row.fitterID, "fitter_id"),
    categoryId: numberId(row.categoryID, "category_id", true),
    categoryReference: row.categoryReference ?? null,
    projectId: numberId(row.projectID, "project_id"),
    projectReference: row.projectReference ?? null,
  };
}

function emptyObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
}

function parseEnvelope(payload, { page, day }) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      payload.hasErrors !== false || !payload.data || typeof payload.data !== "object" ||
      Array.isArray(payload.data) || !Array.isArray(payload.data.data)) reject("v4_envelope");
  const container = payload.data;
  if ((container.hasErrors != null && container.hasErrors !== false) ||
      (container.errorCount != null && container.errorCount !== 0) ||
      container.data.some((row) => !row || typeof row !== "object")) {
    reject("v4_api_errors");
  }
  if (payload.errorMessage != null && String(payload.errorMessage).trim() !== "") reject("v4_api_errors");
  if (payload.validationErrors != null &&
      (!Array.isArray(payload.validationErrors) || payload.validationErrors.length !== 0)) reject("v4_api_errors");
  if (payload.modelStateErrors != null && !emptyObject(payload.modelStateErrors)) reject("v4_api_errors");
  if (payload.errors != null &&
      (!Array.isArray(payload.errors) || payload.errors.length !== 0)) reject("v4_api_errors");
  if (payload.errorCount != null && payload.errorCount !== 0) reject("v4_api_errors");
  if (!Number.isInteger(container.total) || container.total < 0 ||
      !Number.isInteger(container.currentPage) || container.currentPage < 0 ||
      !(container.nextPage === null || (Number.isInteger(container.nextPage) && container.nextPage > 0))) {
    reject("v4_pagination_shape");
  }

  const rows = container.data.map((row) => projectRow(row, day));
  if (container.total === 0 || rows.length === 0) reject("unverified_zero_day_contract");
  if (container.currentPage !== page) reject("page_progression");
  if (rows.length > PAGE_SIZE) reject("page_size_exceeded");
  const terminal = container.nextPage === null;
  if (!terminal && (container.nextPage !== page + 1 || rows.length !== PAGE_SIZE)) {
    reject("page_progression");
  }
  return {
    rows,
    currentPage: container.currentPage,
    nextPage: container.nextPage,
    total: container.total,
    status: 200,
    hasErrors: false,
    errorCount: 0,
  };
}

function parseRetryAfter(value, nowMs) {
  if (value == null || String(value).trim() === "") return null;
  const text = String(value).trim();
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const dateMs = Date.parse(text);
  if (!Number.isFinite(dateMs)) return null;
  return Math.max(0, dateMs - nowMs);
}

function requestUrl(baseUrl, { fromDate, toDate, page }) {
  let base;
  try {
    base = new URL(String(baseUrl).trim());
  } catch (_error) {
    reject("tenant_ek_config");
  }
  if (!/^https?:$/.test(base.protocol)) reject("tenant_ek_config");
  base.pathname = `${base.pathname.replace(/\/+$/, "")}${ENDPOINT}`;
  base.search = new URLSearchParams({
    fromDate, toDate, page: String(page), pageSize: String(PAGE_SIZE),
  }).toString();
  base.hash = "";
  return base.toString();
}

function normalizeConfig(config) {
  if (!config || typeof config !== "object" ||
      typeof config.tenantId !== "string" ||
      typeof config.ekBaseUrl !== "string" || !config.ekBaseUrl.trim() ||
      typeof config.ekApiKey !== "string" || !config.ekApiKey.trim() ||
      typeof config.siteName !== "string" || !config.siteName.trim()) reject("tenant_ek_config");
  return config;
}

function currentTimeMs(now) {
  const value = now();
  const milliseconds = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(milliseconds)) reject("capture_clock");
  return milliseconds;
}

function awaitBeforeDeadline(promise, deadlineAt, { onLateResolve, onTimeout } = {}) {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) {
    Promise.resolve(promise).then((value) => onLateResolve?.(value), () => {});
    const error = new Error("capture_deadline_exceeded");
    error.captureDeadline = true;
    return Promise.reject(error);
  }

  let timedOut = false;
  let timer;
  const observed = Promise.resolve(promise).then((value) => {
    if (timedOut) onLateResolve?.(value);
    return value;
  });
  const timeout = new Promise((_resolve, rejectPromise) => {
    timer = setTimeout(() => {
      timedOut = true;
      const error = new Error("capture_deadline_exceeded");
      error.captureDeadline = true;
      try {
        onTimeout?.(error);
      } catch (_error) {
        error.cleanupFailed = true;
      }
      rejectPromise(error);
    }, remainingMs);
  });
  return Promise.race([observed, timeout]).finally(() => clearTimeout(timer));
}

async function makePageFetcher({ config, fetchImpl, now, sleep, startedMs, deadlineMs, trace }) {
  let logicalPageCalls = 0;
  let pass = 0;
  return async function fetchPage({ fromDate, toDate, page }) {
    if (logicalPageCalls >= MAX_PAGE_CALLS_PER_DAY) reject("page_call_limit");
    logicalPageCalls += 1;
    if (page === 1) pass++;
    const url = requestUrl(config.ekBaseUrl, { fromDate, toDate, page });
    const safeAttempts = [];
    const rows = [];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_REQUEST; attempt += 1) {
      const requestCounts = { controlled_date: fromDate, pass, page, attempt };
      await traceStep(trace, "capture_page", "started", requestCounts);
      const before = currentTimeMs(now);
      const remainingMs = deadlineMs - (before - startedMs);
      if (remainingMs <= 0) reject("deadline_exceeded");
      const requestTimeoutMs = Math.max(1, Math.min(MAX_REQUEST_TIMEOUT_MS, remainingMs));
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      let response;
      try {
        response = await fetchImpl(url, {
          method: "GET",
          redirect: "error",
          headers: {
            apikey: config.ekApiKey,
            siteName: config.siteName,
            Accept: "application/json",
          },
          signal: controller.signal,
        });
      } catch (_error) {
        clearTimeout(timeout);
        const durationMs = Math.max(0, currentTimeMs(now) - before);
        safeAttempts.push({ attempt, outcome: "transport_error", durationMs, requestTimeoutMs });
        await traceStep(trace, "capture_page", "failed", { ...requestCounts, duration_ms: durationMs,
          requestTimeoutMs }, "time_control_capture_transport_error");
        if (attempt === MAX_ATTEMPTS_PER_REQUEST) reject("request_failed");
        const waitMs = attempt * 1000;
        if (waitMs >= deadlineMs - (currentTimeMs(now) - startedMs)) reject("deadline_exceeded_retry");
        await sleep(waitMs);
        continue;
      }
      const responseReceivedMs = currentTimeMs(now);
      const durationMs = Math.max(0, responseReceivedMs - before);
      const status = Number(response?.status);
      if (!Number.isInteger(status)) {
        clearTimeout(timeout);
        await traceStep(trace, "capture_page", "failed", requestCounts, "time_control_capture_http_response_invalid");
        reject("http_response");
      }
      if (status === 429 || status >= 500 && status <= 599) {
        clearTimeout(timeout);
        const retryAfterHeader = response.headers?.get?.("retry-after") ?? null;
        const retryAfterMs = status === 429 ? parseRetryAfter(retryAfterHeader, responseReceivedMs) : null;
        const waitMs = retryAfterMs ?? attempt * 1200;
        safeAttempts.push({
          attempt, status, outcome: "retryable_http", durationMs,
          retryAfterMs, waitMs, requestTimeoutMs,
        });
        await traceStep(trace, "capture_page", "failed", { ...requestCounts, http_status: status,
          duration_ms: durationMs, waitMs, requestTimeoutMs },
        status === 429 ? "time_control_capture_rate_limited" : "time_control_capture_retryable_http");
        if (attempt === MAX_ATTEMPTS_PER_REQUEST) reject("request_attempt_limit");
        const remaining = deadlineMs - (currentTimeMs(now) - startedMs);
        if (waitMs >= remaining) reject(status === 429 ? "deadline_exceeded_retry_after" : "deadline_exceeded_retry");
        await sleep(waitMs);
        continue;
      }
      if (status < 200 || status >= 300 || response.ok === false) {
        clearTimeout(timeout);
        safeAttempts.push({ attempt, status, outcome: "http_error", durationMs, requestTimeoutMs });
        await traceStep(trace, "capture_page", "failed", { ...requestCounts, http_status: status,
          duration_ms: durationMs }, "time_control_capture_http_error");
        reject("http_error");
      }
      let payload;
      try {
        const bodyText = await response.text();
        payload = JSON.parse(bodyText);
      } catch (_error) {
        clearTimeout(timeout);
        safeAttempts.push({ attempt, status, outcome: "invalid_json", durationMs, requestTimeoutMs });
        await traceStep(trace, "capture_page", "failed", { ...requestCounts, http_status: status,
          duration_ms: durationMs }, "time_control_capture_invalid_json");
        reject("invalid_json");
      }
      clearTimeout(timeout);
      const completedMs = currentTimeMs(now);
      let parsed;
      try { parsed = parseEnvelope(payload, { page, day: fromDate }); }
      catch (error) {
        await traceStep(trace, "capture_page", "failed", { ...requestCounts, http_status: status,
          duration_ms: Math.max(0, completedMs - before) }, error.message);
        throw error;
      }
      safeAttempts.push({ attempt, status, outcome: "success", durationMs, requestTimeoutMs });
      parsed.attempts = safeAttempts;
      parsed.requestStartedAt = new Date(before).toISOString();
      parsed.requestCompletedAt = new Date(completedMs).toISOString();
      await traceStep(trace, "capture_page", "completed", { ...requestCounts, http_status: status,
        row_count: parsed.rows.length, duration_ms: Math.max(0, completedMs - before), requestTimeoutMs });
      if (currentTimeMs(now) - startedMs >= deadlineMs) reject("deadline_exceeded");
      return parsed;
    }
    reject("request_attempt_limit");
  };
}

async function captureDay({ tenantId, controlledDate, testDependencies = null, trace = null } = {}) {
  if (trace !== null && typeof trace !== "function") throw new Error("time_control_trace_invalid");
  if (typeof tenantId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
    reject("tenant");
  }
  const day = asDate(controlledDate, "controlled_date");
  if (testDependencies != null && process.env.NODE_ENV !== "test") reject("test_dependencies_not_allowed");

  const dependencies = testDependencies || {};
  const deadlineMs = dependencies.deadlineMs ?? CAPTURE_DEADLINE_MS;
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0 || deadlineMs > CAPTURE_DEADLINE_MS) {
    reject("capture_deadline_config");
  }
  const now = dependencies.now || Date.now;
  const sleep = dependencies.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function" || typeof sleep !== "function" || typeof now !== "function") {
    reject("capture_dependencies");
  }
  const startedMs = currentTimeMs(now);
  const wallDeadlineAt = Date.now() + deadlineMs;
  let client = dependencies.client || null;
  let ownsClient = false;
  if (!client) {
    const dbPool = dependencies.pool || pool;
    try {
      client = await awaitBeforeDeadline(Promise.resolve().then(() => dbPool.connect()), wallDeadlineAt, {
        onLateResolve: (lateClient) => lateClient?.release?.(),
      });
      ownsClient = true;
    } catch (_error) {
      if (_error?.captureDeadline) reject("deadline_exceeded");
      reject("tenant_config_unavailable");
    }
  }

  try {
    const resolveConfig = dependencies.resolveTenantConfig || ekRefresh.resolveTenantConfig;
    let config;
    try {
      const configPromise = Promise.resolve().then(() => resolveConfig(client, { tenant: tenantId }));
      config = normalizeConfig(await awaitBeforeDeadline(configPromise, wallDeadlineAt, {
        onTimeout: (error) => {
          if (!ownsClient) return;
          ownsClient = false;
          client.release(error);
        },
      }));
      if (config.tenantId.toLowerCase() !== tenantId.toLowerCase()) reject("tenant_config_scope");
    } catch (error) {
      if (error?.captureDeadline) reject("deadline_exceeded");
      reject("tenant_config_unavailable");
    }
    // Configuration is resolved before HTTP; do not hold a second pooled client during independent trace writes.
    if (ownsClient) {
      ownsClient = false;
      client.release();
    }
    if (currentTimeMs(now) - startedMs >= CAPTURE_DEADLINE_MS) reject("deadline_exceeded");

    const fetchPage = await makePageFetcher({
      config, fetchImpl, now, sleep, startedMs, deadlineMs, trace,
    });
    const captureOptions = {
      tenantId,
      controlledDate: day,
      pageSize: PAGE_SIZE,
      fetchPage,
      evidence: {
        endpointContract: {
          version: "ek_v4_all_projects_single_day_two_pass_v3",
          endpoint: ENDPOINT,
          scope: "tenant_all_projects",
          requestParameters: { fromDate: day, toDate: day, pageSize: PAGE_SIZE },
          verificationReference: CONTRACT_REFERENCE,
        },
      },
    };
    if (dependencies.now) {
      captureOptions.now = () => new Date(currentTimeMs(now));
    }
    return await coverage.captureHoursDataset(captureOptions);
  } catch (error) {
    if (error?.code === "time_control_trace_failed") throw error;
    if (error instanceof Error && error.message.startsWith("time_control_capture_invalid:")) throw error;
    if (error instanceof Error && error.message.startsWith("time_control_coverage_invalid:")) {
      reject(error.message.slice("time_control_coverage_invalid:".length));
    }
    reject("capture_failed");
  } finally {
    if (ownsClient) client.release();
  }
}

module.exports = {
  captureDay,
  _constants: Object.freeze({
    ENDPOINT, PAGE_SIZE, MAX_PAGES_PER_PASS, MAX_PAGE_CALLS_PER_DAY,
    MAX_ATTEMPTS_PER_REQUEST, CAPTURE_DEADLINE_MS, MAX_REQUEST_TIMEOUT_MS,
  }),
};
