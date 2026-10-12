"use strict";

const { createHash } = require("node:crypto");
const tx = require("../../db/tx");
const auditService = require("../../services/auditService");
const mailService = require("../../services/mailService");
const ENV = require("../../config/env");
const service = require("./timeControl.service");

const HC_TENANT_ID = "f1f51c07-2d88-4ee4-a766-78eac833a9d0";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const contentHash = message => createHash("sha256").update(JSON.stringify(message)).digest("hex");
const TEST_KEY = /^time_control_poc_mail:v1:([0-9a-f-]{36}):([0-9a-f-]{36}):dep_delivery(?::[0-9a-f]{12})?$/i;

function fail(code, statusCode = 409) {
  const error = new Error(code);
  error.statusCode = statusCode;
  throw error;
}

function requireScope(tenantId, actorId) {
  if (tenantId !== HC_TENANT_ID || !UUID.test(actorId || "")) fail("time_control_poc_scope_invalid", 403);
  if (process.env.TIME_CONTROL_SCHEDULER_ENABLED !== "false") fail("time_control_poc_scheduler_must_be_disabled");
}

async function audit(client, { tenantId, actorId, id, reason, metadata = {} }) {
  await auditService.logAuditEvent({
    client, tenantId, actorId, actorType: "tenant_user", actorScope: "tenant",
    moduleKey: "time_control", eventType: "tenant_config_changed",
    resourceType: "time_control_poc_mail_test", resourceId: id, outcome: "success",
    reason, metadata,
  });
}

async function prepare({ tenantId, actorId, batchId }) {
  requireScope(tenantId, actorId);
  const plan = await service.getPocMailPlan({ tenantId, batchId });
  if (!plan.manager_routing_saved) fail("time_control_poc_dep_only_required");
  const message = { ...plan.messages.find(m => m.stage === "dep_delivery"), replyTo: ENV.MAIL_REPLY_TO || null };
  const hash = contentHash(message);
  const test = await tx.withTransaction(async client => {
    // Recheck routing under the same lock as persistence, not just the earlier preview.
    await requireDrySettings(client, tenantId);
    const { rows } = await client.query(
      `INSERT INTO time_control_poc_mail_test (tenant_id,test_key,message_json,content_hash,prepared_by_user_id)
       VALUES ($1,$2,$3::jsonb,$4,$5) ON CONFLICT (tenant_id,test_key) DO NOTHING RETURNING *`,
      [tenantId, message.testKey, JSON.stringify(message), hash, actorId]
    );
    const row = rows[0] || (await client.query(
      "SELECT * FROM time_control_poc_mail_test WHERE tenant_id=$1 AND test_key=$2",
      [tenantId, message.testKey]
    )).rows[0];
    if (!row || row.content_hash !== hash) fail("time_control_poc_content_conflict");
    if (rows.length) await audit(client, { tenantId, actorId, id: row.id, reason: "poc_mail_prepared", metadata: { test_key: message.testKey, content_hash: hash } });
    return row;
  });
  return { test, plan };
}

async function currentDepMessage(client, { tenantId, testKey }) {
  const match = TEST_KEY.exec(String(testKey || ""));
  if (!match || match[1] !== tenantId) fail("time_control_poc_test_key_invalid");
  const plan = await service.getPocMailPlanForClient(client, { tenantId, batchId: match[2] });
  const message = { ...plan.messages.find(m => m.stage === "dep_delivery"), replyTo: ENV.MAIL_REPLY_TO || null };
  if (!message.testKey || message.testKey !== testKey) fail("time_control_poc_locked_message_superseded");
  return message;
}

async function requireDrySettings(client, tenantId) {
  const row = (await client.query(
    "SELECT mode,employee_cc_emails,friday_manager_emails FROM time_control_settings WHERE tenant_id=$1 FOR UPDATE", [tenantId]
  )).rows[0];
  const { emailListFailureFor } = require("../../services/emailRecipients");
  const managers = emailListFailureFor(row?.friday_manager_emails);
  const copies = emailListFailureFor(row?.employee_cc_emails);
  if (!row || row.mode !== "dry_run" || managers.errorCode || copies.errorCode ||
      JSON.stringify(managers.emails) !== '["dep@hoyrup-clemmensen.dk"]' ||
      JSON.stringify(copies.emails) !== '["dep@hoyrup-clemmensen.dk"]') fail("time_control_poc_settings_changed");
}

async function sendPreparedDep({ tenantId, actorId, testId, confirm, sendEmailFn = mailService.sendEmail }) {
  requireScope(tenantId, actorId);
  if (!UUID.test(testId || "") || confirm !== `SEND:timekontrol-poc-dep:${testId}`) fail("time_control_poc_send_confirmation_required", 400);
  if (ENV.MAIL_PROVIDER !== "resend" || !ENV.MAIL_API_KEY) fail("time_control_poc_resend_required");
  const claimed = await tx.withTransaction(async client => {
    await requireDrySettings(client, tenantId);
    const row = (await client.query(
      "SELECT * FROM time_control_poc_mail_test WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId, testId]
    )).rows[0];
    if (!row) fail("time_control_poc_test_not_found", 404);
    const message = row.message_json;
    const current = await currentDepMessage(client, { tenantId, testKey: row.test_key });
    if (message.stage !== "dep_delivery" || message.to !== "dep@hoyrup-clemmensen.dk" ||
        !Array.isArray(message.cc) || message.cc.length || message.from !== service.SENDER ||
        message.testKey !== row.test_key || !TEST_KEY.test(row.test_key) ||
        message.replyTo !== (ENV.MAIL_REPLY_TO || null) || !message.subject.startsWith("[POC-TEST") ||
        contentHash(message) !== row.content_hash || contentHash(current) !== row.content_hash) {
      fail("time_control_poc_locked_message_invalid");
    }
    if (row.status !== "prepared") return { row, claimed: false };
    const updated = (await client.query(
      "UPDATE time_control_poc_mail_test SET status='sending',attempt_started_at=now() WHERE tenant_id=$1 AND id=$2 AND status='prepared' RETURNING *",
      [tenantId, testId]
    )).rows[0];
    if (!updated) fail("time_control_poc_claim_failed");
    await audit(client, { tenantId, actorId, id: testId, reason: "poc_mail_send_attempt_started" });
    return { row: updated, claimed: true };
  });
  // The durable claim is committed before the network call. A crash never opens another attempt.
  if (!claimed.claimed) return { ...claimed.row, retry_allowed: false, delivery_state: claimed.row.status === "sending" ? "unclear" : claimed.row.status };
  let receipt;
  try {
    receipt = await sendEmailFn({
      ...claimed.row.message_json, tenantId, template: "time_control_poc_dep_test",
    }, { idempotencyKey: claimed.row.test_key, timeoutMs: 15000 });
    if (receipt?.provider !== "resend" || !receipt.providerMessageId) fail("time_control_poc_provider_receipt_missing");
  } catch (error) {
    console.error("[timeControl.mailTestSender] acceptance_unclear", { tenant_id: tenantId, test_id: testId, error_code: error.code || error.name });
    await finish({ tenantId, actorId, testId, status: "unclear", errorCode: "provider_acceptance_unclear" });
    throw error;
  }
  return finish({ tenantId, actorId, testId, status: "accepted", providerMessageId: receipt.providerMessageId });
}

async function finish({ tenantId, actorId, testId, status, errorCode = null, providerMessageId = null }) {
  return tx.withTransaction(async client => {
    const row = (await client.query(
      `UPDATE time_control_poc_mail_test SET status=$3,completed_at=now(),provider_message_id=$4,last_error_code=$5
       WHERE tenant_id=$1 AND id=$2 AND status='sending' RETURNING *`,
      [tenantId, testId, status, providerMessageId, errorCode]
    )).rows[0];
    if (!row) fail("time_control_poc_completion_conflict");
    await audit(client, { tenantId, actorId, id: testId, reason: `poc_mail_${status}`, metadata: { provider_message_id: providerMessageId } });
    return { ...row, retry_allowed: false, delivery_state: status, inbox_receipt_verified: false };
  });
}

module.exports = { prepare, sendPreparedDep, contentHash };
