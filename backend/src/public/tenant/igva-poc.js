(function () {
  'use strict';

  const TOKEN_KEY = 'fielddesk_access_token';
  const PM_KEY_PREFIX = 'fielddesk_igva_pm_completion:';
  const state = {
    mode: 'standalone',
    projects: [],
    filteredProjects: [],
    selectedProjectId: null,
    projectRefFromUrl: null,
    projectDetailsByRef: Object.create(null),
    loadingProjectRef: null,
    embeddedEndpoint: null,
    embeddedProjectContext: null,
    drawerWired: false,
  };

  const HISTORY_FIELDS = Object.freeze([
    { key: 'totalPurchases', oldKey: 'totalPurchasesOld', newKey: 'totalPurchases', label: 'Materialer forventet', category: 'materials' },
    { key: 'totalLaborExp', oldKey: 'totalLaborExpOld', newKey: 'totalLaborExp', label: 'Løn forventet', category: 'labor' },
    { key: 'totalTurnOverExp', oldKey: 'totalTurnOverExpOld', newKey: 'totalTurnOverExp', label: 'Omsætning forventet', category: 'turnover' },
  ]);

  function byId(id) { return document.getElementById(id); }
  function getToken() { return window.localStorage.getItem(TOKEN_KEY); }
  function logout() { window.localStorage.removeItem(TOKEN_KEY); window.location.href = '/login'; }
  function clear(node) { if (node) node.innerHTML = ''; }

  async function apiFetch(url, options) {
    const token = getToken();
    if (!token) { window.location.href = '/login'; return null; }
    const response = await window.fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options && options.headers ? options.headers : {}),
        Authorization: `Bearer ${token}`,
      },
    });
    let payload = null;
    try { payload = await response.json(); } catch (_error) { payload = null; }
    if (!response.ok) {
      const code = payload && payload.error && payload.error.message ? payload.error.message : `request_failed_${response.status}`;
      const error = new Error(code);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function round(value, digits = 2) {
    const parsed = toNumber(value);
    if (parsed === null) return null;
    const factor = 10 ** digits;
    return Math.round(parsed * factor) / factor;
  }

  function text(value, fallback = 'N/A') {
    if (value === null || value === undefined || value === '') return fallback;
    return String(value);
  }

  function formatMoney(value, digits = 0) {
    const parsed = toNumber(value);
    if (parsed === null) return 'N/A';
    return new Intl.NumberFormat('da-DK', {
      style: 'currency',
      currency: 'DKK',
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(parsed);
  }

  function formatShortMoney(value) {
    const parsed = toNumber(value);
    if (parsed === null) return 'N/A';
    const abs = Math.abs(parsed);
    if (abs >= 1000000) return `${new Intl.NumberFormat('da-DK', { maximumFractionDigits: 3, minimumFractionDigits: 0 }).format(parsed / 1000000)} m`;
    if (abs >= 1000) return `${new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 }).format(parsed / 1000)} t`;
    return new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 }).format(parsed);
  }

  function formatPercent(value, digits = 2) {
    const parsed = toNumber(value);
    if (parsed === null) return 'N/A';
    return `${new Intl.NumberFormat('da-DK', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(parsed)} %`;
  }

  function formatRatio(value, digits = 2) {
    const parsed = toNumber(value);
    return parsed === null ? 'N/A' : formatPercent(parsed * 100, digits);
  }

  function formatNumber(value, digits = 2) {
    const parsed = toNumber(value);
    if (parsed === null) return 'N/A';
    return new Intl.NumberFormat('da-DK', { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(parsed);
  }

  function formatDateTime(value) {
    if (!value) return 'Dato mangler';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('da-DK', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function formatDateShort(value) {
    if (!value) return 'Dato mangler';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('da-DK', { day: '2-digit', month: 'short' }).format(date);
  }

  function deltaClass(value) {
    const parsed = toNumber(value);
    if (parsed === null || parsed === 0) return 'neutral';
    return parsed > 0 ? 'positive' : 'negative';
  }

  function formatDelta(value) {
    const parsed = toNumber(value);
    if (parsed === null) return 'N/A';
    const prefix = parsed > 0 ? '+' : '';
    return `${prefix}${formatMoney(parsed)}`;
  }

  function el(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined && content !== null) node.textContent = String(content);
    return node;
  }

  function component(project, key) {
    return ((project.calculation || {}).components || []).find((item) => item.key === key) || null;
  }

  function expectedIncluded(project, key) {
    const included = (((project.calculation || {}).expected_completion || {}).included || []);
    return included.find((item) => item.key === key) || null;
  }

  function pmStorageKey(project) { return `${PM_KEY_PREFIX}${project.project_id || project.external_project_ref || 'unknown'}`; }

  function readProjectManagerCompletion(project) {
    const parsed = Number(window.localStorage.getItem(pmStorageKey(project)));
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 100) : null;
  }

  function saveProjectManagerCompletion(project, value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) { window.localStorage.removeItem(pmStorageKey(project)); return null; }
    const clamped = Math.min(Math.max(parsed, 0), 100);
    window.localStorage.setItem(pmStorageKey(project), String(clamped));
    return clamped;
  }

  function progressWidth(percent) {
    const parsed = toNumber(percent);
    if (parsed === null) return 0;
    return Math.min(Math.max(parsed, 0), 100);
  }

  function safeSubtract(a, b) {
    const left = toNumber(a);
    const right = toNumber(b);
    return left === null || right === null ? null : left - right;
  }

  function humanQuality(statusValue) {
    const status = String(statusValue || 'N/A').toUpperCase();
    if (status === 'VERIFIED') return { label: 'God', detail: 'Datakilden er verificeret for POC-formålet.' };
    if (status === 'VERIFIED_WITH_PROBABLE_COMPONENT') return { label: 'God / delvist verificeret', detail: 'Materialer er verificeret med en sandsynlig Lager/Bil-kilde.' };
    if (status.includes('LEGACY')) return { label: 'Legacy-verificeret', detail: 'Kilden matcher EK UI, men kommer midlertidigt fra V3.' };
    if (status.includes('PARTIAL')) return { label: 'Delvist verificeret', detail: 'Der findes kendte POC-gaps eller ufuldstændig komponentdækning.' };
    if (status.includes('UNRESOLVED')) return { label: 'Uafklaret', detail: 'Mappingen er ikke sikker nok til beslutningsbrug.' };
    return { label: 'N/A', detail: 'Ingen sikker datakvalitet.' };
  }

  function createBadge(value, options = {}) {
    const raw = String(value || 'N/A');
    const status = raw.toUpperCase();
    const cls = options.className || (
      status.includes('PROBABLE') ? 'probable'
        : status.includes('LEGACY') ? 'legacy'
          : status.includes('PARTIAL') ? 'partial'
            : status.includes('UNRESOLVED') ? 'unresolved'
              : status === 'N/A' ? 'na' : ''
    );
    const badge = el('span', `igvaBadge ${cls}`.trim(), options.human || humanQuality(status).label);
    badge.title = raw;
    return badge;
  }

  function createProgress(percent, tone = '') {
    const track = el('div', 'igvaProgressTrack');
    const bar = el('div', `igvaProgressBar ${tone}`.trim());
    bar.style.width = `${progressWidth(percent)}%`;
    track.appendChild(bar);
    return track;
  }

  function createMoneyLine(label, value, options = {}) {
    const row = el('div', 'igvaMoneyLine');
    row.appendChild(el('span', null, label));
    row.appendChild(el('strong', null, options.percent ? formatPercent(value, 2) : formatMoney(value, options.digits || 0)));
    return row;
  }

  function createExplainLine(label, value) {
    const row = el('div', 'igvaExplainLine');
    row.appendChild(el('span', null, label));
    row.appendChild(el('strong', null, value));
    return row;
  }

  function evaluateEconomyHealth(_project) {
    return {
      status: 'neutral',
      label: 'Neutral',
      detail: 'Statusfarve afventer en godkendt tolerancepolitik. TODO: gør policy proportional med projektstørrelse og økonomisk risiko.',
    };
  }
  function readHistoryRows(project) {
    const history = project && project.data_sources ? project.data_sources.expected_history : null;
    const rows = history && Array.isArray(history.rows) ? history.rows : [];
    return rows.slice().sort((left, right) => new Date(right.createdDate || 0) - new Date(left.createdDate || 0));
  }

  function buildExpectedHistoryEvents(project) {
    const history = project && project.data_sources ? project.data_sources.expected_history : null;
    if (history && Array.isArray(history.events)) {
      return history.events.slice().sort((left, right) => new Date(right.changed_at || 0) - new Date(left.changed_at || 0));
    }
    return readHistoryRows(project).flatMap((row) => HISTORY_FIELDS.map((field) => {
      const oldValue = toNumber(row[field.oldKey]);
      const newValue = toNumber(row[field.newKey]);
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

  function latestHistoryEvents(project, limit = 5) {
    return buildExpectedHistoryEvents(project).slice(0, limit);
  }

  function historyCapabilities(project) {
    const history = project && project.data_sources ? project.data_sources.expected_history : null;
    return history && history.capabilities ? history.capabilities : {
      total_materials_history: true,
      total_labor_history: true,
      total_turnover_history: true,
      creditor_row_history: false,
      note_history: true,
      user_history: true,
    };
  }

  function buildSladrehankObservations(project) {
    const events = buildExpectedHistoryEvents(project);
    const observations = [];
    const latestMaterial = events.find((event) => event.category === 'materials');
    if (latestMaterial) {
      observations.push(`Materialeforventningen blev ${latestMaterial.delta < 0 ? 'sænket' : 'hævet'} ${formatMoney(Math.abs(latestMaterial.delta))} ved seneste ændring.`);
    }
    const latestTurnover = events.find((event) => event.category === 'turnover');
    if (latestTurnover) {
      observations.push(`Forventet omsætning er ændret ${formatDelta(latestTurnover.delta)} i seneste kendte historik.`);
    }
    const historyRows = readHistoryRows(project);
    const latestDate = historyRows[0] && historyRows[0].createdDate ? new Date(historyRows[0].createdDate) : null;
    if (latestDate && !Number.isNaN(latestDate.getTime())) {
      const days = Math.max(0, Math.floor((Date.now() - latestDate.getTime()) / 86400000));
      observations.push(`Expected values er senest ændret for ${days} dage siden.`);
    }
    const byDayAndCategory = events.reduce((map, event) => {
      const date = event.changed_at ? new Date(event.changed_at) : null;
      if (!date || Number.isNaN(date.getTime())) return map;
      const key = `${event.category}:${date.toISOString().slice(0, 10)}`;
      map[key] = (map[key] || 0) + 1;
      return map;
    }, {});
    Object.entries(byDayAndCategory).filter(([, count]) => count >= 4).slice(0, 1).forEach(([key, count]) => {
      const [category, day] = key.split(':');
      const label = category === 'materials' ? 'materialer' : category === 'labor' ? 'løn' : 'omsætning';
      observations.push(`Høj ændringsaktivitet: expected ${label} er ændret ${count} gange ${new Intl.DateTimeFormat('da-DK', { day: '2-digit', month: 'short' }).format(new Date(day))}.`);
    });
    return observations.slice(0, 4);
  }

  function completionCard({ title, value, caption, tone, primary, body }) {
    const card = el('article', primary ? 'igvaCard primaryMetric' : 'igvaCard');
    card.appendChild(el('p', 'igvaCardTitle', title));
    card.appendChild(el('div', 'igvaMetric', value === null || value === undefined ? 'N/A' : formatPercent(value, 1)));
    card.appendChild(createProgress(value, tone));
    card.appendChild(el('p', 'igvaCaption', caption));
    if (body) card.appendChild(body);
    return card;
  }

  function renderProjectManagerCard(project) {
    const currentValue = readProjectManagerCompletion(project);
    const controls = el('div', 'igvaPmControls');
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0';
    range.max = '100';
    range.step = '1';
    range.value = currentValue === null ? '0' : String(currentValue);
    range.setAttribute('aria-label', 'Projektledervurdering');

    const number = document.createElement('input');
    number.type = 'number';
    number.min = '0';
    number.max = '100';
    number.step = '1';
    number.placeholder = 'N/A';
    number.value = currentValue === null ? '' : String(currentValue);
    number.setAttribute('aria-label', 'Projektledervurdering i procent');

    function update(value) {
      const saved = saveProjectManagerCompletion(project, value);
      range.value = saved === null ? '0' : String(saved);
      number.value = saved === null ? '' : String(saved);
      renderSelectedProject();
      renderTechnicalRows();
    }

    range.addEventListener('change', () => update(range.value));
    number.addEventListener('change', () => update(number.value));
    controls.appendChild(range);
    controls.appendChild(number);

    const body = el('div');
    body.appendChild(controls);
    body.appendChild(el('div', 'igvaPmComment', 'Kommentar til vurdering forberedes i en senere tenant-scoped model.'));

    return completionCard({
      title: 'Projektleder',
      value: currentValue,
      caption: 'Manuel vurdering. Gemmes kun lokalt i browseren i denne POC.',
      tone: 'amber',
      body,
    });
  }

  function renderCompletion(project) {
    const calc = project.calculation || {};
    const grid = el('section', 'igvaCompletionShell');
    const title = el('div', 'igvaCompletionTitle');
    title.appendChild(el('p', 'igvaEyebrow', 'Færdiggørelsesgrad'));
    grid.appendChild(title);
    const cards = el('div', 'igvaCompletionGrid');
    const budget = calc.budget_completion || {};
    const expected = calc.expected_completion || {};
    cards.appendChild(completionCard({
      title: 'Budget',
      value: budget.status === 'N/A' ? null : budget.percent,
      caption: 'Budget-perspektivet. Viser N/A når budget mangler eller er 0.',
      tone: 'neutral',
    }));
    cards.appendChild(completionCard({
      title: 'Forventet',
      value: expected.percent,
      caption: 'Automatisk økonomisk vægtet færdiggørelse.',
      tone: 'blue',
      primary: true,
    }));
    cards.appendChild(renderProjectManagerCard(project));
    grid.appendChild(cards);
    return grid;
  }

  function renderHeader(project) {
    const health = evaluateEconomyHealth(project);
    const quality = humanQuality(project.data_quality);
    const header = el('section', 'igvaProjectHeader');
    const main = el('div');
    main.appendChild(el('p', 'igvaProjectRef', `Projekt ${text(project.external_project_ref, '-')}`));
    main.appendChild(el('h1', 'igvaProjectName', text(project.name, 'Uden navn')));
    const meta = el('div', 'igvaMetaGrid');
    const responsible = project.responsible && (project.responsible.name || project.responsible.code);
    meta.appendChild(metaBox('Kunde', text(project.customer_name || project.customer || project.client_name, 'N/A')));
    meta.appendChild(metaBox('Projektleder', text(responsible)));
    meta.appendChild(metaBox('Status', text(project.lifecycle && project.lifecycle.status)));
    main.appendChild(meta);
    header.appendChild(main);
    const actions = el('aside', 'igvaHeaderActions');
    actions.appendChild(createBadge(project.data_quality, { human: `Datakvalitet: ${quality.label}` }));
    actions.appendChild(createBadge(health.status, { human: `Økonomi: ${health.label}`, className: health.status }));
    const calcButton = el('button', 'igvaBtn', 'Vis beregning');
    calcButton.type = 'button';
    if (!project.calculation) {
      calcButton.disabled = true;
      calcButton.title = 'Økonomi hentes først for det valgte projekt';
    }
    calcButton.addEventListener('click', () => openCalculationDrawer(project));
    actions.appendChild(calcButton);
    header.appendChild(actions);
    return header;
  }

  function metaBox(label, value) {
    const node = el('div', 'igvaMeta');
    node.appendChild(el('span', null, label));
    node.appendChild(el('strong', null, value));
    return node;
  }

  function renderComponentBreakdown(project) {
    const calc = project.calculation || {};
    const expected = calc.expected_completion || {};
    const panel = el('section', 'igvaPanel');
    const title = el('div', 'igvaSectionTitle');
    title.appendChild(el('h2', null, `Hvad udgør ${formatPercent(expected.percent, 1)}?`));
    title.appendChild(el('span', 'igvaMuted', 'Vægtet bidrag = færdiggørelse × økonomisk andel'));
    panel.appendChild(title);
    const list = el('div', 'igvaBreakdownList');
    list.appendChild(renderBreakdownRow(project, 'labor', 'Løn', 'blue'));
    list.appendChild(renderBreakdownRow(project, 'materials', 'Materialer', 'cyan'));
    panel.appendChild(list);
    return panel;
  }

  function renderBreakdownRow(project, key, label, tone) {
    const item = component(project, key) || {};
    const included = expectedIncluded(project, key) || {};
    const completion = toNumber(item.expected_progress_capped ?? included.completion);
    const rawCompletion = toNumber(item.expected_progress_raw ?? included.completion);
    const weight = toNumber(item.expected_weight ?? (included.weight && ((project.calculation.expected_completion || {}).included_weight ? included.weight / project.calculation.expected_completion.included_weight : null)));
    const contribution = completion !== null && weight !== null ? completion * weight : null;
    const row = el('article', 'igvaBreakdownRow');
    const top = el('div', 'igvaBreakdownTop');
    const name = el('div', 'igvaBreakdownName');
    name.appendChild(el('span', `igvaDot ${tone === 'cyan' ? 'cyan' : ''}`.trim()));
    name.appendChild(el('span', null, label));
    name.appendChild(createBadge(item.source_status || 'N/A'));
    top.appendChild(name);
    top.appendChild(el('div', 'igvaBreakdownPercent', formatRatio(rawCompletion, 1)));
    row.appendChild(top);
    row.appendChild(createProgress(rawCompletion === null ? null : rawCompletion * 100, tone));
    const numbers = el('div', 'igvaBreakdownNumbers');
    numbers.appendChild(el('span', null, `Realiseret ${formatShortMoney(item.actual_cost)} DKK`));
    numbers.appendChild(el('span', null, `Forventet ${formatShortMoney(item.expected_cost)} DKK`));
    row.appendChild(numbers);
    const contributionTrack = el('div', 'igvaContributionTrack');
    const contributionBar = el('div', `igvaContributionBar ${tone === 'cyan' ? 'cyan' : ''}`.trim());
    contributionBar.style.width = `${progressWidth(contribution === null ? null : contribution * 100)}%`;
    contributionTrack.appendChild(contributionBar);
    row.appendChild(contributionTrack);
    const contributionNumbers = el('div', 'igvaBreakdownNumbers');
    contributionNumbers.appendChild(el('span', null, `Andel ${formatRatio(weight, 1)}`));
    contributionNumbers.appendChild(el('span', null, `Bidrag til total ${formatRatio(contribution, 1)}`));
    row.appendChild(contributionNumbers);
    return row;
  }
  function renderFinanceSummary(project) {
    const source = project.source_totals || {};
    const calc = project.calculation || {};
    const totals = calc.totals || {};
    const turnoverExpected = toNumber(source.turnover_expected);
    const expectedCost = toNumber(totals.expected_cost || source.expected_total_from_components);
    const expectedDb = turnoverExpected !== null && expectedCost !== null ? turnoverExpected - expectedCost : null;
    const expectedCoverage = turnoverExpected && expectedDb !== null ? (expectedDb / turnoverExpected) * 100 : null;
    const panel = el('section', 'igvaPanel');
    const title = el('div', 'igvaSectionTitle');
    title.appendChild(el('h2', null, 'Økonomi'));
    title.appendChild(el('span', 'igvaMuted', 'Usikre felter vises som N/A'));
    panel.appendChild(title);
    const grid = el('div', 'igvaFinanceGrid');
    grid.appendChild(financeCard('Omsætning', 'Realiseret', source.turnover_actual, 'Forventet', source.turnover_expected));
    grid.appendChild(financeCard('Omkostninger', 'Realiseret', totals.actual_cost, 'Forventet', expectedCost));
    const highlights = el('div', 'igvaFinanceHighlightGrid');
    const db = el('div', 'igvaFinanceCard igvaFinanceHighlight');
    db.appendChild(el('p', 'igvaFinanceLabel', 'DB forventet'));
    db.appendChild(el('p', 'igvaFinanceValue', formatShortMoney(expectedDb)));
    highlights.appendChild(db);
    const coverage = el('div', 'igvaFinanceCard igvaFinanceHighlight');
    coverage.appendChild(el('p', 'igvaFinanceLabel', 'Dækningsgrad'));
    coverage.appendChild(el('p', 'igvaFinanceValue', formatPercent(expectedCoverage, 1)));
    highlights.appendChild(coverage);
    grid.appendChild(highlights);
    panel.appendChild(grid);
    return panel;
  }

  function financeCard(title, leftLabel, leftValue, rightLabel, rightValue) {
    const card = el('article', 'igvaFinanceCard');
    card.appendChild(el('p', 'igvaFinanceLabel', title));
    const split = el('div', 'igvaFinanceSplit');
    const left = el('div');
    left.appendChild(el('p', 'igvaFinanceSub', leftLabel));
    left.appendChild(el('p', 'igvaFinanceValue', formatShortMoney(leftValue)));
    const right = el('div');
    right.appendChild(el('p', 'igvaFinanceSub', rightLabel));
    right.appendChild(el('p', 'igvaFinanceValue', formatShortMoney(rightValue)));
    split.appendChild(left);
    split.appendChild(right);
    card.appendChild(split);
    return card;
  }

  function attentionItem(title, detail) {
    const item = el('li', 'igvaAlertItem');
    item.appendChild(el('strong', null, title));
    item.appendChild(el('span', 'igvaCaption', detail));
    return item;
  }

  function renderAttention(project) {
    const source = project.source_totals || {};
    const labor = component(project, 'labor') || {};
    const materials = component(project, 'materials') || {};
    const calc = project.calculation || {};
    const expected = calc.expected_completion || {};
    const pmValue = readProjectManagerCompletion(project);
    const list = el('ul', 'igvaAlertList');
    list.appendChild(attentionItem('Materialer', `Rest mod expected: ${formatMoney(safeSubtract(materials.expected_cost, materials.actual_cost))}.`));
    list.appendChild(attentionItem('Løn', `Rest mod expected: ${formatMoney(safeSubtract(labor.expected_cost, labor.actual_cost))}.`));
    list.appendChild(attentionItem('Omsætning', `Rest mod expected: ${formatMoney(safeSubtract(source.turnover_expected, source.turnover_actual))}.`));
    if (pmValue !== null && toNumber(expected.percent) !== null) {
      list.appendChild(attentionItem('Projektledervurdering', `Manuel vurdering afviger ${formatPercent(pmValue - expected.percent, 1)}-point fra forventet completion.`));
    }
    const panel = el('section', 'igvaPanel');
    const title = el('div', 'igvaSectionTitle');
    title.appendChild(el('h2', null, 'Opmærksomhed'));
    title.appendChild(createBadge('neutral', { human: 'Observationer', className: 'neutral' }));
    panel.appendChild(title);
    panel.appendChild(list);
    return panel;
  }

  function renderDataQuality(project) {
    const dataSources = project.data_sources || {};
    const source = project.source_totals || {};
    const quality = humanQuality(project.data_quality);
    const panel = el('section', 'igvaPanel');
    const title = el('div', 'igvaSectionTitle');
    title.appendChild(el('h2', null, 'Datagrundlag'));
    title.appendChild(createBadge(project.data_quality, { human: quality.label }));
    panel.appendChild(title);
    panel.appendChild(el('p', 'igvaCaption', quality.detail));
    panel.appendChild(createExplainLine('Lønactual', `${text(dataSources.actual_labor && dataSources.actual_labor.status)} via midlertidig EK V3 legacy-kilde`));
    panel.appendChild(createExplainLine('Materialer', text(dataSources.actual_materials && dataSources.actual_materials.status)));
    panel.appendChild(createExplainLine('Lager/Bil-kilde', `${text(dataSources.actual_materials && dataSources.actual_materials.lager_bil_candidate_confidence)} - ${formatMoney(source.lager_bil_actual_candidate, 2)}`));
    panel.appendChild(createExplainLine('Expected history', `${text(dataSources.expected_history && dataSources.expected_history.status)} · ${text(dataSources.expected_history && dataSources.expected_history.total_rows_observed, '0')} rows`));
    return panel;
  }

  function renderHistorySummary(project) {
    const events = latestHistoryEvents(project, 5);
    const observations = buildSladrehankObservations(project);
    const panel = el('section', 'igvaPanel');
    const title = el('div', 'igvaSectionTitle');
    title.appendChild(el('h2', null, 'Udvikling'));
    const button = el('button', 'igvaBtn ghost', 'Vis historik');
    button.type = 'button';
    button.addEventListener('click', () => openHistoryDrawer(project));
    title.appendChild(button);
    panel.appendChild(title);

    const list = el('ul', 'igvaTimelineList');
    if (!events.length) {
      list.appendChild(attentionItem('Ingen expected-history', 'Der er ingen sikre historik-events i den aktuelle POC-response.'));
    } else {
      events.forEach((event) => list.appendChild(renderTimelineItem(event, true)));
    }
    panel.appendChild(list);

    const box = el('div', 'igvaSladrehank');
    box.appendChild(el('p', 'igvaMiniTitle', 'Sladrehank V1'));
    if (!observations.length) {
      box.appendChild(el('p', 'igvaCaption', 'Ingen sikre observationer ud fra historikken.'));
    } else {
      const obsList = el('ul', 'igvaAlertList');
      observations.forEach((observation) => obsList.appendChild(attentionItem('Bemærk', observation)));
      box.appendChild(obsList);
    }
    panel.appendChild(box);
    return panel;
  }

  function renderTimelineItem(event, compact) {
    const item = el(compact ? 'li' : 'div', 'igvaTimelineItem');
    item.appendChild(el('p', 'igvaTimelineMeta', `${formatDateShort(event.changed_at)} · ${text(event.changed_by, 'Ukendt bruger')}`));
    item.appendChild(el('strong', null, text(event.label, 'Expected ændret')));
    item.appendChild(el('div', `igvaTimelineDelta ${deltaClass(event.delta)}`.trim(), formatDelta(event.delta)));
    const details = compact
      ? `${formatMoney(event.previous_value)} -> ${formatMoney(event.current_value)}`
      : `${formatMoney(event.previous_value)} -> ${formatMoney(event.current_value)} · ${formatPercent(event.delta_percent, 2)}`;
    item.appendChild(el('p', 'igvaCaption', details));
    if (!compact && event.note) item.appendChild(el('p', 'igvaCaption', `Note: ${event.note}`));
    return item;
  }

  function renderMaterialDetailsCard(project) {
    const source = project.source_totals || {};
    const dataSource = project.data_sources && project.data_sources.actual_materials ? project.data_sources.actual_materials : {};
    const card = el('section', 'igvaDrawerCard');
    card.appendChild(el('p', 'igvaMiniTitle', 'Materialeberegning'));
    card.appendChild(createMoneyLine('Kreditor/material køb', source.materials_actual_creditor, { digits: 2 }));
    card.appendChild(createMoneyLine('Intern / Lager/Bil', source.lager_bil_actual_candidate, { digits: 2 }));
    card.appendChild(createExplainLine('Kilde', text(dataSource.lager_bil_candidate_confidence, 'N/A')));
    card.appendChild(createMoneyLine('Beregnet materialactual', source.materials_actual, { digits: 2 }));
    card.appendChild(createMoneyLine('EK reference', source.materials_actual_reference, { digits: 2 }));
    card.appendChild(createMoneyLine('Afstemningsdifference', source.materials_actual_reference_difference, { digits: 2 }));
    const pct = toNumber(source.materials_actual_reference_difference) !== null && toNumber(source.materials_actual_reference)
      ? (source.materials_actual_reference_difference / source.materials_actual_reference) * 100
      : null;
    card.appendChild(createExplainLine('Difference %', formatPercent(pct, 4)));
    card.appendChild(el('p', 'igvaCaption', 'Lager/Bil-kilden er sandsynligt identificeret ud fra EKs interne poster: FinancialAccount=null, StatusEnum=4 og direct ProjectID purchase line. Beløbet er konkret; det er mappingen, der er PROBABLE.'));
    return card;
  }

  function renderWeightingCard(project) {
    const calc = project.calculation || {};
    const expected = calc.expected_completion || {};
    const labor = component(project, 'labor') || {};
    const materials = component(project, 'materials') || {};
    const card = el('section', 'igvaDrawerCard');
    card.appendChild(el('p', 'igvaMiniTitle', 'Økonomisk vægtning'));
    card.appendChild(createExplainLine('Løn forventet', formatMoney(labor.expected_cost)));
    card.appendChild(createExplainLine('Materialer forventet', formatMoney(materials.expected_cost)));
    card.appendChild(createExplainLine('Total inkluderet vægt', formatMoney(expected.included_weight)));
    card.appendChild(createExplainLine('Løn-vægt', formatRatio(labor.expected_weight, 1)));
    card.appendChild(createExplainLine('Materiale-vægt', formatRatio(materials.expected_weight, 1)));
    card.appendChild(createExplainLine('Weighted completion', formatPercent(expected.percent, 2)));
    card.appendChild(el('p', 'igvaCaption', text(expected.formula, 'Formel ikke tilgængelig')));
    return card;
  }
  function openDrawer({ meta, title, footer, content }) {
    const shell = byId('igvaDrawerShell');
    const body = byId('igvaDrawerBody');
    if (!shell || !body) return;
    byId('igvaDrawerMeta').textContent = meta || 'Detaljer';
    byId('igvaDrawerTitle').textContent = title || 'IGVA';
    byId('igvaDrawerFooter').textContent = footer || 'Datakilder vises kun for den lokale POC.';
    clear(body);
    if (content) body.appendChild(content);
    shell.classList.add('open');
    shell.setAttribute('aria-hidden', 'false');
    document.body.classList.add('igvaDrawerOpen');
  }

  function closeDrawer() {
    const shell = byId('igvaDrawerShell');
    if (!shell) return;
    shell.classList.remove('open');
    shell.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('igvaDrawerOpen');
  }

  function openCalculationDrawer(project) {
    const calc = project.calculation || {};
    const source = project.source_totals || {};
    const dataSources = project.data_sources || {};
    const labor = el('section', 'igvaDrawerCard');
    labor.appendChild(el('p', 'igvaMiniTitle', 'Lønberegning'));
    labor.appendChild(createMoneyLine('Løn netto', source.labor_actual_net));
    labor.appendChild(createMoneyLine('Sociale omkostninger', source.labor_actual_social));
    labor.appendChild(createMoneyLine('Beregnet lønactual', source.labor_actual_total));
    labor.appendChild(createMoneyLine('EK reference', source.labor_actual_reference));
    labor.appendChild(createExplainLine('Kilde', 'Lønactual er verificeret mod EK. Datakilden er midlertidigt V3 legacy.'));

    const diff = el('section', 'igvaDrawerCard');
    diff.appendChild(el('p', 'igvaMiniTitle', 'Afstemningsdifference'));
    diff.appendChild(createMoneyLine('Materialer - beregnet vs. EK', source.materials_actual_reference_difference, { digits: 2 }));
    diff.appendChild(createMoneyLine('Løn - beregnet vs. EK', source.labor_actual_reference_difference, { digits: 2 }));
    diff.appendChild(el('p', 'igvaCaption', 'Der anvendes ingen automatisk afrundingsregel. Difference og procent vises som datapunkt.'));

    const sources = el('section', 'igvaDrawerCard');
    sources.appendChild(el('p', 'igvaMiniTitle', 'Datakilder'));
    sources.appendChild(createExplainLine('Expected', `${text(dataSources.expected_values && dataSources.expected_values.source)} · ${text(dataSources.expected_values && dataSources.expected_values.status)}`));
    sources.appendChild(createExplainLine('Budget', `${text(dataSources.budget && dataSources.budget.source)} · ${text(dataSources.budget && dataSources.budget.status)}`));
    sources.appendChild(createExplainLine('Omsætning actual', `EK V4 financialposts · ${text(dataSources.actual_turnover && dataSources.actual_turnover.status)}`));
    sources.appendChild(createExplainLine('Løn actual', `EK V3 legacy fitterhours · ${text(dataSources.actual_labor && dataSources.actual_labor.status)}`));
    sources.appendChild(createExplainLine('Materialer actual', `EK V4 purchaseinvoicelines · ${text(dataSources.actual_materials && dataSources.actual_materials.status)}`));

    const wrap = el('div', 'igvaMainColumn');
    wrap.appendChild(labor);
    wrap.appendChild(renderMaterialDetailsCard(project));
    wrap.appendChild(renderWeightingCard(project));
    wrap.appendChild(diff);
    wrap.appendChild(sources);
    openDrawer({
      meta: 'Beregningsdetaljer',
      title: `Forventet completion ${formatPercent(calc.expected_completion && calc.expected_completion.percent, 1)}`,
      footer: 'Datakilder: EK V4 expected/budget/financialposts/purchase lines + EK V3 legacy lønactual.',
      content: wrap,
    });
  }

  function openHistoryDrawer(project) {
    const history = project.data_sources && project.data_sources.expected_history ? project.data_sources.expected_history : {};
    const capabilities = historyCapabilities(project);
    const events = buildExpectedHistoryEvents(project);
    const wrap = el('div', 'igvaMainColumn');
    const capabilitiesCard = el('section', 'igvaDrawerCard');
    capabilitiesCard.appendChild(el('p', 'igvaMiniTitle', 'Expected-history dækning'));
    capabilitiesCard.appendChild(createExplainLine('Samlet materialer', capabilities.total_materials_history ? 'Ja' : 'Nej'));
    capabilitiesCard.appendChild(createExplainLine('Samlet løn', capabilities.total_labor_history ? 'Ja' : 'Nej'));
    capabilitiesCard.appendChild(createExplainLine('Samlet omsætning', capabilities.total_turnover_history ? 'Ja' : 'Nej'));
    capabilitiesCard.appendChild(createExplainLine('Individuel kreditor-row history', capabilities.creditor_row_history ? 'Ja' : 'Nej'));
    capabilitiesCard.appendChild(el('p', 'igvaCaption', 'POC’en viser kun kategorier, som kan identificeres sikkert fra V4 expectedvalues/history. Kreditorhistorik fabriceres ikke.'));
    wrap.appendChild(capabilitiesCard);

    if (!events.length) {
      const empty = el('section', 'igvaDrawerCard');
      empty.appendChild(el('p', 'igvaCaption', 'Ingen sikre expected-history events i den aktuelle response.'));
      wrap.appendChild(empty);
    } else {
      events.forEach((event) => {
        const card = el('section', 'igvaDrawerCard');
        card.appendChild(el('p', 'igvaTimelineMeta', `${formatDateTime(event.changed_at)} · ${text(event.changed_by, 'Ukendt bruger')}`));
        card.appendChild(renderTimelineItem(event, false));
        wrap.appendChild(card);
      });
    }

    openDrawer({
      meta: 'Historik',
      title: `${text(project.external_project_ref, '-')} · expected values`,
      footer: `${text(history.total_rows_observed, '0')} history rows observeret fra EK V4 expectedvalues/history.`,
      content: wrap,
    });
  }

  function listLines(items, formatter, empty = 'Ingen') {
    if (!Array.isArray(items) || items.length === 0) return [empty];
    return items.map(formatter);
  }

  function renderDebugDetails(project) {
    const details = el('details', 'igvaDetails');
    const summary = document.createElement('summary');
    summary.textContent = 'Debug beregning';
    details.appendChild(summary);
    const body = el('div', 'igvaDetailsBody');
    const calc = project.calculation || {};
    const source = project.source_totals || {};
    const dataSources = project.data_sources || {};
    const expectedMaterials = project.expected_materials || {};
    const history = dataSources.expected_history || {};
    const coverage = calc.calculation_coverage || {};
    const lines = [
      `Expected completion: ${formatPercent(calc.expected_completion && calc.expected_completion.percent, 2)}`,
      `Coverage (${text(coverage.basis)}): ${formatPercent(coverage.percent, 2)}`,
      `Included weight: ${formatMoney(coverage.included_weight)} / known weight: ${formatMoney(coverage.known_weight)}`,
      `Included: ${listLines(coverage.included, (item) => `${item.key} ${formatMoney(item.weight)} @ ${formatRatio(item.completion, 2)}`).join('; ')}`,
      `Excluded: ${listLines(coverage.excluded, (item) => `${item.key} (${(item.reason || []).join(', ')})`).join('; ')}`,
      '',
      `Budget completion: ${formatPercent(calc.budget_completion && calc.budget_completion.percent, 2)}`,
      `Expected formula: ${text(calc.expected_completion && calc.expected_completion.formula)}`,
      '',
      'Arbejdsløn:',
      `  Actual hours BasisTotalHours: ${formatNumber(source.hours_actual)}`,
      `  Net/social/total actual: ${formatMoney(source.labor_actual_net)} / ${formatMoney(source.labor_actual_social)} / ${formatMoney(source.labor_actual_total)}`,
      `  Expected net/social/total: ${formatMoney(source.labor_expected_net)} / ${formatMoney(source.labor_expected_social)} / ${formatMoney(source.labor_expected_total)}`,
      '',
      'Materialer:',
      `  Expected totalPurchases: ${formatMoney(source.materials_expected_total)}`,
      `  Creditor/material actual: ${formatMoney(source.materials_actual_creditor, 2)}`,
      `  Lager/Bil actual: ${formatMoney(source.lager_bil_actual_candidate, 2)} (${text(source.lager_bil_actual_candidate_confidence)}) rows=${text(source.lager_bil_actual_candidate_rows, '0')}`,
      `  Samlet material actual: ${formatMoney(source.materials_actual, 2)}`,
      `  Lager/Bil expected bucket: ${formatMoney(source.lager_bil_expected)}`,
      `  Expected breakdown total: ${formatMoney(expectedMaterials.breakdown_total)}`,
      `  Uspecificeret expected residual: ${formatMoney(source.unallocated_expected_materials)}`,
      '',
      'History capabilities:',
      `  Creditor-row history: ${historyCapabilities(project).creditor_row_history ? 'true' : 'false'}`,
      `  Events: ${buildExpectedHistoryEvents(project).length}`,
    ];
    const pre = document.createElement('pre');
    pre.textContent = lines.join('\n');
    body.appendChild(pre);
    details.appendChild(body);
    return details;
  }
  function projectRefKey(projectOrRef) {
    const value = typeof projectOrRef === 'string'
      ? projectOrRef
      : projectOrRef && (projectOrRef.external_project_ref || projectOrRef.project_id);
    return String(value || '').trim().toLowerCase();
  }

  function mergeProjectDetail(project) {
    const refKey = projectRefKey(project);
    if (!project || !refKey) return;
    state.projectDetailsByRef[refKey] = project;
    state.projects = state.projects.map((item) => {
      if (projectRefKey(item) === refKey || String(item.project_id) === String(project.project_id)) {
        return { ...item, ...project };
      }
      return item;
    });
    state.filteredProjects = state.filteredProjects.map((item) => {
      if (projectRefKey(item) === refKey || String(item.project_id) === String(project.project_id)) {
        return { ...item, ...project };
      }
      return item;
    });
  }

  async function loadProjectDetail(project) {
    const refKey = projectRefKey(project);
    if (!project || !refKey || project.calculation || state.loadingProjectRef === refKey) return;
    const cached = state.projectDetailsByRef[refKey];
    if (cached) {
      mergeProjectDetail(cached);
      renderSelectedProject();
      renderTechnicalRows();
      return;
    }

    const status = byId('igvaStatus');
    state.loadingProjectRef = refKey;
    const label = text(project.external_project_ref || project.project_id, refKey);
    if (status) status.textContent = `Henter økonomi for ${label}. Øvrige projekter hentes ikke automatisk.`;
    try {
      const detailUrl = state.mode === 'embedded' && state.embeddedEndpoint
        ? state.embeddedEndpoint
        : `/api/igva-poc/projects?project_ref=${encodeURIComponent(project.external_project_ref || refKey)}`;
      const payload = await apiFetch(detailUrl, { method: 'GET' });
      const detail = payload && Array.isArray(payload.projects) ? payload.projects[0] : null;
      if (detail) {
        mergeProjectDetail(detail);
        renderSelectedProject();
        renderTechnicalRows();
        if (status) status.textContent = `Økonomi hentet for ${text(detail.external_project_ref || detail.project_id, refKey)}. Projektlederprocent gemmes kun lokalt i browseren i denne POC.`;
      }
    } catch (error) {
      if (error && (error.status === 401 || error.status === 403)) { renderAccessDenied(); return; }
      if (status) status.textContent = `Kunne ikke hente økonomi for ${text(project.external_project_ref || project.project_id, refKey)}: ${error && error.message ? error.message : 'request_failed'}`;
    } finally {
      if (state.loadingProjectRef === refKey) state.loadingProjectRef = null;
    }
  }

  function renderProjectLoading(project) {
    const panel = el('section', 'igvaPanel');
    const title = el('div', 'igvaSectionTitle');
    const embedded = state.mode === 'embedded';
    title.appendChild(el('h2', null, embedded ? 'Økonomi hentes for aktuel sag' : 'Økonomi hentes for valgt projekt'));
    title.appendChild(el('span', 'igvaMuted', 'IGVA henter kun økonomi for ét projekt ad gangen.'));
    panel.appendChild(title);
    const message = embedded
      ? `Aktuel sag: ${text(project.external_project_ref || project.project_id, '-')}. Ingen projektvælger bruges i projektfanen.`
      : `Vælg projekt eller brug project_ref i URL'en. Aktuelt valg: ${text(project.external_project_ref, '-')}.`;
    panel.appendChild(el('p', 'igvaCaption', message));
    return panel;
  }

  function selectedProject() {
    return state.projects.find((project) => String(project.project_id) === String(state.selectedProjectId))
      || state.filteredProjects[0]
      || state.projects[0]
      || null;
  }

  function renderSelectedProject() {
    const dashboard = byId('igvaDashboard');
    clear(dashboard);
    const project = selectedProject();
    if (!dashboard || !project) return;
    dashboard.appendChild(renderHeader(project));
    if (!project.calculation) {
      dashboard.appendChild(renderProjectLoading(project));
      return;
    }
    const grid = el('section', 'igvaContentGrid');
    const main = el('div', 'igvaMainColumn');
    const side = el('div', 'igvaSideColumn');
    main.appendChild(renderCompletion(project));
    main.appendChild(renderComponentBreakdown(project));
    main.appendChild(renderHistorySummary(project));
    side.appendChild(renderFinanceSummary(project));
    side.appendChild(renderAttention(project));
    side.appendChild(renderDataQuality(project));
    grid.appendChild(main);
    grid.appendChild(side);
    dashboard.appendChild(grid);
  }

  function projectMatches(project, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    return [
      project.external_project_ref,
      project.name,
      project.responsible && project.responsible.name,
      project.responsible && project.responsible.code,
    ].some((value) => String(value || '').toLowerCase().includes(q));
  }

  function refreshProjectPicker() {
    const search = byId('igvaProjectSearch');
    const select = byId('igvaProjectSelect');
    const query = search ? search.value : '';
    state.filteredProjects = state.projects.filter((project) => projectMatches(project, query));
    if (!state.filteredProjects.some((project) => String(project.project_id) === String(state.selectedProjectId))) {
      const fromUrl = state.projectRefFromUrl
        ? state.filteredProjects.find((project) => String(project.external_project_ref || '').toLowerCase() === state.projectRefFromUrl)
        : null;
      state.selectedProjectId = (fromUrl || state.filteredProjects[0] || {}).project_id || null;
    }
    clear(select);
    if (select) {
      state.filteredProjects.forEach((project) => {
        const option = document.createElement('option');
        option.value = project.project_id;
        option.textContent = `${text(project.external_project_ref, '-')} · ${text(project.name, 'Uden navn')}`;
        option.selected = String(project.project_id) === String(state.selectedProjectId);
        select.appendChild(option);
      });
    }
    renderSelectedProject();
    renderTechnicalRows();
  }

  function createCell(value) {
    const td = document.createElement('td');
    td.textContent = value;
    return td;
  }

  function createStackCell(items) {
    const td = document.createElement('td');
    const wrap = el('div', 'igvaStack');
    items.filter(Boolean).forEach((item) => {
      if (typeof item === 'string') wrap.appendChild(el('span', null, item));
      else wrap.appendChild(item);
    });
    td.appendChild(wrap);
    return td;
  }

  function renderTechnicalRows() {
    const body = byId('igvaTechnicalRows');
    clear(body);
    if (!body) return;
    state.filteredProjects.forEach((project) => {
      const calc = project.calculation || {};
      const source = project.source_totals || {};
      const labor = component(project, 'labor');
      const pmValue = readProjectManagerCompletion(project);
      const history = project.data_sources && project.data_sources.expected_history ? project.data_sources.expected_history : {};
      const tr = document.createElement('tr');
      tr.appendChild(createCell(text(project.external_project_ref, '-')));
      tr.appendChild(createCell(text(project.name, 'Uden navn')));
      tr.appendChild(createStackCell([
        formatPercent(calc.calculation_coverage && calc.calculation_coverage.percent, 2),
        el('span', 'igvaMuted', `basis: ${text(calc.calculation_coverage && calc.calculation_coverage.basis)}`),
      ]));
      tr.appendChild(createCell(formatPercent(calc.budget_completion && calc.budget_completion.percent, 2)));
      tr.appendChild(createCell(formatPercent(calc.expected_completion && calc.expected_completion.percent, 2)));
      tr.appendChild(createCell(pmValue === null ? 'N/A' : formatPercent(pmValue, 0)));
      tr.appendChild(createStackCell([
        `Actual: ${formatMoney(source.turnover_actual)}`,
        `Expected: ${formatMoney(source.turnover_expected)}`,
        createBadge(project.data_sources && project.data_sources.actual_turnover && project.data_sources.actual_turnover.status),
      ]));
      tr.appendChild(createStackCell([
        `Actual: ${formatMoney(source.labor_actual_total || (labor && labor.actual_cost))}`,
        `Expected: ${formatMoney(source.labor_expected_total || (labor && labor.expected_cost))}`,
      ]));
      tr.appendChild(createStackCell([
        `Total ${formatMoney(source.materials_actual, 2)}`,
        `Creditor ${formatMoney(source.materials_actual_creditor, 2)}`,
        `Lager/Bil ${formatMoney(source.lager_bil_actual_candidate, 2)}`,
        createBadge(source.materials_actual_status || 'PARTIAL'),
      ]));
      tr.appendChild(createStackCell([
        `${text(history.status)} rows=${text(history.total_rows_observed, '0')}`,
        `events=${buildExpectedHistoryEvents(project).length}`,
        `creditor rows=${historyCapabilities(project).creditor_row_history ? 'ja' : 'nej'}`,
      ]));
      tr.appendChild(createBadge(project.data_quality));
      const detailsCell = document.createElement('td');
      detailsCell.appendChild(renderDebugDetails(project));
      tr.appendChild(detailsCell);
      body.appendChild(tr);
    });
  }

  function renderAccessDenied() {
    const status = byId('igvaStatus');
    const dashboard = byId('igvaDashboard');
    const technicalRows = byId('igvaTechnicalRows');
    const empty = byId('igvaEmpty');
    if (status) status.textContent = 'Du har ikke adgang til IGVA POC.';
    if (empty) empty.hidden = true;
    clear(technicalRows);
    clear(dashboard);
    if (!dashboard) return;
    const panel = el('section', 'igvaPanel');
    const title = el('div', 'igvaSectionTitle');
    title.appendChild(el('h2', null, 'Du har ikke adgang til IGVA POC.'));
    title.appendChild(el('span', 'igvaMuted', 'Adgangen er begrænset for denne online POC.'));
    panel.appendChild(title);
    panel.appendChild(el('p', 'igvaCaption', 'Kontakt Fielddesk, hvis du mener, at du skal have adgang.'));
    dashboard.appendChild(panel);
  }
  function wireDrawer() {
    if (state.drawerWired) return;
    state.drawerWired = true;
    const close = byId('igvaDrawerClose');
    if (close) close.addEventListener('click', closeDrawer);
    Array.from(document.querySelectorAll('[data-igva-drawer-close]')).forEach((node) => node.addEventListener('click', closeDrawer));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeDrawer();
    });
  }

  function buildEmbeddedPlaceholderProject(options) {
    const source = options || {};
    return {
      project_id: source.projectId || source.project_id || null,
      external_project_ref: source.projectRef || source.external_project_ref || null,
      name: source.projectName || source.name || 'Sag',
      responsible: source.responsible || null,
      lifecycle: {
        status: source.status || null,
        is_closed: Boolean(source.isClosed),
        closed_observed_at: source.closedObservedAt || null,
      },
      data_quality: 'NOT_LOADED',
      calculation: null,
    };
  }

  async function initEmbeddedProject(options) {
    const status = byId('igvaStatus');
    state.mode = 'embedded';
    state.embeddedEndpoint = options && options.endpoint ? options.endpoint : null;
    state.embeddedProjectContext = options || {};
    state.projects = [buildEmbeddedPlaceholderProject(options || {})];
    state.filteredProjects = state.projects.slice();
    state.selectedProjectId = state.projects[0].project_id || projectRefKey(state.projects[0]);
    state.projectRefFromUrl = null;
    state.projectDetailsByRef = Object.create(null);
    wireDrawer();
    const empty = byId('igvaEmpty');
    if (empty) empty.hidden = true;
    renderSelectedProject();
    renderTechnicalRows();
    if (!state.embeddedEndpoint) {
      if (status) status.textContent = 'IGVA endpoint mangler for denne sag.';
      return;
    }
    await loadProjectDetail(state.projects[0]);
  }

  async function init() {
    const status = byId('igvaStatus');
    const logoutBtn = byId('igvaLogoutBtn');
    const search = byId('igvaProjectSearch');
    const select = byId('igvaProjectSelect');
    wireDrawer();
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
    if (search) search.addEventListener('input', refreshProjectPicker);
    if (select) select.addEventListener('change', () => {
      state.selectedProjectId = select.value;
      renderSelectedProject();
      renderTechnicalRows();
      loadProjectDetail(selectedProject());
    });

    let me = null;
    try {
      me = await apiFetch('/api/me', { method: 'GET' });
    } catch (error) {
      if (error && (error.status === 401 || error.status === 403)) { logout(); return; }
      if (status) status.textContent = `Kunne ikke hente brugerdata: ${error && error.message ? error.message : 'request_failed'}`;
      return;
    }

    const userName = me && me.user && (me.user.username || me.user.name) ? (me.user.username || me.user.name) : 'Fielddesk';
    const tenantName = me && me.tenant && me.tenant.name ? me.tenant.name : window.location.hostname.split('.')[0];
    if (byId('igvaUser')) byId('igvaUser').textContent = `${userName} · ${tenantName}`;
    if (byId('igvaTenantShort')) byId('igvaTenantShort').textContent = String(userName).slice(0, 4).toUpperCase();

    try {
      const params = new URLSearchParams(window.location.search || '');
      const projectRef = params.get('project_ref') || params.get('project');
      state.projectRefFromUrl = projectRef ? String(projectRef).trim().toLowerCase() : null;
      const projectQuery = projectRef ? `?project_ref=${encodeURIComponent(projectRef)}` : '';
      const payload = await apiFetch(`/api/igva-poc/projects${projectQuery}`, { method: 'GET' });
      state.projects = payload && Array.isArray(payload.projects) ? payload.projects : [];
      state.filteredProjects = state.projects.slice();
      if (state.projectRefFromUrl) {
        const match = state.projects.find((project) => String(project.external_project_ref || '').toLowerCase() === state.projectRefFromUrl);
        state.selectedProjectId = (match || state.projects[0] || {}).project_id || null;
      } else {
        state.selectedProjectId = (state.projects[0] || {}).project_id || null;
      }
      const empty = byId('igvaEmpty');
      if (empty) empty.hidden = state.projects.length > 0;
      refreshProjectPicker();
      if (status) {
        const count = state.projects.length;
        const mode = payload && payload.economy_mode ? payload.economy_mode : 'igva_poc';
        status.textContent = `${count} projekter i dit aktuelle Fielddesk-scope${projectRef ? ` for ${projectRef}` : ''}. Mode: ${mode}. Projektlederprocent gemmes kun lokalt i browseren i denne POC.`;
      }
      const initialProject = selectedProject();
      if (initialProject && !initialProject.calculation) await loadProjectDetail(initialProject);
    } catch (error) {
      if (error && (error.status === 401 || error.status === 403)) { renderAccessDenied(); return; }
      if (status) status.textContent = `Kunne ikke hente IGVA POC-data: ${error && error.message ? error.message : 'request_failed'}`;
    }
  }

  window.FielddeskIgvaPoc = {
    initEmbeddedProject,
  };

  window.__igvaPocV31Test = {
    buildExpectedHistoryEvents,
    buildSladrehankObservations,
    evaluateEconomyHealth,
    historyCapabilities,
    renderAccessDenied,
    loadProjectDetail,
    projectRefKey,
    initEmbeddedProject,
  };

  if (document.body && document.body.dataset.page === 'igva-poc') {
    init();
  }
})();