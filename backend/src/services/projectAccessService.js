const projectQueries = require("../db/queries/project");
const { createHttpError } = require("../middleware/errorHandler");

function normalizeRequiredId(value, errorMessage) {
  const normalized = value == null ? "" : String(value).trim();
  if (!normalized) {
    throw createHttpError(400, errorMessage);
  }
  return normalized;
}

async function requireProjectAccess({ client, tenantId, userId, projectId }) {
  if (!client) {
    throw createHttpError(500, "project_access_client_required");
  }

  const normalizedTenantId = normalizeRequiredId(tenantId, "tenant_id_required");
  const normalizedUserId = normalizeRequiredId(userId, "user_id_required");
  const normalizedProjectId = normalizeRequiredId(projectId, "project_id_required");

  const project = await projectQueries.findProjectForUser(client, {
    tenantId: normalizedTenantId,
    userId: normalizedUserId,
    projectId: normalizedProjectId,
  });

  if (!project) {
    throw createHttpError(404, "project_not_found");
  }

  return {
    tenantId: normalizedTenantId,
    userId: normalizedUserId,
    projectId: normalizedProjectId,
    project,
  };
}

module.exports = {
  requireProjectAccess,
};
