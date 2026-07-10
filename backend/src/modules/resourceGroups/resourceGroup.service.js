const pool = require("../../db/pool");
const { withTransaction } = require("../../db/tx");
const { createHttpError } = require("../../middleware/errorHandler");
const resourceGroupRepository = require("./resourceGroup.repository");
const auditService = require("../../services/auditService");

const ALLOWED_GROUP_STATUSES = new Set(["active", "archived"]);
const ALLOWED_MANAGER_ROLES = new Set(["owner", "manager", "viewer"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeRequiredText(value, errorCode) {
  const normalized = value == null ? "" : String(value).trim();
  if (!normalized) {
    throw createHttpError(400, errorCode);
  }
  return normalized;
}

function normalizeOptionalText(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function normalizeUuid(value, errorCode) {
  const normalized = normalizeRequiredText(value, errorCode).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw createHttpError(400, errorCode);
  }
  return normalized;
}

function normalizeBoolean(value, defaultValue = false) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (value === true || value === false) {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  throw createHttpError(400, "invalid_boolean");
}

function normalizeGroupStatus(value) {
  const normalized = normalizeRequiredText(value, "resource_group_status_required").toLowerCase();
  if (!ALLOWED_GROUP_STATUSES.has(normalized)) {
    throw createHttpError(400, "invalid_resource_group_status");
  }
  return normalized;
}

function normalizeManagerRole(value) {
  const normalized = normalizeRequiredText(value, "resource_group_manager_role_required").toLowerCase();
  if (!ALLOWED_MANAGER_ROLES.has(normalized)) {
    throw createHttpError(400, "invalid_resource_group_manager_role");
  }
  return normalized;
}

function normalizePatchGroupInput(input) {
  const output = {};

  if (Object.prototype.hasOwnProperty.call(input || {}, "name")) {
    output.name = normalizeRequiredText(input.name, "resource_group_name_required");
  }

  if (Object.prototype.hasOwnProperty.call(input || {}, "description")) {
    output.description = normalizeOptionalText(input.description);
    output.hasDescription = true;
  }

  if (Object.prototype.hasOwnProperty.call(input || {}, "status")) {
    output.status = normalizeGroupStatus(input.status);
  }

  if (
    !Object.prototype.hasOwnProperty.call(output, "name")
    && !Object.prototype.hasOwnProperty.call(output, "hasDescription")
    && !Object.prototype.hasOwnProperty.call(output, "status")
  ) {
    throw createHttpError(400, "resource_group_patch_empty");
  }

  return output;
}


async function logResourceGroupAudit(client, {
  tenantId,
  actorId,
  eventType,
  resourceType,
  resourceId,
  metadata,
}) {
  await auditService.logAuditEvent({
    client,
    tenantId,
    actorId,
    actorType: "tenant_user",
    actorScope: "tenant",
    moduleKey: "resource_groups",
    eventType,
    resourceType,
    resourceId,
    outcome: "success",
    metadata: metadata || {},
  });
}
function mapDuplicateError(error, fallbackMessage) {
  if (error && error.code === "23505") {
    throw createHttpError(400, fallbackMessage);
  }
  throw error;
}

async function requireGroup(client, { tenantId, groupId }) {
  const group = await resourceGroupRepository.findGroupById(client, { tenantId, groupId });
  if (!group) {
    throw createHttpError(404, "resource_group_not_found");
  }
  return group;
}

async function requireFitter(client, { tenantId, fitterId }) {
  const fitter = await resourceGroupRepository.findFitterById(client, { tenantId, fitterId });
  if (!fitter) {
    throw createHttpError(404, "fitter_not_found");
  }
  return fitter;
}

async function requireTenantUser(client, { tenantId, tenantUserId }) {
  const user = await resourceGroupRepository.findTenantUserById(client, { tenantId, tenantUserId });
  if (!user) {
    throw createHttpError(404, "tenant_user_not_found");
  }
  return user;
}

async function listGroupsForTenant({ tenantId, includeArchived }) {
  const normalizedTenantId = normalizeUuid(tenantId, "tenant_id_required");
  const normalizedIncludeArchived = normalizeBoolean(includeArchived, false);

  const client = await pool.connect();
  try {
    const groups = await resourceGroupRepository.listGroups(client, {
      tenantId: normalizedTenantId,
      includeArchived: normalizedIncludeArchived,
    });

    return { groups };
  } finally {
    client.release();
  }
}

async function listMemberResourceOptionsForTenant({ tenantId, includeInactive }) {
  const normalizedTenantId = normalizeUuid(tenantId, "tenant_id_required");
  const normalizedIncludeInactive = normalizeBoolean(includeInactive, false);

  const client = await pool.connect();
  try {
    const resources = await resourceGroupRepository.listMemberResourceOptions(client, {
      tenantId: normalizedTenantId,
      includeInactive: normalizedIncludeInactive,
    });

    return { resources };
  } finally {
    client.release();
  }
}

async function createGroupForTenant(input) {
  const tenantId = normalizeUuid(input?.tenantId, "tenant_id_required");
  const name = normalizeRequiredText(input?.name, "resource_group_name_required");
  const description = normalizeOptionalText(input?.description);
  const createdByUserId = normalizeUuid(input?.createdByUserId, "created_by_user_id_required");
  const updatedByUserId = normalizeUuid(input?.updatedByUserId || createdByUserId, "updated_by_user_id_required");

  return withTransaction(async (client) => {
    try {
      const group = await resourceGroupRepository.createGroup(client, {
        tenantId,
        name,
        description,
        createdByUserId,
        updatedByUserId,
      });
      await logResourceGroupAudit(client, {
        tenantId,
        actorId: createdByUserId,
        eventType: "resource_group_created",
        resourceType: "resource_group",
        resourceId: group.id,
        metadata: { source: "manual" },
      });

      return { group };
    } catch (error) {
      mapDuplicateError(error, "resource_group_name_already_exists");
    }
  });
}

async function updateGroupForTenant(input) {
  const tenantId = normalizeUuid(input?.tenantId, "tenant_id_required");
  const groupId = normalizeUuid(input?.groupId, "resource_group_id_required");
  const updatedByUserId = normalizeUuid(input?.updatedByUserId, "updated_by_user_id_required");
  const patch = normalizePatchGroupInput(input);

  return withTransaction(async (client) => {
    await requireGroup(client, { tenantId, groupId });

    try {
      const group = await resourceGroupRepository.updateGroup(client, {
        tenantId,
        groupId,
        name: patch.name || null,
        description: patch.description || null,
        hasDescription: patch.hasDescription === true,
        status: patch.status || null,
        updatedByUserId,
      });

      if (!group) {
        throw createHttpError(404, "resource_group_not_found");
      }
      await logResourceGroupAudit(client, {
        tenantId,
        actorId: updatedByUserId,
        eventType: "resource_group_updated",
        resourceType: "resource_group",
        resourceId: group.id,
        metadata: { fields: Object.keys(patch) },
      });

      return { group };
    } catch (error) {
      mapDuplicateError(error, "resource_group_name_already_exists");
    }
  });
}

async function listMembersForGroup({ tenantId, groupId }) {
  const normalizedTenantId = normalizeUuid(tenantId, "tenant_id_required");
  const normalizedGroupId = normalizeUuid(groupId, "resource_group_id_required");

  const client = await pool.connect();
  try {
    await requireGroup(client, { tenantId: normalizedTenantId, groupId: normalizedGroupId });
    const members = await resourceGroupRepository.listMembers(client, {
      tenantId: normalizedTenantId,
      groupId: normalizedGroupId,
    });

    return { members };
  } finally {
    client.release();
  }
}

async function addMemberToGroup(input) {
  const tenantId = normalizeUuid(input?.tenantId, "tenant_id_required");
  const groupId = normalizeUuid(input?.groupId, "resource_group_id_required");
  const fitterId = normalizeRequiredText(input?.fitterId, "fitter_id_required");
  const isPrimary = normalizeBoolean(input?.isPrimary, false);
  const createdByUserId = normalizeUuid(input?.createdByUserId, "created_by_user_id_required");
  const updatedByUserId = normalizeUuid(input?.updatedByUserId || createdByUserId, "updated_by_user_id_required");

  return withTransaction(async (client) => {
    await requireGroup(client, { tenantId, groupId });
    await requireFitter(client, { tenantId, fitterId });

    try {
      const member = await resourceGroupRepository.addMember(client, {
        tenantId,
        groupId,
        fitterId,
        isPrimary,
        createdByUserId,
        updatedByUserId,
      });
      await logResourceGroupAudit(client, {
        tenantId,
        actorId: createdByUserId,
        eventType: "resource_group_member_changed",
        resourceType: "resource_group_member",
        resourceId: member.id,
        metadata: { action: "add", group_id: groupId, fitter_id: fitterId },
      });

      return { member };
    } catch (error) {
      mapDuplicateError(error, "resource_group_member_already_exists");
    }
  });
}

async function updateGroupMember(input) {
  const tenantId = normalizeUuid(input?.tenantId, "tenant_id_required");
  const groupId = normalizeUuid(input?.groupId, "resource_group_id_required");
  const fitterId = normalizeRequiredText(input?.fitterId, "fitter_id_required");
  const updatedByUserId = normalizeUuid(input?.updatedByUserId, "updated_by_user_id_required");

  if (!Object.prototype.hasOwnProperty.call(input || {}, "isPrimary")) {
    throw createHttpError(400, "is_primary_required");
  }
  const isPrimary = normalizeBoolean(input.isPrimary, false);

  return withTransaction(async (client) => {
    await requireGroup(client, { tenantId, groupId });
    const member = await resourceGroupRepository.updateMember(client, {
      tenantId,
      groupId,
      fitterId,
      isPrimary,
      updatedByUserId,
    });

    if (!member) {
      throw createHttpError(404, "resource_group_member_not_found");
    }

    return { member };
  });
}

async function removeMemberFromGroup(input) {
  const tenantId = normalizeUuid(input?.tenantId, "tenant_id_required");
  const groupId = normalizeUuid(input?.groupId, "resource_group_id_required");
  const fitterId = normalizeRequiredText(input?.fitterId, "fitter_id_required");

  return withTransaction(async (client) => {
    await requireGroup(client, { tenantId, groupId });
    const removed = await resourceGroupRepository.removeMember(client, {
      tenantId,
      groupId,
      fitterId,
    });

    if (!removed) {
      throw createHttpError(404, "resource_group_member_not_found");
    }

    return { removed };
  });
}

async function listManagersForGroup({ tenantId, groupId }) {
  const normalizedTenantId = normalizeUuid(tenantId, "tenant_id_required");
  const normalizedGroupId = normalizeUuid(groupId, "resource_group_id_required");

  const client = await pool.connect();
  try {
    await requireGroup(client, { tenantId: normalizedTenantId, groupId: normalizedGroupId });
    const managers = await resourceGroupRepository.listManagers(client, {
      tenantId: normalizedTenantId,
      groupId: normalizedGroupId,
    });

    return { managers };
  } finally {
    client.release();
  }
}

async function addManagerToGroup(input) {
  const tenantId = normalizeUuid(input?.tenantId, "tenant_id_required");
  const groupId = normalizeUuid(input?.groupId, "resource_group_id_required");
  const tenantUserId = normalizeUuid(input?.tenantUserId, "tenant_user_id_required");
  const managerRole = normalizeManagerRole(input?.managerRole);
  const createdByUserId = normalizeUuid(input?.createdByUserId, "created_by_user_id_required");
  const updatedByUserId = normalizeUuid(input?.updatedByUserId || createdByUserId, "updated_by_user_id_required");

  return withTransaction(async (client) => {
    await requireGroup(client, { tenantId, groupId });
    await requireTenantUser(client, { tenantId, tenantUserId });

    try {
      const manager = await resourceGroupRepository.addManager(client, {
        tenantId,
        groupId,
        tenantUserId,
        managerRole,
        createdByUserId,
        updatedByUserId,
      });

      return { manager };
    } catch (error) {
      mapDuplicateError(error, "resource_group_manager_already_exists");
    }
  });
}

async function updateGroupManager(input) {
  const tenantId = normalizeUuid(input?.tenantId, "tenant_id_required");
  const groupId = normalizeUuid(input?.groupId, "resource_group_id_required");
  const tenantUserId = normalizeUuid(input?.tenantUserId, "tenant_user_id_required");
  const managerRole = normalizeManagerRole(input?.managerRole);
  const updatedByUserId = normalizeUuid(input?.updatedByUserId, "updated_by_user_id_required");

  return withTransaction(async (client) => {
    await requireGroup(client, { tenantId, groupId });
    const manager = await resourceGroupRepository.updateManager(client, {
      tenantId,
      groupId,
      tenantUserId,
      managerRole,
      updatedByUserId,
    });

    if (!manager) {
      throw createHttpError(404, "resource_group_manager_not_found");
    }

    return { manager };
  });
}

async function removeManagerFromGroup(input) {
  const tenantId = normalizeUuid(input?.tenantId, "tenant_id_required");
  const groupId = normalizeUuid(input?.groupId, "resource_group_id_required");
  const tenantUserId = normalizeUuid(input?.tenantUserId, "tenant_user_id_required");

  return withTransaction(async (client) => {
    await requireGroup(client, { tenantId, groupId });
    const removed = await resourceGroupRepository.removeManager(client, {
      tenantId,
      groupId,
      tenantUserId,
    });

    if (!removed) {
      throw createHttpError(404, "resource_group_manager_not_found");
    }

    return { removed };
  });
}

module.exports = {
  addManagerToGroup,
  addMemberToGroup,
  createGroupForTenant,
  listGroupsForTenant,
  listMemberResourceOptionsForTenant,
  listManagersForGroup,
  listMembersForGroup,
  removeManagerFromGroup,
  removeMemberFromGroup,
  updateGroupForTenant,
  updateGroupManager,
  updateGroupMember,
};
