"use strict";

const { createHash } = require("node:crypto");
const { emailFailureFor, emailListFailureFor } = require("../../services/emailRecipients");

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

function personName(person) {
  return String(person?.name || "").trim();
}

function deliveryTestKey({ tenantId, batchId, message }) {
  const signature = createHash("sha256").update(JSON.stringify({
    to: message.to,
    cc: message.cc,
    toName: message.toName || null,
    ccNames: message.ccNames || [],
    from: message.from,
    subject: message.subject,
    text: message.text,
  })).digest("hex").slice(0, 12);
  return `time_control_poc_mail:v1:${tenantId}:${batchId}:${message.stage}:${signature}`;
}

function buildPlan({ tenantId, batchId, from, settings, employee, dep, controlEmployees = [] }) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const copies = emailListFailureFor(settings?.employee_cc_emails);
  const recipient = emailFailureFor(employee?.email);
  const depRecipient = emailFailureFor(dep?.email || copies.emails[0]);
  const employeeName = personName(employee);
  const depName = personName(dep);
  const controlNames = controlEmployees.map(personName).filter(Boolean).sort((a, b) => a.localeCompare(b, "da"));
  if (!uuid.test(tenantId || "") || !uuid.test(batchId || "") ||
      settings?.mode !== "dry_run" || copies.errorCode || copies.emails.length !== 1 ||
      copies.emails[0] !== "dep@hoyrup-clemmensen.dk" || depRecipient.errorCode ||
      depRecipient.email !== copies.emails[0] || !depName || recipient.errorCode ||
      recipient.email !== "mhj@hoyrup-clemmensen.dk" || String(employee?.fitterId) !== "15" ||
      !employeeName || !controlNames.length || typeof from !== "string" || !from.trim()) {
    const error = new Error("time_control_poc_plan_invalid");
    error.statusCode = 409;
    throw error;
  }
  const messages = [
    {
      stage: "dep_delivery",
      disposition: "requires_send_approval",
      to: depRecipient.email,
      toName: depName,
      cc: [],
      ccNames: [],
      subject: `[POC-TEST - ingen handling] Fielddesk Timekontrol: mailtest til ${depName}`,
      text: `Hej ${firstName(depName)}

Dette er en afgrænset mailtest af Fielddesk Timekontrol. Det er ikke en rigtig timekontrol eller en påmindelse om manglende timer.

Ingen EK-timer er ændret. Testen aktiverer ikke driftsugen, live-mode eller scheduler.

Bekræft venligst modtagelsen i din indbakke, før vi går videre til testen med ${employeeName}.

Venlig hilsen
Fielddesk Timekontrol`,
    },
    {
      stage: "mhj_delivery",
      disposition: "requires_dep_receipt_and_send_approval",
      to: recipient.email,
      toName: employeeName,
      cc: [depRecipient.email],
      ccNames: [depName],
      subject: `[POC-TEST - ingen handling] Fielddesk Timekontrol: mailtest til ${employeeName}`,
      text: `Hej ${firstName(employeeName)}

Dette er en aftalt testmail fra Fielddesk Timekontrol med ${depName} i kopi.

Mailen er kun en test af afsendelse og modtagelse. Den er ikke en rigtig timekontrol eller en påmindelse om manglende timer, og den kræver ingen handling fra dig.

Du skal ikke ændre din timeregistrering på grund af denne mail. Ingen EK-timer er ændret, og testen aktiverer ikke live-mode eller scheduler.

Venlig hilsen
Fielddesk Timekontrol`,
    },
    {
      stage: "manager_preview",
      disposition: "preview_only",
      to: depRecipient.email,
      toName: depName,
      cc: [],
      ccNames: [],
      subject: "[POC-TEST - kun preview] Fielddesk Timekontrol: lederoversigt",
      text: `Hej ${firstName(depName)}

Dette er kun et preview af lederoversigten for den historiske POC-uge 5.-9. oktober 2026, ikke en driftskontrol.

Seneste verificerede historiske runtime-test: ${controlNames.join(", ")} havde hver 37 medregnede timer og status OK. Ingen ugepåmindelser. Tillægstimer på 9043/9076 var ekskluderet.

Medregnede timer er ikke det samme som ledergodkendte timer i EK. Fredagens driftsopgørelse er foreløbig.

Den fravalgte ekstra ledermodtager er ikke modtager eller CC i denne POC-test.

Venlig hilsen
Fielddesk Timekontrol`,
    },
  ].map(message => {
    const withFrom = { ...message, from };
    return {
      ...withFrom,
      testKey: ["dep_delivery", "mhj_delivery"].includes(message.stage)
        ? deliveryTestKey({ tenantId, batchId, message: withFrom })
        : `time_control_poc_mail:v1:${tenantId}:${batchId}:${message.stage}`,
    };
  });
  const managers = emailListFailureFor(settings.friday_manager_emails);
  return {
    batch_id: batchId,
    mode: "preview_only",
    send_enabled: false,
    messages,
    manager_routing_saved: !managers.errorCode && managers.emails.length === 1 && managers.emails[0] === depRecipient.email,
    delivery_caveat: `Provideraccept er ikke bekræftet modtagelse. ${depName} og ${employeeName} skal bekræfte deres indbakker.`,
    dispatch_blocker: `Testmails skal klargøres og låses før særskilt afsendelsesgodkendelse. Kun en eksplicit operatørkommando kan afsende én test; ingen automatiske retries. ${employeeName}-testen kræver bekræftet modtagelse hos ${depName}. Lederoversigten er kun preview.`,
  };
}

module.exports = { buildPlan };
