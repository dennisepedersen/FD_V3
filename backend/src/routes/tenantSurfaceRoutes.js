const express = require("express");
const path = require("path");
const pool = require("../db/pool");
const requireTenantHost = require("../middleware/requireTenantHost");
const requireAuth = require("../middleware/requireAuth");
const userQueries = require("../db/queries/user");
const projectQueries = require("../db/queries/project");
const { createHttpError } = require("../middleware/errorHandler");

const router = express.Router();
const tenantPublicDir = path.join(__dirname, "../public/tenant");

function hasAccessContextMismatch(req) {
  if (!req.auth || !req.context || !req.context.tenant) {
    return true;
  }

  return String(req.auth.tenant_id) !== String(req.context.tenant.id);
}

router.get("/login", requireTenantHost, (req, res) => {
  res.sendFile(path.join(tenantPublicDir, "login.html"));
});

router.get("/app", requireTenantHost, (req, res) => {
  res.sendFile(path.join(tenantPublicDir, "app.html"));
});

router.get("/project/:projectId", requireTenantHost, (req, res) => {
  res.sendFile(path.join(tenantPublicDir, "project.html"));
});

router.get("/tenant/auth.js", requireTenantHost, (req, res) => {
  res.sendFile(path.join(tenantPublicDir, "auth.js"));
});

router.get("/api/me", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  if (hasAccessContextMismatch(req)) {
    return next(createHttpError(403, "tenant_context_mismatch"));
  }

  const client = await pool.connect();
  try {
    const user = await userQueries.findTenantUserById(client, {
      tenantId: req.context.tenant.id,
      userId: req.auth.sub,
    });

    if (!user || user.status !== "active") {
      throw createHttpError(404, "tenant_user_not_found");
    }

    res.status(200).json({
      success: true,
      user: {
        id: user.id,
        tenant_id: user.tenant_id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
      },
      tenant: {
        id: req.context.tenant.id,
        slug: req.context.tenant.slug,
        name: req.context.tenant.name,
        domain: req.context.tenant.domain,
      },
    });
  } catch (error) {
    console.error("[tenantSurfaceRoutes] request_failed", {
      route: "/api/me",
      scope: null,
      tenant_id: req.context?.tenant?.id || req.auth?.tenant_id || null,
      user_id: req.auth?.sub || null,
      role: req.auth?.role || null,
      error_message: error?.message || null,
      error_stack: error?.stack || null,
    });
    next(error);
  } finally {
    client.release();
  }
});

router.get("/api/projects", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  if (hasAccessContextMismatch(req)) {
    return next(createHttpError(403, "tenant_context_mismatch"));
  }

  if ((req.query.scope || "mine") !== "mine") {
    return next(createHttpError(400, "unsupported_project_scope"));
  }

  const client = await pool.connect();
  try {
    const projects = await projectQueries.listProjectsForUser(client, {
      tenantId: req.context.tenant.id,
      userId: req.auth.sub,
    });

    res.status(200).json({
      success: true,
      scope: "mine",
      projects,
    });
  } catch (error) {
    console.error("[tenantSurfaceRoutes] request_failed", {
      route: "/api/projects",
      scope: req.query?.scope || "mine",
      tenant_id: req.context?.tenant?.id || req.auth?.tenant_id || null,
      user_id: req.auth?.sub || null,
      role: req.auth?.role || null,
      error_message: error?.message || null,
      error_stack: error?.stack || null,
    });
    next(error);
  } finally {
    client.release();
  }
});

router.get("/api/sync/status", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  if (hasAccessContextMismatch(req)) {
    return next(createHttpError(403, "tenant_context_mismatch"));
  }

  const client = await pool.connect();
  try {
    const tenantId = req.context.tenant.id;

    const [latestJobs, endpointStates, backlogStats] = await Promise.all([
      client.query(
        `
          SELECT id, type, status, started_at, finished_at, updated_at, rows_processed, pages_processed, retry_count, error_message
          FROM sync_job
          WHERE tenant_id = $1
            AND type IN ('bootstrap', 'delta')
          ORDER BY created_at DESC
          LIMIT 20
        `,
        [tenantId]
      ),
      client.query(
        `
          WITH backlog_by_endpoint AS (
            SELECT
              endpoint_key,
              COUNT(*) FILTER (WHERE status IN ('pending', 'deferred', 'retrying')) AS pending_backlog,
              COUNT(*) FILTER (WHERE status = 'failed') AS failed_backlog,
              MIN(next_retry_at) FILTER (WHERE status IN ('pending', 'deferred', 'retrying')) AS next_retry_at
            FROM sync_failure_backlog
            WHERE tenant_id = $1
            GROUP BY endpoint_key
          ),
          page_totals AS (
            SELECT
              endpoint_key,
              COUNT(*) FILTER (WHERE status IN ('success', 'retry_success')) AS pages_processed,
              COALESCE(SUM(rows_fetched), 0) FILTER (WHERE status IN ('success', 'retry_success')) AS rows_fetched,
              COALESCE(SUM(rows_persisted), 0) FILTER (WHERE status IN ('success', 'retry_success')) AS rows_persisted
            FROM sync_page_log
            WHERE tenant_id = $1
            GROUP BY endpoint_key
          ),
          page_last_job AS (
            SELECT
              job_id,
              endpoint_key,
              COUNT(*) FILTER (WHERE status IN ('success', 'retry_success')) AS pages_processed_last_job,
              COALESCE(SUM(rows_fetched), 0) FILTER (WHERE status IN ('success', 'retry_success')) AS rows_fetched_last_job,
              COALESCE(SUM(rows_persisted), 0) FILTER (WHERE status IN ('success', 'retry_success')) AS rows_persisted_last_job
            FROM sync_page_log
            WHERE tenant_id = $1
            GROUP BY job_id, endpoint_key
          )
          SELECT
            ses.endpoint_key,
            ses.status,
            sj.type AS sync_type,
            ses.last_attempt_at,
            ses.last_successful_sync_at,
            ses.last_successful_page,
            ses.last_successful_cursor,
            ses.updated_after_watermark,
            ses.rows_fetched,
            ses.rows_persisted,
            ses.next_planned_at,
            ses.last_error,
            ses.updated_at,
            COALESCE(pt.pages_processed, 0) AS pages_processed,
            COALESCE(pt.rows_fetched, 0) AS rows_fetched_logged,
            COALESCE(pt.rows_persisted, 0) AS rows_persisted_logged,
            COALESCE(plj.pages_processed_last_job, 0) AS pages_processed_last_job,
            COALESCE(plj.rows_fetched_last_job, 0) AS rows_fetched_last_job,
            COALESCE(plj.rows_persisted_last_job, 0) AS rows_persisted_last_job,
            COALESCE(be.pending_backlog, 0) AS pending_backlog,
            COALESCE(be.failed_backlog, 0) AS failed_backlog,
            be.next_retry_at
          FROM sync_endpoint_state ses
          LEFT JOIN sync_job sj ON sj.id = ses.last_job_id
          LEFT JOIN page_totals pt ON pt.endpoint_key = ses.endpoint_key
          LEFT JOIN page_last_job plj ON plj.endpoint_key = ses.endpoint_key AND plj.job_id = ses.last_job_id
          LEFT JOIN backlog_by_endpoint be ON be.endpoint_key = ses.endpoint_key
          WHERE ses.tenant_id = $1
          ORDER BY ses.endpoint_key ASC
        `,
        [tenantId]
      ),
      client.query(
        `
          SELECT
            COUNT(*) FILTER (WHERE status IN ('pending', 'deferred', 'retrying')) AS pending_count,
            COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
            MIN(next_retry_at) FILTER (WHERE status IN ('pending', 'deferred', 'retrying')) AS next_retry_at
          FROM sync_failure_backlog
          WHERE tenant_id = $1
        `,
        [tenantId]
      ),
    ]);

    const jobs = latestJobs.rows;
    const latestBootstrap = jobs.find((job) => job.type === "bootstrap") || null;
    const latestDelta = jobs.find((job) => job.type === "delta") || null;
    const backlog = backlogStats.rows[0] || {
      pending_count: "0",
      failed_count: "0",
      next_retry_at: null,
    };

    res.status(200).json({
      success: true,
      tenant_id: tenantId,
      bootstrap: latestBootstrap,
      delta: latestDelta,
      endpoint_states: endpointStates.rows,
      backlog: {
        pending_count: Number(backlog.pending_count || 0),
        failed_count: Number(backlog.failed_count || 0),
        next_retry_at: backlog.next_retry_at || null,
      },
    });
  } catch (error) {
    next(error);
  } finally {
    client.release();
  }
});

router.get("/api/projects/:projectId", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  if (hasAccessContextMismatch(req)) {
    return next(createHttpError(403, "tenant_context_mismatch"));
  }

  const projectId = String(req.params.projectId || "").trim();
  if (!projectId) {
    return next(createHttpError(400, "project_id_required"));
  }

  const client = await pool.connect();
  try {
    const project = await projectQueries.findProjectForUser(client, {
      tenantId: req.context.tenant.id,
      userId: req.auth.sub,
      projectId,
    });

    if (!project) {
      return next(createHttpError(404, "project_not_found"));
    }

    res.status(200).json({
      success: true,
      project,
    });
  } catch (error) {
    next(error);
  } finally {
    client.release();
  }
});

module.exports = router;
