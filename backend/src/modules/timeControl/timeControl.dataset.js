"use strict";

const { createHash } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const pool = require("../../db/pool");
const auditService = require("../../services/auditService");
const coverage = require("./timeControl.coverage");
const { normalizeIsoDate } = require("./timeControl.dates");

function fail(reason) {
  throw new Error(`time_control_dataset_${reason}`);
}

function requireTenant(tenantId) {
  if (typeof tenantId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) fail("tenant_invalid");
}

function captureKey(proof, observedAt) {
  return createHash("sha256").update(JSON.stringify([proof.dataset_revision, observedAt])).digest("hex");
}

function observationTime(value) {
  if (value == null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) fail("observation_invalid");
  const time = new Date(value);
  if (!Number.isFinite(time.getTime()) || time.getTime() > Date.now()) fail("observation_invalid");
  return time.toISOString();
}

async function storeHoursDataset(client, { tenantId, dataset, observedAt = null, actorId = null }) {
  requireTenant(tenantId);
  const proof = coverage.getDatasetProof(dataset, { tenantId, controlledDate: dataset?.proof?.controlled_date });
  const scope = { tenantId, controlledDate: proof.controlled_date };
  const evidence = coverage.getDatasetEvidence(dataset, scope);
  const serverObserved = coverage.getCaptureObservation(dataset);
  const observed = observationTime(serverObserved || observedAt);
  const key = captureKey(proof, serverObserved ? `${observed}:server_capture` : observed);
  // Serialize publication per tenant/day; callers must hold a transaction.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`time_control_dataset:${tenantId}:${scope.controlledDate}`]);
  const inserted = await client.query(
    `INSERT INTO time_control_hours_dataset
       (tenant_id, controlled_date, dataset_revision, rows_hash, capture_key, row_count, evidence_json, proof_json, observed_at, server_captured)
     VALUES ($1, $2::date, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::timestamptz, $10)
     ON CONFLICT (tenant_id, controlled_date, capture_key) DO NOTHING RETURNING id`,
    [tenantId, scope.controlledDate, proof.dataset_revision, proof.rows_hash, key, proof.row_count,
      JSON.stringify(evidence), JSON.stringify(proof), observed, Boolean(serverObserved)]
  );
  const existing = inserted.rows[0] || (await client.query(
    `SELECT id FROM time_control_hours_dataset
     WHERE tenant_id = $1 AND controlled_date = $2::date AND capture_key = $3`,
    [tenantId, scope.controlledDate, key]
  )).rows[0];
  if (!existing) fail("store_failed");
  const head = (await client.query(
    `SELECT h.dataset_id, h.invalidated_at, d.observed_at FROM time_control_hours_dataset_head h
     LEFT JOIN time_control_hours_dataset d ON d.id = h.dataset_id AND d.tenant_id = h.tenant_id
       AND d.controlled_date = h.controlled_date
     WHERE h.tenant_id = $1 AND h.controlled_date = $2::date FOR UPDATE OF h`,
    [tenantId, scope.controlledDate]
  )).rows[0];
  if (head?.invalidated_at && (!observed || new Date(observed) <= new Date(head.invalidated_at))) {
    fail("replacement_requires_newer_observation");
  }
  if (head && head.dataset_id !== existing.id) {
    if (!observed || (head.observed_at && new Date(observed) <= new Date(head.observed_at))) {
      fail("replacement_requires_newer_observation");
    }
  }
  await client.query(
    `INSERT INTO time_control_hours_dataset_head (tenant_id, controlled_date, dataset_id)
     VALUES ($1, $2::date, $3)
     ON CONFLICT (tenant_id, controlled_date) DO UPDATE SET dataset_id = EXCLUDED.dataset_id, invalidated_at = NULL`,
    [tenantId, scope.controlledDate, existing.id]
  );
  await auditService.logAuditEvent({
    client, tenantId, actorId: actorId || "system:time_control_dataset",
    actorType: actorId ? "tenant_user" : "system", actorScope: actorId ? "tenant" : "system",
    moduleKey: "time_control", eventType: "sync_success", resourceType: "time_control_hours_dataset",
    resourceId: existing.id, outcome: "success", reason: "validated_snapshot_stored",
    metadata: { ...proof, observed_at: observed, server_captured: Boolean(serverObserved), previous_dataset_id: head?.dataset_id || null },
  });
  return { id: existing.id, proof, observedAt: observed };
}

async function storeHoursDatasetWithPool(input) {
  const client = await pool.connect();
  let discard = null;
  try {
    await client.query("BEGIN");
    const result = await storeHoursDataset(client, input);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      discard = rollbackError;
      throw new AggregateError([error, rollbackError], `${error.message}; ${rollbackError.message}`);
    }
    throw error;
  } finally {
    client.release(discard || undefined);
  }
}

async function invalidateHoursDataset(client, { tenantId, controlledDate, reason, actorId = null }) {
  requireTenant(tenantId);
  const day = normalizeIsoDate(controlledDate);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`time_control_dataset:${tenantId}:${day}`]);
  const { rows } = await client.query(
    "SELECT dataset_id FROM time_control_hours_dataset_head WHERE tenant_id = $1 AND controlled_date = $2::date FOR UPDATE",
    [tenantId, day]
  );
  await client.query(
    `INSERT INTO time_control_hours_dataset_head (tenant_id, controlled_date, dataset_id, invalidated_at)
     VALUES ($1, $2::date, NULL, now())
     ON CONFLICT (tenant_id, controlled_date) DO UPDATE SET dataset_id = NULL, invalidated_at = EXCLUDED.invalidated_at`,
    [tenantId, day]
  );
  await auditService.logAuditEvent({
    client, tenantId, actorId: actorId || "system:time_control_dataset",
    actorType: actorId ? "tenant_user" : "system", actorScope: actorId ? "tenant" : "system",
    moduleKey: "time_control", eventType: "sync_fail", resourceType: "time_control_hours_dataset",
    resourceId: rows[0]?.dataset_id || tenantId, outcome: "fail", reason,
    metadata: { controlled_date: day, invalidated_dataset_id: rows[0]?.dataset_id || null },
  });
}

async function importHoursEvidenceWithPool({ tenantId, controlledDate, evidence, observedAt = null, actorId = null }) {
  requireTenant(tenantId);
  const day = normalizeIsoDate(controlledDate);
  let dataset;
  let validationError = null;
  try {
    dataset = coverage.createHoursDataset(evidence);
    coverage.getDatasetProof(dataset, { tenantId, controlledDate: day });
  } catch (error) {
    if (!error.message.startsWith("time_control_coverage_invalid:")) throw error;
    validationError = error;
  }
  if (!validationError) return storeHoursDatasetWithPool({ tenantId, dataset, observedAt, actorId });
  const client = await pool.connect();
  let discard = null;
  try {
    await client.query("BEGIN");
    await invalidateHoursDataset(client, { tenantId, controlledDate: day, reason: validationError.message, actorId });
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      discard = rollbackError;
      throw new AggregateError([validationError, error, rollbackError], `${error.message}; ${rollbackError.message}`);
    }
    throw error;
  } finally {
    client.release(discard || undefined);
  }
  throw validationError;
}

async function loadHoursDataset(client, {
  tenantId, controlledDate, datasetId, freshnessMinutes, allowHistoricalSnapshot = false, now = new Date(),
}) {
  requireTenant(tenantId);
  const { rows } = await client.query(
    `SELECT d.* FROM time_control_hours_dataset_head h
     JOIN time_control_hours_dataset d ON d.id = h.dataset_id AND d.tenant_id = h.tenant_id
       AND d.controlled_date = h.controlled_date
     WHERE h.tenant_id = $1 AND h.controlled_date = $2::date AND d.id = $3
     FOR SHARE OF h, d`,
    [tenantId, controlledDate, datasetId]
  );
  const row = rows[0];
  if (!row) fail("not_current_or_scope_mismatch");
  const dataset = coverage.createHoursDataset(row.evidence_json);
  const proof = coverage.getDatasetProof(dataset, { tenantId, controlledDate });
  const observationKey = row.observed_at == null ? null : new Date(row.observed_at).toISOString();
  const expectedCaptureKey = captureKey(proof, row.server_captured ? `${observationKey}:server_capture` : observationKey);
  if (row.dataset_revision !== proof.dataset_revision || row.rows_hash !== proof.rows_hash ||
      row.row_count !== proof.row_count || row.proof_json.dataset_revision !== proof.dataset_revision ||
      row.proof_json.rows_hash !== proof.rows_hash || row.proof_json.tenant_id !== tenantId ||
      row.proof_json.controlled_date !== controlledDate || row.proof_json.status !== "complete" ||
      (row.capture_key != null && row.capture_key !== expectedCaptureKey) ||
      !isDeepStrictEqual(row.proof_json, proof)) fail("integrity_mismatch");
  const observed = row.observed_at == null ? NaN : new Date(row.observed_at).getTime();
  const age = now.getTime() - observed;
  if (!Number.isInteger(freshnessMinutes) || freshnessMinutes < 1 || !Number.isFinite(now.getTime())) fail("freshness_invalid");
  const fresh = Number.isFinite(age) && age >= 0 && age <= freshnessMinutes * 60 * 1000;
  if (!fresh && allowHistoricalSnapshot !== true) fail("stale_or_observation_missing");
  return {
    dataset,
    proof: { ...proof, dataset_id: row.id, observed_at: row.observed_at,
      server_captured: row.server_captured === true,
      freshness: allowHistoricalSnapshot ? "explicit_historical_demo" : fresh ? "fresh_observation" : "observation_missing" },
  };
}

module.exports = { importHoursEvidenceWithPool, invalidateHoursDataset, loadHoursDataset, storeHoursDataset, storeHoursDatasetWithPool };
