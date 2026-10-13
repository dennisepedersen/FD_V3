"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "backend/src/public/tenant/time-control.html"), "utf8");
const auth = fs.readFileSync(path.join(root, "backend/src/public/tenant/auth.js"), "utf8");
const operationsSource = auth.slice(auth.indexOf("  async function initTimeControlOperations()"), auth.indexOf("  async function initTimeControlPage()"));
const pageSource = auth.slice(auth.indexOf("  async function initTimeControlPage()"), auth.indexOf('  if (document.body && document.body.dataset.page === "time-control")'));
const endpoint = "/api/tenant/admin/time-control/operations-status";

class Element {
  constructor(tag = "div") {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.listeners = {};
    this.hidden = false;
    this.value = "";
    this._text = "";
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
  set innerHTML(_) { throw new Error("Unsafe HTML assignment"); }
  get lastElementChild() { return this.children.at(-1); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ""; this.children = children; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  contains(item) { return this === item || this.children.some(child => child.contains(item)); }
  querySelectorAll(selector) {
    assert.equal(selector, "details[open][id]");
    return descendants(this).filter(item => item.tagName === "details" && item.open && item.id);
  }
  scrollIntoView() { this.scrolled = true; }
}

function descendants(element) {
  return element.children.flatMap(child => [child, ...descendants(child)]);
}

function harness(responder, location = {}) {
  const elements = new Map();
  for (const match of html.matchAll(/id="([^"]+)"/g)) {
    const element = new Element();
    element.id = match[1];
    elements.set(match[1], element);
  }
  const calls = [];
  const authFailures = [];
  const listeners = {};
  const document = {
    createElement: tag => new Element(tag),
    getElementById: id => elements.get(id) || Array.from(elements.values()).flatMap(descendants).find(item => item.id === id) || null,
  };
  const window = {
    location: { hash: "", search: "", hostname: "example.test", ...location },
    addEventListener: (name, handler) => { listeners[name] = handler; },
  };
  const context = vm.createContext({
    document, window, URLSearchParams,
    apiFetch: async (url, options) => { calls.push({ url, options }); return responder(url, options); },
    handleAuthFailure: error => { authFailures.push(error.status); return false; },
    requireToken: () => true,
    isTenantAdmin: user => user?.role === "tenant_admin",
    getErrorMessage: (_error, fallback) => fallback,
  });
  vm.runInContext(operationsSource + pageSource, context);
  return {
    calls, authFailures, window, listeners, context,
    get: document.getElementById,
    start: () => context.initTimeControlOperations(),
    startPage: () => context.initTimeControlPage(),
    refresh: () => document.getElementById("timeControlOperationsRefresh").listeners.click(),
    text: () => document.getElementById("timeControlOperationsContent").textContent,
    message: () => document.getElementById("timeControlOperationsMessage").textContent,
  };
}

function snapshot() {
  return {
    success: true, now: "2026-10-13T12:45:00Z",
    next_expected: { scheduled_at: "2026-10-14T07:00:00Z", control_type: "daily_09", controlled_date: "2026-10-13" },
    watchdog: { last_checked_at: "2026-10-13T12:40:00Z" },
    missing_expected: [{ scheduled_at: "2026-10-13T07:00:00Z", control_type: "daily_09", controlled_date: "2026-10-12", reason: "not_started" }],
    executions: [{
      id: "run-1", origin: "scheduled", scheduled_at: "2026-10-13T07:00:00Z", controlled_date: "2026-10-12",
      control_type: "daily_09", status: "partial", started_at: "2026-10-13T07:00:03Z", finished_at: "2026-10-13T07:02:00Z",
      error_code: "EK_TIMEOUT", counts: { ok: 0, under_norm: 1, blocked: 5, expected_mails: 1 },
      steps: [{ id: "step-1", step: "capture", status: "failed", occurred_at: "2026-10-13T07:02:00Z",
        started_at: "2026-10-13T07:00:03Z", finished_at: "2026-10-13T07:02:00Z", duration_ms: 117000,
        counts: { pages: 1, rows: 10 }, error_code: "EK_TIMEOUT" }],
      mails: ["accepted", "pending", "rejected", "unclear"].map((status, index) => ({
        id: `mail-${index}`, recipient_email: `technician${index}@example.test`, status,
        provider_message_id: index === 0 ? "provider-employee" : null, error_code: index === 2 ? "PROVIDER_REJECTED" : null,
      })),
      status_report: { id: "report-1", status: "accepted", provider_message_id: "provider-report", error_code: null },
    }, {
      id: "incident-1", origin: "incident", scheduled_at: "2026-10-13T12:00:00Z", status: "completed",
      steps: [], mails: [], status_report: null,
    }],
    reports: [{ id: "report-1", report_date: "2026-10-12", status: "accepted", provider_message_id: "provider-report", error_code: null }],
  };
}

test("operations markup is unframed, labelled and separate from existing manual/test controls", () => {
  assert.match(html, /id="timeControlOperations" class="operations"/);
  assert.match(html, /href="#operations"/);
  assert.match(html, /id="operations"/);
  const section = html.slice(html.indexOf('<section id="timeControlOperations"'), html.indexOf('<section id="kontrolgruppe"'));
  assert.equal((section.match(/<button\b/g) || []).length, 1);
  assert.match(section, /type="button" title="Opdatér driftsstatus"/);
  assert.match(section, /aria-live="polite"/);
  assert.match(section, /Provider accepterede er ikke bevis for modtagelse i indbakken/);
  assert.doesNotMatch(section, /<form|btnPrimary|onclick|<script/);
  assert.match(html, /Manuelle kontroller og historik/);
  assert.match(html, /Resultater · ikke driftskvitteringer/);
  assert.doesNotMatch(html, /Testtilstand – ingen automatiske mails/);
  for (const id of ["timeControlMailTestForm", "timeControlWeeklyForm", "timeControlRecipientsForm"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(operationsSource, /innerHTML|insertAdjacentHTML|method: "(?:POST|PUT|PATCH|DELETE)"|setInterval/);
});

test("renders Copenhagen next/latest/missing, timeline, exact provider states and IDs", async () => {
  const ui = harness(() => snapshot());
  await ui.start();
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.calls[0].url, endpoint);
  assert.equal(ui.calls[0].options.method, "GET");
  assert.equal(ui.calls[0].options.cache, "no-store");
  const text = ui.text();
  for (const expected of ["14.10.2026", "09.00.00", "13.10.2026", "not_started", "EK-indhentning", "EK_TIMEOUT",
    "117.000 ms", "pages1", "rows10", "OK: 0", "Under norm: 1", "Blokerede: 5", "Forventede medarbejdermails: 1",
    "Provider accepterede", "Afventer", "Afvist/fejlet", "Uafklaret", "provider-employee", "provider-report",
    "technician0@example.test", "Statusmail til leder", "Daglige statusrapporter", "Planlagt drift · efterfølgende dokumenteret"]) {
    assert.ok(text.includes(expected), expected);
  }
  const facts = ui.get("timeControlOperationsContent").children[0].textContent;
  assert.match(facts, /Seneste planlagte driftskørsel13\.10\.2026.*Delvist gennemført/);
  assert.doesNotMatch(facts, /Gennemført/);
  assert.match(ui.message(), /Europe\/Copenhagen/);
  assert.equal(ui.get("timeControlOperationsContent").attributes["aria-busy"], "false");
});

test("original scheduled run observed after the incident remains latest scheduled operation, not a new manual run", async () => {
  const data = snapshot();
  data.executions = [{ ...data.executions[0], origin: "incident", run_id: "b2e06989-61c9-4f49-ab92-cc2755e1c302" }];
  const ui = harness(() => data);
  await ui.start();
  assert.match(ui.text(), /Planlagt drift · efterfølgende dokumenteret/);
  assert.match(ui.get("timeControlOperationsContent").children[0].textContent, /Seneste planlagte driftskørsel13\.10\.2026.*Delvist gennemført/);
  assert.doesNotMatch(ui.text(), /ikke planlagt drift/);
});

test("nullable fields and empty arrays are not turned into success or zero counts", async () => {
  const data = { success: true, now: null, next_expected: null, watchdog: null, missing_expected: null, reports: null,
    executions: [{ id: "empty", origin: "scheduled", status: "failed", steps: null, mails: null, counts: null, status_report: null }] };
  const ui = harness(() => data);
  await ui.start();
  assert.match(ui.text(), /OK: Ikke oplyst/);
  assert.match(ui.text(), /Manglende kontroller eller statusrapporterIkke oplyst/);
  assert.match(ui.text(), /Ingen gemte trin/);
  assert.match(ui.text(), /Ingen statusrapport registreret/);
  assert.doesNotMatch(ui.text(), /Provider accepterede/);
  data.executions = [];
  data.missing_expected = [];
  await ui.refresh();
  assert.match(ui.text(), /Ingen driftskørsler registreret/);
  assert.match(ui.text(), /Manglende kontroller eller statusrapporter0/);
});

test("missing daily status report has a Danish type/reason and report-date semantics", async () => {
  const data = snapshot();
  data.missing_expected.push({ scheduled_at: "2026-10-13T07:20:00Z", control_type: "daily_status", controlled_date: "2026-10-13",
    reason: "time_control_status_report_missing" });
  const ui = harness(() => data);
  await ui.start();
  assert.match(ui.text(), /Daglig statusmail · rapportdato 13\.10\.2026 · Daglig statusrapport mangler/);
  assert.match(ui.text(), /Manglende kontroller eller statusrapporter2/);
  assert.doesNotMatch(ui.text(), /time_control_status_report_missing/);
});

test("all execution/report states and actual backend trace codes have Danish labels", async () => {
  const data = snapshot();
  const traces = ["scheduled_start", "run_started", "run_binding", "capture_started", "capture_page", "capture_completed",
    "validation", "calculation", "mail_decision", "queue_committed", "dispatch", "execution_finished", "watchdog", "watchdog_mail", "original_run_observed"];
  data.executions = ["planned", "running", "completed", "partial", "failed", "missed"].map((status, index) => ({
    ...data.executions[0], id: `run-${index}`, status,
    steps: traces.map(step => ({ step, status: "started", counts: null })),
  }));
  data.reports = ["queued", "sending", "accepted", "rejected", "unclear"].map(status => ({ status, report_date: "2026-10-13" }));
  const ui = harness(() => data);
  await ui.start();
  for (const label of ["Planlagt", "I gang", "Gennemført", "Delvist gennemført", "Fejlet", "Mangler",
    "Afventer i kø", "Afsendelse i gang", "Provider accepterede", "Afvist/fejlet", "Uafklaret", "EK-side og forsøg",
    "Kø gemt", "Driftskørsel afsluttet", "Rapportdato: 13.10.2026"]) assert.ok(ui.text().includes(label), label);
  for (const step of traces) assert.ok(!ui.text().includes(step), step);
});

test("loading disables refresh and repeated clicks cannot start concurrent requests", async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const ui = harness(() => pending);
  const started = ui.start();
  assert.equal(ui.get("timeControlOperationsRefresh").disabled, true);
  assert.equal(ui.get("timeControlOperationsContent").attributes["aria-busy"], "true");
  assert.match(ui.message(), /Henter driftsstatus/);
  await ui.refresh();
  assert.equal(ui.calls.length, 1);
  resolve(snapshot());
  await started;
  assert.equal(ui.get("timeControlOperationsRefresh").disabled, false);
});

test("missing endpoint/errors stay local, allow retry and mark old snapshots as stale", async () => {
  let response = Object.assign(new Error("untrusted provider body"), { status: 404 });
  const ui = harness(() => { if (response instanceof Error) throw response; return response; });
  const unrelated = ui.get("timeControlResults");
  unrelated.textContent = "Eksisterende historik";
  await ui.start();
  assert.match(ui.message(), /kunne ikke hentes/);
  assert.doesNotMatch(ui.message(), /untrusted/);
  assert.equal(ui.text(), "");
  assert.equal(unrelated.textContent, "Eksisterende historik");
  response = snapshot();
  await ui.refresh();
  const saved = ui.text();
  response = Object.assign(new Error("offline"), { status: 503 });
  await ui.refresh();
  assert.equal(ui.text(), saved);
  assert.match(ui.message(), /ikke aktuelle/);
  response = { success: false };
  await ui.refresh();
  assert.equal(ui.text(), saved);
  assert.equal(ui.calls.length, 4);
});

test("401/403 clear cached operations and invoke existing authentication handling", async () => {
  for (const status of [401, 403]) {
    let denied = false;
    const ui = harness(() => {
      if (denied) throw Object.assign(new Error("access_denied"), { status });
      return snapshot();
    });
    await ui.start();
    denied = true;
    await ui.refresh();
    assert.equal(ui.text(), "");
    assert.match(ui.message(), /ikke adgang/);
    assert.deepEqual(ui.authFailures, [status]);
  }
});

test("API values are rendered as text, never HTML, executable links or attributes", async () => {
  const attack = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const data = snapshot();
  const execution = data.executions[0];
  execution.id = attack;
  execution.error_code = attack;
  execution.mails[0].recipient_email = attack;
  execution.mails[0].provider_message_id = attack;
  execution.steps[0].step = attack;
  execution.steps[0].counts = { [attack]: attack };
  execution.status = "constructor";
  data.missing_expected[0].reason = attack;
  const ui = harness(() => data);
  await ui.start();
  assert.ok(ui.text().includes(attack));
  const nodes = descendants(ui.get("timeControlOperationsContent"));
  assert.ok(nodes.every(item => !["img", "script", "iframe"].includes(item.tagName)));
  assert.ok(nodes.every(item => Object.keys(item.attributes).every(key => !/^on/i.test(key))));
  assert.ok(nodes.filter(item => item.tagName === "a").every(item => item.href.startsWith("#execution-") && !item.href.includes("<")));
  assert.match(ui.text(), /Ukendt status/);
});

test("execution hash/query links expand the exact record; refresh preserves expansion", async () => {
  for (const location of [{ hash: "#execution-run-1" }, { hash: "#operations", search: "?execution_id=run-1" }]) {
    const ui = harness(() => snapshot(), location);
    await ui.start();
    assert.equal(ui.get("execution-run-1").open, true);
    assert.equal(ui.get("execution-run-1").scrolled, true);
    ui.window.location.hash = "";
    ui.window.location.search = "";
    ui.get("execution-incident-1").open = true;
    await ui.refresh();
    assert.equal(ui.get("execution-incident-1").open, true);
    ui.window.location.hash = "#execution-run-1";
    ui.listeners.hashchange();
    assert.equal(ui.get("execution-run-1").open, true);
    ui.window.location.hash = "#%malformed";
    assert.doesNotThrow(() => ui.listeners.hashchange());
  }
});

test("page auth gate precedes operations; legacy status failure does not suppress operations", async () => {
  for (const role of ["technician", "tenant_admin"]) {
    const ui = harness(url => {
      if (url === "/api/me") return { user: { role } };
      if (url === endpoint) return snapshot();
      throw Object.assign(new Error("legacy endpoint unavailable"), { status: 503 });
    });
    await ui.startPage();
    const operationsCalls = ui.calls.filter(call => call.url === endpoint);
    assert.equal(operationsCalls.length, role === "tenant_admin" ? 1 : 0);
    if (role === "tenant_admin") {
      assert.equal(ui.get("timeControlAdmin").hidden, false);
      assert.match(ui.text(), /EK_TIMEOUT/);
    }
  }
});

test("shared apiFetch retains same-host bearer authentication for the read-only request", async () => {
  const source = auth.slice(auth.indexOf("  async function apiFetch(url, options)"), auth.indexOf("  function showError(message)"));
  const requests = [];
  const context = vm.createContext({
    getToken: () => "local-fixture-token",
    window: { fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => snapshot() };
    } },
  });
  vm.runInContext(source, context);
  await context.apiFetch(endpoint, { method: "GET", cache: "no-store" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, endpoint);
  assert.equal(requests[0].options.headers.Authorization, "Bearer local-fixture-token");
  assert.equal(requests[0].options.body, undefined);
});
