(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./drawing-engine"));
    return;
  }
  root.FielddeskRestarbejdeDrawingAdapter = factory(root.FielddeskDrawingEngine);
})(typeof window !== "undefined" ? window : globalThis, function (engine) {
  "use strict";

  if (!engine) {
    throw new Error("fielddesk_drawing_engine_required");
  }

  function toText(value, fallback = "") {
    const text = value == null ? "" : String(value).trim();
    return text || fallback;
  }

  function normalizePage(value) {
    return engine.normalizePageNumber(value || 1);
  }

  function drawingToEngineDrawing(drawing = {}, pageNumber) {
    const sourceType = toText(drawing.source_type).toLowerCase();
    const page = normalizePage(pageNumber || drawing.page_number || 1);
    return {
      id: toText(drawing.id, null),
      drawing_id: toText(drawing.id, null),
      title: toText(drawing.title, "Tegning"),
      type: sourceType === "pdf" ? "pdf_page" : "image",
      source_url: drawing.content_url || null,
      page_number: page,
      page_count: Number(drawing.page_count || 1),
      data: drawing,
    };
  }

  function isPdfDrawing(drawing = {}) {
    return drawingToEngineDrawing(drawing).type === "pdf_page";
  }

  function itemLabel(item = {}) {
    return toText(item.title || item.label || item.id, "Restarbejde");
  }

  function placementToOverlay(placement = {}) {
    const coordinate = engine.normalizeCoordinate({
      drawing_id: placement.drawing_id,
      page_number: placement.page_number || 1,
      x_percent: placement.x_percent,
      y_percent: placement.y_percent,
    });
    const label = placement.label || placement.item?.title || "Restarbejde";
    return engine.createOverlay({
      id: placement.id || null,
      drawing_id: coordinate.drawing_id,
      page_number: coordinate.page_number,
      x_percent: coordinate.x_percent,
      y_percent: coordinate.y_percent,
      label,
      status: placement.item?.status || null,
      source: "project_restarbejde_placement",
      aria_label: `Restarbejde ${label}`,
      title: label,
      data: placement,
    });
  }

  function pendingPlacementToOverlay({ drawingId, item, pageNumber, point }) {
    const coordinate = engine.normalizeCoordinate({
      drawing_id: drawingId,
      page_number: pageNumber || 1,
      x_percent: point && point.x_percent,
      y_percent: point && point.y_percent,
    });
    const label = itemLabel(item);
    return {
      id: "restarbejde-pending-placement",
      drawing_id: coordinate.drawing_id,
      page_number: coordinate.page_number,
      item_id: item && item.id ? item.id : null,
      x_percent: coordinate.x_percent,
      y_percent: coordinate.y_percent,
      label,
      aria_label: `Ny placering for ${label}`,
      title: "Ny placering - gem for at bekraefte",
      item: item || null,
    };
  }

  function placementSavePayload(placement = {}) {
    return {
      item_id: placement.item_id,
      page_number: normalizePage(placement.page_number),
      x_percent: engine.clampPercent(placement.x_percent),
      y_percent: engine.clampPercent(placement.y_percent),
      label: toText(placement.label, "Restarbejde"),
    };
  }

  return Object.freeze({
    drawingToEngineDrawing,
    isPdfDrawing,
    placementToOverlay,
    pendingPlacementToOverlay,
    placementSavePayload,
    itemLabel,
  });
});