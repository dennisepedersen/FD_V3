# IGVA next generation architecture

Status: design intent and implemented foundation notes
Date: 2026-09-07
Scope: IGVA foundation, background economy sync, persisted summary, and future architecture hooks. This document does not implement EA, scope editing, document upload, material matching UI, or ETC/EAC.

## Implemented Foundation

`verified`: IGVA has one calculation path. Full project detail is still produced by `igvaPocCalculator` via `igvaPocAdapter`, and the lightweight `igva_project_summary` stores selected calculator output for fast rendering.

`verified`: Project manager completion is tenant/project-scoped in Fielddesk DB with an append-only history table and an `audit_event` entry for each change.

`verified`: The summary is tenant/project-scoped and stores calculated/freshness timestamps plus compact economy fields. It must not store full purchase-line or expected-history payloads.

## Background Economy Sync

IGVA summary refresh is modelled as the endpoint key `igva_project_summary` in the existing sync-worker/job architecture.

The worker should refresh a controlled batch of projects selected by tenant and oldest `source_synced_at` first. It follows the existing sync cadence and can be tuned by environment configuration, instead of defining a hard business age threshold in UI.

External E-Komplet access is read-only. Financial writes, EK creates, updates, deletes, or status changes are out of scope.

## Incremental And Rate Limit Strategy

`observed`: E-Komplet rate limiting has occurred during broad audits, so IGVA must avoid aggressive parallel read-through across all projects.

Current foundation:

- queue-based refresh through existing `sync_job`
- low concurrency for project summary refresh
- per-project failure isolation
- endpoint state status for partial failures
- no live EK read per `/oekonomi` render

Future source materialization can use endpoint delta capabilities such as `updatedAfter` on purchase invoice line search. Until raw line persistence exists, a delta-only line fetch cannot safely recompute full material totals by itself.

## Lightweight Summary Layer

`igva_project_summary` is the read model for:

- `/oekonomi`
- future case overview progressbars
- future Quick View economy snippets
- future project Overblik economy snippets
- dashboard economy widgets later

The summary stores only compact fields such as:

- calculated/source synced timestamps
- budget, expected and manager completion
- labor and material completion
- actual/expected revenue and costs
- expected contribution margin and coverage
- quality/status metadata

Full detail remains an on-demand IGVA detail read-through and calculator response.

## Freshness

Freshness is a timestamp, not a hard business verdict in this round.

Normal UI may show discrete text such as:

- `Opdateret 2 timer siden`
- `Sidst synkroniseret 10:32`
- `Afventer første synkronisering`

A later business rule can decide warning thresholds per tenant, endpoint, project status, or user role.

## Baseline And Current Scope

Future IGVA should separate:

`ORIGINAL BASELINE`

- accepted offer
- offer lines
- Kalkia data
- budget basis
- accepted scope snapshot

`CURRENT SCOPE`

- original baseline
- approved extra work
- removed work
- changed quantities
- changed agreed prices

Fielddesk must be able to explain:

```text
oprindeligt solgt
+ ændringer
= aktuelt leveranceomfang
```

The original baseline is immutable after acceptance. Current scope is an auditable derived state.

## EA And Work Packages

Future `Ekstraarbejde / EA` should be fast to create with minimal fields:

- title
- optional material lines with quantity, cost and sales price
- optional labor lines with hours, rate and sales price
- status, responsible user and customer approval state

Fielddesk should not automatically mirror E-Komplet subproject structure. A Fielddesk work package or EA can map to an EK subproject only when the business process needs separate EK accounting.

## Document Storage And Security

Documents are project/work-package/EA evidence, not only EA attachments.

Future generic documents can include:

- approval PDFs
- emails
- photos
- drawings
- spreadsheets
- offer material
- customer sign-off

Security requirements:

- every file metadata row is tenant-scoped
- every file belongs to project and optionally work package/EA/object
- every download route revalidates tenant, project access and role server-side
- no direct public object URL is sufficient authorization
- no security by hidden link

## Selective Material Control

Base IGVA should be useful without setup. Detailed control is optional.

Future controls:

- `BASIS`: economy only
- `UDVALGT KONTROL`: chosen critical items only
- `DETALJERET`: broader scope/purchase matching

A project manager should be able to choose `Følg denne vare` for important items. Small consumables such as screws, plugs and sealant should normally only contribute economically.

## Canonical Item Matching

Future item matching must preserve raw purchase evidence and add canonical identity later.

Keep separate:

- supplier item code
- raw item name
- EAN
- catalog/group
- canonical item id
- match confidence
- manual override/audit

No fuzzy/AI match should overwrite raw source fields.

## Quantity, Tolerance And Price Control

Purchased material is not automatically installed or consumed.

Future quantity checks need tolerance, batch size, waste factors and item-specific granularity. Cable is the canonical example: 4,209 m expected and 4,500 m purchased may be normal.

Future price control should keep these values separate:

- calculated cost price
- supplier agreed price
- actual purchase price
- sales price

## ETC And EAC

Future IGVA direction:

`ETC` = Estimate To Complete: expected cost still needed to finish known scope.

`EAC` = Estimate At Completion: actual cost plus remaining expected/current scope.

This is intentionally not implemented in this round. The current actual/expected model must not block a future warning such as: actual material is near expected, but known remaining scope requires more cost than expected remaining budget.

## Timeline And Audit

Project manager completion uses append-only history now. Future timeline should combine:

- manager completion changes
- summary refresh events
- expected value changes from EK history
- scope/EA approvals
- baseline acceptance
- important material control events

Each event must retain tenant, project, actor, timestamp, source and enough metadata to explain the calculation later.