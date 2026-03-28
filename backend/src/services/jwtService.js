const jwt = require("jsonwebtoken");
const env = require("../config/env");

const ACCESS_TTL = "15m";
const ONBOARDING_TTL = "30m";

function issueAccessToken({ userId, tenantId, role, email }) {
  return jwt.sign(
    {
      sub: userId,
      actor_scope: "tenant",
      tenant_id: tenantId,
      role,
      email,
      type: "access",
    },
    env.JWT_SECRET,
    { expiresIn: ACCESS_TTL }
  );
}

function issueOnboardingToken({ userId, tenantId, role, email }) {
  return jwt.sign(
    {
      sub: userId,
      actor_scope: "tenant",
      tenant_id: tenantId,
      role,
      email,
      type: "onboarding",
    },
    env.INVITATION_JWT_SECRET,
    { expiresIn: ONBOARDING_TTL }
  );
}

function verifyToken(token, expectedType) {
  const primarySecret = expectedType === "onboarding" ? env.INVITATION_JWT_SECRET : env.JWT_SECRET;
  const payload = jwt.verify(token, primarySecret);

  if (!payload || payload.type !== expectedType) {
    throw new Error("Invalid token type");
  }

  if (!payload.sub || !payload.tenant_id || !payload.role || !payload.email) {
    throw new Error("Token missing required claims");
  }

  if (payload.actor_scope !== "tenant") {
    throw new Error("Invalid actor scope");
  }

  return payload;
}

module.exports = {
  issueAccessToken,
  issueOnboardingToken,
  verifyToken,
};
