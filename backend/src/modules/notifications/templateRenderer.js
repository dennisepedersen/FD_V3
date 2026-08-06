"use strict";

const PLACEHOLDER_PATTERN = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;

function normalizeAllowedVariables(value) {
  if (!Array.isArray(value)) {
    throw new Error("email_template_allowed_variables_invalid");
  }
  return new Set(value.map((item) => String(item)));
}

function extractPlaceholders(templateText) {
  const placeholders = new Set();
  String(templateText || "").replace(PLACEHOLDER_PATTERN, (_match, name) => {
    placeholders.add(name);
    return "";
  });
  return placeholders;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderPart(templateText, variables, allowedVariables, { html = false } = {}) {
  const placeholders = extractPlaceholders(templateText);
  for (const placeholder of placeholders) {
    if (!allowedVariables.has(placeholder)) {
      throw new Error(`email_template_variable_not_allowed:${placeholder}`);
    }
    if (variables[placeholder] == null) {
      throw new Error(`email_template_variable_missing:${placeholder}`);
    }
  }

  return String(templateText || "").replace(PLACEHOLDER_PATTERN, (_match, name) => {
    const value = variables[name];
    return html ? escapeHtml(value) : String(value);
  });
}

function renderTemplate(template, variables) {
  if (!template) throw new Error("email_template_required");
  if (!variables || typeof variables !== "object" || Array.isArray(variables)) {
    throw new Error("email_template_variables_invalid");
  }
  const allowedVariables = normalizeAllowedVariables(template.allowed_variables_json || []);
  return {
    subject: renderPart(template.subject_template, variables, allowedVariables),
    html: renderPart(template.html_template, variables, allowedVariables, { html: true }),
    text: renderPart(template.text_template, variables, allowedVariables),
  };
}

function toDateString(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function formatDateDa(value) {
  const date = toDateString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return String(value || "");
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year}`;
}

function formatTime(value) {
  if (!value) return null;
  return String(value).slice(0, 5);
}

function formatAbsencePeriod(request) {
  const startDate = formatDateDa(request.start_date);
  const endDate = request.end_date ? formatDateDa(request.end_date) : null;
  if (request.duration_type === "time_range") {
    return `${startDate} kl. ${formatTime(request.start_time)}-${formatTime(request.end_time)}`;
  }
  if (request.duration_type === "partial_day") {
    const part = request.day_part === "afternoon" ? "eftermiddag" : "formiddag";
    return `${startDate}, ${part}`;
  }
  if (endDate && endDate !== startDate) {
    return `${startDate} - ${endDate}`;
  }
  return startDate;
}

module.exports = {
  _test: {
    escapeHtml,
    extractPlaceholders,
  },
  formatAbsencePeriod,
  formatDateDa,
  renderTemplate,
};
