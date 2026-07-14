(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./drawing-engine"));
    return;
  }
  root.FielddeskCctvDrawingAdapter = factory(root.FielddeskDrawingEngine);
})(typeof window !== "undefined" ? window : globalThis, function (engine) {
  "use strict";

  if (!engine) {
    throw new Error("fielddesk_drawing_engine_required");
  }

  function toText(value, fallback = "") {
    const text = value == null ? "" : String(value).trim();
    return text || fallback;
  }

  function toNumber(value, fallback = 1) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function drawingToEngineDrawing(drawing = {}) {
    const sourceType = toText(drawing.source_type).toLowerCase();
    return {
      id: toText(drawing.id, null),
      drawing_id: toText(drawing.id, null),
      title: toText(drawing.title, "Tegning"),
      type: sourceType === "pdf_page" ? "pdf_page" : "image",
      source_url: drawing.content_url || null,
      page_number: engine.normalizePageNumber(drawing.pdf_page_number || drawing.page_number || 1),
      data: drawing,
    };
  }

  function isPdfDrawing(drawing = {}) {
    return drawingToEngineDrawing(drawing).type === "pdf_page";
  }

  function cameraLabel(camera = {}) {
    return toText(camera.camera_id || camera.label || camera.id, "Kamera");
  }

  function pinToOverlay(pin = {}) {
    const coordinate = engine.normalizeCoordinate({
      drawing_id: pin.drawing_id,
      page_number: pin.page_number || 1,
      x_percent: pin.x_percent,
      y_percent: pin.y_percent,
    });
    return engine.createOverlay({
      id: pin.id || pin.pin_id || null,
      drawing_id: coordinate.drawing_id,
      page_number: coordinate.page_number,
      x_percent: coordinate.x_percent,
      y_percent: coordinate.y_percent,
      label: pin.label || pin.camera?.camera_id || "Kamera",
      status: pin.camera?.status || null,
      source: "project_equipment_cctv_pin",
      data: pin,
    });
  }

  function pendingPlacementToOverlay({ drawingId, camera, point }) {
    const coordinate = engine.normalizeCoordinate({
      drawing_id: drawingId,
      page_number: 1,
      x_percent: point && point.x_percent,
      y_percent: point && point.y_percent,
    });
    return {
      id: "pending-placement",
      drawing_id: coordinate.drawing_id,
      camera_record_id: camera && camera.id ? camera.id : null,
      x_percent: coordinate.x_percent,
      y_percent: coordinate.y_percent,
      label: cameraLabel(camera),
      camera: camera || null,
    };
  }

  function pinSavePayload(placement = {}) {
    return {
      camera_record_id: placement.camera_record_id,
      x_percent: engine.clampPercent(placement.x_percent),
      y_percent: engine.clampPercent(placement.y_percent),
      label: toText(placement.label, "Kamera"),
    };
  }

  return Object.freeze({
    drawingToEngineDrawing,
    isPdfDrawing,
    pinToOverlay,
    pendingPlacementToOverlay,
    pinSavePayload,
    cameraLabel,
  });
});
