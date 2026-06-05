'use strict';

/*
 * EK ProjectID-targeted fitterhours backfill.
 *
 * Phase 1 apply is intentionally limited to the verified control case:
 * tenant=hoyrup-clemmensen, EK ProjectID=19687.
 *
 * - Calls only /api/v3.0/fitterhours with searchAttribute=ProjectID.
 * - Resolves one EK ProjectID to one FD project via project_masterdata_v4.
 * - Compares returned rows against existing fitter_hour rows before writes.
 * - Does not delete, enqueue sync jobs, run bootstrap, or touch sync state.
 */

const crypto = require('crypto');
const path = require('path');
const { Pool } = require('pg');

require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const JOB_NAME = 'project-targeted-fitterhours-backfill';
const DEFAULT_PAGE_SIZE = 1000;
const APPLY_ALLOWED_TENANT = 'hoyrup-clemmensen';
const APPLY_ALLOWED_EK_PROJECT_ID = '19687';

function usage() {
  return [
    'Usage:',
    '  node scripts/targeted_fitterhours_backfill.js --tenant hoyrup-clemmensen --ek-project-id 19687 --dry-run',
    '  node scripts/targeted_fitterhours_backfill.js --tenant hoyrup-clemmensen --ek-project-id 19687 --analyze',
    '  node scripts/targeted_fitterhours_backfill.js --tenant hoyrup-clemmensen --ek-project-id 19687 --apply --confirm APPLY:project-targeted-fitterhours-backfill:hoyrup-clemmensen:19687',
    '',
    'Options:',
    '  --tenant <slug-or-domain>  Tenant slug or tenant domain.',
    '  --ek-project-id <id>       EK internal ProjectID.',
    '  --dry-run                 Fetch and compare without writing.',
    '  --analyze                 Read-only breakdown of existing FD rows and project-hour candidate filtering.',
    '  --apply                   Upsert only the verified tenant/project control case.',
    '  --confirm <token>         Required for apply.',
    '  --page-size <n>           EK page size. Default 1000.',
    '  --max-pages <n>           Optional safety cap for test runs.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    tenant: null,
    ekProjectId: null,
    dryRun: false,
    analyze: false,
    apply: false,
    confirm: null,
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
    } else if (arg === '--analyze') {
      args.analyze = true;
    } else if (arg === '--apply') {
      args.apply = true;
    } else if (arg === '--confirm') {
      args.confirm = argv[++i] || null;
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
  const selectedModes = [args.dryRun, args.analyze, args.apply].filter(Boolean).length;
  if (selectedModes > 1) {
    throw new Error('Use only one of --dry-run, --analyze, or --apply.');
  }
  if (selectedModes === 0) {
    throw new Error(`Provide --dry-run, --analyze, or --apply for ${JOB_NAME}.`);
  }
  if (args.apply) {
    const tenant = String(args.tenant).trim().toLowerCase();
    const ekProjectId = String(args.ekProjectId).trim();
    const expectedConfirm = `APPLY:${JOB_NAME}:${tenant}:${ekProjectId}`;
    if (tenant !== APPLY_ALLOWED_TENANT || ekProjectId !== APPLY_ALLOWED_EK_PROJECT_ID) {
      throw new Error(`${JOB_NAME} apply is limited to ${APPLY_ALLOWED_TENANT}/${APPLY_ALLOWED_EK_PROJECT_ID} in this slice.`);
    }
    if (args.confirm !== expectedConfirm) {
      throw new Error(`Apply requires --confirm ${expectedConfirm}`);
    }
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

function getRawProjectId(raw) {
  return asNullableText(pickAny(raw, ['ProjectID', 'ProjectId', 'projectID', 'projectId']));
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
        fd_project_id,
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

async function upsertTargetedRows(client, { tenantId, fdProjectId, mappedRows }) {
  if (!mappedRows.length) {
    return { inserted: 0, updated: 0 };
  }

  let inserted = 0;
  let updated = 0;

  for (const chunk of chunkArray(mappedRows, 100)) {
    const values = [];
    const params = [];

    chunk.forEach((row, index) => {
      const base = index * 20;
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16}, $${base + 17}, $${base + 18}, $${base + 19}::jsonb, $${base + 20}, now())`
      );
      params.push(
        tenantId,
        row.sourceKey,
        row.fitterHourId,
        row.externalProjectRef,
        row.projectId,
        row.fitterId,
        row.fitterUsername,
        row.fitterSalaryId,
        row.fitterReference,
        row.fitterCategoryId,
        row.fitterCategoryReference,
        row.workDate,
        row.registrationDate,
        row.hours,
        row.quantity,
        row.unit,
        row.note,
        row.description,
        JSON.stringify(row.rawPayloadJson || {}),
        fdProjectId
      );
    });

    const { rows } = await client.query(
      `
        WITH upserted AS (
          INSERT INTO fitter_hour (
            tenant_id,
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
            description,
            raw_payload_json,
            fd_project_id,
            synced_at
          )
          VALUES ${values.join(',\n')}
          ON CONFLICT (tenant_id, source_key)
          DO UPDATE SET
            fitter_hour_id = EXCLUDED.fitter_hour_id,
            external_project_ref = EXCLUDED.external_project_ref,
            project_id = EXCLUDED.project_id,
            fitter_id = EXCLUDED.fitter_id,
            fitter_username = EXCLUDED.fitter_username,
            fitter_salary_id = EXCLUDED.fitter_salary_id,
            fitter_reference = EXCLUDED.fitter_reference,
            fitter_category_id = EXCLUDED.fitter_category_id,
            fitter_category_reference = EXCLUDED.fitter_category_reference,
            work_date = EXCLUDED.work_date,
            registration_date = EXCLUDED.registration_date,
            hours = EXCLUDED.hours,
            quantity = EXCLUDED.quantity,
            unit = EXCLUDED.unit,
            note = EXCLUDED.note,
            description = EXCLUDED.description,
            raw_payload_json = EXCLUDED.raw_payload_json,
            fd_project_id = EXCLUDED.fd_project_id,
            synced_at = EXCLUDED.synced_at,
            updated_at = now()
          RETURNING (xmax = 0) AS inserted
        )
        SELECT
          COUNT(*) FILTER (WHERE inserted)::int AS inserted,
          COUNT(*) FILTER (WHERE NOT inserted)::int AS updated
        FROM upserted
      `,
      params
    );

    inserted += Number(rows[0]?.inserted || 0);
    updated += Number(rows[0]?.updated || 0);
  }

  return { inserted, updated };
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function verifyProjectTotals(client, { tenantId, fdProjectId }) {
  const { rows } = await client.query(
    `
      SELECT
        COUNT(*)::int AS rows,
        COALESCE(SUM(hours), 0)::numeric AS total_hours,
        COUNT(DISTINCT COALESCE(fitter_id, fitter_username, fitter_salary_id, fitter_reference))::int AS unique_employees
      FROM fitter_hour
      WHERE tenant_id = $1
        AND fd_project_id = $2
    `,
    [tenantId, fdProjectId]
  );
  const row = rows[0] || {};
  return {
    rows: Number(row.rows || 0),
    totalHoursAfter: Number(Number(row.total_hours || 0).toFixed(2)),
    uniqueEmployeesAfter: Number(row.unique_employees || 0),
  };
}

function makeTotalSummary(row) {
  return {
    rows: Number(row?.rows || 0),
    hours: Number(Number(row?.hours || 0).toFixed(2)),
    uniqueEmployees: Number(row?.unique_employees || 0),
  };
}

function makeHours(value) {
  return Number(Number(value || 0).toFixed(2));
}

async function analyzeExistingProjectHours(client, { tenantId, fdProjectId }) {
  const sql = `
    WITH rows AS (
      SELECT
        fh.source_key,
        fh.fitter_hour_id,
        fh.external_project_ref,
        fh.project_id AS ek_project_id,
        fh.fitter_id,
        fh.fitter_username,
        fh.fitter_salary_id,
        fh.fitter_reference,
        COALESCE(f.name, fh.raw_payload_json ->> 'FitterName', fh.fitter_username, fh.fitter_id, 'Unknown fitter') AS fitter_name,
        fh.fitter_category_id,
        fh.fitter_category_reference,
        fc.reference AS category_reference,
        fc.description AS category_description,
        fc.display AS category_display,
        fh.work_date,
        fh.registration_date,
        fh.hours,
        fh.quantity,
        fh.unit,
        fh.note,
        fh.description AS row_description,
        COALESCE(fc.is_only_for_internal_projects, false) AS is_internal_only,
        COALESCE(fc.is_on_invoice, false) AS is_invoice_relevant,
        COALESCE(fh.hours, fh.quantity, 0)::numeric AS hour_value,
        lower(translate(trim(concat_ws(' ',
          fc.reference,
          fc.description,
          fh.raw_payload_json ->> 'CategoryName',
          fh.description,
          fh.note
        )), 'ÆØÅæøå', 'EOAeoa')) AS category_text_blob
      FROM fitter_hour fh
      LEFT JOIN fitter f
        ON f.tenant_id = fh.tenant_id
       AND f.fitter_id = fh.fitter_id
      LEFT JOIN fitter_category fc
        ON fc.tenant_id = fh.tenant_id
       AND (
         (fh.fitter_category_id IS NOT NULL AND fc.fitter_category_id = fh.fitter_category_id)
         OR
         (fh.fitter_category_reference IS NOT NULL AND fc.reference = fh.fitter_category_reference)
       )
      WHERE fh.tenant_id = $1
        AND fh.fd_project_id = $2
    ),
    evaluated AS (
      SELECT
        *,
        category_text_blob ~* '(ferie|syg|sygedag|sygdom|barsel|orlov|omsorg|hospital|barns|fri uden lon|fri u/lon|fritvalg|absence|leave)' AS is_absence_or_leave,
        category_text_blob ~* '(kursus|moede|mode|vaerksted|verksted|fri|intern)' AS is_non_project_activity,
        category_text_blob ~* '(tilleg|tillaeg|formandstilleg|formandstillaeg|stedtilleg|stedtillaeg)' AS is_allowance
      FROM rows
    ),
    classified AS (
      SELECT
        *,
        (
          is_internal_only = false
          AND is_absence_or_leave = false
          AND is_non_project_activity = false
          AND is_allowance = false
          AND is_invoice_relevant = true
        ) AS is_project_hour_candidate,
        ARRAY_REMOVE(ARRAY[
          CASE WHEN is_internal_only THEN 'internal_only' END,
          CASE WHEN is_absence_or_leave THEN 'absence_or_leave' END,
          CASE WHEN is_non_project_activity THEN 'non_project_activity' END,
          CASE WHEN is_allowance THEN 'allowance' END,
          CASE WHEN is_invoice_relevant = false THEN 'not_invoice_relevant' END
        ], NULL) AS filter_reasons
      FROM evaluated
    )
    SELECT jsonb_build_object(
      'totals', jsonb_build_object(
        'all', (
          SELECT jsonb_build_object(
            'rows', COUNT(*)::int,
            'hours', COALESCE(SUM(hour_value), 0)::numeric(14,2),
            'unique_employees', COUNT(DISTINCT COALESCE(fitter_id, fitter_username, fitter_salary_id, fitter_reference, fitter_name))::int
          )
          FROM classified
        ),
        'candidate', (
          SELECT jsonb_build_object(
            'rows', COUNT(*)::int,
            'hours', COALESCE(SUM(hour_value), 0)::numeric(14,2),
            'unique_employees', COUNT(DISTINCT COALESCE(fitter_id, fitter_username, fitter_salary_id, fitter_reference, fitter_name))::int
          )
          FROM classified
          WHERE is_project_hour_candidate
        ),
        'excluded', (
          SELECT jsonb_build_object(
            'rows', COUNT(*)::int,
            'hours', COALESCE(SUM(hour_value), 0)::numeric(14,2),
            'unique_employees', COUNT(DISTINCT COALESCE(fitter_id, fitter_username, fitter_salary_id, fitter_reference, fitter_name))::int
          )
          FROM classified
          WHERE NOT is_project_hour_candidate
        )
      ),
      'by_fitter', COALESCE((
        SELECT jsonb_agg(row_to_json(grouped) ORDER BY grouped.excluded_hours DESC, grouped.all_hours DESC, grouped.fitter_name ASC)
        FROM (
          SELECT
            COALESCE(fitter_id, fitter_username, fitter_salary_id, fitter_reference, lower(fitter_name)) AS fitter_key,
            MAX(fitter_id) AS fitter_id,
            MAX(fitter_username) AS fitter_username,
            MAX(fitter_salary_id) AS fitter_salary_id,
            MAX(fitter_reference) AS fitter_reference,
            fitter_name,
            COUNT(*)::int AS rows,
            COALESCE(SUM(hour_value), 0)::numeric(14,2) AS all_hours,
            COALESCE(SUM(hour_value) FILTER (WHERE is_project_hour_candidate), 0)::numeric(14,2) AS candidate_hours,
            COALESCE(SUM(hour_value) FILTER (WHERE NOT is_project_hour_candidate), 0)::numeric(14,2) AS excluded_hours,
            COALESCE(SUM(hour_value), 0)::numeric(14,2)
              - COALESCE(SUM(hour_value) FILTER (WHERE is_project_hour_candidate), 0)::numeric(14,2) AS difference_hours
          FROM classified
          GROUP BY COALESCE(fitter_id, fitter_username, fitter_salary_id, fitter_reference, lower(fitter_name)), fitter_name
        ) grouped
      ), '[]'::jsonb),
      'by_category', COALESCE((
        SELECT jsonb_agg(row_to_json(grouped) ORDER BY grouped.hours DESC, grouped.category_reference ASC NULLS LAST, grouped.category_description ASC NULLS LAST)
        FROM (
          SELECT
            fitter_category_id,
            fitter_category_reference,
            category_reference,
            category_description,
            category_display,
            unit,
            is_project_hour_candidate,
            filter_reasons,
            COUNT(*)::int AS rows,
            COALESCE(SUM(hour_value), 0)::numeric(14,2) AS hours
          FROM classified
          GROUP BY
            fitter_category_id,
            fitter_category_reference,
            category_reference,
            category_description,
            category_display,
            unit,
            is_project_hour_candidate,
            filter_reasons
        ) grouped
      ), '[]'::jsonb),
      'excluded_rows', COALESCE((
        SELECT jsonb_agg(row_to_json(filtered) ORDER BY filtered.fitter_name ASC, filtered.work_date ASC NULLS LAST, filtered.source_key ASC)
        FROM (
          SELECT
            fitter_name AS name,
            hour_value::numeric(14,2) AS hours,
            work_date,
            registration_date,
            fitter_category_id,
            fitter_category_reference,
            category_reference,
            category_description,
            category_display,
            fitter_salary_id AS salary_part,
            unit,
            source_key,
            filter_reasons
          FROM classified
          WHERE NOT is_project_hour_candidate
        ) filtered
      ), '[]'::jsonb)
    ) AS analysis
  `;

  const { rows } = await client.query(sql, [tenantId, fdProjectId]);
  const analysis = rows[0]?.analysis || {};
  const totals = analysis.totals || {};

  return {
    query: {
      source: 'fitter_hour joined to fitter and fitter_category',
      projectRelation: 'fitter_hour.fd_project_id = project_masterdata_v4.project_id / project_core.project_id',
      candidateLogic: [
        'is_internal_only = false',
        'absence/leave regex = false',
        'non-project activity regex = false',
        'allowance regex = false',
        'is_invoice_relevant = true',
      ],
    },
    totals: {
      all: makeTotalSummary(totals.all),
      candidate: makeTotalSummary(totals.candidate),
      excluded: makeTotalSummary(totals.excluded),
    },
    byFitter: (analysis.by_fitter || []).map((row) => ({
      ...row,
      all_hours: makeHours(row.all_hours),
      candidate_hours: makeHours(row.candidate_hours),
      excluded_hours: makeHours(row.excluded_hours),
      difference_hours: makeHours(row.difference_hours),
    })),
    byCategory: (analysis.by_category || []).map((row) => ({
      ...row,
      hours: makeHours(row.hours),
    })),
    excludedRows: (analysis.excluded_rows || []).map((row) => ({
      ...row,
      hours: makeHours(row.hours),
    })),
  };
}

function summarizeRows({ rawRows, mappedRows, existing, fdProjectId }) {
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

    if (classifyRowAction(row, existing, fdProjectId) === 'skip') {
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

function classifyRowAction(row, existing, fdProjectId) {
  const existingRow = existing.bySourceKey.get(row.sourceKey);
  if (!existingRow) {
    return 'insert';
  }
  if (String(existingRow.fd_project_id || '') !== String(fdProjectId || '')) {
    return 'update';
  }

  const nextComparable = comparableRow(row);
  const existingComparable = normalizeComparableDbRow(existingRow);
  return JSON.stringify(nextComparable) === JSON.stringify(existingComparable) ? 'skip' : 'update';
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
    if (args.analyze) {
      const analysis = await analyzeExistingProjectHours(client, {
        tenantId: cfg.tenantId,
        fdProjectId: project.project_id,
      });

      console.log(JSON.stringify({
        event: 'targeted_fitterhours_backfill_analyze',
        job: JOB_NAME,
        mode: 'analyze',
        started_at: startedAt.toISOString(),
        finished_at: new Date().toISOString(),
        tenant: cfg.slug,
        tenant_id: cfg.tenantId,
        ek_project_id: Number(args.ekProjectId),
        project_match: {
          fd_project_id: project.project_id,
          external_project_ref: project.external_project_ref,
          ek_project_id: Number(project.ek_project_id),
          is_closed: project.is_closed,
          project_core_is_internal: project.project_core_is_internal,
          masterdata_is_internal: project.masterdata_is_internal,
        },
        analysis,
        safety: {
          writes_enabled: false,
          ek_fetch_enabled: false,
          apply_supported: false,
          deletes_enabled: false,
          bootstrap_enabled: false,
          sync_state_updates_enabled: false,
        },
      }, null, 2));
      return;
    }

    const fetched = await fetchAllTargetedRows({
      cfg,
      ekProjectId: args.ekProjectId,
      pageSize: args.pageSize,
      maxPages: args.maxPages,
    });
    const mappedRows = fetched.rows
      .map((row) => mapFitterHourRow(row, { expectedEkProjectId: args.ekProjectId }))
      .filter(Boolean);
    const wrongProjectRows = fetched.rows
      .map((row, index) => ({ index, projectId: getRawProjectId(row) }))
      .filter((row) => String(row.projectId || '').trim() !== String(args.ekProjectId));
    if (wrongProjectRows.length) {
      throw new Error(`EK response included rows for other ProjectID values: ${JSON.stringify(wrongProjectRows.slice(0, 5))}`);
    }
    const existing = await loadExistingRows(client, {
      tenantId: cfg.tenantId,
      fdProjectId: project.project_id,
      sourceKeys: mappedRows.map((row) => row.sourceKey),
    });
    const summary = summarizeRows({
      rawRows: fetched.rows,
      mappedRows,
      existing,
      fdProjectId: project.project_id,
    });
    let applyResult = null;
    let verification = null;

    if (args.apply) {
      if (!project.project_id) {
        throw new Error('project_match_missing');
      }
      const rowsToApply = mappedRows.filter((row) => classifyRowAction(row, existing, project.project_id) !== 'skip');
      applyResult = await upsertTargetedRows(client, {
        tenantId: cfg.tenantId,
        fdProjectId: project.project_id,
        mappedRows: rowsToApply,
      });
      applyResult.skipped = mappedRows.length - rowsToApply.length;
      verification = await verifyProjectTotals(client, {
        tenantId: cfg.tenantId,
        fdProjectId: project.project_id,
      });
    }

    console.log(JSON.stringify({
      event: args.apply ? 'targeted_fitterhours_backfill_apply' : 'targeted_fitterhours_backfill_dry_run',
      job: JOB_NAME,
      mode: args.apply ? 'apply' : 'dry-run',
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
      apply_result: applyResult,
      verification,
      safety: {
        writes_enabled: Boolean(args.apply),
        apply_supported: true,
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
