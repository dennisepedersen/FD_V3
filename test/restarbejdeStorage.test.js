'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://example.invalid/fielddesk_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'fielddesk.test';

const repoRoot = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const auditService = require('../backend/src/services/auditService');
const restarbejdeRepository = require('../backend/src/modules/restarbejde/restarbejde.repository');
const restarbejdeService = require('../backend/src/modules/restarbejde/restarbejde.service');

function uuid(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function assertBadRequest(fn, message) {
  assert.throws(fn, (error) => error.statusCode === 400 && error.message === message);
}

test('PR3 migration creates Restarbejde-owned storage tables without reusing CCTV tables', () => {
  const migration = read('migrations/0039_project_restarbejde_drawings_placements_attachments.sql');
  assert.match(migration, /CREATE TABLE project_restarbejde_drawing/);
  assert.match(migration, /CREATE TABLE project_restarbejde_placement/);
  assert.match(migration, /CREATE TABLE project_restarbejde_attachment/);
  assert.match(migration, /FOREIGN KEY \(storage_object_id, tenant_id\) REFERENCES storage_object\(id, tenant_id\)/);
  assert.match(migration, /FOREIGN KEY \(item_id, tenant_id, project_id\) REFERENCES project_restarbejde_item\(id, tenant_id, project_id\)/);
  assert.match(migration, /FOREIGN KEY \(drawing_id, tenant_id, project_id\) REFERENCES project_restarbejde_drawing\(id, tenant_id, project_id\)/);
  assert.match(migration, /source_type IN \('image', 'pdf'\)/);
  assert.match(migration, /attachment_type IN \('photo', 'document', 'other'\)/);
  assert.match(migration, /x_percent numeric\(6,3\) NOT NULL/);
  assert.match(migration, /y_percent numeric\(6,3\) NOT NULL/);
  assert.match(migration, /page_number integer NOT NULL/);
  assert.match(migration, /restarbejde\.drawing_created/);
  assert.match(migration, /restarbejde\.placement_updated/);
  assert.match(migration, /restarbejde\.attachment_archived/);
  const storageDdl = migration.slice(migration.indexOf('ALTER TABLE project_restarbejde_item'));
  assert.doesNotMatch(storageDdl, /project_equipment_cctv_(drawing|pin|image|camera)/);
  assert.doesNotMatch(storageDdl, /dataUrl|base64|localStorage/i);
});

test('PR3 schema snapshot includes the same Restarbejde storage tables and audit events', () => {
  const schema = read('schema.sql');
  for (const tableName of ['project_restarbejde_drawing', 'project_restarbejde_placement', 'project_restarbejde_attachment']) {
    assert.match(schema, new RegExp(`CREATE TABLE ${tableName}`));
  }
  for (const eventType of [
    'restarbejde.drawing_created',
    'restarbejde.drawing_restored',
    'restarbejde.placement_created',
    'restarbejde.placement_restored',
    'restarbejde.attachment_created',
    'restarbejde.attachment_archived',
  ]) {
    assert.match(schema, new RegExp(eventType.replace('.', '\\.')));
  }
});

test('Restarbejde routes expose auth-protected PR3 endpoints with expected permissions', () => {
  const routes = read('backend/src/modules/restarbejde/restarbejde.routes.js');
  assert.match(routes, /Busboy = require\("busboy"\)/);
  assert.match(routes, /router\.post\("\/api\/projects\/:projectId\/restarbejde\/drawings"/);
  assert.match(routes, /requireRestarbejdeAccess\(req, "manage_drawings"\)/);
  assert.match(routes, /router\.get\("\/api\/projects\/:projectId\/restarbejde\/drawings\/:drawingId\/content"/);
  assert.match(routes, /router\.post\("\/api\/projects\/:projectId\/restarbejde\/drawings\/:drawingId\/placements"/);
  assert.match(routes, /requireRestarbejdeAccess\(req, "manage_placements"\)/);
  assert.match(routes, /router\.post\("\/api\/projects\/:projectId\/restarbejde\/drawings\/:drawingId\/placements\/:placementId\/restore"/);
  assert.match(routes, /requireRestarbejdeAccess\(req, "restore"\)/);
  assert.match(routes, /router\.post\("\/api\/projects\/:projectId\/restarbejde\/items\/:itemId\/attachments"/);
  assert.match(routes, /requireRestarbejdeAccess\(req, "manage_photos"\)/);
  assert.match(routes, /router\.get\("\/api\/projects\/:projectId\/restarbejde\/items\/:itemId\/attachments\/:attachmentId\/content"/);
  assert.match(routes, /X-Content-Type-Options/);
  assert.match(routes, /Cache-Control", "private, no-store"/);
  assert.doesNotMatch(routes, /public blob|sas|azure credential/i);
});

test('Restarbejde upload and coordinate validation keeps the percent/page contract', () => {
  const helpers = restarbejdeService._test;
  assert.equal(helpers.normalizePageNumber(undefined, { source_type: 'image', page_count: 1 }), 1);
  assert.equal(helpers.normalizePageNumber('2', { source_type: 'pdf', page_count: 3 }), 2);
  assertBadRequest(() => helpers.normalizePageNumber(2, { source_type: 'image', page_count: 1 }), 'invalid_restarbejde_page_number');
  assertBadRequest(() => helpers.normalizePageNumber(4, { source_type: 'pdf', page_count: 3 }), 'invalid_restarbejde_page_number');
  assert.equal(helpers.normalizePercentCoordinate('12.3456', 'x_percent'), 12.346);
  assert.equal(helpers.normalizePercentCoordinate(100, 'y_percent'), 100);
  assertBadRequest(() => helpers.normalizePercentCoordinate(-0.001, 'x_percent'), 'invalid_restarbejde_coordinate');
  assertBadRequest(() => helpers.normalizePercentCoordinate(100.001, 'y_percent'), 'invalid_restarbejde_coordinate');
});

test('Restarbejde file validation uses platform storage types and rejects mismatched photos', () => {
  const helpers = restarbejdeService._test;
  const png = helpers.validateDrawingFile({ filename: 'floor.png', contentType: 'image/png', buffer: Buffer.from('png') });
  assert.equal(png.sourceType, 'image');
  assert.equal(png.extension, '.png');
  assert.equal(png.contentType, 'image/png');
  const photo = helpers.validateAttachmentFile({ filename: 'photo.JPG', contentType: 'image/jpeg', buffer: Buffer.from('jpg') }, 'photo');
  assert.equal(photo.extension, '.jpg');
  assert.equal(photo.contentType, 'image/jpeg');
  const document = helpers.validateAttachmentFile({ filename: 'spec.pdf', contentType: 'application/pdf', buffer: Buffer.from('%PDF') }, 'document');
  assert.equal(document.extension, '.pdf');
  assertBadRequest(() => helpers.validateDrawingFile({ filename: 'floor.jpg', contentType: 'image/png', buffer: Buffer.from('x') }), 'invalid_restarbejde_drawing_extension');
  assertBadRequest(() => helpers.validateAttachmentFile({ filename: 'spec.pdf', contentType: 'application/pdf', buffer: Buffer.from('%PDF') }, 'photo'), 'invalid_restarbejde_attachment_mime');
  assertBadRequest(() => helpers.normalizeAttachmentType('video'), 'unsupported_restarbejde_attachment_type');
});

test('Restarbejde API maps expose protected content URLs without storage keys', () => {
  const drawing = restarbejdeService._test.mapDrawing({
    id: uuid(10), tenant_id: uuid(1), project_id: uuid(3), title: 'Plan', source_type: 'pdf', storage_object_id: uuid(20),
    original_filename: 'plan.pdf', mime_type: 'application/pdf', file_size_bytes: '42', page_count: '2', storage_key: 'secret/key', storage_provider: 'azure',
  });
  assert.equal(drawing.content_url, `/api/projects/${uuid(3)}/restarbejde/drawings/${uuid(10)}/content`);
  assert.equal(Object.prototype.hasOwnProperty.call(drawing, 'storage_key'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(drawing, 'storage_provider'), false);

  const attachment = restarbejdeService._test.mapAttachment({
    id: uuid(11), tenant_id: uuid(1), project_id: uuid(3), item_id: uuid(50), storage_object_id: uuid(21), attachment_type: 'photo',
    original_filename: 'photo.jpg', mime_type: 'image/jpeg', file_size_bytes: '12', storage_key: 'secret/photo', storage_provider: 'azure',
  });
  assert.equal(attachment.content_url, `/api/projects/${uuid(3)}/restarbejde/items/${uuid(50)}/attachments/${uuid(11)}/content`);
  assert.equal(Object.prototype.hasOwnProperty.call(attachment, 'storage_key'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(attachment, 'storage_provider'), false);
});

test('Restarbejde PR3 audit events are allowlisted', async () => {
  const inserted = [];
  const original = require('../backend/src/db/queries/audit').insertAuditEvent;
  require('../backend/src/db/queries/audit').insertAuditEvent = async (_client, event) => inserted.push(event);
  try {
    for (const eventType of [
      'restarbejde.drawing_created',
      'restarbejde.drawing_archived',
      'restarbejde.drawing_restored',
      'restarbejde.placement_created',
      'restarbejde.placement_updated',
      'restarbejde.placement_archived',
      'restarbejde.placement_restored',
      'restarbejde.attachment_created',
      'restarbejde.attachment_archived',
    ]) {
      await auditService.logAuditEvent({
        client: {}, tenantId: uuid(1), actorId: uuid(2), actorType: 'tenant_user', actorScope: 'tenant',
        moduleKey: 'project_restarbejde', eventType, resourceType: 'project_restarbejde_resource', resourceId: uuid(90), projectId: uuid(3),
        outcome: 'success', reason: eventType, metadata: { checked: true },
      });
    }
    assert.equal(inserted.length, 9);
  } finally {
    require('../backend/src/db/queries/audit').insertAuditEvent = original;
  }
});

test('Restarbejde repository PR3 queries remain tenant and project scoped', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: [] };
    },
  };
  await restarbejdeRepository.listDrawings(client, { tenantId: uuid(1), projectId: uuid(3) });
  await restarbejdeRepository.findDrawingById(client, { tenantId: uuid(1), projectId: uuid(3), drawingId: uuid(10) });
  await restarbejdeRepository.listPlacementsForDrawing(client, { tenantId: uuid(1), projectId: uuid(3), drawingId: uuid(10) });
  await restarbejdeRepository.findPlacementById(client, { tenantId: uuid(1), projectId: uuid(3), drawingId: uuid(10), placementId: uuid(12) });
  await restarbejdeRepository.listAttachmentsForItem(client, { tenantId: uuid(1), projectId: uuid(3), itemId: uuid(50) });
  await restarbejdeRepository.findAttachmentById(client, { tenantId: uuid(1), projectId: uuid(3), itemId: uuid(50), attachmentId: uuid(13) });

  for (const call of calls) {
    assert.match(call.sql, /tenant_id\s*=\s*\$1/);
    assert.match(call.sql, /project_id\s*=\s*\$2/);
    assert.equal(call.params[0], uuid(1));
    assert.equal(call.params[1], uuid(3));
  }
});