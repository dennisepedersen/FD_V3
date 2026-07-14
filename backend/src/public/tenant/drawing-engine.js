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
  const DEFAULT_ZOOM_STEP = 25;
  const DEFAULT_PAN_THRESHOLD = 4;

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
      aria_label: record.aria_label == null ? null : String(record.aria_label),
      title: record.title == null ? null : String(record.title),
      class_name: record.class_name == null ? null : String(record.class_name),
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

  function noop() {}

  function asFunction(value, fallback = noop) {
    return typeof value === "function" ? value : fallback;
  }

  function createClassList(element) {
    return element && element.classList ? element.classList : { add: noop, remove: noop, toggle: noop };
  }

  function clearElement(element) {
    if (element) element.innerHTML = "";
  }

  function normalizeDrawing(record = {}) {
    return {
      id: record.id == null ? null : String(record.id),
      drawing_id: record.drawing_id == null ? (record.id == null ? null : String(record.id)) : String(record.drawing_id),
      title: record.title == null ? "" : String(record.title),
      type: record.type === "pdf_page" ? "pdf_page" : "image",
      source_url: record.source_url || record.url || null,
      page_number: normalizePageNumber(record.page_number),
      data: record.data || record,
    };
  }

  function createDrawingViewerController(options = {}) {
    const doc = options.document || (typeof document !== "undefined" ? document : null);
    const container = options.container;
    if (!doc) throw new Error("fielddesk_drawing_document_required");
    if (!container) throw new Error("fielddesk_drawing_viewer_container_required");

    const settings = {
      defaultZoom: toNumber(options.defaultZoom, DEFAULT_ZOOM),
      minZoom: toNumber(options.minZoom, MIN_ZOOM),
      maxZoom: toNumber(options.maxZoom, MAX_ZOOM),
      zoomStep: toNumber(options.zoomStep, DEFAULT_ZOOM_STEP),
      panThreshold: toNumber(options.panThreshold, DEFAULT_PAN_THRESHOLD),
      pdfScale: toNumber(options.pdfScale, 1.6),
      stageClassName: options.stageClassName || "fdDrawingStage",
      surfaceClassName: options.surfaceClassName || "fdDrawingSurface",
      overlayClassName: options.overlayClassName || "fdDrawingOverlay",
      selectedOverlayClassName: options.selectedOverlayClassName || "isSelected",
      pendingOverlayClassName: options.pendingOverlayClassName || "isPending",
      pannableClassName: options.pannableClassName || "isPannable",
      panningClassName: options.panningClassName || "isPanning",
      placingClassName: options.placingClassName || "isPlacing",
      overlayContainerClassName: options.overlayContainerClassName || "fdDrawingOverlays",
    };

    const callbacks = {
      onOverlaySelect: asFunction(options.onOverlaySelect),
      onPlacement: asFunction(options.onPlacement),
      onMove: asFunction(options.onMove),
      onDeleteRequest: asFunction(options.onDeleteRequest),
      onViewportChange: asFunction(options.onViewportChange),
      onRenderStart: asFunction(options.onRenderStart),
      onRenderComplete: asFunction(options.onRenderComplete),
      onRenderError: asFunction(options.onRenderError),
      onWorkspaceChange: asFunction(options.onWorkspaceChange),
      renderOverlayContent: asFunction(options.renderOverlayContent),
      loadPdfJs: asFunction(options.loadPdfJs, null),
      cleanupSource: asFunction(options.cleanupSource),
    };

    let currentDrawing = null;
    let currentSourceUrl = null;
    let overlays = [];
    let pendingOverlay = null;
    let selectedOverlayId = null;
    let stage = null;
    let surface = null;
    let overlayLayer = null;
    let renderToken = 0;
    let destroyed = false;
    let workspaceOpen = false;
    let placementEnabled = false;
    let readOnly = false;
    let isPanning = false;
    let suppressPlacementClick = false;
    let panDrag = null;
    let pointerMap = new Map();
    let pinchGesture = null;
    let viewport = createViewportState({ zoom: settings.defaultZoom, defaultZoom: settings.defaultZoom, minZoom: settings.minZoom, maxZoom: settings.maxZoom });

    function getViewport() {
      return { zoom: viewport.zoom, pan: { ...viewport.pan } };
    }

    function emitViewportChange() {
      callbacks.onViewportChange({ viewport: getViewport(), isPanning, stage });
    }

    function applyViewport() {
      if (stage) {
        stage.style.transform = viewportTransformStyle(viewport);
        createClassList(stage).toggle(settings.pannableClassName, isZoomed(viewport, settings.defaultZoom));
        createClassList(stage).toggle(settings.panningClassName, Boolean(isPanning));
      }
      emitViewportChange();
    }

    function setViewport(nextViewport) {
      viewport = createViewportState({ ...nextViewport, minZoom: settings.minZoom, maxZoom: settings.maxZoom, defaultZoom: settings.defaultZoom });
      applyViewport();
    }

    function resetInteractionState() {
      panDrag = null;
      pointerMap = new Map();
      pinchGesture = null;
      isPanning = false;
      suppressPlacementClick = false;
      applyViewport();
    }

    function resetViewport() {
      viewport = createViewportState({ zoom: settings.defaultZoom, pan: { x: 0, y: 0 }, minZoom: settings.minZoom, maxZoom: settings.maxZoom, defaultZoom: settings.defaultZoom });
      resetInteractionState();
    }

    function setZoom(nextZoom) {
      setViewport({ zoom: nextZoom, pan: viewport.pan });
    }

    function zoomBy(delta) {
      setZoom(viewport.zoom + toNumber(delta));
    }

    function updatePlacementClass() {
      createClassList(container).toggle(settings.placingClassName, Boolean(placementEnabled));
    }

    function setMode(nextMode = {}) {
      placementEnabled = Boolean(nextMode.placementEnabled);
      readOnly = Boolean(nextMode.readOnly);
      updatePlacementClass();
    }

    function setWorkspaceOpen(isOpen, nextOptions = {}) {
      workspaceOpen = Boolean(isOpen);
      if (nextOptions.shell) {
        createClassList(nextOptions.shell).toggle(nextOptions.openClassName || "open", workspaceOpen);
        if (typeof nextOptions.shell.setAttribute === "function") {
          nextOptions.shell.setAttribute("aria-hidden", workspaceOpen ? "false" : "true");
        }
      }
      if (nextOptions.body && nextOptions.bodyClassName) {
        createClassList(nextOptions.body).toggle(nextOptions.bodyClassName, workspaceOpen);
      }
      if (workspaceOpen && nextOptions.resetViewport !== false) resetViewport();
      else resetInteractionState();
      callbacks.onWorkspaceChange({ open: workspaceOpen });
    }

    async function requestFullscreen(target = container) {
      if (target && typeof target.requestFullscreen === "function") await target.requestFullscreen();
    }

    async function exitFullscreen() {
      const ownerDoc = container.ownerDocument || doc;
      if (ownerDoc && typeof ownerDoc.exitFullscreen === "function" && ownerDoc.fullscreenElement) await ownerDoc.exitFullscreen();
    }

    function createStage() {
      stage = doc.createElement("div");
      stage.className = settings.stageClassName;
      if (stage.style) stage.style.transformOrigin = "0 0";
      stage.addEventListener("pointerdown", handlePointerDown);
      stage.addEventListener("pointermove", handlePointerMove);
      stage.addEventListener("pointerup", handlePointerUp);
      stage.addEventListener("pointercancel", handlePointerUp);
      stage.addEventListener("click", handlePlacementClick);
      return stage;
    }

    function setSurfaceElement(element) {
      surface = element;
      if (!surface.dataset) surface.dataset = {};
      surface.dataset.drawingSurface = "true";
      surface.className = [surface.className, settings.surfaceClassName].filter(Boolean).join(" ").trim();
      return surface;
    }

    function renderOverlay(overlay, optionsForOverlay = {}) {
      const normalized = createOverlay(overlay);
      const button = doc.createElement("button");
      button.type = "button";
      const isSelected = selectedOverlayId != null && normalized.id === String(selectedOverlayId);
      const isPending = Boolean(optionsForOverlay.pending);
      button.className = [settings.overlayClassName, normalized.class_name, isSelected ? settings.selectedOverlayClassName : "", isPending ? settings.pendingOverlayClassName : ""].filter(Boolean).join(" ");
      button.style.left = `${normalized.x_percent}%`;
      button.style.top = `${normalized.y_percent}%`;
      button.setAttribute("aria-label", normalized.aria_label || normalized.label || "Placement");
      button.title = normalized.title || normalized.label || "";
      if (isPending || readOnly) button.disabled = Boolean(isPending);
      if (!isPending && !readOnly) {
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          selectedOverlayId = normalized.id;
          callbacks.onOverlaySelect(normalized, event);
          updateOverlays();
        });
      }
      callbacks.renderOverlayContent({ element: button, overlay: normalized, selected: isSelected, pending: isPending });
      return button;
    }

    function updateOverlays() {
      if (!overlayLayer) return;
      clearElement(overlayLayer);
      overlays.forEach((overlay) => overlayLayer.appendChild(renderOverlay(overlay)));
      if (pendingOverlay) overlayLayer.appendChild(renderOverlay(pendingOverlay, { pending: true }));
    }

    function ensureOverlayLayer() {
      if (!stage) return null;
      overlayLayer = doc.createElement("div");
      overlayLayer.className = settings.overlayContainerClassName;
      stage.appendChild(overlayLayer);
      return overlayLayer;
    }

    function setOverlays(nextOverlays = [], optionsForOverlays = {}) {
      overlays = Array.isArray(nextOverlays) ? nextOverlays.map(createOverlay) : [];
      pendingOverlay = optionsForOverlays.pendingOverlay ? createOverlay(optionsForOverlays.pendingOverlay) : null;
      selectedOverlayId = optionsForOverlays.selectedOverlayId == null ? null : String(optionsForOverlays.selectedOverlayId);
      updateOverlays();
    }

    async function renderPdfSurface(drawing, sourceUrl, token) {
      if (!callbacks.loadPdfJs) throw new Error("fielddesk_drawing_pdf_loader_missing");
      const pdfjs = await callbacks.loadPdfJs();
      const task = pdfjs.getDocument({ url: sourceUrl, isEvalSupported: false });
      const pdf = await task.promise;
      try {
        if (destroyed || renderToken !== token) return null;
        const page = await pdf.getPage(normalizePageNumber(drawing.page_number));
        const pdfViewport = page.getViewport({ scale: settings.pdfScale });
        const canvas = setSurfaceElement(doc.createElement("canvas"));
        canvas.width = Math.floor(pdfViewport.width);
        canvas.height = Math.floor(pdfViewport.height);
        canvas.setAttribute("aria-label", drawing.title || "PDF page");
        const context = canvas.getContext ? canvas.getContext("2d") : null;
        await page.render({ canvasContext: context, viewport: pdfViewport }).promise;
        return canvas;
      } finally {
        if (pdf && typeof pdf.destroy === "function") await pdf.destroy();
      }
    }

    function renderImageSurface(drawing, sourceUrl) {
      const image = setSurfaceElement(doc.createElement("img"));
      image.src = sourceUrl;
      image.alt = drawing.title || "Drawing";
      image.draggable = false;
      if (typeof image.addEventListener === "function") {
        image.addEventListener("load", () => callbacks.onRenderComplete({ drawing: currentDrawing, surface: image, stage, type: "image_load" }), { once: true });
        image.addEventListener("error", () => callbacks.onRenderError(new Error("fielddesk_drawing_image_render_failed"), { drawing: currentDrawing }), { once: true });
      }
      return image;
    }

    async function render(nextOptions = {}) {
      if (destroyed) return;
      const token = renderToken + 1;
      renderToken = token;
      if (nextOptions.drawing !== undefined) currentDrawing = nextOptions.drawing ? normalizeDrawing(nextOptions.drawing) : null;
      if (nextOptions.sourceUrl !== undefined) currentSourceUrl = nextOptions.sourceUrl;
      if (nextOptions.overlays !== undefined || nextOptions.pendingOverlay !== undefined || nextOptions.selectedOverlayId !== undefined) {
        overlays = Array.isArray(nextOptions.overlays) ? nextOptions.overlays.map(createOverlay) : overlays;
        pendingOverlay = nextOptions.pendingOverlay ? createOverlay(nextOptions.pendingOverlay) : null;
        selectedOverlayId = nextOptions.selectedOverlayId == null ? null : String(nextOptions.selectedOverlayId);
      }
      if (nextOptions.mode) setMode(nextOptions.mode);
      clearElement(container);
      surface = null;
      overlayLayer = null;
      stage = null;
      if (!currentDrawing) {
        container.textContent = nextOptions.emptyText || "";
        callbacks.onRenderComplete({ drawing: null, surface: null, stage: null, empty: true });
        applyViewport();
        return;
      }
      if (!currentSourceUrl) {
        container.textContent = nextOptions.loadingText || "";
        callbacks.onRenderComplete({ drawing: currentDrawing, surface: null, stage: null, loading: true });
        applyViewport();
        return;
      }
      callbacks.onRenderStart({ drawing: currentDrawing });
      const nextStage = createStage();
      container.appendChild(nextStage);
      applyViewport();
      try {
        const surfaceElement = currentDrawing.type === "pdf_page" ? await renderPdfSurface(currentDrawing, currentSourceUrl, token) : renderImageSurface(currentDrawing, currentSourceUrl);
        if (destroyed || renderToken !== token || !surfaceElement) return;
        nextStage.appendChild(surfaceElement);
        ensureOverlayLayer();
        updateOverlays();
        applyViewport();
        callbacks.onRenderComplete({ drawing: currentDrawing, surface: surfaceElement, stage: nextStage });
      } catch (error) {
        if (renderToken === token) callbacks.onRenderError(error, { drawing: currentDrawing });
      }
    }

    function handlePointerDown(event) {
      if (event.target && event.target.closest && event.target.closest(`.${settings.overlayClassName}`)) return;
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_error) {}
      pointerMap.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
      if (pointerMap.size >= 2) {
        const points = Array.from(pointerMap.values()).slice(0, 2);
        const distance = getDistanceBetweenPoints(points[0], points[1]);
        pinchGesture = { startDistance: distance || 1, startZoom: viewport.zoom };
        panDrag = null;
        isPanning = false;
        suppressPlacementClick = true;
        applyViewport();
        return;
      }
      if (!isZoomed(viewport, settings.defaultZoom)) return;
      panDrag = { pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, startPan: { ...viewport.pan }, didDrag: false };
    }

    function handlePointerMove(event) {
      if (pointerMap.has(event.pointerId)) pointerMap.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
      if (pinchGesture && pointerMap.size >= 2) {
        event.preventDefault();
        const points = Array.from(pointerMap.values()).slice(0, 2);
        const distance = getDistanceBetweenPoints(points[0], points[1]);
        const ratio = distance / Math.max(1, pinchGesture.startDistance);
        setZoom(pinchGesture.startZoom * ratio);
        suppressPlacementClick = true;
        return;
      }
      const drag = panDrag;
      if (!drag || drag.pointerId !== event.pointerId || !isZoomed(viewport, settings.defaultZoom)) return;
      const deltaX = event.clientX - drag.startClientX;
      const deltaY = event.clientY - drag.startClientY;
      if (Math.hypot(deltaX, deltaY) >= settings.panThreshold) {
        drag.didDrag = true;
        isPanning = true;
        viewport = createViewportState({
          zoom: viewport.zoom,
          pan: nextPanFromDrag({ startPan: drag.startPan, startClientX: drag.startClientX, startClientY: drag.startClientY, clientX: event.clientX, clientY: event.clientY }),
          minZoom: settings.minZoom,
          maxZoom: settings.maxZoom,
          defaultZoom: settings.defaultZoom,
        });
        applyViewport();
        callbacks.onMove({ viewport: getViewport(), event });
      }
    }

    function handlePointerUp(event) {
      pointerMap.delete(event.pointerId);
      if (pinchGesture) {
        pinchGesture = pointerMap.size >= 2 ? pinchGesture : null;
        panDrag = null;
        isPanning = false;
        suppressPlacementClick = true;
        if (typeof setTimeout === "function") setTimeout(() => { suppressPlacementClick = false; }, 120);
        try { event.currentTarget.releasePointerCapture(event.pointerId); } catch (_error) {}
        applyViewport();
        return;
      }
      const drag = panDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      suppressPlacementClick = Boolean(drag.didDrag);
      if (drag.didDrag && typeof setTimeout === "function") setTimeout(() => { suppressPlacementClick = false; }, 0);
      isPanning = false;
      panDrag = null;
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch (_error) {}
      applyViewport();
    }

    function handlePlacementClick(event) {
      if (!placementEnabled || readOnly) return;
      if (suppressPlacementClick || pointerMap.size > 1 || pinchGesture) {
        suppressPlacementClick = false;
        return;
      }
      if (!surface) return;
      const point = pointerEventToPercent(surface, event);
      if (!point) return;
      callbacks.onPlacement({ drawing: currentDrawing, point, event });
    }

    function handleWheel(event) {
      if (stage && typeof container.contains === "function" && !container.contains(event.target)) return;
      if (!stage) return;
      if (event.ctrlKey) {
        event.preventDefault();
        zoomBy((event.deltaY > 0 ? -1 : 1) * settings.zoomStep);
        return;
      }
      if (event.shiftKey && isZoomed(viewport, settings.defaultZoom)) {
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        if (!delta) return;
        event.preventDefault();
        setViewport({ zoom: viewport.zoom, pan: { ...viewport.pan, x: viewport.pan.x - delta } });
      }
    }

    function resize() {
      updateOverlays();
      applyViewport();
    }

    function destroy() {
      destroyed = true;
      renderToken += 1;
      callbacks.cleanupSource({ drawing: currentDrawing, sourceUrl: currentSourceUrl });
      clearElement(container);
      stage = null;
      surface = null;
      overlayLayer = null;
      overlays = [];
      pendingOverlay = null;
      currentDrawing = null;
      currentSourceUrl = null;
      resetInteractionState();
    }

    return Object.freeze({
      getViewport,
      setViewport,
      resetViewport,
      setZoom,
      zoomBy,
      setMode,
      setWorkspaceOpen,
      requestFullscreen,
      exitFullscreen,
      render,
      setOverlays,
      resize,
      handleWheel,
      destroy,
      getStage: () => stage,
      getSurface: () => surface,
      getSelectedOverlayId: () => selectedOverlayId,
    });
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
    normalizeDrawing,
    createDrawingViewerController,
  });
});
