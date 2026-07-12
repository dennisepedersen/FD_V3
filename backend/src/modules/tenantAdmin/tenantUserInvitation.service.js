const crypto = require("crypto");
const ENV = require("../../config/env");
const pool = require("../../db/pool");
const { withTransaction } = require("../../db/tx");
const { createHttpError } = require("../../middleware/errorHandler");
const auditService = require("../../services/auditService");
const { sendEmail } = require("../../services/mailService");
const { hashPassword } = require("../../services/passwordService");
const { buildInviteEmail } = require("./tenantUserInvitationEmail");
const tenantAdminRepository = require("./tenantAdmin.repository");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPEN_INVITATION_STATUSES = new Set(["pending", "sent", "send_failed"]);
const INVITE_TTL_HOURS = 72;
const MIN_PASSWORD_LENGTH = 10;
const FLOW_INITIAL_SETUP = "initial_setup";
const FLOW_REACTIVATION = "reactivation";

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

function normalizeInvitationFlowType(value) {
  return value === FLOW_REACTIVATION ? FLOW_REACTIVATION : FLOW_INITIAL_SETUP;
}

function isInitialSetupUserState(invitation) {
  const userStatus = String(invitation?.user_status || "").toLowerCase();
  const loginStatus = String(invitation?.login_status || "").toLowerCase();
  return userStatus === "invited"
    || (userStatus === "active" && ["pending_invite", "invited", "imported_no_login"].includes(loginStatus));
}

function assertInvitationFlowMatchesUser(invitation) {
  const flowType = normalizeInvitationFlowType(invitation?.flow_type);
  if (flowType === FLOW_REACTIVATION) {
    if (String(invitation?.user_status || "").toLowerCase() !== "pending_reactivation") {
      throw createHttpError(409, "invite_lifecycle_state_mismatch");
    }
    return flowType;
  }

  if (!isInitialSetupUserState(invitation)) {
    throw createHttpError(409, "invite_lifecycle_state_mismatch");
  }
  return flowType;
}

function isInitialSetupCompletionUserState(user) {
  const status = String(user?.status || "").toLowerCase();
  const loginStatus = String(user?.login_status || "").toLowerCase();
  return ["active", "invited"].includes(status)
    && ["pending_invite", "imported_no_login", "invited"].includes(loginStatus);
}

function isReactivationCompletionUserState(user) {
  return String(user?.status || "").toLowerCase() === "pending_reactivation"
    && String(user?.login_status || "").toLowerCase() === "pending_reactivation";
}

function isPendingInvitationForFlow(invitation, { tenantId, userId, invitationId, flowType }) {
  return invitation
    && invitation.tenant_id === tenantId
    && invitation.tenant_user_id === userId
    && invitation.id === invitationId
    && invitation.invitation_status === "pending"
    && !invitation.used_at
    && !invitation.revoked_at
    && normalizeInvitationFlowType(invitation.flow_type) === flowType;
}

async function getInvitationForCompletionForUpdate(client, { tenantId, userId, invitationId }) {
  const { rows } = await client.query(
    `
      SELECT
        id,
        tenant_id,
        tenant_user_id,
        status AS invitation_status,
        expires_at,
        sent_at,
        used_at,
        revoked_at,
        send_error,
        COALESCE(metadata->>'flow_type', 'initial_setup') AS flow_type
      FROM tenant_user_invitation_token
      WHERE tenant_id = $1
        AND tenant_user_id = $2
        AND id = $3
        AND purpose = 'account_setup'
      FOR UPDATE
    `,
    [tenantId, userId, invitationId]
  );
  return rows[0] || null;
}

async function lockInvitationCompletionState(client, { tenantId, userId, invitationId }) {
  const invitation = await getInvitationForCompletionForUpdate(client, { tenantId, userId, invitationId });
  if (!invitation) {
    return { invitation: null, user: null };
  }
  const user = await getTenantUserForUpdate(client, { tenantId, userId });
  return { invitation, user };
}

function isValidInvitationCompletionState({ invitation, user, tenantId, userId, invitationId, flowType }) {
  if (!isPendingInvitationForFlow(invitation, { tenantId, userId, invitationId, flowType })) {
    return false;
  }
  return flowType === FLOW_REACTIVATION
    ? isReactivationCompletionUserState(user)
    : isInitialSetupCompletionUserState(user);
}

function assertSingleCompletionRow(result) {
  if (result.rows.length !== 1) {
    throw createHttpError(409, "invite_completion_state_conflict");
  }
  return result.rows[0];
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
      SELECT id, tenant_id, email, name, role, status, login_status, session_version,
             deactivated_reason, deactivated_by_user_id, deactivated_at, reactivation_requested_at
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
      SELECT id, tenant_id, email, name, role, status, login_status, session_version,
             deactivated_reason, deactivated_by_user_id, deactivated_at, reactivation_requested_at
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

async function insertInvitation(client, { tenantId, userId, actorId, tokenHash, expiresAt, acceptUrl, flowType = FLOW_INITIAL_SETUP }) {
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
      JSON.stringify({ accept_url_origin: new URL(acceptUrl).origin, flow_type: normalizeInvitationFlowType(flowType) }),
    ]
  );
  return rows[0];
}

async function markInvitationSent({ tenantId, userId, invitationId, actorId, provider }) {
  return withTransaction(async (client) => {
    const state = await lockInvitationCompletionState(client, { tenantId, userId, invitationId });
    if (!isValidInvitationCompletionState({
      ...state,
      tenantId,
      userId,
      invitationId,
      flowType: FLOW_INITIAL_SETUP,
    })) {
      return { status: "stale", invitation: null };
    }

    const invitation = assertSingleCompletionRow(await client.query(
      `
        UPDATE tenant_user_invitation_token
        SET status = 'sent',
            sent_at = now(),
            send_error = NULL
        WHERE tenant_id = $1
          AND tenant_user_id = $2
          AND id = $3
          AND status = 'pending'
          AND used_at IS NULL
          AND revoked_at IS NULL
          AND COALESCE(metadata->>'flow_type', 'initial_setup') = 'initial_setup'
        RETURNING id, expires_at, sent_at
      `,
      [tenantId, userId, invitationId]
    ));

    assertSingleCompletionRow(await client.query(
      `
        UPDATE tenant_user
        SET login_status = 'invited',
            status = CASE WHEN status = 'active' THEN status ELSE 'invited' END,
            last_invited_at = now(),
            updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
          AND status IN ('active','invited')
          AND login_status IN ('pending_invite','imported_no_login','invited')
        RETURNING id
      `,
      [tenantId, userId]
    ));

    await logAudit(client, {
      tenantId,
      actorId,
      eventType: "tenant_user_invite_sent",
      resourceId: userId,
      metadata: {
        invitation_id: invitationId,
        expires_at: invitation.expires_at,
        provider,
      },
    });
    return { status: "sent", invitation };
  });
}

async function markInvitationSendFailed({ tenantId, userId, invitationId, actorId, error }) {
  return withTransaction(async (client) => {
    const state = await lockInvitationCompletionState(client, { tenantId, userId, invitationId });
    if (!isValidInvitationCompletionState({
      ...state,
      tenantId,
      userId,
      invitationId,
      flowType: FLOW_INITIAL_SETUP,
    })) {
      return { status: "stale", invitation: null };
    }

    const invitation = assertSingleCompletionRow(await client.query(
      `
        UPDATE tenant_user_invitation_token
        SET status = 'send_failed',
            send_error = $4
        WHERE tenant_id = $1
          AND tenant_user_id = $2
          AND id = $3
          AND status = 'pending'
          AND used_at IS NULL
          AND revoked_at IS NULL
          AND COALESCE(metadata->>'flow_type', 'initial_setup') = 'initial_setup'
        RETURNING id
      `,
      [tenantId, userId, invitationId, String(error?.code || error?.message || "mail_send_failed").slice(0, 500)]
    ));

    assertSingleCompletionRow(await client.query(
      `
        UPDATE tenant_user
        SET login_status = 'pending_invite',
            updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
          AND status IN ('active','invited')
          AND login_status IN ('pending_invite','imported_no_login','invited')
        RETURNING id
      `,
      [tenantId, userId]
    ));

    await logAudit(client, {
      tenantId,
      actorId,
      eventType: "tenant_user_invite_send_failed",
      resourceId: userId,
      outcome: "fail",
      reason: error?.code || error?.message || "mail_send_failed",
      metadata: { invitation_id: invitationId },
    });
    return { status: "send_failed", invitation };
  });
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
    if (["deleted", "suspended", "deactivated", "pending_reactivation"].includes(user.status)) {
      throw createHttpError(409, ["deactivated", "pending_reactivation"].includes(user.status) ? "tenant_user_requires_reactivation" : "tenant_user_disabled");
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
    flowType: FLOW_INITIAL_SETUP,
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
    const completion = await markInvitationSent({
      tenantId,
      userId: prepared.user.id,
      invitationId: prepared.invitation.id,
      actorId,
      provider: mailResult.provider,
    });
    return {
      invitation: {
        ...prepared.invitation,
        status: completion.status === "sent" ? "sent" : "stale",
      },
    };
  } catch (error) {
    const completion = await markInvitationSendFailed({
      tenantId,
      userId: prepared.user.id,
      invitationId: prepared.invitation.id,
      actorId,
      error,
    });
    error.invitation = {
      ...prepared.invitation,
      status: completion.status === "send_failed" ? "send_failed" : "stale",
    };
    throw error;
  }
}

async function markReactivationInvitationSent({ tenantId, userId, invitationId, actorId, provider }) {
  return withTransaction(async (client) => {
    const state = await lockInvitationCompletionState(client, { tenantId, userId, invitationId });
    if (!isValidInvitationCompletionState({
      ...state,
      tenantId,
      userId,
      invitationId,
      flowType: FLOW_REACTIVATION,
    })) {
      return { status: "stale", invitation: null };
    }

    const invitation = assertSingleCompletionRow(await client.query(
      `
        UPDATE tenant_user_invitation_token
        SET status = 'sent',
            sent_at = now(),
            send_error = NULL
        WHERE tenant_id = $1
          AND tenant_user_id = $2
          AND id = $3
          AND status = 'pending'
          AND used_at IS NULL
          AND revoked_at IS NULL
          AND COALESCE(metadata->>'flow_type', 'initial_setup') = 'reactivation'
        RETURNING id, expires_at, sent_at
      `,
      [tenantId, userId, invitationId]
    ));

    assertSingleCompletionRow(await client.query(
      `
        UPDATE tenant_user
        SET login_status = 'pending_reactivation',
            status = 'pending_reactivation',
            last_invited_at = now(),
            updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
          AND status = 'pending_reactivation'
          AND login_status = 'pending_reactivation'
        RETURNING id
      `,
      [tenantId, userId]
    ));

    await tenantAdminRepository.insertTenantUserLifecycleEvent(client, {
      tenantId,
      userId,
      eventType: "reactivation_invite_sent",
      reason: "reactivation_invite_sent",
      actorId,
      metadata: { invitation_id: invitationId, expires_at: invitation.expires_at, provider },
    });

    await logAudit(client, {
      tenantId,
      actorId,
      eventType: "tenant_user_reactivation_invite_sent",
      resourceId: userId,
      metadata: { invitation_id: invitationId, expires_at: invitation.expires_at, provider },
    });
    return { status: "sent", invitation };
  });
}

async function markReactivationInvitationSendFailed({ tenantId, userId, invitationId, actorId, error }) {
  return withTransaction(async (client) => {
    const state = await lockInvitationCompletionState(client, { tenantId, userId, invitationId });
    if (!isValidInvitationCompletionState({
      ...state,
      tenantId,
      userId,
      invitationId,
      flowType: FLOW_REACTIVATION,
    })) {
      return { status: "stale", invitation: null };
    }

    const invitation = assertSingleCompletionRow(await client.query(
      `
        UPDATE tenant_user_invitation_token
        SET status = 'send_failed',
            send_error = $4
        WHERE tenant_id = $1
          AND tenant_user_id = $2
          AND id = $3
          AND status = 'pending'
          AND used_at IS NULL
          AND revoked_at IS NULL
          AND COALESCE(metadata->>'flow_type', 'initial_setup') = 'reactivation'
        RETURNING id
      `,
      [tenantId, userId, invitationId, String(error?.code || error?.message || "mail_send_failed").slice(0, 500)]
    ));

    await tenantAdminRepository.insertTenantUserLifecycleEvent(client, {
      tenantId,
      userId,
      eventType: "reactivation_invite_failed",
      reason: "mail_send_failed",
      actorId,
      metadata: { invitation_id: invitationId },
    });

    await logAudit(client, {
      tenantId,
      actorId,
      eventType: "tenant_user_reactivation_invite_failed",
      resourceId: userId,
      outcome: "fail",
      reason: error?.code || error?.message || "mail_send_failed",
      metadata: { invitation_id: invitationId },
    });
    return { status: "send_failed", invitation };
  });
}
async function sendTenantUserReactivationInvitation(input) {
  const tenantId = normalizeUuid(input?.tenantId, "tenant_id_required");
  const actorId = normalizeUuid(input?.actorId, "actor_id_required");
  const userId = normalizeUuid(input?.userId, "user_id_required");
  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);
  const acceptUrl = buildAcceptUrl({
    token: rawToken,
    requestProtocol: input?.requestProtocol,
    requestHost: input?.requestHost,
    tenantSlug: input?.tenantSlug,
  });
  const passwordHash = await hashPassword(crypto.randomBytes(24).toString("base64url"));

  const prepared = await withTransaction(async (client) => {
    const existing = await tenantAdminRepository.findTenantUserForUpdate(client, { tenantId, userId });
    if (!existing) {
      throw createHttpError(404, "tenant_user_not_found");
    }
    if (existing.status === "active") {
      throw createHttpError(409, "active_user_cannot_be_reactivated");
    }
    if (!["deactivated", "pending_reactivation"].includes(existing.status)) {
      throw createHttpError(409, "tenant_user_not_deactivated");
    }
    if (!existing.email) {
      throw createHttpError(400, "tenant_user_email_required");
    }

    await revokeOpenInvitations(client, { tenantId, userId, actorId });
    const user = await tenantAdminRepository.requestTenantUserReactivation(client, {
      tenantId,
      userId,
      actorId,
      passwordHash,
    });
    const invitation = await insertInvitation(client, {
      tenantId,
      userId,
      actorId,
      tokenHash,
      expiresAt,
      acceptUrl,
    flowType: FLOW_REACTIVATION,
    });

    await tenantAdminRepository.insertTenantUserLifecycleEvent(client, {
      tenantId,
      userId,
      eventType: "reactivation_requested",
      reason: "reactivation_requested",
      actorId,
      metadata: { invitation_id: invitation.id, resend: existing.status === "pending_reactivation" },
    });

    await logAudit(client, {
      tenantId,
      actorId,
      eventType: "tenant_user_reactivation_requested",
      resourceId: userId,
      metadata: { invitation_id: invitation.id, resend: existing.status === "pending_reactivation" },
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
      template: "tenant_user_reactivation",
    });
    const completion = await markReactivationInvitationSent({
      tenantId,
      userId: prepared.user.id,
      invitationId: prepared.invitation.id,
      actorId,
      provider: mailResult.provider,
    });
    return { invitation: { ...prepared.invitation, status: completion.status === "sent" ? "sent" : "stale" } };
  } catch (error) {
    const completion = await markReactivationInvitationSendFailed({
      tenantId,
      userId: prepared.user.id,
      invitationId: prepared.invitation.id,
      actorId,
      error,
    });
    error.invitation = { ...prepared.invitation, status: completion.status === "send_failed" ? "send_failed" : "stale" };
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
        tu.login_status,
        COALESCE(i.metadata->>'flow_type', 'initial_setup') AS flow_type,
        tu.deactivated_reason,
        tu.deactivated_by_user_id,
        tu.deactivated_at,
        tu.reactivation_requested_at
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
    const flowType = assertInvitationFlowMatchesUser(invitation);
    const isReactivation = flowType === FLOW_REACTIVATION;

    const { rows } = await client.query(
      `
        UPDATE tenant_user
        SET password_hash = $3,
            status = 'active',
            login_status = 'active',
            invite_accepted_at = now(),
            deactivated_reason = CASE WHEN $4::boolean THEN NULL ELSE deactivated_reason END,
            deactivated_by_user_id = CASE WHEN $4::boolean THEN NULL ELSE deactivated_by_user_id END,
            deactivated_at = CASE WHEN $4::boolean THEN NULL ELSE deactivated_at END,
            reactivation_requested_at = NULL,
            reactivation_requested_by_user_id = NULL,
            updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
          AND (
            ($5::text = 'reactivation' AND status = 'pending_reactivation')
            OR (
              $5::text = 'initial_setup'
              AND (
                status = 'invited'
                OR (status = 'active' AND login_status IN ('pending_invite','invited','imported_no_login'))
              )
            )
          )
        RETURNING id, tenant_id, email, name, role, status, login_status, session_version
      `,
      [tenantId, invitation.tenant_user_id, passwordHash, isReactivation, flowType]
    );

    if (rows.length !== 1) {
      throw createHttpError(409, "invite_lifecycle_state_mismatch");
    }

    const tokenUpdate = await client.query(
      `
        UPDATE tenant_user_invitation_token
        SET status = 'used',
            used_at = now()
        WHERE tenant_id = $1
          AND id = $2
          AND status IN ('pending','sent','send_failed')
          AND used_at IS NULL
          AND revoked_at IS NULL
        RETURNING id
      `,
      [tenantId, invitation.id]
    );

    if (tokenUpdate.rows.length !== 1) {
      throw createHttpError(403, "invite_token_invalid_or_expired");
    }

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

    await logAudit(client, {
      tenantId,
      actorId: invitation.tenant_user_id,
      actorType: "tenant_user",
      eventType: "tenant_user_invite_accepted",
      resourceId: invitation.tenant_user_id,
      metadata: {
        invitation_id: invitation.id,
        flow_type: flowType,
      },
    });

    if (isReactivation) {
      await tenantAdminRepository.insertTenantUserLifecycleEvent(client, {
        tenantId,
        userId: invitation.tenant_user_id,
        eventType: "reactivated",
        reason: "reactivation_invite_accepted",
        actorId: invitation.tenant_user_id,
        metadata: { invitation_id: invitation.id },
      });
      await logAudit(client, {
        tenantId,
        actorId: invitation.tenant_user_id,
        actorType: "tenant_user",
        eventType: "tenant_user_reactivated",
        resourceId: invitation.tenant_user_id,
        metadata: { invitation_id: invitation.id },
      });
    }

    return { user: rows[0] };
  });
}
module.exports = {
  acceptTenantUserInvitation,
  sendTenantUserInvitation,
  sendTenantUserReactivationInvitation,
  validateTenantUserInvitation,
  _test: {
    assertInvitationFlowMatchesUser,
    markInvitationSent,
    markInvitationSendFailed,
    markReactivationInvitationSent,
    markReactivationInvitationSendFailed,
  },
};
