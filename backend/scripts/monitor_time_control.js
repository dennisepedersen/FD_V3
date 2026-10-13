"use strict";

require("dotenv").config({ quiet: true });
const args = process.argv.slice(2);
const allowed = new Set(["--status-only", "--apply", "--incident-run", "--confirm", "--correction", "--tenant"]);
const values = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (!allowed.has(key)) throw new Error("time_control_monitor_argument_invalid");
  values[key] = ["--status-only", "--apply"].includes(key) ? true : args[++i];
}
const obs = require("../src/modules/timeControl/timeControl.observability");
const monitor = require("../src/modules/timeControl/timeControl.monitor");
const pool = require("../src/db/pool");
async function main() {
  if (values["--tenant"] !== "hoyrup-clemmensen") throw new Error("time_control_monitor_explicit_hc_required");
  if (!values["--apply"] || values["--status-only"]) return obs.getOverview({ tenantId: obs.HC });
  if (process.env.TIME_CONTROL_MONITOR_ENABLED !== "true") throw new Error("time_control_monitor_disabled");
  if (values["--incident-run"]) {
    const runId = values["--incident-run"];
    if (runId !== "b2e06989-61c9-4f49-ab92-cc2755e1c302" || values["--confirm"] !== `STATUS:timekontrol:${runId}` || !values["--correction"]) {
      throw new Error("time_control_incident_confirmation_required");
    }
    const report = await monitor.importIncident({ tenantId: obs.HC, runId, correction: values["--correction"] });
    return monitor.sendReport({ tenantId: obs.HC, reportId: report.id });
  }
  return monitor.monitor({ tenantId: obs.HC });
}
main().then(result => console.log(JSON.stringify({ event: "time_control_monitor_finished", ...result })))
  .catch(error => { console.error(JSON.stringify({ event: "time_control_monitor_failed", error_code: obs.safeError(error) })); process.exitCode = 1; })
  .finally(() => pool.end());
