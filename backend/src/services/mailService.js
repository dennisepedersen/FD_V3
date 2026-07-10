const ENV = require("../config/env");

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
  if (!normalized) {
    throw makeMailError(code, code, 500);
  }
  return normalized;
}

function buildMessage({ to, subject, html, text, tenantId, template }) {
  return {
    to: requireText(to, "mail_to_required"),
    from: requireText(ENV.MAIL_FROM, "mail_from_required"),
    replyTo: ENV.MAIL_REPLY_TO || undefined,
    subject: requireText(subject, "mail_subject_required"),
    html: html || undefined,
    text: requireText(text, "mail_text_required"),
    tenantId: tenantId || null,
    template: template || null,
  };
}

async function sendWithFetch({ url, headers, body }) {
  if (typeof fetch !== "function") {
    throw makeMailError("mail_fetch_unavailable", "mail_fetch_unavailable", 500);
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    const error = makeMailError("mail_provider_rejected_message", "mail_provider_rejected_message", 502);
    error.details = {
      status: response.status,
      body: responseText.slice(0, 500),
    };
    throw error;
  }
}

async function sendEmail(input) {
  const provider = normalizeProvider(ENV.MAIL_PROVIDER);

  if (provider === "disabled" || provider === "none") {
    throw makeMailError("mail_provider_disabled", "mail_provider_disabled", 503);
  }

  const message = buildMessage(input || {});

  if (!ENV.MAIL_API_KEY) {
    throw makeMailError("mail_api_key_required", "mail_api_key_required", 503);
  }

  if (provider === "resend") {
    await sendWithFetch({
      url: "https://api.resend.com/emails",
      headers: {
        Authorization: `Bearer ${ENV.MAIL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: {
        from: message.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        reply_to: message.replyTo,
        tags: [
          { name: "tenant_id", value: String(message.tenantId || "none") },
          { name: "template", value: String(message.template || "generic") },
        ],
      },
    });
    return { provider, sent: true };
  }

  if (provider === "postmark") {
    await sendWithFetch({
      url: "https://api.postmarkapp.com/email",
      headers: {
        "X-Postmark-Server-Token": ENV.MAIL_API_KEY,
        "Content-Type": "application/json",
      },
      body: {
        From: message.from,
        To: message.to,
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
    return { provider, sent: true };
  }

  throw makeMailError("mail_provider_unsupported", "mail_provider_unsupported", 503);
}

module.exports = {
  sendEmail,
};
