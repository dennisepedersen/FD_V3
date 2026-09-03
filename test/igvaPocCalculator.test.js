'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateIgvaProjectEconomy } = require('../backend/src/services/igvaPocCalculator');

function pct(result, path) {
  return path.split('.').reduce((value, key) => value && value[key], result);
}

test('case 1: weighted completion uses economic weight, not simple average', () => {
  const result = calculateIgvaProjectEconomy({
    components: [
      { key: 'labor', budget_cost: 600000, expected_cost: 600000, actual_cost: 300000 },
      { key: 'materials', budget_cost: 10000, expected_cost: 10000, actual_cost: 9000 },
    ],
  });

  assert.equal(Math.round(pct(result, 'budget_completion.percent') * 100) / 100, 50.66);
});

test('case 2: component completion is capped at 100 percent but raw overrun is preserved', () => {
  const result = calculateIgvaProjectEconomy({
    components: [
      { key: 'materials', budget_cost: 10000, expected_cost: 10000, actual_cost: 15000 },
    ],
  });
  const material = result.components[0];

  assert.equal(material.budget_progress_raw, 1.5);
  assert.equal(material.budget_progress_capped, 1);
  assert.equal(result.budget_completion.percent, 100);
});

test('case 3: expected labor increase lowers expected completion', () => {
  const baseline = calculateIgvaProjectEconomy({
    components: [{ key: 'labor', budget_cost: 600000, expected_cost: 600000, actual_cost: 300000 }],
  });
  const increased = calculateIgvaProjectEconomy({
    components: [{ key: 'labor', budget_cost: 600000, expected_cost: 800000, actual_cost: 300000 }],
  });

  assert.equal(baseline.expected_completion.percent, 50);
  assert.equal(increased.expected_completion.percent, 37.5);
});

test('case 4: expected material increase lowers material completion and changes project weight', () => {
  const baseline = calculateIgvaProjectEconomy({
    components: [
      { key: 'labor', expected_cost: 600000, actual_cost: 300000 },
      { key: 'materials', expected_cost: 106000, actual_cost: 90000 },
    ],
  });
  const increased = calculateIgvaProjectEconomy({
    components: [
      { key: 'labor', expected_cost: 600000, actual_cost: 300000 },
      { key: 'materials', expected_cost: 159000, actual_cost: 90000 },
    ],
  });

  const baselineMaterials = baseline.components.find((item) => item.key === 'materials');
  const increasedMaterials = increased.components.find((item) => item.key === 'materials');
  assert.ok(increasedMaterials.expected_progress_capped < baselineMaterials.expected_progress_capped);
  assert.ok(increasedMaterials.expected_weight > baselineMaterials.expected_weight);
});

test('case 5: one Kalkia percentage adjustment updates budget material envelope', () => {
  const result = calculateIgvaProjectEconomy({
    components: [
      {
        key: 'materials',
        base_budget_cost: 100000,
        actual_cost: 0,
        adjustments: [{ name: 'Befaestigelse', type: 'percentage', percentage: 0.02, source: 'kalkia' }],
      },
    ],
  });

  assert.equal(result.components[0].budget_cost, 102000);
  assert.equal(result.components[0].adjustments[0].calculated_budget_amount, 2000);
});

test('case 6: Kalkia percentage follows changed expected base materials', () => {
  const result = calculateIgvaProjectEconomy({
    components: [
      {
        key: 'materials',
        base_expected_cost: 150000,
        actual_cost: 0,
        adjustments: [{ name: 'Befaestigelse', type: 'percentage', percentage: 0.02, source: 'kalkia' }],
      },
    ],
  });

  assert.equal(result.components[0].expected_cost, 153000);
  assert.equal(result.components[0].adjustments[0].calculated_expected_amount, 3000);
});

test('case 7: multiple Kalkia percentages are summed into the material envelope', () => {
  const result = calculateIgvaProjectEconomy({
    components: [
      {
        key: 'materials',
        base_budget_cost: 100000,
        actual_cost: 0,
        adjustments: [
          { name: 'Befaestigelse', type: 'percentage', percentage: 0.02, source: 'kalkia' },
          { name: 'Spild', type: 'percentage', percentage: 0.03, source: 'kalkia' },
          { name: 'Svind', type: 'percentage', percentage: 0.01, source: 'kalkia' },
        ],
      },
    ],
  });

  assert.equal(result.components[0].budget_cost, 106000);
});

test('case 8: missing budget gives N/A for budget completion', () => {
  const result = calculateIgvaProjectEconomy({
    components: [{ key: 'labor', expected_cost: 100000, actual_cost: 50000 }],
  });

  assert.equal(result.budget_completion.status, 'N/A');
  assert.equal(result.budget_completion.percent, null);
});

test('case 9: missing expected gives N/A for expected completion', () => {
  const result = calculateIgvaProjectEconomy({
    components: [{ key: 'labor', budget_cost: 100000, actual_cost: 50000 }],
  });

  assert.equal(result.expected_completion.status, 'N/A');
  assert.equal(result.expected_completion.percent, null);
});

test('case 10: actual zero with valid budget gives zero percent completion', () => {
  const result = calculateIgvaProjectEconomy({
    components: [{ key: 'labor', budget_cost: 100000, expected_cost: 100000, actual_cost: 0 }],
  });

  assert.equal(result.budget_completion.percent, 0);
});

test('case 11: all components at 100 percent return 100 percent', () => {
  const result = calculateIgvaProjectEconomy({
    components: [
      { key: 'labor', budget_cost: 600000, expected_cost: 700000, actual_cost: 700000 },
      { key: 'materials', budget_cost: 100000, expected_cost: 100000, actual_cost: 100000 },
    ],
  });

  assert.equal(result.budget_completion.percent, 100);
  assert.equal(result.expected_completion.percent, 100);
});

test('case 12: unclassified economy component is retained and can be included', () => {
  const result = calculateIgvaProjectEconomy({
    components: [
      { key: 'labor', budget_cost: 100000, expected_cost: 100000, actual_cost: 50000 },
      { key: 'unclassified', budget_cost: 50000, expected_cost: 50000, actual_cost: 25000 },
    ],
  });

  assert.ok(result.components.some((item) => item.key === 'unclassified'));
  assert.equal(result.budget_completion.included_weight, 150000);
});

test('case 13: material adjustments are not independent false zero completion rows', () => {
  const result = calculateIgvaProjectEconomy({
    components: [
      {
        key: 'materials',
        base_budget_cost: 100000,
        actual_cost: 50000,
        adjustments: [
          { name: 'Spild', type: 'percentage', percentage: 0.03, source: 'kalkia' },
        ],
      },
    ],
  });

  assert.equal(result.components.length, 1);
  assert.equal(result.components[0].adjustments.length, 1);
  assert.equal(result.components[0].budget_cost, 103000);
});

test('case 14: remaining hours are not derived from money divided by hourly cost', () => {
  const result = calculateIgvaProjectEconomy({
    components: [{ key: 'labor', budget_cost: 10000, expected_cost: 10000, actual_cost: 5000 }],
    remaining_cost: 5000,
    historical_average_hourly_cost: 250,
  });

  assert.equal(Object.prototype.hasOwnProperty.call(result, 'remaining_hours'), false);
});

const { buildIgvaPocProject, _test: igvaAdapterTest } = require('../backend/src/services/igvaPocAdapter');
const { _test: ekClientTest } = require('../backend/src/services/igvaPocEkClient');
const { _test: igvaServiceTest } = require('../backend/src/services/igvaPocService');

function baseIgvaRow(overrides = {}) {
  return {
    project_id: 'project-1',
    ek_project_id: 25906,
    external_project_ref: '80396-003',
    name: 'Kontrolprojekt',
    responsible_code: 'DEP',
    responsible_name: 'Dennis',
    status: 'open',
    is_closed: false,
    costs: null,
    project_expected_values: null,
    project_budget: null,
    ...overrides,
  };
}

function economyFixture(overrides = {}) {
  return {
    expectedLatest: {
      status: 'VERIFIED',
      source: 'ek_v4_expectedvalues_latest',
      value: {
        totalTurnOverExp: 9300525,
        netLaborExp: 1182800,
        socialFeeExp: 721508,
        totalLaborExp: 1904308,
        totalPurchases: 3030260,
        creditorExpectedValues: [],
      },
    },
    budget: {
      status: 'VERIFIED',
      source: 'ek_v4_projects_budgets',
      projectBudget: {
        projectBudgetCostResponseDTO: {
          salaryTotal: 1904308,
          materials: 3030260,
          total: 4934568,
        },
      },
      expectedValues: null,
    },
    expectedHistory: { status: 'VERIFIED', source: 'ek_v4_expectedvalues_history', rows: [] },
    actualTurnover: {
      status: 'VERIFIED',
      source: 'ek_v4_financialposts',
      actual_turnover: 4383492,
      rows_matched: 12,
    },
    legacyFitterhours: {
      status: 'LEGACY_VERIFIED',
      source: 'ek_v3_legacy_fitterhours',
      rows: 538,
      actual_hours: 2868,
      raw_hours: 4176.5,
      other_hours: 1308.5,
      basis_total_cost: 1262635.05375,
      basis_hours_social_cost: 478389.67875,
      actual_net_labor: 784245.375,
      social_additions: 516385.05375,
      actual_labor_total: 1300630.42875,
    },
    ...overrides,
  };
}

test('case 15: v4 latest expected values are preferred when successful', () => {
  const project = buildIgvaPocProject(baseIgvaRow(), { ekEconomy: economyFixture() });

  assert.equal(project.data_sources.expected_values.source, 'ek_v4_expectedvalues_latest');
  assert.equal(project.data_sources.expected_values.status, 'VERIFIED');
  assert.equal(project.source_totals.turnover_expected, 9300525);
  assert.equal(project.source_totals.labor_expected_total, 1904308);
  assert.equal(project.source_totals.materials_expected_total, 3030260);
});

test('case 16: v4 latest failure falls back to budget embedded expected values', () => {
  const project = buildIgvaPocProject(baseIgvaRow(), {
    ekEconomy: economyFixture({
      expectedLatest: { status: 'UNRESOLVED', source: 'ek_v4_expectedvalues_latest', value: null, http_status: 500 },
      budget: {
        status: 'VERIFIED',
        source: 'ek_v4_projects_budgets',
        projectBudget: { projectBudgetCostResponseDTO: { salaryTotal: 1000, materials: 2000 } },
        expectedValues: { totalLaborExp: 1100, totalPurchases: 2100, totalTurnOverExp: 5000 },
      },
    }),
  });

  assert.equal(project.data_sources.expected_values.source, 'ek_v4_projects_budgets.projectExpectedValues');
  assert.equal(project.source_totals.labor_expected_total, 1100);
  assert.equal(project.source_totals.materials_expected_total, 2100);
});

test('case 17: v3 legacy fitterhours BasisTotalHours are used for actual hours', () => {
  const project = buildIgvaPocProject(baseIgvaRow(), { ekEconomy: economyFixture() });

  assert.equal(project.source_totals.hours_actual, 2868);
  assert.equal(project.data_sources.actual_labor.source, 'ek_v3_legacy_fitterhours');
  assert.equal(project.data_sources.actual_labor.status, 'LEGACY_VERIFIED');
});

test('case 18: raw v4/project-detail hourSpent must not become actual hours', () => {
  const project = buildIgvaPocProject(baseIgvaRow(), { ekEconomy: economyFixture() });

  assert.equal(project.source_totals.raw_hours_activity, 4176.5);
  assert.equal(project.source_totals.hours_actual, 2868);
  assert.notEqual(project.source_totals.hours_actual, project.source_totals.raw_hours_activity);
});

test('case 19: v3 legacy fitterhours calculate actual labor and social additions', async () => {
  const rows = [{
    BasisTotalHours: 2868,
    Hours: 4176.5,
    FitterHourWorkTypeOtherTotalHours: 1308.5,
    BasisTotalCost: 1262635.05375,
    BasisHoursSocialCost: 478389.67875,
    SocialTaxes: 516385.05375,
  }];
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => ({ successObjects: { data: rows } }) });
  const result = await ekClientTest.readLegacyFitterhours(fakeFetch, { baseUrl: 'https://ek.example', apiKey: 'secret', siteName: 'site' }, 25906);

  assert.equal(result.status, 'LEGACY_VERIFIED');
  assert.equal(result.actual_hours, 2868);
  assert.equal(result.actual_net_labor, 784245.375);
  assert.equal(result.social_additions, 516385.05375);
  assert.equal(result.actual_labor_total, 1300630.42875);
});

test('case 20: expected materials residual is calculated and Lager/Bil is a bucket, not creditor', () => {
  const project = buildIgvaPocProject(baseIgvaRow(), {
    ekEconomy: economyFixture({
      expectedLatest: {
        status: 'VERIFIED',
        source: 'ek_v4_expectedvalues_latest',
        value: {
          totalLaborExp: 1000,
          totalPurchases: 3030260,
          creditorExpectedValues: [
            { creditorName: 'Sveistrup A/S', creditorReference: '45907000', budget: 570000 },
            { creditorName: null, creditorReference: '-1', creditorID: 1, budget: 100000 },
            { creditorName: 'Andre', creditorReference: 'A', budget: 2160848 },
          ],
        },
      },
    }),
  });
  const lagerBil = project.expected_materials.breakdown.find((row) => row.source_type === 'lager_bil');

  assert.equal(project.source_totals.unallocated_expected_materials, 199412);
  assert.equal(lagerBil.label, 'Lager/Bil');
  assert.equal(lagerBil.is_creditor, false);
  assert.equal(project.source_totals.lager_bil_expected, 100000);
});

test('case 21: unresolved actual materials are excluded from weighted completion and coverage', () => {
  const project = buildIgvaPocProject(baseIgvaRow(), {
    ekEconomy: economyFixture({
      expectedLatest: {
        status: 'VERIFIED',
        source: 'ek_v4_expectedvalues_latest',
        value: { totalLaborExp: 100, totalPurchases: 100 },
      },
      budget: {
        status: 'VERIFIED',
        source: 'ek_v4_projects_budgets',
        projectBudget: { projectBudgetCostResponseDTO: { salaryTotal: 100, materials: 100 } },
        expectedValues: null,
      },
      legacyFitterhours: {
        status: 'LEGACY_VERIFIED',
        rows: 1,
        actual_hours: 1,
        raw_hours: 1,
        other_hours: 0,
        actual_net_labor: 50,
        social_additions: 0,
        actual_labor_total: 50,
      },
    }),
  });

  assert.equal(project.calculation.expected_completion.percent, 50);
  assert.equal(project.calculation.calculation_coverage.percent, 50);
  assert.deepEqual(project.calculation.expected_completion.excluded.map((item) => item.key), ['materials']);
  assert.equal(project.data_sources.actual_materials.included_in_weighted_completion, false);
});

test('case 22: missing budget remains N/A while expected can still be partial', () => {
  const project = buildIgvaPocProject(baseIgvaRow(), {
    ekEconomy: economyFixture({
      budget: { status: 'N/A', source: 'ek_v4_projects_budgets', projectBudget: null, expectedValues: null },
    }),
  });

  assert.equal(project.calculation.budget_completion.status, 'N/A');
  assert.equal(project.calculation.expected_completion.status, 'calculated');
});

test('case 23: missing expected returns N/A for expected completion', () => {
  const project = buildIgvaPocProject(baseIgvaRow(), {
    ekEconomy: economyFixture({
      expectedLatest: { status: 'N/A', source: 'ek_v4_expectedvalues_latest', value: null },
      budget: {
        status: 'VERIFIED',
        source: 'ek_v4_projects_budgets',
        projectBudget: { projectBudgetCostResponseDTO: { salaryTotal: 100, materials: 100 } },
        expectedValues: null,
      },
    }),
  });

  assert.equal(project.calculation.expected_completion.status, 'N/A');
});

test('case 24: legacy actual source is marked on labor component', () => {
  const project = buildIgvaPocProject(baseIgvaRow(), { ekEconomy: economyFixture() });
  const labor = project.calculation.components.find((item) => item.key === 'labor');

  assert.equal(labor.source_status, 'LEGACY_VERIFIED');
  assert.ok(labor.data_quality.includes('legacy_verified'));
});

test('case 25: v4 financialposts turnover is normalized from account 1020', async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ successObjects: { data: [{ financialAccount: '1020 Fakturering', value: -4383492 }] } }),
  });
  const result = await ekClientTest.readActualTurnover(fakeFetch, { baseUrl: 'https://ek.example', apiKey: 'secret', siteName: 'site' }, 25906);

  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.actual_turnover, 4383492);
  assert.equal(result.signed_turnover_sum, -4383492);
});
test('case 26: v3 legacy fitterhours unwraps successObjects container rows', async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      successObjects: [{
        data: [
          { BasisTotalHours: 2, Hours: 3, FitterHourWorkTypeOtherTotalHours: 1, BasisTotalCost: 200, BasisHoursSocialCost: 20, SocialTaxes: 30 },
          { BasisTotalHours: 4, Hours: 5, FitterHourWorkTypeOtherTotalHours: 1, BasisTotalCost: 400, BasisHoursSocialCost: 40, SocialTaxes: 60 },
        ],
      }],
    }),
  });
  const result = await ekClientTest.readLegacyFitterhours(fakeFetch, { baseUrl: 'https://ek.example', apiKey: 'secret', siteName: 'site' }, 25906);

  assert.equal(result.rows, 2);
  assert.equal(result.actual_hours, 6);
  assert.equal(result.raw_hours, 8);
  assert.equal(result.actual_net_labor, 540);
  assert.equal(result.social_additions, 90);
});

test('case 27: latest totals use budget endpoint expected rows for material breakdown fallback', () => {
  const project = buildIgvaPocProject(baseIgvaRow(), {
    ekEconomy: economyFixture({
      expectedLatest: {
        status: 'VERIFIED',
        source: 'ek_v4_expectedvalues_latest',
        value: { totalLaborExp: 1000, totalPurchases: 3030260, totalTurnOverExp: 9300525 },
      },
      budget: {
        status: 'VERIFIED',
        source: 'ek_v4_projects_budgets',
        projectBudget: { projectBudgetCostResponseDTO: { salaryTotal: 1000, materials: 3030260 } },
        expectedValues: {
          totalPurchases: 999,
          creditorExpectedValues: [
            { creditorName: 'A', creditorReference: '1', budget: 2760848 },
            { creditorName: null, creditorReference: '-1', creditorID: 1, budget: 100000 },
          ],
        },
      },
    }),
  });

  assert.equal(project.source_totals.materials_expected_total, 3030260);
  assert.equal(project.source_totals.unallocated_expected_materials, 169412);
  assert.equal(project.source_totals.lager_bil_expected, 100000);
});
test('case 28: v3 legacy fitterhours derive basis social cost from social percent when explicit field is absent', async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      successObjects: {
        data: [
          { BasisTotalHours: 7, Hours: 7, BasisTotalCost: 3042.9, SocialTaxesInPercent: 61, SocialTaxes: 1152.9 },
        ],
      },
    }),
  });
  const result = await ekClientTest.readLegacyFitterhours(fakeFetch, { baseUrl: 'https://ek.example', apiKey: 'secret', siteName: 'site' }, 25906);

  assert.equal(result.status, 'LEGACY_VERIFIED');
  assert.equal(result.basis_hours_social_cost, 1152.9);
  assert.equal(result.actual_net_labor, 1890);
  assert.equal(result.actual_labor_total, 3042.9);
});

test('case 29: expected material rows support nested creditor objects from budgets endpoint', () => {
  const rows = igvaAdapterTest.normalizeExpectedMaterialRows({
    creditorExpectedValues: [
      { budget: 100000, creditor: { creditorID: 1, creditorName: null, creditorReference: '-1' } },
      { budget: 570000, creditor: { creditorID: 139, creditorName: 'Sveistrup A/S', creditorReference: '45907000' } },
    ],
  });

  assert.equal(rows[0].source_type, 'lager_bil');
  assert.equal(rows[0].is_creditor, false);
  assert.equal(rows[0].label, 'Lager/Bil');
  assert.equal(rows[1].source_type, 'creditor');
  assert.equal(rows[1].creditor_name, 'Sveistrup A/S');
});

test('case 30: igva project ref filter narrows scoped rows before EK enrichment', () => {
  const rows = [
    { external_project_ref: '80396-003' },
    { external_project_ref: '80396-004' },
  ];

  assert.deepEqual(igvaServiceTest.filterProjectsByRef(rows, ' 80396-003 '), [rows[0]]);
  assert.equal(igvaServiceTest.filterProjectsByRef(rows, '').length, 2);
});

test('case 31: expected history normalization keeps all rows in descending chronology', () => {
  const history = igvaAdapterTest.normalizeHistory({
    status: 'VERIFIED',
    source: 'ek_v4_expectedvalues_history',
    total_rows_observed: 3,
    rows: [
      { id: 1, createdDate: '2026-01-02T10:00:00', userName: 'DEP', totalPurchasesOld: 100, totalPurchases: 200 },
      { id: 2, createdDate: '2026-01-03T10:00:00', userName: 'DEP', totalPurchasesOld: 200, totalPurchases: 175 },
      { id: 3, createdDate: '2026-01-01T10:00:00', userName: 'DEP', totalTurnOverExpOld: 1000, totalTurnOverExp: 1100 },
    ],
  });

  assert.equal(history.rows.length, 3);
  assert.equal(history.rows[0].id, 2);
  assert.equal(history.rows[2].id, 3);
  assert.equal(history.events[0].row_id, 2);
  assert.equal(history.events[0].label, 'Materialer forventet');
  assert.equal(history.events[0].delta, -25);
});

test('case 32: expected history events calculate positive and negative deltas', () => {
  const events = igvaAdapterTest.buildExpectedHistoryEvents([
    { id: 10, createdDate: '2026-02-01T08:00:00', userName: 'DEP', totalPurchasesOld: 4000000, totalPurchases: 3030260 },
    { id: 11, createdDate: '2026-02-02T08:00:00', userName: 'DEP', totalTurnOverExpOld: 9300525, totalTurnOverExp: 9348525 },
  ]);

  const material = events.find((event) => event.category === 'materials');
  const turnover = events.find((event) => event.category === 'turnover');
  assert.equal(material.delta, -969740);
  assert.equal(material.delta_percent, -24.24);
  assert.equal(turnover.delta, 48000);
  assert.equal(turnover.delta_percent, 0.52);
});

test('case 33: expected history keeps missing note and user as empty/null without inventing values', () => {
  const events = igvaAdapterTest.buildExpectedHistoryEvents([
    { id: 12, createdDate: '2026-02-03T08:00:00', userName: null, note: '', totalLaborExpOld: 1000, totalLaborExp: 1250 },
  ]);

  assert.equal(events.length, 1);
  assert.equal(events[0].changed_by, null);
  assert.equal(events[0].note, '');
  assert.equal(events[0].label, 'Løn forventet');
});

test('case 34: expected history gracefully handles no history rows', () => {
  const history = igvaAdapterTest.normalizeHistory({ status: 'VERIFIED', source: 'ek_v4_expectedvalues_history', rows: [] });

  assert.equal(history.rows.length, 0);
  assert.equal(history.events.length, 0);
  assert.equal(history.capabilities.creditor_row_history, false);
});

test('case 35: expected history does not fabricate individual creditor history', () => {
  const history = igvaAdapterTest.normalizeHistory({
    status: 'VERIFIED',
    source: 'ek_v4_expectedvalues_history',
    rows: [
      { id: 13, createdDate: '2026-02-04T08:00:00', userName: 'DEP', totalPurchasesOld: 1000, totalPurchases: 2000, creditorExpectedValues: [{ creditorName: 'Sveistrup', budget: 570000 }] },
    ],
  });

  assert.equal(history.capabilities.creditor_row_history, false);
  assert.equal(history.events.length, 1);
  assert.equal(history.events[0].granularity, 'project_expected_total');
  assert.equal(Object.prototype.hasOwnProperty.call(history.events[0], 'creditorName'), false);
});
const igvaPocQueries = require('../backend/src/db/queries/igvaPoc');
const igvaPocService = require('../backend/src/services/igvaPocService');

function createCountingEkClient(calls) {
  const fixture = economyFixture();
  return {
    readExpectedLatest: async () => { calls.expectedLatest += 1; return fixture.expectedLatest; },
    readBudget: async () => { calls.budget += 1; return fixture.budget; },
    readExpectedHistory: async () => { calls.expectedHistory += 1; return fixture.expectedHistory; },
    readActualTurnover: async () => { calls.actualTurnover += 1; return fixture.actualTurnover; },
    readLegacyFitterhours: async () => { calls.legacyFitterhours += 1; return fixture.legacyFitterhours; },
    readPurchaseInvoiceLinesByProject: async () => { calls.purchaseInvoiceLines += 1; return { status: 'VERIFIED', source: 'ek_v4_purchaseinvoicelines_direct_project', rows: [], total_rows_observed: 0 }; },
  };
}

test('case 36: IGVA online project list does not read through EK without project_ref', async (t) => {
  const original = igvaPocQueries.listIgvaPocProjectsForUser;
  t.after(() => { igvaPocQueries.listIgvaPocProjectsForUser = original; });

  igvaPocQueries.listIgvaPocProjectsForUser = async () => [
    baseIgvaRow({ project_id: 'project-1', external_project_ref: '80396-003' }),
    baseIgvaRow({ project_id: 'project-2', external_project_ref: '80279-003' }),
  ];
  const calls = { expectedLatest: 0, budget: 0, expectedHistory: 0, actualTurnover: 0, legacyFitterhours: 0, purchaseInvoiceLines: 0 };

  const result = await igvaPocService.listIgvaPocProjects({}, {
    tenantId: 'tenant-1',
    userId: 'user-1',
    ekClient: createCountingEkClient(calls),
  });

  assert.equal(result.economy_mode, 'igva_poc_v3_1_project_list_only');
  assert.equal(result.projects.length, 2);
  assert.equal(result.projects[0].economy_detail, 'not_loaded');
  assert.equal(result.projects[0].calculation, null);
  assert.deepEqual(Object.values(calls), [0, 0, 0, 0, 0, 0]);
});

test('case 37: IGVA online project_ref reads EK economy only for scoped matching project', async (t) => {
  const original = igvaPocQueries.listIgvaPocProjectsForUser;
  t.after(() => { igvaPocQueries.listIgvaPocProjectsForUser = original; });

  igvaPocQueries.listIgvaPocProjectsForUser = async () => [
    baseIgvaRow({ project_id: 'project-1', ek_project_id: 25906, external_project_ref: '80396-003' }),
    baseIgvaRow({ project_id: 'project-2', ek_project_id: 20785, external_project_ref: '80279-003' }),
  ];
  const calls = { expectedLatest: 0, budget: 0, expectedHistory: 0, actualTurnover: 0, legacyFitterhours: 0, purchaseInvoiceLines: 0 };

  const result = await igvaPocService.listIgvaPocProjects({}, {
    tenantId: 'tenant-1',
    userId: 'user-1',
    projectRef: '80396-003',
    ekClient: createCountingEkClient(calls),
  });

  assert.equal(result.economy_mode, 'igva_poc_v3_1_selected_project_read_through');
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].external_project_ref, '80396-003');
  assert.ok(result.projects[0].calculation);
  assert.deepEqual(Object.values(calls), [1, 1, 1, 1, 1, 1]);
});

test('case 38: IGVA online unauthorized or out-of-scope project_ref does not call EK', async (t) => {
  const original = igvaPocQueries.listIgvaPocProjectsForUser;
  t.after(() => { igvaPocQueries.listIgvaPocProjectsForUser = original; });

  igvaPocQueries.listIgvaPocProjectsForUser = async () => [
    baseIgvaRow({ project_id: 'project-1', ek_project_id: 25906, external_project_ref: '80396-003' }),
  ];
  const calls = { expectedLatest: 0, budget: 0, expectedHistory: 0, actualTurnover: 0, legacyFitterhours: 0, purchaseInvoiceLines: 0 };

  const result = await igvaPocService.listIgvaPocProjects({}, {
    tenantId: 'tenant-1',
    userId: 'user-1',
    projectRef: '38155',
    ekClient: createCountingEkClient(calls),
  });

  assert.equal(result.projects.length, 0);
  assert.deepEqual(Object.values(calls), [0, 0, 0, 0, 0, 0]);
});