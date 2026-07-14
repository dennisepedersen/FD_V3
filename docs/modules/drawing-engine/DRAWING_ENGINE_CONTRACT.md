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

## Module Boundary

Each module maps its own records to neutral overlays before calling the engine. Each module maps neutral placements back to its own API payloads.

For CCTV this is handled by `project-equipment-cctv-drawing-adapter.js`. Restarbejde must get its own adapter later, using its own drawing and placement tables.

## Crop Foundation

The engine exposes a neutral crop calculation around a coordinate. It returns browser-pixel crop bounds for the currently rendered drawing surface. PR2 does not add a new report UI or change CCTV PDF export.
