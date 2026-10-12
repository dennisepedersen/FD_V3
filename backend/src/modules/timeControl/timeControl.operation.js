"use strict";

const { createHash } = require("node:crypto");
const dates = require("./timeControl.dates");
const repository = require("./timeControl.repository");
const audit = require("../../services/auditService");

function fail(reason) {
  const error = new Error(`time_control_operation_${reason}`);
  error.statusCode = reason === "tenant_admin_required" ? 403 : reason === "already_active" ? 409 : 400;
  throw error;
}
function identityHash(identity) {
  return createHash("sha256").update(JSON.stringify([
    identity.fitter_id, identity.group_id, identity.approval_version, identity.approved_email,
  ])).digest("hex");
}
function scheduledStart(controlType, controlledDate, now) {
  const schedule = dates.determineScheduledControl(now);
  return schedule?.controlType === controlType && schedule.controlledDate === controlledDate;
}
function completionWindow(controlType, controlledDate, now) {
  const weekday = dates.weekdayIndexForIsoDate(controlledDate);
  if (controlType === "daily_09" ? weekday < 1 || weekday > 4
    : controlType !== "friday_weekly_v1" || weekday !== 5) return false;
  const local = dates.getCopenhagenParts(now);
  const expectedDay = controlType === "daily_09" ? dates.addDaysIso(controlledDate, 1) : controlledDate;
  const expectedHour = controlType === "daily_09" ? 9 : 12;
  return local.isoDate === expectedDay && local.hour === expectedHour && local.minute < 15;
}
function dispatchWindow(controlType, controlledDate, now = new Date()) {
  return controlType === "daily_09" ? completionWindow(controlType, controlledDate, now)
    : require("./timeControl.weekly").reminderWindow(controlledDate, now);
}

async function setOperation(client, { tenantId, groupId, actorId, coveredFrom, status, now = new Date() }) {
  if (!["active", "paused"].includes(status)) fail("status_invalid");
  const actor = (await client.query(
    "SELECT id FROM tenant_user WHERE tenant_id=$1 AND id=$2 AND role='tenant_admin' AND status='active' FOR SHARE",
    [tenantId, actorId])).rows[0];
  if (!actor) fail("tenant_admin_required");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`time_control_operation:${tenantId}:${groupId}`]);
  const current = (await client.query(
    "SELECT * FROM time_control_operation_state WHERE tenant_id=$1 AND group_id=$2 FOR UPDATE",
    [tenantId, groupId])).rows[0];
  if (status === "paused") {
    if (!current) fail("not_started");
    await client.query("UPDATE time_control_operation_state SET status='paused',updated_at=now() WHERE tenant_id=$1 AND group_id=$2", [tenantId, groupId]);
  } else {
    if (current?.status === "active") fail("already_active");
    const day = dates.normalizeIsoDate(coveredFrom);
    const local = dates.getCopenhagenParts(now).isoDate;
    const weekday = dates.weekdayIndexForIsoDate(local);
    const monday = dates.addDaysIso(local, 1 - (weekday || 7));
    if (day < monday || day > local) fail("coverage_start_invalid");
    const configs = (await repository.listEmployeeConfigs(client, { tenantId })).filter(config => config.approved_group_id === groupId);
    if (!configs.length) fail("approved_cohort_missing");
    const cohort = [];
    for (const config of configs) {
      const rows = await repository.resolveEmployeeConfig(client, { tenantId, config });
      const resolution = require("./timeControl.service")._test.classifyResolvedEmployee(config, rows);
      if (!resolution.ok) fail(resolution.configError);
      const identity = resolution.employee.identitySnapshot;
      cohort.push({ fitter_id: identity.fitter_id, identity_hash: identityHash(identity) });
    }
    const op = (await client.query(
      `INSERT INTO time_control_operation(tenant_id,group_id,covered_from,started_at,started_by_user_id,cohort_json)
       VALUES($1,$2,$3::date,$4,$5,$6::jsonb) RETURNING id`,
      [tenantId, groupId, day, now, actorId, JSON.stringify(cohort)])).rows[0];
    await client.query(
      `INSERT INTO time_control_operation_state(tenant_id,group_id,operation_id,status)
       VALUES($1,$2,$3,'active') ON CONFLICT(tenant_id,group_id) DO UPDATE
       SET operation_id=EXCLUDED.operation_id,status='active',updated_at=now()`, [tenantId, groupId, op.id]);
  }
  await audit.logAuditEvent({ client, tenantId, actorId, actorType: "tenant_user", actorScope: "tenant",
    moduleKey: "time_control", eventType: "time_control.mode_changed", resourceType: "time_control_operation",
    resourceId: groupId, outcome: "success", reason: `operation_${status}`,
    metadata: { group_id: groupId, covered_from: coveredFrom || null, started_at: now.toISOString(), status } });
  return getOperation(client, { tenantId, groupId });
}

async function getOperation(client, { tenantId, groupId }) {
  return (await client.query(
    `SELECT o.*,o.covered_from::text AS covered_day,s.status FROM time_control_operation_state s
     JOIN time_control_operation o ON o.id=s.operation_id AND o.tenant_id=s.tenant_id AND o.group_id=s.group_id
     WHERE s.tenant_id=$1 AND s.group_id=$2 FOR SHARE OF s,o`, [tenantId, groupId])).rows[0] || null;
}

async function checkGate(client, { tenantId, identity, friday, requireWeekly = false, snapshotId = null }) {
  if (!identity?.group_id || !identity?.fitter_id) return { eligible: false, reason: "approved_identity_missing" };
  const period = dates.weeklyPeriod(friday);
  const op = await getOperation(client, { tenantId, groupId: identity.group_id });
  if (!op || op.status !== "active") return { eligible: false, reason: "operation_not_active" };
  const hash = identityHash(identity);
  if (!op.cohort_json.some(member => member.fitter_id === identity.fitter_id && member.identity_hash === hash)) {
    return { eligible: false, reason: "operation_cohort_changed" };
  }
  const start = dates.getCopenhagenParts(new Date(op.started_at));
  const tuesday = dates.addDaysIso(period.monday, 1);
  if (op.covered_day > period.monday || start.isoDate > tuesday ||
      (start.isoDate === tuesday && start.hour * 60 + start.minute >= 9 * 60)) {
    return { eligible: false, reason: "first_partial_operational_week" };
  }
  const receipts = (await client.query(
    `SELECT c.*,c.controlled_date::text AS controlled_date FROM time_control_operational_check c
     JOIN time_control_run r ON r.tenant_id=c.tenant_id AND r.id=c.run_id
     WHERE c.tenant_id=$1 AND c.operation_id=$2 AND r.status='completed'
     AND c.fitter_id=$3 AND c.controlled_date BETWEEN $4::date AND $5::date FOR SHARE OF c,r`,
    [tenantId, op.id, identity.fitter_id, period.monday, period.friday])).rows;
  const required = period.days.slice(0, 4).map(day => ({ day, type: "daily_09" }));
  if (requireWeekly) required.push({ day: period.friday, type: "friday_weekly_v1" });
  const ids = [];
  for (const expected of required) {
    const receipt = receipts.find(row => row.controlled_date === expected.day && row.control_type === expected.type && row.identity_hash === hash &&
      (expected.type !== "friday_weekly_v1" || row.weekly_snapshot_id === snapshotId));
    if (!receipt) return { eligible: false, reason: `scheduled_control_missing:${expected.type}:${expected.day}` };
    ids.push(receipt.id);
  }
  return { eligible: true, operation_id: op.id, receipt_ids: ids };
}

async function recordChecks(client, { tenantId, run, results, execution }) {
  if (!execution || run.status !== "completed" || run.mode !== "live" || execution.historical || run.triggered_by !== "scheduler" ||
      !scheduledStart(run.control_type, execution.controlledDate, execution.startedAt) ||
      !completionWindow(run.control_type, execution.controlledDate, execution.now())) return [];
  const checks = [];
  for (const result of results) {
    if (!["ok", "missing_hours", "weekly_reminder"].includes(result.status) || result.coverage_status !== "complete" ||
        result.identity_snapshot?.hours_dataset?.server_captured !== true && run.control_type === "daily_09") continue;
    const identity = result.identity_snapshot;
    const op = await getOperation(client, { tenantId, groupId: identity.group_id });
    const hash = identityHash(identity);
    if (!op || op.status !== "active" || new Date(op.started_at) > execution.startedAt ||
        op.covered_day > execution.controlledDate ||
        !op.cohort_json.some(member => member.fitter_id === result.fitter_id && member.identity_hash === hash)) continue;
    const row = (await client.query(
      `INSERT INTO time_control_operational_check(tenant_id,group_id,operation_id,fitter_id,controlled_date,
       control_type,run_id,dataset_id,weekly_snapshot_id,binding_key,identity_hash,started_at,completed_at,result_json)
       VALUES($1,$2,$3,$4,$5::date,$6,$7,$8::uuid,$9::uuid,COALESCE($8::uuid,$9::uuid),$10,$11,$12,$13::jsonb)
       ON CONFLICT(tenant_id,operation_id,fitter_id,controlled_date,control_type,binding_key) DO NOTHING RETURNING id`,
      [tenantId, identity.group_id, op.id, result.fitter_id, execution.controlledDate,
        run.control_type, run.id, result.hours_dataset_id, result.weekly_snapshot_id, hash,
        execution.startedAt, execution.now(), JSON.stringify(result)])).rows[0];
    if (row) checks.push(row.id);
  }
  return checks;
}

module.exports = { setOperation, getOperation, checkGate, recordChecks, identityHash, scheduledStart, completionWindow, dispatchWindow };
