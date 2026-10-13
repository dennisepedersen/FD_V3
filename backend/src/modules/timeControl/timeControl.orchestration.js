"use strict";

const storage = require("./timeControl.dataset");
const dates = require("./timeControl.dates");
const repository = require("./timeControl.repository");

async function traceStep(trace, step, status, counts = {}, errorCode = null) {
  if (trace === null) return;
  try { await trace(step, status, counts, errorCode); }
  catch (cause) {
    const error = new Error("time_control_trace_failed", { cause });
    error.code = "time_control_trace_failed";
    throw error;
  }
}

async function captureAndPublish(client, { tenantId, controlledDate, actorId = null, captureDay, trace = null }) {
  const startedAt = Date.now();
  await traceStep(trace, "capture_started", "started", { controlled_date: controlledDate });
  const key = `time_control_capture:${tenantId}:${dates.normalizeIsoDate(controlledDate)}`;
  const locked = (await client.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked", [key])).rows[0]?.locked;
  if (!locked) throw new Error("time_control_capture_already_in_progress");
  let transactionOpen = false;
  let failure;
  try {
    // Commit invalidation before any network read: interrupted/failed reads cannot leave a sendable old head.
    await client.query("BEGIN");
    transactionOpen = true;
    await storage.invalidateHoursDataset(client, { tenantId, controlledDate, actorId, reason: "capture_reobservation_started" });
    await client.query("COMMIT");
    transactionOpen = false;
    const reader = captureDay || require("./timeControl.capture").captureDay;
    const dataset = await reader({ tenantId, controlledDate, ...(trace === null ? {} : {
      trace: (step, status, counts, errorCode) => traceStep(trace, step, status, counts, errorCode),
    }) });
    await client.query("BEGIN");
    transactionOpen = true;
    const result = await storage.storeHoursDataset(client, { tenantId, dataset, actorId });
    await client.query("COMMIT");
    transactionOpen = false;
    await traceStep(trace, "capture_completed", "completed", { controlled_date: controlledDate,
      dataset_id: result.id,
      row_count: dataset.proof?.row_count ?? (Array.isArray(dataset.rows) ? dataset.rows.length : null) ??
        result.row_count ?? result.proof?.row_count ?? null,
      pass_count: dataset.proof?.pass_count ?? result.proof?.pass_count ?? null,
      duration_ms: Math.max(0, Date.now() - startedAt) });
    return result;
  } catch (error) {
    failure = error;
    if (transactionOpen) {
      try { await client.query("ROLLBACK"); }
      catch (rollbackError) { throw new AggregateError([error, rollbackError], "time_control_capture_rollback_failed"); }
    }
    // The committed invalidation and sync_fail audit retain the old immutable dataset but prohibit dispatch.
    await client.query("BEGIN");
    try {
      await storage.invalidateHoursDataset(client, { tenantId, controlledDate, actorId,
        reason: `capture_failed:${String(error.code || error.message).slice(0, 180)}` });
      await client.query("COMMIT");
    } catch (auditError) {
      try { await client.query("ROLLBACK"); }
      catch (rollbackError) { throw new AggregateError([error, auditError, rollbackError], "time_control_capture_failure_audit_failed"); }
      throw new AggregateError([error, auditError], "time_control_capture_failure_audit_failed");
    }
    if (error.code !== "time_control_trace_failed") {
      const code = String(error.code || error.message || "");
      await traceStep(trace, "capture_completed", "failed", { controlled_date: controlledDate,
        duration_ms: Math.max(0, Date.now() - startedAt) },
      /^time_control_[a-z0-9_:]+$/.test(code) || /^[A-Z0-9]{5}$/.test(code) ? code.slice(0, 120) : "time_control_capture_failed");
    }
    throw error;
  } finally {
    const unlocked = (await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0)) AS unlocked", [key])).rows[0]?.unlocked;
    if (!unlocked) throw new AggregateError(failure ? [failure] : [], "time_control_capture_unlock_failed");
  }
}

async function prepare(client, { tenantId, controlledDate, controlType, actorId, captureDay, trace = null }) {
  const days = controlType === "friday_weekly_v1" ? dates.weeklyPeriod(controlledDate).days : [controlledDate];
  const datasets = [];
  // Sequential day order bounds the total Friday budget to 5 x the adapter's 120-second deadline.
  for (const day of days) datasets.push(await captureAndPublish(client, { tenantId, controlledDate: day, actorId, captureDay, trace }));
  return { hoursDatasetId: days.length === 1 ? datasets[0].id : null,
    hoursDatasetIds: days.length === 5 ? datasets.map(dataset => dataset.id) : null };
}

async function catchUp(client, { tenantId, actorId = null, now = new Date(), captureDay }) {
  const local = dates.getCopenhagenParts(now).isoDate;
  const weekday = dates.weekdayIndexForIsoDate(local);
  if (weekday < 1 || weekday > 5) throw new Error("time_control_catchup_requires_workday");
  const settings = await repository.getSettings(client, { tenantId });
  if (settings.is_enabled !== true) throw new Error("time_control_disabled");
  const monday = dates.addDaysIso(local, 1 - weekday);
  const captures = [];
  const evaluations = [];
  for (let i = 0; i < weekday - 1; i++) {
    const day = dates.addDaysIso(monday, i);
    const captured = await captureAndPublish(client, { tenantId, controlledDate: day, actorId, captureDay });
    captures.push({ day, ...captured });
    const evaluated = await require("./timeControl.service").runTimeControlWithPool({
      tenantId, actorId, controlledDate: day, controlType: "manual", triggeredBy: "backfill", dryRun: true,
    }, { hoursDatasetId: captured.id });
    evaluations.push({ day, run_id: evaluated.run.id, status: evaluated.run.status, results: evaluated.results });
  }
  return { mode: "internal_only", operational_checks_recorded: 0, captures, evaluations };
}

module.exports = { captureAndPublish, prepare, catchUp };
