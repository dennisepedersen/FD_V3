'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(repoRoot, 'backend/src/public/tenant/fd-datepicker.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function loadApi() {
  const context = {
    window: {},
    console,
    Date,
    Intl,
    Event: class Event {
      constructor(type, options = {}) {
        this.type = type;
        this.bubbles = Boolean(options.bubbles);
      }
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: sourcePath });
  return context.window.FielddeskDatePicker;
}

test('fd datepicker calendar engine keeps da-DK monday-first date math', () => {
  const api = loadApi();
  const helpers = api._test;

  assert.deepEqual(Array.from(helpers.WEEKDAYS_DA), ['man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn']);
  assert.equal(helpers.MONTHS_DA[1], 'februar');
  assert.equal(helpers.daysInMonth(2028, 2), 29);
  assert.equal(helpers.daysInMonth(2027, 2), 28);
  assert.equal(helpers.addDays('2026-03-29', 1), '2026-03-30');
  assert.equal(helpers.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(helpers.calendarGridStart({ year: 2026, month: 8, day: 1 }).year, 2026);
  assert.equal(helpers.calendarGridStart({ year: 2026, month: 8, day: 1 }).month, 7);
  assert.equal(helpers.calendarGridStart({ year: 2026, month: 8, day: 1 }).day, 27);
});

test('fd datepicker preserves ISO values and supports range selection ordering', () => {
  const helpers = loadApi()._test;

  assert.equal(helpers.formatISODate('2026-08-18'), '2026-08-18');
  assert.equal(helpers.formatISODate('2026-02-31'), '');
  assert.equal(JSON.stringify(helpers.createRangeSelection({}, '2026-08-20')), JSON.stringify({ start: '2026-08-20', end: '' }));
  assert.equal(
    JSON.stringify(helpers.createRangeSelection({ start: '2026-08-20', end: '' }, '2026-08-18')),
    JSON.stringify({ start: '2026-08-18', end: '2026-08-20' }),
  );
  assert.equal(
    JSON.stringify(helpers.createRangeSelection({ start: '2026-08-18', end: '' }, '2026-08-20')),
    JSON.stringify({ start: '2026-08-18', end: '2026-08-20' }),
  );
});

test('fd date range picker commits start and end together before dispatching input events', () => {
  const api = loadApi();
  const snapshots = [];
  const endInput = {
    value: '2027-07-02',
    dispatchEvent(event) {
      snapshots.push({ source: 'end', type: event.type, start: startInput.value, end: endInput.value });
    },
  };
  const startInput = {
    value: '2027-07-01',
    dispatchEvent(event) {
      snapshots.push({ source: 'start', type: event.type, start: startInput.value, end: endInput.value });
    },
  };
  const picker = Object.create(api.FDDateRangePicker.prototype);
  Object.assign(picker, {
    startInput,
    endInput,
    draft: { start: '2027-07-26', end: '2027-07-31' },
    options: { onChange: (range) => snapshots.push({ source: 'change', ...range }) },
  });

  picker.commitDraft();

  assert.equal(startInput.value, '2027-07-26');
  assert.equal(endInput.value, '2027-07-31');
  assert.deepEqual(snapshots[0], { source: 'start', type: 'input', start: '2027-07-26', end: '2027-07-31' });
  assert.deepEqual(snapshots[snapshots.length - 1], { source: 'change', start: '2027-07-26', end: '2027-07-31' });
});

test('fd date range picker cancel preserves values, clear resets both, and today drafts a one-day range', () => {
  const api = loadApi();
  let removed = false;
  let renderCount = 0;
  const startInput = { value: '2027-07-01', dispatchEvent() {}, focus() {} };
  const endInput = { value: '2027-07-02', dispatchEvent() {}, focus() {} };
  const picker = Object.create(api.FDDateRangePicker.prototype);
  Object.assign(picker, {
    startInput,
    endInput,
    draft: { start: '2027-07-26', end: '2027-07-31' },
    options: {},
    isOpen: true,
    overlay: { remove: () => { removed = true; } },
    triggers: [],
    updateTriggers() {},
    render() { renderCount += 1; },
  });

  picker.close(false);
  assert.equal(startInput.value, '2027-07-01');
  assert.equal(endInput.value, '2027-07-02');
  assert.equal(removed, true);

  picker.clearDraft();
  picker.commitDraft();
  assert.equal(startInput.value, '');
  assert.equal(endInput.value, '');

  picker.pickToday();
  assert.ok(picker.draft.start);
  assert.equal(picker.draft.end, picker.draft.start);
  assert.equal(renderCount, 1);
});
test('fd datepicker decorations normalize disabled range dot underline and info markers', () => {
  const helpers = loadApi()._test;
  const decorations = helpers.normalizeDecorations([
    { id: 'range', start: '2026-08-10', end: '2026-08-12', styles: ['range', 'underline'], label: 'A', priority: 10 },
    { id: 'single', date: '2026-08-11', kind: 'dot', info: 'B', priority: 20 },
    { id: 'blocked', start: '2026-08-12', end: '2026-08-13', disabled: true, priority: 30 },
    { id: 'bad', date: '2026-02-31', styles: ['range'] },
  ]);

  assert.equal(decorations.length, 3);
  assert.equal(decorations[0].id, 'blocked');
  const day = helpers.decorationsForDate('2026-08-12', decorations);
  assert.equal(day.length, 2);
  assert.ok(day.some((item) => item.styles.includes('disabled')));
  assert.ok(day.some((item) => item.styles.includes('range')));
  assert.ok(helpers.decorationsForDate('2026-08-11', decorations).some((item) => item.styles.includes('dot')));
});

test('fd datepicker component stays generic and mobile controls keep 16px', () => {
  assert.match(source, /FDDatePicker/);
  assert.match(source, /FDDateRangePicker/);
  assert.match(source, /font-size: 16px/);
  assert.match(source, /@media \(hover: none\), \(max-width: 767px\)/);
  assert.match(source, /Escape/);
  assert.match(source, /ArrowLeft/);
  assert.doesNotMatch(source, /absence|fravær|ferie|tenant|manager|special_window|project|cctv|mac/i);
});
