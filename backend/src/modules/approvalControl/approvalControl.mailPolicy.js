"use strict";

const { validDay } = require("./approvalControl.logic");
const TIME_ZONE = "Europe/Copenhagen";
const FRIDAY_TIME = "14:31";
const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short", hourCycle: "h23" });

function local(now) {
  const p = Object.fromEntries(formatter.formatToParts(now).filter(p => p.type !== "literal").map(p => [p.type, p.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday: p.weekday };
}

function instant(date, time) {
  const [year, month, day] = date.split("-").map(Number), [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let result = target;
  for (let i = 0; i < 2; i++) {
    const p = local(new Date(result)), [y, m, d] = p.date.split("-").map(Number), [h, n] = p.time.split(":").map(Number);
    result += target - Date.UTC(y, m - 1, d, h, n);
  }
  return new Date(result).toISOString();
}

function coverageStatement(fromDate) {
  if (!validDay(fromDate)) return "Ingen aktiv kontrolperiode. Godkendelseskontrol er ikke produktionsaktiveret.";
  const date = new Intl.DateTimeFormat("da-DK", { timeZone: TIME_ZONE, day: "numeric", month: "long", year: "numeric" }).format(new Date(fromDate + "T12:00:00Z"));
  return `Kontrollen omfatter registreringer fra og med ${date}.`;
}

function read(env = process.env, now = new Date(), activation = null) {
  const today = local(now).date;
  const stamp = typeof activation?.activated_at === "string" ? Date.parse(activation.activated_at) : NaN;
  const activated = typeof activation?.id === "string" && /^[0-9a-f-]{36}$/i.test(activation.id) &&
    typeof activation?.activated_at === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(activation.activated_at) && Number.isFinite(stamp) && stamp <= now.getTime() &&
    activation.environment === "production" && activation.time_zone === TIME_ZONE &&
    validDay(activation.coverage_from) && local(new Date(stamp)).date === activation.coverage_from;
  const coverage = activated ? activation.coverage_from : null;
  const friday = env.APPROVAL_CONTROL_FRIDAY_TIME ?? FRIDAY_TIME;
  const blockers = [];
  if (activation && !activated) blockers.push("Den gemte produktionsaktivering kunne ikke valideres. Ingen kontrolperiode er frigivet.");
  if (env.APPROVAL_CONTROL_COVERAGE_FROM != null) blockers.push("Startdato må ikke angives via miljøet. Den fastlåses ved tenantens første produktionsaktivering.");
  if (friday !== FRIDAY_TIME) blockers.push("HC V1 er godkendt til fredag kl. 14.31. Et andet fredagstidspunkt blokerer jobbet.");
  for (const flag of ["APPROVAL_CONTROL_SCHEDULER_ENABLED", "APPROVAL_CONTROL_MAIL_ENABLED"]) {
    if (env[flag] != null && !["true", "false"].includes(env[flag])) blockers.push(`${flag} skal være true eller false.`);
  }
  return { time_zone: TIME_ZONE, scheduled_local_time: "14:30", friday_local_time: friday,
    scheduler_enabled: env.APPROVAL_CONTROL_SCHEDULER_ENABLED === "true",
    mail_enabled: env.APPROVAL_CONTROL_MAIL_ENABLED === "true", coverage_from: coverage, coverage_to: activated ? today : null,
    activated_at: activated ? activation.activated_at : null, activation_id: activated ? activation.id : null,
    activation_valid: activated, coverage_valid: activated, configuration_valid: blockers.length === 0,
    schedule_valid: friday === FRIDAY_TIME,
    coverage_statement: coverageStatement(coverage),
    coverage_warning: activated ? `Åbne timer i kontrolperioden ${coverage} til ${today}. Arbejdsdatoer før aktiveringsdatoen indgår ikke i drift eller mail.`
      : "Før produktionsaktivering findes ingen aktiv kontrolperiode og ingen automatisk mail. Historik kræver et særskilt manuelt preview.",
    configuration_blockers: blockers };
}

function slot(now, policy) {
  const p = local(now);
  const time = p.weekday === "Fri" ? policy.friday_local_time : policy.scheduled_local_time;
  if (!["Mon", "Tue", "Wed", "Thu", "Fri"].includes(p.weekday) || p.time !== time || !["14:30", "14:31"].includes(time)) return null;
  return { local_date: p.date, scheduled_at: instant(p.date, time), time_zone: TIME_ZONE };
}

function next(now, policy) {
  if (!policy.activation_valid) return null;
  const day = new Date(local(now).date + "T12:00:00Z");
  for (let i = 0; i < 8; i++, day.setUTCDate(day.getUTCDate() + 1)) {
    if ([0, 6].includes(day.getUTCDay())) continue;
    const time = day.getUTCDay() === 5 ? policy.friday_local_time : policy.scheduled_local_time;
    if (!["14:30", "14:31"].includes(time)) continue;
    const at = instant(day.toISOString().slice(0, 10), time);
    if (Date.parse(at) > now.getTime()) return at;
  }
  return null;
}

module.exports = { read, local, instant, slot, next, TIME_ZONE, FRIDAY_TIME, coverageStatement };
