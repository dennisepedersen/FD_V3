-- Migration 0002: Add username-based login support
-- Adds username column to tenant_user and suggested_login to tenant_invitation.
-- Run manually: psql "$FD_DB_URL" -f migrations/0002_username_login.sql

-- tenant_user: add username column (nullable for existing rows, unique per tenant)
ALTER TABLE tenant_user
  ADD COLUMN IF NOT EXISTS username VARCHAR(4);

-- Unique per tenant (not globally unique - different tenants may have same 3-4 char login)
CREATE UNIQUE INDEX IF NOT EXISTS tenant_user_username_tenant_uniq
  ON tenant_user (tenant_id, lower(username))
  WHERE username IS NOT NULL;

-- tenant_invitation: add suggested_login column
ALTER TABLE tenant_invitation
  ADD COLUMN IF NOT EXISTS suggested_login VARCHAR(4);

-- Index for fast lookup on username within tenant
CREATE INDEX IF NOT EXISTS tenant_user_username_idx
  ON tenant_user (tenant_id, username)
  WHERE username IS NOT NULL;
