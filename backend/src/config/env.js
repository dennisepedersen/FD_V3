const REQUIRED_ENVS = ['DATABASE_URL', 'JWT_SECRET', 'ROOT_DOMAIN', 'NODE_ENV'];

for (const key of REQUIRED_ENVS) {
  if (!process.env[key]) {
    throw new Error(`Missing required env: ${key}`);
  }
}

const NODE_ENV = process.env.NODE_ENV;

if (!['development', 'production', 'test'].includes(NODE_ENV)) {
  throw new Error(`Invalid NODE_ENV: ${NODE_ENV}`);
}

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error('PORT must be a positive integer');
}

const labsAttachmentMaxBytes = Number(process.env.LABS_ATTACHMENT_MAX_BYTES || 10485760);
if (!Number.isInteger(labsAttachmentMaxBytes) || labsAttachmentMaxBytes <= 0) {
  throw new Error('LABS_ATTACHMENT_MAX_BYTES must be a positive integer');
}

const labsAttachmentMaxFiles = Number(process.env.LABS_ATTACHMENT_MAX_FILES || 5);
if (!Number.isInteger(labsAttachmentMaxFiles) || labsAttachmentMaxFiles <= 0) {
  throw new Error('LABS_ATTACHMENT_MAX_FILES must be a positive integer');
}

const ENV = {
  NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  PORTAL_JWT_SECRET: process.env.PORTAL_JWT_SECRET || process.env.JWT_SECRET,
  INVITATION_JWT_SECRET: process.env.INVITATION_JWT_SECRET || process.env.JWT_SECRET,
  GLOBAL_ADMIN_API_KEY: process.env.GLOBAL_ADMIN_API_KEY || null,
  BOOTSTRAP_GLOBAL_ADMIN_USERNAME: process.env.BOOTSTRAP_GLOBAL_ADMIN_USERNAME || null,
  BOOTSTRAP_GLOBAL_ADMIN_PASSWORD: process.env.BOOTSTRAP_GLOBAL_ADMIN_PASSWORD || null,
  BOOTSTRAP_GLOBAL_ADMIN_DISPLAY_NAME: process.env.BOOTSTRAP_GLOBAL_ADMIN_DISPLAY_NAME || null,
  ROOT_DOMAIN: process.env.ROOT_DOMAIN.toLowerCase(),
  PORTAL_DOMAIN: (process.env.PORTAL_DOMAIN || `portal.${process.env.ROOT_DOMAIN}`).toLowerCase(),
  PORT: port,
  LABS_AI_PROVIDER: process.env.LABS_AI_PROVIDER || "local",
  LABS_AI_MODEL: process.env.LABS_AI_MODEL || "fielddesk-local-governance-analyzer-v0.1",
  LABS_ATTACHMENT_STORAGE_DIR: process.env.LABS_ATTACHMENT_STORAGE_DIR || null,
  LABS_ATTACHMENT_MAX_BYTES: labsAttachmentMaxBytes,
  LABS_ATTACHMENT_MAX_FILES: labsAttachmentMaxFiles,
};

module.exports = ENV;

global.__DEV__ = ENV.NODE_ENV === 'development';
