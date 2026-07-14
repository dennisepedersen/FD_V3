'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..');
const enginePath = path.join(repoRoot, 'backend/src/public/tenant/drawing-engine.js');
const adapterPath = path.join(repoRoot, 'backend/src/public/tenant/project-equipment-cctv-drawing-adapter.js');
const engine = require(enginePath);
const cctvAdapter = require(adapterPath);

test('drawing engine converts percent coordinates to pixels for key positions', () => {
  const rect = { width: 800, height: 600 };
  assert.deepEqual(engine.percentToPixel({ x_percent: 0, y_percent: 0 }, rect), { x: 0, y: 0 });
  assert.deepEqual(engine.percentToPixel({ x_percent: 50, y_percent: 50 }, rect), { x: 400, y: 300 });
  assert.deepEqual(engine.percentToPixel({ x_percent: 100, y_percent: 100 }, rect), { x: 800, y: 600 });
});

test('drawing engine converts pixels to canonical percent and clamps bounds', () => {
  const rect = { left: 10, top: 20, width: 1000, height: 500 };
  assert.deepEqual(engine.clientPointToPercent({ clientX: 510, clientY: 270 }, rect), { x_percent: 50, y_percent: 50 });
  assert.deepEqual(engine.pixelToPercent({ x: -50, y: 900 }, rect), { x_percent: 0, y_percent: 100 });
});

test('drawing engine roundtrip survives resize and aspect ratio changes', () => {
  const coordinate = { drawing_id: 'drawing-1', page_number: 1, x_percent: 37.5, y_percent: 62.5 };
  const first = { width: 640, height: 480 };
  const second = { width: 1920, height: 1080 };

  const firstPixel = engine.percentToPixel(coordinate, first);
  assert.deepEqual(engine.pixelToPercent(firstPixel, first), { x_percent: 37.5, y_percent: 62.5 });

  const secondPixel = engine.percentToPixel(coordinate, second);
  assert.deepEqual(engine.pixelToPercent(secondPixel, second), { x_percent: 37.5, y_percent: 62.5 });
});

test('drawing engine keeps canonical coordinates independent of zoom and pan', () => {
  const coordinate = { x_percent: 25, y_percent: 75 };
  const rect = { width: 1200, height: 800 };
  const before = engine.percentToPixel(coordinate, rect);
  const viewport = engine.createViewportState({ zoom: 200, pan: { x: 80, y: -40 } });

  assert.equal(engine.viewportTransformStyle(viewport), 'translate(80px, -40px) scale(2)');
  assert.deepEqual(engine.pixelToPercent(before, rect), coordinate);
});

test('drawing engine tracks PDF pages as 1-based coordinates', () => {
  assert.equal(engine.normalizePageNumber(0), 1);
  assert.equal(engine.normalizePageNumber(1), 1);
  assert.equal(engine.normalizePageNumber(7), 7);
  assert.equal(engine.normalizeCoordinate({ drawing_id: 'pdf', page_number: 3, x_percent: 10, y_percent: 20 }).page_number, 3);
});

test('drawing engine calculates neutral crop around a coordinate', () => {
  const crop = engine.getCropAroundCoordinate(
    { x_percent: 50, y_percent: 50 },
    { width: 1000, height: 800 },
    { width: 300, height: 200 }
  );
  assert.deepEqual(crop, {
    x: 350,
    y: 300,
    width: 300,
    height: 200,
    center_x: 500,
    center_y: 400,
    x_percent: 50,
    y_percent: 50,
  });

  const edgeCrop = engine.getCropAroundCoordinate(
    { x_percent: 99, y_percent: 1 },
    { width: 1000, height: 800 },
    { width: 300, height: 200 }
  );
  assert.equal(edgeCrop.x, 700);
  assert.equal(edgeCrop.y, 0);
});

test('CCTV adapter maps domain records to neutral drawings and overlays', () => {
  const drawing = cctvAdapter.drawingToEngineDrawing({
    id: 'drawing-id',
    title: 'Plan 1',
    source_type: 'pdf_page',
    pdf_page_number: 2,
    content_url: '/content',
  });
  assert.deepEqual(drawing, {
    id: 'drawing-id',
    drawing_id: 'drawing-id',
    title: 'Plan 1',
    type: 'pdf_page',
    source_url: '/content',
    page_number: 2,
    data: {
      id: 'drawing-id',
      title: 'Plan 1',
      source_type: 'pdf_page',
      pdf_page_number: 2,
      content_url: '/content',
    },
  });

  const overlay = cctvAdapter.pinToOverlay({
    id: 'pin-id',
    drawing_id: 'drawing-id',
    x_percent: 12.5,
    y_percent: 87.5,
    label: 'CAM-1',
    camera: { camera_id: 'CAM-1', status: 'checked' },
  });
  assert.equal(overlay.source, 'project_equipment_cctv_pin');
  assert.equal(overlay.label, 'CAM-1');
  assert.equal(overlay.x_percent, 12.5);
  assert.equal(overlay.y_percent, 87.5);
});

test('CCTV adapter maps pending placement back to existing pin save payload', () => {
  const pending = cctvAdapter.pendingPlacementToOverlay({
    drawingId: 'drawing-id',
    camera: { id: 'camera-record-id', camera_id: 'CAM-2' },
    point: { x_percent: 111, y_percent: -5 },
  });
  assert.deepEqual(cctvAdapter.pinSavePayload(pending), {
    camera_record_id: 'camera-record-id',
    x_percent: 100,
    y_percent: 0,
    label: 'CAM-2',
  });
});

test('shared drawing engine remains domain-neutral', () => {
  const source = fs.readFileSync(enginePath, 'utf8');
  assert.doesNotMatch(source, /camera|cctv|mac|serial|restarbejde|defect|obs|equipment/i);
});
