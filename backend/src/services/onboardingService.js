const crypto = require("crypto");
const env = require("../config/env");
const pool = require("../db/pool");
const { withTransaction } = require("../db/tx");
const invitationQueries = require("../db/queries/invitation");
const onboardingQueries = require("../db/queries/onboarding");
const tenantQueries = require("../db/queries/tenant");
const userQueries = require("../db/queries/user");
const auditQueries = require("../db/queries/audit");
const { hashPassword } = require("./passwordService");

function encryptionKey() {
  return crypto.createHash("sha256").update(env.JWT_SECRET).digest();
}

function encryptSecret(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

function ensureNonEmptyString(value, fieldName) {
  if (!value || String(value).trim() === "") {
    throw Object.assign(new Error(`Missing field: ${fieldName}`), { statusCode: 400 });
  }
}

function normalizeDomain(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeSlug(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeBaseUrl(value) {
  const normalized = String(value || "").trim();
  try {
    const parsed = new URL(normalized);
    return parsed.origin;
  } catch (error) {
    throw Object.assign(new Error("ek_base_url must be a valid URL"), { statusCode: 400 });
  }
}

function normalizeEndpointSelection(endpoints) {
  if (!Array.isArray(endpoints)) {
    throw Object.assign(new Error("endpoints must be an array"), { statusCode: 400 });
  }

  const normalized = [...new Set(
    endpoints
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean)
  )];

  if (normalized.length === 0) {
    throw Object.assign(new Error("At least one endpoint must be selected"), { statusCode: 400 });
  }

  return normalized;
}

async function loadInvitationAndSessionForUpdate(client, invitationId) {
  const invitation = await invitationQueries.findInvitationByIdForUpdate(client, invitationId);
  if (!invitation) {
    throw Object.assign(new Error("Invitation not found"), { statusCode: 404 });
  }

  if (invitation.status !== "pending") {
    throw Object.assign(new Error("Invitation is not pending"), { statusCode: 403 });
  }

  if (invitation.revoked_at) {
    throw Object.assign(new Error("Invitation is revoked"), { statusCode: 403 });
  }

  if (new Date(invitation.expires_at).getTime() <= Date.now()) {
    throw Object.assign(new Error("Invitation has expired"), { statusCode: 403 });
  }

  const session = await onboardingQueries.getOnboardingSessionForUpdate(client, invitation.id);
  if (!session) {
    throw Object.assign(new Error("Onboarding session not started"), { statusCode: 403 });
  }

  if (session.status !== "started") {
    throw Object.assign(new Error("Onboarding session is not active"), { statusCode: 403 });
  }

  return { invitation, session };
}

function summarizeState(session) {
  const invitationData = session.invitation_data || {};
  const basicInfo = session.basic_info || {};
  const terms = session.terms_data || {};
  const ek = session.ek_integration || {};
  const endpoints = Array.isArray(session.endpoint_selection) ? session.endpoint_selection : [];

  return {
    invitation_id: session.invitation_id,
    email: session.email,
    company_name: invitationData.company_name || basicInfo.tenant_name || null,
    desired_slug: invitationData.desired_slug || basicInfo.tenant_slug || null,
    allow_skip_ek: Boolean(invitationData.allow_skip_ek),
    terms_version: terms.terms_version || null,
    ek_test_status: ek.connection_test_status || "not_tested",
    ek_test_message: ek.connection_test_message || null,
    status: session.status,
    current_step: [
      basicInfo.full_name && basicInfo.tenant_slug && basicInfo.tenant_name && basicInfo.tenant_domain ? "basic_info" : null,
      terms.accepted ? "terms" : null,
      ek.ek_base_url && ek.ek_api_key_encrypted ? "ek_integration" : null,
      endpoints.length > 0 ? "endpoint_selection" : null,
    ].filter(Boolean).length + 1,
    steps: {
      basic_info: Boolean(basicInfo.full_name && basicInfo.tenant_slug && basicInfo.tenant_name && basicInfo.tenant_domain),
      terms: Boolean(terms.accepted),
      ek_integration: Boolean(ek.ek_base_url && ek.ek_api_key_encrypted),
      endpoint_selection: endpoints.length > 0,
      review: Boolean(
        basicInfo.full_name && basicInfo.tenant_slug && basicInfo.tenant_name && basicInfo.tenant_domain &&
        terms.accepted &&
        ek.ek_base_url && ek.ek_api_key_encrypted &&
        endpoints.length > 0
      ),
      complete: session.status === "completed",
    },
  };
}

async function getOnboardingState(invitationId) {
  const client = await pool.connect();
  try {
    const { session } = await loadInvitationAndSessionForUpdate(client, invitationId);
    return summarizeState(session);
  } finally {
    client.release();
  }
}

async function saveBasicInfo({ invitationId, fullName, password, tenantSlug, tenantName, tenantDomain }) {
  ensureNonEmptyString(fullName, "full_name");
  ensureNonEmptyString(password, "password");
  ensureNonEmptyString(tenantSlug, "tenant_slug");
  ensureNonEmptyString(tenantName, "tenant_name");
  ensureNonEmptyString(tenantDomain, "tenant_domain");

  const passwordHash = await hashPassword(password);

  await withTransaction(async (client) => {
    const { session } = await loadInvitationAndSessionForUpdate(client, invitationId);

    await onboardingQueries.updateOnboardingBasicInfo(client, {
      invitationId,
      basicInfo: {
        full_name: String(fullName).trim(),
        password_hash: passwordHash,
        tenant_slug: normalizeSlug(tenantSlug || session.invitation_data?.desired_slug),
        tenant_name: String(tenantName || session.invitation_data?.company_name || "").trim(),
        tenant_domain: normalizeDomain(tenantDomain),
      },
    });
  });
}

async function saveTerms({ invitationId, termsVersion, accepted, ipAddress, userAgent }) {
  ensureNonEmptyString(termsVersion, "terms_version");
  if (accepted !== true) {
    throw Object.assign(new Error("Terms must be accepted"), { statusCode: 400 });
  }

  await withTransaction(async (client) => {
    await loadInvitationAndSessionForUpdate(client, invitationId);

    await onboardingQueries.updateOnboardingTerms(client, {
      invitationId,
      termsData: {
        accepted: true,
        terms_version: String(termsVersion).trim(),
        accepted_at: new Date().toISOString(),
        ip_address: ipAddress || null,
        user_agent: userAgent || null,
      },
    });
  });
}

async function saveEkIntegration({ invitationId, ekBaseUrl, ekApiKey, skipped }) {
  const skipRequested = skipped === true;

  await withTransaction(async (client) => {
    const { session } = await loadInvitationAndSessionForUpdate(client, invitationId);
    const invitationData = session.invitation_data || {};

    if (skipRequested) {
      if (!invitationData.allow_skip_ek) {
        throw Object.assign(new Error("EK skip is not allowed for this invitation"), { statusCode: 403 });
      }

      await onboardingQueries.updateOnboardingEkIntegration(client, {
        invitationId,
        ekIntegration: {
          skipped: true,
          connection_test_status: "skipped",
          connection_test_message: "EK setup skipped by invitation policy",
          tested_at: new Date().toISOString(),
        },
      });
      return;
    }

    ensureNonEmptyString(ekBaseUrl, "ek_base_url");
    ensureNonEmptyString(ekApiKey, "ek_api_key");

    const normalizedBaseUrl = normalizeBaseUrl(ekBaseUrl);
    const encryptedApiKey = encryptSecret(ekApiKey);

    await onboardingQueries.updateOnboardingEkIntegration(client, {
      invitationId,
      ekIntegration: {
        skipped: false,
        ek_base_url: normalizedBaseUrl,
        ek_api_key_encrypted: encryptedApiKey,
        connection_test_status: "not_tested",
        connection_test_message: "Credentials saved. Run EK test endpoint.",
        tested_at: null,
      },
    });
  });
}

async function testEkConnection({ invitationId, ekBaseUrl, ekApiKey }) {
  ensureNonEmptyString(ekBaseUrl, "ek_base_url");
  ensureNonEmptyString(ekApiKey, "ek_api_key");

  const normalizedBaseUrl = normalizeBaseUrl(ekBaseUrl);

  let success = false;
  let message = "Connection test failed";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);

    const response = await fetch(normalizedBaseUrl, {
      method: "GET",
      headers: {
        "x-api-key": ekApiKey,
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    success = response.ok;
    message = success
      ? "Connection test succeeded"
      : `Connection test failed with status ${response.status}`;
  } catch (error) {
    message = `Connection test failed: ${error.message}`;
  }

  await withTransaction(async (client) => {
    await loadInvitationAndSessionForUpdate(client, invitationId);

    await onboardingQueries.updateOnboardingEkIntegration(client, {
      invitationId,
      ekIntegration: {
        skipped: false,
        ek_base_url: normalizedBaseUrl,
        ek_api_key_encrypted: encryptSecret(ekApiKey),
        connection_test_status: success ? "success" : "failed",
        connection_test_message: message,
        tested_at: new Date().toISOString(),
      },
    });
  });

  return {
    success,
    message,
    normalized_base_url: normalizedBaseUrl,
    test_status: success ? "success" : "failed",
  };
}

async function saveEndpointSelection({ invitationId, endpoints }) {
  const normalized = normalizeEndpointSelection(endpoints);

  await withTransaction(async (client) => {
    await loadInvitationAndSessionForUpdate(client, invitationId);

    await onboardingQueries.updateOnboardingEndpointSelection(client, {
      invitationId,
      endpointSelection: normalized,
    });
  });
}

async function getOnboardingReview(invitationId) {
  const client = await pool.connect();
  try {
    const { session } = await loadInvitationAndSessionForUpdate(client, invitationId);
    const state = summarizeState(session);
    const invitationData = session.invitation_data || {};
    const basicInfo = session.basic_info || {};
    const terms = session.terms_data || {};
    const ek = session.ek_integration || {};
    const endpointSelection = Array.isArray(session.endpoint_selection) ? session.endpoint_selection : [];

    return {
      ...state,
      review: {
        email: session.email,
        company_name: invitationData.company_name || null,
        desired_slug: invitationData.desired_slug || null,
        admin_name: invitationData.admin_name || null,
        allow_skip_ek: Boolean(invitationData.allow_skip_ek),
        full_name: basicInfo.full_name || null,
        tenant_slug: basicInfo.tenant_slug || null,
        tenant_name: basicInfo.tenant_name || null,
        tenant_domain: basicInfo.tenant_domain || null,
        terms_version: terms.terms_version || null,
        terms_accepted_at: terms.accepted_at || null,
        ek_base_url: ek.ek_base_url || null,
        ek_test_status: ek.connection_test_status || "not_tested",
        ek_test_message: ek.connection_test_message || null,
        endpoint_selection: endpointSelection,
      },
    };
  } finally {
    client.release();
  }
}

async function completeOnboarding({ invitationId }) {
  try {
    return await withTransaction(async (client) => {
      const { invitation, session } = await loadInvitationAndSessionForUpdate(client, invitationId);
      const basicInfo = session.basic_info || {};
      const invitationData = session.invitation_data || {};
      const termsData = session.terms_data || {};
      const ekIntegration = session.ek_integration || {};
      const endpointSelection = Array.isArray(session.endpoint_selection) ? session.endpoint_selection : [];

      if (!basicInfo.full_name || !basicInfo.password_hash || !basicInfo.tenant_slug || !basicInfo.tenant_name || !basicInfo.tenant_domain) {
        throw Object.assign(new Error("Step 1 (basic info) is incomplete"), { statusCode: 400 });
      }

      if (!termsData.accepted || !termsData.terms_version) {
        throw Object.assign(new Error("Step 2 (terms) is incomplete"), { statusCode: 400 });
      }

      const allowSkipEk = Boolean(invitationData.allow_skip_ek);
      const skipEk = ekIntegration.skipped === true;
      if (skipEk && !allowSkipEk) {
        throw Object.assign(new Error("EK step cannot be skipped for this invitation"), { statusCode: 400 });
      }

      if (!skipEk && (!ekIntegration.ek_base_url || !ekIntegration.ek_api_key_encrypted)) {
        throw Object.assign(new Error("Step 3 (EK integration) is incomplete"), { statusCode: 400 });
      }

      if (!skipEk && ekIntegration.connection_test_status !== "success") {
        throw Object.assign(new Error("EK connection test must succeed before completion"), { statusCode: 400 });
      }

      if (endpointSelection.length === 0) {
        throw Object.assign(new Error("Step 4 (endpoint selection) is incomplete"), { statusCode: 400 });
      }

      const tenant = await tenantQueries.createTenant(client, {
        slug: normalizeSlug(basicInfo.tenant_slug),
        name: String(basicInfo.tenant_name).trim(),
      });

      await tenantQueries.createTenantDomain(client, {
        tenantId: tenant.id,
        domain: normalizeDomain(basicInfo.tenant_domain),
        verified: true,
        active: true,
      });

      await tenantQueries.activateTenant(client, tenant.id);

      const user = await userQueries.createTenantAdminUser(client, {
        tenantId: tenant.id,
        email: invitation.email,
        name: String(basicInfo.full_name).trim(),
        passwordHash: basicInfo.password_hash,
      });

      await client.query(
        `INSERT INTO tenant_terms_acceptance (
          tenant_id,
          tenant_user_id,
          terms_version,
          accepted_at,
          ip_address,
          user_agent
        ) VALUES ($1, $2, $3, COALESCE($4::timestamptz, now()), $5, $6)`,
        [
          tenant.id,
          user.id,
          termsData.terms_version,
          termsData.accepted_at || null,
          termsData.ip_address || null,
          termsData.user_agent || null,
        ]
      );

      if (!skipEk) {
        await client.query(
          `INSERT INTO tenant_config (tenant_id, ek_base_url, ek_api_key_encrypted, status)
           VALUES ($1, $2, $3, 'configured')
           ON CONFLICT (tenant_id)
           DO UPDATE SET
             ek_base_url = EXCLUDED.ek_base_url,
             ek_api_key_encrypted = EXCLUDED.ek_api_key_encrypted,
             status = 'configured',
             updated_at = now()`,
            [tenant.id, ekIntegration.ek_base_url, ekIntegration.ek_api_key_encrypted]
        );

        await client.query(
          `INSERT INTO tenant_config_snapshot (
            tenant_id,
            changed_by_actor_id,
            changed_by_actor_scope,
            config_snapshot,
            reason
          ) VALUES ($1, $2, 'tenant', $3::jsonb, $4)`,
          [
            tenant.id,
            user.id,
            JSON.stringify({
              ek_base_url: ekIntegration.ek_base_url,
              ek_api_key_encrypted: "stored",
            }),
            "onboarding_complete",
          ]
        );
      }

      for (const endpointKey of endpointSelection) {
        await client.query(
          `INSERT INTO tenant_endpoint_selection (tenant_id, endpoint_key, enabled)
           VALUES ($1, $2, true)`,
          [tenant.id, endpointKey]
        );
      }

      await invitationQueries.markInvitationAccepted(client, {
        invitationId: invitation.id,
        tenantId: tenant.id,
      });

      await onboardingQueries.markOnboardingCompleted(client, invitation.id);

      await auditQueries.insertAuditEvent(client, {
        actorId: user.id,
        actorScope: "tenant",
        tenantId: tenant.id,
        eventType: "onboarding_completed",
        targetType: "onboarding_session",
        targetId: session.id,
        outcome: "success",
        reason: "onboarding_complete_success",
        metadata: {
          invitation_id: invitation.id,
          tenant_slug: tenant.slug,
          tenant_domain: basicInfo.tenant_domain,
          company_name: invitationData.company_name || basicInfo.tenant_name,
          desired_slug: invitationData.desired_slug || basicInfo.tenant_slug,
          allow_skip_ek: allowSkipEk,
          ek_test_status: ekIntegration.connection_test_status || "not_tested",
          endpoint_count: endpointSelection.length,
        },
      });

      await auditQueries.insertAuditEvent(client, {
        actorId: user.id,
        actorScope: "tenant",
        tenantId: tenant.id,
        eventType: "tenant_status_changed",
        targetType: "tenant",
        targetId: tenant.id,
        outcome: "success",
        reason: "onboarding_complete_success",
        metadata: {
          from_status: "onboarding_new",
          to_status: "active",
        },
      });

      await auditQueries.insertAuditEvent(client, {
        actorId: user.id,
        actorScope: "tenant",
        tenantId: tenant.id,
        eventType: "invitation_accepted",
        targetType: "tenant_invitation",
        targetId: invitation.id,
        outcome: "success",
        reason: "invitation_consumed_on_complete",
        metadata: {
          invitation_id: invitation.id,
        },
      });

      return {
        tenant_id: tenant.id,
      };
    });
  } catch (error) {
    const client = await pool.connect();
    try {
      try {
        await auditQueries.insertAuditEvent(client, {
          actorId: "system:onboarding",
          actorScope: "system",
          tenantId: null,
          eventType: "onboarding_completed",
          targetType: "tenant_invitation",
          targetId: invitationId,
          outcome: "fail",
          reason: "onboarding_complete_fail",
          metadata: {},
        });
      } catch (auditError) {
        // Preserve primary flow error if audit write fails.
      }
    } finally {
      client.release();
    }
    throw error;
  }
}

module.exports = {
  getOnboardingState,
  saveBasicInfo,
  saveTerms,
  testEkConnection,
  saveEkIntegration,
  saveEndpointSelection,
  getOnboardingReview,
  completeOnboarding,
};
