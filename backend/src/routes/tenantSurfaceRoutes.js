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
    next(error);
  } finally {
    client.release();
  }
});

module.exports = router;
