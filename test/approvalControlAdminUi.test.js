"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const directory = path.join(__dirname, "../backend/src/public/tenant");
const html = fs.readFileSync(path.join(directory, "approval-control.html"), "utf8");
const source = fs.readFileSync(path.join(directory, "approval-control.js"), "utf8");
const endpoint = "/api/approval-control/admin/control";
const flush = () => new Promise(resolve => setImmediate(resolve));

class Element {
  constructor(tagName = "div") {
    Object.assign(this, { tagName, children: [], listeners: {}, attributes: {}, hidden: false,
      disabled: false, open: false, value: "", _text: "" });
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(" "); }
  set innerHTML(_) { assert.fail("HTML rendering is forbidden"); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ""; this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  async emit(name) {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    for (const fn of this.listeners[name] || []) await fn(event);
    return event;
  }
  showModal() { assert.equal(this.tagName, "dialog"); this.open = true; this.modal = true; }
  focus() { this.focused = true; }
  close() { this.open = false; this.modal = false; void this.emit("close"); }
}

function control(status = "inactive", changes = {}) {
  return { status, revision: status === "inactive" ? 0 : 3,
    today: "2026-10-23", coverage_from: status === "inactive" ? null : "2026-10-19",
    activated_at: status === "inactive" ? null : "2026-10-19T07:00:00.000Z",
    effective_active: status === "active",
    next_scheduled_at: status === "active" ? "2026-10-23T12:31:00.000Z" : null,
    activation_next_scheduled_at: "2026-10-23T12:31:00.000Z",
    time_zone: "Europe/Copenhagen", scheduled_local_time: "14:30", friday_local_time: "14:31",
    mail_routing_revision: 2,
    recipients: { to: ["dep@example.test"], extra_cc: ["observer@example.test"], extra_bcc: ["blind@example.test"] },
    configuration_blockers: [], ...changes };
}

const response = (control, status = 200) => ({ status, ok: status >= 200 && status < 300,
  json: async () => ({ success: status === 200, control: structuredClone(control) }) });

async function harness(initial = control(), options = {}) {
  const elements = new Map();
  for (const match of html.matchAll(/<([a-z][\w-]*)\b[^>]*\bid="([^"]+)"[^>]*>/gi)) {
    const element = new Element(match[1]);
    element.id = match[2];
    element.hidden = /\bhidden\b/.test(match[0]);
    elements.set(element.id, element);
  }
  const get = id => elements.get(id);
  const admin = suffix => get("approval-admin-" + suffix);
  admin("control").append(admin("summary"), admin("status"), admin("action"), admin("retry"), admin("dialog"));
  admin("dialog").append(admin("confirm-form"));
  admin("confirm-form").append(admin("dialog-title"), admin("dialog-details"), admin("dialog-status"), admin("cancel"), admin("confirm"));
  let current = initial, token = options.token === undefined ? "fixture-access-token" : options.token;
  const replies = [...(options.replies || [])], calls = [], events = {};
  const window = { location: { search: "", href: "/tenant/approval-control.html" },
    localStorage: { getItem: () => token, removeItem: () => { token = null; } },
    addEventListener: (name, fn) => { (events[name] ||= []).push(fn); } };
  const fetch = async (url, request = {}) => {
    calls.push({ url, request });
    if (url === endpoint) {
      if (replies.length) {
        const reply = replies.shift();
        return typeof reply === "function" ? reply() : await reply;
      }
      assert.equal(request.method, "GET", "Every POST must have an explicit mocked response");
      return response(current);
    }
    assert.equal(url, "/api/approval-control/status", "No EK, preview, scheduler or mail request allowed");
    return { status: 200, ok: true, json: async () => ({ success: true, operations: null }) };
  };
  vm.runInNewContext(source, { document: { getElementById: get, createElement: tag => new Element(tag) }, window, fetch, URLSearchParams });
  await flush();
  return { get, admin, calls, replies, window,
    setControl: value => { current = value; },
    setToken: value => { token = value; },
    storage: key => { for (const fn of events.storage || []) fn({ key }); },
    open: () => admin("action").emit("click"),
    submit: () => admin("confirm-form").emit("submit"),
    adminCalls: () => calls.filter(call => call.url === endpoint),
    posts: () => calls.filter(call => call.url === endpoint && call.request.method === "POST"),
    text: () => admin("control").textContent };
}

test("admin control has a labelled native modal separate from routing and manual preview", () => {
  const section = html.slice(html.indexOf('<section id="approval-admin-control"'), html.indexOf('<section class="operational-mail-routing"'));
  assert.match(section, /class="approval-admin"[^>]* hidden/);
  assert.match(section, /<dialog[^>]*aria-labelledby="approval-admin-dialog-title"[^>]*aria-describedby="approval-admin-dialog-details"/);
  assert.match(section, /id="approval-admin-cancel" type="button" autofocus/);
  assert.match(section, /id="approval-admin-confirm"[^>]*type="submit" disabled/);
  assert.match(html, /width:min\(680px,calc\(100% - 32px\)\)/);
  assert.match(html, /@media\(max-width:640px\)/);
  assert.match(html, /grid-template-columns:minmax\(0,1fr\)/);
  assert.doesNotMatch(section, /preview-form|operational-mail-routing|jel@/);
});

test("page load only reads; inactive status exposes the activation action with private recipient summary", async () => {
  const ui = await harness();
  assert.equal(ui.admin("control").hidden, false);
  assert.equal(ui.admin("dialog").open, false);
  assert.equal(ui.adminCalls().length, 1);
  assert.equal(ui.posts().length, 0);
  assert.equal(ui.adminCalls()[0].request.headers.Authorization, "Bearer fixture-access-token");
  assert.equal(ui.adminCalls()[0].request.cache, "no-store");
  assert.equal(ui.adminCalls()[0].request.body, undefined);
  assert.equal(ui.admin("action").textContent, "Aktiv\u00e9r Godkendelseskontrol");
  for (const text of ["Ikke aktiv", "blind@example.test", "observer@example.test", "DEP's egne sager", "14.30", "14.31", "Europe/Copenhagen", "23.10.2026"]) assert(ui.text().includes(text), text);
  for (const id of ["mail", "operations-content", "status", "selected-run-content"]) assert(!ui.get(id).textContent.includes("blind@example.test"));
});

test("opening confirmation refreshes both revisions, DB-clock date and recipients without applying", async () => {
  const ui = await harness();
  ui.setControl(control("inactive", { revision: 8, mail_routing_revision: 7, today: "2026-10-24",
    activation_next_scheduled_at: "2026-10-26T13:30:00.000Z",
    recipients: { to: ["current@example.test"], extra_cc: [], extra_bcc: ["fresh@example.test"] } }));
  await ui.open();
  assert.equal(ui.adminCalls().length, 2);
  assert.equal(ui.posts().length, 0);
  assert.equal(ui.admin("dialog").open, true);
  assert.equal(ui.admin("action").focused, true, "the enabled opener receives focus before showModal so native close can restore it");
  const text = ui.admin("dialog-details").textContent;
  for (const expected of ["Startdato l\u00e5ses til 24.10.2026", "26.10.2026", "fresh@example.test", "gamle k\u00f8poster", "Ingen \u00f8jeblikkelig mail"]) assert(text.includes(expected), expected);
  assert(!text.includes("blind@example.test"));
});

test("cancel and Escape close and clear the modal; reopening requires a fresh GET", async () => {
  const ui = await harness();
  await ui.open();
  await ui.admin("cancel").emit("click");
  assert.equal(ui.admin("dialog").open, false);
  assert.equal(ui.admin("dialog-details").textContent, "");
  await ui.submit();
  assert.equal(ui.posts().length, 0);
  await ui.open();
  assert.equal(ui.adminCalls().length, 3);
  const event = await ui.admin("dialog").emit("cancel");
  assert.equal(event.defaultPrevented, true);
  assert.equal(ui.admin("dialog").open, false);
  assert.equal(ui.admin("dialog-details").textContent, "");
  assert.equal(ui.posts().length, 0);
});

test("activation sends only the exact confirmed fresh snapshot and refreshes normal read-only status", async () => {
  const ui = await harness();
  ui.setControl(control("inactive", { revision: 8, mail_routing_revision: 7, today: "2026-10-24" }));
  await ui.open();
  ui.replies.push(response(control("active", { revision: 9, coverage_from: "2026-10-24" })));
  await ui.submit();
  assert.deepEqual(JSON.parse(ui.posts()[0].request.body), { action: "activate", revision: 8,
    expected_local_date: "2026-10-24", mail_routing_revision: 7, confirm: "ACTIVATE:approval_control" });
  assert.equal(ui.posts()[0].request.headers["Content-Type"], "application/json");
  assert.equal(ui.admin("dialog").open, false);
  assert.equal(ui.admin("dialog-details").textContent, "");
  assert.equal(ui.admin("action").textContent, "S\u00e6t p\u00e5 pause");
  assert.equal(ui.calls.filter(call => call.url === "/api/approval-control/status").length, 2);
});

test("active control can be paused with its own confirmation token and no date reset", async () => {
  const ui = await harness(control("active"));
  await ui.open();
  assert(ui.admin("dialog-title").textContent.includes("pause"));
  ui.replies.push(response(control("paused", { revision: 4 })));
  await ui.submit();
  assert.deepEqual(JSON.parse(ui.posts()[0].request.body), { action: "pause", revision: 3,
    expected_local_date: "2026-10-23", mail_routing_revision: 2, confirm: "PAUSE:approval_control" });
  assert(ui.text().includes("Pause"));
  assert(ui.text().includes("19.10.2026"));
  assert.equal(ui.admin("action").textContent, "Aktiv\u00e9r Godkendelseskontrol");
});

test("resume preserves the original start date and displays the actual next server timestamp", async () => {
  const ui = await harness(control("paused", { activation_next_scheduled_at: "2026-10-26T13:30:00.000Z" }));
  await ui.open();
  const text = ui.admin("dialog-details").textContent;
  assert(text.includes("Startdato bevares: 19.10.2026"));
  assert(text.includes("26.10.2026"));
  assert(text.includes("14.30.00"));
  assert(!text.includes("Startdato l\u00e5ses"));
});

test("409 refreshes state but requires an entirely new dialog and explicit confirmation", async () => {
  const ui = await harness();
  await ui.open();
  ui.setControl(control("active", { revision: 4 }));
  ui.replies.push(response(null, 409));
  await ui.submit();
  assert.equal(ui.admin("dialog").open, false);
  assert.equal(ui.admin("dialog-details").textContent, "");
  assert.equal(ui.adminCalls().filter(call => call.request.method === "GET").length, 3);
  assert.equal(ui.admin("action").textContent, "S\u00e6t p\u00e5 pause");
  assert(ui.admin("status").textContent.includes("bekr\u00e6ft handlingen p\u00e5 ny"));
  await ui.submit();
  assert.equal(ui.posts().length, 1);
  await ui.open();
  assert.equal(ui.admin("dialog").open, true);
  assert(ui.admin("confirm").textContent.includes("pause"));
  assert.equal(ui.posts().length, 1);
});

test("state changed during the pre-confirmation GET requires choosing the action again", async () => {
  const ui = await harness();
  ui.setControl(control("active"));
  await ui.open();
  assert.equal(ui.admin("dialog").open, false);
  assert(ui.admin("status").textContent.includes("Status er \u00e6ndret"));
  assert.equal(ui.posts().length, 0);
});

for (const status of [401, 403]) {
  const denied = () => ({ status, ok: false, json: async () => { assert.fail("Denied body must not be parsed"); } });
  test(`${status} on initial GET hides and clears the complete control section`, async () => {
    const ui = await harness(control(), { replies: [denied()] });
    assert.equal(ui.admin("control").hidden, true);
    assert.equal(ui.admin("control").children.length, 0);
    assert.equal(ui.admin("dialog").open, false);
  });
  test(`${status} on dialog GET removes previously shown recipient data`, async () => {
    const ui = await harness();
    ui.replies.push(denied());
    await ui.open();
    assert.equal(ui.admin("control").hidden, true);
    assert.equal(ui.admin("control").children.length, 0);
    assert.equal(ui.admin("dialog-details").textContent, "");
  });
  test(`${status} on POST closes and clears the modal and the whole control section`, async () => {
    const ui = await harness();
    await ui.open();
    ui.replies.push(denied());
    await ui.submit();
    assert.equal(ui.admin("control").hidden, true);
    assert.equal(ui.admin("control").children.length, 0);
    assert.equal(ui.admin("dialog").open, false);
    assert.equal(ui.admin("dialog-details").textContent, "");
    await ui.open(); await ui.submit();
    assert.equal(ui.posts().length, 1);
  });
}

test("configuration blockers explain the production-only restriction and disable activation", async () => {
  const blocker = "Aktivering er kun mulig i produktionsmilj\u00f8et.";
  const ui = await harness(control("inactive", { configuration_blockers: [blocker] }));
  assert.equal(ui.admin("action").disabled, true);
  assert(ui.text().includes(blocker));
  await ui.open();
  assert.equal(ui.admin("dialog").open, false);
  assert.equal(ui.adminCalls().length, 1);
});

test("emergency flag blocks resume but leaves pause available for active, ineffective control", async () => {
  const blocker = "Godkendelseskontrol er stoppet af et overordnet sikkerhedsflag.";
  const stopped = { effective_active: false, next_scheduled_at: null, configuration_blockers: [blocker] };
  const ui = await harness(control("active", stopped));
  assert.equal(ui.admin("action").disabled, false);
  assert(ui.text().includes("Status er Aktiv, men den automatiske drift er stoppet"));
  assert(ui.text().includes(blocker));
  await ui.open();
  ui.replies.push(response(control("paused", stopped)));
  await ui.submit();
  assert.equal(JSON.parse(ui.posts()[0].request.body).action, "pause");
  assert.equal(ui.admin("action").disabled, true);
});

test("a blocker added during confirmation refresh prevents opening the activation dialog", async () => {
  const ui = await harness();
  ui.setControl(control("inactive", { configuration_blockers: ["Aktivering er blokeret."] }));
  await ui.open();
  assert.equal(ui.admin("action").disabled, true);
  assert.equal(ui.admin("dialog").open, false);
  assert.equal(ui.posts().length, 0);
});

test("active control with deactivated DEP and empty To still permits emergency pause", async () => {
  const blocked = { effective_active: false, next_scheduled_at: null,
    recipients: { to: [], extra_cc: [], extra_bcc: [] },
    configuration_blockers: ["DEP-modtageren er ikke aktiv."] };
  const ui = await harness(control("active", blocked));
  assert.equal(ui.admin("control").hidden, false);
  assert.equal(ui.admin("action").disabled, false);
  assert(ui.text().includes("Ingen aktiv DEP-modtager"));
  assert(ui.text().includes("DEP-modtageren er ikke aktiv."));
  await ui.open();
  assert.equal(ui.admin("dialog").open, true);
  assert(ui.admin("confirm").textContent.includes("pause"));
  ui.replies.push(response(control("paused", { ...blocked, revision: 4 })));
  await ui.submit();
  assert.equal(JSON.parse(ui.posts()[0].request.body).action, "pause");
  assert.equal(ui.admin("action").disabled, true, "missing DEP still blocks activation");
});

test("legacy activation with paused revision zero resumes with the original coverage date", async () => {
  const ui = await harness(control("paused", { revision: 0, coverage_from: "2026-10-19" }));
  assert.equal(ui.admin("action").disabled, false);
  await ui.open();
  assert(ui.admin("dialog-details").textContent.includes("Startdato bevares: 19.10.2026"));
  assert(!ui.admin("dialog-details").textContent.includes("Startdato l\u00e5ses"));
  ui.replies.push(response(control("active", { revision: 1, coverage_from: "2026-10-19" })));
  await ui.submit();
  const body = JSON.parse(ui.posts()[0].request.body);
  assert.equal(body.action, "activate");
  assert.equal(body.revision, 0);
  assert.equal(body.expected_local_date, "2026-10-23");
  assert(ui.text().includes("19.10.2026"));
});

test("invalid Friday configuration, null schedules and empty To preserve pause but prevent resume", async () => {
  const blocked = { effective_active: false, friday_local_time: "14:30", next_scheduled_at: null,
    activation_next_scheduled_at: null, recipients: { to: [], extra_cc: [], extra_bcc: [] },
    configuration_blockers: ["Fredagens klokkesl\u00e6t er ugyldigt.", "DEP-modtageren er ikke aktiv."] };
  const ui = await harness(control("active", blocked));
  assert.equal(ui.admin("control").hidden, false);
  assert.equal(ui.admin("action").hidden, false);
  assert.equal(ui.admin("action").disabled, false);
  assert(ui.text().includes("Ingen planlagt k\u00f8rsel"));
  assert(ui.text().includes("Planl\u00e6gning er blokeret"));
  assert(ui.text().includes("Fredagens klokkesl\u00e6t er ugyldigt."));
  assert(!ui.text().includes("fredag kl. 14.31"));
  await ui.open();
  assert.equal(ui.admin("dialog").open, true);
  assert(ui.admin("confirm").textContent.includes("pause"));
  ui.replies.push(response(control("paused", { ...blocked, revision: 4 })));
  await ui.submit();
  assert.equal(JSON.parse(ui.posts()[0].request.body).action, "pause");
  assert.equal(ui.admin("action").hidden, false);
  assert.equal(ui.admin("action").disabled, true);
  assert(ui.text().includes("Pause"));
  await ui.open();
  assert.equal(ui.admin("dialog").open, false);
  assert.equal(ui.posts().length, 1);
});

test("configuration becoming invalid during the fresh dialog GET still permits pause", async () => {
  const ui = await harness(control("active"));
  ui.setControl(control("active", { friday_local_time: "invalid", scheduled_local_time: null,
    effective_active: false, next_scheduled_at: null, activation_next_scheduled_at: null,
    recipients: { to: [], extra_cc: [], extra_bcc: [] }, configuration_blockers: ["Planl\u00e6gning er ugyldig."] }));
  await ui.open();
  assert.equal(ui.admin("dialog").open, true);
  assert.equal(ui.admin("confirm").disabled, false);
  assert(ui.admin("confirm").textContent.includes("pause"));
  assert(ui.admin("dialog-details").textContent.includes("Planl\u00e6gning er ugyldig."));
  assert.equal(ui.posts().length, 0);
});

test("unblocked responses still require valid schedule, recipients and next timestamps", async () => {
  for (const changed of [
    { friday_local_time: "14:30" }, { scheduled_local_time: "invalid" }, { time_zone: "UTC" },
    { activation_next_scheduled_at: null }, { next_scheduled_at: null },
    { recipients: { to: [], extra_cc: [], extra_bcc: [] } },
  ]) {
    const ui = await harness(control("active", changed));
    assert.equal(ui.admin("action").hidden, true, JSON.stringify(changed));
    assert.equal(ui.admin("summary").textContent, "");
    await ui.open(); await ui.submit();
    assert.equal(ui.posts().length, 0);
  }
});

test("configuration blockers never relax revision or DB-clock confirmation validation", async () => {
  for (const changed of [{ revision: "3" }, { mail_routing_revision: -1 }, { today: "invalid" }]) {
    const ui = await harness(control("active", { configuration_blockers: ["Blokeret."], ...changed }));
    assert.equal(ui.admin("action").hidden, true);
    assert.equal(ui.posts().length, 0);
  }
});

test("recipient and blocker strings render as text and never leak into normal status or preview", async () => {
  const injected = '<img src=x onerror="alert(1)">';
  const ui = await harness(control("active", { recipients: { to: ["dep@example.test"], extra_cc: [injected], extra_bcc: [injected] } }));
  await ui.open();
  assert(ui.admin("dialog-details").textContent.includes(injected));
  for (const id of ["mail", "operations-content", "status", "selected-run-content"]) assert(!ui.get(id).textContent.includes(injected));
});

test("malformed control never invents defaults or enables mutation", async () => {
  const ui = await harness(control("inactive", { revision: "0" }));
  assert.equal(ui.admin("action").hidden, true);
  assert.equal(ui.admin("summary").textContent, "");
  assert.equal(ui.admin("retry").hidden, false);
  await ui.open(); await ui.submit();
  assert.equal(ui.posts().length, 0);
});

test("double confirmation cannot submit twice while the POST is pending", async () => {
  const ui = await harness();
  await ui.open();
  let resolve;
  ui.replies.push(new Promise(done => { resolve = done; }));
  const pending = ui.submit();
  await ui.submit();
  assert.equal(ui.posts().length, 1);
  assert.equal(ui.admin("confirm").disabled, true);
  resolve(response(control("active")));
  await pending;
  assert.equal(ui.admin("dialog").open, false);
});

test("storage/session revocation closes the modal and late POST success cannot restore private data", async () => {
  const ui = await harness();
  await ui.open();
  let resolve;
  ui.replies.push(new Promise(done => { resolve = done; }));
  const pending = ui.submit();
  ui.setToken("different-session");
  ui.storage("fielddesk_access_token");
  assert.equal(ui.admin("dialog").open, false);
  resolve(response(control("active")));
  await pending;
  assert.equal(ui.admin("control").hidden, true);
  assert.equal(ui.admin("control").children.length, 0);
  assert.equal(ui.admin("dialog-details").textContent, "");
  assert.equal(ui.calls.filter(call => call.url === "/api/approval-control/status").length, 1);
});

test("failed POST shows a safe uncertainty message and requires a fresh read, never an automatic retry", async () => {
  const ui = await harness();
  await ui.open();
  ui.replies.push(() => { throw new Error("private provider details blind@example.test"); });
  await ui.submit();
  assert.equal(ui.admin("dialog").open, false);
  assert.equal(ui.admin("summary").textContent, "");
  assert(!ui.admin("status").textContent.includes("private"));
  assert(ui.admin("status").textContent.includes("Resultatet kunne ikke bekr\u00e6ftes"));
  assert.equal(ui.posts().length, 1);
  await ui.admin("retry").emit("click");
  assert.equal(ui.admin("action").hidden, false);
  assert.equal(ui.posts().length, 1);
});

test("confirmation already submitted cannot be presented as cancelled while its result is pending", async () => {
  const ui = await harness();
  await ui.open();
  let complete;
  ui.replies.push(new Promise(resolve => { complete = resolve; }));
  const pending = ui.submit();
  await flush();
  assert.equal(ui.admin("cancel").disabled, true);
  assert.equal(ui.admin("confirm").disabled, true);
  await ui.admin("cancel").emit("click");
  const escape = await ui.admin("dialog").emit("cancel");
  assert.equal(escape.defaultPrevented, true);
  assert.equal(ui.admin("dialog").open, true);
  assert.equal(ui.posts().length, 1);
  complete(response(control("active", { revision: 1 })));
  await pending;
  assert.equal(ui.admin("dialog").open, false);
  assert.equal(ui.admin("cancel").disabled, false);
  assert.equal(ui.posts().length, 1);
});

test("missing token hides the control and never calls the admin endpoint", async () => {
  const ui = await harness(control(), { token: null });
  assert.equal(ui.adminCalls().length, 0);
  assert.equal(ui.admin("control").hidden, true);
  assert.equal(ui.admin("control").children.length, 0);
});
