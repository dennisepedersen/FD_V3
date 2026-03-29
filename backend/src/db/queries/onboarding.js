const DEFAULT_ENDPOINT_SELECTION = ["projects", "fitterhours", "users"];

async function createOnboardingSession(client, { invitationId, email, invitationData }) {
  const sql = `
    INSERT INTO onboarding_session (invitation_id, email, status, invitation_data, endpoint_selection)
    VALUES ($1, $2, 'started', $3::jsonb, $4::jsonb)
    RETURNING id, invitation_id, email, status, invitation_data, basic_info, terms_data, ek_integration, endpoint_selection, created_at, updated_at, completed_at
  `;

  const { rows } = await client.query(sql, [
    invitationId,
    email.toLowerCase(),
    JSON.stringify(invitationData || {}),
    JSON.stringify(DEFAULT_ENDPOINT_SELECTION),
  ]);
  return rows[0];
}

async function getOnboardingSessionForUpdate(client, invitationId) {
  const sql = `
    SELECT id, invitation_id, email, status, invitation_data, basic_info, terms_data, ek_integration, endpoint_selection, created_at, updated_at, completed_at
    FROM onboarding_session
    WHERE invitation_id = $1
    FOR UPDATE
  `;

  const { rows } = await client.query(sql, [invitationId]);
  return rows[0] || null;
}

async function getOnboardingSession(client, invitationId) {
  const sql = `
    SELECT id, invitation_id, email, status, invitation_data, basic_info, terms_data, ek_integration, endpoint_selection, created_at, updated_at, completed_at
    FROM onboarding_session
    WHERE invitation_id = $1
    LIMIT 1
  `;

  const { rows } = await client.query(sql, [invitationId]);
  return rows[0] || null;
}

async function updateOnboardingBasicInfo(client, { invitationId, basicInfo }) {
  const sql = `
    UPDATE onboarding_session
    SET basic_info = $2::jsonb
    WHERE invitation_id = $1
  `;

  await client.query(sql, [invitationId, JSON.stringify(basicInfo)]);
}

async function updateOnboardingTerms(client, { invitationId, termsData }) {
  const sql = `
    UPDATE onboarding_session
    SET terms_data = $2::jsonb
    WHERE invitation_id = $1
  `;

  await client.query(sql, [invitationId, JSON.stringify(termsData)]);
}

async function updateOnboardingEkIntegration(client, { invitationId, ekIntegration }) {
  const sql = `
    UPDATE onboarding_session
    SET ek_integration = $2::jsonb
    WHERE invitation_id = $1
  `;

  await client.query(sql, [invitationId, JSON.stringify(ekIntegration)]);
}

async function updateOnboardingEndpointSelection(client, { invitationId, endpointSelection }) {
  const sql = `
    UPDATE onboarding_session
    SET endpoint_selection = $2::jsonb
    WHERE invitation_id = $1
  `;

  await client.query(sql, [invitationId, JSON.stringify(endpointSelection)]);
}

async function markOnboardingCompleted(client, invitationId) {
  const sql = `
    UPDATE onboarding_session
    SET status = 'completed', completed_at = now(), updated_at = now()
    WHERE invitation_id = $1
  `;

  await client.query(sql, [invitationId]);
}

module.exports = {
  createOnboardingSession,
  getOnboardingSessionForUpdate,
  getOnboardingSession,
  updateOnboardingBasicInfo,
  updateOnboardingTerms,
  updateOnboardingEkIntegration,
  updateOnboardingEndpointSelection,
  markOnboardingCompleted,
};
