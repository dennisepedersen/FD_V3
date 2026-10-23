"use strict";

const pool = require("../../db/pool");
const audit = require("../../services/auditService");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireContext(context) {
  if (!context || ![context.tenantId, context.userId].every(value =>
    typeof value === "string" && UUID.test(value))) {
    throw new Error("approval_control_activation_context_required");
  }
}

async function read(client, context) {
  const { rows } = await client.query(`
    SELECT id, tenant_id, metadata FROM audit_event
    WHERE tenant_id = $1 AND event_type = 'approval_control.scheduler_activated'
    LIMIT 1
  `, [context.tenantId]);
  const row = rows[0];
  return row ? { ...row.metadata, id: row.id, tenant_id: row.tenant_id } : null;
}

async function get(context) {
  requireContext(context);
  const client = await pool.connect();
  try { return await read(client, context); }
  finally { client.release(); }
}

// Caller owns authorization and the surrounding control-state transaction.
async function recordFirstInTransaction(client, context) {
  requireContext(context);
  await client.query("SELECT pg_advisory_xact_lock(6123, hashtext($1::uuid::text))", [context.tenantId]);
  const existing = await read(client, context);
  if (existing) return existing;

  // Sample once after lock waits; both fields derive from that database instant.
  const { rows } = await client.query(`
    WITH source AS MATERIALIZED (SELECT clock_timestamp() AS activated_at)
    SELECT to_char(activated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS activated_at,
      to_char(activated_at AT TIME ZONE 'Europe/Copenhagen', 'YYYY-MM-DD') AS coverage_from
    FROM source
  `);
  await audit.logAuditEvent({
    client, tenantId: context.tenantId, actorId: context.userId, actorScope: "tenant",
    moduleKey: "approval_control", eventType: "approval_control.scheduler_activated",
    resourceType: "approval_control_scheduler", resourceId: context.tenantId, outcome: "success",
    metadata: { activated_at: rows[0].activated_at, coverage_from: rows[0].coverage_from,
      time_zone: "Europe/Copenhagen", environment: "production" },
  });
  const saved = await read(client, context);
  if (!saved) throw new Error("approval_control_activation_not_saved");
  return saved;
}

// Storage-only compatibility wrapper; HTTP activation uses the atomic control transaction.
async function recordFirst(context) {
  requireContext(context);
  const client = await pool.connect();
  let discard;
  try {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL lock_timeout = '3s'");
      await client.query("SET LOCAL statement_timeout = '15s'");
      const saved = await recordFirstInTransaction(client, context);
      await client.query("COMMIT");
      return saved;
    } catch (error) {
      try { await client.query("ROLLBACK"); }
      catch (rollbackError) { discard = rollbackError; }
      throw error;
    }
  } finally { client.release(discard); }
}

module.exports = { get, read, recordFirst, recordFirstInTransaction };
