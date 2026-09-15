# IGVA next generation architecture

Status: design intent and implemented foundation notes
Date: 2026-09-07
Scope: IGVA foundation, background economy sync, persisted summary, and future architecture hooks. This document does not implement EA, scope editing, document upload, material matching UI, or ETC/EAC.

## Implemented Foundation

`verified`: IGVA has one calculation path. Full project detail is still produced by `igvaPocCalculator` via `igvaPocAdapter`, and the lightweight `igva_project_summary` stores selected calculator output for fast rendering.

`verified`: Project manager completion is tenant/project-scoped in Fielddesk DB with an append-only history table and an `audit_event` entry for each change.

`verified`: The summary is tenant/project-scoped and stores calculated/freshness timestamps plus compact economy fields. It must not store full purchase-line or expected-history payloads. Top-level typed columns are the current lightweight read model for UI surfaces.


## V1 Stabilisation Model

`verified`: The lightweight `igva_project_summary` is the canonical read model for overview surfaces. `/oekonomi`, the case overview, Quick View and project Overblik must read the same persisted summary columns so equal-precision values cannot drift between surfaces.

`verified`: IGVA detail may perform a read-through calculation for one project, but when it does, the compact summary is updated in the same request path. The intended lifecycle is therefore:

`summary current` -> normal overview truth
`detail read-through` -> authoritative recalculation for one project -> compact summary update

The system must not intentionally leave detail as a newer truth while summary remains stale without freshness metadata.

`verified`: Background bootstrap is tenant/project based in the existing sync-worker endpoint `igva_project_summary`. It is not bound to one named production user. In IGVA v1 the unattended worker policy is explicitly `ACTIVE_ONLY`: active V4 projects with an EK project id. Recently closed projects are not part of unattended v1 background bootstrap. They remain a future option for an approved closed bootstrap or an explicit targeted/on-demand refresh.

`verified`: The queue selects missing summaries first, then failed or rate-limited partial summaries, then source-changed/stale summaries by oldest `source_synced_at`. Concurrency, project limit, throttle and freshness max age are environment-configurable.

`verified`: A 429 from any required EK source defers that project instead of retrying aggressively in the same run. One project failure does not stop the rest of the queue.

Freshness fields:

- `source_synced_at`: when the relevant EK/legacy source set was last checked for the summary.
- `calculated_at`: when the IGVA calculator produced the persisted summary.

Incremental source notes:

- `purchaseinvoicelines` supports `updatedAfter` and the client exposes it for future cheap change detection.
- Current material actual still uses a full direct ProjectID line read for recalculation because Fielddesk does not yet persist the complete raw purchase-line source model.
- `projects_v4`, `fitterhours` and `worksheets` are already delta-capable in the broader sync architecture.
- Expected latest, budget, expected history and financial-post turnover remain project reads in the current POC calculator path.

## Background Economy Sync

IGVA summary refresh is modelled as the endpoint key `igva_project_summary` in the existing sync-worker/job architecture.

The worker should refresh a controlled batch of projects selected by tenant and oldest `source_synced_at` first. It follows the existing sync cadence and can be tuned by environment configuration, instead of defining a hard business age threshold in UI.

Selection modes are explicit policy, not sort-order side effects:

- `ACTIVE_ONLY`: unattended IGVA v1 worker default. Closed projects are outside the candidate set.
- `ACTIVE_AND_RECENT_CLOSED`: future approved policy for active plus recently closed continuity.
- `CLOSED_ON_DEMAND`: explicit project-targeted refresh only, for a user-opened closed project or a targeted operational refresh.

`closed_observed_at` means when Fielddesk observed a project as closed in imported project state. It is not necessarily the business/project closed date and must not be used as an economic or lifecycle truth without separate evidence.

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
- case overview progressbars
- Quick View economy snippets
- project Overblik economy snippets
- dashboard economy widgets later

The summary stores only compact fields such as:

- calculated/source synced timestamps
- budget, expected and manager completion
- labor and material completion
- actual/expected revenue and costs
- expected contribution margin and coverage
- quality/status metadata

Full detail remains an on-demand IGVA detail read-through and calculator response.

`summary_json` is a compact calculation snapshot. Mutable project manager completion is owned by `igva_project_manager_completion` and projected into the top-level `igva_project_summary.manager_completion_percent` column. Normal writes remove any legacy embedded manager-completion keys from `summary_json` so typed columns and embedded payload cannot drift as duplicate truths.

Field ownership:

- `igva_project_manager_completion`: current manager completion source of truth and comment.
- `igva_project_manager_completion_event`: append-only manager completion history.
- `igva_project_summary.*_percent`, revenue/cost/DB/coverage columns: lightweight current read model for overview surfaces.
- `igva_project_summary.summary_json`: compact calculator provenance and non-mutable calculation snapshot only.
- full purchase lines, expected-history rows and future scope/EA/material-control rows: owned by their own domains, not by summary.

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