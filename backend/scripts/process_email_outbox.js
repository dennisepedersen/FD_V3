#!/usr/bin/env node
"use strict";

const pool = require("../src/db/pool");
const processor = require("../src/modules/notifications/emailOutbox.processor");

const TENANT_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function parseArgs(argv) {
  const args = {
    tenant: null,
    statusOnly: false,
    dryRun: false,
    apply: false,
    confirm: null,
    limit: 25,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--tenant") {
      args.tenant = argv[++i] || null;
    } else if (arg === "--status-only") {
      args.statusOnly = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--confirm") {
      args.confirm = argv[++i] || null;
    } else if (arg === "--limit") {
      args.limit = Number(argv[++i] || 25);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function validateArgs(args) {
  if (!args.tenant || !TENANT_PATTERN.test(args.tenant)) {
    throw new Error("Provide --tenant as a lower-case tenant slug.");
  }
  const modes = [args.statusOnly, args.dryRun, args.apply].filter(Boolean).length;
  if (modes !== 1) {
    throw new Error("Choose exactly one of --status-only, --dry-run, or --apply.");
  }
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100) {
    throw new Error("--limit must be an integer from 1 to 100.");
  }
  if (args.apply) {
    const expected = `APPLY:email-outbox-process:${args.tenant}`;
    if (args.confirm !== expected) {
      throw new Error(`Apply mode requires --confirm ${expected}`);
    }
  }
}

async function resolveTenantId(slug) {
  const { rows } = await pool.query(
    "SELECT id, slug FROM tenant WHERE slug = $1 AND status = 'active' LIMIT 1",
    [slug]
  );
  if (!rows[0]) {
    throw new Error(`Active tenant not found: ${slug}`);
  }
  return rows[0].id;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  validateArgs(args);
  const tenantId = await resolveTenantId(args.tenant);
  let result;
  if (args.statusOnly) {
    result = await processor.statusOnly({ tenantId });
  } else if (args.dryRun) {
    result = await processor.dryRun({ tenantId, limit: args.limit });
  } else {
    result = await processor.processDueEmails({ tenantId, limit: args.limit });
  }
  console.log(JSON.stringify({
    event: "email_outbox_process_finished",
    at: new Date().toISOString(),
    tenant: args.tenant,
    tenant_id: tenantId,
    mode: args.statusOnly ? "status-only" : args.dryRun ? "dry-run" : "apply",
    result,
  }));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({
      event: "email_outbox_process_failed",
      at: new Date().toISOString(),
      error: error.message,
    }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
