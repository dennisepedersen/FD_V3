"use strict";

const pool = require("../../db/pool");
const env = require("../../config/env");
const { determineScheduledControl } = require("./timeControl.dates");
const { runTimeControlWithPool, compactError } = require("./timeControl.service");
const automation = require("./timeControl.automation");
const observability = require("./timeControl.observability");

let timer = null;
let started = false;
let lastKey = null;
let running = false;
const TENANT_CONCURRENCY = 4;

function schedulerEnabled() {
  return automation.schedulerEnabled();
}

function nextTickDelay(milliseconds = Date.now()) {
  return 60000 - milliseconds % 60000;
}

async function listEnabledTenantIds() {
  const { rows } = await pool.query(
    `SELECT s.tenant_id FROM time_control_settings s JOIN tenant t ON t.id=s.tenant_id
     WHERE s.is_enabled=true AND t.status='active'`);
  return rows.map((row) => row.tenant_id);
}

async function tick(now = new Date()) {
  if (!schedulerEnabled()) return { skipped: true, reason: "scheduler_disabled" };
  await observability.heartbeat();
  const scheduled = determineScheduledControl(now);
  if (!scheduled) return { skipped: true, reason: "no_scheduled_control" };
  const key = `${scheduled.controlType}:${scheduled.controlledDate}:${scheduled.localHour}:${scheduled.localMinute}`;
  if (lastKey === key || running) return { skipped: true, reason: running ? "scheduler_running" : "already_ran_minute" };
  running = true;
  lastKey = key;
  try {
    const results = await runTenantControls(await listEnabledTenantIds(), scheduled, { observer: observability });
    return { skipped: false, scheduled, results };
  } finally {
    running = false;
  }
}

async function runTenantControls(tenantIds, scheduled, {
  runControl = runTimeControlWithPool, now = () => new Date(), dispatch = automation.dispatchRun,
  observer = null,
} = {}) {
  const results = new Array(tenantIds.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < tenantIds.length) {
      const index = nextIndex++;
      const tenantId = tenantIds[index];
      let execution = null;
      let result = null;
      try {
        const current = determineScheduledControl(now());
        if (current?.controlType !== scheduled.controlType || current?.controlledDate !== scheduled.controlledDate) {
          throw new Error("time_control_scheduled_start_window_expired");
        }
        if (observer) {
          execution = await observer.beginExecution({ tenantId, scheduled, now: now() });
          if (!execution) {
            results[index] = { tenant_id: tenantId, ok: false, skipped: true, reason: "durable_slot_already_claimed" };
            continue;
          }
        }
        const trace = execution ? (step, status, counts = {}, errorCode = null) => observer.recordStep({
          tenantId, executionId: execution.id, step, status, counts, errorCode,
        }) : null;
        result = await runControl({
          tenantId,
          controlType: scheduled.controlType,
          controlledDate: scheduled.controlledDate,
          triggeredBy: "scheduler",
          waitForSync: true,
        }, { trace });
        if (trace) await trace("dispatch", "started", { mail_count: result.mails?.length || 0 });
        const delivery = await dispatch({ tenantId, result, ...(trace ? { trace } : {}) });
        if (trace) await trace("dispatch", delivery?.dead_letter || delivery?.failures?.length ? "failed" : "completed",
          { accepted: delivery?.sent || 0, rejected: delivery?.dead_letter || 0 },
          delivery?.dead_letter || delivery?.failures?.length ? "time_control_delivery_incomplete" : null);
        if (execution) await observer.finishExecution({ tenantId, executionId: execution.id, result });
        results[index] = { tenant_id: tenantId, ok: result.run?.status === "completed" &&
            !delivery?.dead_letter && !delivery?.failures?.length,
          run_id: result.run?.id || null, status: result.run?.status || null,
          error: result.run?.error_reason || null, delivery };
        console.log(JSON.stringify({ event: "time_control_scheduled_finished", ...results[index],
          control_type: scheduled.controlType, controlled_date: scheduled.controlledDate,
          at: new Date().toISOString() }));
      } catch (error) {
        if (execution) await observer.finishExecution({ tenantId, executionId: execution.id, result, error }).catch(traceError => {
          console.error("[timeControl.scheduler] trace_failed", { tenant_id: tenantId, error_code: observability.safeError(traceError) });
        });
        console.error("[timeControl.scheduler] tenant_run_failed", { tenant_id: tenantId, error_message: compactError(error) });
        results[index] = { tenant_id: tenantId, ok: false, error: compactError(error) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(TENANT_CONCURRENCY, tenantIds.length) }, worker));
  return results;
}

function startTimeControlScheduler() {
  if (env.NODE_ENV === "test" || !schedulerEnabled() || started) return;
  started = true;
  const scheduleNext = () => {
    if (!started) return;
    timer = setTimeout(() => {
      scheduleNext();
      tick().catch((error) => console.error("[timeControl.scheduler] tick_failed", { error_message: compactError(error) }));
    }, nextTickDelay());
  };
  // Wall-clock minute alignment avoids inheriting a near-:59 startup phase.
  scheduleNext();
  tick().catch((error) => console.error("[timeControl.scheduler] initial_tick_failed", { error_message: compactError(error) }));
  console.log("[timeControl.scheduler] started interval=60000ms timezone=Europe/Copenhagen aligned=minute");
}

function stopTimeControlScheduler() {
  started = false;
  if (timer) clearTimeout(timer);
  timer = null;
}

module.exports = {
  _test: { listEnabledTenantIds, schedulerEnabled, tick, runTenantControls, nextTickDelay, TENANT_CONCURRENCY },
  startTimeControlScheduler,
  stopTimeControlScheduler,
};
