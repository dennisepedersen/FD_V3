'use strict';

const igvaPocQueries = require('../db/queries/igvaPoc');
const auditService = require('./auditService');
const { buildIgvaPocProject } = require('./igvaPocAdapter');
const { createIgvaPocEkClient, resolveTenantEkConfig } = require('./igvaPocEkClient');

const POC_MATERIAL_ADJUSTMENTS = Object.freeze([]);
const ENRICHMENT_CONCURRENCY = 3;
const SUMMARY_REFRESH_PROJECT_LIMIT = Math.max(1, Number(process.env.IGVA_SUMMARY_REFRESH_PROJECT_LIMIT) || 5);
const SUMMARY_REFRESH_CONCURRENCY = Math.max(1, Math.min(Number(process.env.IGVA_SUMMARY_REFRESH_CONCURRENCY) || 1, 2));

function normalizeProjectRef(value) {
  return String(value || '').trim().toLowerCase();
}

function filterProjectsByRef(rows, projectRef) {
  const normalized = normalizeProjectRef(projectRef);
  if (!normalized) return rows;
  return rows.filter((row) => normalizeProjectRef(row.external_project_ref) === normalized);
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseJsonValue(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function normalizeCompletionPercent(value) {
  const parsed = toFiniteNumber(value);
  if (parsed === null || parsed < 0 || parsed > 100) {
    const error = new Error('invalid_igva_manager_completion_percent');
    error.statusCode = 400;
    throw error;
  }
  return Math.round(parsed * 100) / 100;
}

function normalizeOptionalComment(value) {
  const normalized = value === null || value === undefined ? '' : String(value).trim();
  if (!normalized) return null;
  if (normalized.length > 1000) {
    const error = new Error('igva_manager_completion_comment_too_long');
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function buildEkClient(client, tenantId, injectedClient) {
  if (injectedClient) return injectedClient;
  const config = await resolveTenantEkConfig(client, { tenantId });
  return config ? createIgvaPocEkClient(config) : null;
}

function mapManagerCompletion(row) {
  const value = toFiniteNumber(row && row.project_manager_completion_percent);
  return value === null ? null : {
    completion_percent: value,
    comment: row.project_manager_completion_comment || null,
    changed_at: row.project_manager_completion_changed_at || null,
    changed_by: row.project_manager_completion_changed_by || null,
  };
}

function mapManagerCompletionEvent(row) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    project_id: row.project_id,
    previous_completion_percent: toFiniteNumber(row.previous_completion_percent),
    completion_percent: toFiniteNumber(row.completion_percent),
    comment: row.comment || null,
    changed_at: row.changed_at,
    changed_by: row.changed_by,
    changed_by_username: row.changed_by_username || null,
    changed_by_name: row.changed_by_name || null,
  };
}

function compactDataSources(dataSources = {}) {
  const compact = { ...dataSources };
  if (compact.expected_history) {
    compact.expected_history = {
      ...compact.expected_history,
      rows: undefined,
      events: undefined,
    };
  }
  return JSON.parse(JSON.stringify(compact));
}

function componentCompletion(project, key) {
  const component = (((project || {}).calculation || {}).components || []).find((item) => item.key === key) || null;
  const raw = component ? toFiniteNumber(component.expected_progress_raw) : null;
  return raw === null ? null : Math.round(raw * 10000) / 100;
}

function buildIgvaSummaryPayload(project, row, calculatedAt = new Date()) {
  const calc = project.calculation || {};
  const totals = calc.totals || {};
  const source = project.source_totals || {};
  const calculatedIso = calculatedAt instanceof Date ? calculatedAt.toISOString() : new Date(calculatedAt).toISOString();
  const expectedCost = toFiniteNumber(totals.expected_cost || source.expected_total_from_components);
  const revenueExpected = toFiniteNumber(source.turnover_expected);
  const contributionMarginExpected = revenueExpected !== null && expectedCost !== null ? revenueExpected - expectedCost : null;
  const coverageExpected = revenueExpected && contributionMarginExpected !== null ? (contributionMarginExpected / revenueExpected) * 100 : null;
  const manager = mapManagerCompletion(row);
  const compactProject = {
    project_id: project.project_id,
    ek_project_id: project.ek_project_id || null,
    external_project_ref: project.external_project_ref || null,
    name: project.name || null,
    responsible: project.responsible || null,
    lifecycle: project.lifecycle || null,
    source_totals: project.source_totals || null,
    calculation: project.calculation || null,
    data_sources: compactDataSources(project.data_sources || {}),
    data_quality: project.data_quality || null,
    summary: {
      calculated_at: calculatedIso,
      source_synced_at: calculatedIso,
      freshness_policy_key: 'sync_worker_cadence',
    },
  };

  return {
    calculated_at: calculatedIso,
    source_synced_at: calculatedIso,
    freshness_policy_key: 'sync_worker_cadence',
    budget_completion_percent: toFiniteNumber(calc.budget_completion && calc.budget_completion.percent),
    expected_completion_percent: toFiniteNumber(calc.expected_completion && calc.expected_completion.percent),
    manager_completion_percent: manager ? manager.completion_percent : null,
    labor_completion_percent: componentCompletion(project, 'labor'),
    material_completion_percent: componentCompletion(project, 'materials'),
    revenue_actual: toFiniteNumber(source.turnover_actual),
    revenue_expected: revenueExpected,
    cost_actual: toFiniteNumber(totals.actual_cost),
    cost_expected: expectedCost,
    contribution_margin_expected: contributionMarginExpected,
    coverage_expected: coverageExpected,
    quality_status: project.data_quality || null,
    economy_status: project.data_quality === 'PARTIAL' ? 'partial' : 'calculated',
    summary_json: compactProject,
    source_metadata: {
      source: 'igva_poc_calculator',
      ek_project_id: project.ek_project_id || null,
      expected_values_status: project.data_sources && project.data_sources.expected_values ? project.data_sources.expected_values.status : null,
      actual_materials_status: project.data_sources && project.data_sources.actual_materials ? project.data_sources.actual_materials.status : null,
      actual_materials_rows: project.data_sources && project.data_sources.actual_materials ? project.data_sources.actual_materials.rows : null,
      actual_labor_status: project.data_sources && project.data_sources.actual_labor ? project.data_sources.actual_labor.status : null,
      source_project_updated_at: row.source_updated_at || row.updated_at || null,
    },
    last_error: null,
  };
}

function buildIgvaPocProjectSummary(row) {
  const persisted = parseJsonValue(row.igva_summary_json);
  const manager = mapManagerCompletion(row);
  const base = {
    project_id: row.project_id,
    ek_project_id: row.ek_project_id || null,
    external_project_ref: row.external_project_ref || null,
    name: row.name || 'Uden navn',
    customer_name: row.customer_name || row.customer || row.client_name || null,
    responsible: {
      code: row.responsible_code || null,
      name: row.responsible_name || null,
    },
    lifecycle: {
      status: row.status || null,
      is_closed: Boolean(row.is_closed),
      closed_observed_at: row.closed_observed_at || null,
    },
    project_manager_completion: manager,
    project_manager_completion_percent: manager ? manager.completion_percent : toFiniteNumber(row.igva_summary_manager_completion_percent),
    summary: {
      calculated_at: row.igva_summary_calculated_at || null,
      source_synced_at: row.igva_summary_source_synced_at || null,
      freshness_policy_key: row.igva_summary_freshness_policy_key || 'sync_worker_cadence',
      economy_status: row.igva_summary_economy_status || (persisted ? 'calculated' : 'pending'),
      last_error: row.igva_summary_last_error || null,
    },
  };

  if (!persisted) {
    return {
      ...base,
      data_quality: null,
      economy_detail: 'summary_pending',
      source_totals: null,
      calculation: null,
      data_sources: {},
    };
  }

  return {
    ...base,
    ...persisted,
    project_id: base.project_id,
    ek_project_id: base.ek_project_id,
    external_project_ref: base.external_project_ref,
    name: base.name,
    responsible: persisted.responsible || base.responsible,
    lifecycle: persisted.lifecycle || base.lifecycle,
    project_manager_completion: manager,
    project_manager_completion_percent: manager ? manager.completion_percent : base.project_manager_completion_percent,
    data_quality: row.igva_summary_quality_status || persisted.data_quality || null,
    economy_detail: 'summary',
    summary: {
      ...(persisted.summary || {}),
      calculated_at: row.igva_summary_calculated_at || (persisted.summary && persisted.summary.calculated_at) || null,
      source_synced_at: row.igva_summary_source_synced_at || (persisted.summary && persisted.summary.source_synced_at) || null,
      freshness_policy_key: row.igva_summary_freshness_policy_key || (persisted.summary && persisted.summary.freshness_policy_key) || 'sync_worker_cadence',
      economy_status: row.igva_summary_economy_status || 'calculated',
      last_error: row.igva_summary_last_error || null,
    },
  };
}

async function readProjectEconomy(ekClient, row, options = {}) {
  const ekProjectId = row.ek_project_id || null;
  if (!ekClient || !ekProjectId) {
    return {
      expectedLatest: { status: 'N/A', source: 'ek_v4_expectedvalues_latest', value: null },
      budget: { status: 'N/A', source: 'ek_v4_projects_budgets', projectBudget: null, expectedValues: null },
      expectedHistory: { status: 'N/A', source: 'ek_v4_expectedvalues_history', rows: [] },
      actualTurnover: { status: 'N/A', source: 'ek_v4_financialposts', actual_turnover: null },
      legacyFitterhours: { status: 'N/A', source: 'ek_v3_legacy_fitterhours', rows: 0 },
      purchaseInvoiceLines: { status: 'N/A', source: 'ek_v4_purchaseinvoicelines_direct_project', rows: [], total_rows_observed: 0 },
    };
  }

  const readPurchaseLines = typeof ekClient.readPurchaseInvoiceLinesByProject === 'function'
    ? () => ekClient.readPurchaseInvoiceLinesByProject(ekProjectId, options.purchaseLines || {})
    : () => Promise.resolve({ status: 'N/A', source: 'ek_v4_purchaseinvoicelines_direct_project', rows: [], total_rows_observed: 0 });

  if (options.sequential === true) {
    const expectedLatest = await ekClient.readExpectedLatest(ekProjectId);
    const budget = await ekClient.readBudget(ekProjectId);
    const expectedHistory = await ekClient.readExpectedHistory(ekProjectId);
    const actualTurnover = await ekClient.readActualTurnover(ekProjectId);
    const legacyFitterhours = await ekClient.readLegacyFitterhours(ekProjectId);
    const purchaseInvoiceLines = await readPurchaseLines();
    return { expectedLatest, budget, expectedHistory, actualTurnover, legacyFitterhours, purchaseInvoiceLines };
  }

  const [expectedLatest, budget, expectedHistory, actualTurnover, legacyFitterhours, purchaseInvoiceLines] = await Promise.all([
    ekClient.readExpectedLatest(ekProjectId),
    ekClient.readBudget(ekProjectId),
    ekClient.readExpectedHistory(ekProjectId),
    ekClient.readActualTurnover(ekProjectId),
    ekClient.readLegacyFitterhours(ekProjectId),
    readPurchaseLines(),
  ]);

  return { expectedLatest, budget, expectedHistory, actualTurnover, legacyFitterhours, purchaseInvoiceLines };
}

async function listIgvaPocProjects(client, {
  tenantId,
  userId,
  projectRef = null,
  ekClient: injectedEkClient = null,
  includeEconomy = Boolean(projectRef),
  includeClosed = false,
} = {}) {
  const rows = await igvaPocQueries.listIgvaPocProjectsForUser(client, {
    tenantId,
    userId,
    includeClosed: Boolean(includeClosed || projectRef),
  });
  const scopedRows = filterProjectsByRef(rows, projectRef);
  const shouldReadEconomy = Boolean(includeEconomy);
  const ekClient = shouldReadEconomy ? await buildEkClient(client, tenantId, injectedEkClient) : null;

  const projects = shouldReadEconomy
    ? await mapWithConcurrency(scopedRows, ENRICHMENT_CONCURRENCY, async (row) => {
      const ekEconomy = await readProjectEconomy(ekClient, row);
      return buildIgvaPocProject(row, {
        materialAdjustments: POC_MATERIAL_ADJUSTMENTS,
        ekEconomy,
      });
    })
    : scopedRows.map(buildIgvaPocProjectSummary);

  return {
    scope: 'mine',
    economy_mode: shouldReadEconomy ? 'igva_poc_v3_2_selected_project_read_through' : 'igva_poc_v3_2_persisted_summary',
    persistence: {
      project_manager_completion_percent: 'fielddesk_db_tenant_project_scoped',
      summary: 'igva_project_summary_refreshed_by_sync_worker',
    },
    data_sources: {
      expected_economy: {
        primary: 'GET /api/v4/projects/expectedvalues/latest/{projectId}',
        fallback: 'GET /api/v4/projects/budgets/{projectId}.projectExpectedValues',
      },
      budget: {
        primary: 'GET /api/v4/projects/budgets/{projectId}',
      },
      expected_history: {
        source: 'GET /api/v4/projects/expectedvalues/history/{projectId}',
        permanent_model: 'external_history_source_only_not_fielddesk_event_model',
      },
      actual_turnover: {
        source: 'GET /api/v4/financialposts filtered by EK ProjectID, account 1020 normalized positive',
      },
      actual_labor: {
        source: 'GET /api/v3.0/fitterhours?searchAttribute=ProjectID&search=<EK ProjectID>',
        source_status: 'ek_v3_legacy_fitterhours',
        reason: 'Only verified source matching EK UI BasisTotalHours/net labor/social additions in current audit.',
      },
      actual_materials: {
        source: 'GET /api/v4/purchaseinvoicelines filtered by EK ProjectID; financialposts are provenance only',
        source_status: 'VERIFIED_OR_PARTIAL_BY_CLASSIFICATION',
        rule: 'Material actual is creditor MATERIAL plus probable Lager/Bil candidate rows where FinancialAccount=null and StatusEnum=4; PurchaseInvoiceID bridge is fallback/enrichment only.',
      },
    },
    kalkia: {
      mode: 'injection_ready_no_production_import',
      material_adjustments: POC_MATERIAL_ADJUSTMENTS,
    },
    projects,
  };
}

async function saveProjectManagerCompletion(client, { tenantId, userId, projectId, completionPercent, comment = null }) {
  const normalizedPercent = normalizeCompletionPercent(completionPercent);
  const normalizedComment = normalizeOptionalComment(comment);
  await client.query('BEGIN');
  try {
    const previous = await igvaPocQueries.getProjectManagerCompletionForUpdate(client, { tenantId, projectId });
    const saved = await igvaPocQueries.upsertProjectManagerCompletion(client, {
      tenantId,
      projectId,
      completionPercent: normalizedPercent,
      comment: normalizedComment,
      changedBy: userId,
    });
    const event = await igvaPocQueries.insertProjectManagerCompletionEvent(client, {
      tenantId,
      projectId,
      previousCompletionPercent: previous ? toFiniteNumber(previous.completion_percent) : null,
      completionPercent: normalizedPercent,
      comment: normalizedComment,
      changedBy: userId,
      metadata: { source: 'igva_poc_ui' },
    });
    await igvaPocQueries.updateSummaryManagerCompletion(client, { tenantId, projectId, completionPercent: normalizedPercent });
    await auditService.logAuditEvent({
      client,
      tenantId,
      actorId: userId,
      actorType: 'tenant_user',
      actorScope: 'tenant',
      moduleKey: 'igva',
      eventType: 'igva.manager_completion_changed',
      resourceType: 'igva_project_manager_completion',
      resourceId: projectId,
      projectId,
      outcome: 'success',
      metadata: {
        previous_completion_percent: previous ? toFiniteNumber(previous.completion_percent) : null,
        completion_percent: normalizedPercent,
        has_comment: Boolean(normalizedComment),
      },
    });
    await client.query('COMMIT');
    return {
      completion: mapManagerCompletion({
        project_manager_completion_percent: saved.completion_percent,
        project_manager_completion_comment: saved.comment,
        project_manager_completion_changed_at: saved.changed_at,
        project_manager_completion_changed_by: saved.changed_by,
      }),
      event: mapManagerCompletionEvent(event),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function listProjectManagerCompletionHistory(client, { tenantId, projectId, limit = 20 }) {
  const rows = await igvaPocQueries.listProjectManagerCompletionEvents(client, { tenantId, projectId, limit });
  return rows.map(mapManagerCompletionEvent);
}

async function refreshIgvaProjectSummaries(client, {
  tenantId,
  projectIds = null,
  limit = SUMMARY_REFRESH_PROJECT_LIMIT,
  ekClient: injectedEkClient = null,
} = {}) {
  const rows = await igvaPocQueries.listIgvaProjectsForSummaryRefresh(client, { tenantId, projectIds, limit });
  const ekClient = await buildEkClient(client, tenantId, injectedEkClient);
  const results = [];

  await mapWithConcurrency(rows, SUMMARY_REFRESH_CONCURRENCY, async (row) => {
    const calculatedAt = new Date();
    try {
      if (!ekClient) throw new Error('igva_ek_config_not_available');
      const ekEconomy = await readProjectEconomy(ekClient, row, { sequential: true });
      const project = buildIgvaPocProject(row, {
        materialAdjustments: POC_MATERIAL_ADJUSTMENTS,
        ekEconomy,
      });
      const summary = buildIgvaSummaryPayload(project, row, calculatedAt);
      await igvaPocQueries.upsertIgvaProjectSummary(client, {
        tenantId,
        projectId: row.project_id,
        summary,
      });
      await auditService.logAuditEvent({
        client,
        tenantId,
        actorId: 'system:igva-summary-sync',
        actorType: 'system',
        actorScope: 'system',
        moduleKey: 'igva',
        eventType: 'igva.summary_refreshed',
        resourceType: 'igva_project_summary',
        resourceId: row.project_id,
        projectId: row.project_id,
        outcome: 'success',
        metadata: {
          ek_project_id: row.ek_project_id || null,
          external_project_ref: row.external_project_ref || null,
          quality_status: summary.quality_status || null,
        },
      });
      results.push({ project_id: row.project_id, external_project_ref: row.external_project_ref || null, status: 'success' });
    } catch (error) {
      const message = String(error && error.message ? error.message : 'igva_summary_refresh_failed');
      await igvaPocQueries.markIgvaProjectSummaryFailed(client, {
        tenantId,
        projectId: row.project_id,
        calculatedAt: calculatedAt.toISOString(),
        errorMessage: message,
      });
      await auditService.logAuditEvent({
        client,
        tenantId,
        actorId: 'system:igva-summary-sync',
        actorType: 'system',
        actorScope: 'system',
        moduleKey: 'igva',
        eventType: 'igva.summary_refresh_failed',
        resourceType: 'igva_project_summary',
        resourceId: row.project_id,
        projectId: row.project_id,
        outcome: 'fail',
        reason: message.slice(0, 300),
        metadata: {
          ek_project_id: row.ek_project_id || null,
          external_project_ref: row.external_project_ref || null,
        },
      });
      results.push({ project_id: row.project_id, external_project_ref: row.external_project_ref || null, status: 'failed', error: message });
    }
  });

  return {
    tenant_id: tenantId,
    rows_considered: rows.length,
    refreshed: results.filter((item) => item.status === 'success').length,
    failed: results.filter((item) => item.status === 'failed').length,
    results,
  };
}

module.exports = {
  listIgvaPocProjects,
  saveProjectManagerCompletion,
  listProjectManagerCompletionHistory,
  refreshIgvaProjectSummaries,
  _test: {
    filterProjectsByRef,
    mapWithConcurrency,
    normalizeProjectRef,
    buildIgvaPocProjectSummary,
    readProjectEconomy,
    buildIgvaSummaryPayload,
    normalizeCompletionPercent,
    normalizeOptionalComment,
  },
};