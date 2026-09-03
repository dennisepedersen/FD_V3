'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('backend/src/public/tenant/igva-poc.html', 'utf8');
const js = fs.readFileSync('backend/src/public/tenant/igva-poc.js', 'utf8');

test('IGVA POC v3.1 uses Fielddesk shell, dashboard primary surface and collapsed technical table', () => {
  assert.match(html, /IGVA POC v3\.1/);
  assert.match(html, /igvaAppShell/);
  assert.match(html, /igvaSidebar/);
  assert.match(html, /id="igvaDashboard"/);
  assert.match(html, /Tekniske detaljer/);
  assert.ok(html.indexOf('id="igvaDashboard"') < html.indexOf('Tekniske detaljer'));
});

test('IGVA POC v3.1 exposes project search, project selection and the three completion perspectives', () => {
  assert.match(html, /id="igvaProjectSearch"/);
  assert.match(html, /id="igvaProjectSelect"/);
  assert.match(js, /title: 'Budget'/);
  assert.match(js, /title: 'Forventet'/);
  assert.match(js, /title: 'Projektleder'/);
  assert.match(js, /Budget-perspektivet\. Viser N\/A/);
  assert.match(js, /Kommentar til vurdering/);
});

test('IGVA POC v3.1 explains weighted completion through drawer and preserves Lager Bil wording', () => {
  assert.match(html, /id="igvaDrawerShell"/);
  assert.match(js, /openCalculationDrawer/);
  assert.match(js, /Økonomisk vægtning/);
  assert.match(js, /Kreditor\/material køb/);
  assert.match(js, /Intern \/ Lager\/Bil/);
  assert.match(js, /Beløbet er konkret; det er mappingen, der er PROBABLE/);
  assert.doesNotMatch(js, /estimeret lagerdata|Marginal|100-kr|100 kr|afrundingsfejl/i);
});

test('IGVA POC v3.1 separates data quality from project attention', () => {
  assert.match(js, /function renderDataQuality/);
  assert.match(js, /function renderAttention/);
  const attentionBody = js.slice(js.indexOf('function renderAttention'), js.indexOf('function renderDataQuality'));
  assert.doesNotMatch(attentionBody, /Datakvalitet/);
});

test('IGVA POC v3.1 exposes development history, Sladrehank V1 and no creditor history fabrication', () => {
  assert.match(js, /function buildExpectedHistoryEvents/);
  assert.match(js, /function buildSladrehankObservations/);
  assert.match(js, /Udvikling/);
  assert.match(js, /Sladrehank V1/);
  assert.match(js, /Vis historik/);
  assert.match(js, /creditor_row_history: false/);
  assert.match(js, /Kreditorhistorik fabriceres ikke/);
});

test('IGVA POC v3.1 keeps status policy neutral until a real tolerance policy exists', () => {
  assert.match(js, /function evaluateEconomyHealth/);
  assert.match(js, /status: 'neutral'/);
  assert.match(js, /TODO: gør policy proportional/);
});
test('IGVA POC v3.1 lazy-loads economy for selected project only', () => {
  assert.match(js, /projectDetailsByRef: Object\.create\(null\)/);
  assert.match(js, /function loadProjectDetail/);
  assert.match(js, /\/api\/igva-poc\/projects\?project_ref=/);
  assert.match(js, /function renderProjectLoading/);
  assert.doesNotMatch(js, /economy=detail[^`'"\n]*`/);
});
test('IGVA POC v3.1 shows neutral access message for IGVA API 401 or 403', () => {
  assert.match(js, /function renderAccessDenied/);
  assert.match(js, /Du har ikke adgang til IGVA POC/);
  assert.match(js, /Kunne ikke hente brugerdata/);
  assert.match(js, /Kunne ikke hente IGVA POC-data/);
});