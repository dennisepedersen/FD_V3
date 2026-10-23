"use strict";

const ENV = require("../config/env");
const { emailFailureFor, emailListFailureFor } = require("./emailRecipients");

function normalizeProvider(value) {
  return String(value || "disabled").trim().toLowerCase();
}

function makeMailError(message, code, statusCode = 503) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function requireText(value, code) {
  const normalized = value == null ? "" : String(value).trim();
  if (!normalized) throw makeMailError(code, code, 500);
  return normalized;
}

function buildMessage({ to, cc, bcc, from, replyTo, subject, html, text, tenantId, template }) {
  const recipient = emailFailureFor(to);
  if (recipient.errorCode) {
    const code = recipient.errorCode === "recipient_email_missing" ? "mail_to_required" : "mail_to_invalid";
    throw makeMailError(code, code, 400);
  }

  const copies = emailListFailureFor(cc);
  if (copies.errorCode) throw makeMailError("mail_cc_invalid", "mail_cc_invalid", 400);

  let blindCopies;
  if (bcc !== undefined) {
    const values = bcc == null ? [] : Array.isArray(bcc) ? bcc : typeof bcc === "string" ? [bcc] : null;
    if (!values) throw makeMailError("mail_bcc_invalid", "mail_bcc_invalid", 400);
    blindCopies = [];
    for (const value of values) {
      const state = typeof value === "string" ? emailFailureFor(value) : null;
      if (!state || state.errorCode) throw makeMailError("mail_bcc_invalid", "mail_bcc_invalid", 400);
      if (blindCopies.includes(state.email)) throw makeMailError("mail_bcc_duplicate", "mail_bcc_duplicate", 400);
      blindCopies.push(state.email);
    }
    const visibleRecipients = [recipient.email, ...copies.emails];
    if (new Set([...visibleRecipients, ...blindCopies]).size !== visibleRecipients.length + blindCopies.length) {
      throw makeMailError("mail_recipient_conflict", "mail_recipient_conflict", 400);
    }
  }

  return {
    to: recipient.email,
    cc: copies.emails.length ? copies.emails : undefined,
    bcc: blindCopies,
    from: requireText(from || ENV.MAIL_FROM, "mail_from_required"),
    replyTo: replyTo === undefined ? ENV.MAIL_REPLY_TO || undefined : replyTo || undefined,
    subject: requireText(subject, "mail_subject_required"),
    html: html || undefined,
    text: requireText(text, "mail_text_required"),
    tenantId: tenantId || null,
    template: template || null,
  };
}

async function sendWithFetch({ url, headers, body, timeoutMs, redactProviderErrors = false, hasBcc = false }) {
  if (typeof fetch !== "function") throw makeMailError("mail_fetch_unavailable", "mail_fetch_unavailable", 500);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
  } catch (error) {
    if (hasBcc) throw makeMailError("mail_provider_request_failed", "mail_provider_request_failed", 502);
    throw error;
  }
  if (!response.ok) {
    const error = makeMailError("mail_provider_rejected_message", "mail_provider_rejected_message", 502);
    error.details = { status: response.status };
    if (redactProviderErrors || hasBcc) {
      await response.body?.cancel().catch(() => {});
    } else {
      const responseText = await response.text().catch(() => "");
      error.details.body = responseText.slice(0, 500);
    }
    throw error;
  }
  return response.json().catch(() => ({}));
}

async function sendEmail(input, options = {}) {
  const provider = normalizeProvider(ENV.MAIL_PROVIDER);
  if (options.idempotencyKey != null &&
      (provider !== "resend" || typeof options.idempotencyKey !== "string" ||
       !/^[a-zA-Z0-9:_-]{1,256}$/.test(options.idempotencyKey))) {
    throw makeMailError("mail_idempotency_unsupported_or_invalid", "mail_idempotency_unsupported_or_invalid", 400);
  }
  if (options.timeoutMs != null && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 30000)) {
    throw makeMailError("mail_timeout_invalid", "mail_timeout_invalid", 400);
  }

  if (provider === "disabled" || provider === "none") throw makeMailError("mail_provider_disabled", "mail_provider_disabled", 503);

  const message = buildMessage(input || {});

  if (!ENV.MAIL_API_KEY) throw makeMailError("mail_api_key_required", "mail_api_key_required", 503);

  if (provider === "resend") {
    const templateTag = String(message.template || "generic");
    const timeControl = /^time_control(?:[._]|$)/.test(templateTag);
    const result = await sendWithFetch({
      url: "https://api.resend.com/emails",
      headers: {
        Authorization: `Bearer ${ENV.MAIL_API_KEY}`,
        "Content-Type": "application/json",
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      timeoutMs: options.timeoutMs,
      redactProviderErrors: timeControl,
      hasBcc: message.bcc !== undefined,
      body: {
        from: message.from,
        to: [message.to],
        cc: message.cc,
        bcc: message.bcc?.length ? message.bcc : undefined,
        subject: message.subject,
        html: message.html,
        text: message.text,
        reply_to: message.replyTo,
        tags: [
          { name: "tenant_id", value: String(message.tenantId || "none") },
          { name: "template", value: timeControl ? templateTag.replace(/[^A-Za-z0-9_-]/g, "_") : templateTag },
        ],
      },
    });
    return { provider, sent: true, providerMessageId: result?.id || null };
  }

  if (provider === "postmark") {
    const result = await sendWithFetch({
      url: "https://api.postmarkapp.com/email",
      headers: {
        "X-Postmark-Server-Token": ENV.MAIL_API_KEY,
        "Content-Type": "application/json",
      },
      hasBcc: message.bcc !== undefined,
      body: {
        From: message.from,
        To: message.to,
        Cc: message.cc?.join(","),
        Bcc: message.bcc?.length ? message.bcc.join(",") : undefined,
        Subject: message.subject,
        HtmlBody: message.html,
        TextBody: message.text,
        ReplyTo: message.replyTo,
        MessageStream: ENV.MAIL_STREAM || undefined,
        Metadata: {
          tenant_id: String(message.tenantId || ""),
          template: String(message.template || ""),
        },
      },
    });
    return { provider, sent: true, providerMessageId: result?.MessageID || null };
  }

  throw makeMailError("mail_provider_unsupported", "mail_provider_unsupported", 503);
}

module.exports = { sendEmail };
