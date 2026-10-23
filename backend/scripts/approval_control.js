"use strict";

require("dotenv").config({ quiet: true });
const pool = require("../src/db/pool");
const job = require("../src/modules/approvalControl/approvalControl.mailJob");

async function main() {
  const args = process.argv.slice(2);
  const activate = args[0] === "--activate-scheduler" && args.length === 2 && args[1] === "--confirm=ACTIVATE:approval_control:hoyrup-clemmensen";
  if (!activate && (args.length !== 1 || !["--status", "--simulate", "--run-scheduled"].includes(args[0]))) throw new Error("approval_control_argument_invalid");
  // This is an operator entrypoint, not an alternate identity or ownership model.
  const { rows } = await pool.query(`SELECT t.id AS tenant_id,t.slug,u.id AS user_id
    FROM tenant t JOIN tenant_user u ON u.tenant_id=t.id
    WHERE t.slug=$1 AND t.status='active' AND lower(u.username)='dep'
      AND lower(u.email)=$2 AND u.status='active' AND u.login_status='active' LIMIT 2`,
  ["hoyrup-clemmensen", "dep@hoyrup-clemmensen.dk"]);
  if (rows.length !== 1) throw new Error("approval_control_actor_unavailable");
  const context = { tenantId: rows[0].tenant_id, tenantSlug: rows[0].slug, userId: rows[0].user_id };
  if (activate) return job.activateScheduler(context, { confirm: args[1].slice("--confirm=".length) });
  if (args[0] === "--status") {
    const status = await job.status(context);
    return { next_scheduled_at: status.next_scheduled_at, scheduler_enabled: status.scheduler_enabled, mail_enabled: status.mail_enabled,
      activation_id: status.activation_id, activated_at: status.activated_at, coverage_from: status.coverage_from,
      coverage_to: status.coverage_to, coverage_statement: status.coverage_statement,
      configuration_blockers: status.configuration_blockers, latest_run_id: status.latest?.id || null, state: status.latest?.state || null };
  }
  const run = await job.runDue(context, { mode: args[0] === "--simulate" ? "simulation" : "live" });
  return { run_id: run?.id || run?.run_id || null, state: run?.result?.state || run?.state || null, provider_id: run?.result?.provider_id || null };
}

if (require.main === module) main().then(result => console.log(JSON.stringify({ event: "approval_control_job_finished", ...result })))
  .catch(() => { console.error(JSON.stringify({ event: "approval_control_job_failed", error_code: "approval_control_job_failed" })); process.exitCode = 1; })
  .finally(() => pool.end());

module.exports = { main };
