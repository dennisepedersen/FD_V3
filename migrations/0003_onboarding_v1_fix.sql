-- Fielddesk V3 Onboarding V1 fix round
BEGIN;

ALTER TABLE tenant_invitation
  ADD COLUMN IF NOT EXISTS company_name text NULL,
  ADD COLUMN IF NOT EXISTS desired_slug text NULL,
  ADD COLUMN IF NOT EXISTS admin_name text NULL,
  ADD COLUMN IF NOT EXISTS allow_skip_ek boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS invitation_note text NULL;

ALTER TABLE onboarding_session
  ADD COLUMN IF NOT EXISTS invitation_data jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE onboarding_session
  DROP CONSTRAINT IF EXISTS ck_onboarding_session_basic_info_object,
  DROP CONSTRAINT IF EXISTS ck_onboarding_session_terms_data_object,
  DROP CONSTRAINT IF EXISTS ck_onboarding_session_ek_integration_object,
  DROP CONSTRAINT IF EXISTS ck_onboarding_session_endpoint_selection_array;

ALTER TABLE onboarding_session
  ADD CONSTRAINT ck_onboarding_session_basic_info_object CHECK (jsonb_typeof(basic_info) = 'object'),
  ADD CONSTRAINT ck_onboarding_session_terms_data_object CHECK (jsonb_typeof(terms_data) = 'object'),
  ADD CONSTRAINT ck_onboarding_session_ek_integration_object CHECK (jsonb_typeof(ek_integration) = 'object'),
  ADD CONSTRAINT ck_onboarding_session_endpoint_selection_array CHECK (jsonb_typeof(endpoint_selection) = 'array'),
  ADD CONSTRAINT ck_onboarding_session_invitation_data_object CHECK (jsonb_typeof(invitation_data) = 'object');

COMMIT;
