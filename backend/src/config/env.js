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

const ENV = {
  NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  INVITATION_JWT_SECRET: process.env.INVITATION_JWT_SECRET || process.env.JWT_SECRET,
  GLOBAL_ADMIN_API_KEY: process.env.GLOBAL_ADMIN_API_KEY || null,
  ROOT_DOMAIN: process.env.ROOT_DOMAIN.toLowerCase(),
  PORT: port,
};

module.exports = ENV;

global.__DEV__ = ENV.NODE_ENV === 'development';
