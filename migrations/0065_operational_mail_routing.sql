BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

CREATE FUNCTION operational_mail_addresses_valid(addresses text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT AS $function$
  SELECT count(*) <= 20 AND count(*) = count(DISTINCT address)
    AND coalesce(bool_and(address IS NOT NULL AND length(address) <= 254
      AND address = lower(btrim(address))
      AND address ~ $pattern$^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$$pattern$
      AND length(split_part(address, '@', 1)) <= 64
      AND split_part(address, '@', 1) !~ '^\.|\.\.|\.$'), true)
  FROM unnest(addresses) AS source(address);
$function$;

CREATE TABLE tenant_operational_mail_routing (
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  mail_type text NOT NULL CHECK (mail_type IN (
    'time_control_missing_hours', 'time_control_friday_status', 'approval_control_summary'
  )),
  extra_cc_enabled boolean NOT NULL DEFAULT false,
  extra_cc_emails text[] NOT NULL DEFAULT '{}',
  extra_bcc_enabled boolean NOT NULL DEFAULT false,
  extra_bcc_emails text[] NOT NULL DEFAULT '{}',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by_user_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, mail_type),
  FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES tenant_user(id, tenant_id) ON DELETE RESTRICT,
  CHECK (coalesce(array_ndims(extra_cc_emails), 1) = 1 AND operational_mail_addresses_valid(extra_cc_emails)),
  CHECK (coalesce(array_ndims(extra_bcc_emails), 1) = 1 AND operational_mail_addresses_valid(extra_bcc_emails)),
  CHECK (NOT extra_cc_enabled OR cardinality(extra_cc_emails) > 0),
  CHECK (NOT extra_bcc_enabled OR cardinality(extra_bcc_emails) > 0),
  CHECK (NOT (extra_cc_enabled AND extra_bcc_enabled) OR NOT extra_cc_emails && extra_bcc_emails)
);

-- No tenant seed, recipient, activation, queued mail or modification of existing settings.
COMMIT;
