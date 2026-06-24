const express = require("express");
const requireTenantHost = require("../../middleware/requireTenantHost");
const requireAuth = require("../../middleware/requireAuth");
const { createHttpError } = require("../../middleware/errorHandler");
const moduleAccessService = require("../../services/moduleAccessService");
const resourceGroupService = require("./resourceGroup.service");

const router = express.Router();

function hasAccessContextMismatch(req) {
  if (!req.auth || !req.context || !req.context.tenant) {
    return true;
  }

  return String(req.auth.tenant_id) !== String(req.context.tenant.id);
}

function getTenantContext(req) {
  if (hasAccessContextMismatch(req)) {
    throw createHttpError(403, "tenant_context_mismatch");
  }

  return {
    tenantId: req.context.tenant.id,
    userId: req.auth.sub,
  };
}

function requireResourceGroupAccess(req, action) {
  try {
    return moduleAccessService.requireModuleAccess({
      tenant: req.context.tenant,
      auth: req.auth,
      moduleKey: "resource_groups",
      action,
    });
  } catch (error) {
    if (error && error.statusCode === 403) {
      throw createHttpError(403, "resource_group_access_denied");
    }
    throw error;
  }
}

function logRouteError(req, route, method, error) {
  console.error("[resourceGroup.routes] request_failed", {
    route,
    method,
    tenant_id: req.context?.tenant?.id || req.auth?.tenant_id || null,
    user_id: req.auth?.sub || null,
    role: req.auth?.role || null,
    error_message: error?.message || null,
    error_stack: error?.stack || null,
  });
}

router.get("/api/resource-groups", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId } = getTenantContext(req);
    requireResourceGroupAccess(req, "read");

    const result = await resourceGroupService.listGroupsForTenant({
      tenantId,
      includeArchived: req.query?.include_archived,
    });

    res.status(200).json({
      success: true,
      groups: result.groups,
    });
  } catch (error) {
    logRouteError(req, "/api/resource-groups", "GET", error);
    next(error);
  }
});

router.post("/api/resource-groups", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireResourceGroupAccess(req, "create");

    const result = await resourceGroupService.createGroupForTenant({
      tenantId,
      name: req.body?.name,
      description: req.body?.description,
      createdByUserId: userId,
      updatedByUserId: userId,
    });

    res.status(201).json({
      success: true,
      group: result.group,
    });
  } catch (error) {
    logRouteError(req, "/api/resource-groups", "POST", error);
    next(error);
  }
});

router.patch("/api/resource-groups/:groupId", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireResourceGroupAccess(req, "update");
    const patchInput = {
      tenantId,
      groupId: req.params.groupId,
      updatedByUserId: userId,
    };
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "name")) {
      patchInput.name = req.body.name;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "description")) {
      patchInput.description = req.body.description;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "status")) {
      patchInput.status = req.body.status;
    }

    const result = await resourceGroupService.updateGroupForTenant(patchInput);

    res.status(200).json({
      success: true,
      group: result.group,
    });
  } catch (error) {
    logRouteError(req, "/api/resource-groups/:groupId", "PATCH", error);
    next(error);
  }
});

router.get("/api/resource-groups/:groupId/members", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId } = getTenantContext(req);
    requireResourceGroupAccess(req, "read");

    const result = await resourceGroupService.listMembersForGroup({
      tenantId,
      groupId: req.params.groupId,
    });

    res.status(200).json({
      success: true,
      members: result.members,
    });
  } catch (error) {
    logRouteError(req, "/api/resource-groups/:groupId/members", "GET", error);
    next(error);
  }
});

router.post("/api/resource-groups/:groupId/members", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireResourceGroupAccess(req, "create");

    const result = await resourceGroupService.addMemberToGroup({
      tenantId,
      groupId: req.params.groupId,
      fitterId: req.body?.fitter_id,
      isPrimary: req.body?.is_primary,
      createdByUserId: userId,
      updatedByUserId: userId,
    });

    res.status(201).json({
      success: true,
      member: result.member,
    });
  } catch (error) {
    logRouteError(req, "/api/resource-groups/:groupId/members", "POST", error);
    next(error);
  }
});

router.patch("/api/resource-groups/:groupId/members/:fitterId", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireResourceGroupAccess(req, "update");
    const patchInput = {
      tenantId,
      groupId: req.params.groupId,
      fitterId: req.params.fitterId,
      updatedByUserId: userId,
    };
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "is_primary")) {
      patchInput.isPrimary = req.body.is_primary;
    }

    const result = await resourceGroupService.updateGroupMember(patchInput);

    res.status(200).json({
      success: true,
      member: result.member,
    });
  } catch (error) {
    logRouteError(req, "/api/resource-groups/:groupId/members/:fitterId", "PATCH", error);
    next(error);
  }
});

router.delete("/api/resource-groups/:groupId/members/:fitterId", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId } = getTenantContext(req);
    requireResourceGroupAccess(req, "delete");

    const result = await resourceGroupService.removeMemberFromGroup({
      tenantId,
      groupId: req.params.groupId,
      fitterId: req.params.fitterId,
    });

    res.status(200).json({
      success: true,
      removed: result.removed,
    });
  } catch (error) {
    logRouteError(req, "/api/resource-groups/:groupId/members/:fitterId", "DELETE", error);
    next(error);
  }
});

router.get("/api/resource-groups/:groupId/managers", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId } = getTenantContext(req);
    requireResourceGroupAccess(req, "read");

    const result = await resourceGroupService.listManagersForGroup({
      tenantId,
      groupId: req.params.groupId,
    });

    res.status(200).json({
      success: true,
      managers: result.managers,
    });
  } catch (error) {
    logRouteError(req, "/api/resource-groups/:groupId/managers", "GET", error);
    next(error);
  }
});

router.post("/api/resource-groups/:groupId/managers", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireResourceGroupAccess(req, "create");

    const result = await resourceGroupService.addManagerToGroup({
      tenantId,
      groupId: req.params.groupId,
      tenantUserId: req.body?.tenant_user_id,
      managerRole: req.body?.manager_role,
      createdByUserId: userId,
      updatedByUserId: userId,
    });

    res.status(201).json({
      success: true,
      manager: result.manager,
    });
  } catch (error) {
    logRouteError(req, "/api/resource-groups/:groupId/managers", "POST", error);
    next(error);
  }
});

router.patch("/api/resource-groups/:groupId/managers/:tenantUserId", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    requireResourceGroupAccess(req, "update");

    const result = await resourceGroupService.updateGroupManager({
      tenantId,
      groupId: req.params.groupId,
      tenantUserId: req.params.tenantUserId,
      managerRole: req.body?.manager_role,
      updatedByUserId: userId,
    });

    res.status(200).json({
      success: true,
      manager: result.manager,
    });
  } catch (error) {
    logRouteError(req, "/api/resource-groups/:groupId/managers/:tenantUserId", "PATCH", error);
    next(error);
  }
});

router.delete("/api/resource-groups/:groupId/managers/:tenantUserId", requireTenantHost, requireAuth("access"), async (req, res, next) => {
  try {
    const { tenantId } = getTenantContext(req);
    requireResourceGroupAccess(req, "delete");

    const result = await resourceGroupService.removeManagerFromGroup({
      tenantId,
      groupId: req.params.groupId,
      tenantUserId: req.params.tenantUserId,
    });

    res.status(200).json({
      success: true,
      removed: result.removed,
    });
  } catch (error) {
    logRouteError(req, "/api/resource-groups/:groupId/managers/:tenantUserId", "DELETE", error);
    next(error);
  }
});

module.exports = router;
