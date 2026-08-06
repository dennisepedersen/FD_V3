"use strict";

const emailOutboxService = require("./emailOutbox.service");
const internalNotificationService = require("./internalNotification.service");
const { formatAbsencePeriod } = require("./templateRenderer");

function userIsActive(user) {
  return user?.status === "active" && user?.login_status === "active";
}

function userIsMailable(user) {
  return userIsActive(user) && user?.email;
}

function safePayload(context) {
  return {
    absence_request_id: context.absenceRequestId,
    absence_type_name: context.absenceTypeName,
    absence_period: context.absencePeriod,
    start_date: context.startDate,
    end_date: context.endDate,
    duration_type: context.durationType,
    special_window_name: context.specialWindowName || null,
  };
}

function actionUrlFor(context) {
  const domain = context.tenantDomain || `${context.tenantSlug}.fielddesk.dk`;
  return `https://${domain}/login#absence-request-${context.absenceRequestId}`;
}

function buildContext(row) {
  const absencePeriod = formatAbsencePeriod(row);
  return {
    absenceRequestId: row.id,
    absenceTypeName: row.absence_type_name,
    absencePeriod,
    startDate: row.start_date,
    endDate: row.end_date || row.start_date,
    durationType: row.duration_type,
    specialWindowName: row.special_window_name || null,
    tenantSlug: row.tenant_slug,
    tenantDomain: row.tenant_domain || null,
    actionUrl: actionUrlFor({
      absenceRequestId: row.id,
      tenantSlug: row.tenant_slug,
      tenantDomain: row.tenant_domain || null,
    }),
    employee: {
      id: row.employee_tenant_user_id,
      name: row.employee_name || "Medarbejder",
      email: userIsMailable({
        status: row.employee_status,
        login_status: row.employee_login_status,
        email: row.employee_email,
      }) ? row.employee_email : null,
      status: row.employee_status,
      login_status: row.employee_login_status,
    },
    manager: row.assigned_manager_tenant_user_id ? {
      id: row.assigned_manager_tenant_user_id,
      name: row.assigned_manager_name || "Leder",
      email: userIsMailable({
        status: row.manager_status,
        login_status: row.manager_login_status,
        email: row.manager_email,
      }) ? row.manager_email : null,
      status: row.manager_status,
      login_status: row.manager_login_status,
    } : null,
  };
}

async function enqueueForRecipient(client, {
  tenantId,
  actorId,
  context,
  recipient,
  eventKey,
  templateKey,
  title,
  body,
  variables,
}) {
  if (!recipient?.id || !userIsActive(recipient)) return null;
  const payload = safePayload(context);

  const notification = await internalNotificationService.createInternalNotification(client, {
    tenantId,
    actorId,
    recipientTenantUserId: recipient.id,
    eventKey,
    sourceId: context.absenceRequestId,
    title,
    body,
    actionUrl: context.actionUrl,
    payload,
  });

  const email = await emailOutboxService.enqueueEmail(client, {
    tenantId,
    actorId,
    templateKey,
    recipientTenantUserId: recipient.id,
    recipientEmail: recipient.email,
    recipientName: recipient.name,
    variables,
    payload,
    sourceId: context.absenceRequestId,
    idempotencyKey: `${templateKey}:${context.absenceRequestId}:${recipient.id}`,
  });

  return { notification, email };
}

async function enqueueAbsenceSubmitted(client, { tenantId, actorId, requestContext }) {
  const context = buildContext(requestContext);
  const results = [];
  results.push(await enqueueForRecipient(client, {
    tenantId,
    actorId,
    context,
    recipient: context.employee,
    eventKey: "absence_request.submitted.employee",
    templateKey: "absence_request.submitted.employee",
    title: "Fravaersanmodning sendt",
    body: `Din fravaersanmodning for ${context.absencePeriod} er sendt til ${context.manager?.name || "din leder"}.`,
    variables: {
      employee_name: context.employee.name,
      manager_name: context.manager?.name || "din leder",
      absence_period: context.absencePeriod,
      action_url: context.actionUrl,
    },
  }));

  if (context.manager) {
    results.push(await enqueueForRecipient(client, {
      tenantId,
      actorId,
      context,
      recipient: context.manager,
      eventKey: "absence_request.submitted.manager",
      templateKey: "absence_request.submitted.manager",
      title: "Ny fravaersanmodning",
      body: `${context.employee.name} har sendt en fravaersanmodning for ${context.absencePeriod}.`,
      variables: {
        employee_name: context.employee.name,
        manager_name: context.manager.name,
        absence_period: context.absencePeriod,
        action_url: context.actionUrl,
      },
    }));
  }
  return results.filter(Boolean);
}

async function enqueueAbsenceCancelled(client, { tenantId, actorId, requestContext }) {
  const context = buildContext(requestContext);
  const results = [];
  results.push(await enqueueForRecipient(client, {
    tenantId,
    actorId,
    context,
    recipient: context.employee,
    eventKey: "absence_request.cancelled.employee",
    templateKey: "absence_request.cancelled.employee",
    title: "Fravaersanmodning annulleret",
    body: `Din fravaersanmodning for ${context.absencePeriod} er annulleret.`,
    variables: {
      employee_name: context.employee.name,
      absence_period: context.absencePeriod,
      action_url: context.actionUrl,
    },
  }));

  if (context.manager) {
    results.push(await enqueueForRecipient(client, {
      tenantId,
      actorId,
      context,
      recipient: context.manager,
      eventKey: "absence_request.cancelled.manager",
      templateKey: "absence_request.cancelled.manager",
      title: "Fravaersanmodning annulleret",
      body: `${context.employee.name} har annulleret fravaersanmodningen for ${context.absencePeriod}.`,
      variables: {
        employee_name: context.employee.name,
        manager_name: context.manager.name,
        absence_period: context.absencePeriod,
        action_url: context.actionUrl,
      },
    }));
  }
  return results.filter(Boolean);
}

module.exports = {
  _test: {
    actionUrlFor,
    buildContext,
    safePayload,
    userIsActive,
    userIsMailable,
  },
  enqueueAbsenceCancelled,
  enqueueAbsenceSubmitted,
};
