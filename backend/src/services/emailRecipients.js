"use strict";

function normalizeEmail(value) {
  const normalized = value == null ? "" : String(value).trim().toLowerCase();
  return normalized || null;
}

function emailFailureFor(value) {
  const email = normalizeEmail(value);
  if (!email) {
    return {
      email: null,
      errorCode: "recipient_email_missing",
      errorMessage: "Recipient email is missing or inactive.",
    };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return {
      email,
      errorCode: "recipient_email_invalid",
      errorMessage: "Recipient email is invalid.",
    };
  }
  return { email, errorCode: null, errorMessage: null };
}

function emailListFailureFor(value) {
  if (value == null) return { emails: [], errorCode: null, errorMessage: null };
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : null;
  if (!values) {
    return { emails: [], errorCode: "recipient_email_invalid", errorMessage: "Recipient emails must be a string or array." };
  }
  const emails = [];
  for (const item of values) {
    const state = emailFailureFor(item);
    if (state.errorCode) return { emails, errorCode: state.errorCode, errorMessage: state.errorMessage };
    if (!emails.includes(state.email)) emails.push(state.email);
  }
  return { emails, errorCode: null, errorMessage: null };
}

module.exports = { normalizeEmail, emailFailureFor, emailListFailureFor };
