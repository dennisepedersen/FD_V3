const crypto = require("crypto");
const ENV = require("../../config/env");
const pool = require("../../db/pool");
const { withTransaction } = require("../../db/tx");
const { createHttpError } = require("../../middleware/errorHandler");
const auditService = require("../../services/auditService");
const { sendEmail } = require("../../services/mailService");
const { hashPassword } = require("../../services/passwordService");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPEN_INVITATION_STATUSES = new Set(["pending", "sent", "send_failed"]);
const INVITE_TTL_HOURS = 72;
const MIN_PASSWORD_LENGTH = 10;

function normalizeUuid(value, code) {
  const normalized = value == null ? "" : String(value).trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw createHttpError(400, code);
  }
  return normalized;
}

function normalizeToken(value) {
  const token = value == null ? "" : String(value).trim();
  if (!token || token.length > 256) {
    throw createHttpError(400, "invite_token_required");
  }
  return token;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function isLocalHost(host) {
  return /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(String(host || ""));
}

function buildAcceptUrl({ token, requestProtocol, requestHost, tenantSlug }) {
  if (ENV.TENANT_INVITE_BASE_URL) {
    const base = ENV.TENANT_INVITE_BASE_URL
      .replace(/\{tenant\}/g, encodeURIComponent(String(tenantSlug || "")))
      .replace(/\/+$/, "");
    return `${base}/accept-invite?token=${encodeURIComponent(token)}`;
  }

  const host = String(requestHost || "").trim();
  if (!host) {
    throw createHttpError(500, "tenant_invite_host_required");
  }

  const requestedProtocol = String(requestProtocol || "").replace(/:$/, "").toLowerCase();
  const protocol = requestedProtocol === "http" && isLocalHost(host) ? "http" : "https";
  return `${protocol}://${host}/accept-invite?token=${encodeURIComponent(token)}`;
}

function maskEmail(email) {
  const [local, domain] = String(email || "").split("@");
  if (!local || !domain) return "";
  const visible = local.slice(0, 2);
  return `${visible}${local.length > 2 ? "***" : "*"}@${domain}`;
}

function assertPassword(password) {
  const normalized = password == null ? "" : String(password);
  if (normalized.length < MIN_PASSWORD_LENGTH) {
    throw createHttpError(400, "password_too_short");
  }
  return normalized;
}

function assertOpenInvitation(row) {
  if (!row || !OPEN_INVITATION_STATUSES.has(row.invitation_status) || row.revoked_at || row.used_at) {
    throw createHttpError(403, "invite_token_invalid_or_expired");
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw createHttpError(403, "invite_token_invalid_or_expired");
  }
}

function htmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function logAudit(client, input) {
  await auditService.logAuditEvent({
    client,
    tenantId: input.tenantId,
    actorId: input.actorId,
    actorType: input.actorType || "tenant_user",
    actorScope: "tenant",
    moduleKey: "tenant_admin",
    eventType: input.eventType,
    resourceType: "tenant_user",
    resourceId: input.resourceId,
    outcome: input.outcome || "success",
    reason: input.reason || null,
    metadata: input.metadata || {},
  });
}

async function getTenantUserForUpdate(client, { tenantId, userId }) {
  const { rows } = await client.query(
    `
      SELECT id, tenant_id, email, name, role, status, login_status
      FROM tenant_user
      WHERE tenant_id = $1 AND id = $2
      FOR UPDATE
    `,
    [tenantId, userId]
  );
  return rows[0] || null;
}
async function getFitterForUpdate(client, { tenantId, fitterRowId }) {
  const { rows } = await client.query(
    `
      SELECT id, tenant_id, tenant_user_id, email, name, username
      FROM fitter
      WHERE tenant_id = $1 AND id = $2
      FOR UPDATE
    `,
    [tenantId, fitterRowId]
  );
  return rows[0] || null;
}

async function getTenantUserByEmailForUpdate(client, { tenantId, email }) {
  const { rows } = await client.query(
    `
      SELECT id, tenant_id, email, name, role, status, login_status
      FROM tenant_user
      WHERE tenant_id = $1 AND lower(email) = lower($2)
      FOR UPDATE
    `,
    [tenantId, email]
  );
  return rows[0] || null;
}

async function ensureTenantUserForFitter(client, { tenantId, fitterRowId, passwordHash }) {
  const fitter = await getFitterForUpdate(client, { tenantId, fitterRowId });
  if (!fitter) {
    return null;
  }
  if (fitter.tenant_user_id) {
    return getTenantUserForUpdate(client, { tenantId, userId: fitter.tenant_user_id });
  }
  if (!fitter.email) {
    throw createHttpError(400, "tenant_user_email_required");
  }

  const existing = await getTenantUserByEmailForUpdate(client, { tenantId, email: fitter.email });
  if (existing) {
    await client.query(
      `
        UPDATE fitter
        SET tenant_user_id = $3,
            updated_at = now()
        WHERE tenant_id = $1 AND id = $2
      `,
      [tenantId, fitter.id, existing.id]
    );
    return existing;
  }

  const { rows } = await client.query(
    `
      INSERT INTO tenant_user (tenant_id, email, name, role, status, login_status, username, password_hash)
      VALUES ($1, lower($2), $3, 'technician', 'invited', 'imported_no_login', NULL, $4)
      RETURNING id, tenant_id, email, name, role, status, login_status
    `,
    [tenantId, fitter.email, fitter.name || fitter.email, passwordHash]
  );

  await client.query(
    `
      UPDATE fitter
      SET tenant_user_id = $3,
          updated_at = now()
      WHERE tenant_id = $1 AND id = $2
    `,
    [tenantId, fitter.id, rows[0].id]
  );

  return rows[0];
}

async function revokeOpenInvitations(client, { tenantId, userId, actorId }) {
  const { rows } = await client.query(
    `
      UPDATE tenant_user_invitation_token
      SET status = 'revoked',
          revoked_at = now()
      WHERE tenant_id = $1
        AND tenant_user_id = $2
        AND purpose = 'account_setup'
        AND status IN ('pending','sent','send_failed')
        AND used_at IS NULL
        AND revoked_at IS NULL
      RETURNING id
    `,
    [tenantId, userId]
  );

  if (rows.length) {
    await logAudit(client, {
      tenantId,
      actorId,
      eventType: "tenant_user_invite_revoked",
      resourceId: userId,
      metadata: { revoked_count: rows.length },
    });
  }
}

async function insertInvitation(client, { tenantId, userId, actorId, tokenHash, expiresAt, acceptUrl }) {
  const { rows } = await client.query(
    `
      INSERT INTO tenant_user_invitation_token (
        tenant_id,
        tenant_user_id,
        purpose,
        token_hash,
        status,
        expires_at,
        created_by_user_id,
        metadata
      )
      VALUES ($1, $2, 'account_setup', $3, 'pending', $4, $5, $6::jsonb)
      RETURNING id, tenant_id, tenant_user_id, purpose, status, expires_at, created_at, sent_at, send_error
    `,
    [
      tenantId,
      userId,
      tokenHash,
      expiresAt,
      actorId,
      JSON.stringify({ accept_url_origin: new URL(acceptUrl).origin }),
    ]
  );
  return rows[0];
}

async function markInvitationSent({ tenantId, userId, invitationId, actorId, provider }) {
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `
        UPDATE tenant_user_invitation_token
        SET status = 'sent',
            sent_at = now(),
            send_error = NULL
        WHERE tenant_id = $1
          AND tenant_user_id = $2
          AND id = $3
        RETURNING id, expires_at, sent_at
      `,
      [tenantId, userId, invitationId]
    );

    await client.query(
      `
        UPDATE tenant_user
        SET login_status = 'invited',
            status = CASE WHEN status = 'active' THEN status ELSE 'invited' END,
            last_invited_at = now(),
            updated_at = now()
        WHERE tenant_id = $1 AND id = $2
      `,
      [tenantId, userId]
    );

    await logAudit(client, {
      tenantId,
      actorId,
      eventType: "tenant_user_invite_sent",
      resourceId: userId,
      metadata: {
        invitation_id: invitationId,
        expires_at: rows[0]?.expires_at || null,
        provider,
      },
    });
  });
}

async function markInvitationSendFailed({ tenantId, userId, invitationId, actorId, error }) {
  await withTransaction(async (client) => {
    await client.query(
      `
        UPDATE tenant_user_invitation_token
        SET status = 'send_failed',
            send_error = $4
        WHERE tenant_id = $1
          AND tenant_user_id = $2
          AND id = $3
      `,
      [tenantId, userId, invitationId, String(error?.code || error?.message || "mail_send_failed").slice(0, 500)]
    );

    await client.query(
      `
        UPDATE tenant_user
        SET login_status = 'pending_invite',
            updated_at = now()
        WHERE tenant_id = $1 AND id = $2
      `,
      [tenantId, userId]
    );

    await logAudit(client, {
      tenantId,
      actorId,
      eventType: "tenant_user_invite_send_failed",
      resourceId: userId,
      outcome: "fail",
      reason: error?.code || error?.message || "mail_send_failed",
      metadata: { invitation_id: invitationId },
    });
  });
}

function buildInviteEmail({ user, acceptUrl, expiresAt }) {
  const name = user.name || user.email;
  const text = [
    `Hej ${name}`,
    "",
    "Du er inviteret til at oprette adgang til Fielddesk.",
    `Aabn linket og vaelg din adgangskode: ${acceptUrl}`,
    "",
    `Linket udlober ${new Date(expiresAt).toLocaleString("da-DK")}.`,
    "Hvis du ikke forventede denne invitation, kan du ignorere mailen.",
  ].join("\n");

  const safeName = htmlEscape(name);
  const safeUrl = htmlEscape(acceptUrl);
  const html = `
    <p>Hej ${safeName}</p>
    <p>Du er inviteret til at oprette adgang til Fielddesk.</p>
    <p><a href="${safeUrl}">Opret adgangskode</a></p>
    <p>Linket udlober ${htmlEscape(new Date(expiresAt).toLocaleString("da-DK"))}.</p>
    <p>Hvis du ikke forventede denne invitation, kan du ignorere mailen.</p>
  `;

  return {
    subject: "Opret din Fielddesk adgang",
    text,
    html,
  };
}

async function sendTenantUserInvitation(input) {
  const tenantId = normalizeUuid(input?.tenantId, "tenant_id_required");
  const actorId = normalizeUuid(input?.actorId, "actor_id_required");
  const requestedUserId = normalizeUuid(input?.userId, "user_id_required");
  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);
  const acceptUrl = buildAcceptUrl({
    token: rawToken,
    requestProtocol: input?.requestProtocol,
    requestHost: input?.requestHost,
    tenantSlug: input?.tenantSlug,
  });
  const fallbackPasswordHash = await hashPassword(crypto.randomBytes(24).toString("base64url"));

  const prepared = await withTransaction(async (client) => {
    const user = await getTenantUserForUpdate(client, { tenantId, userId: requestedUserId })
      || await ensureTenantUserForFitter(client, { tenantId, fitterRowId: requestedUserId, passwordHash: fallbackPasswordHash });
    if (!user) {
      throw createHttpError(404, "tenant_user_not_found");
    }
    const userId = user.id;
    if (!user.email) {
      throw createHttpError(400, "tenant_user_email_required");
    }
    if (user.status === "deleted" || user.status === "suspended") {
      throw createHttpError(409, "tenant_user_disabled");
    }
    if (user.status === "active" && user.login_status === "active") {
      throw createHttpError(409, "tenant_user_already_active");
    }

    await revokeOpenInvitations(client, { tenantId, userId, actorId });
    const invitation = await insertInvitation(client, {
      tenantId,
      userId,
      actorId,
      tokenHash,
      expiresAt,
      acceptUrl,
    });

    await client.query(
      `
        UPDATE tenant_user
        SET login_status = 'pending_invite',
            status = CASE WHEN status = 'active' THEN status ELSE 'invited' END,
            updated_at = now()
        WHERE tenant_id = $1 AND id = $2
      `,
      [tenantId, userId]
    );

    await logAudit(client, {
      tenantId,
      actorId,
      eventType: "tenant_user_invite_requested",
      resourceId: userId,
      metadata: {
        invitation_id: invitation.id,
        expires_at: invitation.expires_at,
      },
    });

    return { user, invitation };
  });

  const email = buildInviteEmail({
    user: prepared.user,
    acceptUrl,
    expiresAt: prepared.invitation.expires_at,
  });

  try {
    const mailResult = await sendEmail({
      to: prepared.user.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      tenantId,
      template: "tenant_user_account_setup",
    });
    await markInvitationSent({
      tenantId,
      userId: prepared.user.id,
      invitationId: prepared.invitation.id,
      actorId,
      provider: mailResult.provider,
    });
    return {
      invitation: {
        ...prepared.invitation,
        status: "sent",
      },
    };
  } catch (error) {
    await markInvitationSendFailed({
      tenantId,
      userId: prepared.user.id,
      invitationId: prepared.invitation.id,
      actorId,
      error,
    });
    error.invitation = {
      ...prepared.invitation,
      status: "send_failed",
    };
    throw error;
  }
}

async function findInvitationByToken(client, { tenantId, token, forUpdate }) {
  const lock = forUpdate ? "FOR UPDATE" : "";
  const { rows } = await client.query(
    `
      SELECT
        i.id,
        i.tenant_id,
        i.tenant_user_id,
        i.status AS invitation_status,
        i.expires_at,
        i.used_at,
        i.revoked_at,
        tu.email,
        tu.name,
        tu.status AS user_status,
        tu.login_status
      FROM tenant_user_invitation_token i
      JOIN tenant_user tu
        ON tu.tenant_id = i.tenant_id
       AND tu.id = i.tenant_user_id
      WHERE i.tenant_id = $1
        AND i.token_hash = $2
        AND i.purpose = 'account_setup'
      ${lock}
    `,
    [tenantId, hashToken(token)]
  );
  return rows[0] || null;
}

async function validateTenantUserInvitation(input) {
  const tenantId = normalizeUuid(input?.tenantId, "tenant_id_required");
  const token = normalizeToken(input?.token);
  const client = await pool.connect();
  try {
    const invitation = await findInvitationByToken(client, { tenantId, token, forUpdate: false });
    try {
      assertOpenInvitation(invitation);
    } catch (_error) {
      return { valid: false, reason: "invite_token_invalid_or_expired" };
    }
    return {
      valid: true,
      invitation: {
        expires_at: invitation.expires_at,
        email_hint: maskEmail(invitation.email),
        name: invitation.name,
      },
    };
  } finally {
    client.release();
  }
}

async function acceptTenantUserInvitation(input) {
  const tenantId = normalizeUuid(input?.tenantId, "tenant_id_required");
  const token = normalizeToken(input?.token);
  const password = assertPassword(input?.password);
  const passwordHash = await hashPassword(password);

  return withTransaction(async (client) => {
    const invitation = await findInvitationByToken(client, { tenantId, token, forUpdate: true });
    assertOpenInvitation(invitation);

    await client.query(
      `
        UPDATE tenant_user_invitation_token
        SET status = 'used',
            used_at = now()
        WHERE tenant_id = $1 AND id = $2
      `,
      [tenantId, invitation.id]
    );

    await client.query(
      `
        UPDATE tenant_user_invitation_token
        SET status = 'revoked',
            revoked_at = now()
        WHERE tenant_id = $1
          AND tenant_user_id = $2
          AND purpose = 'account_setup'
          AND id <> $3
          AND status IN ('pending','sent','send_failed')
          AND used_at IS NULL
          AND revoked_at IS NULL
      `,
      [tenantId, invitation.tenant_user_id, invitation.id]
    );

    const { rows } = await client.query(
      `
        UPDATE tenant_user
        SET password_hash = $3,
            status = 'active',
            login_status = 'active',
            invite_accepted_at = now(),
            updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, tenant_id, email, name, role, status, login_status
      `,
      [tenantId, invitation.tenant_user_id, passwordHash]
    );

    await logAudit(client, {
      tenantId,
      actorId: invitation.tenant_user_id,
      actorType: "tenant_user",
      eventType: "tenant_user_invite_accepted",
      resourceId: invitation.tenant_user_id,
      metadata: {
        invitation_id: invitation.id,
      },
    });

    return { user: rows[0] };
  });
}

module.exports = {
  acceptTenantUserInvitation,
  sendTenantUserInvitation,
  validateTenantUserInvitation,
};
