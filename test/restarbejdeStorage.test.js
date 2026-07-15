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
const pool = require('../backend/src/db/pool');
const projectQueries = require('../backend/src/db/queries/project');
const storageObjectQueries = require('../backend/src/db/queries/storageObject');
const fileStorageService = require('../backend/src/services/fileStorageService');
const restarbejdeRepository = require('../backend/src/modules/restarbejde/restarbejde.repository');
const restarbejdeRoutes = require('../backend/src/modules/restarbejde/restarbejde.routes');
const restarbejdeService = require('../backend/src/modules/restarbejde/restarbejde.service');

function uuid(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function assertBadRequest(fn, message) {
  assert.throws(fn, (error) => error.statusCode === 400 && error.message === message);
}

function project(projectId = uuid(3)) {
  return { project_id: projectId, tenant_id: uuid(1), external_project_ref: '80548', name: 'Test project' };
}

function installPool() {
  const originalConnect = pool.connect;
  const queries = [];
  pool.connect = async () => ({
    async query(sql, params = []) {
      queries.push({ sql: String(sql), params });
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(String(sql))) return { rows: [] };
      return { rows: [] };
    },
    release() {},
  });
  return {
    queries,
    restore() { pool.connect = originalConnect; },
  };
}

const jpegBuffer = () => Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00]);
const pngBuffer = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const webpBuffer = () => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x04, 0x00, 0x00, 0x00]), Buffer.from('WEBP')]);

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
  const png = helpers.validateDrawingFile({ filename: 'floor.png', contentType: 'image/png', buffer: pngBuffer() });
  assert.equal(png.sourceType, 'image');
  assert.equal(png.extension, '.png');
  assert.equal(png.contentType, 'image/png');
  const photo = helpers.validateAttachmentFile({ filename: 'photo.JPG', contentType: 'image/jpeg', buffer: jpegBuffer() }, 'photo');
  assert.equal(photo.extension, '.jpg');
  assert.equal(photo.contentType, 'image/jpeg');
  const document = helpers.validateAttachmentFile({ filename: 'spec.pdf', contentType: 'application/pdf', buffer: Buffer.from('%PDF') }, 'document');
  assert.equal(document.extension, '.pdf');
  assertBadRequest(() => helpers.validateDrawingFile({ filename: 'floor.jpg', contentType: 'image/png', buffer: pngBuffer() }), 'invalid_restarbejde_drawing_extension');
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
  assert.match(calls[3].sql, /drawing_id\s*=\s*\$3\s+AND id\s*=\s*\$4/);
  assert.match(calls[5].sql, /attachment\.item_id\s*=\s*\$3\s+AND attachment\.id\s*=\s*\$4/);
});
test('Restarbejde attachment content disposition blocks active tenant-origin execution', () => {
  const helpers = restarbejdeService._test;
  assert.equal(helpers.getContentDisposition('image/jpeg'), 'inline');
  assert.equal(helpers.getContentDisposition('application/pdf'), 'inline');
  assert.equal(helpers.getContentDisposition('application/octet-stream'), 'attachment');
  assert.equal(restarbejdeRoutes._test.getContentDispositionHeader({ contentDisposition: 'inline', attachment: { original_filename: 'photo.jpg' } }, 'fallback'), 'inline; filename="photo.jpg"');
  assert.equal(restarbejdeRoutes._test.getContentDispositionHeader({ contentDisposition: 'attachment', attachment: { original_filename: 'file.bin' } }, 'fallback'), 'attachment; filename="file.bin"');
  const injected = restarbejdeRoutes._test.getContentDispositionHeader({ contentDisposition: 'inline', attachment: { original_filename: 'bad"\r\nX-Evil: yes.html' } }, 'fallback');
  assert.doesNotMatch(injected, /\r|\n|:/);
  assert.match(injected, /^inline; filename="[a-zA-Z0-9._-]+"$/);
  assert.match(read('backend/src/modules/restarbejde/restarbejde.routes.js'), /X-Content-Type-Options/);
  assert.match(read('backend/src/modules/restarbejde/restarbejde.routes.js'), /Cache-Control", "private, no-store"/);
});

test('Restarbejde attachment validation rejects active web MIME types', () => {
  const helpers = restarbejdeService._test;
  assertBadRequest(() => helpers.validateAttachmentFile({ filename: 'x.html', contentType: 'text/html', buffer: Buffer.from('<html>') }, 'document'), 'unsafe_restarbejde_attachment_mime');
  assertBadRequest(() => helpers.validateAttachmentFile({ filename: 'x.svg', contentType: 'image/svg+xml', buffer: Buffer.from('<svg>') }, 'document'), 'unsafe_restarbejde_attachment_mime');
  assertBadRequest(() => helpers.validateAttachmentFile({ filename: 'x.xhtml', contentType: 'application/xhtml+xml', buffer: Buffer.from('<html>') }, 'other'), 'unsafe_restarbejde_attachment_mime');
  assertBadRequest(() => helpers.validateAttachmentFile({ filename: 'x.js', contentType: 'application/javascript', buffer: Buffer.from('alert(1)') }, 'document'), 'unsafe_restarbejde_attachment_mime');
  assertBadRequest(() => helpers.validateAttachmentFile({ filename: 'x.xml', contentType: 'application/xml', buffer: Buffer.from('<xml/>') }, 'document'), 'unsafe_restarbejde_attachment_mime');
});

test('Restarbejde image validation checks JPEG PNG and WebP magic bytes', () => {
  const helpers = restarbejdeService._test;
  assert.equal(helpers.validateDrawingFile({ filename: 'a.jpg', contentType: 'image/jpeg', buffer: jpegBuffer() }).contentType, 'image/jpeg');
  assert.equal(helpers.validateDrawingFile({ filename: 'a.png', contentType: 'image/png', buffer: pngBuffer() }).contentType, 'image/png');
  assert.equal(helpers.validateDrawingFile({ filename: 'a.webp', contentType: 'image/webp', buffer: webpBuffer() }).contentType, 'image/webp');
  assert.equal(helpers.validateAttachmentFile({ filename: 'a.jpg', contentType: 'image/jpeg', buffer: jpegBuffer() }, 'photo').contentType, 'image/jpeg');
  assertBadRequest(() => helpers.validateDrawingFile({ filename: 'a.jpg', contentType: 'image/jpeg', buffer: Buffer.from('not-jpeg') }), 'invalid_restarbejde_image_content');
  assertBadRequest(() => helpers.validateDrawingFile({ filename: 'a.png', contentType: 'image/png', buffer: Buffer.from('not-png') }), 'invalid_restarbejde_image_content');
  assertBadRequest(() => helpers.validateDrawingFile({ filename: 'a.webp', contentType: 'image/webp', buffer: Buffer.from('not-webp') }), 'invalid_restarbejde_image_content');
});

test('Restarbejde archive constraints require complete metadata and chronological archive time', () => {
  const migration = read('migrations/0039_project_restarbejde_drawings_placements_attachments.sql');
  const schema = read('schema.sql');
  for (const source of [migration, schema]) {
    for (const name of [
      'ck_project_restarbejde_drawing_archive_state',
      'ck_project_restarbejde_placement_archive_state',
      'ck_project_restarbejde_attachment_archive_state',
    ]) {
      const index = source.indexOf(`CONSTRAINT ${name} CHECK`);
      assert.notEqual(index, -1, `${name} missing`);
      const block = source.slice(index, index + 260);
      assert.match(block, /archived_at IS NULL AND archived_by_user_id IS NULL/);
      assert.match(block, /archived_at IS NOT NULL AND archived_by_user_id IS NOT NULL AND archived_at >= created_at/);
    }
  }
});

test('Restarbejde business parent FKs restrict hard delete while tenant teardown can cascade', () => {
  const migration = read('migrations/0039_project_restarbejde_drawings_placements_attachments.sql');
  assert.match(migration, /fk_project_restarbejde_placement_item[\s\S]+REFERENCES project_restarbejde_item\(id, tenant_id, project_id\) ON DELETE RESTRICT/);
  assert.match(migration, /fk_project_restarbejde_placement_drawing[\s\S]+REFERENCES project_restarbejde_drawing\(id, tenant_id, project_id\) ON DELETE RESTRICT/);
  assert.match(migration, /fk_project_restarbejde_attachment_item[\s\S]+REFERENCES project_restarbejde_item\(id, tenant_id, project_id\) ON DELETE RESTRICT/);
  assert.match(migration, /fk_project_restarbejde_drawing_tenant[\s\S]+REFERENCES tenant\(id\) ON DELETE CASCADE/);
});

test('Restarbejde PR3 does not introduce upload environment variables', () => {
  const forbidden = ['FD', 'DRAWING', 'PDF', 'MAX', 'UPLOAD', 'MB'].join('_');
  const files = [
    'backend/src/modules/restarbejde/restarbejde.service.js',
    'backend/src/modules/restarbejde/restarbejde.routes.js',
    'migrations/0039_project_restarbejde_drawings_placements_attachments.sql',
    'schema.sql',
  ];
  for (const file of files) {
    const source = read(file);
    assert.equal(source.includes(forbidden), false, `${file} must not reference ${forbidden}`);
    assert.doesNotMatch(source, /process\.env\.[A-Z0-9_]*(RESTARBEJDE|DRAWING|UPLOAD)[A-Z0-9_]*/);
  }
});

test('Restarbejde upload limits are internal constants and oversize files stop before storage', async () => {
  assert.equal(restarbejdeService._test.getPdfMaxUploadBytes(), 50 * 1024 * 1024);
  assert.equal(restarbejdeService._test.getDocumentMaxUploadBytes(), 25 * 1024 * 1024);
  const routes = read('backend/src/modules/restarbejde/restarbejde.routes.js');
  assert.match(routes, /file\.on\("limit"/);
  assert.ok(routes.indexOf('if (fileTooLarge) return reject(createHttpError(413, fileTooLargeKey));') < routes.indexOf('resolve({ filename'));

  const original = { connect: pool.connect, max: fileStorageService.getMaxUploadBytes };
  let poolTouched = false;
  pool.connect = async () => {
    poolTouched = true;
    throw new Error('pool_should_not_be_touched');
  };
  fileStorageService.getMaxUploadBytes = () => 3;
  try {
    await assert.rejects(
      restarbejdeService.uploadDrawing({ tenantId: uuid(1), userId: uuid(2), projectId: uuid(3), file: { filename: 'a.jpg', contentType: 'image/jpeg', buffer: jpegBuffer() }, title: 'A' }),
      (error) => error.statusCode === 413 && error.message === 'restarbejde_drawing_file_too_large'
    );
    assert.equal(poolTouched, false);
  } finally {
    pool.connect = original.connect;
    fileStorageService.getMaxUploadBytes = original.max;
  }
});

test('Restarbejde storage object resource identity matches generated drawing and attachment ids', async () => {
  const tenantId = uuid(1);
  const userId = uuid(2);
  const projectId = uuid(3);
  const itemId = uuid(50);
  const poolMock = installPool();
  const original = {
    findProject: projectQueries.findProjectForUser,
    putObject: fileStorageService.putObject,
    deleteObject: fileStorageService.deleteObject,
    insertStorageObject: storageObjectQueries.insertStorageObject,
    insertDrawing: restarbejdeRepository.insertDrawing,
    findItem: restarbejdeRepository.findItemById,
    insertAttachment: restarbejdeRepository.insertAttachment,
    audit: auditService.logAuditEvent,
  };
  const storageResourceIds = [];
  projectQueries.findProjectForUser = async () => project(projectId);
  fileStorageService.putObject = async ({ key, contentType }) => ({ provider: 'local', key, contentType, contentLength: 1 });
  fileStorageService.deleteObject = async () => {};
  storageObjectQueries.insertStorageObject = async (_client, input) => {
    storageResourceIds.push(input.resourceId);
    return { id: uuid(storageResourceIds.length === 1 ? 81 : 82), storage_provider: input.storageProvider, storage_key: input.storageKey, content_type: input.contentType, byte_size: input.byteSize, checksum_sha256: input.checksumSha256, metadata: input.metadata };
  };
  restarbejdeRepository.insertDrawing = async (_client, input) => {
    assert.equal(input.payload.id, storageResourceIds[0]);
    assert.match(input.payload.id, /^[0-9a-f-]{36}$/i);
    return { id: input.payload.id, tenant_id: tenantId, project_id: projectId, title: input.payload.title, source_type: input.payload.sourceType, storage_object_id: input.payload.storageObjectId, original_filename: input.payload.originalFilename, mime_type: input.payload.mimeType, file_size_bytes: input.payload.fileSizeBytes, page_count: input.payload.pageCount };
  };
  restarbejdeRepository.findItemById = async () => ({ id: itemId, tenant_id: tenantId, project_id: projectId, kind: 'internal_defect', title: 'A', status: 'open' });
  restarbejdeRepository.insertAttachment = async (_client, input) => {
    assert.equal(input.payload.id, storageResourceIds[1]);
    assert.match(input.payload.id, /^[0-9a-f-]{36}$/i);
    return { id: input.payload.id, tenant_id: tenantId, project_id: projectId, item_id: itemId, storage_object_id: input.payload.storageObjectId, attachment_type: input.payload.attachmentType, original_filename: input.payload.originalFilename, mime_type: input.payload.mimeType, file_size_bytes: input.payload.fileSizeBytes, caption: input.payload.caption };
  };
  auditService.logAuditEvent = async () => {};
  try {
    const drawing = await restarbejdeService.uploadDrawing({ tenantId, userId, projectId, file: { filename: 'plan.jpg', contentType: 'image/jpeg', buffer: jpegBuffer() }, title: 'Plan' });
    const attachment = await restarbejdeService.uploadAttachment({ tenantId, userId, projectId, itemId, file: { filename: 'photo.jpg', contentType: 'image/jpeg', buffer: jpegBuffer() }, attachmentType: 'photo' });
    assert.equal(drawing.drawing.id, storageResourceIds[0]);
    assert.equal(attachment.attachment.id, storageResourceIds[1]);
  } finally {
    projectQueries.findProjectForUser = original.findProject;
    fileStorageService.putObject = original.putObject;
    fileStorageService.deleteObject = original.deleteObject;
    storageObjectQueries.insertStorageObject = original.insertStorageObject;
    restarbejdeRepository.insertDrawing = original.insertDrawing;
    restarbejdeRepository.findItemById = original.findItem;
    restarbejdeRepository.insertAttachment = original.insertAttachment;
    auditService.logAuditEvent = original.audit;
    poolMock.restore();
  }
});

test('Restarbejde upload cleanup deletes the uploaded key when database insert fails', async () => {
  const tenantId = uuid(1);
  const userId = uuid(2);
  const projectId = uuid(3);
  const poolMock = installPool();
  const deleted = [];
  const original = {
    findProject: projectQueries.findProjectForUser,
    putObject: fileStorageService.putObject,
    deleteObject: fileStorageService.deleteObject,
    insertStorageObject: storageObjectQueries.insertStorageObject,
  };
  projectQueries.findProjectForUser = async () => project(projectId);
  fileStorageService.putObject = async ({ key }) => ({ provider: 'local', key });
  fileStorageService.deleteObject = async ({ key }) => deleted.push(key);
  storageObjectQueries.insertStorageObject = async () => { throw new Error('db_failed'); };
  try {
    await assert.rejects(
      restarbejdeService.uploadDrawing({ tenantId, userId, projectId, file: { filename: 'plan.jpg', contentType: 'image/jpeg', buffer: jpegBuffer() }, title: 'Plan' }),
      /db_failed/
    );
    assert.equal(deleted.length, 1);
    assert.match(deleted[0], /\/restarbejde\/drawings\/[0-9a-f-]{36}\//i);
  } finally {
    projectQueries.findProjectForUser = original.findProject;
    fileStorageService.putObject = original.putObject;
    fileStorageService.deleteObject = original.deleteObject;
    storageObjectQueries.insertStorageObject = original.insertStorageObject;
    poolMock.restore();
  }
});
