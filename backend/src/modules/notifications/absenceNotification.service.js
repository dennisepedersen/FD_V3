"use strict";

const emailOutboxService = require("./emailOutbox.service");
const internalNotificationService = require("./internalNotification.service");
const { formatAbsencePeriod, formatDateDa } = require("./templateRenderer");

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
    special_window_submission_deadline: context.specialWindowSubmissionDeadline || null,
    special_window_review_start_date: context.specialWindowReviewStartDate || null,
  };
}

function actionUrlFor(context) {
  const domain = context.tenantDomain || `${context.tenantSlug}.fielddesk.dk`;
  return `https://${domain}/login#absence-request-${context.absenceRequestId}`;
}

function toDateString(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function buildContext(row) {
  const absencePeriod = formatAbsencePeriod(row);
  const deadline = toDateString(row.special_window_submission_deadline);
  const reviewStart = toDateString(row.special_window_review_start_date);
  return {
    absenceRequestId: row.id,
    absenceTypeName: row.absence_type_name,
    absencePeriod,
    startDate: row.start_date,
    endDate: row.end_date || row.start_date,
    startTime: row.start_time ? String(row.start_time).slice(0, 5) : "",
    endTime: row.end_time ? String(row.end_time).slice(0, 5) : "",
    durationType: row.duration_type,
    specialWindowName: row.special_window_name || null,
    specialWindowSubmissionDeadline: deadline,
    specialWindowReviewStartDate: reviewStart,
    specialWindowReceiptText: row.special_window_receipt_text || null,
    tenantSlug: row.tenant_slug,
    tenantName: row.tenant_name || row.tenant_slug || "Fielddesk",
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

function submittedVariables(context) {
  return {
    employee_name: context.employee.name,
    manager_name: context.manager?.name || "din leder",
    absence_period: context.absencePeriod,
    special_window_name: context.specialWindowName || "",
    submission_deadline: context.specialWindowSubmissionDeadline ? formatDateDa(context.specialWindowSubmissionDeadline) : "",
    review_start_date: context.specialWindowReviewStartDate ? formatDateDa(context.specialWindowReviewStartDate) : "",
    receipt_text: context.specialWindowReceiptText || "",
    action_url: context.actionUrl,
    tenant_name: context.tenantName,
  };
}

async function enqueueAbsenceSubmitted(client, { tenantId, actorId, requestContext }) {
  const context = buildContext(requestContext);
  const isSpecialWindow = Boolean(context.specialWindowName);
  const employeeTemplateKey = isSpecialWindow ? "absence_request.submitted_special_window.employee" : "absence_request.submitted.employee";
  const managerTemplateKey = isSpecialWindow ? "absence_request.submitted_special_window.manager" : "absence_request.submitted.manager";
  const employeeEventKey = employeeTemplateKey;
  const managerEventKey = managerTemplateKey;
  const results = [];

  results.push(await enqueueForRecipient(client, {
    tenantId,
    actorId,
    context,
    recipient: context.employee,
    eventKey: employeeEventKey,
    templateKey: employeeTemplateKey,
    title: isSpecialWindow ? "Ferieonske modtaget" : "Fravaersanmodning sendt",
    body: isSpecialWindow
      ? `Dit ferieonske for ${context.absencePeriod} er modtaget til samlet behandling.`
      : `Din fravaersanmodning for ${context.absencePeriod} er sendt til ${context.manager?.name || "din leder"}.`,
    variables: submittedVariables(context),
  }));

  if (context.manager) {
    results.push(await enqueueForRecipient(client, {
      tenantId,
      actorId,
      context,
      recipient: context.manager,
      eventKey: managerEventKey,
      templateKey: managerTemplateKey,
      title: isSpecialWindow ? "Nyt ferieonske" : "Ny fravaersanmodning",
      body: isSpecialWindow
        ? `${context.employee.name} har sendt et ferieonske for ${context.absencePeriod} til samlet behandling.`
        : `${context.employee.name} har sendt en fravaersanmodning for ${context.absencePeriod}.`,
      variables: submittedVariables(context),
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

async function enqueueAbsenceApproved(client, { tenantId, actorId, requestContext }) {
  const context = buildContext(requestContext);
  const result = await enqueueForRecipient(client, {
    tenantId,
    actorId,
    context,
    recipient: context.employee,
    eventKey: "absence_request.approved.employee",
    templateKey: "absence_request.approved.employee",
    title: "Fravaersanmodning godkendt",
    body: `Din fravaersanmodning for ${context.absencePeriod} er godkendt.`,
    variables: {
      employee_name: context.employee.name,
      manager_name: context.manager?.name || "din leder",
      absence_type: context.absenceTypeName,
      start_date: formatDateDa(context.startDate),
      end_date: formatDateDa(context.endDate),
      start_time: context.startTime || "",
      end_time: context.endTime || "",
      action_url: context.actionUrl,
      tenant_name: context.tenantName,
    },
  });
  return result ? [result] : [];
}

async function enqueueAbsenceRejected(client, { tenantId, actorId, requestContext, decisionReason }) {
  const context = buildContext(requestContext);
  const result = await enqueueForRecipient(client, {
    tenantId,
    actorId,
    context,
    recipient: context.employee,
    eventKey: "absence_request.rejected.employee",
    templateKey: "absence_request.rejected.employee",
    title: "Fravaersanmodning afvist",
    body: `Din fravaersanmodning for ${context.absencePeriod} er afvist. Begrundelsen kan ses i Fielddesk.`,
    variables: {
      employee_name: context.employee.name,
      manager_name: context.manager?.name || "din leder",
      absence_type: context.absenceTypeName,
      start_date: formatDateDa(context.startDate),
      end_date: formatDateDa(context.endDate),
      start_time: context.startTime || "",
      end_time: context.endTime || "",
      decision_reason: decisionReason,
      action_url: context.actionUrl,
      tenant_name: context.tenantName,
    },
  });
  return result ? [result] : [];
}

module.exports = {
  _test: {
    actionUrlFor,
    buildContext,
    safePayload,
    submittedVariables,
    userIsActive,
    userIsMailable,
  },
  enqueueAbsenceApproved,
  enqueueAbsenceCancelled,
  enqueueAbsenceRejected,
  enqueueAbsenceSubmitted,
};