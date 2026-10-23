"use strict";

const { htmlEscape: escape, renderFielddeskEmailFrame } = require("../../services/fielddeskEmailFrame");
const { coverageStatement } = require("./approvalControl.mailPolicy");
const { validDay } = require("./approvalControl.logic");
const number = n => new Intl.NumberFormat("da-DK", { maximumFractionDigits: 2 }).format(n);
const day = value => value.split("-").reverse().join(".");

function grouped(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.fitter_id, row.date]);
    const group = groups.get(key) || { fitter_id: row.fitter_id, name: row.fitter_name || `EK fitter ${row.fitter_id}`, date: row.date, hours: 0, ids: [] };
    group.hours += row.hours;
    group.ids.push(row.id);
    groups.set(key, group);
  }
  return [...groups.values()].map(g => ({ ...g, hours: Math.round(g.hours * 100) / 100 }));
}

function build({ context, result, runId, rootDomain, sender, replyTo }) {
  if (!validDay(result.fromDate) || result.activation_id == null || result.fromDate > result.toDate) throw new Error("approval_control_mail_period_invalid");
  if (!/^[a-z0-9.-]+$/.test(rootDomain) || context.tenantSlug !== "hoyrup-clemmensen") throw new Error("approval_control_mail_origin_invalid");
  const origin = `https://${context.tenantSlug}.${rootDomain}`;
  const link = `${origin}/tenant/approval-control.html?run_id=${encodeURIComponent(runId)}`;
  const subject = `Godkendelseskontrol: ${result.counts.open_rows} registreringer afventer på dine sager`;
  const totals = `${result.counts.open_rows} åbne registreringer · ${number(result.counts.hours)} timer · ${result.counts.projects} ${result.counts.projects === 1 ? "sag" : "sager"} · Ældste arbejdsdato ${day(result.counts.oldest_date)}`;
  const coverage = `Kontrolperiode: ${day(result.fromDate)} til ${day(result.toDate)}. Registreringer før aktiveringsdatoen er ikke omfattet.`;
  const statement = coverageStatement(result.fromDate);
  const text = ["Følgende registreringer afventer godkendelse på dine sager:", "", totals, coverage];
  let content = `<h1 style="font-size:20px;line-height:1.3;overflow-wrap:anywhere;">Godkendelseskontrol</h1><p>${escape(totals)}</p><p>${escape(coverage)}</p>`;
  for (const group of result.groups) {
    const title = `${group.reference} · ${group.name}`;
    text.push("", title, "Medarbejder | Dato | Timer | Antal registreringer");
    content += `<h2 style="font-size:16px;margin-top:24px;">${escape(title)}</h2><table width="100%" cellpadding="3" style="border-collapse:collapse;table-layout:fixed;overflow-wrap:anywhere;word-wrap:break-word;font-size:12px;"><thead style="font-size:11px;"><tr><th width="24%" align="left">Med&shy;arbejder</th><th width="28%" align="left">Dato</th><th width="16%" align="right">Timer</th><th width="32%" align="right">Antal<br>regi&shy;streringer</th></tr></thead><tbody>`;
    for (const row of grouped(group.rows)) {
      text.push(`${row.name} | ${day(row.date)} | ${number(row.hours)} | ${row.ids.length}`);
      content += `<tr><td>${escape(row.name)}</td><td style="font-size:11px;white-space:nowrap;">${escape(day(row.date))}</td><td align="right">${escape(number(row.hours))}</td><td align="right">${row.ids.length}</td></tr>`;
    }
    content += "</tbody></table>";
  }
  text.push("", "Timerne er registreringernes timemængde, ikke en deduplikering af arbejdstid.", "", `Se registreringerne i Fielddesk (login kræves): ${link}`, "", statement);
  content += `<p>Timerne er registreringernes timemængde, ikke en deduplikering af arbejdstid.</p><p><a href="${escape(link)}">Se registreringerne i Fielddesk</a> (login kræves)</p><p style="font-size:12px;color:#4b5f53;">${escape(statement)}</p>`;
  return { tenantId: context.tenantId, template: "approval_control", to: result.to, cc: [], from: sender, replyTo,
    subject, text: text.join("\n"), html: renderFielddeskEmailFrame({ logoUrl: origin + "/tenant/assets/FD_logo.png", contentHtml: content }) };
}

module.exports = { build, grouped };
