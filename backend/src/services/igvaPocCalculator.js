'use strict';

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasNumber(value) {
  return Number.isFinite(Number(value));
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clampCompletion(rawRatio) {
  if (!Number.isFinite(rawRatio)) {
    return null;
  }
  return Math.min(Math.max(rawRatio, 0), 1);
}

function normalizeAdjustment(adjustment, baseBudgetCost, baseExpectedCost) {
  const rawType = String(adjustment && (adjustment.type || adjustment.adjustment_type) || '').trim().toLowerCase();
  const type = rawType || (hasNumber(adjustment && adjustment.percentage) || hasNumber(adjustment && adjustment.value) ? 'percentage' : 'fixed_amount');
  const percentage = toFiniteNumber(adjustment && (adjustment.percentage ?? adjustment.value));
  const fixedAmount = toFiniteNumber(adjustment && (adjustment.fixed_amount ?? adjustment.amount));
  const budgetBase = toFiniteNumber(baseBudgetCost);
  const expectedBase = toFiniteNumber(baseExpectedCost);

  let calculatedBudgetAmount = null;
  let calculatedExpectedAmount = null;

  if (type === 'percentage') {
    calculatedBudgetAmount = budgetBase === null || percentage === null ? null : budgetBase * percentage;
    calculatedExpectedAmount = expectedBase === null || percentage === null ? null : expectedBase * percentage;
  } else if (type === 'fixed_amount') {
    calculatedBudgetAmount = fixedAmount;
    calculatedExpectedAmount = fixedAmount;
  }

  return {
    name: String(adjustment && adjustment.name ? adjustment.name : 'Adjustment').trim(),
    source: String(adjustment && adjustment.source ? adjustment.source : 'unknown').trim(),
    adjustment_type: type,
    percentage,
    fixed_amount: fixedAmount,
    calculated_budget_amount: calculatedBudgetAmount === null ? null : round(calculatedBudgetAmount, 2),
    calculated_expected_amount: calculatedExpectedAmount === null ? null : round(calculatedExpectedAmount, 2),
    applied_to: String(adjustment && adjustment.applied_to ? adjustment.applied_to : 'base_material_cost').trim(),
  };
}

function applyCostEnvelope({ cost, baseCost, adjustments, basis }) {
  const directCost = toFiniteNumber(cost);
  const directBase = toFiniteNumber(baseCost);
  const base = directBase !== null ? directBase : directCost;
  if (base === null) {
    return { total: null, base: null, adjustmentTotal: 0, adjustments: [] };
  }

  const normalizedAdjustments = Array.isArray(adjustments)
    ? adjustments.map((item) => normalizeAdjustment(item, basis === 'budget' ? base : null, basis === 'expected' ? base : null))
    : [];

  const adjustmentTotal = normalizedAdjustments.reduce((sum, item) => {
    const amount = basis === 'budget' ? item.calculated_budget_amount : item.calculated_expected_amount;
    return sum + (toFiniteNumber(amount) || 0);
  }, 0);

  return {
    total: round(base + adjustmentTotal, 2),
    base,
    adjustmentTotal: round(adjustmentTotal, 2),
    adjustments: normalizedAdjustments,
  };
}

function buildComponent(input) {
  const baseBudgetCost = toFiniteNumber(input.base_budget_cost ?? input.baseBudgetCost);
  const baseExpectedCost = toFiniteNumber(input.base_expected_cost ?? input.baseExpectedCost);
  const inputAdjustments = Array.isArray(input.adjustments) ? input.adjustments : [];
  const budgetEnvelope = applyCostEnvelope({
    cost: input.budget_cost ?? input.budgetCost,
    baseCost: baseBudgetCost,
    adjustments: inputAdjustments,
    basis: 'budget',
  });
  const expectedEnvelope = applyCostEnvelope({
    cost: input.expected_cost ?? input.expectedCost,
    baseCost: baseExpectedCost,
    adjustments: inputAdjustments,
    basis: 'expected',
  });
  const actualCost = toFiniteNumber(input.actual_cost ?? input.actualCost);
  const budgetCost = budgetEnvelope.total;
  const expectedCost = expectedEnvelope.total;
  const budgetRaw = actualCost === null || budgetCost === null || budgetCost <= 0 ? null : actualCost / budgetCost;
  const expectedRaw = actualCost === null || expectedCost === null || expectedCost <= 0 ? null : actualCost / expectedCost;
  const dataQuality = new Set(Array.isArray(input.data_quality) ? input.data_quality : []);

  if (budgetCost === null || budgetCost <= 0) dataQuality.add('missing_budget');
  if (expectedCost === null || expectedCost <= 0) dataQuality.add('missing_expected');
  if (actualCost === null) dataQuality.add('missing_actual');
  if (input.unresolved_mapping === true) dataQuality.add('unresolved_mapping');
  if (dataQuality.size === 0) dataQuality.add('complete');

  return {
    key: String(input.key || 'component').trim(),
    name: String(input.name || input.key || 'Component').trim(),
    source: String(input.source || 'unknown').trim(),
    source_status: String(input.source_status || input.sourceStatus || 'N/A').trim(),
    budget_cost: budgetCost,
    expected_cost: expectedCost,
    actual_cost: actualCost,
    base_budget_cost: budgetEnvelope.base,
    base_expected_cost: expectedEnvelope.base,
    adjustments: inputAdjustments.map((_, index) => {
      const budgetAdjustment = budgetEnvelope.adjustments[index] || null;
      const expectedAdjustment = expectedEnvelope.adjustments[index] || null;
      const sourceAdjustment = budgetAdjustment || expectedAdjustment || normalizeAdjustment(inputAdjustments[index], null, null);
      return {
        ...sourceAdjustment,
        calculated_budget_amount: budgetAdjustment ? budgetAdjustment.calculated_budget_amount : null,
        calculated_expected_amount: expectedAdjustment ? expectedAdjustment.calculated_expected_amount : null,
      };
    }),
    adjustment_budget_total: budgetEnvelope.adjustmentTotal,
    adjustment_expected_total: expectedEnvelope.adjustmentTotal,
    budget_progress_raw: budgetRaw === null ? null : round(budgetRaw),
    budget_progress_capped: budgetRaw === null ? null : round(clampCompletion(budgetRaw)),
    expected_progress_raw: expectedRaw === null ? null : round(expectedRaw),
    expected_progress_capped: expectedRaw === null ? null : round(clampCompletion(expectedRaw)),
    budget_weight: null,
    expected_weight: null,
    included: input.included !== false,
    data_quality: Array.from(dataQuality),
    explanation: String(input.explanation || '').trim(),
  };
}

function summarizeBasis(components, basis) {
  const costField = basis === 'budget' ? 'budget_cost' : 'expected_cost';
  const completionField = basis === 'budget' ? 'budget_progress_capped' : 'expected_progress_capped';
  const known = components.filter((component) => component.included && component[costField] !== null && component[costField] > 0);
  const valid = known.filter((component) => component[completionField] !== null);
  const knownWeight = known.reduce((sum, component) => sum + component[costField], 0);
  const validWeight = valid.reduce((sum, component) => sum + component[costField], 0);
  const excluded = known
    .filter((component) => component[completionField] === null)
    .map((component) => ({
      key: component.key,
      name: component.name,
      reason: component.data_quality,
    }));

  if (validWeight <= 0) {
    return {
      value: null,
      percent: null,
      status: 'N/A',
      coverage_percent: knownWeight > 0 ? 0 : null,
      included_weight: 0,
      known_weight: round(knownWeight, 2),
      excluded,
      included: [],
      formula: null,
    };
  }

  const weightedValue = valid.reduce((sum, component) => {
    return sum + component[costField] * component[completionField];
  }, 0) / validWeight;

  return {
    value: round(weightedValue),
    percent: round(weightedValue * 100, 2),
    status: 'calculated',
    coverage_percent: knownWeight > 0 ? round((validWeight / knownWeight) * 100, 2) : null,
    included_weight: round(validWeight, 2),
    known_weight: round(knownWeight, 2),
    excluded,
    included: valid.map((component) => ({
      key: component.key,
      name: component.name,
      weight: round(component[costField], 2),
      completion: component[completionField],
    })),
    formula: valid
      .map((component) => `${component.key}:${round(component[costField], 2)}x${round(component[completionField], 4)}`)
      .join(' + '),
  };
}

function summarizeCoverage(budgetSummary, expectedSummary) {
  const expectedKnown = toFiniteNumber(expectedSummary.known_weight);
  const budgetKnown = toFiniteNumber(budgetSummary.known_weight);
  const basis = expectedKnown !== null && expectedKnown > 0 ? 'expected' : 'budget';
  const selected = basis === 'expected' ? expectedSummary : budgetSummary;

  return {
    basis,
    percent: selected.coverage_percent,
    included_weight: selected.included_weight,
    known_weight: selected.known_weight,
    included: selected.included,
    excluded: selected.excluded,
    status: selected.status,
    has_known_weight: basis === 'expected' ? expectedKnown > 0 : budgetKnown > 0,
  };
}

function calculateIgvaProjectEconomy(input) {
  const components = (Array.isArray(input.components) ? input.components : []).map(buildComponent);
  const budgetSummary = summarizeBasis(components, 'budget');
  const expectedSummary = summarizeBasis(components, 'expected');

  components.forEach((component) => {
    component.budget_weight = budgetSummary.included_weight > 0 && component.budget_cost !== null && component.budget_progress_capped !== null
      ? round(component.budget_cost / budgetSummary.included_weight)
      : null;
    component.expected_weight = expectedSummary.included_weight > 0 && component.expected_cost !== null && component.expected_progress_capped !== null
      ? round(component.expected_cost / expectedSummary.included_weight)
      : null;
  });

  const budgetTotal = components.reduce((sum, component) => sum + (component.included && component.budget_cost !== null ? component.budget_cost : 0), 0);
  const expectedTotal = components.reduce((sum, component) => sum + (component.included && component.expected_cost !== null ? component.expected_cost : 0), 0);
  const actualTotal = components.reduce((sum, component) => sum + (component.included && component.actual_cost !== null ? component.actual_cost : 0), 0);

  return {
    project_manager_completion_percent: toFiniteNumber(input.project_manager_completion_percent ?? input.projectManagerCompletionPercent),
    budget_completion: budgetSummary,
    expected_completion: expectedSummary,
    calculation_coverage: summarizeCoverage(budgetSummary, expectedSummary),
    totals: {
      budget_cost: budgetTotal > 0 ? round(budgetTotal, 2) : null,
      expected_cost: expectedTotal > 0 ? round(expectedTotal, 2) : null,
      actual_cost: actualTotal > 0 ? round(actualTotal, 2) : null,
      expected_deviation: expectedTotal > 0 && actualTotal > 0 ? round(expectedTotal - actualTotal, 2) : null,
    },
    components,
  };
}

module.exports = {
  calculateIgvaProjectEconomy,
  _test: {
    buildComponent,
    normalizeAdjustment,
    summarizeBasis,
    summarizeCoverage,
  },
};