'use strict';

const COST_CATEGORY = Object.freeze({
  MATERIAL: 'MATERIAL',
  SUBCONTRACTOR: 'SUBCONTRACTOR',
  OTHER_PURCHASE: 'OTHER_PURCHASE',
  CORRECTION: 'CORRECTION',
  UNCLASSIFIED: 'UNCLASSIFIED',
});

const SOURCE_TYPE = Object.freeze({
  PURCHASE_INVOICE_LINE: 'purchase_invoice_line',
  INTERNAL_PROJECT_MOVEMENT: 'INTERNAL_PROJECT_MOVEMENT',
});

const UI_BUCKET_CANDIDATE = Object.freeze({
  LAGER_BIL: 'LAGER_BIL',
});

const CLASSIFICATION_CONFIDENCE = Object.freeze({
  PROBABLE: 'PROBABLE',
});

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

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeBoolean(value) {
  if (value === true || value === false) return value;
  if (value === null || value === undefined || value === '') return null;
  const normalized = lower(value);
  if (['true', '1', 'yes', 'ja'].includes(normalized)) return true;
  if (['false', '0', 'no', 'nej'].includes(normalized)) return false;
  return null;
}

function classifyPurchaseLine(fields) {
  const transactionType = lower(fields.transactionType);
  const financialAccount = String(fields.financialAccount || '').trim();
  const financialAccountName = lower(fields.financialAccountName);
  const itemName = lower(fields.itemName);
  const igva = fields.igva;

  if (transactionType === 'diverse/ue') {
    return {
      costCategory: COST_CATEGORY.SUBCONTRACTOR,
      classificationConfidence: 'high',
      classificationReason: 'EK Type=Diverse/UE is classified separately from ordinary materials.',
    };
  }

  if (['2020', '2030', '3880'].includes(financialAccount)) {
    return {
      costCategory: COST_CATEGORY.MATERIAL,
      classificationConfidence: 'high',
      classificationReason: `FinancialAccount=${financialAccount} is a verified material purchase account for IGVA parity.`,
    };
  }

  if (igva === true && transactionType === 'standard') {
    return {
      costCategory: COST_CATEGORY.MATERIAL,
      classificationConfidence: financialAccount ? 'medium' : 'low',
      classificationReason: financialAccount
        ? 'IGVA=true and Type=Standard indicate ordinary project purchase material.'
        : 'IGVA=true and Type=Standard on a null-account row; preserved as project-scoped material/correction candidate.',
    };
  }

  if (financialAccountName.includes('vareforbrug')) {
    return {
      costCategory: COST_CATEGORY.MATERIAL,
      classificationConfidence: 'medium',
      classificationReason: 'FinancialAccountName contains Vareforbrug.',
    };
  }

  if (fields.isCorrection || fields.isMovedOrReversed) {
    return {
      costCategory: COST_CATEGORY.CORRECTION,
      classificationConfidence: 'low',
      classificationReason: 'Correction/reversal flags are present, but source fields do not prove material/subcontractor category.',
    };
  }

  if (transactionType || financialAccount || itemName) {
    return {
      costCategory: COST_CATEGORY.OTHER_PURCHASE,
      classificationConfidence: 'low',
      classificationReason: 'Project purchase line has source data, but no verified material/subcontractor signal.',
    };
  }

  return {
    costCategory: COST_CATEGORY.UNCLASSIFIED,
    classificationConfidence: 'low',
    classificationReason: 'Insufficient source fields for purchase-line classification.',
  };
}

function isLagerBilCandidate(fields) {
  return !fields.financialAccount && String(fields.sourceStatus || '') === '4';
}

function normalizeEkPurchaseInvoiceLine(rawSource, context = {}) {
  const lineAmount = toFiniteNumber(pickValue(rawSource, ['Price', 'price', 'LineAmount', 'lineAmount']));
  const quantity = toFiniteNumber(pickValue(rawSource, ['Amount', 'amount', 'Quantity', 'quantity']));
  const sourceStatus = pickValue(rawSource, ['StatusEnum', 'statusEnum', 'Status', 'status']);
  const transactionType = normalizeText(pickValue(rawSource, ['Type', 'type']));
  const itemName = normalizeText(pickValue(rawSource, ['ItemName', 'itemName']));
  const sourceInvoiceReference = normalizeText(pickValue(rawSource, ['PurchaseInvoice', 'purchaseInvoice']));
  const isNegative = (lineAmount !== null && lineAmount < 0) || (quantity !== null && quantity < 0);
  const correctionText = [
    transactionType,
    sourceInvoiceReference,
    itemName,
    pickValue(rawSource, ['Description', 'description']),
    pickValue(rawSource, ['CreatedBy', 'createdBy']),
  ].map(lower).join(' ');
  const isMovedOrReversed = isNegative
    || String(sourceStatus || '') === '4'
    || /flyt|moved|move|reversal|kreditnota|credit/.test(correctionText);
  const fields = {
    transactionType,
    financialAccount: normalizeText(pickValue(rawSource, ['FinancialAccount', 'financialAccount', 'AccountNumber', 'accountNumber'])),
    financialAccountName: normalizeText(pickValue(rawSource, ['FinancialAccountName', 'financialAccountName', 'AccountName', 'accountName'])),
    itemName,
    igva: normalizeBoolean(pickValue(rawSource, ['IGVA', 'igva'])),
    isCorrection: isNegative || String(sourceStatus || '') === '4',
    isMovedOrReversed,
    sourceStatus,
  };
  const classification = classifyPurchaseLine(fields);
  const lagerBilCandidate = isLagerBilCandidate(fields);

  return {
    sourceSystem: 'e_komplet',
    sourceType: lagerBilCandidate ? SOURCE_TYPE.INTERNAL_PROJECT_MOVEMENT : SOURCE_TYPE.PURCHASE_INVOICE_LINE,
    sourceRecordType: SOURCE_TYPE.PURCHASE_INVOICE_LINE,
    sourceLineId: normalizeText(pickValue(rawSource, ['ID', 'id'])),
    sourceInvoiceId: normalizeText(pickValue(rawSource, ['PurchaseInvoiceID', 'purchaseInvoiceID'])),
    sourceInvoiceReference,

    tenantId: context.tenantId || null,
    projectId: context.projectId || null,
    externalProjectId: normalizeText(context.externalProjectId || pickValue(rawSource, ['ProjectID', 'projectID'])),
    projectReference: normalizeText(context.projectReference || pickValue(rawSource, ['Project', 'projectReference', 'ProjectReference'])),

    transactionDate: normalizeText(pickValue(rawSource, ['Date', 'date', 'ItemAdded', 'itemAdded'])),

    supplierId: normalizeText(pickValue(rawSource, ['CreditorID', 'creditorID', 'SupplierID', 'supplierID'])),
    supplierReference: normalizeText(pickValue(rawSource, ['CreditorReference', 'creditorReference', 'SupplierReference', 'supplierReference'])),
    supplierName: normalizeText(pickValue(rawSource, ['Creditor', 'creditor', 'Supplier', 'supplier'])),

    financialAccount: fields.financialAccount,
    financialAccountName: fields.financialAccountName,

    itemCode: normalizeText(pickValue(rawSource, ['ItemCode', 'itemCode'])),
    itemName,
    ean: normalizeText(pickValue(rawSource, ['EAN', 'ean'])),
    catalogName: normalizeText(pickValue(rawSource, ['CatalogName', 'catalogName'])),
    catalogItemGroupName: normalizeText(pickValue(rawSource, ['CatalogItemGroupName', 'catalogItemGroupName'])),

    quantity,
    unit: normalizeText(pickValue(rawSource, ['Unit', 'unit'])),
    unitPrice: toFiniteNumber(pickValue(rawSource, ['UnitPrice', 'unitPrice'])),
    lineAmount,
    foreignUnitPrice: toFiniteNumber(pickValue(rawSource, ['ForeignUnitPrice', 'foreignUnitPrice'])),
    foreignLineAmount: toFiniteNumber(pickValue(rawSource, ['ForeignPrice', 'foreignPrice'])),
    currency: normalizeText(pickValue(rawSource, ['CurrencyCode', 'currencyCode'])),
    currencyRate: toFiniteNumber(pickValue(rawSource, ['CurrencyRate', 'currencyRate'])),
    discount: toFiniteNumber(pickValue(rawSource, ['Discount', 'discount'])),

    vatType: normalizeText(pickValue(rawSource, ['VatType', 'vatType'])),
    transactionType,
    sourceStatus: sourceStatus === null || sourceStatus === undefined ? null : String(sourceStatus),

    costCategory: classification.costCategory,
    uiBucketCandidate: lagerBilCandidate ? UI_BUCKET_CANDIDATE.LAGER_BIL : null,
    isCorrection: fields.isCorrection,
    isNegative,
    isMovedOrReversed,
    classificationConfidence: lagerBilCandidate ? CLASSIFICATION_CONFIDENCE.PROBABLE : classification.classificationConfidence,
    classificationReason: lagerBilCandidate
      ? 'FinancialAccount=null and StatusEnum=4 match the targeted IGVA Lager/Bil candidate rule; original transaction type and cost category are preserved.'
      : classification.classificationReason,

    rawSource,
  };
}

function sourceIdentity(line) {
  if (!line) return null;
  if (line.sourceSystem && line.sourceType && line.sourceLineId) {
    return `${line.sourceSystem}:${line.sourceType}:${line.sourceLineId}`;
  }
  return [
    line.sourceInvoiceId,
    line.projectReference,
    line.transactionDate,
    line.itemCode,
    line.itemName,
    line.lineAmount,
  ].map((value) => String(value || '')).join('|');
}

function dedupePurchaseLines(primaryLines = [], fallbackLines = []) {
  const rows = [];
  const seen = new Set();
  let fallbackDuplicates = 0;

  for (const line of primaryLines) {
    const key = sourceIdentity(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push({ ...line, sourcePriority: 'PRIMARY' });
  }

  for (const line of fallbackLines) {
    const key = sourceIdentity(line);
    if (key && seen.has(key)) {
      fallbackDuplicates += 1;
      continue;
    }
    if (key) seen.add(key);
    rows.push({ ...line, sourcePriority: 'FALLBACK' });
  }

  return {
    rows,
    primaryRows: primaryLines.length,
    fallbackRows: fallbackLines.length,
    fallbackDuplicates,
  };
}

function sumCategory(rows, category) {
  return rows
    .filter((row) => row.costCategory === category)
    .reduce((sum, row) => sum + (toFiniteNumber(row.lineAmount) || 0), 0);
}

function countCategory(rows, category) {
  return rows.filter((row) => row.costCategory === category).length;
}

function isProbableLagerBilRow(row) {
  return row
    && row.uiBucketCandidate === UI_BUCKET_CANDIDATE.LAGER_BIL
    && row.classificationConfidence === CLASSIFICATION_CONFIDENCE.PROBABLE;
}

function summarizePurchaseLines(rows = [], options = {}) {
  const ordinaryRows = rows.filter((row) => !isProbableLagerBilRow(row));
  const lagerBilRows = rows.filter(isProbableLagerBilRow);
  const creditorMaterialActual = sumCategory(ordinaryRows, COST_CATEGORY.MATERIAL);
  const lagerBilActualCandidate = lagerBilRows.reduce((sum, row) => sum + (toFiniteNumber(row.lineAmount) || 0), 0);
  const materialActual = creditorMaterialActual + lagerBilActualCandidate;
  const subcontractorActual = sumCategory(ordinaryRows, COST_CATEGORY.SUBCONTRACTOR);
  const otherPurchaseActual = sumCategory(ordinaryRows, COST_CATEGORY.OTHER_PURCHASE);
  const correctionActual = sumCategory(ordinaryRows, COST_CATEGORY.CORRECTION);
  const unclassifiedActual = sumCategory(ordinaryRows, COST_CATEGORY.UNCLASSIFIED);
  const totalPurchaseActual = rows.reduce((sum, row) => sum + (toFiniteNumber(row.lineAmount) || 0), 0);
  const hasUnclassifiedValue = Math.abs(unclassifiedActual) > 0;
  const hasExpectedInternalBucket = Math.abs(toFiniteNumber(options.expectedInternalMaterialBucket) || 0) > 0;
  const hasResolvedInternalBucket = lagerBilRows.length > 0;
  const canUseMaterialActual = rows.length > 0
    && !hasUnclassifiedValue
    && (!hasExpectedInternalBucket || hasResolvedInternalBucket);
  const status = rows.length
    ? (canUseMaterialActual
      ? (lagerBilRows.length ? 'VERIFIED_WITH_PROBABLE_COMPONENT' : 'VERIFIED')
      : 'PARTIAL')
    : 'N/A';

  return {
    source: 'ek_v4_purchaseinvoicelines_direct_project',
    status,
    included_in_weighted_completion: canUseMaterialActual,
    material_actual: materialActual,
    creditor_material_actual: creditorMaterialActual,
    lager_bil_actual_candidate: lagerBilActualCandidate,
    lager_bil_candidate_rows: lagerBilRows.length,
    lager_bil_candidate_confidence: lagerBilRows.length ? CLASSIFICATION_CONFIDENCE.PROBABLE : null,
    total_purchase_actual: totalPurchaseActual,
    category_totals: {
      MATERIAL: creditorMaterialActual,
      SUBCONTRACTOR: subcontractorActual,
      OTHER_PURCHASE: otherPurchaseActual,
      CORRECTION: correctionActual,
      UNCLASSIFIED: unclassifiedActual,
    },
    category_rows: {
      MATERIAL: countCategory(ordinaryRows, COST_CATEGORY.MATERIAL),
      SUBCONTRACTOR: countCategory(ordinaryRows, COST_CATEGORY.SUBCONTRACTOR),
      OTHER_PURCHASE: countCategory(ordinaryRows, COST_CATEGORY.OTHER_PURCHASE),
      CORRECTION: countCategory(ordinaryRows, COST_CATEGORY.CORRECTION),
      UNCLASSIFIED: countCategory(ordinaryRows, COST_CATEGORY.UNCLASSIFIED),
    },
    rows: rows.length,
    positive_rows: rows.filter((row) => (toFiniteNumber(row.lineAmount) || 0) > 0).length,
    negative_rows: rows.filter((row) => (toFiniteNumber(row.lineAmount) || 0) < 0).length,
    status_4_rows: rows.filter((row) => String(row.sourceStatus || '') === '4').length,
    null_account_rows: rows.filter((row) => !row.financialAccount).length,
    moved_or_reversed_rows: rows.filter((row) => row.isMovedOrReversed).length,
    classification_coverage: canUseMaterialActual
      ? (lagerBilRows.length ? 'material_total_usable_with_lager_bil_candidate' : 'material_total_usable')
      : 'partial',
    unresolved_reasons: [
      hasUnclassifiedValue ? 'unclassified_purchase_value' : null,
      hasExpectedInternalBucket && !hasResolvedInternalBucket ? 'expected_lager_bil_bucket_without_actual_source' : null,
      rows.length ? null : 'no_direct_purchase_lines',
    ].filter(Boolean),
  };
}

function normalizeEkPurchaseInvoiceLines(rows = [], context = {}) {
  return (Array.isArray(rows) ? rows : []).map((row) => normalizeEkPurchaseInvoiceLine(row, context));
}

module.exports = {
  COST_CATEGORY,
  SOURCE_TYPE,
  UI_BUCKET_CANDIDATE,
  CLASSIFICATION_CONFIDENCE,
  normalizeEkPurchaseInvoiceLine,
  normalizeEkPurchaseInvoiceLines,
  dedupePurchaseLines,
  sourceIdentity,
  summarizePurchaseLines,
  _test: {
    classifyPurchaseLine,
    isProbableLagerBilRow,
    pickValue,
    toFiniteNumber,
  },
};
