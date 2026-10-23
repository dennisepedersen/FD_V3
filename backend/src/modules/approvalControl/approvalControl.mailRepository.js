"use strict";

const crypto = require("node:crypto");
const pool = require("../../db/pool");
const audit = require("../../services/auditService");
const { validDay } = require("./approvalControl.logic");

function requireContext(context) {
  if (!context || ![context.tenantId, context.userId].every(value =>
    typeof value === "string" && value.trim() && value === value.trim())) {
    throw new Error("approval_control_mail_context_required");
  }
}

function requireObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("approval_control_mail_metadata_invalid");
  }
}

function requireRunId(runId) {
  if (typeof runId !== "string" || !runId.trim() || runId !== runId.trim()) {
    throw new Error("approval_control_mail_run_id_required");
  }
}

async function withClient(context, fn) {
  requireContext(context);
  const client = await pool.connect();
  try { return await fn(client); }
  finally { client.release(); }
}

async function transaction(context, key, fn) {
  requireContext(context);
  const client = await pool.connect();
  let discard;
  try {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL lock_timeout = '3s'");
      await client.query("SET LOCAL statement_timeout = '15s'");
      // Mail claims use their own namespace, separate from captures and Timekontrol.
      await client.query("SELECT pg_advisory_xact_lock(6122, hashtext($1))", [key]);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); }
      catch (rollbackError) { discard = rollbackError; }
      throw error;
    }
  } finally { client.release(discard); }
}

const runKey = (context, runId) => context.tenantId + ":" + context.userId + ":" + runId;
const startRun = row => ({ ...row.metadata, id: row.target_id });

async function readRun(client, context, runId = null) {
  const { rows } = await client.query(`
    SELECT started.target_id, started.metadata,
      attempted.metadata AS attempt, completed.metadata AS result
    FROM audit_event started
    LEFT JOIN audit_event attempted
      ON attempted.tenant_id = started.tenant_id AND attempted.actor_id = started.actor_id
      AND attempted.target_id = started.target_id
      AND attempted.event_type = 'approval_control.mail_attempt_started'
    LEFT JOIN audit_event completed
      ON completed.tenant_id = started.tenant_id AND completed.actor_id = started.actor_id
      AND completed.target_id = started.target_id
      AND completed.event_type = 'approval_control.mail_run_completed'
    WHERE started.tenant_id = $1 AND started.actor_id = $2
      AND started.target_id = started.metadata->>'run_id'
      AND started.event_type = 'approval_control.mail_run_started'
      ${runId === null ? "" : "AND started.target_id = $3"}
    ORDER BY started.occurred_at DESC, started.id DESC LIMIT 1
  `, runId === null ? [context.tenantId, context.userId] : [context.tenantId, context.userId, runId]);
  return rows[0] || null;
}

async function record(client, context, runId, eventType, metadata) {
  await audit.logAuditEvent({ client, tenantId: context.tenantId, actorId: context.userId,
    actorScope: "tenant", moduleKey: "approval_control", eventType,
    resourceType: "approval_control_mail_run", resourceId: runId, outcome: "success", metadata,
  });
}

function mergeMetadata(start, extra) {
  return { ...start, ...extra, run_id: start.run_id, local_date: start.local_date, mode: start.mode,
    scheduled_at: start.scheduled_at, started_at: start.started_at, time_zone: start.time_zone, coverage_from: start.coverage_from,
    activation_id: start.activation_id, activated_at: start.activated_at };
}

async function claim(context, metadata) {
  requireContext(context);
  requireObject(metadata);
  if (!validDay(metadata.local_date) || !["simulation", "live"].includes(metadata.mode)) {
    throw new Error("approval_control_mail_slot_invalid");
  }
  const key = runKey(context, metadata.local_date + ":" + metadata.mode);
  return transaction(context, key, async client => {
    const { rows } = await client.query(`
      SELECT target_id, metadata FROM audit_event
      WHERE tenant_id = $1 AND actor_id = $2 AND target_id = metadata->>'run_id'
        AND event_type = 'approval_control.mail_run_started'
        AND metadata->>'local_date' = $3 AND metadata->>'mode' = $4
      LIMIT 1
    `, [context.tenantId, context.userId, metadata.local_date, metadata.mode]);
    if (rows[0]) return { claimed: false, run: startRun(rows[0]) };
    const runId = crypto.randomUUID();
    await record(client, context, runId, "approval_control.mail_run_started", { ...metadata, run_id: runId });
    const saved = await readRun(client, context, runId);
    if (!saved) throw new Error("approval_control_mail_run_not_saved");
    return { claimed: true, run: startRun(saved) };
  });
}

async function attempt(context, runId, metadata = {}) {
  requireContext(context);
  requireRunId(runId);
  requireObject(metadata);
  return transaction(context, runKey(context, runId), async client => {
    const run = await readRun(client, context, runId);
    if (!run || run.attempt || run.result) return false;
    await record(client, context, runId, "approval_control.mail_attempt_started", mergeMetadata(run.metadata, metadata));
    return true;
  });
}

async function finish(context, runId, result = {}) {
  requireContext(context);
  requireRunId(runId);
  requireObject(result);
  return transaction(context, runKey(context, runId), async client => {
    const run = await readRun(client, context, runId);
    if (!run) return null;
    if (run.result) return run.result;
    await record(client, context, runId, "approval_control.mail_run_completed", mergeMetadata(run.metadata, result));
    return (await readRun(client, context, runId)).result;
  });
}

async function get(context, runId) {
  requireRunId(runId);
  return withClient(context, async client => {
    const row = await readRun(client, context, runId);
    return row ? { ...startRun(row), attempt: row.attempt, result: row.result } : null;
  });
}

async function latest(context) {
  return withClient(context, async client => {
    const row = await readRun(client, context);
    return row ? { ...startRun(row), attempt: row.attempt, result: row.result } : null;
  });
}

module.exports = { claim, attempt, finish, get, latest };
