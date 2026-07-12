const jwt = require("jsonwebtoken");
const env = require("../config/env");

const ACCESS_TTL = "8h";
const REMEMBER_ME_ACCESS_TTL = "7d";
const GLOBAL_ADMIN_TTL = "12h";
// Onboarding tokens are intentionally short-lived (15-60 min target window).
// Current value: 30 minutes.
const ONBOARDING_TTL = "30m";

function issueAccessToken({ userId, tenantId, role, email, sessionVersion, rememberMe = false }) {
  return jwt.sign(
    {
      sub: userId,
      actor_scope: "tenant",
      tenant_id: tenantId,
      role,
      email,
      session_version: Number(sessionVersion || 0),
      type: "access",
    },
    env.JWT_SECRET,
    { expiresIn: rememberMe ? REMEMBER_ME_ACCESS_TTL : ACCESS_TTL }
  );
}

function issueOnboardingToken({ invitationId, email }) {
  return jwt.sign(
    {
      sub: invitationId,
      actor_scope: "root",
      invitation_id: invitationId,
      role: "onboarding_candidate",
      email,
      type: "onboarding",
    },
    env.INVITATION_JWT_SECRET,
    { expiresIn: ONBOARDING_TTL }
  );
}

function issueGlobalAdminToken({ userId, username, displayName }) {
  return jwt.sign(
    {
      sub: userId,
      actor_scope: "global",
      role: "global_admin",
      username,
      display_name: displayName,
      type: "global_admin",
    },
    env.PORTAL_JWT_SECRET,
    { expiresIn: GLOBAL_ADMIN_TTL }
  );
}

function verifyToken(token, expectedType) {
  const primarySecret = expectedType === "onboarding"
    ? env.INVITATION_JWT_SECRET
    : expectedType === "global_admin"
      ? env.PORTAL_JWT_SECRET
      : env.JWT_SECRET;
  const payload = jwt.verify(token, primarySecret);

  if (!payload || payload.type !== expectedType) {
    throw new Error("Invalid token type");
  }

  if (expectedType === "access") {
    if (!payload.sub || !payload.tenant_id || !payload.role || !payload.email || !Number.isInteger(payload.session_version)) {
      throw new Error("Token missing required claims");
    }

    if (payload.actor_scope !== "tenant") {
      throw new Error("Invalid actor scope");
    }
  }

  if (expectedType === "onboarding") {
    if (!payload.sub || !payload.invitation_id || !payload.email) {
      throw new Error("Token missing required claims");
    }

    if (payload.actor_scope !== "root") {
      throw new Error("Invalid actor scope");
    }
  }

  if (expectedType === "global_admin") {
    if (!payload.sub || !payload.username || !payload.role) {
      throw new Error("Token missing required claims");
    }

    if (payload.actor_scope !== "global" || payload.role !== "global_admin") {
      throw new Error("Invalid actor scope");
    }
  }

  return payload;
}

module.exports = {
  issueAccessToken,
  issueOnboardingToken,
  issueGlobalAdminToken,
  verifyToken,
};
