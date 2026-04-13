# Endpoint Contract Template

Status: template

## Metadata
- Endpoint:
- Version:
- Source system:
- FD consumer(s):
- Contract status: verified | observed | hypothesis | unclear

## Purpose
- What this endpoint is used for in FD.
- What it must not be used for.

## Payload Shape
- Top-level envelope variants (if multiple)
- Row collection path(s)
- Paging fields (page, pageSize, nextPage, total, cursor)

## Verified Fields
| Field | Type | Required | Used in FD | Target table/column | Status | Note |
|---|---|---|---|---|---|---|

## Unclear Fields
| Field | Observed sample | Why unclear | Blocking impact |
|---|---|---|---|

## Relations
- Relation keys to projects/users/fitters/categories
- Canonical join keys used in backend

## Known Pitfalls
- Version drift
- Null/empty key behaviors
- Non-unique identifiers

## Allowed FD Usage
- Explicit list of flows that may read this endpoint

## Evidence
- Code references
- Query references
- Migration/schema references
