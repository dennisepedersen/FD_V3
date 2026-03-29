-- Fielddesk V3 Onboarding V1
BEGIN;

ALTER TABLE audit_event DROP CONSTRAINT IF EXISTS ck_audit_event_event_type;
ALTER TABLE audit_event
  ADD CONSTRAINT ck_audit_event_event_type CHECK (
    event_type IN (
      'invitation_created',
      'invitation_accepted',
      'invitation_revoked',
      'login_success',
      'login_fail',
      'tenant_status_changed',
      'tenant_config_changed',
      'role_changed',
      'sync_success',
      'sync_fail',
      'support_access_denied',
      'onboarding_created',
      'onboarding_started',
      'onboarding_completed'
    )
  );

CREATE TABLE onboarding_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'started',
  basic_info jsonb NOT NULL DEFAULT '{}'::jsonb,
  terms_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  ek_integration jsonb NOT NULL DEFAULT '{}'::jsonb,
  endpoint_selection jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  CONSTRAINT fk_onboarding_session_invitation FOREIGN KEY (invitation_id) REFERENCES tenant_invitation(id) ON DELETE RESTRICT,
  CONSTRAINT uq_onboarding_session_invitation UNIQUE (invitation_id),
  CONSTRAINT ck_onboarding_session_status CHECK (status IN ('started', 'completed', 'abandoned')),
  CONSTRAINT ck_onboarding_session_email_not_blank CHECK (btrim(email) <> ''),
  CONSTRAINT ck_onboarding_session_basic_info_object CHECK (jsonb_typeof(basic_info) = 'object'),
  CONSTRAINT ck_onboarding_session_terms_data_object CHECK (jsonb_typeof(terms_data) = 'object'),
  CONSTRAINT ck_onboarding_session_ek_integration_object CHECK (jsonb_typeof(ek_integration) = 'object'),
  CONSTRAINT ck_onboarding_session_endpoint_selection_array CHECK (jsonb_typeof(endpoint_selection) = 'array')
);
CREATE INDEX ix_onboarding_session_status ON onboarding_session (status);
CREATE TRIGGER trg_onboarding_session_set_updated_at BEFORE UPDATE ON onboarding_session FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_onboarding_session_prevent_immutable_update BEFORE UPDATE ON onboarding_session FOR EACH ROW EXECUTE FUNCTION prevent_immutable_update('id', 'invitation_id', 'email', 'created_at');

CREATE TABLE tenant_terms_acceptance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  tenant_user_id uuid NOT NULL,
  terms_version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip_address text NULL,
  user_agent text NULL,
  CONSTRAINT fk_terms_acceptance_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE RESTRICT,
  CONSTRAINT fk_terms_acceptance_user_tenant FOREIGN KEY (tenant_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT ck_terms_acceptance_terms_version_not_blank CHECK (btrim(terms_version) <> '')
);
CREATE UNIQUE INDEX uq_terms_acceptance_user_version ON tenant_terms_acceptance (tenant_id, tenant_user_id, terms_version);
CREATE INDEX ix_terms_acceptance_tenant_accepted ON tenant_terms_acceptance (tenant_id, accepted_at DESC);

CREATE TABLE tenant_endpoint_selection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  endpoint_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_endpoint_selection_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT ck_endpoint_selection_key_not_blank CHECK (btrim(endpoint_key) <> '')
);
CREATE UNIQUE INDEX uq_endpoint_selection_tenant_key_ci ON tenant_endpoint_selection (tenant_id, lower(endpoint_key));
CREATE INDEX ix_endpoint_selection_tenant_enabled ON tenant_endpoint_selection (tenant_id, enabled);
CREATE TRIGGER trg_endpoint_selection_set_updated_at BEFORE UPDATE ON tenant_endpoint_selection FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_endpoint_selection_prevent_immutable_update BEFORE UPDATE ON tenant_endpoint_selection FOR EACH ROW EXECUTE FUNCTION prevent_immutable_update('id', 'tenant_id', 'created_at');

COMMIT;
