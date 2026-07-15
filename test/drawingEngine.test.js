'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..');
const enginePath = path.join(repoRoot, 'backend/src/public/tenant/drawing-engine.js');
const adapterPath = path.join(repoRoot, 'backend/src/public/tenant/project-equipment-cctv-drawing-adapter.js');
const authPath = path.join(repoRoot, 'backend/src/public/tenant/auth.js');
const engine = require(enginePath);
const cctvAdapter = require(adapterPath);

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.items = new Set();
  }

  add(...names) {
    names.filter(Boolean).forEach((name) => this.items.add(name));
    this.sync();
  }

  remove(...names) {
    names.forEach((name) => this.items.delete(name));
    this.sync();
  }

  toggle(name, force) {
    const shouldAdd = force === undefined ? !this.items.has(name) : Boolean(force);
    if (shouldAdd) this.items.add(name);
    else this.items.delete(name);
    this.sync();
    return shouldAdd;
  }

  contains(name) {
    return this.items.has(name);
  }

  sync() {
    this.element.className = Array.from(this.items).join(' ');
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = new FakeClassList(this);
    this.className = '';
    this.textContent = '';
    this.disabled = false;
    this.type = '';
    this.title = '';
    this.draggable = true;
    this.src = '';
    this.alt = '';
    this.width = 0;
    this.height = 0;
    this.rect = { left: 10, top: 20, width: 100, height: 200 };
  }

  set innerHTML(value) {
    this.children = [];
    this.textContent = value || '';
  }

  get innerHTML() {
    return this.textContent;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  dispatch(type, event = {}) {
    const handlers = this.listeners.get(type) || [];
    handlers.forEach((handler) => handler({
      preventDefault() {},
      stopPropagation() {},
      target: this,
      currentTarget: this,
      pointerId: 1,
      clientX: 60,
      clientY: 120,
      ...event,
    }));
  }

  contains(candidate) {
    if (candidate === this) return true;
    return this.children.some((child) => child.contains && child.contains(candidate));
  }

  closest(selector) {
    if (selector.startsWith('.') && this.className.split(/\s+/).includes(selector.slice(1))) return this;
    return this.parentNode && this.parentNode.closest ? this.parentNode.closest(selector) : null;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  getContext() {
    return { canvas: this };
  }

  setPointerCapture() {}
  releasePointerCapture() {}
}

function createFakeDocument() {
  return {
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    body: new FakeElement('body'),
  };
}

function createViewer(overrides = {}) {
  const document = createFakeDocument();
  const container = new FakeElement('div');
  const events = [];
  const viewer = engine.createDrawingViewerController({
    container,
    document,
    overlayClassName: 'pinOverlay',
    selectedOverlayClassName: 'isSelected',
    pendingOverlayClassName: 'isPending',
    renderOverlayContent: ({ element, overlay }) => {
      const label = document.createElement('span');
      label.textContent = overlay.label;
      element.appendChild(label);
    },
    onViewportChange: (event) => events.push(['viewport', event.viewport.zoom]),
    onOverlaySelect: (overlay) => events.push(['select', overlay.id]),
    onPlacement: ({ point }) => events.push(['placement', point]),
    onRenderComplete: (event) => events.push(['render', event.drawing && event.drawing.type, event.surface && event.surface.tagName]),
    onRenderError: (error) => events.push(['error', error.message]),
    ...overrides,
  });
  return { document, container, events, viewer };
}

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

test('viewer controller initializes, resets viewport, and destroys cleanly', async () => {
  const { container, viewer } = createViewer();
  await viewer.render({ drawing: { id: 'd1', type: 'image', title: 'Plan' }, sourceUrl: 'blob:image' });
  assert.equal(container.children.length, 1);
  viewer.setViewport({ zoom: 225, pan: { x: 8, y: 9 } });
  assert.equal(viewer.getViewport().zoom, 225);
  viewer.resetViewport();
  assert.deepEqual(viewer.getViewport(), { zoom: 100, pan: { x: 0, y: 0 } });
  viewer.destroy();
  assert.equal(container.children.length, 0);
});

test('viewer controller renders and updates overlays with selected state', async () => {
  const { container, events, viewer } = createViewer();
  await viewer.render({
    drawing: { id: 'd1', type: 'image', title: 'Plan' },
    sourceUrl: 'blob:image',
    overlays: [{ id: 'pin-1', x_percent: 25, y_percent: 75, label: 'A1', data: { id: 'pin-1' } }],
    selectedOverlayId: 'pin-1',
  });
  const layer = container.children[0].children[1];
  const pin = layer.children[0];
  assert.match(pin.className, /isSelected/);
  assert.equal(pin.style.left, '25%');
  assert.equal(pin.style.top, '75%');
  pin.dispatch('click');
  assert.deepEqual(events.find((event) => event[0] === 'select'), ['select', 'pin-1']);

  viewer.setOverlays([{ id: 'pin-2', x_percent: 10, y_percent: 20, label: 'A2' }], { pendingOverlay: { id: 'pending', x_percent: 50, y_percent: 60, label: 'new' } });
  assert.equal(layer.children.length, 2);
});

test('viewer controller calculates placement from surface coordinates', async () => {
  const { container, events, viewer } = createViewer();
  await viewer.render({
    drawing: { id: 'd1', type: 'image', title: 'Plan' },
    sourceUrl: 'blob:image',
    mode: { placementEnabled: true },
  });
  const stage = container.children[0];
  stage.dispatch('click', { clientX: 60, clientY: 120, target: stage });
  assert.deepEqual(events.find((event) => event[0] === 'placement'), ['placement', { x_percent: 50, y_percent: 50 }]);
});

test('viewer controller handles zoom, pan, wheel, and resize callbacks', async () => {
  const { container, events, viewer } = createViewer();
  await viewer.render({ drawing: { id: 'd1', type: 'image' }, sourceUrl: 'blob:image' });
  const stage = container.children[0];
  viewer.setZoom(200);
  assert.equal(stage.style.transform, 'translate(0px, 0px) scale(2)');
  viewer.handleWheel({ ctrlKey: true, deltaY: -1, target: stage, preventDefault() {} });
  assert.equal(viewer.getViewport().zoom, 225);
  viewer.handleWheel({ shiftKey: true, deltaX: 0, deltaY: 20, target: stage, preventDefault() {} });
  assert.equal(viewer.getViewport().pan.x, -20);
  viewer.resize();
  assert.ok(events.some((event) => event[0] === 'viewport'));
});

test('viewer controller renders PDF pages with a neutral PDF.js loader', async () => {
  let destroyed = false;
  const { container, events, viewer } = createViewer({
    loadPdfJs: async () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          getPage: async (pageNumber) => ({
            pageNumber,
            getViewport: ({ scale }) => ({ width: 100 * scale, height: 50 * scale }),
            render: () => ({ promise: Promise.resolve() }),
          }),
          destroy: async () => { destroyed = true; },
        }),
      }),
    }),
  });
  await viewer.render({ drawing: { id: 'pdf', type: 'pdf_page', title: 'PDF', page_number: 2 }, sourceUrl: 'blob:pdf' });
  const canvas = container.children[0].children[0];
  assert.equal(canvas.tagName, 'CANVAS');
  assert.equal(canvas.width, 160);
  assert.equal(canvas.height, 80);
  assert.equal(destroyed, true);
  assert.ok(events.some((event) => event[0] === 'render' && event[1] === 'pdf_page'));
});

test('viewer controller reports PDF render errors through callback contract', async () => {
  const { events, viewer } = createViewer({ loadPdfJs: async () => ({ getDocument: () => ({ promise: Promise.reject(new Error('pdf_failed')) }) }) });
  await viewer.render({ drawing: { id: 'pdf', type: 'pdf_page', title: 'PDF' }, sourceUrl: 'blob:pdf' });
  assert.deepEqual(events.find((event) => event[0] === 'error'), ['error', 'pdf_failed']);
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
  assert.equal(overlay.aria_label, 'Kamera CAM-1');
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

test('project page has controlled drawing asset failure codes', () => {
  const source = fs.readFileSync(authPath, 'utf8');
  assert.match(source, /fielddesk_drawing_engine_unavailable/);
  assert.match(source, /fielddesk_cctv_drawing_adapter_unavailable/);
  assert.doesNotMatch(source, /const drawingEngine = window\.FielddeskDrawingEngine/);
  assert.doesNotMatch(source, /const cctvDrawingAdapter = window\.FielddeskCctvDrawingAdapter/);
});

test('shared drawing engine remains domain-neutral', () => {
  const source = fs.readFileSync(enginePath, 'utf8');
  assert.doesNotMatch(source, /camera|cctv|mac|serial|restarbejde|defect|obs|equipment/i);
});
