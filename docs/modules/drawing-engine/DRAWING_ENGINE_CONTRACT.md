# Fielddesk Drawing Engine Contract

PR2 establishes one shared browser-side drawing engine for project modules.

The engine is domain-neutral. It may work with drawings, pages, overlays, placements, coordinates, viewports, zoom, pan, touch, fullscreen workspaces, and crop calculations. It must not know about CCTV cameras, MAC addresses, Restarbejde defects, OBS, or module database tables.

## Canonical Coordinate Contract

All project modules store placements with:

- `drawing_id`
- `page_number`
- `x_percent`
- `y_percent`

`page_number` is 1-based. Percent coordinates are canonical storage. Zoom, pan, viewport pixels, scroll offsets, and browser dimensions are never persisted.

## Shared Viewer Controller

`drawing-engine.js` exposes `createDrawingViewerController(...)` as the reusable browser-side lifecycle owner. The controller owns generic viewer behavior:

- image and `pdf_page` rendering
- PDF.js page rendering through an injected neutral loader
- stage and surface lifecycle
- overlay DOM creation and update
- selected and pending overlay state
- percent placement calculation from the current drawing surface
- viewport state, zoom, reset, pan, wheel, touch pointer tracking, and pinch zoom
- workspace open/close helpers where a module supplies the shell/body classes
- resize, cleanup, render completion, and render error callbacks

The controller accepts neutral drawings, neutral overlays, source URLs, and callbacks. It does not fetch module APIs, save records, choose permissions, or build module-specific panels.

## Module Boundary

Each module maps its own records to neutral drawings and overlays before calling the engine. Each module maps neutral placements back to its own API payloads.

For CCTV this is handled by `project-equipment-cctv-drawing-adapter.js`. CCTV still owns camera labels, status colors, API calls, permissions, save/delete actions, and the camera detail panel. Restarbejde must get its own adapter later, using its own drawing and placement tables.

## Asset Failure Contract

The project page must handle missing drawing assets with sanitized, explicit errors instead of undefined-property failures:

- `fielddesk_drawing_engine_unavailable`
- `fielddesk_cctv_drawing_adapter_unavailable`

A missing drawing asset must not stop the rest of the project page from initializing.

## Crop Foundation

The engine exposes a neutral crop calculation around a coordinate. It returns browser-pixel crop bounds for the currently rendered drawing surface. PR2 does not add a new report UI or change CCTV PDF export.
