"use strict";

const pool = require("../../db/pool");
const env = require("../../config/env");
const { determineScheduledControl } = require("./timeControl.dates");
const { runTimeControlWithPool, compactError } = require("./timeControl.service");

let timer = null;
let lastKey = null;
let running = false;
const TENANT_CONCURRENCY = 4;

function schedulerEnabled() {
  return ["1", "true", "yes", "on"].includes(String(process.env.TIME_CONTROL_SCHEDULER_ENABLED || "").trim().toLowerCase());
}

async function listEnabledTenantIds() {
  const { rows } = await pool.query(
    `SELECT s.tenant_id FROM time_control_settings s JOIN tenant t ON t.id=s.tenant_id
     WHERE s.is_enabled=true AND t.status='active'`);
  return rows.map((row) => row.tenant_id);
}

async function tick(now = new Date()) {
  const scheduled = determineScheduledControl(now);
  if (!scheduled) return { skipped: true, reason: "no_scheduled_control" };
  const key = `${scheduled.controlType}:${scheduled.controlledDate}:${scheduled.localHour}:${scheduled.localMinute}`;
  if (lastKey === key || running) return { skipped: true, reason: running ? "scheduler_running" : "already_ran_minute" };
  running = true;
  lastKey = key;
  try {
    const results = await runTenantControls(await listEnabledTenantIds(), scheduled);
    return { skipped: false, scheduled, results };
  } finally {
    running = false;
  }
}

async function runTenantControls(tenantIds, scheduled, {
  runControl = runTimeControlWithPool, now = () => new Date(),
} = {}) {
  const results = new Array(tenantIds.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < tenantIds.length) {
      const index = nextIndex++;
      const tenantId = tenantIds[index];
      try {
        const current = determineScheduledControl(now());
        if (current?.controlType !== scheduled.controlType || current?.controlledDate !== scheduled.controlledDate) {
          throw new Error("time_control_scheduled_start_window_expired");
        }
        const result = await runControl({
          tenantId,
          controlType: scheduled.controlType,
          controlledDate: scheduled.controlledDate,
          triggeredBy: "scheduler",
          waitForSync: true,
        });
        results[index] = { tenant_id: tenantId, ok: true, run_id: result.run?.id || null };
      } catch (error) {
        console.error("[timeControl.scheduler] tenant_run_failed", { tenant_id: tenantId, error_message: compactError(error) });
        results[index] = { tenant_id: tenantId, ok: false, error: compactError(error) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(TENANT_CONCURRENCY, tenantIds.length) }, worker));
  return results;
}

function startTimeControlScheduler() {
  if (env.NODE_ENV === "test" || !schedulerEnabled() || timer) return;
  timer = setInterval(() => {
    tick().catch((error) => console.error("[timeControl.scheduler] tick_failed", { error_message: compactError(error) }));
  }, 60 * 1000);
  tick().catch((error) => console.error("[timeControl.scheduler] initial_tick_failed", { error_message: compactError(error) }));
  console.log("[timeControl.scheduler] started interval=60000ms timezone=Europe/Copenhagen");
}

function stopTimeControlScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  _test: { listEnabledTenantIds, schedulerEnabled, tick, runTenantControls, TENANT_CONCURRENCY },
  startTimeControlScheduler,
  stopTimeControlScheduler,
};
