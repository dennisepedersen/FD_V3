'use strict';

const igvaPocQueries = require('../db/queries/igvaPoc');
const { buildIgvaPocProject } = require('./igvaPocAdapter');
const { createIgvaPocEkClient, resolveTenantEkConfig } = require('./igvaPocEkClient');

const POC_MATERIAL_ADJUSTMENTS = Object.freeze([]);
const ENRICHMENT_CONCURRENCY = 3;

function normalizeProjectRef(value) {
  return String(value || '').trim().toLowerCase();
}

function filterProjectsByRef(rows, projectRef) {
  const normalized = normalizeProjectRef(projectRef);
  if (!normalized) return rows;
  return rows.filter((row) => normalizeProjectRef(row.external_project_ref) === normalized);
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

function buildIgvaPocProjectSummary(row) {
  return {
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
    },
    data_quality: 'NOT_LOADED',
    economy_detail: 'not_loaded',
    source_totals: null,
    calculation: null,
    data_sources: {
      expected_values: { status: 'NOT_LOADED', source: 'selected_project_read_through_only' },
      budget: { status: 'NOT_LOADED', source: 'selected_project_read_through_only' },
      expected_history: {
        status: 'NOT_LOADED',
        source: 'selected_project_read_through_only',
        rows: [],
        events: [],
        total_rows_observed: 0,
        capabilities: {
          total_materials_history: true,
          total_labor_history: true,
          total_turnover_history: true,
          creditor_row_history: false,
          note_history: true,
          user_history: true,
        },
      },
      actual_turnover: { status: 'NOT_LOADED', source: 'selected_project_read_through_only' },
      actual_labor: { status: 'NOT_LOADED', source: 'selected_project_read_through_only' },
      actual_materials: { status: 'NOT_LOADED', source: 'selected_project_read_through_only' },
    },
  };
}

async function readProjectEconomy(ekClient, row) {
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

  const [expectedLatest, budget, expectedHistory, actualTurnover, legacyFitterhours, purchaseInvoiceLines] = await Promise.all([
    ekClient.readExpectedLatest(ekProjectId),
    ekClient.readBudget(ekProjectId),
    ekClient.readExpectedHistory(ekProjectId),
    ekClient.readActualTurnover(ekProjectId),
    ekClient.readLegacyFitterhours(ekProjectId),
    typeof ekClient.readPurchaseInvoiceLinesByProject === 'function'
      ? ekClient.readPurchaseInvoiceLinesByProject(ekProjectId)
      : Promise.resolve({ status: 'N/A', source: 'ek_v4_purchaseinvoicelines_direct_project', rows: [], total_rows_observed: 0 }),
  ]);

  return { expectedLatest, budget, expectedHistory, actualTurnover, legacyFitterhours, purchaseInvoiceLines };
}

async function listIgvaPocProjects(client, {
  tenantId,
  userId,
  projectRef = null,
  ekClient: injectedEkClient = null,
  includeEconomy = Boolean(projectRef),
} = {}) {
  const rows = await igvaPocQueries.listIgvaPocProjectsForUser(client, { tenantId, userId });
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
    economy_mode: shouldReadEconomy ? 'igva_poc_v3_1_selected_project_read_through' : 'igva_poc_v3_1_project_list_only',
    persistence: {
      project_manager_completion_percent: 'browser_local_storage_poc_only',
      permanent_recommendation: 'Persist in a tenant-scoped Fielddesk table keyed by tenant_id, project_id and actor/user with audit/versioning.',
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
        rule: 'Material actual is creditor MATERIAL plus PROBABLE Lager/Bil candidate rows where FinancialAccount=null and StatusEnum=4; PurchaseInvoiceID bridge is fallback/enrichment only.',
      },
    },
    kalkia: {
      mode: 'injection_ready_no_production_import',
      material_adjustments: POC_MATERIAL_ADJUSTMENTS,
    },
    projects,
  };
}

module.exports = {
  listIgvaPocProjects,
  _test: {
    filterProjectsByRef,
    mapWithConcurrency,
    normalizeProjectRef,
    buildIgvaPocProjectSummary,
    readProjectEconomy,
  },
};
