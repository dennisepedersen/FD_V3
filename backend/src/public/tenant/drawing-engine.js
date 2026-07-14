(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.FielddeskDrawingEngine = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const DEFAULT_ZOOM = 100;
  const MIN_ZOOM = 50;
  const MAX_ZOOM = 300;

  function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, toNumber(value, min)));
  }

  function clampPercent(value) {
    return clamp(value, 0, 100);
  }

  function normalizePageNumber(value) {
    const parsed = Math.trunc(toNumber(value, 1));
    return Math.max(1, parsed || 1);
  }

  function normalizeCoordinate(record = {}) {
    return {
      drawing_id: record.drawing_id == null ? null : String(record.drawing_id),
      page_number: normalizePageNumber(record.page_number),
      x_percent: clampPercent(record.x_percent),
      y_percent: clampPercent(record.y_percent),
    };
  }

  function percentToPixel({ x_percent, y_percent }, surfaceRect) {
    const width = Math.max(0, toNumber(surfaceRect && surfaceRect.width));
    const height = Math.max(0, toNumber(surfaceRect && surfaceRect.height));
    return {
      x: (clampPercent(x_percent) / 100) * width,
      y: (clampPercent(y_percent) / 100) * height,
    };
  }

  function pixelToPercent({ x, y }, surfaceRect) {
    const width = Math.max(1, toNumber(surfaceRect && surfaceRect.width, 1));
    const height = Math.max(1, toNumber(surfaceRect && surfaceRect.height, 1));
    return {
      x_percent: clampPercent((toNumber(x) / width) * 100),
      y_percent: clampPercent((toNumber(y) / height) * 100),
    };
  }

  function clientPointToPercent(point, surfaceRect) {
    const left = toNumber(surfaceRect && surfaceRect.left);
    const top = toNumber(surfaceRect && surfaceRect.top);
    return pixelToPercent({
      x: toNumber(point && point.clientX) - left,
      y: toNumber(point && point.clientY) - top,
    }, surfaceRect);
  }

  function pointerEventToPercent(surface, event) {
    if (!surface || typeof surface.getBoundingClientRect !== "function") {
      return null;
    }
    return clientPointToPercent(event, surface.getBoundingClientRect());
  }

  function clampZoom(value, options = {}) {
    const min = toNumber(options.min, MIN_ZOOM);
    const max = toNumber(options.max, MAX_ZOOM);
    const fallback = toNumber(options.defaultZoom, DEFAULT_ZOOM);
    return clamp(value || fallback, min, max);
  }

  function normalizePan(value = {}) {
    return {
      x: toNumber(value.x),
      y: toNumber(value.y),
    };
  }

  function createViewportState(input = {}) {
    const defaultZoom = toNumber(input.defaultZoom, DEFAULT_ZOOM);
    const zoom = clampZoom(input.zoom == null ? defaultZoom : input.zoom, {
      min: input.minZoom,
      max: input.maxZoom,
      defaultZoom,
    });
    return {
      zoom,
      pan: zoom <= defaultZoom ? { x: 0, y: 0 } : normalizePan(input.pan),
    };
  }

  function viewportTransformStyle(viewport = {}) {
    const pan = normalizePan(viewport.pan);
    const zoom = toNumber(viewport.zoom, DEFAULT_ZOOM) / 100;
    return `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  }

  function isZoomed(viewport = {}, defaultZoom = DEFAULT_ZOOM) {
    return toNumber(viewport.zoom, DEFAULT_ZOOM) > toNumber(defaultZoom, DEFAULT_ZOOM);
  }

  function nextPanFromDrag({ startPan, startClientX, startClientY, clientX, clientY }) {
    const pan = normalizePan(startPan);
    return {
      x: pan.x + (toNumber(clientX) - toNumber(startClientX)),
      y: pan.y + (toNumber(clientY) - toNumber(startClientY)),
    };
  }

  function getDistanceBetweenPoints(first = {}, second = {}) {
    return Math.hypot(toNumber(first.clientX) - toNumber(second.clientX), toNumber(first.clientY) - toNumber(second.clientY));
  }

  function createOverlay(record = {}) {
    const coordinate = normalizeCoordinate(record);
    return {
      id: record.id == null ? null : String(record.id),
      drawing_id: coordinate.drawing_id,
      page_number: coordinate.page_number,
      x_percent: coordinate.x_percent,
      y_percent: coordinate.y_percent,
      label: record.label == null ? "" : String(record.label),
      status: record.status == null ? null : String(record.status),
      source: record.source || null,
      data: record.data || null,
    };
  }

  function getCropAroundCoordinate(coordinate, surfaceRect, options = {}) {
    const pixel = percentToPixel(coordinate, surfaceRect);
    const surfaceWidth = Math.max(1, toNumber(surfaceRect && surfaceRect.width, 1));
    const surfaceHeight = Math.max(1, toNumber(surfaceRect && surfaceRect.height, 1));
    const cropWidth = Math.min(surfaceWidth, Math.max(1, toNumber(options.width, Math.min(surfaceWidth, 320))));
    const cropHeight = Math.min(surfaceHeight, Math.max(1, toNumber(options.height, Math.min(surfaceHeight, 240))));
    const left = clamp(pixel.x - cropWidth / 2, 0, Math.max(0, surfaceWidth - cropWidth));
    const top = clamp(pixel.y - cropHeight / 2, 0, Math.max(0, surfaceHeight - cropHeight));
    return {
      x: left,
      y: top,
      width: cropWidth,
      height: cropHeight,
      center_x: pixel.x,
      center_y: pixel.y,
      x_percent: clampPercent(coordinate && coordinate.x_percent),
      y_percent: clampPercent(coordinate && coordinate.y_percent),
    };
  }

  return Object.freeze({
    DEFAULT_ZOOM,
    MIN_ZOOM,
    MAX_ZOOM,
    clamp,
    clampPercent,
    normalizePageNumber,
    normalizeCoordinate,
    percentToPixel,
    pixelToPercent,
    clientPointToPercent,
    pointerEventToPercent,
    clampZoom,
    normalizePan,
    createViewportState,
    viewportTransformStyle,
    isZoomed,
    nextPanFromDrag,
    getDistanceBetweenPoints,
    createOverlay,
    getCropAroundCoordinate,
  });
});
