"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://example.invalid/fielddesk_test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.ROOT_DOMAIN = process.env.ROOT_DOMAIN || "fielddesk.test";

const dates = require("../backend/src/modules/timeControl/timeControl.dates");
const logic = require("../backend/src/modules/timeControl/timeControl.logic");
const repository = require("../backend/src/modules/timeControl/timeControl.repository");
const service = require("../backend/src/modules/timeControl/timeControl.service");
const emailOutboxService = require("../backend/src/modules/notifications/emailOutbox.service");
const auditService = require("../backend/src/services/auditService");
const hoursCoverage = require("../backend/src/modules/timeControl/timeControl.coverage");
const datasetStorage = require("../backend/src/modules/timeControl/timeControl.dataset");
const { createHash } = require("node:crypto");

const repoRoot = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

function uuid(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

async function withPatches(patches, fn) {
  const restores = patches.map(([target, key, value]) => {
    const previous = target[key];
    target[key] = value;
    return () => {
      target[key] = previous;
    };
  });
  try {
    return await fn();
  } finally {
    for (const restore of restores.reverse()) restore();
  }
}

const rules = logic.normalizePayCodeRules([
  { pay_code: "3300", counts_as_valid_hours: true },
  { pay_code: "1220", counts_as_valid_hours: true },
  { pay_code: "9010", counts_as_valid_hours: true },
  { pay_code: "9012", counts_as_valid_hours: true },
  { pay_code: "9022", counts_as_valid_hours: true },
  { pay_code: "1244", counts_as_valid_hours: false },
  { pay_code: "1246", counts_as_valid_hours: false },
]);

function evaluate(rows, requiredHours) {
  const summary = logic.summarizeHours(rows, rules);
  return logic.evaluateMissingHours({ validHours: summary.validHours, requiredHours });
}

test("Timekontrol hour rules count only configured valid pay codes", () => {
  assert.equal(evaluate([{ fitter_category_reference: "3300", hours: 7.5 }], 7.5).status, "ok");
  assert.equal(evaluate([
    { fitter_category_reference: "3300", hours: 6.0 },
    { fitter_category_reference: "1220", hours: 1.5 },
  ], 7.5).status, "ok");
  assert.equal(evaluate([{ fitter_category_reference: "3300", hours: 7.0 }], 7.5).missingHours, 0.5);
  assert.equal(evaluate([{ fitter_category_reference: "3300", hours: 7.0 }], 7.0).status, "ok");

  const additionsOnly = logic.summarizeHours([
    { fitter_category_reference: "1244", hours: 3.5 },
    { fitter_category_reference: "1246", hours: 4.0 },
  ], rules);
  assert.equal(additionsOnly.validHours, 0);
  assert.equal(evaluate([
    { fitter_category_reference: "9010", hours: 2 },
    { fitter_category_reference: "9012", hours: 3 },
    { fitter_category_reference: "9022", hours: 2.5 },
  ], 7.5).status, "ok");
  assert.equal(evaluate([{ fitter_category_reference: "1244", hours: 7.5 }], 7.5).missingHours, 7.5);
});

test("category ids are not pay-code references; repository resolves missing references within the tenant", async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ fitter_category_id: "72", fitter_category_reference: "3300", hours: 7.5 }] };
    },
  };
  const rows = await repository.listHoursForFitterDate(client, {
    tenantId: uuid(1), fitterId: "15", controlledDate: "2026-10-08",
  });
  assert.match(calls[0].sql, /LEFT JOIN fitter_category fc/);
  assert.match(calls[0].sql, /fc\.tenant_id = fh\.tenant_id/);
  assert.match(calls[0].sql, /fc\.fitter_category_id = fh\.fitter_category_id/);
  assert.match(calls[0].sql, /COALESCE\(NULLIF\(btrim\(fh\.fitter_category_reference\), ''\), fc\.reference\)/);
  assert.deepEqual(calls[0].params, [uuid(1), "15", "2026-10-08"]);
  assert.equal(logic.summarizeHours(rows, rules).validHours, 7.5);
  assert.equal(logic.summarizeHours([{ fitter_category_id: "3300", hours: 7.5 }], rules).validHours, 0);
  assert.equal(logic.summarizeHours([{ fitter_category_id: "0", hours: 7.5 }], rules).validHours, 0);
});

test("explicit fitter identity requires active tenant fitter and approved authoritative group, not login", async () => {
  let sql;
  await repository.resolveEmployeeConfig({
    query: async (query, params) => {
      sql = query;
      assert.deepEqual(params, [uuid(1), uuid(20)]);
      return { rows: [] };
    },
  }, { tenantId: uuid(1), config: { id: uuid(20), fitter_id: "15" } });
  assert.match(sql, /f\.fitter_id = tec\.fitter_id/);
  assert.doesNotMatch(sql, /JOIN tenant_user|login_status|upper\(btrim/);
  assert.match(sql, /f\.tenant_id = tec\.tenant_id/);
  assert.match(sql, /f\.is_active_derived = true/);
  assert.match(sql, /rgm\.tenant_id = f\.tenant_id/);
  assert.match(sql, /rgm\.fitter_id = f\.fitter_id/);
  assert.match(sql, /rg\.external_source = 'ekomplet'/);
  assert.match(sql, /rg\.external_id = tec\.resource_group_external_id/);
  assert.match(sql, /rg\.id = tec\.approved_group_id/);
  assert.match(sql, /FOR SHARE OF tec, f, rgm, rg/);
  assert.equal(service._test.classifyResolvedEmployee({ fitter_id: "15" }, [{
    fitter_id: "15", fitter_name: "Tekniker", fitter_email: "tech@example.test",
  }]).configError, "verified_identity_chain_incomplete");
});

function approvedEmployee(patch = {}) {
  return {
    tenant_user_id: null, fitter_id: "35", fitter_name: "Mikkel Hansen",
    fitter_email: "mikkel@example.test", is_active_derived: true,
    resource_group_id: uuid(70), resource_group_external_id: "61",
    approved_email: "mikkel@example.test", email_source: "fitter_master",
    email_source_value: "mikkel@example.test", approval_version: 1,
    email_approved_at: "2026-10-11T00:00:00Z", email_approved_by_user_id: uuid(2),
    ...patch,
  };
}

test("Timekontrol scheduler resolves Copenhagen control windows", () => {
  assert.equal(dates.determineScheduledControl(new Date(Date.UTC(2026, 9, 12, 7, 0))), null);
  assert.deepEqual(dates.determineScheduledControl(new Date(Date.UTC(2026, 9, 9, 7, 0))), {
    controlType: "daily_09",
    controlledDate: "2026-10-08",
    localDate: "2026-10-09",
    localHour: 9,
    localMinute: 0,
    timezone: "Europe/Copenhagen",
  });
  assert.deepEqual(dates.determineScheduledControl(new Date(Date.UTC(2026, 9, 9, 10, 0))), {
    controlType: "friday_12",
    controlledDate: "2026-10-09",
    localDate: "2026-10-09",
    localHour: 12,
    localMinute: 0,
    timezone: "Europe/Copenhagen",
  });
});

test("production Timekontrol startup with scheduler disabled creates no timer or database query", async () => {
  const scheduler = require("../backend/src/modules/timeControl/timeControl.scheduler");
  const env = require("../backend/src/config/env");
  const pool = require("../backend/src/db/pool");
  const previous = process.env.TIME_CONTROL_SCHEDULER_ENABLED;
  let queries = 0;
  try {
    await withPatches([
      [env, "NODE_ENV", "production"],
      [global, "setInterval", () => { throw new Error("disabled_scheduler_created_timer"); }],
      [pool, "query", async () => { queries += 1; throw new Error("disabled_scheduler_queried_database"); }],
    ], async () => {
      for (const value of [null, "", "false", "0", "off"]) {
        if (value === null) delete process.env.TIME_CONTROL_SCHEDULER_ENABLED;
        else process.env.TIME_CONTROL_SCHEDULER_ENABLED = value;
        assert.equal(scheduler._test.schedulerEnabled(), false);
        scheduler.startTimeControlScheduler();
      }
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(queries, 0);
    });
  } finally {
    if (previous === undefined) delete process.env.TIME_CONTROL_SCHEDULER_ENABLED;
    else process.env.TIME_CONTROL_SCHEDULER_ENABLED = previous;
  }
});

test("sync failure blocks employee mail and records only an internal dry-run mail", async () => {
  const mailLogs = [];
  await withPatches([
    [repository, "getSettings", async () => ({
      is_enabled: true,
      mode: "dry_run",
      sync_freshness_minutes: 180,
      sync_wait_seconds: 0,
      internal_error_emails: ["dep@hoyrup-clemmensen.dk"],
      employee_cc_emails: ["dep@hoyrup-clemmensen.dk"],
    })],
    [repository, "upsertRun", async () => ({ id: uuid(10), tenant_id: uuid(1), control_type: "daily_09", controlled_date: "2026-10-08", mode: "dry_run" })],
    [repository, "getFitterhoursSyncState", async () => ({ endpoint_status: "failed", last_error: "ek_timeout" })],
    [repository, "queueFitterhoursSync", async () => ({ id: uuid(11), status: "queued" })],
    [repository, "updateRunSync", async () => null],
    [repository, "finishRun", async (_client, args) => ({ id: uuid(10), ...args, mode: "dry_run", control_type: "daily_09", controlled_date: "2026-10-08" })],
    [repository, "upsertMailLog", async (_client, args) => {
      mailLogs.push(args);
      return { id: uuid(12), ...args };
    }],
    [repository, "listEmployeeConfigs", async () => {
      throw new Error("employee_configs_should_not_be_loaded");
    }],
    [emailOutboxService, "enqueueEmail", async () => {
      throw new Error("live_email_should_not_send");
    }],
    [auditService, "logAuditEvent", async () => {}],
  ], async () => {
    const result = await service.runTimeControl({ query: async () => ({ rows: [] }) }, {
      tenantId: uuid(1),
      controlType: "daily_09",
      controlledDate: "2026-10-08",
      waitForSync: true,
    });
    assert.equal(result.run.status, "blocked");
  });

  assert.equal(mailLogs.length, 1);
  assert.equal(mailLogs[0].mailType, "internal_error");
  assert.equal(mailLogs[0].status, "would_send");
  assert.deepEqual(mailLogs[0].recipientEmails, ["dep@hoyrup-clemmensen.dk"]);
});

async function runMailScenario({
  mode,
  controlType = "friday_12",
  dryRun = false,
  ccEmails = ["dep@hoyrup-clemmensen.dk"],
  managerEmails = ["dep@hoyrup-clemmensen.dk", " LKE@hoyrup-clemmensen.dk "],
  syncFailed = false,
  coverage = { status: "complete" },
  hourRows = [{ fitter_category_reference: "3300", hours: 6 }],
  resolvedEmployee = [approvedEmployee()],
  existingMail = null,
  storedRunDate = "2026-10-09",
  hoursDataset = null,
  hoursDatasetId = null,
  allowHistoricalSnapshot = false,
}) {
  const mailLogs = [];
  const outbox = [];
  const results = [];
  let runResult;
  let createdMode;
  const settings = {
    is_enabled: true, mode, sync_freshness_minutes: 180,
    employee_cc_emails: ccEmails,
    friday_manager_emails: managerEmails,
    internal_error_emails: [" DEP@hoyrup-clemmensen.dk ", " LKE@hoyrup-clemmensen.dk "],
    sync_wait_seconds: 0,
  };
  await withPatches([
    [repository, "getSettings", async () => settings],
    [repository, "upsertRun", async (_client, args) => {
      createdMode = args.mode;
      return { id: uuid(10), tenant_id: uuid(1), control_type: controlType, controlled_date: storedRunDate, mode: args.mode };
    }],
    [repository, "getFitterhoursSyncState", async () => {
      assert.ok(!hoursDataset && !hoursDatasetId, "snapshot must not inspect legacy sync state");
      return syncFailed
      ? { endpoint_status: "failed", last_error: "ek_timeout" }
      : { endpoint_status: "success", last_successful_sync_at: new Date().toISOString() };
    }],
    [repository, "queueFitterhoursSync", async () => {
      assert.ok(!hoursDataset && !hoursDatasetId, "snapshot must not queue sync");
      return { id: uuid(11), status: "queued" };
    }],
    [repository, "updateRunSync", async () => null],
    [repository, "bindRunDataset", async (_client, args) => assert.equal(args.datasetId, hoursDatasetId)],
    [repository, "listEmployeeConfigs", async () => [{ id: uuid(20), internal_ref: "MHJ", fitter_id: "35" }]],
    [repository, "listPayCodeRules", async () => [{ pay_code: "3300", counts_as_valid_hours: true }]],
    [repository, "resolveEmployeeConfig", async () => resolvedEmployee],
    [repository, "listHoursForFitterDate", async () => {
      assert.ok(!hoursDataset && !hoursDatasetId, "snapshot must not read legacy hours");
      return hourRows;
    }],
    [repository, "getHoursPeriodCoverage", async () => {
      assert.ok(!hoursDataset && !hoursDatasetId, "snapshot must not read legacy coverage");
      return coverage;
    }],
    [repository, "upsertResult", async (_client, args) => {
      results.push(args);
      return {
      id: uuid(40), status: args.status, tenant_user_id: args.tenantUserId,
      fitter_id: args.fitterId, identity_snapshot: args.identitySnapshot,
      employee_name: args.employeeName, employee_email: args.employeeEmail, internal_ref: args.internalRef,
      required_hours: args.requiredHours, valid_hours: args.validHours, missing_hours: args.missingHours,
      };
    }],
    [repository, "upsertMailLog", async (_client, args) => { mailLogs.push(args); return { id: uuid(50), ...args }; }],
    [repository, "findEmployeeMailLog", async () => existingMail],
    [repository, "finishRun", async (_client, args) => ({ id: uuid(10), ...args, mode: createdMode })],
    [emailOutboxService, "enqueueEmail", async (_client, args) => { outbox.push(args); return { id: uuid(60), status: "queued" }; }],
    [auditService, "logAuditEvent", async () => {}],
  ], async () => {
    runResult = await service.runTimeControl({ query: async () => ({ rows: [] }) }, {
      tenantId: uuid(1), controlType, controlledDate: "2026-10-09", dryRun,
    }, { hoursDataset, hoursDatasetId, allowHistoricalSnapshot });
  });
  return { mailLogs, outbox, createdMode, settings, results, runResult };
}

test("Friday dry-run records employee plus DEP copy and DEP/LKE summary without enqueue", async () => {
  const { mailLogs, outbox } = await runMailScenario({ mode: "dry_run" });
  assert.equal(outbox.length, 0);
  assert.equal(mailLogs.length, 2);
  assert.deepEqual(mailLogs[0].recipientEmails, ["mikkel@example.test"]);
  assert.deepEqual(mailLogs[0].ccEmails, ["dep@hoyrup-clemmensen.dk"]);
  assert.equal(mailLogs[1].mailType, "friday_manager_summary");
  assert.deepEqual(mailLogs[1].recipientEmails, ["dep@hoyrup-clemmensen.dk", "lke@hoyrup-clemmensen.dk"]);
  assert.ok(mailLogs.every((mail) => mail.status === "would_send" && mail.mode === "dry_run"));
});

test("unknown, absent and invalid hours are distinct from explicitly excluded pay codes", () => {
  const summary = logic.summarizeHours([
    { source_key: "known", fitter_category_reference: "3300", hours: 2 },
    { source_key: "excluded", fitter_category_reference: "1244", hours: 1 },
    { source_key: "unknown", fitter_category_reference: "9999", hours: 3 },
    { source_key: "absent", fitter_category_id: "0", hours: 2 },
    { source_key: "invalid", fitter_category_reference: "3300", hours: "bad" },
    { source_key: "negative", fitter_category_reference: "3300", hours: -1 },
  ], rules);
  assert.equal(summary.validHours, 2);
  assert.deepEqual(summary.excludedPayCodes, [{ pay_code: "1244", hours: 1 }]);
  assert.equal(summary.unclassifiedHours, 5);
  assert.deepEqual(summary.unclassifiedRows.map((row) => row.reason), [
    "unknown_pay_code", "missing_pay_code", "invalid_hours", "invalid_hours",
  ]);
  assert.equal(summary.unclassifiedRows[0].source_key, "unknown");
  const evaluation = logic.evaluateHoursData({ summary, requiredHours: 7.5, coverage: { status: "complete" } });
  assert.equal(evaluation.status, "unclassified_hours");
  assert.equal(evaluation.missingHours, null);
});

test("current repository never asserts complete period coverage from local rows or sync timestamps", async () => {
  const coverage = await repository.getHoursPeriodCoverage({
    query: async () => { throw new Error("no_existing_period_coverage_producer"); },
  }, { tenantId: uuid(1), fitterId: "35", controlledDate: "2026-10-09" });
  assert.deepEqual(coverage, { status: "incomplete", reason: "period_coverage_not_verified:synced_rows_only" });
});

test("fresh sync with incomplete coverage blocks reminders and records unknown hours separately", async () => {
  for (const mode of ["dry_run", "live"]) {
    const scenario = await runMailScenario({
      mode, coverage: { status: "incomplete", reason: "closed_projects_not_covered" },
      hourRows: [{ fitter_category_reference: "3300", hours: 6 }, { fitter_category_id: "0", hours: 1 }],
    });
    assert.equal(scenario.runResult.run.status, "blocked");
    assert.equal(scenario.results[0].status, "data_incomplete");
    assert.equal(scenario.results[0].missingHours, null);
    assert.equal(scenario.results[0].unclassifiedHours, 1);
    assert.equal(scenario.results[0].unclassifiedRows[0].reason, "missing_pay_code");
    assert.equal(scenario.results[0].dataQualityReason, "closed_projects_not_covered");
    assert.deepEqual(scenario.mailLogs.map((mail) => mail.mailType), ["internal_error"]);
    assert.ok(scenario.outbox.every((mail) => mail.templateKey === "time_control.internal_error"));
    if (mode === "dry_run") assert.equal(scenario.outbox.length, 0);
  }
});

test("complete coverage but unknown salary code suppresses employee and Friday missing-hours mail", async () => {
  const scenario = await runMailScenario({
    mode: "dry_run", hourRows: [{ fitter_category_reference: "9999", hours: 7 }],
  });
  assert.equal(scenario.results[0].status, "unclassified_hours");
  assert.equal(scenario.results[0].coverageStatus, "complete");
  assert.equal(scenario.results[0].missingHours, null);
  assert.equal(scenario.results[0].unclassifiedHours, 7);
  assert.deepEqual(scenario.mailLogs.map((mail) => mail.mailType), ["internal_error"]);
});

test("empty and sufficient local hours remain uncertain without a complete period proof", async () => {
  for (const hourRows of [[], [{ fitter_category_reference: "3300", hours: 7 }]]) {
    const scenario = await runMailScenario({ mode: "dry_run", coverage: null, hourRows });
    assert.equal(scenario.results[0].status, "data_incomplete");
    assert.equal(scenario.results[0].missingHours, null);
    assert.equal(scenario.runResult.run.status, "blocked");
    assert.deepEqual(scenario.mailLogs.map((mail) => mail.mailType), ["internal_error"]);
  }
});

test("only complete, classified hours can distinguish missing registrations from sufficient hours", async () => {
  const absent = await runMailScenario({ mode: "dry_run", hourRows: [] });
  assert.equal(absent.results[0].status, "missing_hours");
  assert.equal(absent.results[0].missingHours, 7);
  const sufficient = await runMailScenario({
    mode: "dry_run", hourRows: [{ fitter_category_reference: "3300", hours: 7 }],
  });
  assert.equal(sufficient.results[0].status, "ok");
  assert.equal(sufficient.mailLogs.length, 0);
});

test("repository persists data uncertainty and unknown rows without a fabricated missing-hours amount", async () => {
  const unclassifiedRows = [{ source_key: "id:1", pay_code: null, hours: 7, reason: "missing_pay_code" }];
  let call;
  await repository.upsertResult({
    query: async (sql, params) => { call = { sql, params }; return { rows: [{ id: uuid(40) }] }; },
  }, {
    tenantId: uuid(1), runId: uuid(10), employeeConfigId: uuid(20), internalRef: "MHJ",
    requiredHours: 7, validHours: 0, missingHours: null, status: "data_incomplete",
    coverageStatus: "incomplete", dataQualityReason: "period_coverage_not_verified",
    unclassifiedHours: 7, unclassifiedRows,
  });
  assert.equal(call.params[10], null);
  assert.equal(call.params[15], "incomplete");
  assert.equal(call.params[17], 7);
  assert.deepEqual(JSON.parse(call.params[18]), unclassifiedRows);
  assert.match(call.sql, /ON CONFLICT \(run_id, employee_config_id\)/);
  assert.match(call.sql, /unclassified_rows = EXCLUDED.unclassified_rows/);
});

test("mocked live mail construction queues employee/DEP and Friday DEP/LKE as actual recipients", async () => {
  const { outbox } = await runMailScenario({ mode: "live" });
  assert.equal(outbox.length, 2);
  assert.equal(outbox[0].recipientEmail, "mikkel@example.test");
  assert.deepEqual(outbox[0].payload.cc_emails, ["dep@hoyrup-clemmensen.dk"]);
  assert.equal(outbox[1].recipientEmail, "dep@hoyrup-clemmensen.dk");
  assert.deepEqual(outbox[1].payload.cc_emails, ["lke@hoyrup-clemmensen.dk"]);
  assert.ok(outbox.every((mail) => mail.payload.sender === service.SENDER && mail.sourceType === "time_control"));
});

test("Friday summary preserves every additional manager as normalized CC without duplicates", async () => {
  const { outbox } = await runMailScenario({
    mode: "live",
    managerEmails: ["dep@hoyrup-clemmensen.dk", " LKE@hoyrup-clemmensen.dk ", "manager@example.test", "lke@hoyrup-clemmensen.dk"],
  });
  assert.equal(outbox[1].recipientEmail, "dep@hoyrup-clemmensen.dk");
  assert.deepEqual(outbox[1].payload.cc_emails, ["lke@hoyrup-clemmensen.dk", "manager@example.test"]);
});

test("internal sync-error mail routes first recipient to To and remaining recipients to CC", async () => {
  const { outbox, mailLogs } = await runMailScenario({ mode: "live", syncFailed: true });
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].templateKey, "time_control.internal_error");
  assert.equal(outbox[0].recipientEmail, "dep@hoyrup-clemmensen.dk");
  assert.deepEqual(outbox[0].payload.cc_emails, ["lke@hoyrup-clemmensen.dk"]);
  assert.equal(outbox[0].payload.sender, service.SENDER);
  assert.equal(mailLogs[0].mailType, "internal_error");
});

test("explicit dry-run never enqueues internal error mail even with mocked live settings", async () => {
  const { outbox, mailLogs } = await runMailScenario({ mode: "live", dryRun: true, syncFailed: true });
  assert.equal(outbox.length, 0);
  assert.equal(mailLogs.length, 1);
  assert.equal(mailLogs[0].mode, "dry_run");
  assert.equal(mailLogs[0].status, "would_send");
  assert.deepEqual(mailLogs[0].recipientEmails, ["dep@hoyrup-clemmensen.dk", "lke@hoyrup-clemmensen.dk"]);
});

test("pool runner commits preparation before worker polling and starts result transaction only after sync", async () => {
  const pool = require("../backend/src/db/pool");
  const syncJobs = require("../backend/src/db/queries/syncJob");
  const events = [];
  let queued = false;
  let visible = false;
  let fresh = false;
  let transactionOpen = false;
  const controlClient = {
    query: async (sql) => {
      events.push(`control:${sql}`);
      if (sql === "BEGIN") transactionOpen = true;
      if (sql === "COMMIT") {
        visible = queued;
        transactionOpen = false;
      }
      return { rows: [] };
    },
    release: () => events.push("control:release"),
  };
  const workerClient = {
    query: async (sql) => {
      if (sql.includes("SELECT id, tenant_id")) {
        assert.equal(visible, true, "worker must see a committed job");
        assert.equal(transactionOpen, false, "control must not hold a transaction while waiting");
        events.push("worker:claim");
        return { rows: [{ id: uuid(11), tenant_id: uuid(1), type: "manual_full_resync", status: "queued" }] };
      }
      return { rows: [{ id: uuid(11), status: "running" }] };
    },
  };
  let connections = 0;
  await withPatches([
    [pool, "connect", async () => { connections += 1; return controlClient; }],
    [repository, "acquireRunLock", async () => true],
    [repository, "releaseRunLock", async () => {}],
    [global, "setTimeout", (fn) => { fn(); }],
    [repository, "getSettings", async () => ({ is_enabled: true, mode: "dry_run", sync_wait_seconds: 1 })],
    [repository, "upsertRun", async () => ({ id: uuid(10), control_type: "manual", controlled_date: "2026-10-08", mode: "dry_run" })],
    [repository, "getFitterhoursSyncState", async () => {
      if (visible) {
        await syncJobs.claimNextSyncJob(workerClient);
        fresh = true;
      }
      return fresh ? { endpoint_status: "success", last_successful_sync_at: new Date().toISOString() } : null;
    }],
    [repository, "queueFitterhoursSync", async (client, input) => {
      assert.equal(client, controlClient);
      assert.equal(input.tenantId, uuid(1));
      assert.equal(input.metadata.run_id, uuid(10));
      assert.equal(visible, false);
      events.push("control:insert_sync_job");
      queued = true;
      return { id: uuid(11), status: "queued" };
    }],
    [repository, "updateRunSync", async (client) => { assert.equal(client, controlClient); }],
    [repository, "listEmployeeConfigs", async () => {
      assert.equal(transactionOpen, true);
      assert.equal(fresh, true);
      return [];
    }],
    [repository, "listPayCodeRules", async () => []],
    [repository, "finishRun", async (_client, args) => ({ id: uuid(10), ...args, mode: "dry_run" })],
    [emailOutboxService, "enqueueEmail", async () => { throw new Error("dry_run_must_not_enqueue"); }],
    [auditService, "logAuditEvent", async () => {}],
  ], async () => {
    const result = await service.runTimeControlWithPool({
      tenantId: uuid(1), controlType: "manual", controlledDate: "2026-10-08", dryRun: true,
    });
    assert.equal(result.run.status, "completed");
    assert.equal(result.sync.status, "fresh");
  });
  assert.equal(connections, 1);
  assert.deepEqual(events, [
    "control:BEGIN", "control:insert_sync_job", "control:COMMIT",
    "control:SELECT id, status, error_message FROM sync_job WHERE tenant_id = $1 AND id = $2",
    "worker:claim", "control:BEGIN", "control:COMMIT", "control:release",
  ]);
});

test("failed sync enqueue rolls back preparation and releases the control connection", async () => {
  const pool = require("../backend/src/db/pool");
  const events = [];
  const makeClient = (name) => ({
    query: async (sql) => { events.push(`${name}:${sql}`); return { rows: [] }; },
    release: () => events.push(`${name}:release`),
  });
  const controlClient = makeClient("control");
  let connections = 0;
  await withPatches([
    [pool, "connect", async () => { connections += 1; return controlClient; }],
    [repository, "acquireRunLock", async () => true],
    [repository, "releaseRunLock", async () => {}],
    [repository, "getSettings", async () => ({ is_enabled: true, mode: "dry_run" })],
    [repository, "upsertRun", async () => ({ id: uuid(10), mode: "dry_run" })],
    [repository, "getFitterhoursSyncState", async () => null],
    [repository, "queueFitterhoursSync", async () => { throw new Error("sync_enqueue_failed"); }],
  ], async () => {
    await assert.rejects(service.runTimeControlWithPool({
      tenantId: uuid(1), controlType: "manual", controlledDate: "2026-10-08", dryRun: true,
    }), /sync_enqueue_failed/);
  });
  assert.equal(connections, 1);
  assert.deepEqual(events, ["control:BEGIN", "control:ROLLBACK", "control:release"]);
});

test("timeout, worker failure and loss after preparation retain identifiable runs and release ownership", async () => {
  const pool = require("../backend/src/db/pool");
  for (const scenario of ["timeout", "worker-failure", "process-loss"]) {
    const events = [];
    const mailLogs = [];
    let persistedRun = null;
    let pendingRun = null;
    let queued = false;
    const client = {
      query: async (sql) => {
        events.push(sql);
        if (sql === "COMMIT") persistedRun = { ...pendingRun };
        return { rows: [] };
      },
      release: () => events.push("release"),
    };
    await withPatches([
      [pool, "connect", async () => client],
      [repository, "acquireRunLock", async () => true],
      [repository, "releaseRunLock", async () => events.push("unlock")],
      [global, "setTimeout", (fn) => fn()],
      [repository, "getSettings", async () => ({
        is_enabled: true, mode: "dry_run", sync_wait_seconds: scenario === "timeout" ? 0 : 1,
        internal_error_emails: ["dep@example.test"],
      })],
      [repository, "upsertRun", async () => {
        pendingRun = {
          id: uuid(10), status: "running", finished_at: null,
          control_type: "daily_09", controlled_date: "2026-10-08", mode: "dry_run",
        };
        return pendingRun;
      }],
      [repository, "getFitterhoursSyncState", async () => null],
      [repository, "queueFitterhoursSync", async () => { queued = true; return { id: uuid(11), status: "queued" }; }],
      [repository, "updateRunSync", async (_client, input) => {
        Object.assign(pendingRun, { sync_status: input.syncStatus, sync_job_id: input.syncJobId });
      }],
      [repository, "getSyncJob", async (_client, input) => {
        assert.equal(input.tenantId, uuid(1));
        assert.equal(input.jobId, uuid(11));
        assert.equal(persistedRun.status, "running");
        if (scenario === "process-loss") throw new Error("connection_lost_after_commit");
        return { id: uuid(11), status: "failed", error_message: "worker_retries_exhausted" };
      }],
      [repository, "finishRun", async (_client, input) => {
        Object.assign(pendingRun, { status: input.status, finished_at: new Date().toISOString() });
        return { ...pendingRun };
      }],
      [repository, "upsertMailLog", async (_client, input) => { mailLogs.push(input); return input; }],
      [repository, "listEmployeeConfigs", async () => { throw new Error("uncertain_sync_must_not_evaluate"); }],
      [emailOutboxService, "enqueueEmail", async () => { throw new Error("dry_run_must_not_enqueue"); }],
      [auditService, "logAuditEvent", async () => {}],
    ], async () => {
      const args = { tenantId: uuid(1), controlType: "daily_09", controlledDate: "2026-10-08", dryRun: true };
      if (scenario === "process-loss") {
        await assert.rejects(service.runTimeControlWithPool(args), /connection_lost_after_commit/);
        assert.equal(persistedRun.status, "running");
        assert.equal(persistedRun.finished_at, null);
        assert.equal(mailLogs.length, 0);
        assert.deepEqual(events, ["BEGIN", "COMMIT", "unlock", "release"]);
      } else {
        const result = await service.runTimeControlWithPool(args);
        assert.equal(result.run.status, "blocked");
        assert.equal(result.sync.status, scenario === "timeout" ? "timeout" : "failed");
        assert.equal(persistedRun.status, "blocked");
        assert.notEqual(persistedRun.finished_at, null);
        assert.deepEqual(mailLogs.map((mail) => mail.mailType), ["internal_error"]);
        assert.deepEqual(events, ["BEGIN", "COMMIT", "BEGIN", "COMMIT", "unlock", "release"]);
      }
    });
    assert.equal(queued, true);
    assert.equal(persistedRun.sync_job_id, uuid(11));
  }
});

test("session lock prevents simultaneous rerun across preparation commit and destroys a client if unlock fails", async () => {
  const pool = require("../backend/src/db/pool");
  const calls = [];
  const input = { tenantId: uuid(1), controlType: "daily_09", controlledDate: "2026-10-08" };
  const client = {
    query: async (sql, params) => { calls.push({ sql, params }); return { rows: [{ locked: true, unlocked: true }] }; },
  };
  assert.equal(await repository.acquireRunLock(client, input), true);
  await repository.releaseRunLock(client, input);
  assert.match(calls[0].sql, /pg_try_advisory_lock/);
  assert.match(calls[1].sql, /pg_advisory_unlock/);
  assert.deepEqual(calls[0].params, [`time_control:${uuid(1)}:daily_09:2026-10-08`]);
  assert.deepEqual(calls[1].params, calls[0].params);
  await assert.rejects(repository.acquireRunLock({ query: async () => ({ rows: [] }) }, input), /acquisition_uncertain/);
  await assert.rejects(repository.releaseRunLock({ query: async () => ({ rows: [{ unlocked: false }] }) }, input), /lock_release_failed/);
  const releases = [];
  await withPatches([
    [pool, "connect", async () => ({
      query: async () => { throw new Error("must_not_open_transaction"); },
      release: (error) => releases.push(error),
    })],
    [repository, "acquireRunLock", async () => false],
  ], async () => {
    await assert.rejects(service.runTimeControlWithPool(input), /time_control_run_already_in_progress/);
  });
  assert.deepEqual(releases, [undefined]);
  const unlockError = new Error("unlock_failed");
  await withPatches([
    [pool, "connect", async () => ({ query: async () => ({ rows: [] }), release: (error) => releases.push(error) })],
    [repository, "acquireRunLock", async () => true],
    [repository, "releaseRunLock", async () => { throw unlockError; }],
    [repository, "getSettings", async () => { throw new Error("evaluation_not_started"); }],
  ], async () => {
    await assert.rejects(service.runTimeControlWithPool(input), /unlock_failed/);
  });
  assert.equal(releases[1], unlockError);
});

test("partial, running and future sync timestamps are never fresh enough to evaluate", () => {
  const now = new Date("2026-10-11T00:00:00Z");
  const state = { endpoint_status: "success", last_successful_sync_at: now.toISOString() };
  assert.equal(service._test.isFreshSyncState(state, 180, now), true);
  for (const patch of [
    { endpoint_status: "partial" }, { current_job_id: uuid(11) }, { active_job_id: uuid(11) },
    { pending_backlog_count: 1 }, { failed_page_count: 1 },
    { last_successful_sync_at: "2026-10-11T00:01:00Z" },
  ]) assert.equal(service._test.isFreshSyncState({ ...state, ...patch }, 180, now), false);
});

test("retry reuses run/result/mail conflict keys and never resets an already sent outbox row", async () => {
  const outboxRepository = require("../backend/src/modules/notifications/emailOutbox.repository");
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ id: uuid(10), status: "sent" }] };
    },
  };
  const runArgs = {
    tenantId: uuid(1), controlType: "daily_09", controlledDate: "2026-10-08",
    mode: "dry_run", requiredHours: 7.5, triggeredBy: "maintenance",
  };
  const resultArgs = {
    tenantId: uuid(1), runId: uuid(10), employeeConfigId: uuid(20), internalRef: "MHJ",
    requiredHours: 7.5, validHours: 6, missingHours: 1.5, status: "missing_hours", coverageStatus: "complete",
  };
  const key = `time_control:${uuid(1)}:daily_09:2026-10-08:employee:${uuid(30)}`;
  const mailArgs = {
    tenantId: uuid(1), runId: uuid(10), resultId: uuid(40), mailType: "employee_missing_hours",
    mode: "dry_run", status: "would_send", recipientEmails: ["tech@example.test"],
    subject: "Timekontrol", bodyPreview: "Test", idempotencyKey: key,
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.equal((await repository.upsertRun(client, runArgs)).id, uuid(10));
    await repository.upsertResult(client, resultArgs);
    await repository.upsertMailLog(client, mailArgs);
    const outbox = await outboxRepository.upsertEmail(client, {
      tenantId: uuid(1), templateId: uuid(70), templateKey: "time_control.missing_hours.employee",
      recipientEmail: "tech@example.test", subject: "Test", htmlBody: "Test", textBody: "Test",
      sourceType: "time_control", sourceId: uuid(40), idempotencyKey: key,
    });
    assert.equal(outbox.status, "sent");
  }
  assert.match(calls[0].sql, /ON CONFLICT \(tenant_id, control_type, controlled_date\)/);
  assert.match(calls[1].sql, /ON CONFLICT \(run_id, employee_config_id\)/);
  assert.match(calls[2].sql, /ON CONFLICT \(tenant_id, idempotency_key\)/);
  assert.match(calls[3].sql, /ON CONFLICT \(tenant_id, idempotency_key\)/);
  const update = calls[3].sql.split("DO UPDATE SET")[1].split("RETURNING")[0];
  assert.doesNotMatch(update, /\b(status|sent_at|attempt_count|next_attempt_at)\s*=/);
  for (let i = 0; i < 4; i += 1) assert.deepEqual(calls[i].params, calls[i + 4].params);
  const migration = read("migrations/0049_time_control_poc.sql");
  assert.match(migration, /UNIQUE \(tenant_id, control_type, controlled_date\)/);
  assert.match(migration, /UNIQUE \(run_id, employee_config_id\)/);
  assert.match(migration, /UNIQUE \(tenant_id, idempotency_key\)/);
});

test("overview exposes committed unfinished runs independently of latest ten runs and scopes the query", async () => {
  const run = { id: uuid(10), tenant_id: uuid(1), status: "running", finished_at: null, sync_job_id: uuid(11) };
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: sql.includes("finished_at IS NULL") ? [run] : [] };
    },
  };
  const overview = await repository.getStatusOverview(client, { tenantId: uuid(1) });
  assert.deepEqual(overview.unfinished_runs, [run]);
  const unfinished = calls.find((call) => call.sql.includes("finished_at IS NULL"));
  assert.match(unfinished.sql, /tenant_id = \$1/);
  assert.match(unfinished.sql, /status = 'running'/);
  assert.deepEqual(unfinished.params, [uuid(1)]);
});

test("data-quality migration preserves 0049 and adds diagnostic states without changing identities or settings", () => {
  const migration = read("migrations/0050_time_control_data_quality.sql");
  assert.match(migration, /ALTER TABLE time_control_result/);
  assert.match(migration, /ALTER COLUMN missing_hours DROP NOT NULL/);
  assert.match(migration, /coverage_status text NOT NULL DEFAULT 'incomplete'/);
  assert.match(migration, /'data_incomplete', 'unclassified_hours'/);
  assert.match(migration, /unclassified_rows jsonb NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.doesNotMatch(migration, /UPDATE|DELETE|INSERT|tenant_user|resource_groups|time_control_settings/i);
});

test("fresh sync, no-wait sync and evaluation failures preserve the two-phase transaction boundary", async () => {
  const pool = require("../backend/src/db/pool");
  for (const scenario of ["fresh", "no-wait", "evaluation-error"]) {
    const events = [];
    let jobCommitted = false;
    let jobQueued = false;
    const client = {
      query: async (sql) => {
        events.push(sql);
        if (sql === "COMMIT" && jobQueued) jobCommitted = true;
        return { rows: [] };
      },
      release: () => events.push("release"),
    };
    await withPatches([
      [pool, "connect", async () => client],
      [repository, "acquireRunLock", async () => true],
      [repository, "releaseRunLock", async () => {}],
      [repository, "getSettings", async () => ({ is_enabled: true, mode: "dry_run" })],
      [repository, "upsertRun", async () => ({ id: uuid(10), mode: "dry_run" })],
      [repository, "getFitterhoursSyncState", async () => scenario === "fresh"
        ? { endpoint_status: "success", last_successful_sync_at: new Date().toISOString() } : null],
      [repository, "queueFitterhoursSync", async () => {
        jobQueued = true;
        return { id: uuid(11), status: "queued" };
      }],
      [repository, "updateRunSync", async () => {}],
      [repository, "listEmployeeConfigs", async () => []],
      [repository, "listPayCodeRules", async () => []],
      [repository, "finishRun", async (_client, args) => {
        if (scenario === "evaluation-error") throw new Error("evaluation_failed");
        return { id: uuid(10), ...args, mode: "dry_run" };
      }],
      [repository, "upsertMailLog", async () => ({ id: uuid(50) })],
      [auditService, "logAuditEvent", async () => {}],
      [emailOutboxService, "enqueueEmail", async () => { throw new Error("dry_run_must_not_enqueue"); }],
    ], async () => {
      const args = {
        tenantId: uuid(1), controlType: "manual", controlledDate: "2026-10-08", dryRun: true, waitForSync: false,
      };
      if (scenario === "evaluation-error") {
        await assert.rejects(service.runTimeControlWithPool(args), /evaluation_failed/);
      } else {
        const result = await service.runTimeControlWithPool(args);
        assert.equal(result.sync.status, scenario === "fresh" ? "fresh" : "queued");
      }
    });
    assert.deepEqual(events, ["BEGIN", "COMMIT", "BEGIN", scenario === "evaluation-error" ? "ROLLBACK" : "COMMIT", "release"]);
    assert.equal(jobCommitted, scenario !== "fresh", "evaluation rollback must not unpublish a committed sync job");
  }
});

test("explicit dry-run overrides mocked live settings without changing them or enqueueing", async () => {
  const { outbox, mailLogs, createdMode, settings } = await runMailScenario({ mode: "live", dryRun: true });
  assert.equal(outbox.length, 0);
  assert.equal(createdMode, "dry_run");
  assert.equal(settings.mode, "live");
  assert.ok(mailLogs.every((mail) => mail.mode === "dry_run" && mail.status === "would_send"));
  const cli = read("backend/scripts/run_time_control.js");
  assert.match(cli, /arg === "--dry-run"\) args\.dryRun = true/);
  assert.match(cli, /dryRun: args\.dryRun/);
});

test("dry-run rejects invalid employee CC instead of recording a successful preview", async () => {
  await assert.rejects(runMailScenario({ mode: "dry_run", ccEmails: ["invalid"] }), {
    code: "time_control_recipient_email_invalid",
  });
});

test("live activation requires exact tenant confirmation before opening a database connection", async () => {
  const pool = require("../backend/src/db/pool");
  await withPatches([
    [pool, "connect", async () => { throw new Error("database_must_not_be_opened"); }],
  ], async () => {
    for (const confirm of [undefined, "", "AKTIVER:timekontrol-live:another-tenant"]) {
      await assert.rejects(service.setMode({
        tenantId: uuid(1), actorId: uuid(2), tenantSlug: "hoyrup-clemmensen", mode: "live", confirm,
      }), /time_control_live_confirm_required/);
    }
  });
  assert.equal((await repository.getSettings({ query: async () => ({ rows: [] }) }, { tenantId: uuid(1) })).mode, "dry_run");
  const scheduler = require("../backend/src/modules/timeControl/timeControl.scheduler");
  const previous = process.env.TIME_CONTROL_SCHEDULER_ENABLED;
  try {
    delete process.env.TIME_CONTROL_SCHEDULER_ENABLED;
    assert.equal(scheduler._test.schedulerEnabled(), false);
  } finally {
    if (previous === undefined) delete process.env.TIME_CONTROL_SCHEDULER_ENABLED;
    else process.env.TIME_CONTROL_SCHEDULER_ENABLED = previous;
  }
});

test("dry-run missing hours logs would-send mails without real outbox enqueue and keeps retry idempotency stable", async () => {
  const mailLogs = [];
  let outboxCount = 0;
  const config = { id: uuid(20), tenant_id: uuid(1), internal_ref: "MHJ", fitter_id: "35" };
  const resolved = [approvedEmployee()];

  async function runOnce() {
    return service.runTimeControl({ query: async () => ({ rows: [] }) }, {
      tenantId: uuid(1),
      controlType: "daily_09",
      controlledDate: "2026-10-08",
      waitForSync: true,
    });
  }

  await withPatches([
    [repository, "getSettings", async () => ({
      is_enabled: true,
      mode: "dry_run",
      sync_freshness_minutes: 180,
      employee_cc_emails: ["dep@hoyrup-clemmensen.dk"],
      friday_manager_emails: ["dep@hoyrup-clemmensen.dk", "LKE@hoyrup-clemmensen.dk"],
    })],
    [repository, "upsertRun", async () => ({ id: uuid(10), tenant_id: uuid(1), control_type: "daily_09", controlled_date: "2026-10-08", mode: "dry_run" })],
    [repository, "getFitterhoursSyncState", async () => ({ endpoint_status: "success", last_successful_sync_at: new Date().toISOString() })],
    [repository, "updateRunSync", async () => null],
    [repository, "listEmployeeConfigs", async () => [config]],
    [repository, "listPayCodeRules", async () => Array.from(rules.entries()).map(([pay_code, counts_as_valid_hours]) => ({ pay_code, counts_as_valid_hours }))],
    [repository, "resolveEmployeeConfig", async () => resolved],
    [repository, "listHoursForFitterDate", async () => [{ fitter_category_reference: "3300", hours: 6 }]],
    [repository, "getHoursPeriodCoverage", async () => ({ status: "complete" })],
    [repository, "upsertResult", async (_client, args) => ({ id: uuid(40), ...args, fitter_id: args.fitterId, employee_name: args.employeeName, employee_email: args.employeeEmail, tenant_user_id: args.tenantUserId })],
    [repository, "findEmployeeMailLog", async () => null],
    [repository, "upsertMailLog", async (_client, args) => {
      mailLogs.push(args);
      return { id: uuid(50), ...args };
    }],
    [repository, "finishRun", async (_client, args) => ({ id: uuid(10), ...args, mode: "dry_run", control_type: "daily_09", controlled_date: "2026-10-08" })],
    [emailOutboxService, "enqueueEmail", async () => {
      outboxCount += 1;
      return { id: uuid(60), status: "queued" };
    }],
    [auditService, "logAuditEvent", async () => {}],
  ], async () => {
    await runOnce();
    await runOnce();
  });

  assert.equal(outboxCount, 0);
  assert.equal(mailLogs.length, 2);
  assert.equal(mailLogs[0].idempotencyKey, mailLogs[1].idempotencyKey);
  assert.equal(mailLogs[0].status, "would_send");
  assert.deepEqual(mailLogs[0].recipientEmails, ["mikkel@example.test"]);
  assert.deepEqual(mailLogs[0].ccEmails, ["dep@hoyrup-clemmensen.dk"]);
});

test("unresolved fitter mapping is visible as config error and does not mail employee", () => {
  const unresolved = service._test.classifyResolvedEmployee({ id: uuid(1), internal_ref: "MHJ" }, []);
  const ambiguous = service._test.classifyResolvedEmployee({ id: uuid(1), internal_ref: "MHJ" }, [{}, {}]);
  assert.equal(unresolved.ok, false);
  assert.equal(unresolved.configError, "verified_fitter_mapping_missing");
  assert.equal(ambiguous.configError, "verified_fitter_mapping_ambiguous");
});

test("login is optional; only the approved email snapshot supplies recipients", () => {
  const config = { id: uuid(20), internal_ref: "MHJ", fitter_id: "35" };
  for (const tenantUserId of [null, uuid(30)]) {
    const resolved = service._test.classifyResolvedEmployee(config, [approvedEmployee({
      tenant_user_id: tenantUserId, tenant_user_email: "wrong@example.test", tenant_user_login_status: "inactive",
    })]);
    assert.equal(resolved.ok, true);
    assert.equal(resolved.employee.email, "mikkel@example.test");
    assert.equal(resolved.employee.tenantUserId, tenantUserId);
    assert.equal(resolved.employee.identitySnapshot.group_id, uuid(70));
  }
  for (const [patch, expected] of [
    [{ is_active_derived: null }, "verified_identity_chain_incomplete"],
    [{ is_active_derived: false }, "verified_identity_chain_incomplete"],
    [{ fitter_id: "36" }, "verified_identity_chain_incomplete"],
    [{ resource_group_id: null }, "verified_identity_chain_incomplete"],
    [{ email_approved_at: null }, "employee_email_not_approved"],
    [{ approval_version: undefined }, "employee_email_not_approved"],
    [{ fitter_email: "imported-change@example.test" }, "employee_email_approval_stale"],
  ]) assert.equal(service._test.classifyResolvedEmployee(config, [approvedEmployee(patch)]).configError, expected);
  const override = service._test.classifyResolvedEmployee(config, [approvedEmployee({
    email_source: "admin_override", fitter_email: "imported-change@example.test",
  })]);
  assert.equal(override.employee.email, "mikkel@example.test");
  assert.equal(service._test.classifyResolvedEmployee({ ...config, fitter_id: null }, [approvedEmployee()]).ok, false);
});

test("administrator approval locks and audits exact fitter/group/email atomically, including conflicts", async () => {
  const pool = require("../backend/src/db/pool");
  const input = {
    tenantId: uuid(1), actorId: uuid(2), configId: uuid(20), fitterId: "35", groupId: uuid(70),
    email: " MIKKEL@example.test ", source: "fitter_master", reason: "Kontrolleret mod EK", expectedVersion: 0,
  };
  for (const scenario of ["success", "missing", "stale", "source", "reassign", "audit-failure"]) {
    const calls = [];
    const client = { query: async (sql) => { calls.push(sql); return { rows: [] }; }, release: () => calls.push("release") };
    let saved = null;
    let audit = null;
    await withPatches([
      [pool, "connect", async () => client],
      [repository, "lockEmployeeConfig", async (c, args) => {
        assert.equal(c, client);
        assert.deepEqual(args, { tenantId: uuid(1), configId: uuid(20) });
        return { approval_version: scenario === "stale" ? 1 : 0, resource_group_external_id: "61", approved_email: null };
      }],
      [repository, "getApprovalTarget", async (_c, args) => {
        assert.deepEqual(args, { tenantId: uuid(1), fitterId: "35", groupId: uuid(70), externalId: "61" });
        return scenario === "missing" ? null : { fitter_id: "35", group_id: uuid(70), email: "mikkel@example.test" };
      }],
      [repository, "approveEmployeeEmail", async (_c, args) => {
        saved = args;
        return { approved_email: args.email, approval_version: 1 };
      }],
      [auditService, "logAuditEvent", async (args) => {
        audit = args;
        if (scenario === "audit-failure") throw new Error("audit_unavailable");
      }],
    ], async () => {
      if (scenario === "success") {
        await service.approveEmployeeRecipient(input);
        assert.equal(saved.email, "mikkel@example.test");
        assert.equal(audit.actorId, uuid(2));
        assert.equal(audit.metadata.new_version, 1);
        assert.equal(audit.eventType, "time_control.employee_email_approved");
        assert.deepEqual(calls, ["BEGIN", "COMMIT", "release"]);
      } else if (scenario === "reassign") {
        await withPatches([[repository, "lockEmployeeConfig", async () => ({ approval_version: 1, fitter_id: "36" })]], async () => {
          await assert.rejects(service.approveEmployeeRecipient({ ...input, expectedVersion: 1 }), /approved_identity_immutable/);
        });
      } else {
        const message = { missing: /authoritative_membership_missing/, stale: /version_conflict/, source: /source_mismatch/, "audit-failure": /audit_unavailable/ }[scenario];
        await assert.rejects(service.approveEmployeeRecipient({
          ...input, ...(scenario === "source" ? { email: "wrong@example.test" } : {}),
        }), message);
      }
      if (scenario !== "success") assert.deepEqual(calls, ["BEGIN", "ROLLBACK", "release"]);
    });
  }
  await assert.rejects(service.approveEmployeeRecipient({ ...input, email: "invalid" }), /approval_email_invalid/);
});

test("approval repository scopes every identity/member query and does not change groups or logins", async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } };
  await repository.lockEmployeeConfig(client, { tenantId: uuid(1), configId: uuid(20) });
  await repository.getApprovalTarget(client, { tenantId: uuid(1), fitterId: "35", groupId: uuid(70), externalId: "61" });
  await repository.approveEmployeeEmail(client, {
    tenantId: uuid(1), configId: uuid(20), fitterId: "35", groupId: uuid(70),
    email: "mikkel@example.test", source: "fitter_master", sourceValue: "mikkel@example.test", actorId: uuid(2), reason: "Kontrolleret",
  });
  assert.match(calls[0].sql, /tenant_id = \$1 AND id = \$2 FOR UPDATE/);
  assert.match(calls[1].sql, /rgm\.tenant_id = f\.tenant_id/);
  assert.match(calls[1].sql, /rg\.tenant_id = rgm\.tenant_id/);
  assert.match(calls[1].sql, /f\.tenant_id = \$1 AND f\.fitter_id = \$2 AND f\.is_active_derived = true/);
  assert.match(calls[1].sql, /rg\.external_source = 'ekomplet' AND rg\.external_id = \$4/);
  assert.match(calls[2].sql, /WHERE tenant_id = \$1 AND id = \$2/);
  assert.doesNotMatch(calls.map((c) => c.sql).join("\n"), /UPDATE resource_group|INSERT INTO tenant_user/);
});

test("recipient approval route rejects cross-tenant actors and missing admin permission", async () => {
  const router = require("../backend/src/modules/timeControl/timeControl.routes");
  const access = require("../backend/src/services/moduleAccessService");
  const route = router.stack.find((layer) => layer.route?.path === "/api/tenant/admin/time-control/employees/:configId/recipient").route;
  const handler = route.stack.at(-1).handle;
  const errors = [];
  await withPatches([
    [access, "requireModuleAccess", () => { const error = new Error("denied"); error.statusCode = 403; throw error; }],
    [service, "approveEmployeeRecipient", async () => { throw new Error("must_not_write"); }],
    [console, "error", () => {}],
  ], async () => {
    for (const tenantId of [uuid(1), uuid(9)]) {
      await handler({ auth: { sub: uuid(2), tenant_id: tenantId }, context: { tenant: { id: uuid(1) } } }, {}, (error) => errors.push(error));
    }
  });
  assert.deepEqual(errors.map((error) => error.message), ["tenant_admin_access_denied", "tenant_context_mismatch"]);
});

test("recipient keys survive login and email changes without rewriting already queued mail", async () => {
  const initial = await runMailScenario({ mode: "live", controlType: "daily_09" });
  assert.equal(initial.outbox[0].recipientTenantUserId, null);
  assert.match(initial.outbox[0].idempotencyKey, /^time_control:v2:[a-f0-9]{64}$/);
  const existing = { id: uuid(50), email_outbox_id: uuid(60), recipient_emails: ["mikkel@example.test"] };
  const resolvedEmployee = [approvedEmployee({ tenant_user_id: uuid(31), approved_email: "other@example.test", email_source: "admin_override", approval_version: 2 })];
  const result = await runMailScenario({
    mode: "live", controlType: "daily_09",
    resolvedEmployee, existingMail: existing,
  });
  assert.equal(result.outbox.length, 0);
  assert.equal(result.runResult.mails[0], existing);
  const changed = await runMailScenario({
    mode: "dry_run", controlType: "daily_09", resolvedEmployee, storedRunDate: new Date("2026-10-08T22:00:00Z"),
  });
  assert.equal(changed.mailLogs[0].idempotencyKey, initial.outbox[0].idempotencyKey);
});

test("uncertain lock acquisition, rollback failure and unlock failure destroy the same pooled session", async () => {
  const pool = require("../backend/src/db/pool");
  for (const scenario of ["acquire", "rollback", "unlock"]) {
    const releases = [];
    const client = {
      query: async (sql) => {
        if (scenario === "rollback" && sql === "ROLLBACK") throw new Error("rollback_failed");
        return { rows: [] };
      },
      release: (error) => releases.push(error),
    };
    await withPatches([
      [pool, "connect", async () => client],
      [repository, "acquireRunLock", async (c) => {
        assert.equal(c, client);
        if (scenario === "acquire") throw new Error("acquire_response_lost");
        return true;
      }],
      [repository, "releaseRunLock", async (c) => {
        assert.equal(c, client);
        if (scenario === "unlock") throw new Error("unlock_failed");
      }],
      [repository, "getSettings", async () => { throw new Error("original_failure"); }],
    ], async () => {
      await assert.rejects(service.runTimeControlWithPool({
        tenantId: uuid(1), controlType: "daily_09", controlledDate: "2026-10-08",
      }), scenario === "acquire" ? /acquire_response_lost/ : /original_failure/);
    });
    assert.equal(releases.length, 1);
    assert.match(releases[0].message, /acquire_response_lost|rollback_failed|unlock_failed/);
  }
});

test("DEP group defaults use internal EK ID 61, never the 183 display prefix", async () => {
  const settings = await repository.getSettings({ query: async () => ({ rows: [] }) }, { tenantId: uuid(1) });
  assert.equal(settings.resource_group_external_id, "61");
  const calls = [];
  await repository.getApprovalTarget({
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    },
  }, { tenantId: uuid(1), fitterId: "15", groupId: uuid(70), externalId: "61" });
  assert.deepEqual(calls[0].params, [uuid(1), "15", uuid(70), "61"]);
  assert.match(calls[0].sql, /rg\.external_id = \$4/);
  assert.doesNotMatch(calls[0].sql, /rg\.name\s*=|LIKE|ILIKE/);
});

test("identity migration requires explicit approval, same-tenant references and unique fitter identity", () => {
  const migration = read("migrations/0051_time_control_fitter_identity.sql");
  assert.match(migration, /FOREIGN KEY \(approved_group_id, tenant_id\) REFERENCES resource_groups\(id, tenant_id\)/);
  assert.match(migration, /FOREIGN KEY \(email_approved_by_user_id, tenant_id\) REFERENCES tenant_user\(id, tenant_id\)/);
  assert.match(migration, /ON time_control_employee_config \(tenant_id, fitter_id\) WHERE fitter_id IS NOT NULL/);
  assert.match(migration, /time_control_approved_identity_immutable/);
  assert.match(migration, /identity_snapshot jsonb/);
  assert.doesNotMatch(migration, /INSERT INTO|UPDATE fitter|UPDATE resource_group|UPDATE time_control_settings/);
  for (const event of ["time_control.employee_email_approved", "time_control.run_completed", "time_control.run_blocked", "time_control.mode_changed"]) {
    assert.ok(auditService.ALLOWED_EVENT_TYPES.includes(event));
  }
  for (const event of auditService.ALLOWED_EVENT_TYPES) assert.ok(migration.includes(`'${event}'`), `Database audit allowlist must retain ${event}`);
});

function coverageEvidence() {
  const rows = [
    { id: "1", date: "2026-10-09T00:00:00", hours: 7, fitterId: 35, categoryId: 256, categoryReference: "3300", projectId: 50, projectReference: "P50" },
    { id: "2", date: "2026-10-09T00:00:00", hours: 3, fitterId: 24, categoryId: 291, categoryReference: "1236", projectId: 23050, projectReference: "12325-026" },
    { id: "3", date: "2026-10-09T00:00:00", hours: 1, fitterId: 24, categoryId: 0, categoryReference: null, projectId: 23050, projectReference: "12325-026" },
  ];
  const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const pass = {
    summary: { orderedIdsHash: digest(rows.map((row) => row.id)), canonicalRowsHash: digest(rows) },
    pageEvidence: [
      { page: 1, status: 200, rowCount: 2, total: 3, currentPage: 1, nextPage: 2, hasErrors: false, errorCount: 0 },
      { page: 2, status: 200, rowCount: 1, total: 3, currentPage: 2, nextPage: null, hasErrors: false, errorCount: 0 },
    ],
  };
  return {
    tenantId: uuid(1), endpoint: "/api/v4/paginatedfitterhours", fromDate: "2026-10-09", toDate: "2026-10-09",
    pageSize: 2, expectedTotal: 3, rows, passes: [structuredClone(pass), structuredClone(pass)],
    evidence: { closedProjectControl: { id: "2", fitterId: 24, projectId: 23050, hours: 3, isClosed: true } },
  };
}

test("coverage producer independently validates both passes and binds immutable rows to tenant/day", () => {
  const evidence = coverageEvidence();
  const dataset = hoursCoverage.createHoursDataset(evidence);
  const scope = { tenantId: uuid(1), controlledDate: "2026-10-09", fitterId: "35" };
  const originalRevision = dataset.proof.dataset_revision;
  evidence.rows[0].hours = 1;
  evidence.rows[0].categoryReference = "9999";
  evidence.passes[0].summary.canonicalRowsHash = "changed";
  const result = hoursCoverage.evaluateFitterDay(dataset, { ...scope, requiredHours: 7, payCodeRules: rules });
  assert.equal(result.evaluation.status, "ok");
  assert.equal(result.summary.validHours, 7);
  assert.equal(result.coverage.dataset_revision, originalRevision);
  assert.equal(Object.isFrozen(dataset.proof), true);
  const unknown = hoursCoverage.evaluateFitterDay(dataset, {
    ...scope, fitterId: "24", requiredHours: 7, payCodeRules: rules,
  });
  assert.equal(unknown.evaluation.status, "unclassified_hours");
  assert.equal(unknown.evaluation.missingHours, null);
  assert.equal(unknown.summary.unclassifiedRows.length, 2);
  const zero = hoursCoverage.evaluateFitterDay(dataset, { ...scope, fitterId: "99", requiredHours: 7, payCodeRules: rules });
  assert.equal(zero.evaluation.missingHours, 7);
  assert.equal(zero.evaluation.coverageStatus, "complete");
  assert.throws(() => hoursCoverage.getDatasetProof(dataset, { ...scope, tenantId: uuid(9) }), /scope_mismatch/);
  assert.throws(() => hoursCoverage.getDatasetProof(dataset, { ...scope, controlledDate: "2026-10-08" }), /scope_mismatch/);
  assert.throws(() => hoursCoverage.getDatasetProof({ proof: dataset.proof }, scope), /untrusted_dataset/);
});

test("coverage rejects gaps, errors, changed totals, duplicate IDs, bad dates, incomplete controls and unstable passes", () => {
  for (const mutate of [
    (e) => { delete e.tenantId; },
    (e) => { e.endpoint = "/api/v4/projects"; },
    (e) => { e.pageSize = 0; },
    (e) => { e.passes.pop(); },
    (e) => { e.passes[0].pageEvidence[0].status = 500; },
    (e) => { e.passes[0].pageEvidence[0].hasErrors = true; },
    (e) => { e.passes[0].pageEvidence[0].errorCount = 1; },
    (e) => { e.passes[0].pageEvidence[0].total = 4; },
    (e) => { e.passes[0].pageEvidence[0].nextPage = null; },
    (e) => { e.passes[1].pageEvidence[1].currentPage = 1; },
    (e) => { e.passes[0].pageEvidence.pop(); },
    (e) => { e.rows[1].id = e.rows[0].id; },
    (e) => { e.rows[0].date = "2026-10-08T00:00:00"; },
    (e) => { e.rows[0].date = "2026-10-09T23:00:00Z"; },
    (e) => { e.fromDate = "2026-02-30"; },
    (e) => { e.rows[0].fitterId = null; },
    (e) => { e.rows[0].hours = NaN; },
    (e) => { e.rows[0].categoryReference = 3300; },
    (e) => { e.rows.pop(); },
    (e) => { e.evidence.closedProjectControl.isClosed = false; },
    (e) => { e.evidence.closedProjectControl.id = "999"; },
    (e) => { e.passes[1].summary.canonicalRowsHash = "different"; },
    (e) => { e.rows[0].hours = 6; },
  ]) {
    const evidence = coverageEvidence();
    mutate(evidence);
    assert.throws(() => hoursCoverage.createHoursDataset(evidence), /time_control_coverage_invalid/);
  }
});

test("Timekontrol requires persistence before evaluating any in-memory dataset through the service", async () => {
  const dataset = hoursCoverage.createHoursDataset(coverageEvidence());
  for (const supplied of [dataset, { proof: dataset.proof }]) {
    await assert.rejects(runMailScenario({
      mode: "dry_run", dryRun: true, hoursDataset: supplied,
    }), /dataset_must_be_stored/);
  }
  const pool = require("../backend/src/db/pool");
  await withPatches([[pool, "connect", async () => { throw new Error("must_not_connect"); }]], async () => {
    await assert.rejects(service.runTimeControlWithPool({
      tenantId: uuid(1), controlledDate: "2026-10-09", dryRun: true,
    }, { hoursDataset: dataset }), /dataset_must_be_stored/);
  });
  const legacy = await repository.getHoursPeriodCoverage({}, { tenantId: uuid(1), controlledDate: "2026-10-09" });
  assert.equal(legacy.status, "incomplete");
});

  test("stored datasets are revalidated, scoped and fresh only from source observation, never import time", async () => {
    const evidence = coverageEvidence();
    const dataset = hoursCoverage.createHoursDataset(evidence);
    const row = {
      id: uuid(80), dataset_revision: dataset.proof.dataset_revision, rows_hash: dataset.proof.rows_hash,
      row_count: dataset.proof.row_count, evidence_json: evidence, proof_json: dataset.proof,
      observed_at: "2026-10-11T00:00:00Z", imported_at: "2026-10-11T01:00:00Z",
    };
    const input = {
      tenantId: uuid(1), controlledDate: "2026-10-09", datasetId: uuid(80),
      freshnessMinutes: 180, now: new Date("2026-10-11T01:00:00Z"),
    };
    const queries = [];
    const client = { query: async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [row] };
    } };
    const stored = await datasetStorage.loadHoursDataset(client, input);
    assert.equal(stored.proof.freshness, "fresh_observation");
    assert.equal(stored.proof.dataset_id, uuid(80));
    assert.deepEqual(queries[0].params, [uuid(1), "2026-10-09", uuid(80)]);
    assert.match(queries[0].sql, /d\.tenant_id = h\.tenant_id/);
    assert.match(queries[0].sql, /FOR SHARE OF h, d/);
    row.observed_at = null;
    await assert.rejects(datasetStorage.loadHoursDataset(client, input), /stale_or_observation_missing/);
    const historical = await datasetStorage.loadHoursDataset(client, { ...input, allowHistoricalSnapshot: true });
    assert.equal(historical.proof.freshness, "explicit_historical_demo");
    row.observed_at = "2026-10-10T00:00:00Z";
    await assert.rejects(datasetStorage.loadHoursDataset(client, input), /stale_or_observation_missing/);
    row.observed_at = "2026-10-12T00:00:00Z";
    await assert.rejects(datasetStorage.loadHoursDataset(client, input), /stale_or_observation_missing/);
    row.evidence_json.rows[0].hours = 1;
    await assert.rejects(datasetStorage.loadHoursDataset(client, { ...input, allowHistoricalSnapshot: true }), /dataset_changed/);
    await assert.rejects(datasetStorage.loadHoursDataset({ query: async () => ({ rows: [] }) }, input), /not_current_or_scope_mismatch/);
  });

  test("stored snapshot is loaded after evaluation starts and binds results without sync or provider mail", async () => {
    const dataset = hoursCoverage.createHoursDataset(coverageEvidence());
    let loads = 0;
    await withPatches([[datasetStorage, "loadHoursDataset", async (_client, input) => {
      loads += 1;
      assert.equal(input.datasetId, uuid(80));
      assert.equal(input.allowHistoricalSnapshot, true);
      return { dataset, proof: { ...dataset.proof, dataset_id: uuid(80), freshness: "explicit_historical_demo" } };
    }]], async () => {
      const result = await runMailScenario({
        mode: "live", dryRun: true, hoursDatasetId: uuid(80), allowHistoricalSnapshot: true, syncFailed: true,
      });
      assert.equal(result.results[0].hoursDatasetId, uuid(80));
      assert.equal(result.results[0].identitySnapshot.hours_dataset.dataset_id, uuid(80));
      assert.equal(result.results[0].status, "ok");
      assert.equal(result.mailLogs.length, 0);
      assert.equal(result.outbox.length, 0);
    });
    assert.equal(loads, 1);
    await assert.rejects(runMailScenario({ mode: "dry_run", hoursDatasetId: uuid(80) }), /requires_explicit_dry_run/);
    await assert.rejects(runMailScenario({ mode: "dry_run", dryRun: true, allowHistoricalSnapshot: true }), /historical_snapshot_requires_stored_dry_run/);
  });

  test("dataset publication rejects old captures and invalid refresh commits invalidation, not a fallback", async () => {
    const pool = require("../backend/src/db/pool");
    const events = [];
    const client = { query: async (sql) => {
      events.push(sql);
      if (sql.includes("RETURNING id")) return { rows: [{ id: uuid(80) }] };
      if (sql.includes("SELECT h.dataset_id")) return { rows: [{ dataset_id: uuid(81), observed_at: "2026-10-11T00:00:00Z" }] };
      return { rows: [] };
    }, release: () => events.push("release") };
    await withPatches([
      [pool, "connect", async () => client],
      [auditService, "logAuditEvent", async (args) => events.push(args.eventType)],
    ], async () => {
      await assert.rejects(datasetStorage.storeHoursDatasetWithPool({
        tenantId: uuid(1), dataset: hoursCoverage.createHoursDataset(coverageEvidence()), observedAt: null,
      }), /replacement_requires_newer_observation/);
      assert.ok(events.includes("ROLLBACK"));
      assert.ok(!events.includes("COMMIT"));
      events.length = 0;
      await assert.rejects(datasetStorage.importHoursEvidenceWithPool({
        tenantId: uuid(1), controlledDate: "2026-10-09", evidence: null,
      }), /coverage_invalid:evidence_missing/);
      assert.ok(events.includes("sync_fail"));
      assert.ok(events.includes("COMMIT"));
      assert.ok(events.some((sql) => sql.includes("invalidated_at")));
    });
  });

  test("dataset migration isolates immutable revisions and binds heads, runs and results to tenant", () => {
    const migration = read("migrations/0052_time_control_hours_dataset.sql");
    assert.match(migration, /BEFORE UPDATE OR DELETE ON time_control_hours_dataset/);
    assert.match(migration, /FOREIGN KEY \(dataset_id, tenant_id, controlled_date\)/);
    assert.match(migration, /FOREIGN KEY \(hours_dataset_id, tenant_id, controlled_date\)/);
    assert.match(migration, /FOREIGN KEY \(hours_dataset_id, tenant_id\)/);
    assert.match(migration, /capture_key/);
    assert.match(migration, /invalidated_at/);
    assert.doesNotMatch(migration, /UPDATE fitter_hour|INSERT INTO time_control_settings|UPDATE resource_group/i);
  });
test("Friday leader summary contains only employees with missing hours", () => {
  const summary = logic.buildManagerSummaryLines([
    { employee_name: "Mikkel Hansen", internal_ref: "MHJ", required_hours: 7, valid_hours: 6, missing_hours: 1 },
    { employee_name: "Jesper Skov", internal_ref: "JSK", required_hours: 7, valid_hours: 7, missing_hours: 0 },
  ]);
  assert.match(summary, /Mikkel Hansen \(MHJ\)/);
  assert.doesNotMatch(summary, /Jesper Skov/);
});

test("Timekontrol migration seeds dry-run POC, templates, idempotency and no EK writes", () => {
  const migration = read("migrations/0049_time_control_poc.sql");
  assert.match(migration, /mode text NOT NULL DEFAULT 'dry_run'/);
  assert.match(migration, /resource_group_external_id text NOT NULL DEFAULT '61'/);
  assert.match(migration, /SELECT id, true, 'dry_run', '61'/);
  assert.match(migration, /SELECT target_tenant\.id, employees\.internal_ref, '61'/);
  assert.match(migration, /VALUES \('MHJ'\), \('MUM'\), \('JSK'\), \('PEP'\), \('MBO'\), \('MPJ'\)/);
  assert.doesNotMatch(migration, /'183'|'DEP'|'FER'|'FHA'/);
  assert.match(migration, /uq_time_control_mail_log_idempotency/);
  assert.match(migration, /time_control\.missing_hours\.employee/);
  assert.match(migration, /time_control\.friday_manager_summary/);
  assert.match(migration, /time_control\.internal_error/);
  assert.match(migration, /'3300', true/);
  assert.match(migration, /'1244', false/);
  assert.doesNotMatch(migration, /POST\s+\/api\/v4\/fitterhours/i);
  assert.doesNotMatch(migration, /UPDATE\s+fitter_hour/i);
});

test("approved salary references preserve existing rules and keep equal-label references separate", () => {
  const approved = logic.normalizePayCodeRules([]);
  for (const reference of ["3300", "1220", "9010", "9012", "9022", "9000", "1195", "9315", "9200", "9300", "9320", "1199"]) {
    assert.equal(approved.get(reference), true, reference);
  }
  for (const reference of ["9070", "1244", "1246"]) assert.equal(approved.get(reference), false, reference);
  const summary = logic.summarizeHours([
    { fitter_category_reference: "9300", hours: 2 },
    { fitter_category_reference: "9320", hours: 3 },
    { fitter_category_reference: "9070", hours: 6 },
    { fitter_category_reference: "1244", hours: 1 },
    { fitter_category_reference: "1236", hours: 4 },
    { fitter_category_id: "9000", hours: 1 },
  ], approved);
  assert.equal(summary.validHours, 5);
  assert.deepEqual(summary.countedPayCodes, [{ pay_code: "9300", hours: 2 }, { pay_code: "9320", hours: 3 }]);
  assert.deepEqual(summary.excludedPayCodes, [{ pay_code: "1244", hours: 1 }, { pay_code: "9070", hours: 6 }]);
  assert.deepEqual(summary.unclassifiedRows.map((row) => row.reason), ["unknown_pay_code", "missing_pay_code"]);
  assert.equal(logic.evaluateHoursData({ summary, requiredHours: 7, coverage: { status: "complete" } }).missingHours, null);
  const migration = read("migrations/0053_time_control_approved_pay_codes.sql");
  assert.match(migration, /WHERE slug = 'hoyrup-clemmensen'/);
  for (const reference of ["9000", "1195", "9315", "9200", "9300", "9320", "1199", "9022"]) {
    assert.ok(migration.includes(`('${reference}', true,`));
  }
  for (const reference of ["9070", "1244"]) assert.ok(migration.includes(`('${reference}', false,`));
  assert.doesNotMatch(migration, /DELETE|fitter_category_id|INSERT INTO time_control_employee_config|UPDATE time_control_settings/);
});

test("Friday control evaluates its controlled day with seven-hour requirement, not a week", async () => {
  const scheduled = dates.determineScheduledControl(new Date("2026-03-27T11:00:00Z"));
  assert.equal(scheduled.controlType, "friday_12");
  assert.equal(scheduled.controlledDate, "2026-03-27");
  assert.equal(dates.requiredHoursForDate(scheduled.controlledDate), 7);
  const calls = [];
  await repository.listHoursForFitterDate({
    query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; },
  }, { tenantId: uuid(1), fitterId: "290", controlledDate: scheduled.controlledDate });
  assert.deepEqual(calls[0].params, [uuid(1), "290", "2026-03-27"]);
  assert.match(calls[0].sql, /work_date >= \$3::date/);
  assert.match(calls[0].sql, /work_date < \(\$3::date \+ interval '1 day'\)/);
  assert.doesNotMatch(calls[0].sql, /interval '7|date_trunc/);
  const singleDay = hoursCoverage.createHoursDataset(coverageEvidence());
  await withPatches([[datasetStorage, "loadHoursDataset", async (_client, input) => {
    assert.equal(input.controlledDate, "2026-10-09");
    return { dataset: singleDay, proof: { ...singleDay.proof, dataset_id: uuid(80) } };
  }]], async () => {
    const scenario = await runMailScenario({ mode: "dry_run", dryRun: true, hoursDatasetId: uuid(80) });
    assert.equal(scenario.results[0].requiredHours, 7);
    assert.equal(scenario.results[0].validHours, 7);
  });
});
