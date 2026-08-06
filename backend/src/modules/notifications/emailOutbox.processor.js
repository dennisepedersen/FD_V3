"use strict";

const { withTransaction } = require("../../db/tx");
const auditService = require("../../services/auditService");
const mailService = require("../../services/mailService");
const repository = require("./emailOutbox.repository");

const MODULE_KEY = "notifications";
const RESOURCE_TYPE = "email_outbox";

function clampLimit(value) {
  const parsed = Number(value || 25);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error("email_outbox_limit_invalid");
  }
  return parsed;
}

function nextAttemptDate(attemptCount) {
  const minutes = Math.min(60, Math.max(1, 2 ** Math.max(0, Number(attemptCount || 1) - 1)));
  return new Date(Date.now() + minutes * 60 * 1000);
}

function classifySendError(error, row) {
  const code = error?.code || error?.message || "email_send_failed";
  const status = Number(error?.details?.status || error?.statusCode || 0);
  const isPermanent = status >= 400 && status < 500 && status !== 429;
  const exhausted = Number(row.attempt_count) >= Number(row.max_attempts);
  return {
    code: String(code).slice(0, 120),
    message: String(error?.message || code).slice(0, 500),
    retry: !isPermanent && !exhausted,
  };
}

async function logProcessorAudit(client, {
  tenantId,
  eventType,
  resourceId,
  outcome,
  reason = null,
  metadata = {},
}) {
  await auditService.logAuditEvent({
    client,
    tenantId,
    actorId: "system:email_outbox",
    actorType: "system",
    actorScope: "system",
    moduleKey: MODULE_KEY,
    eventType,
    resourceType: RESOURCE_TYPE,
    resourceId,
    outcome,
    reason,
    metadata,
  });
}

async function statusOnly({ tenantId }) {
  return withTransaction(async (client) => ({
    tenant_id: tenantId,
    stats: await repository.getQueueStats(client, { tenantId }),
  }));
}

async function dryRun({ tenantId, limit }) {
  const normalizedLimit = clampLimit(limit);
  return withTransaction(async (client) => ({
    tenant_id: tenantId,
    mode: "dry-run",
    due: await repository.listDuePreview(client, {
      tenantId,
      limit: normalizedLimit,
    }),
  }));
}

async function processDueEmails({
  tenantId,
  limit = 25,
  processingTimeoutMinutes = 20,
  sendEmailFn = mailService.sendEmail,
} = {}) {
  if (!tenantId) throw new Error("tenant_id_required");
  const normalizedLimit = clampLimit(limit);
  const claimed = await withTransaction((client) => repository.claimDueBatch(client, {
    tenantId,
    limit: normalizedLimit,
    processingTimeoutMinutes,
  }));

  const summary = {
    tenant_id: tenantId,
    claimed: claimed.length,
    sent: 0,
    retry: 0,
    dead_letter: 0,
    failures: [],
  };

  for (const row of claimed) {
    try {
      if (!row.recipient_email) {
        await withTransaction(async (client) => {
          const dead = await repository.markDeadLetter(client, {
            tenantId,
            id: row.id,
            errorCode: "recipient_email_missing",
            errorMessage: "Recipient email is missing.",
          });
          if (dead) {
            await logProcessorAudit(client, {
              tenantId,
              eventType: "email_outbox.dead_lettered",
              resourceId: row.id,
              outcome: "fail",
              reason: "recipient_email_missing",
              metadata: { template_key: row.template_key },
            });
          }
        });
        summary.dead_letter += 1;
        continue;
      }

      const providerResult = await sendEmailFn({
        to: row.recipient_email,
        subject: row.subject,
        html: row.html_body,
        text: row.text_body,
        tenantId,
        template: row.template_key,
      });

      await withTransaction(async (client) => {
        const sent = await repository.markSent(client, {
          tenantId,
          id: row.id,
          provider: providerResult?.provider || null,
          providerMessageId: providerResult?.providerMessageId || null,
        });
        if (sent) {
          await logProcessorAudit(client, {
            tenantId,
            eventType: "email_outbox.sent",
            resourceId: row.id,
            outcome: "success",
            metadata: {
              template_key: row.template_key,
              provider: providerResult?.provider || null,
            },
          });
        }
      });
      summary.sent += 1;
    } catch (error) {
      const classified = classifySendError(error, row);
      await withTransaction(async (client) => {
        if (classified.retry) {
          const retry = await repository.markRetry(client, {
            tenantId,
            id: row.id,
            nextAttemptAt: nextAttemptDate(row.attempt_count),
            errorCode: classified.code,
            errorMessage: classified.message,
          });
          if (retry) {
            await logProcessorAudit(client, {
              tenantId,
              eventType: "email_outbox.retry_scheduled",
              resourceId: row.id,
              outcome: "fail",
              reason: classified.code,
              metadata: {
                template_key: row.template_key,
                attempt_count: row.attempt_count,
                max_attempts: row.max_attempts,
              },
            });
          }
        } else {
          const dead = await repository.markDeadLetter(client, {
            tenantId,
            id: row.id,
            errorCode: classified.code,
            errorMessage: classified.message,
          });
          if (dead) {
            await logProcessorAudit(client, {
              tenantId,
              eventType: "email_outbox.dead_lettered",
              resourceId: row.id,
              outcome: "fail",
              reason: classified.code,
              metadata: {
                template_key: row.template_key,
                attempt_count: row.attempt_count,
                max_attempts: row.max_attempts,
              },
            });
          }
        }
      });
      if (classified.retry) summary.retry += 1;
      else summary.dead_letter += 1;
      summary.failures.push({ id: row.id, code: classified.code });
    }
  }

  return summary;
}

module.exports = {
  _test: {
    classifySendError,
    clampLimit,
    nextAttemptDate,
  },
  dryRun,
  processDueEmails,
  statusOnly,
};
