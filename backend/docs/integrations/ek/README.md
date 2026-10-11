# EK Integration References

Status: current integration reference index
Scope: E-Komplet External API reference material and Fielddesk-specific interpretation notes

## Canonical External API v4 OpenAPI Reference

`ek_external_api_v4_openapi.json` is Fielddesk's canonical complete EK External
API v4 OpenAPI reference.

### Current Source

- Received from the user on 2026-10-11 as `v4-da (5).json`.
- Imported byte-for-byte; source SHA-256:
  `2d31baf9b6c78bc1424d3f831c700e1bfac0c9838047533bc200236bec738de3`.
- Declared API version: `4.0`; OpenAPI version: `3.0.4`.
  The download suffix `(5)` is not a declared API version.
- Local validation: JSON parses and all 1,895 local `$ref` occurrences resolve.
- Compared with the previous tracked reference: 14 added paths, 4 changed paths,
  no removed paths; 52 added schemas, 1 changed schema, no removed schemas.
- Newly documented reads include `/api/v4/fittercategories` and
  `/api/v4/fittercategories/{id}`. The list uses query parameter `pagesize`
  (lowercase), alongside `page`, `search` and `updatedAfter`.
- FitterHours paths and the Planning membership DTO are unchanged. No Planning
  or resource-group membership endpoint was added, so this update does not
  resolve the Timekontrol period-coverage or authoritative-membership gaps.
- New import/write endpoints are documentation only, not permission to use them.
  No runtime adapter, API call, sync, database change or live verification was
  performed when importing this reference.

Rules:

- The file may be read, searched, and parsed during EK integration work.
- The file is external reference documentation.
- Do not manually change the OpenAPI file to fit Fielddesk behavior.
- If Fielddesk code and the OpenAPI spec disagree, investigate and document the
  difference before changing integration behavior.
- The smaller `.md` notes in this directory remain the Fielddesk-specific
  interpretation and decision layer for EK usage.
- Former download names such as `v4-da (3).json`, `v4-da (4).json` and
  `v4-da (5).json` are not
  canonical references.
