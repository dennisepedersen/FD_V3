'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  RETENTION_DAYS,
  classifyWorksheetLifecycle,
  isCommonOrSystemFitter,
  mapWorksheetRow,
} = require('../backend/src/services/worksheetAssignmentService');

test('worksheet lifecycle keeps completed access for 30 days and then expires it', () => {
  const completed = mapWorksheetRow({
    id: 123,
    projectID: 31272,
    projectReference: '80548',
    responsibleFitterID: 456,
    statusEnum: 'Completed',
    completedDate: '2026-07-01T10:00:00Z',
  });

  assert.equal(RETENTION_DAYS, 30);
  assert.deepEqual(
    classifyWorksheetLifecycle(completed, new Date('2026-07-15T00:00:00Z')),
    {
      isAccessCandidate: true,
      validUntil: '2026-07-31T10:00:00.000Z',
      reason: 'terminal_within_retention',
    }
  );
  assert.deepEqual(
    classifyWorksheetLifecycle(completed, new Date('2026-08-01T00:00:00Z')),
    {
      isAccessCandidate: false,
      validUntil: '2026-07-31T10:00:00.000Z',
      reason: 'terminal_retention_expired',
    }
  );
});

test('closedDate is more authoritative than completedDate for retention', () => {
  const worksheet = mapWorksheetRow({
    id: 124,
    projectID: 31272,
    responsibleFitterID: 456,
    statusEnum: 'Completed',
    completedDate: '2026-07-01T10:00:00Z',
    closedDate: '2026-07-03T12:00:00Z',
  });

  const lifecycle = classifyWorksheetLifecycle(worksheet, new Date('2026-07-20T00:00:00Z'));
  assert.equal(lifecycle.validUntil, '2026-08-02T12:00:00.000Z');
  assert.equal(lifecycle.reason, 'terminal_within_retention');
});

test('reopened active worksheet clears prior completion retention', () => {
  const reopened = mapWorksheetRow({
    id: 125,
    projectID: 31272,
    responsibleFitterID: 456,
    statusEnum: 'InProgress',
    completedDate: '2026-07-01T10:00:00Z',
  });

  const lifecycle = classifyWorksheetLifecycle(reopened, new Date('2026-08-20T00:00:00Z'));
  assert.deepEqual(lifecycle, {
    isAccessCandidate: true,
    validUntil: null,
    reason: 'active_status',
  });
});

test('boolean completion flags are metadata and not retention timestamps', () => {
  const active = mapWorksheetRow({
    id: 126,
    projectID: 31272,
    responsibleFitterID: 456,
    statusEnum: 'NotStarted',
    isCompleted: true,
    isClosed: false,
  });

  assert.equal(active.completedDate, null);
  assert.equal(active.closedDate, null);
});

test('active worksheet statuses grant candidate access without valid_until', () => {
  for (const statusEnum of ['NotStarted', 'InProgress', 'PartiallyCompleted']) {
    const lifecycle = classifyWorksheetLifecycle({ statusEnum }, new Date('2026-07-20T00:00:00Z'));
    assert.equal(lifecycle.isAccessCandidate, true);
    assert.equal(lifecycle.validUntil, null);
    assert.equal(lifecycle.reason, 'active_status');
  }
});

test('unsupported worksheet statuses do not grant access', () => {
  const lifecycle = classifyWorksheetLifecycle({ statusEnum: 'Archived' }, new Date('2026-07-20T00:00:00Z'));
  assert.equal(lifecycle.isAccessCandidate, false);
  assert.equal(lifecycle.reason, 'unsupported_status');
});

test('common default system fitters are blocked from individual access', () => {
  assert.equal(isCommonOrSystemFitter({ fitter_id: '999', name: 'Fælles montør' }), true);
  assert.equal(isCommonOrSystemFitter({ fitter_id: '123', name: 'Martin Uth Møller' }), false);
});

test('worksheet sync is the only automatic assignment path', () => {
  const syncWorker = fs.readFileSync(path.join(__dirname, '../backend/src/services/syncWorker.js'), 'utf8');
  const worksheetService = fs.readFileSync(path.join(__dirname, '../backend/src/services/worksheetAssignmentService.js'), 'utf8');

  assert.match(syncWorker, /upsertWorksheetAssignments/);
  assert.doesNotMatch(syncWorker, /project_assignment_source[\s\S]+fitterhours/);
  assert.doesNotMatch(syncWorker, /project_assignment_source[\s\S]+calendarevents/);
  assert.doesNotMatch(syncWorker, /project_assignment_source[\s\S]+resource_groups/);
  assert.match(worksheetService, /sourceType: 'worksheet'|source_type = 'worksheet'/);
});

test('migration protects manual and worksheet sources separately', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/0040_worksheet_project_assignment_sources.sql'), 'utf8');

  assert.match(migration, /CREATE TABLE IF NOT EXISTS project_assignment_source/);
  assert.match(migration, /source_type IN \('manual', 'worksheet'\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ek_worksheet/);
  assert.match(migration, /INSERT INTO project_assignment_source[\s\S]+'manual'/);
});
