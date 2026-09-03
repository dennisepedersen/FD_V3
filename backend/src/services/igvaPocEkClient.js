'use strict';

const crypto = require('crypto');

const DEFAULT_PAGE_SIZE = 1000;
const MAX_FITTERHOUR_PAGES = 20;
const MAX_PURCHASE_LINE_PAGES = 50;

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function decryptSecret(cipherText) {
  const [ivBase64, tagBase64, encryptedBase64] = String(cipherText || '').split('.');
  if (!ivBase64 || !tagBase64 || !encryptedBase64) {
    throw new Error('invalid_encrypted_ek_api_key_format');
  }
  if (!process.env.JWT_SECRET) {
    throw new Error('jwt_secret_required_for_ek_decrypt');
  }

  const key = crypto.createHash('sha256').update(process.env.JWT_SECRET).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivBase64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagBase64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function normalizeBaseUrl(baseUrl) {
  const parsed = new URL(String(baseUrl || '').trim());
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

function extractSiteName(snapshot, slug) {
  const value = snapshot && snapshot.ek_site_name;
  return value && String(value).trim() ? String(value).trim() : String(slug || 'Ekstern');
}

async function resolveTenantEkConfig(client, { tenantId }) {
  const { rows } = await client.query(
    `
      SELECT
        t.slug,
        tc.ek_base_url,
        tc.ek_api_key_encrypted,
        tcs.config_snapshot
      FROM tenant_config tc
      JOIN tenant t ON t.id = tc.tenant_id
      LEFT JOIN LATERAL (
        SELECT config_snapshot
        FROM tenant_config_snapshot
        WHERE tenant_id = tc.tenant_id
        ORDER BY changed_at DESC
        LIMIT 1
      ) tcs ON true
      WHERE tc.tenant_id = $1
      LIMIT 1
    `,
    [tenantId],
  );

  const row = rows[0] || null;
  if (!row || !row.ek_base_url || !row.ek_api_key_encrypted) {
    return null;
  }

  return {
    baseUrl: normalizeBaseUrl(row.ek_base_url),
    apiKey: decryptSecret(row.ek_api_key_encrypted),
    siteName: extractSiteName(row.config_snapshot || {}, row.slug),
  };
}

function valueAt(payload, key) {
  return payload && Object.prototype.hasOwnProperty.call(payload, key) ? payload[key] : undefined;
}

function responseRoot(json) {
  if (!json || typeof json !== 'object') return json;
  for (const key of ['successObjects', 'SuccessObjects', 'data', 'Data', 'result', 'Result']) {
    const value = valueAt(json, key);
    if (value !== undefined && value !== null) return value;
  }
  return json;
}

function firstObject(json) {
  const root = responseRoot(json);
  if (Array.isArray(root)) return root.find((item) => item && typeof item === 'object') || null;
  if (root && typeof root === 'object') return root;
  return null;
}

function findRows(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    const nestedRows = value.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      for (const key of ['rows', 'Rows', 'items', 'Items', 'data', 'Data']) {
        const nested = valueAt(item, key);
        if (Array.isArray(nested)) return nested;
      }
      return [];
    });
    return nestedRows.length ? nestedRows : value;
  }
  if (typeof value !== 'object') return [];

  const root = responseRoot(value);
  if (root !== value) return findRows(root, depth + 1);

  for (const key of ['rows', 'Rows', 'items', 'Items', 'data', 'Data', 'successObjects', 'SuccessObjects']) {
    const nested = valueAt(value, key);
    if (Array.isArray(nested)) return findRows(nested, depth + 1);
  }

  for (const nested of Object.values(value)) {
    const rows = findRows(nested, depth + 1);
    if (rows.length) return rows;
  }
  return [];
}

function hasPayloadErrors(json) {
  if (!json || typeof json !== 'object') return false;
  return json.hasErrors === true || json.HasErrors === true || responseRoot(json)?.hasErrors === true || responseRoot(json)?.HasErrors === true;
}

function compactError(error, fallback = 'request_failed') {
  if (!error) return fallback;
  return String(error.message || fallback).slice(0, 160);
}

async function fetchEkJson(fetchImpl, config, path, { method = 'GET' } = {}) {
  const response = await fetchImpl(`${config.baseUrl}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      apikey: config.apiKey,
      siteName: config.siteName,
    },
  });

  let json = null;
  try {
    json = await response.json();
  } catch (_error) {
    json = null;
  }

  return { status: response.status, ok: response.ok, json };
}

function sourceResult(status, source, payload = {}) {
  return { status, source, ...payload };
}

function pickOptionalNumber(row, keys) {
  if (!row || typeof row !== 'object') return null;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const parsed = toFiniteNumber(row[key]);
      if (parsed !== null) return parsed;
    }
  }
  const lowerKeys = Object.keys(row).reduce((map, key) => {
    map[key.toLowerCase()] = key;
    return map;
  }, {});
  for (const key of keys) {
    const actual = lowerKeys[String(key).toLowerCase()];
    if (actual) {
      const parsed = toFiniteNumber(row[actual]);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

function pickNumber(row, keys) {
  return pickOptionalNumber(row, keys) ?? 0;
}

function sumRows(rows, keys) {
  return round(rows.reduce((sum, row) => sum + pickNumber(row, keys), 0), 6);
}

function accountText(row) {
  if (!row || typeof row !== 'object') return '';
  return Object.entries(row)
    .filter(([key, value]) => /account|konto/i.test(key) && value !== null && value !== undefined && typeof value !== 'object')
    .map(([, value]) => String(value))
    .join(' ');
}

function isTurnoverPosting(row) {
  const text = accountText(row);
  return /1020/.test(text) || /faktur/i.test(text);
}

async function readExpectedLatest(fetchImpl, config, ekProjectId) {
  try {
    const result = await fetchEkJson(fetchImpl, config, `/api/v4/projects/expectedvalues/latest/${encodeURIComponent(String(ekProjectId))}`);
    if (!result.ok || hasPayloadErrors(result.json)) {
      return sourceResult('UNRESOLVED', 'ek_v4_expectedvalues_latest', { http_status: result.status, value: null });
    }
    const value = firstObject(result.json);
    return value
      ? sourceResult('VERIFIED', 'ek_v4_expectedvalues_latest', { http_status: result.status, value })
      : sourceResult('N/A', 'ek_v4_expectedvalues_latest', { http_status: result.status, value: null });
  } catch (error) {
    return sourceResult('UNRESOLVED', 'ek_v4_expectedvalues_latest', { value: null, error: compactError(error) });
  }
}

async function readBudget(fetchImpl, config, ekProjectId) {
  try {
    const result = await fetchEkJson(fetchImpl, config, `/api/v4/projects/budgets/${encodeURIComponent(String(ekProjectId))}`);
    if (!result.ok || hasPayloadErrors(result.json)) {
      return sourceResult('UNRESOLVED', 'ek_v4_projects_budgets', { http_status: result.status, projectBudget: null, expectedValues: null });
    }
    const value = firstObject(result.json);
    return value
      ? sourceResult('VERIFIED', 'ek_v4_projects_budgets', {
        http_status: result.status,
        projectBudget: value.projectBudget || value.ProjectBudget || value.project_budget || null,
        expectedValues: value.projectExpectedValues || value.ProjectExpectedValues || value.project_expected_values || null,
        raw: value,
      })
      : sourceResult('N/A', 'ek_v4_projects_budgets', { http_status: result.status, projectBudget: null, expectedValues: null });
  } catch (error) {
    return sourceResult('UNRESOLVED', 'ek_v4_projects_budgets', { projectBudget: null, expectedValues: null, error: compactError(error) });
  }
}

async function readExpectedHistory(fetchImpl, config, ekProjectId) {
  try {
    const result = await fetchEkJson(fetchImpl, config, `/api/v4/projects/expectedvalues/history/${encodeURIComponent(String(ekProjectId))}`);
    if (!result.ok || hasPayloadErrors(result.json)) {
      return sourceResult('UNRESOLVED', 'ek_v4_expectedvalues_history', { http_status: result.status, rows: [] });
    }
    return sourceResult('VERIFIED', 'ek_v4_expectedvalues_history', {
      http_status: result.status,
      rows: findRows(result.json).slice(0, 8),
      total_rows_observed: findRows(result.json).length,
    });
  } catch (error) {
    return sourceResult('UNRESOLVED', 'ek_v4_expectedvalues_history', { rows: [], total_rows_observed: 0, error: compactError(error) });
  }
}

async function readActualTurnover(fetchImpl, config, ekProjectId) {
  try {
    const params = new URLSearchParams({ searchAttribute: 'ProjectID', search: String(ekProjectId), page: '1', pageSize: String(DEFAULT_PAGE_SIZE) });
    const result = await fetchEkJson(fetchImpl, config, `/api/v4/financialposts?${params.toString()}`);
    if (!result.ok || hasPayloadErrors(result.json)) {
      return sourceResult('UNRESOLVED', 'ek_v4_financialposts', { http_status: result.status, actual_turnover: null, rows_matched: 0 });
    }
    const rows = findRows(result.json);
    const turnoverRows = rows.filter(isTurnoverPosting);
    const signedSum = turnoverRows.reduce((sum, row) => sum + pickNumber(row, ['value', 'Value', 'amount', 'Amount']), 0);
    return sourceResult(turnoverRows.length ? 'VERIFIED' : 'N/A', 'ek_v4_financialposts', {
      http_status: result.status,
      actual_turnover: turnoverRows.length ? round(signedSum < 0 ? -signedSum : signedSum, 2) : null,
      signed_turnover_sum: turnoverRows.length ? round(signedSum, 2) : null,
      rows_matched: turnoverRows.length,
    });
  } catch (error) {
    return sourceResult('UNRESOLVED', 'ek_v4_financialposts', { actual_turnover: null, rows_matched: 0, error: compactError(error) });
  }
}

async function readPurchaseInvoiceLinesByProject(fetchImpl, config, ekProjectId) {
  try {
    const allRows = [];
    const pages = [];
    for (let page = 1; page <= MAX_PURCHASE_LINE_PAGES; page += 1) {
      const params = new URLSearchParams({
        searchAttribute: 'ProjectID',
        search: String(ekProjectId),
        page: String(page),
        pageSize: String(DEFAULT_PAGE_SIZE),
      });
      const result = await fetchEkJson(fetchImpl, config, `/api/v4/purchaseinvoicelines?${params.toString()}`);
      const rows = findRows(result.json);
      pages.push({
        page,
        http_status: result.status,
        rows: rows.length,
      });
      if (!result.ok || hasPayloadErrors(result.json)) {
        return sourceResult('UNRESOLVED', 'ek_v4_purchaseinvoicelines_direct_project', {
          http_status: result.status,
          rows: allRows,
          total_rows_observed: allRows.length,
          pages,
        });
      }
      allRows.push(...rows);
      if (rows.length < DEFAULT_PAGE_SIZE) break;
    }

    return sourceResult(allRows.length ? 'VERIFIED' : 'N/A', 'ek_v4_purchaseinvoicelines_direct_project', {
      rows: allRows,
      total_rows_observed: allRows.length,
      pages,
    });
  } catch (error) {
    return sourceResult('UNRESOLVED', 'ek_v4_purchaseinvoicelines_direct_project', {
      rows: [],
      total_rows_observed: 0,
      error: compactError(error),
    });
  }
}
async function readLegacyFitterhours(fetchImpl, config, ekProjectId) {
  try {
    const allRows = [];
    for (let page = 1; page <= MAX_FITTERHOUR_PAGES; page += 1) {
      const params = new URLSearchParams({ searchAttribute: 'ProjectID', search: String(ekProjectId), page: String(page), pageSize: String(DEFAULT_PAGE_SIZE) });
      const result = await fetchEkJson(fetchImpl, config, `/api/v3.0/fitterhours?${params.toString()}`);
      if (!result.ok || hasPayloadErrors(result.json)) {
        return sourceResult('UNRESOLVED', 'ek_v3_legacy_fitterhours', { http_status: result.status, rows: 0 });
      }
      const rows = findRows(result.json);
      allRows.push(...rows);
      if (rows.length < DEFAULT_PAGE_SIZE) break;
    }

    if (!allRows.length) {
      return sourceResult('N/A', 'ek_v3_legacy_fitterhours', { rows: 0 });
    }

    const actualHours = sumRows(allRows, ['BasisTotalHours', 'basisTotalHours']);
    const rawHours = sumRows(allRows, ['Hours', 'hours']);
    const otherHours = sumRows(allRows, ['FitterHourWorkTypeOtherTotalHours', 'fitterHourWorkTypeOtherTotalHours']);
    const basisTotalCost = sumRows(allRows, ['BasisTotalCost', 'basisTotalCost']);
    const basisSocialCost = round(allRows.reduce((sum, row) => {
      const explicit = pickOptionalNumber(row, ['BasisHoursSocialCost', 'BasisHoursSocialCosts', 'BasisHourSocialCost', 'BasisHourSocialCosts', 'basisHoursSocialCost', 'basisHoursSocialCosts', 'basisHourSocialCost', 'basisHourSocialCosts']);
      if (explicit !== null) return sum + explicit;
      const rowBasisTotalCost = pickNumber(row, ['BasisTotalCost', 'basisTotalCost']);
      const socialPercent = pickOptionalNumber(row, ['SocialTaxesInPercent', 'socialTaxesInPercent']);
      if (rowBasisTotalCost && socialPercent !== null && socialPercent > -100) {
        return sum + (rowBasisTotalCost - (rowBasisTotalCost / (1 + (socialPercent / 100))));
      }
      return sum;
    }, 0), 6);
    const socialTaxes = sumRows(allRows, ['SocialTaxes', 'socialTaxes']);
    const actualNetLabor = round(basisTotalCost - basisSocialCost, 6);
    const actualLaborTotal = round(actualNetLabor + socialTaxes, 6);

    return sourceResult('LEGACY_VERIFIED', 'ek_v3_legacy_fitterhours', {
      rows: allRows.length,
      actual_hours: actualHours,
      raw_hours: rawHours,
      other_hours: otherHours,
      basis_total_cost: basisTotalCost,
      basis_hours_social_cost: basisSocialCost,
      actual_net_labor: actualNetLabor,
      social_additions: socialTaxes,
      actual_labor_total: actualLaborTotal,
    });
  } catch (error) {
    return sourceResult('UNRESOLVED', 'ek_v3_legacy_fitterhours', { rows: 0, error: compactError(error) });
  }
}

function createIgvaPocEkClient(config, options = {}) {
  const fetchImpl = options.fetchImpl || global.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch_impl_required');
  }

  return {
    readExpectedLatest: (ekProjectId) => readExpectedLatest(fetchImpl, config, ekProjectId),
    readBudget: (ekProjectId) => readBudget(fetchImpl, config, ekProjectId),
    readExpectedHistory: (ekProjectId) => readExpectedHistory(fetchImpl, config, ekProjectId),
    readActualTurnover: (ekProjectId) => readActualTurnover(fetchImpl, config, ekProjectId),
    readPurchaseInvoiceLinesByProject: (ekProjectId) => readPurchaseInvoiceLinesByProject(fetchImpl, config, ekProjectId),
    readLegacyFitterhours: (ekProjectId) => readLegacyFitterhours(fetchImpl, config, ekProjectId),
  };
}

module.exports = {
  createIgvaPocEkClient,
  resolveTenantEkConfig,
  _test: {
    findRows,
    firstObject,
    pickNumber,
    pickOptionalNumber,
    readExpectedHistory,
    readActualTurnover,
    readPurchaseInvoiceLinesByProject,
    readLegacyFitterhours,
  },
};
