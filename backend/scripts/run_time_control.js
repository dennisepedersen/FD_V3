#!/usr/bin/env node
"use strict";

const pool = require("../src/db/pool");
const timeControlService = require("../src/modules/timeControl/timeControl.service");
const { normalizeIsoDate } = require("../src/modules/timeControl/timeControl.dates");

const TENANT_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function parseArgs(argv) {
  const args = { tenant: null, date: null, controlType: "manual", noWait: false, dryRun: false, hoursDatasetId: null, historicalSnapshot: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--tenant") args.tenant = argv[++i] || null;
    else if (arg === "--date" || arg === "--controlled-date") args.date = argv[++i] || null;
    else if (arg === "--control-type") args.controlType = argv[++i] || "manual";
    else if (arg === "--no-wait-sync") args.noWait = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--hours-dataset-id") args.hoursDatasetId = argv[++i] || "";
    else if (arg === "--historical-snapshot") args.historicalSnapshot = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function validateArgs(args) {
  if (!args.tenant || !TENANT_PATTERN.test(args.tenant)) throw new Error("Provide --tenant as a lower-case tenant slug.");
  args.date = normalizeIsoDate(args.date);
  if (!["daily_09", "friday_12", "manual"].includes(args.controlType)) throw new Error("--control-type must be daily_09, friday_12, or manual.");
  if (args.hoursDatasetId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.hoursDatasetId)) {
    throw new Error("--hours-dataset-id must be a UUID.");
  }
  if ((args.hoursDatasetId !== null || args.historicalSnapshot) && !args.dryRun) throw new Error("Stored snapshot requires --dry-run.");
  if (args.historicalSnapshot && !args.hoursDatasetId) throw new Error("--historical-snapshot requires --hours-dataset-id.");
}

async function resolveTenantId(slug) {
  const { rows } = await pool.query("SELECT id FROM tenant WHERE slug = $1 AND status = 'active' LIMIT 1", [slug]);
  if (!rows[0]) throw new Error(`Active tenant not found: ${slug}`);
  return rows[0].id;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  validateArgs(args);
  const tenantId = await resolveTenantId(args.tenant);
  const result = await timeControlService.runTimeControlWithPool({
    tenantId,
    controlType: args.controlType,
    controlledDate: args.date,
    triggeredBy: "maintenance",
    waitForSync: !args.noWait,
    dryRun: args.dryRun,
  }, { hoursDatasetId: args.hoursDatasetId, allowHistoricalSnapshot: args.historicalSnapshot });
  console.log(JSON.stringify({
    event: "time_control_run_finished",
    at: new Date().toISOString(),
    tenant: args.tenant,
    tenant_id: tenantId,
    control_type: args.controlType,
    controlled_date: args.date,
    mode: result.run?.mode || null,
    status: result.run?.status || null,
    result_count: result.results?.length || 0,
    mail_count: result.mails?.length || 0,
  }));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ event: "time_control_run_failed", at: new Date().toISOString(), error: error.message }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
