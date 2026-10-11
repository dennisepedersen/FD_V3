"use strict";

const VALID_PAY_CODES_V1 = Object.freeze([
  "3300", "1220", "9010", "9012", "9022",
  "9000", "1195", "9315", "9200", "9300", "9320", "1199",
]);
const KNOWN_EXCLUDED_PAY_CODES_V1 = Object.freeze(["1244", "1246", "9070"]);

function normalizePayCode(value) {
  const normalized = value == null ? "" : String(value).trim();
  return normalized || null;
}

function normalizeNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function normalizePayCodeRules(rows) {
  const rules = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const code = normalizePayCode(row.pay_code || row.payCode);
    if (!code) continue;
    rules.set(code, Boolean(row.counts_as_valid_hours ?? row.countsAsValidHours));
  }
  if (rules.size === 0) {
    for (const code of VALID_PAY_CODES_V1) rules.set(code, true);
    for (const code of KNOWN_EXCLUDED_PAY_CODES_V1) rules.set(code, false);
  }
  return rules;
}

function summarizeHours(rows, payCodeRulesInput) {
  const rules = payCodeRulesInput instanceof Map
    ? payCodeRulesInput
    : normalizePayCodeRules(payCodeRulesInput);
  let validHours = 0;
  const counted = new Map();
  const excluded = new Map();
  const unclassifiedRows = [];
  let unclassifiedHours = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    const code = normalizePayCode(row.fitter_category_reference || row.pay_code || row.payCode);
    const rawHours = row.hours ?? row.quantity;
    const hours = rawHours == null || String(rawHours).trim() === "" ? NaN : Number(rawHours);
    const invalidHours = !Number.isFinite(hours) || hours < 0;
    if (invalidHours || !code || !rules.has(code)) {
      unclassifiedRows.push({
        source_key: row.source_key || null,
        fitter_category_id: row.fitter_category_id || null,
        pay_code: code,
        hours: invalidHours ? null : hours,
        reason: invalidHours ? "invalid_hours" : code ? "unknown_pay_code" : "missing_pay_code",
      });
      if (!invalidHours) unclassifiedHours += hours;
      continue;
    }
    if (hours === 0) continue;
    if (rules.get(code) === true) {
      validHours += hours;
      counted.set(code, normalizeNumber(counted.get(code)) + hours);
    } else {
      excluded.set(code, normalizeNumber(excluded.get(code)) + hours);
    }
  }

  return {
    validHours: roundHours(validHours),
    countedPayCodes: mapToPayCodeList(counted),
    excludedPayCodes: mapToPayCodeList(excluded),
    unclassifiedHours: roundHours(unclassifiedHours),
    unclassifiedRows,
  };
}

function evaluateHoursData({ summary, requiredHours, coverage }) {
  const reason = coverage?.status !== "complete"
    ? coverage?.reason || "period_coverage_not_verified"
    : summary.unclassifiedRows.length > 0 ? "hours_classification_incomplete" : null;
  if (reason) {
    return {
      requiredHours: roundHours(requiredHours),
      validHours: summary.validHours,
      missingHours: null,
      status: coverage?.status === "complete" ? "unclassified_hours" : "data_incomplete",
      coverageStatus: coverage?.status === "complete" ? "complete" : "incomplete",
      dataQualityReason: reason,
    };
  }
  return {
    ...evaluateMissingHours({ validHours: summary.validHours, requiredHours }),
    coverageStatus: "complete",
    dataQualityReason: null,
  };
}

function mapToPayCodeList(map) {
  return Array.from(map.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([payCode, hours]) => ({ pay_code: payCode, hours: roundHours(hours) }));
}

function roundHours(value) {
  return Math.round(normalizeNumber(value) * 100) / 100;
}

function evaluateMissingHours({ validHours, requiredHours }) {
  const valid = roundHours(validHours);
  const required = roundHours(requiredHours);
  const missing = roundHours(Math.max(0, required - valid));
  return {
    requiredHours: required,
    validHours: valid,
    missingHours: missing,
    status: missing > 0 ? "missing_hours" : "ok",
  };
}

function firstName(fullName) {
  const normalized = fullName == null ? "" : String(fullName).trim();
  return normalized.split(/\s+/)[0] || null;
}

function formatHoursDa(value) {
  return roundHours(value).toLocaleString("da-DK", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });
}

function buildEmployeeMailVariables({ employeeName, dateLabel, requiredHours, validHours, missingHours }) {
  const first = firstName(employeeName);
  if (!first) {
    throw new Error("time_control_employee_first_name_required");
  }
  const valid = roundHours(validHours);
  const subject = valid <= 0
    ? `Manglende timeregistrering for ${dateLabel}`
    : `Manglende timer for ${dateLabel}`;
  const intro = valid <= 0
    ? `Fielddesk kan endnu ikke se en timeregistrering for ${dateLabel}.`
    : `Fielddesk kan aktuelt se ${formatHoursDa(valid)} gyldige timer for ${dateLabel}.`;
  return {
    subject,
    first_name: first,
    intro,
    required_hours: formatHoursDa(requiredHours),
    valid_hours: formatHoursDa(validHours),
    missing_hours: formatHoursDa(missingHours),
    missing_phrase: valid <= 0 ? "dem" : "de manglende timer",
  };
}

function buildManagerSummaryLines(results, { includeInternalRef = true } = {}) {
  return (Array.isArray(results) ? results : [])
    .filter((row) => (!row.status || row.status === "missing_hours") && (!row.coverage_status || row.coverage_status === "complete"))
    .filter((row) => Number(row.missing_hours ?? row.missingHours ?? 0) > 0)
    .map((row) => {
      const name = row.employee_name || row.employeeName;
      const internalRef = row.internal_ref || row.internalRef;
      const displayName = includeInternalRef && internalRef ? `${name} (${internalRef})` : name;
      return `${displayName}: krav ${formatHoursDa(row.required_hours ?? row.requiredHours)} t., registreret ${formatHoursDa(row.valid_hours ?? row.validHours)} t., mangler ${formatHoursDa(row.missing_hours ?? row.missingHours)} t.`;
    })
    .join("\n");
}

module.exports = {
  KNOWN_EXCLUDED_PAY_CODES_V1,
  VALID_PAY_CODES_V1,
  buildEmployeeMailVariables,
  buildManagerSummaryLines,
  evaluateMissingHours,
  evaluateHoursData,
  firstName,
  formatHoursDa,
  normalizePayCodeRules,
  roundHours,
  summarizeHours,
};
