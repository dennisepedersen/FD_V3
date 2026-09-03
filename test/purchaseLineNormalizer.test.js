'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COST_CATEGORY,
  SOURCE_TYPE,
  UI_BUCKET_CANDIDATE,
  CLASSIFICATION_CONFIDENCE,
  normalizeEkPurchaseInvoiceLine,
  normalizeEkPurchaseInvoiceLines,
  dedupePurchaseLines,
  summarizePurchaseLines,
} = require('../backend/src/services/purchaseLineNormalizer');
const { buildIgvaPocProject } = require('../backend/src/services/igvaPocAdapter');

function purchaseLine(overrides = {}) {
  return {
    ID: 1,
    PurchaseInvoice: 'INV-1',
    PurchaseInvoiceID: 10,
    FinancialAccount: '2020',
    FinancialAccountName: 'Vareforbrug',
    Date: '2026-09-01T00:00:00',
    Creditor: 'Solar',
    CreditorReference: '123',
    CreditorID: 7,
    VatType: 'Kob',
    Project: 'P-1',
    ProjectID: 99,
    Amount: 2,
    Unit: 'STK',
    UnitPrice: 50,
    ForeignUnitPrice: 50,
    Price: 100,
    ForeignPrice: 100,
    Discount: 0,
    CurrencyCode: 'DKK',
    CurrencyRate: 100,
    ItemCode: 'A1',
    ItemName: 'Kabel',
    EAN: '5700000000000',
    CatalogName: 'Solar',
    CatalogItemGroupName: 'Kabler',
    Type: 'Standard',
    StatusEnum: 2,
    IGVA: true,
    ...overrides,
  };
}

function baseIgvaRow(overrides = {}) {
  return {
    tenant_id: 'tenant-1',
    project_id: 'project-1',
    ek_project_id: 99,
    external_project_ref: 'P-1',
    name: 'Projekt',
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
        totalLaborExp: 100,
        totalPurchases: 100,
        creditorExpectedValues: [],
      },
    },
    budget: {
      status: 'VERIFIED',
      source: 'ek_v4_projects_budgets',
      projectBudget: { projectBudgetCostResponseDTO: { salaryTotal: 100, materials: 100 } },
      expectedValues: null,
    },
    expectedHistory: { status: 'VERIFIED', source: 'ek_v4_expectedvalues_history', rows: [] },
    actualTurnover: { status: 'N/A', source: 'ek_v4_financialposts', actual_turnover: null },
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
    purchaseInvoiceLines: {
      status: 'VERIFIED',
      source: 'ek_v4_purchaseinvoicelines_direct_project',
      rows: [purchaseLine({ Price: 100 })],
      total_rows_observed: 1,
    },
    ...overrides,
  };
}

test('normal positive material row is normalized as MATERIAL', () => {
  const row = normalizeEkPurchaseInvoiceLine(purchaseLine());

  assert.equal(row.costCategory, COST_CATEGORY.MATERIAL);
  assert.equal(row.sourceLineId, '1');
  assert.equal(row.lineAmount, 100);
  assert.equal(row.supplierName, 'Solar');
  assert.equal(row.classificationConfidence, 'high');
});

test('negative material correction is retained as signed MATERIAL', () => {
  const row = normalizeEkPurchaseInvoiceLine(purchaseLine({ ID: 2, Price: -2511.68, Amount: -40 }));

  assert.equal(row.costCategory, COST_CATEGORY.MATERIAL);
  assert.equal(row.isNegative, true);
  assert.equal(row.isCorrection, true);
  assert.equal(row.lineAmount, -2511.68);
});

test('StatusEnum=4 row is flagged but not ignored', () => {
  const row = normalizeEkPurchaseInvoiceLine(purchaseLine({ ID: 3, StatusEnum: 4, FinancialAccount: null, FinancialAccountName: null }));

  assert.equal(row.costCategory, COST_CATEGORY.MATERIAL);
  assert.equal(row.sourceStatus, '4');
  assert.equal(row.isMovedOrReversed, true);
});

test('null-account Standard IGVA correction is retained as material candidate', () => {
  const row = normalizeEkPurchaseInvoiceLine(purchaseLine({ ID: 4, FinancialAccount: null, FinancialAccountName: null, Price: -1357.2 }));

  assert.equal(row.costCategory, COST_CATEGORY.MATERIAL);
  assert.equal(row.financialAccount, null);
  assert.equal(row.classificationConfidence, 'low');
});

test('Diverse/UE is classified separately from MATERIAL', () => {
  const row = normalizeEkPurchaseInvoiceLine(purchaseLine({ ID: 5, Type: 'Diverse/UE', Creditor: 'RNTM ApS', ItemName: 'Timer HC' }));

  assert.equal(row.costCategory, COST_CATEGORY.SUBCONTRACTOR);
  assert.match(row.classificationReason, /Diverse\/UE/);
});

test('EUR account 2030 row is material and preserves currency fields', () => {
  const row = normalizeEkPurchaseInvoiceLine(purchaseLine({
    ID: 6,
    FinancialAccount: '2030',
    FinancialAccountName: 'Vareforbrug EU moms/varer',
    CurrencyCode: 'EUR',
    CurrencyRate: 750,
    ForeignPrice: 53.4658,
    Price: 400.9935,
  }));

  assert.equal(row.costCategory, COST_CATEGORY.MATERIAL);
  assert.equal(row.currency, 'EUR');
  assert.equal(row.currencyRate, 750);
  assert.equal(row.foreignLineAmount, 53.4658);
  assert.equal(row.lineAmount, 400.9935);
});

test('direct-vs-bridge dedupe keeps primary source identity', () => {
  const direct = normalizeEkPurchaseInvoiceLines([purchaseLine({ ID: 7, Price: 10 })]);
  const bridge = normalizeEkPurchaseInvoiceLines([
    purchaseLine({ ID: 7, Price: 20 }),
    purchaseLine({ ID: 8, Price: 5 }),
  ]);
  const result = dedupePurchaseLines(direct, bridge);
  const summary = summarizePurchaseLines(result.rows);

  assert.equal(result.rows.length, 2);
  assert.equal(result.fallbackDuplicates, 1);
  assert.equal(summary.material_actual, 15);
});

test('unclassified row remains visible', () => {
  const row = normalizeEkPurchaseInvoiceLine({ ID: 9 });

  assert.equal(row.costCategory, COST_CATEGORY.UNCLASSIFIED);
});

test('material signed aggregation includes positive and negative rows', () => {
  const rows = normalizeEkPurchaseInvoiceLines([
    purchaseLine({ ID: 10, Price: 100 }),
    purchaseLine({ ID: 11, Price: -25 }),
    purchaseLine({ ID: 12, Type: 'Diverse/UE', Price: 10 }),
  ]);
  const summary = summarizePurchaseLines(rows);

  assert.equal(summary.material_actual, 75);
  assert.equal(summary.total_purchase_actual, 85);
  assert.equal(summary.category_totals.SUBCONTRACTOR, 10);
});

test('normalization does not round source economic values', () => {
  const row = normalizeEkPurchaseInvoiceLine(purchaseLine({ ID: 13, Price: 10.123456789, UnitPrice: 1.23456789 }));

  assert.equal(row.lineAmount, 10.123456789);
  assert.equal(row.unitPrice, 1.23456789);
});

test('weighted completion includes labor and materials when classification coverage is sufficient', () => {
  const project = buildIgvaPocProject(baseIgvaRow(), { ekEconomy: economyFixture() });

  assert.equal(project.data_sources.actual_materials.status, 'VERIFIED');
  assert.equal(project.data_sources.actual_materials.included_in_weighted_completion, true);
  assert.equal(project.source_totals.materials_actual, 100);
  assert.equal(project.calculation.expected_completion.percent, 75);
  assert.equal(project.calculation.calculation_coverage.percent, 100);
});

test('materials are excluded when classification coverage is insufficient', () => {
  const project = buildIgvaPocProject(baseIgvaRow(), {
    ekEconomy: economyFixture({
      expectedLatest: {
        status: 'VERIFIED',
        source: 'ek_v4_expectedvalues_latest',
        value: {
          totalLaborExp: 100,
          totalPurchases: 100,
          creditorExpectedValues: [
            { creditorName: null, creditorReference: '-1', creditorID: 1, budget: 10 },
          ],
        },
      },
    }),
  });

  assert.equal(project.data_sources.actual_materials.status, 'PARTIAL');
  assert.equal(project.data_sources.actual_materials.included_in_weighted_completion, false);
  assert.deepEqual(project.data_sources.actual_materials.unresolved_reasons, ['expected_lager_bil_bucket_without_actual_source']);
  assert.equal(project.calculation.expected_completion.percent, 50);
  assert.equal(project.calculation.calculation_coverage.percent, 50);
});


test('Lager/Bil candidate is marked as internal project movement without changing original category', () => {
  const row = normalizeEkPurchaseInvoiceLine(purchaseLine({
    ID: 31,
    FinancialAccount: null,
    FinancialAccountName: null,
    StatusEnum: 4,
    Type: 'Diverse/UE',
    Creditor: 'RNTM ApS',
    Price: 94405,
    ItemName: 'Timer HC',
  }));

  assert.equal(row.sourceType, SOURCE_TYPE.INTERNAL_PROJECT_MOVEMENT);
  assert.equal(row.sourceRecordType, SOURCE_TYPE.PURCHASE_INVOICE_LINE);
  assert.equal(row.uiBucketCandidate, UI_BUCKET_CANDIDATE.LAGER_BIL);
  assert.equal(row.classificationConfidence, CLASSIFICATION_CONFIDENCE.PROBABLE);
  assert.equal(row.transactionType, 'Diverse/UE');
  assert.equal(row.supplierName, 'RNTM ApS');
  assert.equal(row.itemName, 'Timer HC');
  assert.equal(row.sourceStatus, '4');
  assert.equal(row.costCategory, COST_CATEGORY.SUBCONTRACTOR);
  assert.equal(row.rawSource.Creditor, 'RNTM ApS');
});

test('Lager/Bil candidate contributes separately and is not double counted as ordinary material', () => {
  const rows = normalizeEkPurchaseInvoiceLines([
    purchaseLine({ ID: 32, FinancialAccount: '2020', Price: 100 }),
    purchaseLine({ ID: 33, FinancialAccount: null, FinancialAccountName: null, StatusEnum: 4, Type: 'Standard', Price: 25 }),
    purchaseLine({ ID: 34, FinancialAccount: null, FinancialAccountName: null, StatusEnum: 4, Type: 'Diverse/UE', Price: 75 }),
  ]);
  const summary = summarizePurchaseLines(rows, { expectedInternalMaterialBucket: 100 });

  assert.equal(summary.creditor_material_actual, 100);
  assert.equal(summary.lager_bil_actual_candidate, 100);
  assert.equal(summary.material_actual, 200);
  assert.equal(summary.category_totals.MATERIAL, 100);
  assert.equal(summary.category_totals.SUBCONTRACTOR, 0);
  assert.equal(summary.lager_bil_candidate_rows, 2);
  assert.equal(summary.status, 'VERIFIED_WITH_PROBABLE_COMPONENT');
  assert.equal(summary.included_in_weighted_completion, true);
});

test('IGVA material actual includes probable Lager/Bil candidate in weighted completion', () => {
  const project = buildIgvaPocProject(baseIgvaRow(), {
    ekEconomy: economyFixture({
      expectedLatest: {
        status: 'VERIFIED',
        source: 'ek_v4_expectedvalues_latest',
        value: {
          totalLaborExp: 100,
          totalPurchases: 200,
          creditorExpectedValues: [
            { creditorName: null, creditorReference: '-1', creditorID: 1, budget: 100 },
          ],
        },
      },
      budget: {
        status: 'VERIFIED',
        source: 'ek_v4_projects_budgets',
        projectBudget: { projectBudgetCostResponseDTO: { salaryTotal: 100, materials: 200 } },
        expectedValues: null,
      },
      purchaseInvoiceLines: {
        status: 'VERIFIED',
        source: 'ek_v4_purchaseinvoicelines_direct_project',
        rows: [
          purchaseLine({ ID: 35, FinancialAccount: '2020', Price: 100 }),
          purchaseLine({ ID: 36, FinancialAccount: null, FinancialAccountName: null, StatusEnum: 4, Type: 'Diverse/UE', Price: 100 }),
        ],
        total_rows_observed: 2,
      },
    }),
  });

  assert.equal(project.source_totals.materials_actual_creditor, 100);
  assert.equal(project.source_totals.lager_bil_actual_candidate, 100);
  assert.equal(project.source_totals.materials_actual, 200);
  assert.equal(project.data_sources.actual_materials.lager_bil_candidate_confidence, CLASSIFICATION_CONFIDENCE.PROBABLE);
  assert.equal(project.data_sources.actual_materials.status, 'VERIFIED_WITH_PROBABLE_COMPONENT');
  assert.equal(project.data_sources.actual_materials.included_in_weighted_completion, true);
  assert.equal(project.data_quality, 'VERIFIED_WITH_PROBABLE_COMPONENT');
  assert.equal(project.calculation.expected_completion.percent, 83.33);
  assert.equal(project.calculation.calculation_coverage.percent, 100);
});

test('StatusEnum=4 with financial account is not a Lager/Bil candidate', () => {
  const row = normalizeEkPurchaseInvoiceLine(purchaseLine({ ID: 37, FinancialAccount: '2020', StatusEnum: 4, Price: 25 }));

  assert.equal(row.sourceType, SOURCE_TYPE.PURCHASE_INVOICE_LINE);
  assert.equal(row.uiBucketCandidate, null);
  assert.equal(row.costCategory, COST_CATEGORY.MATERIAL);
  assert.equal(row.classificationConfidence, 'high');
});
