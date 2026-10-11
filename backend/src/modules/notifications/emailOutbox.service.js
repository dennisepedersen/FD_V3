"use strict";

const auditService = require("../../services/auditService");
const templateRepository = require("./emailTemplate.repository");
const outboxRepository = require("./emailOutbox.repository");
const { renderTemplate } = require("./templateRenderer");
const { normalizeEmail, emailFailureFor, emailListFailureFor } = require("../../services/emailRecipients");

const MODULE_KEY = "notifications";
const RESOURCE_TYPE = "email_outbox";
const DEFAULT_LOCALE = "da-DK";

function normalizeName(value) {
  const normalized = value == null ? "" : String(value).trim();
  return normalized || null;
}

async function auditQueued(client, {
  tenantId,
  actorId,
  outboxId,
  templateKey,
  recipientTenantUserId,
  status,
}) {
  await auditService.logAuditEvent({
    client,
    tenantId,
    actorId,
    actorType: "tenant_user",
    actorScope: "tenant",
    moduleKey: MODULE_KEY,
    eventType: "email_outbox.queued",
    resourceType: RESOURCE_TYPE,
    resourceId: outboxId,
    outcome: status === "dead_letter" ? "fail" : "success",
    reason: status === "dead_letter" ? "recipient_email_unusable" : null,
    metadata: {
      template_key: templateKey,
      recipient_tenant_user_id: recipientTenantUserId || null,
      status,
    },
  });
}

async function enqueueEmail(client, {
  tenantId,
  actorId,
  templateKey,
  locale = DEFAULT_LOCALE,
  recipientTenantUserId,
  recipientEmail,
  recipientName,
  variables,
  payload,
  sourceType = "absence_request",
  sourceId,
  idempotencyKey,
}) {
  const template = await templateRepository.findActiveTemplate(client, { tenantId, templateKey, locale });
  if (!template) {
    throw new Error(`email_template_not_found:${templateKey}:${locale}`);
  }

  const rendered = renderTemplate(template, variables);
  const emailState = emailFailureFor(recipientEmail);
  const ccState = emailListFailureFor(payload?.cc_emails);
  const normalizedEmail = emailState.email;
  const normalizedName = normalizeName(recipientName);
  const errorCode = emailState.errorCode || (ccState.errorCode ? ccState.errorCode.replace("recipient_email", "recipient_cc_email") : null);
  const errorMessage = emailState.errorMessage || (ccState.errorCode ? `CC: ${ccState.errorMessage}` : null);
  const status = errorCode ? "dead_letter" : "queued";
  const row = await outboxRepository.upsertEmail(client, {
    tenantId,
    templateId: template.id,
    templateKey,
    locale: template.locale,
    recipientTenantUserId,
    recipientEmail: normalizedEmail,
    recipientName: normalizedName,
    subject: rendered.subject,
    htmlBody: rendered.html,
    textBody: rendered.text,
    payload: payload?.cc_emails == null || ccState.errorCode ? payload : { ...payload, cc_emails: ccState.emails },
    status,
    lastErrorCode: errorCode,
    lastError: errorMessage,
    sourceType,
    sourceId,
    idempotencyKey,
  });

  await auditQueued(client, {
    tenantId,
    actorId,
    outboxId: row.id,
    templateKey,
    recipientTenantUserId,
    status: row.status,
  });

  return row;
}

module.exports = {
  enqueueEmail,
  _test: {
    emailFailureFor,
    normalizeEmail,
  },
};
