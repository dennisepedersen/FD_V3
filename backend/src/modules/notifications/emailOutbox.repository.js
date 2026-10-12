"use strict";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_CONTROL_TEMPLATES = Object.freeze([
  "time_control.missing_hours.employee",
  "time_control.employee_weekly_reminder_v1",
  "time_control.friday_weekly_summary_v1",
  "time_control.internal_error",
]);

function isTimeControlEmail(row) {
  return row.source_type === "time_control" || String(row.template_key || "").startsWith("time_control.");
}

function validateTimeControlOutboxIds(tenantId, outboxIds) {
  if (typeof tenantId !== "string" || !UUID.test(tenantId)) throw new Error("time_control_outbox_tenant_invalid");
  if (!Array.isArray(outboxIds) || outboxIds.length > 100 ||
      [...outboxIds].some(id => typeof id !== "string" || !UUID.test(id)) ||
      new Set(outboxIds.map(id => id.toLowerCase())).size !== outboxIds.length) {
    throw new Error("time_control_outbox_ids_invalid");
  }
}

async function upsertEmail(client, {
  tenantId,
  templateId,
  templateKey,
  locale = "da-DK",
  recipientTenantUserId = null,
  recipientEmail = null,
  recipientName = null,
  subject,
  htmlBody,
  textBody,
  payload = {},
  status = "queued",
  nextAttemptAt = null,
  lastErrorCode = null,
  lastError = null,
  sourceType,
  sourceId,
  idempotencyKey,
}) {
  const { rows } = await client.query(
    `
      INSERT INTO email_outbox (
        tenant_id,
        template_id,
        template_key,
        locale,
        recipient_tenant_user_id,
        recipient_email,
        recipient_name,
        subject,
        html_body,
        text_body,
        payload_json,
        status,
        next_attempt_at,
        dead_lettered_at,
        last_error_code,
        last_error,
        source_type,
        source_id,
        idempotency_key
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12,
        COALESCE($13::timestamptz, now()),
        CASE WHEN $12 = 'dead_letter' THEN now() ELSE NULL END,
        $14, $15, $16, $17, $18
      )
      ON CONFLICT (tenant_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL
      DO UPDATE SET
        template_id = EXCLUDED.template_id,
        template_key = EXCLUDED.template_key,
        locale = EXCLUDED.locale,
        recipient_tenant_user_id = EXCLUDED.recipient_tenant_user_id,
        recipient_email = EXCLUDED.recipient_email,
        recipient_name = EXCLUDED.recipient_name,
        subject = EXCLUDED.subject,
        html_body = EXCLUDED.html_body,
        text_body = EXCLUDED.text_body,
        payload_json = EXCLUDED.payload_json,
        source_type = EXCLUDED.source_type,
        source_id = EXCLUDED.source_id
      RETURNING
        id,
        tenant_id,
        template_id,
        template_key,
        locale,
        recipient_tenant_user_id,
        recipient_email,
        recipient_name,
        subject,
        html_body,
        text_body,
        payload_json,
        status,
        attempt_count,
        max_attempts,
        next_attempt_at,
        last_attempt_at,
        sent_at,
        dead_lettered_at,
        provider,
        provider_message_id,
        last_error_code,
        last_error,
        source_type,
        source_id,
        idempotency_key,
        created_at,
        updated_at
    `,
    [
      tenantId,
      templateId,
      templateKey,
      locale,
      recipientTenantUserId,
      recipientEmail,
      recipientName,
      subject,
      htmlBody,
      textBody,
      JSON.stringify(payload || {}),
      status,
      nextAttemptAt,
      lastErrorCode,
      lastError,
      sourceType,
      sourceId,
      idempotencyKey,
    ]
  );

  return rows[0];
}

async function getQueueStats(client, { tenantId }) {
  const { rows } = await client.query(
    `
      SELECT status, count(*)::integer AS count
      FROM email_outbox
      WHERE tenant_id = $1
      GROUP BY status
      ORDER BY status
    `,
    [tenantId]
  );

  return rows;
}

async function listTimeControlUncertain(client, { tenantId }) {
  const { rows } = await client.query(
    `SELECT id, template_key, attempt_count, last_attempt_at,
            'unclear'::text AS delivery_state
     FROM email_outbox
     WHERE tenant_id = $1 AND attempt_count > 0
       AND (status = 'processing' OR (status = 'dead_letter' AND last_error_code = 'provider_acceptance_unclear'))
       AND (source_type = 'time_control' OR template_key ~ '^time_control[.]')
     ORDER BY last_attempt_at ASC, id ASC`,
    [tenantId]
  );
  return rows;
}

async function listDuePreview(client, { tenantId, limit }) {
  const { rows } = await client.query(
    `
      SELECT id, tenant_id, template_key, recipient_email, status, attempt_count, next_attempt_at, created_at
      FROM email_outbox
      WHERE tenant_id = $1
        AND status IN ('queued', 'retry')
        AND next_attempt_at <= now()
      ORDER BY next_attempt_at ASC, created_at ASC
      LIMIT $2
    `,
    [tenantId, limit]
  );

  return rows;
}

async function claimDueBatch(client, { tenantId, limit, processingTimeoutMinutes = 20 }) {
  const { rows } = await client.query(
    `
      WITH picked AS (
        SELECT id
        FROM email_outbox
        WHERE tenant_id = $1
          AND attempt_count < max_attempts
          AND (
            (source_type IS DISTINCT FROM 'time_control' AND template_key !~ '^time_control[.]')
            OR (status = 'queued' AND attempt_count = 0)
          )
          AND (
            (status IN ('queued', 'retry') AND next_attempt_at <= now())
            OR (status = 'processing' AND last_attempt_at < now() - ($3::integer * interval '1 minute'))
          )
        ORDER BY next_attempt_at ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $2
      )
      UPDATE email_outbox eo
      SET
        status = 'processing',
        attempt_count = attempt_count + 1,
        last_attempt_at = now(),
        last_error_code = NULL,
        last_error = NULL
      FROM picked
      WHERE eo.id = picked.id AND eo.tenant_id = $1
      RETURNING
        eo.id,
        eo.tenant_id,
        eo.template_id,
        eo.template_key,
        eo.locale,
        eo.recipient_tenant_user_id,
        eo.recipient_email,
        eo.recipient_name,
        eo.subject,
        eo.html_body,
        eo.text_body,
        eo.payload_json,
        eo.status,
        eo.attempt_count,
        eo.max_attempts,
        eo.next_attempt_at,
        eo.last_attempt_at,
        eo.sent_at,
        eo.dead_lettered_at,
        eo.provider,
        eo.provider_message_id,
        eo.last_error_code,
        eo.last_error,
        eo.source_type,
        eo.source_id,
        eo.idempotency_key,
        eo.created_at,
        eo.updated_at
    `,
    [tenantId, limit, processingTimeoutMinutes]
  );

  return rows;
}

async function claimTimeControlBatch(client, { tenantId, outboxIds }) {
  validateTimeControlOutboxIds(tenantId, outboxIds);
  if (!outboxIds.length) return [];
  const { rows } = await client.query(
    `WITH picked AS (
       SELECT id FROM email_outbox
       WHERE tenant_id = $1 AND id = ANY($2::uuid[])
         AND source_type = 'time_control' AND template_key = ANY($3::text[])
         AND status = 'queued' AND attempt_count = 0 AND attempt_count < max_attempts
         AND next_attempt_at <= now()
       ORDER BY next_attempt_at ASC, created_at ASC, id ASC
       FOR UPDATE SKIP LOCKED
     )
     UPDATE email_outbox eo
     SET status = 'processing', attempt_count = attempt_count + 1,
         last_attempt_at = now(), last_error_code = NULL, last_error = NULL
     FROM picked WHERE eo.id = picked.id AND eo.tenant_id = $1
     RETURNING eo.*`,
    [tenantId, outboxIds, TIME_CONTROL_TEMPLATES]
  );
  return rows;
}

async function markSent(client, { tenantId, id, provider = null, providerMessageId = null }) {
  const { rows } = await client.query(
    `
      UPDATE email_outbox
      SET
        status = 'sent',
        sent_at = now(),
        provider = $3,
        provider_message_id = $4,
        last_error_code = NULL,
        last_error = NULL
      WHERE tenant_id = $1
        AND id = $2
        AND status = 'processing'
      RETURNING id, tenant_id, status, sent_at, provider, provider_message_id
    `,
    [tenantId, id, provider, providerMessageId]
  );

  return rows[0] || null;
}

async function markRetry(client, { tenantId, id, nextAttemptAt, errorCode, errorMessage }) {
  const { rows } = await client.query(
    `
      UPDATE email_outbox
      SET
        status = 'retry',
        next_attempt_at = $3,
        last_error_code = $4,
        last_error = left($5, 500)
      WHERE tenant_id = $1
        AND id = $2
        AND status = 'processing'
        AND attempt_count < max_attempts
        AND source_type IS DISTINCT FROM 'time_control'
        AND template_key !~ '^time_control[.]'
      RETURNING id, tenant_id, status, attempt_count, max_attempts, next_attempt_at, last_error_code
    `,
    [tenantId, id, nextAttemptAt, errorCode, errorMessage]
  );

  return rows[0] || null;
}

async function markDeadLetter(client, { tenantId, id, errorCode, errorMessage }) {
  const { rows } = await client.query(
    `
      UPDATE email_outbox
      SET
        status = 'dead_letter',
        dead_lettered_at = now(),
        last_error_code = $3,
        last_error = left($4, 500)
      WHERE tenant_id = $1
        AND id = $2
        AND status IN ('processing', 'queued', 'retry')
      RETURNING id, tenant_id, status, dead_lettered_at, last_error_code
    `,
    [tenantId, id, errorCode, errorMessage]
  );

  return rows[0] || null;
}

module.exports = {
  claimDueBatch,
  claimTimeControlBatch,
  getQueueStats,
  isTimeControlEmail,
  listDuePreview,
  listTimeControlUncertain,
  markDeadLetter,
  markRetry,
  markSent,
  upsertEmail,
  validateTimeControlOutboxIds,
};
