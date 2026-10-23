"use strict";

(function () {
  const get = id => document.getElementById(id);
  const number = value => new Intl.NumberFormat("da-DK", { maximumFractionDigits: 2 }).format(value);
  const day = value => value ? value.split("-").reverse().join(".") : "–";
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const errors = {
    approval_control_poc_access_denied: "Godkendelseskontrol er kun tilgængelig for DEP i denne POC.",
    tenant_context_mismatch: "Login og tenant stemmer ikke overens.",
    approval_control_period_max_seven_days: "Perioden må højst være syv kalenderdage.",
    approval_control_scope_changed: "Dine sager ændrede sig under kontrollen. Kør et nyt preview.",
    approval_control_source_unavailable: "EK-grundlaget kunne ikke verificeres. Ingen rækker er frigivet som afventende.",
    approval_control_preview_running: "En preview-kørsel er allerede i gang.",
    approval_control_audit_unavailable: "Kørselsaudit kunne ikke gemmes. Kontrollen er blokeret; migration 0062 skal være anvendt.",
    approval_control_preview_cooldown: "Vent et minut mellem preview-kørsler.",
    approval_control_protected_window: "Preview er lukket omkring Timekontrols driftsvinduer. Prøv igen senere.",
    project_not_found: "Sagen indgår ikke i dine sager.",
  };

  function table(rows, unknown = false) {
    if (!rows.length) return node("p", unknown ? "Ingen rækker til dataklaring." : "Ingen dokumenterede afventende timerækker.", "empty");
    const wrap = node("div", null, "table-wrap");
    const result = node("table");
    const head = node("thead");
    const titles = node("tr");
    ["Sag", "Sagsnavn", "Medarbejder", "Dato", "Timer", "Status"].forEach(title => titles.append(node("th", title)));
    head.append(titles);
    const body = node("tbody");
    for (const row of rows) {
      const tr = node("tr");
      [row.project_reference, row.project_name, row.fitter_name || `EK fitter ${row.fitter_id ?? "ukendt"}`, day(row.date), typeof row.hours === "number" ? number(row.hours) : "Ukendt", unknown ? row.reason : "Afventer godkendelse"].forEach((text, index) => tr.append(node("td", text || "–", index === 3 || index === 4 ? "nowrap" : "")));
      body.append(tr);
    }
    result.append(head, body);
    wrap.append(result);
    return wrap;
  }

  const jobStates = {
    running: "I gang",
    simulated: "Simuleret · ingen mail sendt",
    no_open: "Ingen åbne rækker",
    blocked: "Blokeret",
    failed: "Fejlet",
    provider_accepted: "Accepteret af mailudbyder · levering ikke bekræftet",
    provider_rejected: "Afvist af mailudbyder",
    provider_unclear: "Uafklaret accept hos mailudbyder",
  };
  const timestamp = value => {
    if (!value) return "Ikke oplyst";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Ukendt tidspunkt" : new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", dateStyle: "short", timeStyle: "medium" }).format(date);
  };
  const enabled = value => value === true ? "Aktiveret" : value === false ? "Deaktiveret" : "Ukendt";
  const count = value => typeof value === "number" && Number.isFinite(value) ? number(value) : "Ukendt";

  function fields(entries) {
    const list = node("dl", null, "operation-fields");
    for (const [label, value] of entries) {
      const item = node("div");
      item.append(node("dt", label), node("dd", value ?? "Ikke oplyst"));
      list.append(item);
    }
    return list;
  }

  function renderJob(container, job, expanded = false) {
    container.replaceChildren();
    if (!job) {
      container.append(node("p", "Ingen gemt planlagt kørsel.", "muted"));
      return;
    }
    container.append(fields([
      ["Job-ID", job.id],
      ["Planlagt tidspunkt · Europe/Copenhagen", timestamp(job.scheduled_at)],
      ["Startet · Europe/Copenhagen", timestamp(job.started_at)],
      ["Kørselsdato", day(job.local_date)],
      ["Tilstand", job.mode === "simulation" ? "Simulation" : job.mode === "live" ? "Live" : "Ukendt"],
      ["Status", jobStates[job.state] || "Ukendt status"],
      ["Årsag", job.reason || "Ingen årsag oplyst"],
      ["Mailforsøg", job.mail_attempted === true ? "Forsøgt" : job.mail_attempted === false ? "Ikke forsøgt" : "Ukendt"],
      ["Provider-ID", job.provider_id || "Ikke registreret"],
      ["Dækningsstart for kørslen", job.coverage_from ? day(job.coverage_from) : "Ikke fastlagt"],
      ["Første produktionsaktivering", timestamp(job.activated_at)],
    ]));
    const details = node("details", null, "job-details");
    details.open = expanded;
    details.append(node("summary", "Åbne rækker og dataklaring"), fields([
      ["Afventende timerækker", count(job.counts?.open_rows)],
      ["Berørte sager", count(job.counts?.projects)],
      ["Timer", count(job.counts?.hours)],
      ["Ældste arbejdsdato", day(job.counts?.oldest_date)],
      ["Fremtidige rækker udeladt", count(job.future_excluded)],
    ]), node("h3", "Åbne timer i den valgte kontrolperiode"), table(job.pending || []), node("h3", "Afventer dataklaring"), table(job.unknown || [], true));
    container.append(details);
  }

  function renderOps(operations) {
    const content = get("operations-content");
    const status = get("operations-status");
    content.replaceChildren();
    status.className = "status";
    if (!operations) {
      status.textContent = "Maildrift er ikke oplyst. Aktivering og næste kørsel kan ikke bekræftes.";
      return;
    }
    status.textContent = !operations.activation_valid ? "Ikke produktionsaktiveret. Ingen aktiv kontrolperiode eller automatisk mail." : operations.next_is_active === true ? "Næste planlagte kørsel er aktiveret." : "Produktionsstart er gemt; automatisk drift er ikke tilkoblet eller er stoppet.";
    content.append(fields([
      ["Scheduler", enabled(operations.scheduler_enabled)],
      ["Automatisk scheduler tilkoblet", operations.scheduler_attached === true ? "Ja" : operations.scheduler_attached === false ? "Nej" : "Ukendt"],
      ["Mailafsendelse", enabled(operations.mail_enabled)],
      ["Næste planlagte tidspunkt · Europe/Copenhagen", operations.next_scheduled_at ? timestamp(operations.next_scheduled_at) : "Ingen kørsel før aktivering"],
      ["Planlagt lokalt klokkeslæt", operations.scheduled_local_time || "Ikke oplyst"],
      ["Planlagt fredag · lokalt klokkeslæt", operations.friday_local_time || "Ikke oplyst"],
      ["Tidszone", operations.time_zone || "Ikke oplyst"],
      ["Første produktionsaktivering", timestamp(operations.activated_at)],
      ["Dækningsstart", operations.coverage_from ? day(operations.coverage_from) : "Ingen aktiv kontrolperiode"],
      ["Dækning til og med", operations.coverage_to ? day(operations.coverage_to) : "Ingen aktiv kontrolperiode"],
    ]), node("p", operations.coverage_statement || "Ingen aktiv kontrolperiode. Godkendelseskontrol er ikke produktionsaktiveret.", "muted"));
    if (operations.coverage_warning) content.append(node("p", operations.coverage_warning, "coverage-warning"));
    if (operations.configuration_blockers?.length) {
      const blockers = node("ul");
      for (const reason of operations.configuration_blockers) blockers.append(node("li", reason));
      content.append(node("h3", "Blokeringer for drift"), blockers);
    }
    const latestJob = node("div");
    content.append(node("h3", "Seneste planlagte kørsel"), latestJob);
    renderJob(latestJob, operations.latest);
  }

  function render(data) {
    get("open-count").textContent = number(data.counts.open_rows);
    get("project-count").textContent = number(data.counts.projects);
    get("hours-count").textContent = number(data.counts.hours);
    get("oldest-date").textContent = day(data.counts.oldest_date);
    get("pending").replaceChildren(table(data.groups.flatMap(group => group.rows)));
    get("unknown").replaceChildren(table(data.unknown, true));
    for (const binding of data.missing_project_bindings) get("unknown").append(node("p", `${binding.reference}: ${binding.reason}`, "muted"));
    const mail = get("mail");
    mail.replaceChildren();
    if (!data.mail.would_include) mail.append(node("p", "Ingen mailbeholdning.", "empty"));
    else {
      const content = node("div", null, "mail");
      const header = node("div", null, "mail-header");
      for (const [title, text] of [["Til", data.mail.to], ["CC", "Ingen"], ["Emne", data.mail.subject]]) header.append(node("span", title), node("strong", text));
      content.append(header, node("p", "Følgende timeregistreringer afventer godkendelse på dine sager:"));
      for (const group of data.groups) content.append(node("h3", `${group.reference} · ${group.name}`), table(group.rows));
      content.append(node("p", `${number(data.counts.open_rows)} åbne timerækker · ${number(data.counts.hours)} timer · Ældste arbejdsdato ${day(data.counts.oldest_date)}`));
      const link = node("a", "Se samme liste i Fielddesk");
      // Never accept an absolute or foreign origin URL from an API response.
      if (data.mail.link.startsWith("/tenant/approval-control.html?")) link.href = data.mail.link;
      content.append(link);
      mail.append(content);
    }
    const details = get("run-details");
    details.replaceChildren(
      node("div", `Kilde observeret: ${new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", dateStyle: "short", timeStyle: "medium" }).format(new Date(data.observed_at))} · Europe/Copenhagen`),
      node("div", `${data.mine_project_count} sager i scope=mine · ${data.approved_count} godkendte rækker udeladt`),
      node("div", "Manuelt preview: ingen mail sendt. Maildriftens status vises særskilt ovenfor."),
      node("div", `Kørselsaudit: ${data.audit.id}${data.audit.duplicate ? " · uændret beholdning" : ""}`, "technical"),
      node("div", `Beholdning: ${data.fingerprint}`, "technical"),
    );
    get("result").hidden = false;
  }

  const query = new URLSearchParams(window.location.search);
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen", dateStyle: "short" }).format(new Date());
  const monday = new Date(today + "T12:00:00Z");
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  get("from-date").value = query.get("from_date") || monday.toISOString().slice(0, 10);
  get("to-date").value = query.get("to_date") || today;
  get("preview-form").addEventListener("submit", async event => {
    event.preventDefault();
    const token = window.localStorage.getItem("fielddesk_access_token");
    if (!token) { window.location.href = "/login"; return; }
    const status = get("status");
    const button = get("preview-button");
    button.disabled = true;
    get("result").hidden = true;
    status.className = "status";
    status.textContent = "Kontrollerer dine sager og EK-grundlaget…";
    try {
      const body = { from_date: get("from-date").value, to_date: get("to-date").value };
      if (query.has("project_id")) body.project_id = query.get("project_id");
      const response = await fetch("/api/approval-control/preview", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (response.status === 401) { window.localStorage.removeItem("fielddesk_access_token"); window.location.href = "/login"; return; }
      if (!response.ok || !data.success) throw new Error(errors[data.error?.message] || errors[data.message] || "Preview kunne ikke gennemføres.");
      render(data);
      status.textContent = data.unknown.length || data.missing_project_bindings.length ? "Preview gennemført. Nogle rækker afventer dataklaring." : "Preview gennemført. Ingen mail er sendt.";
    } catch (error) { status.textContent = error.message; status.className = "status error"; }
    finally { button.disabled = false; }
  });

  async function latest() {
    const token = window.localStorage.getItem("fielddesk_access_token");
    renderOps(null);
    if (!token) { get("operations-status").textContent = "Log ind for at se maildriftens status."; return; }
    get("operations-status").textContent = "Henter driftsstatus…";
    try {
      const response = await fetch("/api/approval-control/status", { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (response.status === 401) { window.localStorage.removeItem("fielddesk_access_token"); window.location.href = "/login"; return; }
      if (!response.ok || data.success === false) throw new Error(errors[data.error?.message] || errors[data.message] || "Driftsstatus kunne ikke hentes.");
      renderOps(data.operations);
      if (data.latest) get("status").textContent = `Seneste manuelle preview: ${new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", dateStyle: "short", timeStyle: "medium" }).format(new Date(data.latest.at))} · ${data.latest.result === "failed" ? "Det manuelle preview fejlede." : data.latest.result === "running" ? "Preview startet uden afsluttet resultat." : "Gennemført."}`;
    } catch (error) {
      renderOps(null);
      get("operations-status").className = "status error";
      get("operations-status").textContent = error.message;
    }
  }

  function initAdminControl() {
    const section = get("approval-admin-control");
    if (!section) return;
    const summary = get("approval-admin-summary");
    const status = get("approval-admin-status");
    const action = get("approval-admin-action");
    const retry = get("approval-admin-retry");
    const dialog = get("approval-admin-dialog");
    const details = get("approval-admin-dialog-details");
    const title = get("approval-admin-dialog-title");
    const dialogStatus = get("approval-admin-dialog-status");
    const confirm = get("approval-admin-confirm");
    const cancel = get("approval-admin-cancel");
    const endpoint = "/api/approval-control/admin/control";
    let current = null, confirmation = null, loading = false, saving = false, revoked = false;

    function accessToken() {
      try { return window.localStorage.getItem("fielddesk_access_token"); }
      catch (_) { return null; }
    }

    function clearConfirmation() {
      confirmation = null;
      details.replaceChildren();
      title.textContent = "";
      dialogStatus.textContent = "";
      confirm.disabled = true;
    }

    function closeDialog() {
      if (dialog.open) dialog.close();
      clearConfirmation();
    }

    function hideControl() {
      revoked = true;
      current = null;
      closeDialog();
      section.hidden = true;
      section.replaceChildren();
    }

    function message(text, error = false) {
      status.textContent = text;
      status.className = error ? "status error" : "status";
    }

    const validDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && !Number.isNaN(new Date(value + "T12:00:00Z").getTime())
      && new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value;
    const validInstant = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)
      && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(new Date(value).getTime());
    const validSchedule = control => control.time_zone === "Europe/Copenhagen"
      && control.scheduled_local_time === "14:30" && control.friday_local_time === "14:31";

    function validControl(control) {
      if (!Array.isArray(control?.configuration_blockers)
        || !control.configuration_blockers.every(value => typeof value === "string")) return false;
      const blocked = control.configuration_blockers.length > 0;
      return control && ["inactive", "active", "paused"].includes(control.status)
        && (control.effective_active === undefined || typeof control.effective_active === "boolean")
        && Number.isSafeInteger(control.revision) && control.revision >= 0
        && Number.isSafeInteger(control.mail_routing_revision) && control.mail_routing_revision >= 0
        && validDate(control.today)
        && (control.status === "inactive" ? control.coverage_from === null && control.activated_at === null
          : validDate(control.coverage_from) && validInstant(control.activated_at))
        && (control.next_scheduled_at === null || validInstant(control.next_scheduled_at))
        && (blocked || (control.status === "active" ? validInstant(control.next_scheduled_at) : control.next_scheduled_at === null))
        && (validInstant(control.activation_next_scheduled_at) || (blocked && control.activation_next_scheduled_at === null))
        && (blocked || validSchedule(control))
        && ["to", "extra_cc", "extra_bcc"].every(key => Array.isArray(control.recipients?.[key])
          && control.recipients[key].every(value => typeof value === "string"))
        && (blocked || control.recipients.to.length > 0);
    }

    async function request(method, body) {
      const token = accessToken();
      if (revoked || !token) { hideControl(); return null; }
      const response = await fetch(endpoint, {
        method, cache: "no-store", redirect: "error",
        ...(typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? { signal: AbortSignal.timeout(20000) } : {}),
        headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (response.status === 401 || response.status === 403 || accessToken() !== token) {
        hideControl();
        return null;
      }
      const data = await response.json().catch(() => null);
      if (revoked || accessToken() !== token) { hideControl(); return null; }
      if (!response.ok || data?.success !== true || !validControl(data.control)) {
        throw Object.assign(new Error("Approval control request failed"), { status: response.status });
      }
      return data.control;
    }

    function updateButtons() {
      action.hidden = !current;
      action.disabled = revoked || loading || saving || !current
        || (current.status !== "active" && (current.configuration_blockers.length > 0 || !current.recipients.to.length));
      retry.disabled = loading || saving;
      cancel.disabled = saving;
    }

    function controlSummary(control) {
      const content = node("div");
      content.append(fields([
        ["Status", { inactive: "Ikke aktiv", active: "Aktiv", paused: "Pause" }[control.status]],
        ["Automatisk drift", control.status === "active" && control.effective_active !== false
          && !control.configuration_blockers.length ? "Aktiv" : "Stoppet"],
        ["Startdato", control.coverage_from ? day(control.coverage_from) : "Ikke fastlagt"],
        [control.status === "active" ? "Næste planlagte kørsel" : "Næste kørsel ved aktivering",
          control.status === "active" ? control.next_scheduled_at ? timestamp(control.next_scheduled_at) : "Ingen planlagt kørsel"
            : control.activation_next_scheduled_at ? timestamp(control.activation_next_scheduled_at) : "Ingen planlagt kørsel"],
        ["Til · DEP", control.recipients.to.join("; ") || "Ingen aktiv DEP-modtager"],
        ["Ekstra CC", control.recipients.extra_cc.join("; ") || "Ingen"],
        ["Ekstra BCC · kun administrator", control.recipients.extra_bcc.join("; ") || "Ingen"],
      ]), node("p", validSchedule(control)
        ? "Mandag-torsdag kl. 14.30; fredag kl. 14.31 · Europe/Copenhagen."
        : "Planlægning er blokeret. De planlagte klokkeslæt kan ikke bekræftes.", "muted"),
      node("p", "Kontrollen omfatter kun DEP's egne sager. Historiske timer før startdatoen kontrolleres ikke automatisk. Historik kræver et manuelt preview.", "muted"));
      if (control.status === "active" && control.effective_active === false) {
        content.append(node("p", "Status er Aktiv, men den automatiske drift er stoppet af konfiguration eller sikkerhedsflag. Du kan stadig sætte Godkendelseskontrol på pause.", "coverage-warning"));
      }
      if (control.configuration_blockers.length) {
        const blockers = node("ul");
        for (const blocker of control.configuration_blockers) blockers.append(node("li", blocker));
        content.append(node("p", "Aktivering er blokeret af konfigurationen. Kontrollér driftsopsætningen, og hent status igen.", "coverage-warning"), blockers);
      }
      return content;
    }

    function renderControl(control) {
      current = control;
      summary.replaceChildren(controlSummary(control));
      action.textContent = control.status === "active" ? "Sæt på pause" : "Aktivér Godkendelseskontrol";
      retry.hidden = true;
      section.hidden = false;
      updateButtons();
    }

    function unavailable(text) {
      current = null;
      summary.replaceChildren();
      message(text, true);
      retry.hidden = false;
      section.hidden = false;
      updateButtons();
    }

    async function refresh() {
      const control = await request("GET");
      if (control && !revoked) renderControl(control);
      return control;
    }

    async function load() {
      if (loading || saving || revoked) return;
      loading = true;
      updateButtons();
      try {
        if (await refresh()) message("");
      } catch (_) {
        if (!revoked) unavailable("Administrationsstatus kunne ikke hentes. Prøv igen senere.");
      } finally { loading = false; updateButtons(); }
    }

    action.addEventListener("click", async () => {
      if (!current || loading || saving || revoked || action.disabled) return;
      const previousStatus = current.status;
      loading = true;
      updateButtons();
      message("Henter aktuelle oplysninger...");
      try {
        const control = await refresh();
        if (!control || revoked) return;
        if (control.status !== previousStatus) {
          message("Status er ændret. Kontrollér oplysningerne, og vælg handlingen igen.", true);
          return;
        }
        if (control.status !== "active" && (control.configuration_blockers.length || !control.recipients.to.length)) {
          message("Aktivering er blokeret af konfigurationen.", true);
          return;
        }
        const nextAction = control.status === "active" ? "pause" : "activate";
        title.textContent = nextAction === "pause" ? "Sæt Godkendelseskontrol på pause" : "Aktivér Godkendelseskontrol";
        details.replaceChildren(node("p", control.coverage_from
          ? `Startdato bevares: ${day(control.coverage_from)} · Europe/Copenhagen.`
          : `Startdato låses til ${day(control.today)} · Europe/Copenhagen.`),
        controlSummary(control), node("p", nextAction === "pause"
          ? "Kommende kontroller sættes på pause. En allerede påbegyndt mail kan ikke trækkes tilbage."
          : "Aktivering gælder kommende planlagte kontroller. Ingen øjeblikkelig mail eller afsendelse af gamle køposter."));
        confirmation = { action: nextAction, control };
        confirm.textContent = nextAction === "pause" ? "Bekræft pause" : "Bekræft aktivering";
        confirm.disabled = false;
        dialogStatus.textContent = "";
        message("");
        loading = false;
        updateButtons();
        action.focus();
        dialog.showModal();
      } catch (_) {
        closeDialog();
        if (!revoked) unavailable("Aktuelle oplysninger kunne ikke hentes. Hent status igen før bekræftelse.");
      } finally { loading = false; updateButtons(); }
    });

    get("approval-admin-confirm-form").addEventListener("submit", async event => {
      event.preventDefault();
      if (!confirmation || !dialog.open || saving || revoked) return;
      const snapshot = confirmation;
      saving = true;
      confirm.disabled = true;
      updateButtons();
      dialogStatus.textContent = "Gemmer...";
      try {
        const control = await request("POST", {
          action: snapshot.action,
          revision: snapshot.control.revision,
          expected_local_date: snapshot.control.today,
          mail_routing_revision: snapshot.control.mail_routing_revision,
          confirm: snapshot.action === "activate" ? "ACTIVATE:approval_control" : "PAUSE:approval_control",
        });
        if (!control || revoked) return;
        closeDialog();
        renderControl(control);
        message(snapshot.action === "pause" ? "Godkendelseskontrol er sat på pause." : "Godkendelseskontrol er aktiveret.");
        await latest();
      } catch (error) {
        closeDialog();
        if (revoked) return;
        if (error.status === 409) {
          try {
            if (await refresh()) message("Oplysningerne er ændret. Kontrollér den opdaterede status, og bekræft handlingen på ny.", true);
          } catch (_) {
            if (!revoked) unavailable("Oplysningerne er ændret. Hent status igen før en ny bekræftelse.");
          }
        } else {
          unavailable("Resultatet kunne ikke bekræftes. Hent status igen før en ny handling.");
        }
      } finally {
        saving = false;
        updateButtons();
        if (!revoked && !action.hidden && !dialog.open) action.focus();
      }
    });

    retry.addEventListener("click", load);
    cancel.addEventListener("click", () => { if (!saving) closeDialog(); });
    dialog.addEventListener("cancel", event => { event.preventDefault(); if (!saving) closeDialog(); });
    dialog.addEventListener("close", clearConfirmation);
    window.addEventListener("storage", event => {
      if (event.key === "fielddesk_access_token" || event.key === null) hideControl();
    });
    void load();
  }

  async function selectedRun() {
    if (!query.has("run_id")) return;
    get("selected-run").hidden = false;
    const content = get("selected-run-content");
    const status = get("selected-run-status");
    content.replaceChildren();
    status.className = "status";
    status.textContent = "Henter den valgte kørsel…";
    try {
      const id = query.get("run_id");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error("Den valgte kørsel har et ugyldigt job-ID.");
      const token = window.localStorage.getItem("fielddesk_access_token");
      if (!token) throw new Error("Log ind for at se den valgte kørsel.");
      const response = await fetch(`/api/approval-control/runs/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (response.status === 401) { window.localStorage.removeItem("fielddesk_access_token"); window.location.href = "/login"; return; }
      if (!response.ok || !data.success || !data.run || data.run.id?.toLowerCase() !== id.toLowerCase()) throw new Error("Den valgte kørsel kunne ikke hentes eller er ikke tilgængelig for dig.");
      renderJob(content, data.run, true);
      status.textContent = "Detaljer for den valgte kørsel.";
    } catch (error) {
      content.replaceChildren();
      status.className = "status error";
      status.textContent = error.message;
    }
  }
  latest();
  selectedRun();
  initAdminControl();
})();
