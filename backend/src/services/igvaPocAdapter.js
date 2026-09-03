'use strict';

const { calculateIgvaProjectEconomy } = require('./igvaPocCalculator');
const { normalizeEkPurchaseInvoiceLines, summarizePurchaseLines } = require('./purchaseLineNormalizer');

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
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

function sumNumbers(values) {
  return values.reduce((sum, value) => sum + (toFiniteNumber(value) || 0), 0);
}

function pickValue(source, keys) {
  if (!source || typeof source !== 'object') return null;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
  }
  const byLower = Object.keys(source).reduce((map, key) => {
    map[key.toLowerCase()] = key;
    return map;
  }, {});
  for (const key of keys) {
    const actual = byLower[String(key).toLowerCase()];
    if (actual) return source[actual];
  }
  return null;
}

function pickNumber(source, keys) {
  return toFiniteNumber(pickValue(source, keys));
}

function selectExpectedValues(row, economy) {
  const persisted = parseJsonValue(row.project_expected_values);
  const latest = economy.expectedLatest && economy.expectedLatest.status === 'VERIFIED'
    ? economy.expectedLatest.value
    : null;
  const budgetEmbedded = economy.budget && economy.budget.expectedValues ? economy.budget.expectedValues : null;

  if (latest) {
    return { value: latest, source: 'ek_v4_expectedvalues_latest', status: 'VERIFIED' };
  }
  if (budgetEmbedded) {
    return { value: budgetEmbedded, source: 'ek_v4_projects_budgets.projectExpectedValues', status: economy.budget.status === 'VERIFIED' ? 'VERIFIED' : 'PARTIAL' };
  }
  if (persisted) {
    return { value: persisted, source: 'fielddesk_persisted_project_expected_values', status: 'PARTIAL' };
  }
  return { value: null, source: 'none', status: 'N/A' };
}

function selectBudget(row, economy) {
  const persisted = parseJsonValue(row.project_budget);
  if (economy.budget && economy.budget.projectBudget) {
    return { value: economy.budget.projectBudget, source: 'ek_v4_projects_budgets.projectBudget', status: economy.budget.status === 'VERIFIED' ? 'VERIFIED' : 'PARTIAL' };
  }
  if (persisted) {
    return { value: persisted, source: 'fielddesk_persisted_project_budget', status: 'PARTIAL' };
  }
  return { value: null, source: 'none', status: 'N/A' };
}

function budgetCostNode(projectBudget) {
  return projectBudget && (
    projectBudget.projectBudgetCostResponseDTO
    || projectBudget.ProjectBudgetCostResponseDTO
    || projectBudget.project_budget_cost_response_dto
  ) ? (
      projectBudget.projectBudgetCostResponseDTO
      || projectBudget.ProjectBudgetCostResponseDTO
      || projectBudget.project_budget_cost_response_dto
    ) : {};
}

function normalizeExpectedMaterialRows(expectedValues) {
  const rows = pickValue(expectedValues, ['creditorExpectedValues', 'CreditorExpectedValues']) || [];
  if (!Array.isArray(rows)) return [];

  return rows.map((row) => {
    const creditor = row.creditor && typeof row.creditor === 'object' ? row.creditor : {};
    const creditorName = pickValue(row, ['creditorName', 'CreditorName']) ?? pickValue(creditor, ['creditorName', 'CreditorName']);
    const creditorReference = pickValue(row, ['creditorReference', 'CreditorReference']) ?? pickValue(creditor, ['creditorReference', 'CreditorReference']);
    const creditorId = pickValue(row, ['creditorID', 'creditorId', 'CreditorID', 'CreditorId']) ?? pickValue(creditor, ['creditorID', 'creditorId', 'CreditorID', 'CreditorId']) ?? pickValue(row, ['id', 'ID']);
    const budget = pickNumber(row, ['budget', 'Budget']);
    const emptyName = creditorName === null || creditorName === undefined || String(creditorName).trim() === '';
    const reference = creditorReference === null || creditorReference === undefined ? '' : String(creditorReference).trim();
    const labelText = String(creditorName || creditorReference || row.description || '').trim();
    const isLagerBil = (emptyName && reference === '-1') || String(creditorId || '') === '1' || /lager\s*\/\s*bil/i.test(labelText);

    return {
      source_type: isLagerBil ? 'lager_bil' : 'creditor',
      creditor_id: creditorId || null,
      creditor_name: isLagerBil ? null : (creditorName || null),
      creditor_reference: creditorReference || null,
      label: isLagerBil ? 'Lager/Bil' : String(creditorName || creditorReference || 'Ukendt kreditor'),
      expected_budget: budget,
      is_creditor: !isLagerBil,
    };
  });
}
function buildExpectedMaterialSummary(expectedValues) {
  const rows = normalizeExpectedMaterialRows(expectedValues);
  const totalPurchases = pickNumber(expectedValues, ['totalPurchases', 'TotalPurchases']);
  const breakdownTotal = round(rows.reduce((sum, row) => sum + (toFiniteNumber(row.expected_budget) || 0), 0), 2);
  const unallocated = totalPurchases !== null ? round(totalPurchases - breakdownTotal, 2) : null;

  return {
    total: totalPurchases,
    breakdown: rows,
    breakdown_total: rows.length ? breakdownTotal : null,
    unallocated_expected_materials: rows.length && totalPurchases !== null ? unallocated : null,
    lager_bil_expected: rows
      .filter((row) => row.source_type === 'lager_bil')
      .reduce((sum, row) => sum + (toFiniteNumber(row.expected_budget) || 0), 0),
  };
}

function mergeExpectedMaterialsForBreakdown(primaryExpectedValues, fallbackExpectedValues) {
  const primary = primaryExpectedValues || {};
  const primaryRows = normalizeExpectedMaterialRows(primary);
  if (primaryRows.length) return primary;

  const fallback = fallbackExpectedValues || {};
  const fallbackRows = normalizeExpectedMaterialRows(fallback);
  if (!fallbackRows.length) return primary;

  return {
    ...fallback,
    totalPurchases: pickNumber(primary, ['totalPurchases', 'TotalPurchases']) ?? pickNumber(fallback, ['totalPurchases', 'TotalPurchases']),
  };
}
function buildActualLaborSummary(economy) {
  const legacy = economy.legacyFitterhours || null;
  if (!legacy || legacy.status !== 'LEGACY_VERIFIED') {
    return {
      status: legacy ? legacy.status : 'N/A',
      source: 'ek_v3_legacy_fitterhours',
      hours: null,
      raw_hours: null,
      other_hours: null,
      net_labor: null,
      social_additions: null,
      total_labor: null,
      rows: legacy ? legacy.rows || 0 : 0,
    };
  }

  return {
    status: 'LEGACY_VERIFIED',
    source: 'ek_v3_legacy_fitterhours',
    hours: legacy.actual_hours,
    raw_hours: legacy.raw_hours,
    other_hours: legacy.other_hours,
    net_labor: legacy.actual_net_labor,
    social_additions: legacy.social_additions,
    total_labor: legacy.actual_labor_total,
    basis_total_cost: legacy.basis_total_cost,
    basis_hours_social_cost: legacy.basis_hours_social_cost,
    rows: legacy.rows,
  };
}

function buildActualMaterialSummary(economy, row, expectedMaterials) {
  const source = economy.purchaseInvoiceLines || null;
  if (!source || source.status === 'N/A') {
    return summarizePurchaseLines([], {
      expectedInternalMaterialBucket: expectedMaterials && expectedMaterials.lager_bil_expected,
    });
  }

  if (source.status !== 'VERIFIED') {
    return {
      ...summarizePurchaseLines([], {
        expectedInternalMaterialBucket: expectedMaterials && expectedMaterials.lager_bil_expected,
      }),
      status: source.status || 'UNRESOLVED',
      source: source.source || 'ek_v4_purchaseinvoicelines_direct_project',
      included_in_weighted_completion: false,
      unresolved_reasons: ['purchase_line_source_unresolved'],
    };
  }

  const rows = normalizeEkPurchaseInvoiceLines(source.rows || [], {
    tenantId: row.tenant_id || null,
    projectId: row.project_id || null,
    externalProjectId: row.ek_project_id || null,
    projectReference: row.external_project_ref || null,
  });
  return summarizePurchaseLines(rows, {
    expectedInternalMaterialBucket: expectedMaterials && expectedMaterials.lager_bil_expected,
  });
}
function buildComponents(row, options = {}) {
  const economy = options.ekEconomy || {};
  const expectedSelection = selectExpectedValues(row, economy);
  const budgetSelection = selectBudget(row, economy);
  const expectedValues = expectedSelection.value || {};
  const budget = budgetSelection.value || {};
  const budgetCost = budgetCostNode(budget);
  const materialAdjustments = Array.isArray(options.materialAdjustments) ? options.materialAdjustments : [];
  const materialExpected = buildExpectedMaterialSummary(mergeExpectedMaterialsForBreakdown(expectedValues, economy.budget && economy.budget.expectedValues));
  const actualLabor = buildActualLaborSummary(economy);
  const actualMaterials = buildActualMaterialSummary(economy, row, materialExpected);

  const salaryBudget = pickNumber(budgetCost, ['salaryTotal', 'SalaryTotal']);
  const materialBudget = pickNumber(budgetCost, ['materials', 'Materials']);
  const miscBudget = pickNumber(budgetCost, ['miscellaneousTotal', 'MiscellaneousTotal']);
  const purchaseBudget = pickNumber(budgetCost, ['purchaseTotal', 'PurchaseTotal']);
  const totalBudget = pickNumber(budgetCost, ['total', 'Total']);
  const unresolvedExpectedTotalCosts = pickNumber(budgetCost, ['expectedTotalCosts', 'ExpectedTotalCosts']);

  const expectedNetLabor = pickNumber(expectedValues, ['netLaborExp', 'NetLaborExp']);
  const expectedSocialFee = pickNumber(expectedValues, ['socialFeeExp', 'SocialFeeExp']);
  const expectedLabor = pickNumber(expectedValues, ['totalLaborExp', 'TotalLaborExp']);
  const expectedMaterials = materialExpected.total;
  const expectedMisc = expectedValues ? sumNumbers([
    pickValue(expectedValues, ['miscellaneousPurchases', 'MiscellaneousPurchases']),
    pickValue(expectedValues, ['posts', 'Posts']),
  ]) : null;
  const expectedTotal = expectedValues ? sumNumbers([
    expectedLabor,
    expectedMaterials,
    pickValue(expectedValues, ['miscellaneousPurchases', 'MiscellaneousPurchases']),
    pickValue(expectedValues, ['posts', 'Posts']),
  ]) : null;

  const actualTotal = toFiniteNumber(row.costs);
  const actualTurnover = economy.actualTurnover && economy.actualTurnover.status === 'VERIFIED'
    ? toFiniteNumber(economy.actualTurnover.actual_turnover)
    : null;

  const components = [
    {
      key: 'labor',
      name: 'Timer / arbejdskraft',
      source: `${budgetSelection.source} + ${expectedSelection.source} + ek_v3_legacy_fitterhours`,
      source_status: actualLabor.status === 'LEGACY_VERIFIED' && expectedSelection.value ? 'LEGACY_VERIFIED' : 'PARTIAL',
      budget_cost: salaryBudget,
      expected_cost: expectedLabor,
      actual_cost: actualLabor.total_labor,
      data_quality: actualLabor.status === 'LEGACY_VERIFIED' ? ['legacy_verified'] : ['missing_actual'],
      explanation: 'Actual labor er midlertidigt hentet via V3 targeted fitterhours legacy bridge: net labor + social additions. V4 hourSpent bruges ikke som actual hours.',
    },
    {
      key: 'materials',
      name: 'Materialer / indk\u00f8b',
      source: `${budgetSelection.source} + ${expectedSelection.source} + ${actualMaterials.source}`,
      source_status: actualMaterials.status,
      base_budget_cost: materialBudget,
      base_expected_cost: expectedMaterials,
      actual_cost: actualMaterials.included_in_weighted_completion ? actualMaterials.material_actual : null,
      adjustments: materialAdjustments,
      data_quality: actualMaterials.included_in_weighted_completion
        ? [
          'classified_material_actual',
          actualMaterials.lager_bil_candidate_rows ? 'probable_lager_bil_actual' : null,
        ].filter(Boolean)
        : ['partial', 'missing_actual', ...actualMaterials.unresolved_reasons],
      explanation: actualMaterials.included_in_weighted_completion
        ? 'Actual materials er creditor MATERIAL plus Lager/Bil candidate actual fra direct V4 purchaseinvoicelines. Lager/Bil er identificeret via en sandsynlig EK V4-regel, ikke et officielt dokumenteret Lager/Bil-felt.'
        : 'Actual materials er normaliseret fra direct V4 purchaseinvoicelines, men holdes ude af weighted completion indtil classification coverage er tilstraekkelig.',
    },
  ];

  if ((miscBudget !== null && miscBudget !== 0) || (purchaseBudget !== null && purchaseBudget !== 0) || (expectedMisc !== null && expectedMisc !== 0)) {
    components.push({
      key: 'other',
      name: '\u00d8vrige omkostninger',
      source: 'projectBudget miscellaneous/purchase + expected miscellaneous/posts',
      source_status: 'PARTIAL',
      budget_cost: sumNumbers([miscBudget, purchaseBudget]),
      expected_cost: expectedMisc,
      actual_cost: null,
      data_quality: ['partial', 'missing_actual'],
      explanation: 'POC bucket for \u00f8konomi der ikke er labor eller direkte materialefelt.',
    });
  }

  if (actualTotal !== null) {
    components.push({
      key: 'actual_unclassified',
      name: 'Realiseret total uden komponentfordeling',
      source: 'project_wip.costs / EK v3 Costs',
      source_status: 'UNRESOLVED',
      budget_cost: null,
      expected_cost: null,
      actual_cost: actualTotal,
      included: false,
      data_quality: ['unresolved_mapping'],
      explanation: 'Total actual cost er synlig, men Fielddesk splitter den ikke sikkert i labor/material components.',
    });
  }

  if (unresolvedExpectedTotalCosts !== null && salaryBudget !== unresolvedExpectedTotalCosts && totalBudget !== unresolvedExpectedTotalCosts) {
    components.push({
      key: 'budget_expected_total_costs_unresolved',
      name: 'Budgetfelt: expectedTotalCosts',
      source: 'projectBudget.projectBudgetCostResponseDTO.expectedTotalCosts',
      source_status: 'UNRESOLVED',
      budget_cost: unresolvedExpectedTotalCosts,
      expected_cost: null,
      actual_cost: null,
      included: false,
      data_quality: ['unresolved_mapping'],
      explanation: 'Feltet ligger i budget-subtree og bruges ikke som labor eller total budget uden UI/API-verifikation.',
    });
  }

  return {
    components,
    selected_sources: {
      expected_values: expectedSelection,
      budget: budgetSelection,
    },
    expected_materials: materialExpected,
    actual_labor: actualLabor,
    actual_materials: actualMaterials,
    source_totals: {
      budget_total_from_ek: totalBudget,
      actual_total_from_wip_costs: actualTotal,
      expected_total_from_components: expectedTotal && expectedTotal > 0 ? expectedTotal : null,
      turnover_actual: actualTurnover,
      turnover_expected: pickNumber(expectedValues, ['totalTurnOverExp', 'TotalTurnOverExp']) || toFiniteNumber(row.total_turn_over_exp),
      billed: toFiniteNumber(row.billed),
      ongoing: toFiniteNumber(row.ongoing),
      margin: toFiniteNumber(row.margin),
      coverage: toFiniteNumber(row.coverage),
      hours_budget: toFiniteNumber(row.hours_budget),
      hours_expected: pickNumber(expectedValues, ['hoursExpected', 'HoursExpected']) ?? toFiniteNumber(row.hours_expected),
      hours_actual: actualLabor.hours,
      raw_hours_activity: actualLabor.raw_hours,
      other_hours_not_basis: actualLabor.other_hours,
      remaining_hours_unresolved: toFiniteNumber(row.remaining_hours),
      labor_actual_net: actualLabor.net_labor,
      labor_actual_social: actualLabor.social_additions,
      labor_actual_total: actualLabor.total_labor,
      labor_expected_net: expectedNetLabor,
      labor_expected_social: expectedSocialFee,
      labor_expected_total: expectedLabor,
      materials_expected_total: expectedMaterials,
      materials_actual: actualMaterials.material_actual,
      materials_actual_creditor: actualMaterials.creditor_material_actual,
      lager_bil_actual_candidate: actualMaterials.lager_bil_actual_candidate,
      lager_bil_actual_candidate_rows: actualMaterials.lager_bil_candidate_rows,
      lager_bil_actual_candidate_confidence: actualMaterials.lager_bil_candidate_confidence,
      materials_actual_status: actualMaterials.status,
      materials_actual_included: actualMaterials.included_in_weighted_completion,
      purchase_actual_total: actualMaterials.total_purchase_actual,
      purchase_actual_category_totals: actualMaterials.category_totals,
      purchase_actual_category_rows: actualMaterials.category_rows,
      unallocated_expected_materials: materialExpected.unallocated_expected_materials,
      lager_bil_expected: materialExpected.lager_bil_expected || null,
    },
  };
}

const EXPECTED_HISTORY_FIELDS = Object.freeze([
  { key: 'totalPurchases', oldKey: 'totalPurchasesOld', newKey: 'totalPurchases', label: 'Materialer forventet', category: 'materials' },
  { key: 'totalLaborExp', oldKey: 'totalLaborExpOld', newKey: 'totalLaborExp', label: 'Løn forventet', category: 'labor' },
  { key: 'totalTurnOverExp', oldKey: 'totalTurnOverExpOld', newKey: 'totalTurnOverExp', label: 'Omsætning forventet', category: 'turnover' },
]);

function buildExpectedHistoryEvents(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => EXPECTED_HISTORY_FIELDS.map((field) => {
    const oldValue = toFiniteNumber(row[field.oldKey]);
    const newValue = toFiniteNumber(row[field.newKey]);
    if (oldValue === null || newValue === null || oldValue === newValue) return null;
    const delta = round(newValue - oldValue, 2);
    return {
      row_id: row.id || null,
      field: field.key,
      category: field.category,
      label: field.label,
      previous_value: oldValue,
      current_value: newValue,
      delta,
      delta_percent: oldValue !== 0 ? round((delta / oldValue) * 100, 2) : null,
      changed_at: row.createdDate || null,
      changed_by: row.userName || null,
      note: row.note || '',
      source: 'ek_v4_expectedvalues_history',
      granularity: 'project_expected_total',
    };
  }).filter(Boolean)).sort((left, right) => new Date(right.changed_at || 0) - new Date(left.changed_at || 0));
}
function summarizeDataQuality(calculation) {
  const markers = new Set();
  calculation.components.forEach((component) => {
    (component.data_quality || []).forEach((marker) => markers.add(marker));
  });
  if (calculation.budget_completion.status === 'N/A') markers.add('budget_completion_N/A');
  if (calculation.expected_completion.status === 'N/A') markers.add('expected_completion_N/A');
  if (markers.has('unresolved_mapping') || markers.has('partial')) return 'PARTIAL';
  if (markers.has('probable_lager_bil_actual')) return 'VERIFIED_WITH_PROBABLE_COMPONENT';
  if (markers.has('legacy_verified')) return 'LEGACY_VERIFIED';
  if (markers.has('missing_actual') || markers.has('missing_budget') || markers.has('missing_expected')) return 'PARTIAL';
  return 'VERIFIED';
}

function normalizeHistory(historyResult) {
  const capabilities = {
    total_materials_history: true,
    total_labor_history: true,
    total_turnover_history: true,
    creditor_row_history: false,
    note_history: true,
    user_history: true,
  };

  if (!historyResult || !Array.isArray(historyResult.rows)) {
    return { status: 'N/A', source: 'ek_v4_expectedvalues_history', total_rows_observed: 0, capabilities, rows: [] };
  }

  const rows = historyResult.rows.map((row) => ({
    id: pickValue(row, ['id', 'ID']) || null,
    createdDate: pickValue(row, ['createdDate', 'CreatedDate']) || null,
    userName: pickValue(row, ['userName', 'UserName']) || null,
    note: pickValue(row, ['note', 'Note']) || '',
    totalTurnOverExpOld: pickNumber(row, ['totalTurnOverExpOld', 'TotalTurnOverExpOld']),
    totalTurnOverExp: pickNumber(row, ['totalTurnOverExp', 'TotalTurnOverExp']),
    totalPurchasesOld: pickNumber(row, ['totalPurchasesOld', 'TotalPurchasesOld']),
    totalPurchases: pickNumber(row, ['totalPurchases', 'TotalPurchases']),
    totalLaborExpOld: pickNumber(row, ['totalLaborExpOld', 'TotalLaborExpOld']),
    totalLaborExp: pickNumber(row, ['totalLaborExp', 'TotalLaborExp']),
  })).sort((left, right) => new Date(right.createdDate || 0) - new Date(left.createdDate || 0));

  return {
    status: historyResult.status || 'N/A',
    source: historyResult.source || 'ek_v4_expectedvalues_history',
    total_rows_observed: historyResult.total_rows_observed || rows.length,
    capabilities,
    rows,
    events: buildExpectedHistoryEvents(rows),
  };
}

function buildIgvaPocProject(row, options = {}) {
  const economy = options.ekEconomy || {};
  const componentResult = buildComponents(row, options);
  const calculation = calculateIgvaProjectEconomy({
    components: componentResult.components,
  });

  return {
    project_id: row.project_id,
    ek_project_id: row.ek_project_id || null,
    external_project_ref: row.external_project_ref || null,
    name: row.name || null,
    responsible: {
      code: row.responsible_code || null,
      name: row.responsible_name || null,
      id: row.responsible_id || null,
      team_leader_code: row.team_leader_code || null,
      team_leader_name: row.team_leader_name || null,
      team_leader_id: row.team_leader_id || null,
    },
    lifecycle: {
      status: row.status || null,
      is_closed: row.is_closed === true,
      financial_wip: row.financial_wip,
      is_work_in_progress: row.is_work_in_progress,
    },
    source_totals: componentResult.source_totals,
    expected_materials: componentResult.expected_materials,
    data_sources: {
      expected_values: {
        source: componentResult.selected_sources.expected_values.source,
        status: componentResult.selected_sources.expected_values.status,
        latest_status: economy.expectedLatest ? economy.expectedLatest.status : 'N/A',
        budget_fallback_status: economy.budget ? economy.budget.status : 'N/A',
      },
      budget: {
        source: componentResult.selected_sources.budget.source,
        status: componentResult.selected_sources.budget.status,
      },
      actual_turnover: {
        source: 'ek_v4_financialposts',
        status: economy.actualTurnover ? economy.actualTurnover.status : 'N/A',
        rows_matched: economy.actualTurnover ? economy.actualTurnover.rows_matched || 0 : 0,
      },
      actual_labor: {
        source: 'ek_v3_legacy_fitterhours',
        status: componentResult.actual_labor.status,
        rows: componentResult.actual_labor.rows,
      },
      actual_materials: {
        source: componentResult.actual_materials.source,
        status: componentResult.actual_materials.status,
        included_in_weighted_completion: componentResult.actual_materials.included_in_weighted_completion,
        rows: componentResult.actual_materials.rows,
        positive_rows: componentResult.actual_materials.positive_rows,
        negative_rows: componentResult.actual_materials.negative_rows,
        status_4_rows: componentResult.actual_materials.status_4_rows,
        null_account_rows: componentResult.actual_materials.null_account_rows,
        moved_or_reversed_rows: componentResult.actual_materials.moved_or_reversed_rows,
        classification_coverage: componentResult.actual_materials.classification_coverage,
        unresolved_reasons: componentResult.actual_materials.unresolved_reasons,
        category_totals: componentResult.actual_materials.category_totals,
        category_rows: componentResult.actual_materials.category_rows,
        creditor_material_actual: componentResult.actual_materials.creditor_material_actual,
        lager_bil_actual_candidate: componentResult.actual_materials.lager_bil_actual_candidate,
        lager_bil_candidate_rows: componentResult.actual_materials.lager_bil_candidate_rows,
        lager_bil_candidate_confidence: componentResult.actual_materials.lager_bil_candidate_confidence,
      },
      expected_history: normalizeHistory(economy.expectedHistory),
    },
    calculation,
    data_quality: summarizeDataQuality(calculation),
  };
}

module.exports = {
  buildIgvaPocProject,
  _test: {
    buildComponents,
    buildActualMaterialSummary,
    buildExpectedMaterialSummary,
    normalizeExpectedMaterialRows,
    normalizeHistory,
    buildExpectedHistoryEvents,
    parseJsonValue,
  },
};
