'use strict';

/*
 * Tenant-scoped EK v4 projects resync.
 *
 * Purpose:
 * - Revisit only EK v4 LIST project rows.
 * - Persist project-level isIntern / IsInternal into FD is_internal columns.
 *
 * Safety:
 * - Does not enqueue sync_job.
 * - Does not reset sync_endpoint_state.
 * - Does not call fitterhours, bootstrap, v3 projects, or generic endpoints.
 * - Does not create project_core rows; only updates existing project rows by
 *   tenant + EK ProjectID (project_masterdata_v4.ek_project_id), with project
 *   reference as a secondary fallback, and mirrors source metadata in
 *   project_masterdata_v4.
 */

const crypto = require('crypto');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const DEFAULT_PAGE_SIZE = 200;
const CONTROL_REFS = ['26794', '80356', '80491'];

function usage() {
  return [
    'Usage:',
    '  node scripts/resync_projects_v4_only.js --tenant hoyrup-clemmensen --dry-run',
    '  node scripts/resync_projects_v4_only.js --tenant hoyrup-clemmensen --apply',
    '',
    'Options:',
    '  --tenant <slug-or-domain>  Tenant slug or tenant domain.',
    '  --tenant-id <uuid>         Tenant id.',
    '  --dry-run                 Fetch/map v4 rows and show counts without writing. Default.',
    '  --apply                   Persist is_internal updates.',
    '  --status-only             Only show current DB distribution/control cases.',
    '  --page-size <n>           EK page size. Default 200.',
    '  --max-pages <n>           Optional safety cap for test runs.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    tenant: null,
    tenantId: null,
    apply: false,
    dryRun: false,
    statusOnly: false,
    pageSize: DEFAULT_PAGE_SIZE,
    maxPages: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tenant') {
      args.tenant = argv[++i] || null;
    } else if (arg === '--tenant-id') {
      args.tenantId = argv[++i] || null;
    } else if (arg === '--apply') {
      args.apply = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--status-only') {
      args.statusOnly = true;
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

  if (!args.tenant && !args.tenantId) {
    throw new Error('Provide --tenant or --tenant-id.');
  }
  if (!Number.isInteger(args.pageSize) || args.pageSize <= 0 || args.pageSize > 1000) {
    throw new Error('--page-size must be an integer between 1 and 1000.');
  }
  if (args.maxPages != null && (!Number.isInteger(args.maxPages) || args.maxPages <= 0)) {
    throw new Error('--max-pages must be a positive integer.');
  }

  args.dryRun = !args.apply || args.dryRun;
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

function normalizeBase(baseUrl) {
  const parsed = new URL(String(baseUrl || '').trim());
  const cleanPath = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${cleanPath}`;
}

function buildProjectsV4Endpoint(baseUrl) {
  return `${normalizeBase(baseUrl)}/api/v4.0/projects`.replace(/([^:]\/)(\/+)/g, '$1');
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

function asNullableBoolean(value) {
  if (value == null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(text)) return true;
  if (['false', '0', 'no', 'n'].includes(text)) return false;
  return null;
}

function asNullableTimestamp(value) {
  if (value == null || value === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function pickBooleanValue(raw, keys) {
  return asNullableBoolean(pickAny(raw, keys));
}

function pickIntegerText(raw, keys) {
  const value = pickAny(raw, keys);
  if (value == null || value === '') return null;
  const text = String(value).trim();
  return /^\d+$/.test(text) ? text : null;
}

function parsePagedPayload(payload) {
  let rows = [];

  if (Array.isArray(payload)) {
    rows = payload;
  } else if (payload && Array.isArray(payload.data)) {
    if (payload.data.length > 0 && payload.data[0] && Array.isArray(payload.data[0].data)) {
      rows = payload.data[0].data;
    } else {
      rows = payload.data;
    }
  } else if (payload && Array.isArray(payload.items)) {
    rows = payload.items;
  } else if (payload && Array.isArray(payload.result)) {
    rows = payload.result;
  }

  return rows.filter(Boolean);
}

function mapProjectV4Row(raw) {
  const externalProjectRef = asNullableText(
    pickAny(raw, [
      'reference',
      'Reference',
      'projectReference',
      'ProjectReference',
      'projectNumber',
      'ProjectNumber',
      'projectNo',
      'ProjectNo',
    ])
  );
  const sourceProjectId = pickIntegerText(raw, ['ProjectID', 'ProjectId', 'projectID', 'projectId']);
  if (!externalProjectRef && !sourceProjectId) return null;

  return {
    externalProjectRef,
    sourceProjectId,
    isInternal: pickBooleanValue(raw, ['isIntern', 'IsIntern', 'isInternal', 'IsInternal']),
    sourceUpdatedAt: asNullableTimestamp(pickAny(raw, ['updatedDate', 'UpdatedDate'])),
  };
}

function extractSiteName(snapshot) {
  const value = snapshot && snapshot.ek_site_name;
  return value && String(value).trim() ? String(value).trim() : 'Ekstern';
}

async function fetchProjectsPage({ endpointBase, page, pageSize, headers }) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));

  const url = `${endpointBase}?${params.toString()}`;
  const response = await fetch(url, { method: 'GET', headers });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`E-Komplet v4 projects request failed (${response.status}) ${body.slice(0, 300)}`);
  }
  return parsePagedPayload(await response.json());
}

function buildPool() {
  const databaseUrl = requiredEnv('DATABASE_URL');
  const usesLocalDb = /127\.0\.0\.1|localhost/i.test(databaseUrl);
  return new Pool({
    connectionString: databaseUrl,
    ssl: usesLocalDb ? false : { rejectUnauthorized: false },
  });
}

async function resolveTenantAndConfig(client, { tenant, tenantId }) {
  const params = [];
  let whereClause;
  if (tenantId) {
    params.push(tenantId);
    whereClause = 't.id = $1';
  } else {
    params.push(String(tenant || '').trim().toLowerCase());
    whereClause = `
      (
        lower(t.slug) = $1
        OR EXISTS (
          SELECT 1
          FROM tenant_domain td
          WHERE td.tenant_id = t.id
            AND lower(td.domain) = $1
        )
      )
    `;
  }

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
      WHERE ${whereClause}
      LIMIT 1
    `,
    params
  );

  const row = rows[0] || null;
  if (!row) throw new Error('tenant_or_ek_config_not_found');

  return {
    tenantId: row.tenant_id,
    slug: row.slug,
    ekBaseUrl: row.ek_base_url,
    ekApiKey: decryptSecret(row.ek_api_key_encrypted),
    siteName: extractSiteName(row.config_snapshot || {}),
  };
}

async function getDistribution(client, tenantId) {
  const { rows } = await client.query(
    `
      SELECT
        COALESCE(is_closed, false) AS is_closed,
        is_internal,
        COUNT(*)::int AS project_count
      FROM project_core
      WHERE tenant_id = $1
      GROUP BY COALESCE(is_closed, false), is_internal
      ORDER BY is_closed, is_internal NULLS LAST
    `,
    [tenantId]
  );
  return rows;
}

async function getControlCases(client, tenantId) {
  const { rows } = await client.query(
    `
      SELECT
        pc.external_project_ref,
        pc.project_id,
        pc.is_closed,
        pc.is_internal AS project_core_is_internal,
        pm.ek_project_id,
        pm.is_internal AS masterdata_is_internal,
        pm.source_updated_at
      FROM project_core pc
      LEFT JOIN project_masterdata_v4 pm
        ON pm.tenant_id = pc.tenant_id
       AND pm.project_id = pc.project_id
      WHERE pc.tenant_id = $1
        AND pc.external_project_ref = ANY($2::text[])
      ORDER BY pc.external_project_ref
    `,
    [tenantId, CONTROL_REFS]
  );
  return rows;
}

function emptySummary() {
  return {
    pages: 0,
    fetched: 0,
    mapped: 0,
    matchedExistingProjects: 0,
    matchedByEkProjectId: 0,
    matchedByReference: 0,
    unmatchedExistingProjects: 0,
    coreUpdated: 0,
    masterdataUpserted: 0,
    missingExternalRef: 0,
    missingSourceProjectId: 0,
    missingIdentity: 0,
    isInternalTrue: 0,
    isInternalFalse: 0,
    isInternalNull: 0,
    unmatchedEkRowsSample: [],
    controlCasePreview: [],
    errors: [],
  };
}

function countMapped(summary, mappedRows) {
  for (const row of mappedRows) {
    if (!row) {
      summary.missingIdentity += 1;
      continue;
    }
    summary.mapped += 1;
    if (!row.externalProjectRef) summary.missingExternalRef += 1;
    if (!row.sourceProjectId) summary.missingSourceProjectId += 1;
    if (row.isInternal === true) summary.isInternalTrue += 1;
    else if (row.isInternal === false) summary.isInternalFalse += 1;
    else summary.isInternalNull += 1;
  }
}

function addUnmatchedSample(summary, sampleRows) {
  const remaining = Math.max(0, 10 - summary.unmatchedEkRowsSample.length);
  if (remaining <= 0) return;
  summary.unmatchedEkRowsSample.push(...sampleRows.slice(0, remaining));
}

function addControlPreview(summary, previewRows) {
  const byRef = new Map(summary.controlCasePreview.map((row) => [row.external_project_ref, row]));
  for (const row of previewRows) {
    byRef.set(row.external_project_ref, row);
  }
  summary.controlCasePreview = Array.from(byRef.values()).sort((a, b) => {
    return String(a.external_project_ref || '').localeCompare(String(b.external_project_ref || ''));
  });
}

function buildInputChunk(rows) {
  const values = [];
  const params = [];
  rows.forEach((row, index) => {
    const offset = index * 5 + 2;
    values.push(`($${offset}::int, $${offset + 1}::text, $${offset + 2}::text, $${offset + 3}::boolean, $${offset + 4}::timestamptz)`);
    params.push(
      index,
      row.externalProjectRef,
      row.sourceProjectId,
      row.isInternal,
      row.sourceUpdatedAt
    );
  });
  return { values, params };
}

function matchedCteSql() {
  return `
    ek_project_id_matches AS (
      SELECT
        ir.input_index,
        pc.project_id,
        pc.tenant_id,
        pc.external_project_ref AS fd_external_project_ref,
        ir.external_project_ref,
        ir.source_project_id,
        ir.is_internal,
        ir.source_updated_at,
        'ek_project_id'::text AS match_type,
        1 AS match_rank
      FROM input_rows ir
      JOIN project_masterdata_v4 pm
        ON pm.tenant_id = $1
       AND ir.source_project_id IS NOT NULL
       AND pm.ek_project_id = NULLIF(btrim(ir.source_project_id), '')::bigint
      JOIN project_core pc
        ON pc.tenant_id = pm.tenant_id
       AND pc.project_id = pm.project_id
    ),
    reference_matches AS (
      SELECT
        ir.input_index,
        pc.project_id,
        pc.tenant_id,
        pc.external_project_ref AS fd_external_project_ref,
        ir.external_project_ref,
        ir.source_project_id,
        ir.is_internal,
        ir.source_updated_at,
        'external_project_ref'::text AS match_type,
        2 AS match_rank
      FROM input_rows ir
      JOIN project_core pc
        ON pc.tenant_id = $1
       AND ir.external_project_ref IS NOT NULL
       AND lower(btrim(pc.external_project_ref)) = lower(btrim(ir.external_project_ref))
    ),
    all_matches AS (
      SELECT * FROM ek_project_id_matches
      UNION ALL
      SELECT * FROM reference_matches
    ),
    matched AS (
      SELECT DISTINCT ON (input_index)
        input_index,
        project_id,
        tenant_id,
        fd_external_project_ref,
        external_project_ref,
        source_project_id,
        is_internal,
        source_updated_at,
        match_type
      FROM all_matches
      ORDER BY input_index, match_rank
    )
  `;
}

async function analyzeMappedRows(client, { tenantId, mappedRows }) {
  const rows = mappedRows.filter(Boolean);
  if (!rows.length) {
    return {
      matchedExistingProjects: 0,
      matchedByEkProjectId: 0,
      matchedByReference: 0,
      unmatchedExistingProjects: 0,
      unmatchedEkRowsSample: [],
      controlCasePreview: [],
    };
  }

  let matchedExistingProjects = 0;
  let matchedByEkProjectId = 0;
  let matchedByReference = 0;
  let unmatchedExistingProjects = 0;
  const unmatchedEkRowsSample = [];
  const controlCasePreview = [];

  for (let start = 0; start < rows.length; start += 100) {
    const chunk = rows.slice(start, start + 100);
    const input = buildInputChunk(chunk);
    const params = [tenantId, ...input.params, CONTROL_REFS];
    const controlRefsParam = params.length;

    const { rows: resultRows } = await client.query(
      `
        WITH input_rows (
          input_index,
          external_project_ref,
          source_project_id,
          is_internal,
          source_updated_at
        ) AS (
          VALUES ${input.values.join(',\n')}
        ),
        ${matchedCteSql()},
        unmatched AS (
          SELECT
            ir.external_project_ref,
            ir.source_project_id,
            ir.is_internal,
            ir.source_updated_at
          FROM input_rows ir
          LEFT JOIN matched m ON m.input_index = ir.input_index
          WHERE m.input_index IS NULL
          ORDER BY ir.source_project_id NULLS LAST, ir.external_project_ref NULLS LAST
          LIMIT 10
        ),
        controls AS (
          SELECT
            pc.external_project_ref,
            pc.project_id,
            pc.is_internal AS current_project_core_is_internal,
            pm.ek_project_id,
            pm.is_internal AS current_masterdata_is_internal,
            m.is_internal AS incoming_is_internal,
            m.match_type
          FROM project_core pc
          LEFT JOIN project_masterdata_v4 pm
            ON pm.tenant_id = pc.tenant_id
           AND pm.project_id = pc.project_id
          LEFT JOIN matched m
            ON m.tenant_id = pc.tenant_id
           AND m.project_id = pc.project_id
          WHERE pc.tenant_id = $1
            AND pc.external_project_ref = ANY($${controlRefsParam}::text[])
            AND m.project_id IS NOT NULL
        )
        SELECT
          (SELECT COUNT(*)::int FROM matched) AS matched_existing_projects,
          (SELECT COUNT(*)::int FROM matched WHERE match_type = 'ek_project_id') AS matched_by_ek_project_id,
          (SELECT COUNT(*)::int FROM matched WHERE match_type = 'external_project_ref') AS matched_by_reference,
          (SELECT COUNT(*)::int FROM input_rows ir LEFT JOIN matched m ON m.input_index = ir.input_index WHERE m.input_index IS NULL) AS unmatched_existing_projects,
          COALESCE((SELECT jsonb_agg(to_jsonb(unmatched)) FROM unmatched), '[]'::jsonb) AS unmatched_sample,
          COALESCE((SELECT jsonb_agg(to_jsonb(controls)) FROM controls), '[]'::jsonb) AS control_preview
      `,
      params
    );

    const result = resultRows[0] || {};
    matchedExistingProjects += Number(result.matched_existing_projects || 0);
    matchedByEkProjectId += Number(result.matched_by_ek_project_id || 0);
    matchedByReference += Number(result.matched_by_reference || 0);
    unmatchedExistingProjects += Number(result.unmatched_existing_projects || 0);
    if (Array.isArray(result.unmatched_sample) && unmatchedEkRowsSample.length < 10) {
      unmatchedEkRowsSample.push(...result.unmatched_sample.slice(0, 10 - unmatchedEkRowsSample.length));
    }
    if (Array.isArray(result.control_preview)) {
      controlCasePreview.push(...result.control_preview);
    }
  }

  return {
    matchedExistingProjects,
    matchedByEkProjectId,
    matchedByReference,
    unmatchedExistingProjects,
    unmatchedEkRowsSample,
    controlCasePreview,
  };
}

async function persistMappedRows(client, { tenantId, mappedRows }) {
  const rows = mappedRows.filter(Boolean);
  if (!rows.length) {
    return {
      matchedExistingProjects: 0,
      matchedByEkProjectId: 0,
      matchedByReference: 0,
      unmatchedExistingProjects: 0,
      coreUpdated: 0,
      masterdataUpserted: 0,
      unmatchedEkRowsSample: [],
      controlCasePreview: [],
    };
  }

  let matchedExistingProjects = 0;
  let matchedByEkProjectId = 0;
  let matchedByReference = 0;
  let unmatchedExistingProjects = 0;
  let coreUpdated = 0;
  let masterdataUpserted = 0;
  const unmatchedEkRowsSample = [];
  const controlCasePreview = [];

  for (let start = 0; start < rows.length; start += 100) {
    const chunk = rows.slice(start, start + 100);
    const input = buildInputChunk(chunk);
    const params = [tenantId, ...input.params, CONTROL_REFS];
    const controlRefsParam = params.length;

    const { rows: resultRows } = await client.query(
      `
        WITH input_rows (
          input_index,
          external_project_ref,
          source_project_id,
          is_internal,
          source_updated_at
        ) AS (
          VALUES ${input.values.join(',\n')}
        ),
        ${matchedCteSql()},
        updated_core AS (
          UPDATE project_core pc
          SET
            is_internal = matched.is_internal,
            updated_at = now()
          FROM matched
          WHERE pc.tenant_id = matched.tenant_id
            AND pc.project_id = matched.project_id
            AND matched.is_internal IS NOT NULL
            AND pc.is_internal IS DISTINCT FROM matched.is_internal
          RETURNING pc.project_id
        ),
        unmatched AS (
          SELECT
            ir.external_project_ref,
            ir.source_project_id,
            ir.is_internal,
            ir.source_updated_at
          FROM input_rows ir
          LEFT JOIN matched m ON m.input_index = ir.input_index
          WHERE m.input_index IS NULL
          ORDER BY ir.source_project_id NULLS LAST, ir.external_project_ref NULLS LAST
          LIMIT 10
        ),
        controls AS (
          SELECT
            pc.external_project_ref,
            pc.project_id,
            pc.is_internal AS current_project_core_is_internal,
            pm.ek_project_id,
            pm.is_internal AS current_masterdata_is_internal,
            m.is_internal AS incoming_is_internal,
            m.match_type
          FROM project_core pc
          LEFT JOIN project_masterdata_v4 pm
            ON pm.tenant_id = pc.tenant_id
           AND pm.project_id = pc.project_id
          LEFT JOIN matched m
            ON m.tenant_id = pc.tenant_id
           AND m.project_id = pc.project_id
          WHERE pc.tenant_id = $1
            AND pc.external_project_ref = ANY($${controlRefsParam}::text[])
            AND m.project_id IS NOT NULL
        ),
        upserted_masterdata AS (
          INSERT INTO project_masterdata_v4 (
            project_id,
            tenant_id,
            ek_project_id,
            is_internal,
            source_updated_at
          )
          SELECT DISTINCT ON (project_id)
            project_id,
            tenant_id,
            NULLIF(btrim(source_project_id), '')::bigint,
            is_internal,
            source_updated_at::timestamptz
          FROM matched
          WHERE source_project_id IS NOT NULL
             OR is_internal IS NOT NULL
             OR source_updated_at IS NOT NULL
          ON CONFLICT (project_id)
          DO UPDATE SET
            ek_project_id = COALESCE(EXCLUDED.ek_project_id, project_masterdata_v4.ek_project_id),
            is_internal = COALESCE(EXCLUDED.is_internal, project_masterdata_v4.is_internal),
            source_updated_at = COALESCE(EXCLUDED.source_updated_at, project_masterdata_v4.source_updated_at),
            updated_at = now()
          RETURNING project_id
        )
        SELECT
          (SELECT COUNT(*)::int FROM matched) AS matched_existing_projects,
          (SELECT COUNT(*)::int FROM matched WHERE match_type = 'ek_project_id') AS matched_by_ek_project_id,
          (SELECT COUNT(*)::int FROM matched WHERE match_type = 'external_project_ref') AS matched_by_reference,
          (SELECT COUNT(*)::int FROM input_rows ir LEFT JOIN matched m ON m.input_index = ir.input_index WHERE m.input_index IS NULL) AS unmatched_existing_projects,
          (SELECT COUNT(*)::int FROM updated_core) AS core_updated,
          (SELECT COUNT(*)::int FROM upserted_masterdata) AS masterdata_upserted,
          COALESCE((SELECT jsonb_agg(to_jsonb(unmatched)) FROM unmatched), '[]'::jsonb) AS unmatched_sample,
          COALESCE((SELECT jsonb_agg(to_jsonb(controls)) FROM controls), '[]'::jsonb) AS control_preview
      `,
      params
    );

    const result = resultRows[0] || {};
    matchedExistingProjects += Number(result.matched_existing_projects || 0);
    matchedByEkProjectId += Number(result.matched_by_ek_project_id || 0);
    matchedByReference += Number(result.matched_by_reference || 0);
    unmatchedExistingProjects += Number(result.unmatched_existing_projects || 0);
    coreUpdated += Number(result.core_updated || 0);
    masterdataUpserted += Number(result.masterdata_upserted || 0);
    if (Array.isArray(result.unmatched_sample) && unmatchedEkRowsSample.length < 10) {
      unmatchedEkRowsSample.push(...result.unmatched_sample.slice(0, 10 - unmatchedEkRowsSample.length));
    }
    if (Array.isArray(result.control_preview)) {
      controlCasePreview.push(...result.control_preview);
    }
  }

  return {
    matchedExistingProjects,
    matchedByEkProjectId,
    matchedByReference,
    unmatchedExistingProjects,
    coreUpdated,
    masterdataUpserted,
    unmatchedEkRowsSample,
    controlCasePreview,
  };
}

function printJson(label, value) {
  console.log(`${label}:`);
  console.log(JSON.stringify(value, null, 2));
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const pool = buildPool();

  try {
    const client = await pool.connect();
    try {
      const cfg = await resolveTenantAndConfig(client, args);
      console.log(`tenant=${cfg.slug} tenant_id=${cfg.tenantId}`);
      console.log(`mode=${args.statusOnly ? 'status-only' : args.apply ? 'apply' : 'dry-run'}`);

      printJson('distribution_before', await getDistribution(client, cfg.tenantId));
      printJson('control_cases_before', await getControlCases(client, cfg.tenantId));

      if (args.statusOnly) {
        return;
      }

      const endpointBase = buildProjectsV4Endpoint(cfg.ekBaseUrl);
      const headers = {
        apikey: cfg.ekApiKey,
        siteName: cfg.siteName,
        Accept: 'application/json',
      };
      const summary = emptySummary();

      for (let page = 1; ; page += 1) {
        if (args.maxPages != null && page > args.maxPages) break;

        const rawRows = await fetchProjectsPage({
          endpointBase,
          page,
          pageSize: args.pageSize,
          headers,
        });

        summary.pages += 1;
        summary.fetched += rawRows.length;
        const mappedRows = rawRows.map((row) => mapProjectV4Row(row));
        countMapped(summary, mappedRows);

        if (args.apply) {
          await client.query('BEGIN');
          try {
            const persisted = await persistMappedRows(client, {
              tenantId: cfg.tenantId,
              mappedRows,
            });
            await client.query('COMMIT');
            summary.matchedExistingProjects += persisted.matchedExistingProjects;
            summary.matchedByEkProjectId += persisted.matchedByEkProjectId;
            summary.matchedByReference += persisted.matchedByReference;
            summary.unmatchedExistingProjects += persisted.unmatchedExistingProjects;
            summary.coreUpdated += persisted.coreUpdated;
            summary.masterdataUpserted += persisted.masterdataUpserted;
            addUnmatchedSample(summary, persisted.unmatchedEkRowsSample);
            addControlPreview(summary, persisted.controlCasePreview);
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          }
        } else {
          const analyzed = await analyzeMappedRows(client, {
            tenantId: cfg.tenantId,
            mappedRows,
          });
          summary.matchedExistingProjects += analyzed.matchedExistingProjects;
          summary.matchedByEkProjectId += analyzed.matchedByEkProjectId;
          summary.matchedByReference += analyzed.matchedByReference;
          summary.unmatchedExistingProjects += analyzed.unmatchedExistingProjects;
          addUnmatchedSample(summary, analyzed.unmatchedEkRowsSample);
          addControlPreview(summary, analyzed.controlCasePreview);
        }

        console.log(`page=${page} fetched=${rawRows.length} mapped=${mappedRows.filter(Boolean).length}`);
        if (rawRows.length < args.pageSize) break;
      }

      printJson('summary', summary);

      if (args.apply) {
        printJson('distribution_after', await getDistribution(client, cfg.tenantId));
        printJson('control_cases_after', await getControlCases(client, cfg.tenantId));
      } else {
        console.log('dry-run: no database rows were changed');
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(`resync_projects_v4_only failed: ${error.message}`);
  process.exit(1);
});
