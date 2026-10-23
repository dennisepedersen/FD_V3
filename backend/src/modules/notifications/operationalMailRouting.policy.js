"use strict";

const { createHttpError } = require("../../middleware/errorHandler");
const TITLES = Object.freeze({
  time_control_missing_hours: "Individuel Timekontrol",
  time_control_friday_status: "Timekontrol - ugens lederoversigt",
  approval_control_summary: "Godkendelseskontrol",
});
const TEMPLATES = Object.freeze({
  "time_control.missing_hours.employee": "time_control_missing_hours",
  "time_control.employee_weekly_reminder_v1": "time_control_missing_hours",
  "time_control.friday_weekly_summary_v1": "time_control_friday_status",
});
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const fail = name => createHttpError(400, "operational_mail_" + name);
function type(value) {
  if (!Object.hasOwn(TITLES, value)) throw fail("routing_type_invalid");
  return value;
}
function addresses(value, maximum = 20) {
  if (!Array.isArray(value) || value.length > maximum) throw fail("recipients_invalid");
  const normalized = value.map(item => {
    if (typeof item !== "string") throw fail("recipients_invalid");
    const email = item.trim().toLowerCase(), local = email.split("@")[0];
    if (email.length > 254 || local.length > 64 || !EMAIL.test(email) || /^\.|\.\.|\.$/.test(local)) throw fail("recipients_invalid");
    return email;
  });
  if (new Set(normalized).size !== normalized.length) throw fail("recipients_duplicate");
  return normalized;
}
function parse(value, enabled) {
  if (typeof value !== "string" || value.length > 6000) throw fail("recipients_invalid");
  const list = value.trim() ? addresses(value.split(";")) : [];
  if (enabled && !list.length) throw fail("recipients_required");
  return list;
}
function distinct(...lists) {
  const values = lists.flat();
  if (new Set(values).size !== values.length) throw fail("recipients_duplicate");
}
function input(value) {
  const keys = ["revision", "extra_cc_enabled", "extra_cc_emails", "extra_bcc_enabled", "extra_bcc_emails"];
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      Object.keys(value).some(key => !keys.includes(key)) || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      typeof value.extra_cc_enabled !== "boolean" || typeof value.extra_bcc_enabled !== "boolean") throw fail("routing_input_invalid");
  const result = { ...value, extra_cc_emails: parse(value.extra_cc_emails, value.extra_cc_enabled), extra_bcc_emails: parse(value.extra_bcc_emails, value.extra_bcc_enabled) };
  distinct(result.extra_cc_enabled ? result.extra_cc_emails : [], result.extra_bcc_enabled ? result.extra_bcc_emails : []);
  return result;
}
function defaults(mailType) {
  return { mail_type: type(mailType), title: TITLES[mailType], revision: 0,
    extra_cc_enabled: false, extra_cc_emails: [], extra_bcc_enabled: false, extra_bcc_emails: [], updated_at: null };
}
function recipients(setting, { to, cc = [] }) {
  const target = addresses([to])[0], baseCc = addresses(cc, Infinity);
  const extraCc = setting.extra_cc_enabled ? addresses(setting.extra_cc_emails) : [];
  const bcc = setting.extra_bcc_enabled ? addresses(setting.extra_bcc_emails) : [];
  if (setting.extra_cc_enabled && !extraCc.length || setting.extra_bcc_enabled && !bcc.length) throw fail("recipients_required");
  distinct([target], baseCc, extraCc, bcc);
  return { to: target, cc: [...baseCc, ...extraCc], bcc,
    snapshot: { mail_type: setting.mail_type, revision: setting.revision } };
}
module.exports = { TITLES, TEMPLATES, type, addresses, parse, distinct, input, defaults, recipients };
