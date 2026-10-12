"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://example.invalid/fielddesk_test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.ROOT_DOMAIN = process.env.ROOT_DOMAIN || "example.test";
const coverage = require("../backend/src/modules/timeControl/timeControl.coverage");
const weekly = require("../backend/src/modules/timeControl/timeControl.weekly");
const dates = require("../backend/src/modules/timeControl/timeControl.dates");
const logic = require("../backend/src/modules/timeControl/timeControl.logic");

const tenantId = "00000000-0000-4000-8000-000000000001";
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function evidenceFor(day, hours = 7.75, code = "3300") {
  const rows = hours === null ? [] : [{
    id: "1", date: `${day}T00:00:00`, hours, fitterId: 290,
    categoryId: 1, categoryReference: code, projectId: 123, projectReference: "LOCAL",
  }];
  return {
    tenantId, endpoint: "/api/v4/paginatedfitterhours", fromDate: day, toDate: day,
    pageSize: 10, expectedTotal: rows.length, rows,
    passes: [1, 2].map(() => ({
      pageEvidence: [{ page: 1, currentPage: rows.length ? 1 : 0, nextPage: null, total: rows.length,
        rowCount: rows.length, status: 200, hasErrors: false, errorCount: 0 }],
      summary: { orderedIdsHash: hash(rows.map((row) => row.id)), canonicalRowsHash: hash(rows) },
    })),
    evidence: {
      closedProjectControl: rows.length ? { id: "1", fitterId: 290, projectId: 123, hours, isClosed: true } : null,
      emptyDayContract: rows.length ? null : {
        endpoint: "/api/v4/paginatedfitterhours", version: "ek_v4_all_projects_empty_day_v1",
        includesClosedProjects: true, dateFilterInclusive: true, zeroTotalTerminalPage: true,
        emptyCurrentPage: 0,
        verificationReference: "synthetic-local-contract-fixture-not-live-EK-proof",
      },
    },
  };
}

function snapshot(hours, code = "3300") {
  const period = dates.weeklyPeriod("2026-03-27");
  return {
    period, proof: { status: "complete", tenant_id: tenantId, ...period },
    days: period.days.map((day, i) => ({ day, dataset: coverage.createHoursDataset(evidenceFor(day, hours[i], code)) })),
  };
}

function allProjectsEvidence(day = "2026-10-05") {
  const evidence = evidenceFor(day);
  delete evidence.evidence.closedProjectControl;
  evidence.evidence.endpointContract = {
    version: "ek_v4_all_projects_single_day_two_pass_v2",
    endpoint: evidence.endpoint,
    scope: "tenant_all_projects",
    requestParameters: { fromDate: day, toDate: day, pageSize: evidence.pageSize },
    verificationReference: "synthetic-unit-fixture; runtime evidence documented separately",
  };
  return evidence;
}

test("v2 accepts a complete nonempty all-project day without a closed-project row, preserving v1", () => {
  const evidence = allProjectsEvidence();
  const proof = coverage.createHoursDataset(evidence).proof;
  assert.equal(proof.status, "complete");
  assert.equal(proof.contract, "ek_v4_all_projects_single_day_two_pass_v2");
  assert.equal(proof.row_count, 1);
  const legacy = evidenceFor(evidence.fromDate);
  const original = coverage.createHoursDataset(legacy).proof;
  assert.equal(original.contract, "ek_v4_single_day_two_pass_v1");
  assert.equal(original.dataset_revision, hash([tenantId, legacy.fromDate, legacy.endpoint, original.rows_hash]));
  assert.notEqual(proof.dataset_revision, original.dataset_revision);
  delete legacy.evidence.closedProjectControl;
  assert.throws(() => coverage.createHoursDataset(legacy), /closed_project_control_missing/);
});

test("v2 retains fail-closed scope, pagination, error, identity, date and stability requirements", () => {
  for (const mutate of [
    (e) => { e.evidence.endpointContract.version = "unverified"; },
    (e) => { e.evidence.endpointContract.scope = "active_projects"; },
    (e) => { e.evidence.endpointContract.endpoint = "/api/v4/fitterhours"; },
    (e) => { e.evidence.endpointContract.verificationReference = ""; },
    (e) => { e.evidence.endpointContract.requestParameters.projectStatus = "active"; },
    (e) => { e.evidence.endpointContract.requestParameters.fitterId = 290; },
    (e) => { e.evidence.endpointContract.requestParameters.toDate = "2026-10-06"; },
    (e) => { e.evidence.endpointContract.requestParameters.pageSize = 50; },
    (e) => { e.passes[0].pageEvidence[0].hasErrors = true; },
    (e) => { e.passes[1].pageEvidence[0].errorCount = 1; },
    (e) => { e.passes[0].pageEvidence[0].status = 500; },
    (e) => { e.passes[0].pageEvidence[0].nextPage = 2; },
    (e) => { e.passes[1].pageEvidence[0].total = 2; },
    (e) => { e.passes[1].pageEvidence[0].currentPage = 2; },
    (e) => { e.passes[0].pageEvidence = []; },
    (e) => { e.passes[1].summary.canonicalRowsHash = "changed"; },
    (e) => { e.passes[1].summary.orderedIdsHash = "changed"; },
    (e) => { e.rows.push({ ...e.rows[0] }); e.expectedTotal = 2; },
    (e) => { e.rows[0].date = "2026-10-06T00:00:00"; },
    (e) => { e.expectedTotal = 2; },
    (e) => { e.passes.pop(); },
  ]) {
    const evidence = allProjectsEvidence();
    mutate(evidence);
    assert.throws(() => coverage.createHoursDataset(evidence), /time_control_coverage_invalid:/);
  }
  const empty = evidenceFor("2026-10-05", null);
  empty.evidence.endpointContract = allProjectsEvidence().evidence.endpointContract;
  assert.throws(() => coverage.createHoursDataset(empty), /empty_day_endpoint_contract_missing/);
});

test("March closed-project row remains a v1 regression and counts by pay code, not project status", () => {
  const evidence = evidenceFor("2026-03-27", 3, "1236");
  Object.assign(evidence.rows[0], { id: "318942", fitterId: 24, projectId: 23050, projectReference: "12325-026" });
  evidence.evidence.closedProjectControl = { id: "318942", fitterId: 24, projectId: 23050, hours: 3, isClosed: true };
  for (const pass of evidence.passes) {
    pass.summary = { orderedIdsHash: hash(["318942"]), canonicalRowsHash: hash(evidence.rows) };
  }
  const dataset = coverage.createHoursDataset(evidence);
  assert.equal(dataset.proof.contract, "ek_v4_single_day_two_pass_v1");
  assert.equal(dataset.proof.row_count, 1);
  // Reduced fixture, not an additional live EK observation.
  const summary = logic.summarizeHours([{ hours: 3, fitter_category_reference: "1236" }]);
  assert.equal(summary.validHours, 0);
  assert.equal(summary.unclassifiedRows[0].reason, "unknown_pay_code");
});

test("weekly MBO 7.75 Monday–Thursday plus 6 Friday is 37, with no Friday minimum", () => {
  for (const [hours, expected] of [
    [[7.75, 7.75, 7.75, 7.75, 6], "ok"],
    [[10, 10, 10, 10, null], "ok"],
    [[7, 7, 7, 7, 7], "weekly_reminder"],
    [[null, null, null, null, null], "weekly_reminder"],
  ]) {
    const result = weekly.evaluateWeeklyFitter(snapshot(hours), { tenantId, fitterId: "290", payCodeRules: logic.normalizePayCodeRules([]) });
    assert.equal(result.evaluation.status, expected);
    assert.equal(result.evaluation.requiredHours, 37);
    assert.equal(result.evaluation.missingHours, null);
  }
});

test("weekly approved absence counts, 9070 excluded, unknown references block", () => {
  for (const code of logic.VALID_PAY_CODES_V1) {
    assert.equal(weekly.evaluateWeeklyFitter(snapshot([7.75, 7.75, 7.75, 7.75, 6], code),
      { tenantId, fitterId: "290" }).evaluation.status, "ok", code);
  }
  assert.equal(weekly.evaluateWeeklyFitter(snapshot([7.75, 7.75, 7.75, 7.75, 6], "9070"),
    { tenantId, fitterId: "290" }).summary.validHours, 0);
  const unknown = weekly.evaluateWeeklyFitter(snapshot([7.75, 7.75, 7.75, 7.75, 6], "unknown"),
    { tenantId, fitterId: "290" });
  assert.equal(unknown.evaluation.status, "unclassified_hours");
  assert.equal(unknown.evaluation.missingHours, null);
  assert.throws(() => weekly.evaluateWeeklyFitter(snapshot([1, 1, 1, 1, 1]),
    { tenantId: "00000000-0000-4000-8000-000000000002", fitterId: "290" }), /scope_mismatch/);
});

test("weekly date and reminder window handle Copenhagen DST and year boundaries", () => {
  assert.deepEqual(dates.weeklyPeriod("2027-01-01").days,
    ["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01"]);
  assert.throws(() => dates.weeklyPeriod("2026-03-26"), /requires_friday/);
  assert.throws(() => dates.weeklyPeriod("2026-02-30"), /invalid_date/);
  for (const [friday, noon, end] of [
    ["2026-03-27", "2026-03-27T11:00:00Z", "2026-03-27T13:30:00Z"],
    ["2026-04-03", "2026-04-03T10:00:00Z", "2026-04-03T12:30:00Z"],
    ["2026-10-30", "2026-10-30T11:00:00Z", "2026-10-30T13:30:00Z"],
  ]) {
    assert.equal(dates.determineScheduledControl(new Date(noon)).controlType, weekly.CONTROL_TYPE);
    assert.equal(weekly.reminderWindow(friday, new Date(noon)), true);
    assert.equal(weekly.reminderWindow(friday, new Date(new Date(noon).getTime() - 1)), false);
    assert.equal(weekly.reminderWindow(friday, new Date(end)), false);
  }
});

test("weekly employee and leader wording reports snapshot totals, never a final deficit", () => {
  const period = dates.weeklyPeriod("2026-03-27");
  const content = weekly.weeklyMail({ name: "MBO Montør", ...period, validHours: 35 });
  assert.match(content.body, /35,0 medregnede timer/);
  assert.match(content.body, /37 timer/);
  assert.match(content.body, /14\.30/);
  assert.match(content.body, /se bort.*registreret resten efter kontrollen/);
  assert.doesNotMatch(`${content.subject}\n${content.body}`, /mangl|underskud|2,0/);
  const summary = weekly.weeklySummary([{ employee_name: "MBO Montør", internal_ref: "MBO", valid_hours: 35 }], period);
  assert.match(summary, /35,0 medregnede timer/);
  assert.doesNotMatch(summary, /mangl|underskud/);
});

test("complete zero day requires two stable terminal zero pages and explicit endpoint contract", () => {
  const valid = evidenceFor("2026-03-27", null);
  assert.equal(coverage.createHoursDataset(valid).proof.row_count, 0);
  for (const mutate of [
    (e) => { e.evidence.emptyDayContract = null; },
    (e) => { e.evidence.emptyDayContract.includesClosedProjects = false; },
    (e) => { e.evidence.emptyDayContract.verificationReference = ""; },
    (e) => { e.passes.pop(); },
    (e) => { e.passes[0].pageEvidence[0].total = 1; },
    (e) => { e.passes[1].summary.canonicalRowsHash = "a".repeat(64); },
    (e) => { e.passes[1].pageEvidence[0].hasErrors = true; },
  ]) {
    const invalid = structuredClone(valid);
    mutate(invalid);
    assert.throws(() => coverage.createHoursDataset(invalid), /coverage_invalid/);
  }
  assert.throws(() => weekly.validateBindings(["00000000-0000-4000-8000-000000000001"]), /five_dataset_ids/);
});

test("two-pass server capture issues observation independently of imported evidence timestamps", async () => {
  const evidence = evidenceFor("2026-03-27", null);
  const pages = [];
  const captured = await coverage.captureHoursDataset({
    tenantId, controlledDate: "2026-03-27", pageSize: 10, evidence: evidence.evidence,
    fetchPage: async (input) => {
      pages.push(input);
      return { rows: [], currentPage: 0, nextPage: null, total: 0, status: 200, hasErrors: false, errorCount: 0 };
    },
  });

  assert.equal(pages.length, 2);
  assert.ok(coverage.getCaptureObservation(captured));
  assert.equal(coverage.getCaptureObservation(coverage.createHoursDataset(evidence)), null);
  await assert.rejects(coverage.captureHoursDataset({
    tenantId, controlledDate: "2026-03-27", pageSize: 10, evidence: evidence.evidence,
    fetchPage: async () => ({ rows: [], currentPage: 1, nextPage: 1, total: 0 }),
  }), /page_progression/);
});

test("weekly admin API derives tenant from authenticated context, denies mismatch and forces dry-run", async () => {
    const router = require("../backend/src/modules/timeControl/timeControl.routes");
    const service = require("../backend/src/modules/timeControl/timeControl.service");
    const access = require("../backend/src/services/moduleAccessService");
    const route = router.stack.find((layer) => layer.route?.path === "/api/tenant/admin/time-control/test-runs").route;
    const handler = route.stack[route.stack.length - 1].handle;
    const originalRun = service.runTimeControlWithPool;
    const originalAccess = access.requireModuleAccess;
    const originalError = console.error;
    const ids = Array.from({ length: 5 }, (_, i) => `00000000-0000-4000-8000-${String(i + 10).padStart(12, "0")}`);
    const req = {
      auth: { tenant_id: tenantId, sub: "00000000-0000-4000-8000-000000000003", role: "tenant_admin" },
      context: { tenant: { id: tenantId, slug: "local-test" } },
      body: { tenant_id: "client-tenant-not-authoritative", control_type: weekly.CONTROL_TYPE,
        date: "2026-03-27", hours_dataset_ids: ids, historical_snapshot: true, dry_run: false },
    };
    let calls = 0;
    const res = { status: () => res, json: () => {} };
    try {
      console.error = () => {};
      access.requireModuleAccess = () => {};
      service.runTimeControlWithPool = async (args, options) => {
        calls += 1;
        assert.equal(args.tenantId, tenantId);
        assert.equal(args.dryRun, true);
        assert.deepEqual(options.hoursDatasetIds, ids);
        assert.equal(options.allowHistoricalSnapshot, true);
        return { run: { status: "completed" } };
      };
      let error;
      await handler(req, res, (e) => { error = e; });
      assert.equal(error, undefined);
      assert.equal(calls, 1);
      await handler({ ...req, auth: { ...req.auth, tenant_id: "different-tenant" } }, res, (e) => { error = e; });
      assert.equal(error.statusCode, 403);
      assert.equal(calls, 1);
      access.requireModuleAccess = () => { const deny = new Error("denied"); deny.statusCode = 403; throw deny; };
      await handler(req, res, (e) => { error = e; });
      assert.equal(error.statusCode, 403);
      assert.equal(calls, 1);
      access.requireModuleAccess = () => {};
      await handler({ ...req, body: { ...req.body, hours_dataset_ids: [ids[4]] } }, res, (e) => { error = e; });
      assert.equal(error.statusCode, 400);
      assert.equal(calls, 1);
    } finally {
      service.runTimeControlWithPool = originalRun;
      access.requireModuleAccess = originalAccess;
      console.error = originalError;
    }
  });

  test("weekly UI exposes only dry-run, and distinguishes historical daily records", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const root = path.join(__dirname, "..");
    const html = fs.readFileSync(path.join(root, "backend", "src", "public", "tenant", "time-control.html"), "utf8");
    const auth = fs.readFileSync(path.join(root, "backend", "src", "public", "tenant", "auth.js"), "utf8");
    assert.match(html, /data-page="time-control"/);
    assert.match(html, /historisk|Historisk/);
    assert.match(auth, /dry_run: true/);
    assert.match(auth, /Ugepåmindelse ved middag/);
    assert.match(auth, /Dagsmangel \(historisk dagskontrol\)/);
  });

async function withWeeklyDispatchFixture(fn) {
  const storage = require("../backend/src/modules/timeControl/timeControl.dataset");
  const repository = require("../backend/src/modules/timeControl/timeControl.repository");
  const operation = require("../backend/src/modules/timeControl/timeControl.operation");
  const dispatch = require("../backend/src/modules/timeControl/timeControl.dispatch");
  const service = require("../backend/src/modules/timeControl/timeControl.service");
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const data = snapshot([7, 7, 7, 7, 7]);
  const proof = { ...data.proof, freshness: "fresh_server_observations",
    days: data.days.map(({ day }, i) => ({
      controlled_date: day, dataset_id: id(i + 20), server_captured: true, status: "complete",
    })) };
  const identity = { fitter_id: "290", group_id: id(40), group_external_id: "10",
    approved_email: "employee@example.test", email_source: "admin_override", approval_version: 1,
    approved_at: "2026-03-01T12:00:00.000Z", approved_by_user_id: id(41) };
  const result = { id: id(30), employee_config_id: id(31), fitter_id: "290",
    weekly_snapshot_id: id(11), hours_dataset_id: null, identity_snapshot: { ...identity, hours_dataset: proof },
    employee_name: "MBO Montør", employee_email: identity.approved_email, internal_ref: "MBO",
    status: "weekly_reminder", coverage_status: "complete", required_hours: "37", valid_hours: "35",
    missing_hours: null };
  const excluded = { ...structuredClone(result), id: id(32), employee_config_id: id(33), fitter_id: "291",
    identity_snapshot: { ...identity, fitter_id: "291", approved_email: "excluded@example.test" } };
  const settings = { is_enabled: true, mode: "live", sync_freshness_minutes: 180,
    employee_cc_emails: ["dep@example.test", "lke@example.test"],
    friday_manager_emails: ["dep@example.test", "lke@example.test"] };
  const row = { id: id(50), template_key: "time_control.employee_weekly_reminder_v1",
    recipient_email: result.employee_email, idempotency_key: "unchanged-weekly-key",
    payload_json: { run_id: id(10), weekly_snapshot_id: id(11), ...data.period,
      cc_emails: [...settings.employee_cc_emails], result_bindings: [dispatch.resultBinding(result)] } };
  const gates = [];
  const resolutions = [];
  const client = { async query(sql, params) {
    assert.equal(params[0], tenantId);
    if (sql.includes("SELECT r.id")) return { rows: [{ id: id(10), proof_json: proof }] };
    if (sql.includes("FROM time_control_settings")) {
      assert.match(sql, /FOR SHARE OF s,t/);
      return { rows: [settings] };
    }
    if (sql.includes("FROM time_control_weekly_snapshot_day")) {
      return { rows: proof.days.map(day => ({ day: day.controlled_date, dataset_id: day.dataset_id })) };
    }
    if (sql.includes("FROM time_control_result")) return { rows: [result, excluded] };
    if (sql.includes("FROM time_control_mail_log")) return { rows: [{
      result_id: row.template_key === "time_control.employee_weekly_reminder_v1" ? result.id : null,
    }] };
    throw new Error(`unexpected_query:${sql}`);
  } };
  const originals = [
    [storage, "loadHoursDataset"], [repository, "lockEmployeeConfig"], [repository, "resolveEmployeeConfig"],
    [repository, "listPayCodeRules"], [operation, "checkGate"], [service._test, "classifyResolvedEmployee"],
  ].map(([target, key]) => [target, key, target[key]]);
  const OriginalDate = global.Date;
  try {
    global.Date = class extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : ["2026-03-27T11:00:00.000Z"])); }
    };
    storage.loadHoursDataset = async (_client, args) => {
      assert.equal(args.tenantId, tenantId);
      const i = data.period.days.indexOf(args.controlledDate);
      assert.equal(args.datasetId, proof.days[i].dataset_id);
      const { controlled_date: _day, ...dayProof } = proof.days[i];
      return { dataset: data.days[i].dataset, proof: dayProof };
    };
    repository.lockEmployeeConfig = async (_client, args) => {
      resolutions.push(args.configId);
      return { id: args.configId };
    };
    repository.resolveEmployeeConfig = async () => [];
    repository.listPayCodeRules = async () => [];
    service._test.classifyResolvedEmployee = config => ({ ok: true, employee: {
      email: identity.approved_email, identitySnapshot: structuredClone(identity),
    } });
    operation.checkGate = async (_client, args) => {
      gates.push(args.identity.fitter_id);
      return { eligible: args.identity.fitter_id === "290", reason: "excluded_fixture" };
    };
    await fn({ client, row, settings, result, excluded, identity, gates, resolutions, dispatch });
  } finally {
    global.Date = OriginalDate;
    for (const [target, key, value] of originals) target[key] = value;
  }
}

test("weekly employee routing normalizes To/CC and rejects removed or changed CC without rewriting mail", async () => {
  await withWeeklyDispatchFixture(async ({ client, row, settings }) => {
    row.recipient_email = " Employee@Example.Test ";
    row.payload_json.cc_emails = [" LKE@Example.Test ", "DEP@example.test", "dep@example.test"];
    await weekly.validateDispatchSnapshot(client, { tenantId, row });
    const queued = structuredClone(row);
    for (const cc of [[], ["dep@example.test"], ["dep@example.test", "new@example.test"]]) {
      settings.employee_cc_emails = cc;
      await assert.rejects(weekly.validateDispatchSnapshot(client, { tenantId, row }), /dispatch_routing_changed/);
      assert.deepEqual(row, queued);
    }
  });
});

test("weekly summary validates full current To/CC and only the exact eligible queued subset", async () => {
  await withWeeklyDispatchFixture(async ({ client, row, settings, excluded, gates, resolutions }) => {
    row.template_key = "time_control.friday_weekly_summary_v1";
    row.recipient_email = " DEP@Example.Test ";
    row.payload_json.cc_emails = [" LKE@Example.Test ", "lke@example.test"];
    excluded.status = "config_error";
    excluded.coverage_status = "incomplete";
    await weekly.validateDispatchSnapshot(client, { tenantId, row });
    assert.deepEqual(gates, ["290"]);
    assert.equal(resolutions.length, 1);
    const queued = structuredClone(row);
    for (const managers of [
      ["dep@example.test"], ["new@example.test", "lke@example.test"],
      ["lke@example.test", "dep@example.test"], ["dep@example.test", "other@example.test"],
    ]) {
      settings.friday_manager_emails = managers;
      await assert.rejects(weekly.validateDispatchSnapshot(client, { tenantId, row }), /dispatch_routing_changed/);
      assert.deepEqual(row, queued);
    }
  });
});

test("weekly immutable summary bindings reject changed included results, identity and approvals", async () => {
  for (const mutate of [
    ({ result }) => { result.valid_hours = 34; },
    ({ result }) => { result.identity_snapshot.approval_version += 1; },
    ({ identity }) => { identity.approval_version += 1; },
    ({ identity }) => { identity.approved_at = "2026-03-02T12:00:00.000Z"; },
    ({ row }) => { row.payload_json.result_bindings = []; },
    ({ row }) => { row.payload_json.result_bindings.push(structuredClone(row.payload_json.result_bindings[0])); },
    ({ row }) => { row.payload_json.result_bindings[0].result_id = tenantId; },
  ]) {
    await withWeeklyDispatchFixture(async fixture => {
      fixture.row.template_key = "time_control.friday_weekly_summary_v1";
      fixture.row.recipient_email = fixture.settings.friday_manager_emails[0];
      fixture.row.payload_json.cc_emails = fixture.settings.friday_manager_emails.slice(1);
      mutate(fixture);
      await assert.rejects(weekly.validateDispatchSnapshot(fixture.client, { tenantId, row: fixture.row }),
        /dispatch_binding_invalid|dispatch_identity_changed/);
    });
  }
});

test("weekly enqueue persists exact immutable employee or eligible summary result bindings", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "..", "backend", "src", "modules", "timeControl", "timeControl.service.js"), "utf8");
  assert.match(source, /result_bindings: \(summary \? summaryResults : \[result\]\)\.map\(require\("\.\/timeControl\.dispatch"\)\.resultBinding\)/);
});
