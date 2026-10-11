#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const pool = require("../src/db/pool");
const coverage = require("../src/modules/timeControl/timeControl.coverage");
const storage = require("../src/modules/timeControl/timeControl.dataset");
const { normalizeIsoDate } = require("../src/modules/timeControl/timeControl.dates");

async function main(argv) {
  const args = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") args.apply = true;
    else if (["--tenant", "--date", "--file", "--observed-at", "--confirm"].includes(arg)) args[arg.slice(2)] = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(args.tenant || "")) throw new Error("Provide --tenant.");
  const day = normalizeIsoDate(args.date);
  if (!args.file) throw new Error("Provide --file with trusted server-read evidence.");
  if (args.apply && args.confirm !== `GEM:timekontrol-dataset:${args.tenant}:${day}`) throw new Error("Dataset storage confirmation required.");
  const raw = fs.readFileSync(args.file, "utf8");
  let evidence;
  try {
    evidence = JSON.parse(raw);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    evidence = null;
  }
  const { rows } = await pool.query("SELECT id FROM tenant WHERE slug = $1 AND status = 'active'", [args.tenant]);
  if (rows.length !== 1) throw new Error("Active tenant not found.");
  const tenantId = rows[0].id;
  if (args.apply) {
    const stored = await storage.importHoursEvidenceWithPool({
      tenantId, controlledDate: day, evidence, observedAt: args["observed-at"] || null,
    });
    console.log(JSON.stringify({ event: "time_control_dataset_stored", dataset_id: stored.id, proof: stored.proof, observed_at: stored.observedAt }));
  } else {
    const dataset = coverage.createHoursDataset(evidence);
    const proof = coverage.getDatasetProof(dataset, { tenantId, controlledDate: day });
    console.log(JSON.stringify({ event: "time_control_dataset_preview", proof, writes: false }));
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(JSON.stringify({ event: "time_control_dataset_failed", error: error.message }));
    process.exitCode = 1;
  }).finally(async () => {
    try {
      await pool.end();
    } catch (error) {
      console.error(JSON.stringify({ event: "time_control_dataset_pool_close_failed", error: error.message }));
      process.exitCode = 1;
    }
  });
}

module.exports = { main };
