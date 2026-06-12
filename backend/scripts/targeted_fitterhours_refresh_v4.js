'use strict';

/*
 * EK v4 project-detail targeted fitterhours refresh.
 *
 * - Calls only /api/v4/projects/id/{EK ProjectID}.
 * - Refreshes one resolved open Fielddesk project at a time.
 * - Does not delete rows, update sync state, or run broad fitterhours sync.
 * - Preserves richer existing v3 fitter_hour fields when v4 has null/0/sparse data.
 */

const crypto = require('crypto');
const path = require('path');
const { Pool } = require('pg');

const { materializeProjectActivityFromFitterHours } = require('../src/services/projectActivityMaterializer');

require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const JOB_NAME = 'project-targeted-fitterhours-refresh-v4';

function usage() {
  return [
    'Usage:',
    '  node scripts/targeted_fitterhours_refresh_v4.js --tenant hoyrup-clemmensen --ek-project-id 25906 --dry-run',
    '  node scripts/targeted_fitterhours_refresh_v4.js --tenant hoyrup-clemmensen --ek-project-id 25906 --project-ref 80396-003 --dry-run',
    '  node scripts/targeted_fitterhours_refresh_v4.js --tenant hoyrup-clemmensen --ek-project-id 25906 --apply --confirm APPLY:project-targeted-fitterhours-refresh-v4:hoyrup-clemmensen:25906',
    '',
    'Options:',
    '  --tenant <slug-or-domain>  Tenant slug or tenant domain.',
    '  --ek-project-id <id>       EK internal ProjectID.',
    '  --project-ref <ref>        Optional safety check against Fielddesk/EK project reference.',
    '  --status-only              Inspect resolved project and existing FD rows without EK fetch.',
    '  --dry-run                  Fetch and compare without writing.',
    '  --apply                    Upsert changed/new rows and materialize project activity.',
    '  --confirm <token>          Required for apply.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    tenant: null,
    ekProjectId: null,
    projectRef: null,
    statusOnly: false,
    dryRun: false,
    apply: false,
    confirm: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tenant') {
      args.tenant = argv[++i] || null;
    } else if (arg === '--ek-project-id') {
      args.ekProjectId = argv[++i] || null;
    } else if (arg === '--project-ref') {
      args.projectRef = argv[++i] || null;
    } else if (arg === '--status-only') {
      args.statusOnly = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--apply') {
      args.apply = true;
    } else if (arg === '--confirm') {
      args.confirm = argv[++i] || null;
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
  if (args.projectRef && !/^[a-zA-Z0-9._-]{1,128}$/.test(String(args.projectRef).trim())) {
    throw new Error('Project ref may only contain letters, numbers, dot, underscore, or dash.');
  }

  const selectedModes = [args.statusOnly, args.dryRun, args.apply].filter(Boolean).length;
  if (selectedModes > 1) {
    throw new Error('Use only one of --status-only, --dry-run, or --apply.');
  }
  if (selectedModes === 0) {
    throw new Error(`Provide --status-only, --dry-run, or --apply for ${JOB_NAME}.`);
  }
  if (args.apply) {
    const tenant = String(args.tenant).trim().toLowerCase();
    const ekProjectId = String(args.ekProjectId).trim();
    const expectedConfirm = `APPLY:${JOB_NAME}:${tenant}:${ekProjectId}`;
    if (args.confirm !== expectedConfirm) {
      throw new Error(`Apply requires --confirm ${expectedConfirm}`);
    }
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
  const text = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2}T/.test(text) && !/(Z|[+-]\d{2}:\d{2})$/i.test(text)
    ? `${text}Z`
    : text;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function pickAny(raw, keys) {
  for (const key of keys) {
    if (raw && Object.prototype.hasOwnProperty.call(raw, key)) {
      const value = raw[key];
      if (value !== undefined) {
        return value;
      }
    }
  }
  return null;
}

function buildProjectDetailUrl(baseUrl, ekProjectId) {
  return `${normalizeBase(baseUrl)}/api/v4/projects/id/${encodeURIComponent(String(ekProjectId))}`
    .replace(/([^:]\/)(\/+)/g, '$1');
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

async function resolveOpenProject(client, { tenantId, ekProjectId, projectRef = null }) {
  const params = [tenantId, ekProjectId];
  const projectRefFilter = projectRef ? 'AND lower(pc.external_project_ref) = lower($3)' : '';
  if (projectRef) {
    params.push(String(projectRef).trim());
  }

  const { rows } = await client.query(
    `
      SELECT
        pc.project_id,
        pc.external_project_ref,
        pc.status,
        pc.is_closed,
        pm.ek_project_id
      FROM project_masterdata_v4 pm
      JOIN project_core pc
        ON pc.tenant_id = pm.tenant_id
       AND pc.project_id = pm.project_id
      WHERE pm.tenant_id = $1
        AND pm.ek_project_id = $2::bigint
        AND pc.status = 'open'
        AND pc.is_closed = false
        ${projectRefFilter}
      ORDER BY pc.updated_at DESC
      LIMIT 2
    `,
    params
  );

  if (rows.length !== 1) {
    throw new Error(`expected_one_open_fd_project_for_ek_project_id:${ekProjectId}:found:${rows.length}`);
  }
  return rows[0];
}

async function summarizeExistingProject(client, { tenantId, fdProjectId }) {
  const { rows } = await client.query(
    `
      SELECT
        COUNT(*)::int AS rows,
        COALESCE(SUM(COALESCE(hours, quantity, 0)), 0)::numeric AS total_hours,
        COUNT(DISTINCT COALESCE(fitter_id, fitter_username, fitter_salary_id, fitter_reference))::int AS unique_employees,
        MAX(work_date) AS max_work_date,
        MAX(registration_date) AS max_registration_date
      FROM fitter_hour
      WHERE tenant_id = $1
        AND fd_project_id = $2
    `,
    [tenantId, fdProjectId]
  );
  const row = rows[0] || {};
  return {
    rows: Number(row.rows || 0),
    totalHours: Number(Number(row.total_hours || 0).toFixed(2)),
    uniqueEmployees: Number(row.unique_employees || 0),
    maxWorkDate: row.max_work_date ? new Date(row.max_work_date).toISOString() : null,
    maxRegistrationDate: row.max_registration_date ? new Date(row.max_registration_date).toISOString() : null,
  };
}

async function fetchProjectDetail({ cfg, ekProjectId }) {
  const url = buildProjectDetailUrl(cfg.ekBaseUrl, ekProjectId);
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      apikey: cfg.ekApiKey,
      siteName: cfg.siteName,
      Accept: 'application/json',
    },
  });

  const bodyText = await response.text();
  let payload = null;
  try {
    payload = bodyText ? JSON.parse(bodyText) : null;
  } catch (_error) {
    throw new Error(`EK project detail returned non-json (${response.status}): ${bodyText.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(`EK project detail request failed (${response.status}): ${bodyText.slice(0, 300)}`);
  }

  return { url, payload };
}

function extractProjectDetail(payload, ekProjectId) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('project_detail_payload_missing');
  }
  if (payload.hasErrors === true) {
    throw new Error(`project_detail_has_errors:${payload.errorMessage || 'unknown'}`);
  }

  const rows = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.data?.data)
      ? payload.data.data
      : [];
  const total = payload.total ?? payload.data?.total ?? null;

  if (total != null && Number(total) !== 1) {
    throw new Error(`project_detail_expected_total_1:got:${total}`);
  }
  if (rows.length !== 1) {
    throw new Error(`project_detail_expected_one_row:got:${rows.length}`);
  }

  const project = rows[0];
  const projectId = asNullableText(pickAny(project, ['projectID', 'ProjectID']));
  if (String(projectId || '').trim() !== String(ekProjectId)) {
    throw new Error(`project_detail_project_id_mismatch:expected:${ekProjectId}:got:${projectId}`);
  }

  const fitterHours = project.fitterHours;
  if (!Array.isArray(fitterHours)) {
    throw new Error('project_detail_fitterHours_missing_or_not_array');
  }

  return { project, fitterHours, total: Number(total || rows.length) };
}

function mapV4FitterHourRow(raw, { ekProjectId, externalProjectRef }) {
  if (!raw || typeof raw !== 'object') return null;

  const rawProjectId = asNullableText(pickAny(raw, ['projectID', 'ProjectID']));
  if (rawProjectId && String(rawProjectId) !== String(ekProjectId)) {
    return null;
  }

  const fitterHourId = asNullableText(pickAny(raw, ['fitterHourID', 'FitterHourID', 'id', 'ID']));
  if (!fitterHourId) {
    return null;
  }

  const workDate = asNullableTimestamp(pickAny(raw, ['date', 'Date']));
  const hours = asNullableNumeric(pickAny(raw, ['hourSpent', 'HourSpent', 'hours', 'Hours']));
  if (!workDate && hours == null) {
    return null;
  }

  const categoryIdRaw = asNullableText(pickAny(raw, ['fitterCategoryID', 'FitterCategoryID']));
  const categoryId = categoryIdRaw && categoryIdRaw !== '0' ? categoryIdRaw : null;
  const description = asNullableText(pickAny(raw, ['description', 'Description']));

  return {
    sourceKey: `id:${fitterHourId}`,
    fitterHourId,
    externalProjectRef,
    projectId: String(ekProjectId),
    fitterId: asNullableText(pickAny(raw, ['fitterID', 'FitterID'])),
    fitterCategoryId: categoryId,
    workDate,
    hours,
    note: description,
    description,
    rawPayloadJson: {
      source: 'ek_v4_project_detail_fitterHours',
      project: {
        projectID: Number(ekProjectId),
        reference: externalProjectRef,
      },
      row: raw,
    },
  };
}

async function loadExistingRows(client, { tenantId, fdProjectId, sourceKeys }) {
  const existingForProject = await summarizeExistingProject(client, { tenantId, fdProjectId });
  if (!sourceKeys.length) {
    return {
      existingForProject,
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
    existingForProject,
    bySourceKey: new Map(rows.map((row) => [row.source_key, row])),
  };
}

function normalizeDbTimestamp(value) {
  return value ? new Date(value).toISOString() : null;
}

function numbersEqual(left, right) {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return Number(left) === Number(right);
}

function classifyRowAction(row, existing, fdProjectId) {
  const existingRow = existing.bySourceKey.get(row.sourceKey);
  if (!existingRow) return 'insert';
  if (String(existingRow.fd_project_id || '') !== String(fdProjectId || '')) return 'update';
  if (row.fitterHourId && String(existingRow.fitter_hour_id || '') !== String(row.fitterHourId)) return 'update';
  if (row.externalProjectRef && String(existingRow.external_project_ref || '') !== String(row.externalProjectRef)) return 'update';
  if (row.projectId && String(existingRow.project_id || '') !== String(row.projectId)) return 'update';
  if (row.fitterId && String(existingRow.fitter_id || '') !== String(row.fitterId)) return 'update';
  if (row.fitterCategoryId && String(existingRow.fitter_category_id || '') !== String(row.fitterCategoryId)) return 'update';
  if (row.workDate && normalizeDbTimestamp(existingRow.work_date) !== row.workDate) return 'update';
  if (row.hours != null && !numbersEqual(existingRow.hours, row.hours)) return 'update';
  if (row.note && String(existingRow.note || '') !== row.note) return 'update';
  if (row.description && String(existingRow.description || '') !== row.description) return 'update';
  return 'skip';
}

function summarizeRows({ remoteRows, mappedRows, existing, fdProjectId }) {
  const uniqueEmployees = new Set();
  let totalHours = 0;
  let rowsWithNullHours = 0;
  let wouldInsert = 0;
  let wouldUpdate = 0;
  let wouldSkip = 0;

  for (const row of mappedRows) {
    if (row.hours == null) rowsWithNullHours += 1;
    else totalHours += Number(row.hours);
    if (row.fitterId) uniqueEmployees.add(String(row.fitterId));

    const action = classifyRowAction(row, existing, fdProjectId);
    if (action === 'insert') wouldInsert += 1;
    else if (action === 'update') wouldUpdate += 1;
    else wouldSkip += 1;
  }

  return {
    remoteRows: remoteRows.length,
    mappedRows: mappedRows.length,
    filteredOutRows: remoteRows.length - mappedRows.length,
    totalHours: Number(totalHours.toFixed(2)),
    rowsWithNullHours,
    uniqueEmployees: uniqueEmployees.size,
    existingRowsInFdProject: existing.existingForProject.rows,
    existingRowsBySourceKey: existing.bySourceKey.size,
    wouldInsert,
    wouldUpdate,
    wouldSkip,
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
      const base = index * 13;
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}::jsonb, $${base + 13}, now())`
      );
      params.push(
        tenantId,
        row.sourceKey,
        row.fitterHourId,
        row.externalProjectRef,
        row.projectId,
        row.fitterId,
        row.fitterCategoryId,
        row.workDate,
        row.hours,
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
            fitter_category_id,
            work_date,
            hours,
            note,
            description,
            raw_payload_json,
            fd_project_id,
            synced_at
          )
          VALUES ${values.join(',\n')}
          ON CONFLICT (tenant_id, source_key)
          DO UPDATE SET
            fitter_hour_id = COALESCE(EXCLUDED.fitter_hour_id, fitter_hour.fitter_hour_id),
            external_project_ref = COALESCE(EXCLUDED.external_project_ref, fitter_hour.external_project_ref),
            project_id = COALESCE(EXCLUDED.project_id, fitter_hour.project_id),
            fitter_id = COALESCE(EXCLUDED.fitter_id, fitter_hour.fitter_id),
            fitter_category_id = COALESCE(EXCLUDED.fitter_category_id, fitter_hour.fitter_category_id),
            work_date = COALESCE(EXCLUDED.work_date, fitter_hour.work_date),
            hours = COALESCE(EXCLUDED.hours, fitter_hour.hours),
            note = COALESCE(NULLIF(EXCLUDED.note, ''), fitter_hour.note),
            description = COALESCE(NULLIF(EXCLUDED.description, ''), fitter_hour.description),
            raw_payload_json = COALESCE(fitter_hour.raw_payload_json, '{}'::jsonb)
              || jsonb_build_object(
                'fielddesk_v4_project_detail_refresh',
                EXCLUDED.raw_payload_json,
                'fielddesk_v4_project_detail_refreshed_at',
                now()
              ),
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

async function readEndpointSelection(client, { tenantId }) {
  const { rows } = await client.query(
    `
      SELECT endpoint_key, enabled
      FROM tenant_endpoint_selection
      WHERE tenant_id = $1
        AND endpoint_key IN ('projects', 'fitterhours')
      ORDER BY endpoint_key
    `,
    [tenantId]
  );
  return rows;
}

async function readActiveDeltaJobs(client, { tenantId }) {
  const { rows } = await client.query(
    `
      SELECT id, type AS job_type, status, created_at, started_at, updated_at
      FROM sync_job
      WHERE tenant_id = $1
        AND type = 'delta'
        AND status IN ('queued', 'running')
      ORDER BY created_at DESC
      LIMIT 10
    `,
    [tenantId]
  );
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = buildPool();
  const client = await pool.connect();
  const startedAt = new Date();

  try {
    const cfg = await resolveTenantAndConfig(client, args.tenant);
    const project = await resolveOpenProject(client, {
      tenantId: cfg.tenantId,
      ekProjectId: args.ekProjectId,
      projectRef: args.projectRef,
    });
    const existingBefore = await summarizeExistingProject(client, {
      tenantId: cfg.tenantId,
      fdProjectId: project.project_id,
    });

    if (args.statusOnly) {
      const endpointSelection = await readEndpointSelection(client, { tenantId: cfg.tenantId });
      const activeDeltaJobs = await readActiveDeltaJobs(client, { tenantId: cfg.tenantId });
      console.log(JSON.stringify({
        event: 'targeted_fitterhours_refresh_v4_status',
        job: JOB_NAME,
        mode: 'status-only',
        started_at: startedAt.toISOString(),
        finished_at: new Date().toISOString(),
        tenant: cfg.slug,
        tenant_id: cfg.tenantId,
        ek_project_id: Number(args.ekProjectId),
        project_match: {
          fd_project_id: project.project_id,
          external_project_ref: project.external_project_ref,
          status: project.status,
          is_closed: project.is_closed,
          ek_project_id: Number(project.ek_project_id),
        },
        existing_before: existingBefore,
        endpoint_selection: endpointSelection,
        active_delta_jobs: activeDeltaJobs,
        safety: {
          writes_enabled: false,
          ek_fetch_enabled: false,
          deletes_enabled: false,
          sync_state_updates_enabled: false,
        },
      }, null, 2));
      return;
    }

    const fetched = await fetchProjectDetail({ cfg, ekProjectId: args.ekProjectId });
    const extracted = extractProjectDetail(fetched.payload, args.ekProjectId);
    const parentRef = asNullableText(pickAny(extracted.project, ['reference', 'Reference'])) || project.external_project_ref;
    if (project.external_project_ref && parentRef && String(parentRef).trim() !== String(project.external_project_ref).trim()) {
      throw new Error(`project_reference_mismatch:fd:${project.external_project_ref}:ek:${parentRef}`);
    }

    const wrongProjectRows = extracted.fitterHours
      .map((row, index) => ({ index, projectId: asNullableText(pickAny(row, ['projectID', 'ProjectID'])) }))
      .filter((row) => row.projectId && String(row.projectId) !== String(args.ekProjectId));
    if (wrongProjectRows.length) {
      throw new Error(`project_detail_fitterHours_included_other_project_ids:${JSON.stringify(wrongProjectRows.slice(0, 5))}`);
    }

    const mappedRows = extracted.fitterHours
      .map((row) => mapV4FitterHourRow(row, {
        ekProjectId: args.ekProjectId,
        externalProjectRef: parentRef,
      }))
      .filter(Boolean);
    const existing = await loadExistingRows(client, {
      tenantId: cfg.tenantId,
      fdProjectId: project.project_id,
      sourceKeys: mappedRows.map((row) => row.sourceKey),
    });
    const summary = summarizeRows({
      remoteRows: extracted.fitterHours,
      mappedRows,
      existing,
      fdProjectId: project.project_id,
    });

    let applyResult = null;
    let activityResult = null;
    let existingAfter = null;

    if (args.apply) {
      const rowsToApply = mappedRows.filter((row) => classifyRowAction(row, existing, project.project_id) !== 'skip');
      await client.query('BEGIN');
      try {
        applyResult = await upsertTargetedRows(client, {
          tenantId: cfg.tenantId,
          fdProjectId: project.project_id,
          mappedRows: rowsToApply,
        });
        applyResult.skipped = mappedRows.length - rowsToApply.length;
        activityResult = await materializeProjectActivityFromFitterHours(client, {
          tenantId: cfg.tenantId,
          projectIds: [project.project_id],
        });
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      existingAfter = await summarizeExistingProject(client, {
        tenantId: cfg.tenantId,
        fdProjectId: project.project_id,
      });
    }

    console.log(JSON.stringify({
      event: args.apply ? 'targeted_fitterhours_refresh_v4_apply' : 'targeted_fitterhours_refresh_v4_dry_run',
      job: JOB_NAME,
      mode: args.apply ? 'apply' : 'dry-run',
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      tenant: cfg.slug,
      tenant_id: cfg.tenantId,
      ek_project_id: Number(args.ekProjectId),
      endpoint: fetched.url.replace(normalizeBase(cfg.ekBaseUrl), '/api-host'),
      project_match: {
        fd_project_id: project.project_id,
        external_project_ref: project.external_project_ref,
        status: project.status,
        is_closed: project.is_closed,
        ek_project_id: Number(project.ek_project_id),
      },
      ek_project_detail: {
        total: extracted.total,
        reference: parentRef,
        fitter_hours_count: extracted.fitterHours.length,
      },
      existing_before: existingBefore,
      summary,
      apply_result: applyResult,
      activity_result: activityResult,
      existing_after: existingAfter,
      safety: {
        writes_enabled: Boolean(args.apply),
        endpoint_used: '/api/v4/projects/id/{id}',
        v4_fitterhours_endpoint_used: false,
        v4_fitterhours_query_used: false,
        deletes_enabled: false,
        sync_state_updates_enabled: false,
        scheduler_updates_enabled: false,
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
    event: 'targeted_fitterhours_refresh_v4_failed',
    job: JOB_NAME,
    error: error.message,
  }));
  process.exit(1);
});
