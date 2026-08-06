"use strict";

const auditService = require("../../services/auditService");
const templateRepository = require("./emailTemplate.repository");
const outboxRepository = require("./emailOutbox.repository");
const { renderTemplate } = require("./templateRenderer");

const MODULE_KEY = "notifications";
const RESOURCE_TYPE = "email_outbox";
const DEFAULT_LOCALE = "da-DK";

function normalizeEmail(value) {
  const normalized = value == null ? "" : String(value).trim().toLowerCase();
  return normalized || null;
}

function emailFailureFor(value) {
  const normalized = normalizeEmail(value);
  if (!normalized) {
    return {
      email: null,
      errorCode: "recipient_email_missing",
      errorMessage: "Recipient email is missing or inactive.",
    };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return {
      email: normalized,
      errorCode: "recipient_email_invalid",
      errorMessage: "Recipient email is invalid.",
    };
  }
  return {
    email: normalized,
    errorCode: null,
    errorMessage: null,
  };
}

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
  sourceId,
  idempotencyKey,
}) {
  const template = await templateRepository.findActiveTemplate(client, { tenantId, templateKey, locale });
  if (!template) {
    throw new Error(`email_template_not_found:${templateKey}:${locale}`);
  }

  const rendered = renderTemplate(template, variables);
  const emailState = emailFailureFor(recipientEmail);
  const normalizedEmail = emailState.email;
  const normalizedName = normalizeName(recipientName);
  const status = emailState.errorCode ? "dead_letter" : "queued";
  const errorCode = emailState.errorCode;
  const errorMessage = emailState.errorMessage;
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
    payload,
    status,
    lastErrorCode: errorCode,
    lastError: errorMessage,
    sourceType: "absence_request",
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
