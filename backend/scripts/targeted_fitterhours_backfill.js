'use strict';

/*
 * EK ProjectID-targeted fitterhours backfill dry-run.
 *
 * Phase 1 is read-only by design:
 * - Calls only /api/v3.0/fitterhours with searchAttribute=ProjectID.
 * - Resolves one EK ProjectID to one FD project via project_masterdata_v4.
 * - Compares returned rows against existing fitter_hour rows.
 * - Does not insert, update, delete, enqueue sync jobs, or touch sync state.
 */

const crypto = require('crypto');
const path = require('path');
const { Pool } = require('pg');

require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const JOB_NAME = 'project-targeted-fitterhours-backfill';
const DEFAULT_PAGE_SIZE = 1000;

function usage() {
  return [
    'Usage:',
    '  node scripts/targeted_fitterhours_backfill.js --tenant hoyrup-clemmensen --ek-project-id 19687 --dry-run',
    '',
    'Options:',
    '  --tenant <slug-or-domain>  Tenant slug or tenant domain.',
    '  --ek-project-id <id>       EK internal ProjectID.',
    '  --dry-run                 Required in phase 1.',
    '  --page-size <n>           EK page size. Default 1000.',
    '  --max-pages <n>           Optional safety cap for test runs.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    tenant: null,
    ekProjectId: null,
    dryRun: false,
    pageSize: DEFAULT_PAGE_SIZE,
    maxPages: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tenant') {
      args.tenant = argv[++i] || null;
    } else if (arg === '--ek-project-id') {
      args.ekProjectId = argv[++i] || null;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--page-size') {
      args.pageSize = Number(argv[++i]);
    } else if (arg === '--max-pages') {
      args.maxPages = Number(argv[++i]);
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.tenant || !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(String(args.tenant).trim())) {
    throw new Error('Provide --tenant as a tenant slug or domain.');
  }
  if (!args.ekProjectId || !/^\d+$/.test(String(args.ekProjectId).trim())) {
    throw new Error('Provide --ek-project-id as a numeric EK ProjectID.');
  }
  if (!args.dryRun) {
    throw new Error(`${JOB_NAME} supports only --dry-run in phase 1.`);
  }
  if (!Number.isInteger(args.pageSize) || args.pageSize <= 0 || args.pageSize > 1000) {
    throw new Error('--page-size must be an integer between 1 and 1000.');
  }
  if (args.maxPages != null && (!Number.isInteger(args.maxPages) || args.maxPages <= 0)) {
    throw new Error('--max-pages must be a positive integer.');
  }

  return args;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function encryptionKey() {
  return crypto.createHash('sha256').update(requiredEnv('JWT_SECRET')).digest();
}

function decryptSecret(cipherText) {
  const [ivBase64, tagBase64, encryptedBase64] = String(cipherText || '').split('.');
  if (!ivBase64 || !tagBase64 || !encryptedBase64) {
    throw new Error('Invalid encrypted EK API key format');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivBase64, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagBase64, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

function buildPool() {
  const databaseUrl = requiredEnv('DATABASE_URL');
  const usesLocalDb = /127\.0\.0\.1|localhost/i.test(databaseUrl);
  return new Pool({
    connectionString: databaseUrl,
    ssl: usesLocalDb ? false : { rejectUnauthorized: false },
  });
}

function normalizeBase(baseUrl) {
  const parsed = new URL(String(baseUrl || '').trim());
  const cleanPath = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${cleanPath}`;
}

function buildFitterhoursEndpoint(baseUrl) {
  return `${normalizeBase(baseUrl)}/api/v3.0/fitterhours`.replace(/([^:]\/)(\/+)/g, '$1');
}

function pickAny(raw, keys) {
  for (const key of keys) {
    if (raw && Object.prototype.hasOwnProperty.call(raw, key)) {
      const value = raw[key];
      if (value !== undefined) return value;
    }
  }
  return null;
}

function asNullableText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function asNullableNumeric(value) {
  if (value == null || value === '') return null;
  const normalized = typeof value === 'string' ? value.replace(',', '.') : value;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function asNullableTimestamp(value) {
  if (value == null || value === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function parseTimestampCandidate(value) {
  const parsed = asNullableTimestamp(value);
  return parsed ? new Date(parsed).getTime() : null;
}

function pickFitterHourDateIso(raw) {
  return asNullableTimestamp(
    pickAny(raw, [
      'Date',
      'date',
      'WorkDate',
      'workDate',
      'HourDate',
      'hourDate',
      'RegistrationDate',
      'registrationDate',
      'StartDate',
      'startDate',
      'EndDate',
      'endDate',
    ])
  );
}

function parsePagedPayload(payload) {
  let rows = [];
  let nextPage = null;
  let total = null;

  if (Array.isArray(payload)) {
    rows = payload;
  } else if (payload && Array.isArray(payload.data)) {
    if (payload.data.length > 0 && payload.data[0] && Array.isArray(payload.data[0].data)) {
      rows = payload.data[0].data;
      nextPage = payload.data[0].nextPage ?? null;
      total = payload.data[0].total ?? payload.data[0].Total ?? null;
    } else {
      rows = payload.data;
    }
  } else if (payload && payload.data && Array.isArray(payload.data.items)) {
    rows = payload.data.items;
  } else if (payload && Array.isArray(payload.items)) {
    rows = payload.items;
  } else if (payload && payload.result && Array.isArray(payload.result)) {
    rows = payload.result;
  }

  if (nextPage == null && payload && typeof payload.nextPage !== 'undefined') {
    nextPage = payload.nextPage;
  }
  if (nextPage == null && payload && payload.pagination && typeof payload.pagination.nextPage !== 'undefined') {
    nextPage = payload.pagination.nextPage;
  }
  if (total == null && payload && typeof payload.total !== 'undefined') {
    total = payload.total;
  }
  if (total == null && payload && payload.pagination && typeof payload.pagination.total !== 'undefined') {
    total = payload.pagination.total;
  }

  const normalizedTotal = total == null ? null : Number(total);
  return {
    rows: Array.isArray(rows) ? rows.filter(Boolean) : [],
    nextPage: nextPage == null ? null : Number(nextPage),
    total: Number.isFinite(normalizedTotal) ? normalizedTotal : null,
  };
}

function mapFitterHourRow(raw, { expectedEkProjectId }) {
  if (!raw || typeof raw !== 'object') return null;

  const externalProjectRef = asNullableText(
    pickAny(raw, ['ProjectReference', 'projectReference', 'ExternalProjectRef', 'externalProjectRef'])
  );
  const projectId = asNullableText(
    pickAny(raw, ['ProjectID', 'ProjectId', 'projectID', 'projectId'])
  );
  if (String(projectId || '').trim() !== String(expectedEkProjectId)) {
    return null;
  }

  const workDate = pickFitterHourDateIso(raw);
  const registrationDate = asNullableTimestamp(
    pickAny(raw, ['RegistrationDate', 'registrationDate', 'CreatedDate', 'createdDate', 'UpdatedDate', 'updatedDate'])
  );
  const effectiveDate = workDate || registrationDate;
  if (parseTimestampCandidate(effectiveDate) == null) {
    return null;
  }

  const fitterHourId = asNullableText(
    pickAny(raw, ['FitterHourID', 'FitterHourId', 'fitterHourID', 'fitterHourId', 'ID', 'Id', 'id'])
  );
  const fitterId = asNullableText(
    pickAny(raw, ['FitterID', 'FitterId', 'fitterID', 'fitterId', 'UserID', 'UserId', 'userID', 'userId'])
  );
  const fitterUsername = asNullableText(
    pickAny(raw, ['Username', 'username', 'Initials', 'initials', 'FitterUsername', 'fitterUsername'])
  );
  const fitterSalaryId = asNullableText(
    pickAny(raw, ['FitterSalaryID', 'FitterSalaryId', 'fitterSalaryID', 'fitterSalaryId', 'SalaryID', 'SalaryId', 'salaryID', 'salaryId'])
  );
  const fitterReference = asNullableText(
    pickAny(raw, ['FitterReferenceNumber', 'fitterReferenceNumber', 'OldReference', 'oldReference', 'FitterReference', 'fitterReference'])
  );
  const fitterCategoryId = asNullableText(
    pickAny(raw, [
      'FitterCategoryID',
      'FitterCategoryId',
      'fitterCategoryID',
      'fitterCategoryId',
      'CategoryID',
      'CategoryId',
      'categoryID',
      'categoryId',
    ])
  );
  const fitterCategoryReference = asNullableText(
    pickAny(raw, ['FitterCategoryReference', 'fitterCategoryReference', 'CategoryReference', 'categoryReference'])
  );
  const hours = asNullableNumeric(
    pickAny(raw, ['Hours', 'hours', 'NumberOfHours', 'numberOfHours', 'HourCount', 'hourCount', 'Quantity', 'quantity'])
  );
  const quantity = asNullableNumeric(pickAny(raw, ['Quantity', 'quantity', 'Amount', 'amount']));
  const unit = asNullableText(pickAny(raw, ['Unit', 'unit']));
  const note = asNullableText(pickAny(raw, ['Note', 'note', 'Text', 'text', 'Comment', 'comment']));
  const description = asNullableText(
    pickAny(raw, ['Description', 'description', 'CategoryName', 'categoryName', 'ProjectDescription', 'projectDescription'])
  );

  const sourceFingerprint = JSON.stringify({
    project: externalProjectRef,
    projectId,
    fitter: fitterId,
    fitterUsername,
    fitterSalaryId,
    fitterCategoryId,
    fitterCategoryReference,
    workDate,
    registrationDate,
    hours,
    quantity,
    note,
    description,
  });
  const sourceKey = fitterHourId
    ? `id:${fitterHourId}`
    : `fp:${crypto.createHash('sha256').update(sourceFingerprint).digest('hex')}`;

  return {
    sourceKey,
    fitterHourId,
    externalProjectRef,
    projectId,
    fitterId,
    fitterUsername,
    fitterSalaryId,
    fitterReference,
    fitterCategoryId,
    fitterCategoryReference,
    workDate,
    registrationDate,
    hours,
    quantity,
    unit,
    note,
    description,
    rawPayloadJson: raw,
  };
}

function comparableRow(row) {
  return {
    fitter_hour_id: row.fitterHourId,
    external_project_ref: row.externalProjectRef,
    project_id: row.projectId,
    fitter_id: row.fitterId,
    fitter_username: row.fitterUsername,
    fitter_salary_id: row.fitterSalaryId,
    fitter_reference: row.fitterReference,
    fitter_category_id: row.fitterCategoryId,
    fitter_category_reference: row.fitterCategoryReference,
    work_date: row.workDate,
    registration_date: row.registrationDate,
    hours: row.hours == null ? null : Number(row.hours),
    quantity: row.quantity == null ? null : Number(row.quantity),
    unit: row.unit,
    note: row.note,
    description: row.description,
  };
}

function normalizeComparableDbRow(row) {
  return {
    fitter_hour_id: row.fitter_hour_id,
    external_project_ref: row.external_project_ref,
    project_id: row.project_id,
    fitter_id: row.fitter_id,
    fitter_username: row.fitter_username,
    fitter_salary_id: row.fitter_salary_id,
    fitter_reference: row.fitter_reference,
    fitter_category_id: row.fitter_category_id,
    fitter_category_reference: row.fitter_category_reference,
    work_date: row.work_date ? new Date(row.work_date).toISOString() : null,
    registration_date: row.registration_date ? new Date(row.registration_date).toISOString() : null,
    hours: row.hours == null ? null : Number(row.hours),
    quantity: row.quantity == null ? null : Number(row.quantity),
    unit: row.unit,
    note: row.note,
    description: row.description,
  };
}

async function resolveTenantAndConfig(client, tenant) {
  const lookup = String(tenant || '').trim().toLowerCase();
  const { rows } = await client.query(
    `
      SELECT
        t.id AS tenant_id,
        t.slug,
        tc.ek_base_url,
        tc.ek_api_key_encrypted,
        tcs.config_snapshot
      FROM tenant t
      JOIN tenant_config tc ON tc.tenant_id = t.id
      LEFT JOIN LATERAL (
        SELECT config_snapshot
        FROM tenant_config_snapshot
        WHERE tenant_id = t.id
        ORDER BY changed_at DESC
        LIMIT 1
      ) tcs ON true
      WHERE lower(t.slug) = $1
         OR EXISTS (
           SELECT 1
           FROM tenant_domain td
           WHERE td.tenant_id = t.id
             AND lower(td.domain) = $1
         )
      LIMIT 1
    `,
    [lookup]
  );
  const row = rows[0] || null;
  if (!row) throw new Error('tenant_or_ek_config_not_found');

  return {
    tenantId: row.tenant_id,
    slug: row.slug,
    ekBaseUrl: row.ek_base_url,
    ekApiKey: decryptSecret(row.ek_api_key_encrypted),
    siteName: row.config_snapshot?.ek_site_name || row.slug || 'Ekstern',
  };
}

async function resolveProject(client, { tenantId, ekProjectId }) {
  const { rows } = await client.query(
    `
      SELECT
        pc.project_id,
        pc.external_project_ref,
        pc.is_closed,
        pc.is_internal AS project_core_is_internal,
        pm.ek_project_id,
        pm.is_internal AS masterdata_is_internal
      FROM project_masterdata_v4 pm
      JOIN project_core pc
        ON pc.tenant_id = pm.tenant_id
       AND pc.project_id = pm.project_id
      WHERE pm.tenant_id = $1
        AND pm.ek_project_id = $2::bigint
      ORDER BY pc.updated_at DESC
      LIMIT 2
    `,
    [tenantId, ekProjectId]
  );
  if (rows.length !== 1) {
    throw new Error(`expected_one_fd_project_for_ek_project_id:${ekProjectId}:found:${rows.length}`);
  }
  return rows[0];
}

async function fetchFitterhoursPage({ endpointBase, page, pageSize, headers, ekProjectId }) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  params.set('searchAttribute', 'ProjectID');
  params.set('search', String(ekProjectId));

  const response = await fetch(`${endpointBase}?${params.toString()}`, { method: 'GET', headers });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`E-Komplet targeted fitterhours request failed (${response.status}) ${body.slice(0, 300)}`);
  }
  return parsePagedPayload(await response.json());
}

async function fetchAllTargetedRows({ cfg, ekProjectId, pageSize, maxPages }) {
  const endpointBase = buildFitterhoursEndpoint(cfg.ekBaseUrl);
  const headers = {
    apikey: cfg.ekApiKey,
    siteName: cfg.siteName,
    Accept: 'application/json',
  };

  const allRows = [];
  let pages = 0;
  let remoteTotal = null;
  for (let page = 1; ; page += 1) {
    if (maxPages != null && page > maxPages) break;
    const parsed = await fetchFitterhoursPage({ endpointBase, page, pageSize, headers, ekProjectId });
    pages += 1;
    if (remoteTotal == null && parsed.total != null) remoteTotal = parsed.total;
    allRows.push(...parsed.rows);

    if (parsed.nextPage && Number(parsed.nextPage) > page) {
      continue;
    }
    if (parsed.rows.length < pageSize) {
      break;
    }
  }

  return {
    endpointBase,
    pages,
    rows: allRows,
    remoteTotal,
  };
}

async function loadExistingRows(client, { tenantId, fdProjectId, sourceKeys }) {
  const { rows: projectRows } = await client.query(
    `
      SELECT COUNT(*)::int AS count
      FROM fitter_hour
      WHERE tenant_id = $1
        AND fd_project_id = $2
    `,
    [tenantId, fdProjectId]
  );

  if (!sourceKeys.length) {
    return {
      existingForProject: Number(projectRows[0]?.count || 0),
      bySourceKey: new Map(),
    };
  }

  const { rows } = await client.query(
    `
      SELECT
        source_key,
        fitter_hour_id,
        external_project_ref,
        project_id,
        fitter_id,
        fitter_username,
        fitter_salary_id,
        fitter_reference,
        fitter_category_id,
        fitter_category_reference,
        work_date,
        registration_date,
        hours,
        quantity,
        unit,
        note,
        description
      FROM fitter_hour
      WHERE tenant_id = $1
        AND source_key = ANY($2::text[])
    `,
    [tenantId, sourceKeys]
  );

  return {
    existingForProject: Number(projectRows[0]?.count || 0),
    bySourceKey: new Map(rows.map((row) => [row.source_key, row])),
  };
}

function summarizeRows({ rawRows, mappedRows, existing }) {
  const uniqueEmployees = new Set();
  let totalHours = 0;
  let rowsWithNullHours = 0;
  let wouldInsert = 0;
  let wouldUpdate = 0;
  let wouldSkip = 0;

  for (const row of mappedRows) {
    if (row.hours == null) rowsWithNullHours += 1;
    else totalHours += Number(row.hours);

    const employeeKey = row.fitterId || row.fitterUsername || row.fitterSalaryId || row.fitterReference;
    if (employeeKey) uniqueEmployees.add(String(employeeKey));

    const existingRow = existing.bySourceKey.get(row.sourceKey);
    if (!existingRow) {
      wouldInsert += 1;
      continue;
    }

    const nextComparable = comparableRow(row);
    const existingComparable = normalizeComparableDbRow(existingRow);
    if (JSON.stringify(nextComparable) === JSON.stringify(existingComparable)) {
      wouldSkip += 1;
    } else {
      wouldUpdate += 1;
    }
  }

  return {
    ekRowsFetched: rawRows.length,
    mappedRows: mappedRows.length,
    filteredOutRows: rawRows.length - mappedRows.length,
    totalHours: Number(totalHours.toFixed(2)),
    rowsWithNullHours,
    uniqueEmployees: uniqueEmployees.size,
    existingMatchingRowsInFdProject: existing.existingForProject,
    existingRowsBySourceKey: existing.bySourceKey.size,
    wouldInsert,
    wouldUpdate,
    wouldSkip,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = buildPool();
  const client = await pool.connect();
  const startedAt = new Date();

  try {
    const cfg = await resolveTenantAndConfig(client, args.tenant);
    const project = await resolveProject(client, {
      tenantId: cfg.tenantId,
      ekProjectId: args.ekProjectId,
    });
    const fetched = await fetchAllTargetedRows({
      cfg,
      ekProjectId: args.ekProjectId,
      pageSize: args.pageSize,
      maxPages: args.maxPages,
    });
    const mappedRows = fetched.rows
      .map((row) => mapFitterHourRow(row, { expectedEkProjectId: args.ekProjectId }))
      .filter(Boolean);
    const existing = await loadExistingRows(client, {
      tenantId: cfg.tenantId,
      fdProjectId: project.project_id,
      sourceKeys: mappedRows.map((row) => row.sourceKey),
    });
    const summary = summarizeRows({
      rawRows: fetched.rows,
      mappedRows,
      existing,
    });

    console.log(JSON.stringify({
      event: 'targeted_fitterhours_backfill_dry_run',
      job: JOB_NAME,
      mode: 'dry-run',
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      tenant: cfg.slug,
      tenant_id: cfg.tenantId,
      ek_project_id: Number(args.ekProjectId),
      endpoint: '/api/v3.0/fitterhours',
      search_attribute: 'ProjectID',
      page_size: args.pageSize,
      pages: fetched.pages,
      remote_total: fetched.remoteTotal,
      project_match: {
        fd_project_id: project.project_id,
        external_project_ref: project.external_project_ref,
        ek_project_id: Number(project.ek_project_id),
        is_closed: project.is_closed,
        project_core_is_internal: project.project_core_is_internal,
        masterdata_is_internal: project.masterdata_is_internal,
      },
      summary,
      safety: {
        writes_enabled: false,
        apply_supported: false,
        deletes_enabled: false,
        bootstrap_enabled: false,
        sync_state_updates_enabled: false,
      },
      sample_source_keys: mappedRows.slice(0, 5).map((row) => row.sourceKey),
    }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: 'targeted_fitterhours_backfill_failed',
    job: JOB_NAME,
    error: error.message,
  }));
  process.exit(1);
});
