'use strict';

const userQueries = require('../db/queries/user');
const { createHttpError } = require('../middleware/errorHandler');

let pool = null;

function getPool() {
  if (!pool) pool = require('../db/pool');
  return pool;
}
const IGVA_POC_ONLINE_GATE = Object.freeze({
  feature: 'igva_poc_online_allowlist_v1',
  tenantSlug: 'hoyrup-clemmensen',
  username: 'dep',
});

function normalizeIdentity(value) {
  return String(value || '').trim().toLowerCase();
}

function isEnabled() {
  const raw = normalizeIdentity(process.env.IGVA_POC_ONLINE_ENABLED);
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

function isAllowedTenant(tenant) {
  return isEnabled() && normalizeIdentity(tenant && tenant.slug) === IGVA_POC_ONLINE_GATE.tenantSlug;
}

function isAllowedUser(user) {
  return normalizeIdentity(user && user.username) === IGVA_POC_ONLINE_GATE.username;
}

function assertTenantContext(req) {
  if (!req.auth || !req.context || !req.context.tenant) {
    throw createHttpError(403, 'tenant_context_mismatch');
  }
  if (String(req.auth.tenant_id) !== String(req.context.tenant.id)) {
    throw createHttpError(403, 'tenant_context_mismatch');
  }
}

function normalizeProjectRefParam(value) {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value)) {
    throw createHttpError(400, 'invalid_igva_project_ref');
  }

  const ref = String(value).trim();
  if (!ref) return null;
  if (ref.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ref)) {
    throw createHttpError(400, 'invalid_igva_project_ref');
  }
  return ref;
}

function requireIgvaPocTenantShellAccess(req, _res, next) {
  try {
    if (!isAllowedTenant(req.context && req.context.tenant)) {
      throw createHttpError(404, 'igva_poc_not_found');
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

async function requireIgvaPocOnlineAccess(req, _res, next) {
  let client;
  try {
    assertTenantContext(req);
    if (!isAllowedTenant(req.context.tenant)) {
      throw createHttpError(404, 'igva_poc_not_found');
    }

    client = await getPool().connect();
    const user = await userQueries.findSessionTenantUserById(client, {
      tenantId: req.context.tenant.id,
      userId: req.auth.sub,
    });

    if (!user || !isAllowedUser(user)) {
      throw createHttpError(403, 'igva_poc_access_denied');
    }

    req.igvaPocGate = {
      feature: IGVA_POC_ONLINE_GATE.feature,
      tenant_slug: req.context.tenant.slug,
      username: user.username,
    };
    return next();
  } catch (error) {
    return next(error);
  } finally {
    if (client) client.release();
  }
}

module.exports = {
  requireIgvaPocTenantShellAccess,
  requireIgvaPocOnlineAccess,
  normalizeProjectRefParam,
  _test: {
    IGVA_POC_ONLINE_GATE,
    assertTenantContext,
    isAllowedTenant,
    isAllowedUser,
    normalizeIdentity,
    normalizeProjectRefParam,
  },
};