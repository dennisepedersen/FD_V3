"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://example.invalid/fielddesk_test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.ROOT_DOMAIN = process.env.ROOT_DOMAIN || "fielddesk.test";

const pool = require("../backend/src/db/pool");
const service = require("../backend/src/modules/timeControl/timeControl.service");
const repository = require("../backend/src/modules/timeControl/timeControl.repository");
const storage = require("../backend/src/modules/timeControl/timeControl.dataset");
const orchestration = require("../backend/src/modules/timeControl/timeControl.orchestration");
const capture = require("../backend/src/modules/timeControl/timeControl.capture");
const audit = require("../backend/src/services/auditService");
const outbox = require("../backend/src/modules/notifications/emailOutbox.service");
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tenantId = uuid(1);
const day = "2026-10-12";

async function withPatches(patches, fn) {
  const restores = patches.map(([target, key, value]) => {
    const previous = target[key];
    target[key] = value;
    return () => { target[key] = previous; };
  });
  try { return await fn(); }
  finally { for (const restore of restores.reverse()) restore(); }
}

function captureDependencies({ fetchImpl, onRelease = () => {} } = {}) {
  let milliseconds = Date.UTC(2026, 9, 13, 7);
  let calls = 0;
  return {
    get calls() { return calls; },
    advance(value) { milliseconds += value; },
    pool: { connect: async () => ({ release: onRelease }) },
    resolveTenantConfig: async () => ({ tenantId, ekBaseUrl: "https://source.example.test",
      ekApiKey: "trace-must-not-retain-this-key", siteName: "trace-must-not-retain-this-site" }),
    now: () => milliseconds,
    sleep: async duration => { milliseconds += duration; },
    fetchImpl: async (...args) => {
      calls++;
      if (fetchImpl) return fetchImpl(calls, ...args);
      return response();
    },
  };
}

function response(status = 200) {
  return { status, ok: status === 200, headers: { get: () => "0" }, text: async () => JSON.stringify({
    hasErrors: false, errorCount: 0, data: { data: [{
      id: 1, date: `${day}T00:00:00`, hours: 7.5, fitterID: 208, categoryID: 1,
      categoryReference: "3300", projectID: 1, projectReference: "fixture",
      fitterName: "trace-must-not-retain-this-name", note: "trace-must-not-retain-this-note",
    }], total: 1, currentPage: 1, nextPage: null },
  }) };
}

test("capture traces every request attempt and both passes without retaining source payload or configuration", async () => {
  const events = [];
  let released = false;
  const dependencies = captureDependencies({ onRelease: () => { released = true; },
    fetchImpl: async call => response(call === 1 ? 429 : 200) });
  const dataset = await capture.captureDay({ tenantId, controlledDate: day, testDependencies: dependencies,
    trace: async (step, status, counts, errorCode) => {
      assert.equal(released, true, "Config client must be released before independent page trace queries.");
      events.push({ step, status, counts, errorCode });
    } });
  assert.equal(dataset.proof.row_count, 1);
  assert.equal(dependencies.calls, 3);
  assert.deepEqual(events.filter(event => event.status === "started").map(event => [event.counts.pass, event.counts.page, event.counts.attempt]),
    [[1, 1, 1], [1, 1, 2], [2, 1, 1]]);
  assert.equal(events.find(event => event.status === "failed").errorCode, "time_control_capture_rate_limited");
  assert.ok(events.filter(event => event.status === "completed").every(event => event.counts.row_count === 1));
  assert.equal(JSON.stringify(events).includes("trace-must-not-retain"), false);
});

test("capture trace persistence failure aborts before the next provider request and remains distinguishable", async () => {
  const dependencies = captureDependencies();
  await assert.rejects(capture.captureDay({ tenantId, controlledDate: day, testDependencies: dependencies,
    trace: async () => { throw new Error("trace_database_unavailable"); } }), error =>
    error.code === "time_control_trace_failed" && error.cause.message === "trace_database_unavailable");
  assert.equal(dependencies.calls, 0);
});

test("trace latency consumes the existing capture deadline instead of extending it", async () => {
  const dependencies = captureDependencies();
  await assert.rejects(capture.captureDay({ tenantId, controlledDate: day, testDependencies: dependencies,
    trace: async (_step, status) => { if (status === "completed") dependencies.advance(120000); } }),
  /time_control_capture_invalid:deadline_exceeded/);
  assert.equal(dependencies.calls, 1);
});

test("capture publication traces only committed dataset IDs and retains invalidation after failed publication", async () => {
  for (const failStore of [false, true]) {
    const events = [];
    let transactionOpen = false;
    const client = { query: async sql => {
      events.push(sql);
      if (sql === "BEGIN") transactionOpen = true;
      if (sql === "COMMIT" || sql === "ROLLBACK") transactionOpen = false;
      return { rows: [{ locked: true, unlocked: true }] };
    } };
    await withPatches([
      [storage, "invalidateHoursDataset", async () => { events.push("invalidate"); }],
      [storage, "storeHoursDataset", async () => {
        if (failStore) { const error = new Error("sensitive SQL details must not reach trace"); error.code = "23514"; throw error; }
        return { id: uuid(80) };
      }],
    ], async () => {
      const run = orchestration.captureAndPublish(client, { tenantId, controlledDate: day,
        captureDay: async ({ trace }) => {
          assert.equal(transactionOpen, false);
          await trace("capture_page", "completed", { pass: 1, page: 1, attempt: 1 });
          return { proof: { row_count: 168, pass_count: 2 } };
        }, trace: async (step, status, counts, errorCode) => {
          if (step === "capture_completed") assert.equal(transactionOpen, false);
          events.push({ step, status, counts, errorCode });
        } });
      if (failStore) {
        await assert.rejects(run, /sensitive SQL details/);
        assert.equal(events.filter(event => event === "invalidate").length, 2);
        const failed = events.find(event => event.status === "failed");
        assert.equal(failed.errorCode, "23514");
        assert.equal(Object.hasOwn(failed.counts, "dataset_id"), false);
      } else {
        await run;
        const completed = events.find(event => event.step === "capture_completed");
        assert.equal(completed.counts.dataset_id, uuid(80));
        assert.equal(completed.counts.row_count, 168);
        assert.equal(completed.counts.pass_count, 2);
      }
      assert.equal(JSON.stringify(events).includes("sensitive SQL details"), false);
    });
    assert.ok(events.at(-1).includes("pg_advisory_unlock"));
  }
});

test("capture completion falls back to dataset rows or persisted counts without inventing a pass count", async () => {
  for (const [dataset, publication, rowCount, passCount] of [
    [{ rows: [{}, {}, {}] }, {}, 3, null],
    [{ rows: [] }, { row_count: 9 }, 0, null],
    [{}, { row_count: 5 }, 5, null],
    [{}, { proof: { row_count: 8, pass_count: 2 } }, 8, 2],
  ]) {
    let completed;
    const client = { query: async () => ({ rows: [{ locked: true, unlocked: true }] }) };
    await withPatches([
      [storage, "invalidateHoursDataset", async () => {}],
      [storage, "storeHoursDataset", async () => ({ id: uuid(80), ...publication })],
    ], async () => {
      await orchestration.captureAndPublish(client, { tenantId, controlledDate: day,
        captureDay: async () => dataset,
        trace: async (step, _status, counts) => { if (step === "capture_completed") completed = counts; },
      });
    });
    assert.equal(completed.row_count, rowCount);
    assert.equal(completed.pass_count, passCount);
  }
});

async function withServiceFixture(fn) {
  const events = [];
  let open = false;
  let released = false;
  let queued = 0;
  const run = { id: uuid(20), mode: "dry_run", controlled_date: day, control_type: "manual", status: "running" };
  const client = { query: async sql => {
    events.push(sql);
    if (sql === "BEGIN") open = true;
    if (sql === "COMMIT" || sql === "ROLLBACK") open = false;
    return { rows: [] };
  }, release: () => { released = true; events.push("release"); } };
  await withPatches([
    [pool, "connect", async () => client],
    [repository, "acquireRunLock", async () => true],
    [repository, "releaseRunLock", async () => { events.push("unlock"); }],
    [repository, "getSettings", async () => ({ is_enabled: true, mode: "dry_run", sync_freshness_minutes: 180,
      monday_thursday_required_hours: 7.5, internal_error_emails: ["dep@example.test"] })],
    [repository, "upsertRun", async () => run],
    [repository, "listEmployeeConfigs", async () => []],
    [repository, "listPayCodeRules", async () => []],
    [repository, "bindRunDataset", async () => {}],
    [repository, "findEmployeeMailLog", async () => null],
    [repository, "upsertMailLog", async (_client, args) => args],
    [repository, "finishRun", async (_client, args) => ({ ...run, status: args.status, error_reason: args.errorReason })],
    [storage, "loadHoursDataset", async () => ({ dataset: {}, proof: { status: "complete" } })],
    [audit, "logAuditEvent", async () => {}],
    [outbox, "enqueueEmail", async () => { queued++; assert.fail("dry-run must not enqueue provider mail"); }],
  ], async () => fn({ events, get open() { return open; }, get released() { return released; },
    get queued() { return queued; }, client, run }));
}

test("service records run binding after preparation commit and queue completion after final commit and connection release", async () => {
  await withServiceFixture(async fixture => {
    const steps = [];
    const result = await service.runTimeControlWithPool({ tenantId, controlledDate: day, controlType: "manual", triggeredBy: "manual", dryRun: true }, {
      hoursDatasetId: uuid(80), trace: async (step, status, counts, errorCode) => {
        steps.push({ step, status, counts, errorCode });
        if (step === "run_binding") {
          assert.equal(fixture.open, false);
          assert.equal(fixture.events.filter(event => event === "COMMIT").length, 1);
          assert.equal(counts.run_id, fixture.run.id);
        }
        if (step === "queue_committed" && status === "completed") {
          assert.equal(fixture.open, false);
          assert.equal(fixture.released, true);
          assert.equal(fixture.events.filter(event => event === "COMMIT").length, 2);
        }
      },
    });
    assert.equal(result.run.status, "completed");
    for (const step of ["run_started", "run_binding", "validation", "calculation", "mail_decision", "queue_committed"]) {
      assert.ok(steps.some(event => event.step === step && event.status === "completed"), step);
    }
    assert.equal(fixture.queued, 0);
  });
});

test("service trace failure after binding rolls back evaluation, preserves preparation and cannot enqueue mail", async () => {
  await withServiceFixture(async fixture => {
    await assert.rejects(service.runTimeControlWithPool({ tenantId, controlledDate: day, controlType: "manual", triggeredBy: "manual", dryRun: true }, {
      hoursDatasetId: uuid(80), trace: async (step, status) => {
        if (step === "validation" && status === "started") throw new Error("trace_persistence_failed");
      },
    }), error => error.code === "time_control_trace_failed");
    assert.equal(fixture.events.filter(event => event === "COMMIT").length, 1);
    assert.equal(fixture.events.filter(event => event === "ROLLBACK").length, 1);
    assert.equal(fixture.released, true);
    assert.equal(fixture.queued, 0);
  });
});

test("service threads trace into acquisition and does not convert trace failure to internal diagnostic mail", async () => {
  await withServiceFixture(async fixture => {
    await withPatches([[orchestration, "prepare", async (_client, { trace }) => {
      await trace("capture_started", "started", { controlled_date: day });
      assert.fail("trace failure must stop capture");
    }]], async () => {
      await assert.rejects(service.runTimeControlWithPool({ tenantId, controlledDate: day, controlType: "manual", triggeredBy: "manual", dryRun: true }, {
        trace: async step => { if (step === "capture_started") throw new Error("trace_database_down"); },
      }), /time_control_trace_failed/);
      assert.equal(fixture.events.filter(event => event === "COMMIT").length, 1);
      assert.equal(fixture.events.filter(event => event === "BEGIN").length, 1);
      assert.equal(fixture.queued, 0);
      assert.equal(fixture.released, true);
    });
  });
});

test("trace records initial pool acquisition failure safely and rejects trace failure before opening a connection", async () => {
  const events = [];
  let connections = 0;
  await withPatches([[pool, "connect", async () => {
    connections++;
    const error = new Error("database URL and private connection details must not be recorded");
    error.code = "53300";
    throw error;
  }]], async () => {
    const args = { tenantId, controlledDate: day, controlType: "manual" };
    await assert.rejects(service.runTimeControlWithPool(args, {
      trace: async (step, status, counts, errorCode) => events.push({ step, status, counts, errorCode }),
    }), /private connection details/);
    assert.equal(events.at(-1).errorCode, "53300");
    assert.equal(JSON.stringify(events).includes("private connection details"), false);
    await assert.rejects(service.runTimeControlWithPool(args, { trace: async () => { throw new Error("trace_down"); } }), /time_control_trace_failed/);
    assert.equal(connections, 1);
  });
});

test("a trace failure aggregated with capture cleanup failure cannot become a diagnostic-mail evaluation", async () => {
  await withServiceFixture(async fixture => {
    const traceError = new Error("time_control_trace_failed");
    traceError.code = "time_control_trace_failed";
    await withPatches([[orchestration, "prepare", async () => {
      throw new AggregateError([traceError, new Error("audit_write_failed")], "time_control_capture_failure_audit_failed");
    }]], async () => {
      await assert.rejects(service.runTimeControlWithPool({ tenantId, controlledDate: day,
        controlType: "manual", triggeredBy: "manual", dryRun: true }, { trace: async () => {} }),
      /time_control_capture_failure_audit_failed/);
      assert.equal(fixture.events.filter(event => event === "BEGIN").length, 1);
      assert.equal(fixture.queued, 0);
      assert.equal(fixture.released, true);
    });
  });
});
