# IGVA POC EK Mapping Audit

Status: POC audit
Date: 2026-08-31
Scope: read-only mapping for the local IGVA/project economy POC

## Summary

verified: v4 `/projects` is the current project/masterdata source in Fielddesk.
verified: v3 project/WIP data is documented as enrichment, and the raw sample for project `80229-001` contains economy/WIP fields.
verified: Fielddesk currently reads `project_wip` and `project_masterdata_v4` in project APIs.
observed: `project_masterdata_v4.project_expected_values` and `project_masterdata_v4.project_budget` exist in schema, and one-off scripts can store the raw v4 subtrees.
unclear: normal `backend/src/services/syncWorker.js` currently does not persist the full v4 budget/expected JSON subtrees, and it does not persist v3 `TotalLaborCost` or `TotalPOCost` as separate columns.

## Endpoint Use

| Purpose | Endpoint | Status | Notes |
|---|---|---|---|
| Project masterdata | v4 `/api/v4.0/projects` / `/api/v4/projects` | verified | Current source for project identity, lifecycle and raw budget/expected subtrees when persisted. |
| Project WIP/economy | v3 `/Management/WorkInProgress` / v3 project variants | observed | Raw sample includes WIP/economy fields, but production sync does not persist every economy field. |
| Project detail | v4 `/api/v4/projects/id/{EK ProjectID}` | verified for detail probes | Not used by this POC API. POC stays on persisted read-only Fielddesk data. |

## Field Mapping

| Fielddesk concept | EK endpoint | EK field | FD storage/read path | Confidence | Evidence |
|---|---|---|---|---|---|
| Labor budget | v4 projects budget subtree | `projectBudget.projectBudgetCostResponseDTO.salaryTotal` | `project_masterdata_v4.project_budget` JSON | likely | OpenAPI describes `salaryTotal` as total wage/labor cost; not yet verified against EK UI for Dennis projects. |
| Labor actual | v3 WIP/project economy | `TotalLaborCost` | not currently persisted as separate FD column | unresolved | Raw `80229-001` sample has `TotalLaborCost`, but schema/project query lacks this column. POC does not infer it from `Costs`. |
| Labor expected | v4 expected values subtree | `projectExpectedValues.totalLaborExp` | `project_masterdata_v4.project_expected_values` JSON | likely | OpenAPI describes it as expected total labor. |
| Material budget | v4 projects budget subtree | `projectBudget.projectBudgetCostResponseDTO.materials` | `project_masterdata_v4.project_budget` JSON | likely | OpenAPI describes it as material costs. |
| Material actual | v3 WIP/project economy | `TotalPOCost` | not currently persisted as separate FD column | unresolved | Raw sample has the field; normal schema/project query does not. POC does not infer actual materials from total costs. |
| Material expected | v4 expected values subtree | `projectExpectedValues.totalPurchases` | `project_masterdata_v4.project_expected_values` JSON | likely | OpenAPI describes it as total purchases, not strictly material-only. POC labels source evidence in calculation details. |
| Total project budget | v4 projects budget subtree | `projectBudget.projectBudgetCostResponseDTO.total` | `project_masterdata_v4.project_budget` JSON | likely | OpenAPI describes it as total cost. If absent/zero, POC does not replace it with uncertain fields. |
| Total actual cost | v3 WIP/project economy | `Costs` | `project_wip.costs` | likely | Raw sample and existing one-off backfill map this field to `project_wip.costs`; exact EK semantics still not fully documented. |
| Expected total cost | v4 expected values subtree | component sum from `totalLaborExp`, `totalPurchases`, `miscellaneousPurchases`, `posts` | `project_masterdata_v4.project_expected_values` JSON | likely | Component fields are documented in OpenAPI. |
| Expected turnover | v4 expected values subtree | `projectExpectedValues.totalTurnOverExp` | `project_masterdata_v4.total_turn_over_exp` and JSON | likely | OpenAPI describes expected total turnover; sync stores `total_turn_over_exp` when available in older backfill path. |
| Billed | v3 WIP/project economy | `Billed` | `project_wip.billed` | observed | Existing one-off script maps it; business meaning not otherwise verified. |
| Ongoing | v3 WIP/project economy | `Ongoing` | `project_wip.ongoing` | observed | Existing one-off script maps it; business meaning not otherwise verified. |
| Margin | v3 WIP/project economy | `Margin` | `project_wip.margin` | observed | Existing one-off script maps it; business meaning not otherwise verified. |
| Remaining hours | v3 WIP/project economy | `RemainingHours` | `project_wip.remaining_hours` | unresolved | Field exists in sample and schema, but calculation semantics are not proven. POC displays it only as unresolved source metadata, not as derived fact. |
| Actual hours | v3 WIP/project economy / fitterhours | `HoursFitterHour` / persisted `fitter_hour.hours` | `project_wip.hours_fitter_hour`; fitterhour summary is synced rows only | partial | Hours are verified as hours/quantity in fitterhour mapping, but current persisted scope may be incomplete. |

## POC Rules From This Audit

- No E-Komplet writes.
- No new sync path.
- No permanent database table for project manager completion.
- No calculation of remaining hours from remaining money divided by average historical hourly cost.
- Use only component values with known denominators and actual costs in weighted completion.
- Keep unresolved economy visible as data-quality warnings and excluded calculation rows.
- Treat Kalkia adjustments as injected rules on the material envelope; adjustments do not become independent progress rows.

## IGVA POC v2 implementation update

Status: POC v2 implementation
Date: 2026-08-31
Scope: local IGVA POC only; no permanent economy schema, no E-Komplet writes, no production deployment.

verified: The POC API still uses the existing tenant/user scoped Fielddesk project query before any EK read-through enrichment. The UI route remains `/api/igva-poc/projects` with `scope = mine`.

verified: Expected economy now prefers dedicated V4 read endpoints:

- Primary: `GET /api/v4/projects/expectedvalues/latest/{projectId}`
- Fallback: `GET /api/v4/projects/budgets/{projectId}.projectExpectedValues`
- Last local fallback: persisted `project_masterdata_v4.project_expected_values`, marked `PARTIAL`

verified: Budget now prefers `GET /api/v4/projects/budgets/{projectId}.projectBudget`, with persisted `project_masterdata_v4.project_budget` only as `PARTIAL` fallback.

verified: Expected history is read from `GET /api/v4/projects/expectedvalues/history/{projectId}` and exposed as external provider history only. It is not Fielddesk's permanent internal event model.

verified: Actual turnover is read from V4 financial posts and account `1020` is normalized to positive actual turnover for display.

verified: Actual labor/hours are intentionally a legacy bridge:

```text
source = ek_v3_legacy_fitterhours
actual_hours = sum(BasisTotalHours)
actual_labor_net = sum(BasisTotalCost) - sum(BasisHoursSocialCost)
social_additions = sum(SocialTaxes)
actual_labor_total = actual_labor_net + social_additions
```

verified: V4 project detail `hourSpent` is not used as actual hours. It can be shown only as raw activity context when available.

verified: Actual materials remain `PARTIAL`/`UNRESOLVED` and are excluded from weighted completion. Expected materials use V4 `totalPurchases`; expected material breakdown uses `creditorExpectedValues`; `Lager/Bil` is classified as a bucket when `creditorName=null` / `creditorReference="-1"` / EK creditor id `1`, and is not a creditor.

verified: `Uspecificeret expected` is computed dynamically:

```text
unallocated_expected_materials = totalPurchases - sum(expected material breakdown rows)
```

verified: Calculation coverage is based on economic denominator weight with valid actual + denominator. Components with denominators but unresolved actuals count against coverage and are listed as excluded from the weighted calculation.
verified: Live V3 fitterhour payloads may omit an explicit `BasisHoursSocialCost` field. When absent, POC v2 derives the same basis-social-cost component row by row from `BasisTotalCost` and `SocialTaxesInPercent`, then still uses `SocialTaxes` as the social addition total:

```text
basis_hours_social_cost = sum(BasisTotalCost - (BasisTotalCost / (1 + SocialTaxesInPercent / 100)))
actual_labor_net = sum(BasisTotalCost) - basis_hours_social_cost
```

verified: Live `creditorExpectedValues` rows from `GET /api/v4/projects/budgets/{projectId}` may carry creditor metadata nested under `row.creditor` rather than as flat row fields. POC v2 accepts both shapes and classifies the nested `{ creditorID: 1, creditorName: null, creditorReference: "-1" }` row as `source_type = lager_bil`, not as a creditor.

## IGVA POC v3.1 UI and expected-history update

Status: POC v3.1 implementation
Date: 2026-09-02
Scope: local IGVA POC UI and read-only expected-history exposure; no migrations, no EK writes, no production deployment.

verified: The POC UI now uses the Figma references for UX and information hierarchy only. Fielddesk's existing visual identity remains authoritative for typography, spacing, panels, buttons, badges, colors and rounded surfaces.

verified: The main project view separates data quality from project attention. Data quality explains source confidence; attention items are neutral observations and do not introduce alarm thresholds.

verified: Material actual in IGVA now consists of ordinary creditor/material purchase actual plus a separate Lager/Bil candidate component:

```text
materialActual = classified creditor MATERIAL + lagerBilActualCandidate
```

observed: On `80396-003` / EK ProjectID `25906`, the Lager/Bil candidate is the signed sum of direct ProjectID purchase invoice lines where `FinancialAccount=null` and `StatusEnum=4`. This is `95,904.77`, which rounds to the historical EK UI bucket `95,905`.

likely: The Lager/Bil source rule is strong enough for the POC as `PROBABLE`, but it is not an officially documented EK V4 Lager/Bil field and must not be treated as a general material category rule.

verified: Rows counted in `lagerBilActualCandidate` are excluded from ordinary creditor/material aggregation to avoid double counting. Original transaction type, supplier, item and raw provenance are preserved.

verified: Because material actual includes a probable Lager/Bil component, the material source quality is `VERIFIED_WITH_PROBABLE_COMPONENT` rather than fully verified.

verified: The expected history endpoint is used as provider history:

```text
GET /api/v4/projects/expectedvalues/history/{projectId}
```

verified: The POC derives timeline events only from old/new total fields present in the EK rows: expected labor, expected materials, expected turnover and expected hours when those fields exist.

unclear: No individual creditor/material-row expected history has been proven from this endpoint. The POC must not fabricate creditor history from total-level history rows.

hypothesis: A future Fielddesk-native project economy timeline should combine EK expected history, FD project manager assessments, material source classification changes and future FD expected-value edits. That requires a separate durable event model and is intentionally not part of this POC v3.1 change.
## IGVA POC v3.1 online access update

Status: POC online hardening
Date: 2026-09-03
Scope: existing Fielddesk deployment preparation; no migrations and no E-Komplet writes.

verified: IGVA POC data/API access is guarded server-side by `igva_poc_online_allowlist_v1` before any IGVA economy read-through is performed.

verified: The current POC allowlist is intentionally narrow and uses human-readable identifiers rather than hardcoded database IDs:

```text
tenant.slug = hoyrup-clemmensen
tenant_user.username = dep
```

verified: `/api/igva-poc/projects` still requires the existing bearer access token and tenant host context. The route then validates tenant context, validates the POC allowlist, validates `project_ref`, and only then calls the IGVA service.

verified: `project_ref` is not treated as authorization. The service first lists tenant/user scoped Fielddesk projects and filters the requested reference inside that scoped set. A requested reference outside DEP's scope returns no project and the HTTP route returns `404`.

verified: To reduce E-Komplet 429 risk, `/api/igva-poc/projects` without `project_ref` returns only a lightweight project list. It does not call E-Komplet read-through endpoints for every DEP project. Economy details are fetched only for a selected project via `?project_ref=<ref>`.

verified: The browser UI keeps project manager completion in `localStorage` only and states that this is POC-local browser persistence.

observed: The existing Fielddesk tenant UI authenticates API calls with a bearer access token stored in browser `localStorage`. Ordinary server-side HTML navigation to `/igva-poc` cannot identify the user before JavaScript runs without a broader auth/session change. Therefore the static IGVA HTML/JS shell can be tenant-gated server-side, while the actual IGVA data/API is tenant+DEP gated server-side. This is a deployment decision point if the requirement is strict user-level denial of the HTML shell itself.

rollback options:

- Preferred emergency rollback: set `IGVA_POC_ONLINE_ENABLED=false` in the service environment and restart through the approved deployment process.
- Code rollback: revert the IGVA POC route/gate commit and redeploy through the normal Fielddesk deployment flow.
- No database rollback is required; this update has no migrations.