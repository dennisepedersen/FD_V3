"use strict";

const pool = require("../../db/pool");
const ENV = require("../../config/env");
const policy = require("./approvalControl.mailPolicy");
const control = require("./approvalControl.control");
const job = require("./approvalControl.mailJob");
let timer = null, started = false, running = false;

async function candidates() {
  // V1 discovers only the existing HC/DEP POC account, never a new identity mapping.
  const { rows } = await pool.query(`SELECT u.id AS user_id,u.tenant_id,t.slug AS tenant_slug
    FROM tenant t JOIN tenant_user u ON u.tenant_id=t.id
    WHERE t.slug='hoyrup-clemmensen' AND t.status='active' AND lower(u.username)='dep'
      AND lower(u.email)='dep@hoyrup-clemmensen.dk' AND u.status='active' AND u.login_status='active'`);
  if (rows.length > 1) throw new Error("approval_control_scheduler_recipient_ambiguous");
  return rows.map(row => ({ tenantId: row.tenant_id, userId: row.user_id, tenantSlug: row.tenant_slug }));
}
async function tick(now = new Date(), { list = candidates, read = control.get, run = job.runDue } = {}) {
  if (ENV.NODE_ENV !== "production" || !policy.runtimeAllowed()) return { state: "disabled" };
  const settings = policy.read(process.env, now);
  if (!settings.configuration_valid || !settings.schedule_valid) return { state: "blocked" };
  if (!policy.slot(now, settings)) return { state: "not_due" };
  if (running) return { state: "running" };
  running = true;
  try {
    const results = [];
    for (const actor of await list()) {
      const state = await read(actor);
      if (!state.enabled) continue;
      try {
        const result = await run(actor, { mode: "live" });
        results.push({ tenant_id: actor.tenantId, state: result?.result?.state || result?.state || "running", run_id: result?.id || null });
      } catch (_) {
        results.push({ tenant_id: actor.tenantId, state: "failed" });
        console.error("[approvalControl.scheduler] run_failed", { tenant_id: actor.tenantId, code: "approval_control_scheduled_failed" });
      }
    }
    return { state: "checked", results };
  } finally { running = false; }
}
function startApprovalControlScheduler() {
  if (ENV.NODE_ENV !== "production" || started) return;
  started = true;
  const schedule = () => {
    if (!started) return;
    timer = setTimeout(() => {
      schedule();
      tick().catch(() => console.error("[approvalControl.scheduler] tick_failed", { code: "approval_control_scheduler_failed" }));
    }, 60000 - Date.now() % 60000);
    timer.unref?.();
  };
  // Never execute at startup or from the activation request; only future wall-clock ticks.
  schedule();
}
function stopApprovalControlScheduler() { started = false; if (timer) clearTimeout(timer); timer = null; }
function isAttached() { return started; }
module.exports = { tick, candidates, startApprovalControlScheduler, stopApprovalControlScheduler, isAttached };
