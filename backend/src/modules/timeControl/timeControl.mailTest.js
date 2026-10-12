"use strict";

const { emailFailureFor, emailListFailureFor } = require("../../services/emailRecipients");

function buildPlan({ tenantId, batchId, from, settings, employee }) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const copies = emailListFailureFor(settings?.employee_cc_emails);
  const recipient = emailFailureFor(employee?.email);
  if (!uuid.test(tenantId || "") || !uuid.test(batchId || "") ||
      settings?.mode !== "dry_run" || copies.errorCode || copies.emails.length !== 1 ||
      copies.emails[0] !== "dep@hoyrup-clemmensen.dk" || recipient.errorCode ||
      recipient.email !== "mhj@hoyrup-clemmensen.dk" || String(employee?.fitterId) !== "15" ||
      typeof from !== "string" || !from.trim()) {
    const error = new Error("time_control_poc_plan_invalid");
    error.statusCode = 409;
    throw error;
  }
  const dep = copies.emails[0];
  const messages = [
    {
      stage: "dep_delivery", disposition: "requires_send_approval", to: dep, cc: [],
      subject: "[POC-TEST – ingen handling] Fielddesk Timekontrol: mailtest til DEP",
      text: "Hej DEP\n\nDette er en afgrænset mailtest af Fielddesk Timekontrol. Det er ikke en rigtig timekontrol eller en påmindelse om manglende timer.\n\nIngen EK-timer er ændret. Testen aktiverer ikke driftsugen, live-mode eller scheduler.\n\nBekræft venligst modtagelsen i din indbakke, før vi går videre til testen med MHJ.\n\nVenlig hilsen\nFielddesk Timekontrol",
    },
    {
      stage: "mhj_delivery", disposition: "requires_dep_receipt_and_send_approval", to: recipient.email, cc: [dep],
      subject: "[POC-TEST – ingen handling] Fielddesk Timekontrol: mailtest til MHJ",
      text: "Hej MHJ\n\nDette er en aftalt mailtest af Fielddesk Timekontrol med DEP i kopi. Det er ikke en rigtig timekontrol eller en påmindelse om manglende timer. Du skal ikke ændre din timeregistrering på grund af denne mail.\n\nBekræft venligst modtagelsen i din indbakke. DEP modtager en kopi; LKE modtager ikke denne test.\n\nVenlig hilsen\nFielddesk Timekontrol",
    },
    {
      stage: "manager_preview", disposition: "preview_only", to: dep, cc: [],
      subject: "[POC-TEST – kun preview] Fielddesk Timekontrol: lederoversigt",
      text: "Hej DEP\n\nDette er kun et preview af lederoversigten for den historiske POC-uge 5.–9. oktober 2026, ikke en driftskontrol.\n\nSeneste verificerede historiske runtime-test: JSK, MBO, MHJ, MPJ, MUM og PEP havde hver 37 medregnede timer og status OK. Ingen ugepåmindelser. MUMs 30 tillægstimer på 9043/9076 var ekskluderet.\n\nMedregnede timer er ikke det samme som ledergodkendte timer i EK. Fredagens driftsopgørelse er foreløbig.\n\nLKE er ikke modtager eller CC i denne POC-test.\n\nVenlig hilsen\nFielddesk Timekontrol",
    },
  ].map(message => ({
    ...message, from, testKey: `time_control_poc_mail:v1:${tenantId}:${batchId}:${message.stage}`,
  }));
  const managers = emailListFailureFor(settings.friday_manager_emails);
  return {
    batch_id: batchId, mode: "preview_only", send_enabled: false, messages,
    manager_routing_saved: !managers.errorCode && managers.emails.length === 1 && managers.emails[0] === dep,
    delivery_caveat: "Provideraccept er ikke bekræftet modtagelse. DEP og MHJ skal bekræfte deres indbakker.",
    dispatch_blocker: "DEP-testen skal klargøres og låses før særskilt afsendelsesgodkendelse. Kun en eksplicit operatørkommando kan afsende den ene test; ingen automatiske retries. MHJ og lederoversigten er kun previews.",
  };
}

module.exports = { buildPlan };
