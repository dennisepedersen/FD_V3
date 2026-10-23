"use strict";

(function () {
  const root = document.querySelector("[data-operational-mail-routing]");
  if (!root) return;

  const pageTypes = {
    "time-control": ["time_control_missing_hours", "time_control_friday_status"],
    "approval-control": ["approval_control_summary"],
  };
  const titles = new Map([
    ["time_control_missing_hours", "Timekontrol: manglende timer"],
    ["time_control_friday_status", "Timekontrol: ugens lederoversigt"],
    ["approval_control_summary", "Godkendelseskontrol: oversigt"],
  ]);
  const errors = new Map([
    ["operational_mail_recipients_invalid", "En eller flere mailadresser er ugyldige."],
    ["operational_mail_recipients_required", "Angiv mindst \u00e9n mailadresse for hver tilvalgt kanal."],
    ["operational_mail_recipients_duplicate", "En mailadresse er angivet flere gange. Fjern dubletterne."],
    ["operational_mail_routing_conflict", "Indstillingerne er \u00e6ndret. Genindl\u00e6s siden, f\u00f8r du gemmer igen."],
    ["operational_mail_routing_input_invalid", "Indstillingerne er ugyldige. Kontroll\u00e9r felterne og pr\u00f8v igen."],
  ]);
  const types = Object.hasOwn(pageTypes, root.dataset.operationalMailRouting)
    ? pageTypes[root.dataset.operationalMailRouting] : [];
  const endpoint = "/api/tenant/admin/operational-mail-routing";
  let accessRevoked = false;
  root.hidden = true;
  root.replaceChildren();
  if (!types.length) return;

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function hideSettings() {
    accessRevoked = true;
    root.hidden = true;
    root.replaceChildren();
  }

  function token() {
    try {
      return window.localStorage.getItem("fielddesk_access_token");
    } catch (_) {
      return null;
    }
  }

  async function request(path, method, body) {
    const accessToken = token();
    if (accessRevoked || !accessToken) {
      hideSettings();
      return null;
    }
    const options = {
      method,
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      redirect: "error",
    };
    if (body !== undefined) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    const response = await fetch(path, options);
    if (response.status === 401 || response.status === 403 || token() !== accessToken) {
      hideSettings();
      return null;
    }
    const data = await response.json().catch(() => null);
    if (accessRevoked || token() !== accessToken) {
      hideSettings();
      return null;
    }
    if (!response.ok || data?.success !== true) {
      const codes = [data?.error?.code, data?.error?.message, data?.error, data?.code, data?.message];
      const code = response.status === 409 ? "operational_mail_routing_conflict"
        : codes.find(value => errors.has(value));
      throw Object.assign(new Error("Operational mail routing request failed"), { code });
    }
    return data;
  }

  function validSetting(setting, mailType) {
    return setting?.mail_type === mailType
      && Number.isSafeInteger(setting.revision) && setting.revision >= 0
      && ["cc", "bcc"].every(channel => typeof setting[`extra_${channel}_enabled`] === "boolean"
        && Array.isArray(setting[`extra_${channel}_emails`])
        && setting[`extra_${channel}_emails`].every(email => typeof email === "string"));
  }

  function channelFields(mailType, channel) {
    const container = node("div", null, "operational-mail-routing__channel");
    const toggleLabel = node("label", null, "operational-mail-routing__toggle");
    const toggle = node("input");
    toggle.type = "checkbox";
    toggleLabel.append(toggle, node("span", `Ekstra ${channel.toUpperCase()}`));
    const input = node("input");
    input.id = `operational-mail-routing-${mailType}-${channel}`;
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.disabled = true;
    const label = node("label", `Mailadresser til ekstra ${channel.toUpperCase()} (adskilt med semikolon)`);
    label.htmlFor = input.id;
    container.append(toggleLabel, label, input);
    toggle.addEventListener("change", () => { input.disabled = !toggle.checked; });
    return { container, toggle, input };
  }

  function settingForm(initial) {
    const mailType = initial.mail_type;
    let current = initial;
    let saving = false;
    let conflict = false;
    const form = node("form", null, "operational-mail-routing__form");
    const fieldset = node("fieldset");
    const legend = node("legend", typeof initial.title === "string" && initial.title.trim()
      ? initial.title : titles.get(mailType));
    const channels = node("div", null, "operational-mail-routing__channels");
    const cc = channelFields(mailType, "cc");
    const bcc = channelFields(mailType, "bcc");
    channels.append(cc.container, bcc.container);
    const save = node("button", "Gem ekstra modtagere");
    save.type = "submit";
    const actions = node("div", null, "operational-mail-routing__actions");
    actions.append(save);
    fieldset.append(legend, channels, actions);
    const status = node("p", "", "operational-mail-routing__status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const effective = node("div", null, "operational-mail-routing__effective");
    form.append(fieldset, status, effective);

    function renderSaved(setting) {
      current = setting;
      effective.replaceChildren(node("p", "G\u00e6ldende ekstra modtagere"));
      for (const [channel, fields] of [["cc", cc], ["bcc", bcc]]) {
        const enabled = setting[`extra_${channel}_enabled`];
        const emails = setting[`extra_${channel}_emails`];
        fields.toggle.checked = enabled;
        fields.input.value = emails.join("; ");
        fields.input.disabled = !enabled;
        const recipients = enabled ? emails.join("; ") || "Ingen" : "Ingen (deaktiveret)";
        effective.append(node("p", `Ekstra ${channel.toUpperCase()}: ${recipients}`));
      }
    }

    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (saving || conflict || accessRevoked) return;
      saving = true;
      fieldset.disabled = true;
      status.dataset.state = "saving";
      status.textContent = "Gemmer...";
      try {
        const data = await request(`${endpoint}/${mailType}`, "PUT", {
          revision: current.revision,
          extra_cc_enabled: cc.toggle.checked,
          extra_cc_emails: cc.input.value,
          extra_bcc_enabled: bcc.toggle.checked,
          extra_bcc_emails: bcc.input.value,
        });
        if (!data || accessRevoked) return;
        if (!validSetting(data.setting, mailType)) throw new Error("Invalid setting response");
        renderSaved(data.setting);
        status.dataset.state = "saved";
        status.textContent = "Ekstra modtagere er gemt.";
      } catch (error) {
        if (accessRevoked) return;
        conflict = error.code === "operational_mail_routing_conflict";
        status.dataset.state = "error";
        status.textContent = errors.get(error.code) || "Indstillingerne kunne ikke gemmes. Pr\u00f8v igen senere.";
      } finally {
        saving = false;
        fieldset.disabled = conflict || accessRevoked;
      }
    });
    renderSaved(initial);
    return form;
  }

  async function load() {
    try {
      const data = await request(endpoint, "GET");
      if (!data || accessRevoked) return;
      if (!Array.isArray(data.mail_types)) throw new Error("Invalid settings response");
      const settings = new Map();
      for (const setting of data.mail_types) {
        if (!types.includes(setting?.mail_type)) continue;
        if (!validSetting(setting, setting.mail_type) || settings.has(setting.mail_type)) {
          throw new Error("Invalid setting response");
        }
        settings.set(setting.mail_type, setting);
      }
      if (!settings.size) return;
      const heading = node("h2", "Ekstra modtagere til driftsmails");
      heading.id = "operational-mail-routing-heading";
      root.setAttribute("aria-labelledby", heading.id);
      root.append(heading);
      for (const mailType of types) {
        if (settings.has(mailType)) root.append(settingForm(settings.get(mailType)));
      }
      root.hidden = false;
    } catch (_) {
      if (accessRevoked) return;
      root.replaceChildren(node("p", "Ekstra mailmodtagere kunne ikke hentes. Genindl\u00e6s siden for at pr\u00f8ve igen."));
      root.hidden = false;
    }
  }

  window.addEventListener("storage", event => {
    if (event.key === "fielddesk_access_token" || event.key === null) hideSettings();
  });
  void load();
})();
