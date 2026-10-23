"use strict";

const projects = require("../../db/queries/project");
const users = require("../../db/queries/user");
const { createHttpError } = require("../../middleware/errorHandler");

async function loadMine(client, { tenantId, userId, tenantSlug, projectId = null }) {
  const user = await users.findSessionTenantUserById(client, { tenantId, userId });
  // This is only the DEP POC gate, never a project ownership/identity mapping.
  if (tenantSlug !== "hoyrup-clemmensen" || !user || user.tenant_id !== tenantId ||
      user.status !== "active" || user.login_status !== "active" ||
      String(user.username).toLowerCase() !== "dep") {
    throw createHttpError(403, "approval_control_poc_access_denied");
  }
  const mine = await projects.listProjectsForUser(client, { tenantId, userId });
  if (projectId !== null && !mine.some(project => project.project_id === projectId)) {
    throw createHttpError(404, "project_not_found");
  }
  const selected = projectId === null ? mine : mine.filter(project => project.project_id === projectId);
  if (!selected.length) return { user, projects: [], bindings: [] };
  const { rows } = await client.query(`
    SELECT project_id, ek_project_id::text AS ek_project_id
    FROM project_masterdata_v4
    WHERE tenant_id = $1 AND project_id = ANY($2::uuid[])
  `, [tenantId, selected.map(project => project.project_id)]);
  const ids = new Set(selected.map(project => project.project_id));
  if (rows.some(row => !ids.has(row.project_id))) throw createHttpError(409, "approval_control_project_binding_invalid");
  return { user, projects: selected, bindings: rows.filter(row => /^[1-9][0-9]*$/.test(row.ek_project_id)) };
}

module.exports = { loadMine };
