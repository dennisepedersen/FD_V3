const projectAccessService = require("./projectAccessService");

const PROJECT_CORE_FIELDS = [
  "project_id",
  "external_project_ref",
  "name",
  "status",
  "is_closed",
  "owner_user_id",
  "responsible_code",
  "responsible_name",
  "responsible_id",
  "team_leader_code",
  "team_leader_name",
  "team_leader_id",
  "created_at",
  "updated_at",
];

const PROJECT_WIP_FIELDS = [
  "activity_date",
  "last_registration",
  "last_fitter_hour_date",
  "calculated_days_since_last_registration",
  "ready_to_bill",
  "margin",
  "costs",
  "ongoing",
  "billed",
  "coverage",
  "hours_budget",
  "hours_expected",
  "hours_fitter_hour",
  "remaining_hours",
  "parent_project_ek_id",
  "is_subproject",
  "total_turn_over_exp",
  "source_updated_at",
];

function pickFields(source, fields) {
  return fields.reduce((result, field) => {
    result[field] = Object.prototype.hasOwnProperty.call(source, field) ? source[field] : null;
    return result;
  }, {});
}

function hasAnyValue(value) {
  return value !== null && value !== undefined;
}

function buildProjectWip(project) {
  const projectWip = pickFields(project, PROJECT_WIP_FIELDS);
  return Object.values(projectWip).some(hasAnyValue) ? projectWip : null;
}

async function resolveProjectContext({ client, tenantId, userId, projectId }) {
  const accessContext = await projectAccessService.requireProjectAccess({
    client,
    tenantId,
    userId,
    projectId,
  });

  const project = accessContext.project;

  return {
    tenantId: accessContext.tenantId,
    userId: accessContext.userId,
    projectId: accessContext.projectId,
    project_core: pickFields(project, PROJECT_CORE_FIELDS),
    project_wip: buildProjectWip(project),
    project,
  };
}

module.exports = {
  resolveProjectContext,
};