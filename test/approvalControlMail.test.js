"use strict";

const test = require("node:test"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const fixtureSigningKey = crypto.randomUUID();
const fixtureProviderKey = crypto.randomUUID();
const fixtureDatabaseUrl = "postgres://example.invalid/approval_control_mail";
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: fixtureDatabaseUrl,
  JWT_SECRET: fixtureSigningKey,
  ROOT_DOMAIN: "fielddesk.test",
  MAIL_PROVIDER: "resend",
  MAIL_API_KEY: fixtureProviderKey,
  MAIL_FROM: "Fielddesk <noreply@mail.fielddesk.test>",
  MAIL_REPLY_TO: "admin@fielddesk.test",
});
const job = require("../backend/src/modules/approvalControl/approvalControl.mailJob");
const policy = require("../backend/src/modules/approvalControl/approvalControl.mailPolicy");
const repo = require("../backend/src/modules/approvalControl/approvalControl.mailRepository");
const activation = require("../backend/src/modules/approvalControl/approvalControl.activation");
const scope = require("../backend/src/modules/approvalControl/approvalControl.scope");
const source = require("../backend/src/modules/approvalControl/approvalControl.source");
const actualCapture = source.capture;
const admission = require("../backend/src/modules/approvalControl/approvalControl.admission");
const refresh = require("../backend/src/services/fitterhoursRefreshService");
const pool = require("../backend/src/db/pool");
const mail = require("../backend/src/modules/approvalControl/approvalControl.mail");
const mailService = require("../backend/src/services/mailService");
const mailRouting = require("../backend/src/modules/notifications/operationalMailRouting");
const control = require("../backend/src/modules/approvalControl/approvalControl.control");
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const context = { tenantId: uuid(1), userId: uuid(2), tenantSlug: "hoyrup-clemmensen" };
const firstActivation = { id: uuid(8), tenant_id: context.tenantId, environment: "production", time_zone: "Europe/Copenhagen", activated_at: "2026-10-19T07:00:00.000Z", coverage_from: "2026-10-19" };
const project = { project_id: uuid(3), external_project_ref: "80396-003", name: "Fixture <case>" };
const current = { user: { tenant_id: context.tenantId, email: "dep@hoyrup-clemmensen.dk" }, projects: [project], bindings: [{ project_id: project.project_id, ek_project_id: "25906" }] };
const row = (id = 1, extra = {}) => ({ id, projectID: 25906, date: "2026-10-22T00:00:00", hours: 7.5, fitterID: 18, fitterName: "Fixture <person>", approvedBy: null, approvedDate: null, ...extra });
const patches = async (items, fn) => {
  const restores = items.map(([o, k, v]) => { const old = o[k]; o[k] = v; return () => { o[k] = old; }; });
  try { return await fn(); } finally { restores.reverse().forEach(fn => fn()); }
};

async function fixture(fn) {
  let now = new Date("2026-10-22T12:30:00Z"), rows = [row()], selected = current, reads = 0, first = firstActivation;
  let extraRouting = mailRouting.policy.defaults("approval_control_summary"), routingReads = 0;
  let state = { enabled: true, revision: 1, enabled_at: firstActivation.activated_at, activation_id: firstActivation.id, coverage_from: firstActivation.coverage_from };
  const settings = (record = first) => policy.read({ APPROVAL_CONTROL_FRIDAY_TIME: "14:31", APPROVAL_CONTROL_MAIL_ENABLED: "true", APPROVAL_CONTROL_SCHEDULER_ENABLED: "true" }, now, record, state);
  const records = new Map(), slots = new Map(), providerCalls = [];
  const client = { release() {}, async query(sql, params) { assert.match(sql, /t.id=\$1 AND t.slug=\$2 AND t.status='active'/); assert.equal(params[0], context.tenantId); return { rows: [{ id: context.tenantId }] }; } };
  const options = { mode: "live", clock: () => now, readPolicy: settings, sendEmailFn: async (message, options) => { providerCalls.push({ message, options }); return { provider: "resend", sent: true, providerMessageId: "fixture-provider" }; } };
  await patches([
    [require("../backend/src/config/env"), "NODE_ENV", "production"],
    [control, "get", async () => structuredClone(state)],
    [control, "withSendLock", async (actor, expected, planned, first, callback) => {
      assert.deepEqual(actor, context);
      if (state.revision !== expected.revision || !control.validForSlot(state, planned, first)) throw new Error("approval_control_control_changed");
      return callback();
    }],
    [pool, "connect", async () => client], [scope, "loadMine", async (_c, ctx) => { assert.deepEqual(ctx, context); return selected; }],
    [mailRouting, "composeWithPool", async input => { routingReads++; return mailRouting.policy.recipients(extraRouting, input); }],
    [mailRouting, "withMessageLock", async (input, send) => {
      if (input.route.snapshot.revision !== extraRouting.revision) throw new Error("operational_mail_routing_changed");
      return send();
    }],
    [activation, "get", async ctx => ctx.tenantId === context.tenantId ? first : null],
    [activation, "recordFirst", async () => assert.fail("A job or preview must never manufacture an activation")],
    [refresh, "resolveTenantConfig", async () => ({ tenantId: context.tenantId })],
    [source, "capture", async args => { reads++; assert.equal(args.fromDate, first.coverage_from); assert(args.toDate <= policy.local(now).date); return { rows, observed_at: now.toISOString(), completed_at: now.toISOString(), endpoint: "/api/v4/paginatedfitterhours", requests: 2, passes: 2 }; }],
    [admission, "read", async (_ctx, fn) => { if (admission.protectedWindow(now)) throw new Error("approval_control_protected_window"); return fn(); }],
    [repo, "claim", async (ctx, metadata) => {
      const key = [ctx.tenantId, ctx.userId, metadata.local_date, metadata.mode].join(":");
      if (slots.has(key)) return { claimed: false, run: records.get(slots.get(key)) };
      const run = { ...metadata, id: crypto.randomUUID(), result: null, attempt: null }; slots.set(key, run.id); records.set(run.id, run); return { claimed: true, run };
    }],
    [repo, "attempt", async (_ctx, id, metadata) => { const run = records.get(id); if (run.attempt) return false; run.attempt = metadata; return true; }],
    [repo, "finish", async (_ctx, id, metadata) => { const run = records.get(id); run.result ||= metadata; return run; }],
    [repo, "get", async (ctx, id) => ctx.tenantId === context.tenantId && ctx.userId === context.userId ? records.get(id) : null],
    [repo, "latest", async () => [...records.values()].at(-1) || null],
  ], async () => fn({ options, providerCalls, records, get reads() { return reads; }, get routingReads() { return routingReads; },
    get control() { return state; }, setControl: value => { state = value; }, setRouting: value => { extraRouting = value; }, get activation() { return first; }, setActivation: value => { first = value; }, setRows: value => { rows = value; }, setScope: value => { selected = value; }, setNow: value => { now = new Date(value); } }));
}

test("approval observer CC/BCC are additive; private BCC is absent from normal run UI and mail content", async () => fixture(async f => {
  f.setRouting({ ...mailRouting.policy.defaults("approval_control_summary"), revision: 2,
    extra_cc_enabled: true, extra_cc_emails: ["observer@example.test"], extra_bcc_enabled: true, extra_bcc_emails: ["blind@example.test"] });
  const run = await job.runDue(context, f.options), message = f.providerCalls[0].message;
  assert.equal(run.result.state, "provider_accepted"); assert.equal(message.to, current.user.email);
  assert.deepEqual(message.cc, ["observer@example.test"]); assert.deepEqual(message.bcc, ["blind@example.test"]);
  assert.doesNotMatch(message.html + message.text, /blind@example.test/);
  assert.doesNotMatch(JSON.stringify(await job.getRun(context, run.id)), /blind@example.test/);
  assert.equal(run.attempt.message.bcc[0], "blind@example.test", "private durable attempt retains the exact envelope");
  assert.equal(run.result.mail_routing.revision, 2);
}));
test("approval routing settings never enable a disabled feature or manufacture a period", async () => fixture(async f => {
  f.setRouting({ ...mailRouting.policy.defaults("approval_control_summary"), revision: 1, extra_cc_enabled: true, extra_cc_emails: ["observer@example.test"] });
  f.setActivation(null);
  const result = await job.runDue(context, f.options);
  assert.equal(result.state, "not_activated"); assert.equal(f.reads, 0); assert.equal(f.routingReads, 0);
  assert.equal(f.records.size, 0); assert.equal(f.providerCalls.length, 0);
}));
test("approval recipient conflict and mid-flight routing disable fail closed without provider or replay", async () => {
  await fixture(async f => {
    f.setRouting({ ...mailRouting.policy.defaults("approval_control_summary"), revision: 1, extra_cc_enabled: true, extra_cc_emails: [current.user.email] });
    const run = await job.runDue(context, f.options);
    assert.equal(run.result.state, "failed"); assert.equal(f.providerCalls.length, 0);
  });
  await fixture(async f => {
    const config = { ...mailRouting.policy.defaults("approval_control_summary"), revision: 1, extra_bcc_enabled: true, extra_bcc_emails: ["blind@example.test"] };
    f.setRouting(config);
    const attempt = repo.attempt;
    await patches([[repo, "attempt", async (...args) => { const claimed = await attempt(...args); f.setRouting({ ...config, revision: 2, extra_bcc_enabled: false }); return claimed; }]], async () => {
      const run = await job.runDue(context, f.options);
      assert.equal(run.result.state, "blocked"); assert.equal(run.result.mail_attempted, false);
      assert.equal((await job.runDue(context, f.options)).state, "duplicate");
    });
    assert.equal(f.providerCalls.length, 0);
  });
});

test("today pending rows qualify at 14:30 Copenhagen; no earlier, later, weekend or historical catch-up", async () => fixture(async f => {
  f.setNow("2026-10-22T12:29:59Z"); assert.equal((await job.runDue(context, f.options)).state, "not_due");
  f.setNow("2026-10-22T12:30:00Z"); const run = await job.runDue(context, f.options);
  assert.equal(run.result.state, "provider_accepted"); assert.equal(run.result.counts.open_rows, 1); assert.equal(f.providerCalls.length, 1);
  assert.deepEqual(f.providerCalls[0].message.cc, []); assert.equal(f.providerCalls[0].message.to, current.user.email);
  f.setNow("2026-10-22T12:31:00Z"); assert.equal((await job.runDue(context, f.options)).state, "not_due");
  f.setNow("2026-10-24T12:30:00Z"); assert.equal((await job.runDue(context, f.options)).state, "not_due");
}));

test("future and approved rows are excluded; future pending can join next weekday", async () => fixture(async f => {
  f.setRows([row(), row(2, { date: "2026-10-23T00:00:00" }), row(3, { approvedBy: "DEP", approvedDate: "2026-10-22T13:00:00" })]);
  const first = await job.runDue(context, f.options);
  assert.deepEqual(first.result.pending.map(r => r.id), ["1"]); assert.equal(first.result.future_excluded, 1); assert.equal(first.result.approved_count, 1);
  f.setNow("2026-10-23T12:31:00Z"); const next = await job.runDue(context, f.options);
  assert.deepEqual(next.result.pending.map(r => r.id), ["1", "2"]); assert.equal(f.providerCalls.length, 2);
}));

test("9015 and all projects outside canonical mine never enter mail irrespective of fitter", async () => fixture(async f => {
  f.setRows([row(), row(2, { projectID: 17636 }), row(3, { projectID: 99999 }), row(4, { projectID: 17636, date: "2026-10-23T00:00:00" })]);
  const run = await job.runDue(context, f.options); assert.equal(run.result.pending.length, 1);
  assert.equal(run.result.future_excluded, 0);
  assert.doesNotMatch(JSON.stringify(f.providerCalls), /9015|17636|99999/);
}));

test("distinct EK IDs remain separate, same ID once, visual grouping preserves every identity", async () => fixture(async f => {
  f.setRows([row(), row(2), row(3), row(3)]);
  const run = await job.runDue(context, f.options);
  assert.deepEqual(run.result.pending.map(r => r.id), ["1", "2", "3"]); assert.equal(run.result.counts.hours, 22.5);
  const display = mail.grouped(run.result.pending); assert.deepEqual(display[0].ids, ["1", "2", "3"]); assert.equal(display[0].hours, 22.5);
  assert.match(f.providerCalls[0].message.subject, /^Godkendelseskontrol: 3 registreringer afventer på dine sager$/);
  assert.match(f.providerCalls[0].message.html, /&lt;person&gt;/); assert.doesNotMatch(f.providerCalls[0].message.html, /Fixture <person>/);
}));

test("no pending or only unknown means no provider; unknown remains visible", async () => {
  for (const rows of [[], [row(1, { approvedBy: "DEP", approvedDate: "2026-10-22T13:00:00" })], [row(1, { approvedBy: "" })]]) await fixture(async f => {
    f.setRows(rows); const run = await job.runDue(context, f.options);
    assert.equal(run.result.state, "no_open"); assert.equal(f.providerCalls.length, 0);
    assert.equal(run.result.unknown.length, rows[0]?.approvedBy === "" ? 1 : 0);
  });
});

test("data clarification never enters mail, known pending remains independent", async () => fixture(async f => {
  const missing = row(2); delete missing.approvedDate;
  f.setRows([row(), missing]); const run = await job.runDue(context, f.options);
  assert.deepEqual(run.result.pending.map(r => r.id), ["1"]); assert.equal(run.result.unknown.length, 1);
  assert.equal(run.result.unknown[0].reason, "Godkendelsesfelter mangler i EK-svaret.");
}));

test("same day reruns/concurrent workers and process restart send at most once", async () => fixture(async f => {
  const result = await Promise.all([job.runDue(context, f.options), job.runDue(context, f.options)]);
  assert.equal(result.filter(r => r.state === "duplicate").length, 1);
  delete require.cache[require.resolve("../backend/src/modules/approvalControl/approvalControl.mailJob")];
  const restarted = require("../backend/src/modules/approvalControl/approvalControl.mailJob");
  assert.equal((await restarted.runDue(context, f.options)).state, "duplicate");
  assert.equal(f.providerCalls.length, 1); assert.equal(f.reads, 1);
}));

test("still-open row qualifies next weekday with a new daily provider idempotency key", async () => fixture(async f => {
  await job.runDue(context, f.options); f.setNow("2026-10-23T12:31:00Z"); await job.runDue(context, f.options);
  assert.equal(f.providerCalls.length, 2); assert.notEqual(f.providerCalls[0].options.idempotencyKey, f.providerCalls[1].options.idempotencyKey);
}));

test("approval after the previous preview/mail removes the row from next scheduled day", async () => fixture(async f => {
  await job.runDue(context, f.options);
  f.setRows([row(1, { approvedBy: "DEP", approvedDate: "2026-10-23T13:00:00" })]);
  f.setNow("2026-10-23T12:31:00Z"); const next = await job.runDue(context, f.options);
  assert.equal(next.result.state, "no_open"); assert.equal(next.result.approved_count, 1); assert.equal(f.providerCalls.length, 1);
}));

test("simulation never calls provider even with live flags enabled; simulated and real day claims are separate", async () => fixture(async f => {
  const simulated = await job.runDue(context, { ...f.options, mode: "simulation" });
  assert.equal(simulated.result.state, "simulated"); assert.equal(simulated.result.mail_attempted, false); assert.equal(simulated.attempt, null);
  assert.equal(f.providerCalls.length, 0); assert.match(simulated.result.message.text, /før aktiveringsdatoen er ikke omfattet/);
  assert.equal((await job.runDue(context, f.options)).result.state, "provider_accepted");
}));

test("before activation there is no period and default-off flags never trigger EK or mail", async () => fixture(async f => {
  const disabled = policy.read({}, new Date("2026-10-22T12:30:00Z"));
  assert.equal(disabled.coverage_from, null); assert.equal(disabled.coverage_to, null); assert.equal(disabled.friday_local_time, "14:31");
  assert.equal(disabled.coverage_valid, false); assert.equal(disabled.schedule_valid, true);
  assert.equal((await job.runDue(context, { ...f.options, readPolicy: () => disabled })).state, "disabled");
  assert.equal(f.reads, 0); assert.equal(f.records.size, 0);
}));

test("even enabled flags cannot create an activation, operational rows, failures or mail", async () => fixture(async f => {
  f.setActivation(null);
  for (const mode of ["simulation", "live"]) assert.equal((await job.runDue(context, { ...f.options, mode })).state, "not_activated");
  f.records.set("old-fixture", { id: uuid(7), result: { state: "failed", pending: [row()] } });
  const status = await job.status(context, new Date("2026-10-22T12:30:00Z"));
  assert.equal(status.coverage_from, null); assert.equal(status.coverage_to, null); assert.equal(status.next_scheduled_at, null); assert.equal(status.latest, null);
  assert.match(status.coverage_statement, /Ingen aktiv kontrolperiode/);
  await assert.rejects(job.getRun(context, uuid(7)), /run_not_found/);
  assert.equal(f.reads, 0); assert.equal(f.providerCalls.length, 0); assert.equal(f.records.size, 1);
}));

test("activation date uses Copenhagen calendar including UTC midnight and winter time", () => {
  for (const [stamp, date] of [["2026-10-22T22:30:00.000Z", "2026-10-23"], ["2026-10-25T23:30:00.000Z", "2026-10-26"]]) {
    const first = { ...firstActivation, activated_at: stamp, coverage_from: date };
    assert.equal(policy.read({}, new Date("2026-10-27T12:00:00Z"), first).coverage_from, date);
    assert.equal(policy.read({}, new Date("2026-10-27T12:00:00Z"), { ...first, coverage_from: "2026-10-21" }).coverage_valid, false);
  }
  assert.equal(policy.read({}, new Date("2026-10-18T12:00:00Z"), firstActivation).coverage_valid, false);
  assert.equal(policy.read({}, new Date("2026-10-27T12:00:00Z"), { ...firstActivation, environment: "test" }).coverage_valid, false);
});

test("pause/resume and stale pre-activation job history never reset the start date", async () => fixture(async f => {
  const run = await job.runDue(context, f.options);
  const paused = policy.read({}, new Date("2026-10-22T12:30:00Z"), f.activation);
  assert.equal(paused.scheduler_enabled, false); assert.equal(paused.coverage_from, "2026-10-19");
  assert.equal((await job.runDue(context, { ...f.options, readPolicy: () => paused })).state, "disabled");
  f.setNow("2026-10-23T12:31:00Z"); const resumed = await job.runDue(context, f.options);
  assert.equal(resumed.coverage_from, run.coverage_from); assert.equal(resumed.activation_id, run.activation_id);
  assert.equal(job.visible({ ...run, activation_id: uuid(99), result: { state: "failed" } }, current, f.activation), null);
  assert.equal(job.visible({ ...run, activation_id: undefined }, current, f.activation), null);
}));

test("old operator activation contract cannot bypass the new atomic tenant-admin control", async () => fixture(async f => {
  await assert.rejects(job.activateScheduler(context, { confirm: "ACTIVATE:approval_control:hoyrup-clemmensen" }), /control_input_invalid/);
  await assert.rejects(job.activateScheduler(context, { coverage_from: "2025-06-15" }), /control_input_invalid/);
  assert.equal(f.records.size, 0); assert.equal(f.reads, 0);
  assert.equal(f.providerCalls.length, 0);
}));

test("pause during capture or after durable attempt blocks every provider call, even after resume", async () => {
  for (const point of ["capture", "attempt"]) await fixture(async f => {
    const pause = () => f.setControl({ ...f.control, enabled: false, revision: f.control.revision + 1 });
    const resume = () => f.setControl({ ...f.control, enabled: true, revision: f.control.revision + 1, enabled_at: "2026-10-22T12:30:10Z" });
    const target = point === "capture" ? source : repo, key = point === "capture" ? "capture" : "attempt", original = target[key];
    await patches([[target, key, async (...args) => { const result = await original(...args); pause(); if (point === "attempt") resume(); return result; }]], async () => {
      const run = await job.runDue(context, f.options);
      assert.equal(run.result.state, "blocked"); assert.equal(run.result.mail_attempted, false);
      assert.equal(f.providerCalls.length, 0);
    });
    assert.equal((await job.runDue(context, f.options)).state, point === "capture" ? "disabled" : "not_due");
  });
});

test("activation inside an existing scheduled minute never catches up that slot", async () => fixture(async f => {
  f.setControl({ ...f.control, enabled_at: "2026-10-22T12:30:00Z" });
  assert.equal((await job.runDue(context, f.options)).state, "not_due");
  f.setControl({ ...f.control, enabled_at: "2026-10-22T12:30:10Z" });
  f.setNow("2026-10-22T12:30:30Z");
  assert.equal((await job.runDue(context, f.options)).state, "not_due");
  assert.equal(f.records.size, 0); assert.equal(f.reads, 0); assert.equal(f.providerCalls.length, 0);
  f.setNow("2026-10-23T12:31:00Z");
  assert.equal((await job.runDue(context, f.options)).result.state, "provider_accepted");
  assert.equal(f.providerCalls.length, 1);
}));

test("go-live work date is inclusive; older open and invalid approvals are not operational data", async () => fixture(async f => {
  f.setRows([row(1, { date: "2026-10-18T00:00:00", approvedBy: "" }), row(2, { date: "2026-10-19T00:00:00" }), row(3), row(4, { date: "2026-10-23T00:00:00" })]);
  const run = await job.runDue(context, f.options);
  assert.deepEqual(run.result.pending.map(r => r.id), ["2", "3"]);
  const message = f.providerCalls[0].message;
  assert(message.text.endsWith("Kontrollen omfatter registreringer fra og med 19. oktober 2026."));
  assert.match(message.html, /Kontrollen omfatter registreringer fra og med 19\. oktober 2026\./);
  assert.doesNotMatch(message.text, /18\.10\.2026|23\.10\.2026/);
  assert.equal(run.result.unknown.length, 0);
  const nextYear = policy.read({}, new Date("2027-10-22T12:30:00Z"), f.activation);
  assert.equal(nextYear.coverage_from, "2026-10-19");
}));

test("unapproved period or Friday overrides fail closed without source/claim/provider", async () => {
  for (const override of [{ APPROVAL_CONTROL_COVERAGE_FROM: "2025-06-15" }, { APPROVAL_CONTROL_COVERAGE_FROM: "2026-10-19" }, { APPROVAL_CONTROL_COVERAGE_FROM: "" }, { APPROVAL_CONTROL_FRIDAY_TIME: "14:30" }]) await fixture(async f => {
    const readPolicy = () => policy.read({ APPROVAL_CONTROL_MAIL_ENABLED: "true", APPROVAL_CONTROL_SCHEDULER_ENABLED: "true", ...override }, new Date("2026-10-22T12:30:00Z"));
    assert.equal((await job.runDue(context, { ...f.options, readPolicy })).state, "blocked");
    assert.equal(f.reads, 0); assert.equal(f.providerCalls.length, 0); assert.equal(f.records.size, 0);
  });
});

test("historical manual preview cannot change the daily mail period", () => {
  const preview = require("../backend/src/modules/approvalControl/approvalControl.service");
  assert.equal(preview.request({ from_date: "2025-12-22", to_date: "2025-12-26" }).fromDate, "2025-12-22");
  assert.equal(policy.read({}, new Date("2026-10-22T12:30:00Z")).coverage_from, null);
});

test("approved Friday14:31 starts outside unchanged blackout; DST and weekend slots remain correct", async () => fixture(async f => {
  f.setNow("2026-10-23T12:30:00Z");
  assert.equal((await job.runDue(context, f.options)).state, "not_due"); assert.equal(f.reads, 0);
  assert.equal(admission.protectedWindow(new Date("2026-10-23T12:30:59Z")), true);
  f.setNow("2026-10-23T12:31:00Z"); assert.equal((await job.runDue(context, f.options)).result.state, "provider_accepted");
  assert.equal(policy.instant("2026-10-23", "14:30"), "2026-10-23T12:30:00.000Z");
  assert.equal(policy.instant("2026-10-26", "14:30"), "2026-10-26T13:30:00.000Z");
  assert.equal(policy.instant("2026-10-30", "14:31"), "2026-10-30T13:31:00.000Z");
  assert.equal(policy.next(new Date("2026-10-23T12:30:00Z"), f.options.readPolicy()), "2026-10-23T12:31:00.000Z");
  assert.equal(policy.next(new Date("2026-10-23T12:32:00Z"), f.options.readPolicy()), "2026-10-26T13:30:00.000Z");
}));

test("source failure or scope change blocks whole mail without leaking raw error", async () => fixture(async f => {
  await patches([[source, "capture", async () => { throw new Error("approval_control_source_page_limit"); }]], async () => {
    const run = await job.runDue(context, f.options); assert.equal(run.result.state, "failed"); assert.match(run.result.reason, /Ingen delvis mail/);
  });
  f.setNow("2026-10-23T12:31:00Z");
  await patches([[source, "capture", async () => { f.setScope({ ...current, projects: [], bindings: [] }); return { rows: [row()] }; }]], async () => {
    const run = await job.runDue(context, f.options); assert.equal(run.result.state, "failed"); assert.match(run.result.reason, /ændrede sig/);
  }); assert.equal(f.providerCalls.length, 0);
}));

test("provider rejection, uncertainty and missing receipt are terminal without retry", async () => {
  for (const response of [400, 500, 409, null]) await fixture(async f => {
    let attempts = 0;
    const options = { ...f.options, sendEmailFn: async () => { attempts++; if (response === null) return { sent: true }; const error = new Error("sensitive provider details"); error.details = { status: response, body: "must not persist" }; throw error; } };
    const run = await job.runDue(context, options); assert.equal(run.result.state, response === 400 ? "provider_rejected" : "provider_unclear");
    assert.equal((await job.runDue(context, options)).state, "duplicate"); assert.equal(attempts, 1);
    assert.doesNotMatch(JSON.stringify(run), /sensitive provider|must not persist/);
  });
});

test("actual existing mail adapter payload uses existing sender, To DEP, no CC and valid Resend tags", async () => fixture(async f => {
  await patches([[global, "fetch", async (url, options) => {
    assert.equal(url, "https://api.resend.com/emails"); const payload = JSON.parse(options.body);
    assert.deepEqual(payload.to, [current.user.email]); assert.equal(payload.cc, undefined);
    assert.equal(payload.from, process.env.MAIL_FROM); assert.equal(payload.reply_to, process.env.MAIL_REPLY_TO);
    assert(payload.tags.every(tag => /^[A-Za-z0-9_-]+$/.test(tag.value))); assert.match(options.headers["Idempotency-Key"], /^approval_control:/);
    return { ok: true, json: async () => ({ id: "simulated-resend-response" }) };
  }]], async () => {
    const run = await job.runDue(context, { ...f.options, sendEmailFn: mailService.sendEmail }); assert.equal(run.result.provider_id, "simulated-resend-response");
  });
}));

test("history and deep link retain current server scope, cannot expose removed projects", async () => fixture(async f => {
  const run = await job.runDue(context, f.options);
  const orphan = job.visible({ ...run, result: null }, current, f.activation);
  assert.equal(orphan.state, "provider_unclear"); assert.equal(orphan.mail_attempted, null);
  f.setScope({ ...current, projects: [], bindings: [] });
  const visible = await job.getRun(context, run.id); assert.equal(visible.pending.length, 0); assert.equal(visible.counts.open_rows, 0);
  await assert.rejects(job.getRun(context, "forged?scope=all"), /run_invalid/);
  await assert.rejects(job.getRun({ ...context, tenantId: uuid(99) }, run.id));
}));

test("tenant lifecycle, recipient changes and missing project bindings fail closed", async () => fixture(async f => {
  f.setScope({ ...current, user: { ...current.user, email: "other@example.test" } });
  await assert.rejects(job.runDue(context, f.options), /recipient_invalid/);
  f.setScope({ ...current, bindings: [] }); const blocked = await job.runDue(context, f.options); assert.equal(blocked.result.state, "failed"); assert.equal(f.providerCalls.length, 0);
}));

test("last pre-provider recipient revocation is blocked, not a fictitious mail attempt", async () => fixture(async f => {
  const attempt = repo.attempt;
  await patches([[repo, "attempt", async (...args) => { const claimed = await attempt(...args); f.setScope({ ...current, user: { ...current.user, email: "revoked@example.test" } }); return claimed; }]], async () => {
    const run = await job.runDue(context, f.options);
    assert.equal(run.result.state, "blocked"); assert.equal(run.result.mail_attempted, false); assert.match(run.result.reason, /Ingen provider kontaktet/);
    assert.equal(f.providerCalls.length, 0); assert(run.attempt);
  });
}));

test("final stopflag and snapshot age recheck prevent delivery after database waits", async () => {
  for (const condition of ["stop", "expired"]) await fixture(async f => {
    let stop = false; const attempt = repo.attempt;
    const readPolicy = first => ({ ...f.options.readPolicy(first), mail_enabled: !stop });
    await patches([[repo, "attempt", async (...args) => { const claimed = await attempt(...args); if (condition === "stop") stop = true; else f.setNow("2026-10-22T12:33:00Z"); return claimed; }]], async () => {
      const run = await job.runDue(context, { ...f.options, readPolicy });
      assert.equal(run.result.state, "blocked"); assert.equal(run.result.mail_attempted, false); assert.equal(f.providerCalls.length, 0);
    });
  });
});

test("post-provider audit failure preserves known acceptance, never repeats provider", async () => fixture(async f => {
  const finish = repo.finish; let fail = true;
  await patches([[repo, "finish", async (...args) => { if (fail) { fail = false; throw new Error("fixture_persistence_failure"); } return finish(...args); }]], async () => {
    const run = await job.runDue(context, f.options); assert.equal(run.result.state, "provider_accepted"); assert.equal(run.result.provider_id, "fixture-provider");
    assert.equal((await job.runDue(context, f.options)).state, "duplicate"); assert.equal(f.providerCalls.length, 1);
  });
}));

test("actual reader/mail pipeline completes 2000 rows but never mails a truncated control period", async () => {
  for (const total of [2000, 2001]) await fixture(async f => {
    let requests = 0;
    await patches([[source, "capture", args => actualCapture({ ...args, config: { ekBaseUrl: "https://ek.example.test", ekApiKey: "fixture", siteName: "fixture" }, fetchImpl: async url => {
      requests++; const page = Number(url.searchParams.get("page"));
      assert.equal(url.searchParams.get("fromDate"), "2026-10-19"); assert.equal(url.searchParams.get("toDate"), "2026-10-22");
      const start = (page - 1) * 100, rows = Array.from({ length: Math.min(100, total - start) }, (_, i) => row(start + i + 1, { hours: 0.25 }));
      return { status: 200, json: async () => ({ hasErrors: false, data: { data: rows, total, currentPage: page, nextPage: start + rows.length < total ? page + 1 : null } }) };
    } })]], async () => {
      const run = await job.runDue(context, f.options);
      assert.equal(run.result.state, total === 2000 ? "provider_accepted" : "failed");
      assert.equal(f.providerCalls.length, total === 2000 ? 1 : 0); assert.equal(requests, total === 2000 ? 40 : 20);
    });
  });
});

test("mail admission stays in existing cooldown but cannot masquerade as an unfinished manual preview", async () => {
  const audit = require("../backend/src/modules/approvalControl/approvalControl.audit");
  const auditService = require("../backend/src/services/auditService");
  const id = uuid(8); let metadata;
  const client = { release() {}, async query(sql) {
    return { rows: sql.includes("pg_try_advisory_lock") ? [{ locked: true }] : [] };
  } };
  await patches([[pool, "connect", async () => client], [auditService, "logAuditEvent", async event => { metadata = event.metadata; assert.equal(event.resourceId, id); }]], async () => {
    await admission.read(context, async () => {}, new Date("2026-10-22T12:30:00Z"), { mailRunId: id });
  });
  assert.equal(metadata.mail_run_id, id);
  await audit.latest({ async query(sql) { assert.match(sql, /AND NOT \(event_type='approval_control.capture_admitted' AND metadata \? 'mail_run_id'\)/); return { rows: [] }; } }, context);
});
