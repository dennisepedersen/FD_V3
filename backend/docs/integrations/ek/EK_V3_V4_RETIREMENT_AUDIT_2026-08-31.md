# E-Komplet V3/V4 retirement audit

Dato: 2026-08-31

Status: READ-ONLY audit. Denne rapport er den eneste fil oprettet for auditten.

## Kort konklusion

Den gamle analyse fandt, at Fielddesk skulle bruge V4 Projects som autoritativ kilde for projektmasterdata og projektets lifecycle, mens V3 kun måtte bruges som enrichment for eksisterende projekter. Den gamle konklusion var derfor ikke, at V3 var en primær projektkilde, men at V3 stadig havde værdi for WIP/fitterhours/økonomi-signaler, som V4 dengang ikke var dokumenteret til at dække sikkert.

Det nye i den kanoniske V4 OpenAPI-spec er især tre projektrelaterede økonomi-endpoints:

- `GET /api/v4/projects/budgets/{projectId}`
- `GET /api/v4/projects/expectedvalues/latest/{projectId}`
- `GET /api/v4/projects/expectedvalues/history/{projectId}`

Derudover har V4 allerede dokumenterede eller observerede endpoints for projekter, fitters, fitterhours, cost codes, creditors, debtors/customers, purchase orders, purchase invoice lines, financial posts, worksheets, calendar events, project notes og project documentation.

Den gamle konklusion er derfor delvist forældet: V4 dækker nu en større del af projektøkonomi og forventede værdier end de gamle docs antog. Den er dog ikke fuldt forældet, fordi de gamle V3 WorkInProgress-felter stadig ikke har en dokumenteret 1:1 V4-erstatning for alle Fielddesk-felter, og fordi row-level/all-time `fitterhours` fortsat ikke er verificeret sikkert som V4-only i nuværende repository-dokumentation.

Samlet vurdering: Fielddesk kan ikke fjernes fra V3 helt endnu uden yderligere payload-verifikation og en mindre omlægning. En del V3-brug kan sandsynligvis fjernes eller erstattes nu, men en fuld V4-only beslutning bør vente på en kontrolleret read-only smoke mod rigtige tenant-payloads for projects budget/expected values/history og fitterhours.

## Evidensniveauer

- `verified`: Understøttet af repository-kode, kanonisk OpenAPI eller eksisterende lagrede payloads/docs med verificeret status.
- `observed`: Observeret i lokale filer eller tidligere dokumenteret i repo, men ikke gentaget live i denne audit.
- `likely`: Sandsynlig konklusion baseret på felt- eller endpoint-match, men kræver tenant-payload-verifikation.
- `unclear`: Mangler dokumentation, payload eller aktiv produktbeslutning.

Der er ikke udført live API-kald i denne audit. Ekstern læsning er derfor begrænset til repositoryets kanoniske OpenAPI-spec og eksisterende lagrede payload-/analysefiler. Der er ikke udført databasewrites, API-writes, migrations, deploy, service-restart eller produktionsændringer.

## Kanoniske kilder

`verified`:

- `backend/docs/integrations/ek/README.md` udpeger `backend/docs/integrations/ek/ek_external_api_v4_openapi.json` som den kanoniske komplette E-Komplet External API v4 OpenAPI-reference.
- Gamle downloadnavne som `v4-da (3).json` og `v4-da (4).json` findes ikke som tracked filer i repoet og er ikke kanoniske her.
- OpenAPI `info.version` er `4.0`, titel `EK.ExternalProxy.API (DA)`.
- OpenAPI beskriver, at gamle versioner kan virke, men at den nyeste version bør bruges.

Tidligere Fielddesk-beslutninger:

- `backend/docs/decisions/projects_endpoint_decision.md`, 2026-04-11, siger at `projects_v4` er autoritativ for projektets eksistens og lifecycle, mens `projects_v3 WorkInProgress` kun er enrichment på eksisterende `project_core`.
- `backend/docs/integrations/ek/projects_v4_masterdata.md` siger, at V4 projects er master stream for lifecycle/open/closed.
- `backend/docs/integrations/ek/projects_v3_wip.md` siger, at V3 WIP ikke må skabe nye projekter og ikke må afgøre lifecycle.
- `backend/docs/integrations/ek/fitterhours.md` og `fitterhours_retention_model.md` siger, at V4 project detail kan bruges til projekt-detalje `fitterHours`, men at V3 targeted `/api/v3.0/fitterhours?...searchAttribute=ProjectID...` stadig bruges når Fielddesk skal bruge faktiske timerækker.

## Aktiv V3-inventar i runtime

Definition for optælling: En "aktiv V3-familie" er en endpoint-familie i backend runtime, som kan forsøge en `/api/v3...` URL under normal sync/onboarding-konfiguration. Scripts og docs tælles separat.

`verified` aktive runtime-familier i `backend/src/services/syncWorker.js`: 8

| Familie | V3-brug i runtime | Materialiseret i Fielddesk | Status |
| --- | --- | --- | --- |
| `projects_v3` | `/api/v3.0/projects`, `/api/v3/projects`; også V3 `projects/ref` som detail fallback | Delvist. V3 må kun enrich'e eksisterende projekter; skriver især WIP-flag og identitetsfelter, ikke økonomikolonnerne | `likely replaceable after smoke` |
| `fitterhours` | V3 prøves før V4: `/api/v3.0/fitterhours`, `/api/v3/fitterhours` | Ja, til `fitter_hour` | `keep temporarily` |
| `fittercategories` | V3/V4 varianter forsøges, auto-tilføjes når `fitters` eller `fitterhours` er valgt | Ja, reference-/kategori-data | `unclear` |
| `fitters` | V4 prøves først, V3 fallback findes | Ja | `replaceable now` |
| `worksheets` | Generisk V4/V3 fallback | Ja, for tekniker-projektadgang | `replaceable now` |
| `users` | Generisk V4/V3 fallback; default-on i onboarding | Nej, read-only/non-materialized | `unclear/remove candidate` |
| `invoices` | Generisk V4/V3 fallback | Nej, read-only/non-materialized | `likely replace with financialposts if needed` |
| `purchaseinvoices` | Generisk V4/V3 fallback | Nej, read-only/non-materialized | `unclear naming replacement` |

Kort optælling:

- Aktive V3-familier i runtime: 8.
- Klart V4-erstatbare nu: 2 (`fitters`, `worksheets`).
- Sandsynligt V4-erstatbare efter smoke/payloadkontrol: 2 (`projects_v3`, `invoices`).
- Mangler verificeret V4-erstatning eller produktbeslutning: 4 (`fitterhours`, `fittercategories`, `users`, `purchaseinvoices`).

## Scripts, tests og docs med V3

`verified`:

- Der er flere read-only/probe/backfill scripts, som nævner V3, bl.a. `targeted_fitterhours_backfill.js`, `backfill_verify_80229_extended.js`, `save_raw_80229_001.js`, `fetch_v3_rich_80229_001.js`, `fetch_v3_final_80229_001.js`, `probe_v3_structure.js`, `probe_v3_paging.js` og `fetch_raw_project_80229_001.js`.
- `targeted_fitterhours_backfill.js` er særlig relevant, fordi den bruger V3 project-targeted fitterhours med `searchAttribute=ProjectID`.
- Flere docs beskriver stadig V3 som enrichment eller retention-kilde.
- Der blev ikke fundet tests, der kræver V3 API-kald som produktionsadfærd; der er primært statiske referencer.

Auditstatus for scripts:

- Behold `targeted_fitterhours_backfill.js`, indtil V4 row-level/all-time fitterhours er verificeret.
- Marker ældre V3 probe/raw scripts som arkiv-/research-kandidater, ikke runtime-afhængigheder.
- Rediger ikke docs i denne audit, men opdater senere de docs, som stadig siger at V4 ikke har budget/expected-values endpoints.

## V4 endpoint-inventar

`verified` fra kanonisk OpenAPI:

| Område | V4 endpoints | Relevans for V3 retirement |
| --- | --- | --- |
| Projects | `GET/POST /api/v4/projects`, `GET/PATCH /api/v4/projects/{id}`, `GET /api/v4/projects/id/{id}`, `GET /api/v4/projects/ref/{reference}`, `POST /api/v4/projects/search`, `GET /api/v4/deletedentities/projects` | Lifecycle/masterdata er allerede V4-autoritet |
| Project budgets | `GET /api/v4/projects/budgets/{projectId}`, `POST/PUT /api/v4/projects/budgets`, `GET/POST /api/v4/budgets`, `GET /api/v4/budgets/{id}` | Ny vigtig V4-erstatningskilde for budgetdata; kun GET relevant for Fielddesk audit |
| Expected values | `GET /api/v4/projects/expectedvalues/latest/{projectId}`, `GET /api/v4/projects/expectedvalues/history/{projectId}` | Ny vigtig V4-erstatningskilde for forventet omsætning/køb/løn/timer og historik |
| Fitterhours | `GET/POST /api/v4/fitterhours`, `POST /api/v4/fitterhours/query`, `GET /api/v4/paginatedfitterhours`, `GET /api/v4/deletedentities/fitterhours` | Dokumenteret, men tidligere repo-verifikation viste V4 list gav 0 eller usikker filtrering |
| Fitters/employees | `GET /api/v4/fitters`, `GET /api/v4/fitters/{id}` | Klar V4-erstatning for runtime fallback |
| Cost codes | `GET/POST /api/v4/costcodes`, `GET /api/v4/costcodes/{id}`, sum cost codes | Sandsynlig erstatning for kategorier/kostkoder, men ikke verificeret som `fittercategories` 1:1 |
| Creditors/suppliers | `GET /api/v4/creditors`, `GET /api/v4/creditors/{id}` | V4 dækker leverandør/creditor |
| Debtors/customers | `GET/POST /api/v4/debtors`, `GET /api/v4/debtors/{id}`, `GET /api/v4/debtors/ref/{reference}` | V4 dækker kunde/debtor |
| Purchase orders | `GET /api/v4/purchaseorders`, `GET /api/v4/purchaseorders/{id}`, `POST /api/v4/purchaseorders/search` | V4 dækker purchase order/header-søgning |
| Purchase invoice lines | `GET /api/v4/purchaseinvoicelines`, `POST /api/v4/purchaseinvoicelines/search` | V4 dækker fakturalinjer/materialer |
| Financial posts | `GET /api/v4/financialposts`, `POST /api/v4/financialposts/search` med varianter for end-of-year/parent account | V4 dækker posteringer og kan erstatte nogle økonomi-/invoice-behov |
| Worksheets | `GET/POST/PATCH /api/v4/worksheets`, `GET /api/v4/worksheets/{id}`, `POST /api/v4/worksheets/search` | Klar V4-kilde for tekniker-adgang |
| Calendar/absence | `GET /api/v4/calendarevents`, categories, `GET /api/v4/calendarevents/{id}` | V4 findes; ikke vurderet som aktiv Fielddesk V3-afhængighed |
| Project notes | `GET /api/v4/projects/{id}/notes` | V4 findes |
| Documentation | `GET /api/v4/projects/{id}/documentation` | V4 findes og er tidligere verificeret som ZIP |
| Users | Ingen `/api/v4/users` fundet; V4 har `roles` endpoints | V3 `users` har ingen direkte V4-erstatning i spec |

## Projects og WIP-feltmatch

`verified` fra gemt payload for projekt `80229-001`:

V3 WorkInProgress råfelter inkluderer bl.a.:

- `Costs`
- `Ongoing`
- `Billed`
- `Coverage`
- `Margin`
- `TotalTurnOverExpected`
- `TotalLaborCost`
- `TotalPOCost`
- `EstimatedHourCost`
- `HoursBudget`
- `HoursExpected`
- `HoursFitterHour`
- `HoursCalculated`
- `RemainingHours`
- `UnapprovedPurchaseOrders`
- `ReadyToBill`
- `LastRegistration`
- `LastFitterHourDate`
- `BillingValueDifference`

V4 project payload for samme projekt indeholder:

- `isClosed=false`
- `isIntern=false`
- `isWorkInProgress=true`
- `projectExpectedValues`
- `projectBudget`
- `fitterHours=null` i den paginerede project-list payload

Eksempel på match for `80229-001`:

| Felt / betydning | V3 værdi | V4 kilde | Auditvurdering |
| --- | ---: | --- | --- |
| `TotalTurnOverExpected` | 18000 | `projectExpectedValues.totalTurnOverExp=18000` | `verified match` |
| `TotalLaborCost` | 9818.79 | `projectExpectedValues.totalLaborExp=9817.78` / budget expected cost | `observed near-match`; kræver afrundings-/semantikafklaring |
| `HoursExpected` | 0 | `projectExpectedValues.hoursExpected=0` | `verified match` |
| `HoursBudget` | 0 | `projectBudget.projectBudgetCostResponseDTO.fitterHoursTotal=0` | `likely match` |
| `HoursFitterHour` | 22.5 | Ikke i V4 project list; V4 detail kan have `fitterHours` | `not replaced by project list` |
| `Costs` | 9818.79 | Kan sandsynligvis udledes fra labor/purchase/material/financial posts | `likely composition`, ikke 1:1 dokumenteret |
| `Ongoing` | 18002.92 | Ikke fundet som direkte V4-felt | `missing direct replacement` |
| `Billed` | 0 | Muligvis financial posts/invoices | `likely composition`, ikke 1:1 dokumenteret |
| `Coverage` | 45.46 | `coverageInPercent` findes på V4 project; budget/expected kan understøtte | `likely`, kræver payloadkontrol |
| `Margin` | -9818.79 | Kan beregnes af costs/billed/expected model | `likely composition`, ikke 1:1 dokumenteret |
| `RemainingHours` | -22.5 | Kan beregnes fra expected/budget minus registered hours | `likely composition`, kræver fitterhours-kilde |
| `UnapprovedPurchaseOrders` | 0 | Ikke fundet som direkte V4 project budget/expected field | `unclear` |
| `ReadyToBill` | false | Ikke fundet som direkte V4 field | `missing direct replacement` |
| `LastRegistration` | 2026-01-27 | Muligvis financialposts/worksheets/fitterhours updated dates | `likely composition`, ikke 1:1 |
| `LastFitterHourDate` | 2026-01-27 | V4/V3 fitterhours row dates | `requires fitterhours source` |
| `BillingValueDifference` | -18002.92 | Ikke fundet som direkte V4 field | `missing direct replacement` |

Konsekvens: V4 budget/expected values gør en stor del af den gamle V3-WIP-økonomi mindre nødvendig, men de erstatter ikke dokumenteret alle gamle V3 WIP-felter 1:1. Nogle felter skal beregnes eller hentes via purchase/financial/fitterhours endpoints, og nogle felter mangler stadig direkte dokumenteret V4-kilde.

## Budget og expected values

`verified` fra OpenAPI:

`GET /api/v4/projects/budgets/{projectId}` beskrives som hentning af projektets budget med omkostnings-, salgs- og budgetlinjer samt forventede totalværdier. Response indeholder bl.a.:

- `projectBudget`
- `projectExpectedValues`

`ProjectBudgetResponseDTO` indeholder bl.a.:

- `projectBudgetCostResponseDTO`
- `projectBudgetSalesResponseDTO`
- `projectSalaryBudgetLineResponseDTOs`
- `projectSalesBudgetLineResponseDTOs`

`ProjectExpectedValueResponseDTO` indeholder bl.a.:

- `totalTurnOverExp`
- `totalPurchases`
- `totalLaborExp`
- `netLaborExp`
- `overtimeExp`
- `zoneAllowanceExp`
- `socialFeeExp`
- `miscellaneousPurchases`
- `posts`
- `hoursExpected`
- `creditorExpectedValues`

`ProjectExpectedValuesHistoryDTO` indeholder gamle og nye værdier for centrale felter samt:

- `userName`
- `createdDate`
- `note`
- `projectPostsOld`
- `projectPosts`
- `hoursExpectedOld`
- `hoursExpected`

Auditvurdering:

- `verified`: V4 har nu læse-endpoints, som tidligere beslutninger ikke fuldt indarbejdede.
- `likely`: `expectedvalues/history` kan bruges direkte til Fielddesk change history for forventede værdier, hvis tenant-payloads bekræfter stabil historik og pagination/retention.
- `unclear`: Om historikken er komplet for alle relevante felter og alle tenants, og om den har samme semantik som V3 WorkInProgress-differencer.
- `forbudt i denne scope`: `POST` og `PUT` budget endpoints må ikke bruges uden særskilt write governance.

## Fitterhours

Nuværende Fielddesk-status:

- Global `fitterhours` sync er materialiseret til `fitter_hour`.
- Den globale bootstrap er begrænset til 12 måneder i `syncWorker`.
- `targeted_fitterhours_backfill.js` og retention-docs bruger V3 targeted ProjectID-søgning, når all-time eller faktiske timerækker skal bruges.
- `fitterhoursRefreshService.js` bruger V4 `GET /api/v4/projects/id/{EK ProjectID}` til project detail refresh og forventer en `fitterHours` array i project detail payload.

`verified/observed` fra eksisterende docs:

- V3 targeted `GET /api/v3.0/fitterhours?page=1&pageSize=1000&searchAttribute=ProjectID&search=<EK ProjectID>` virker for project-scoped faktiske timerækker.
- Tidligere verifikation viste, at `/api/v4.0/fitterhours` gav 0 i en tenant-verifikation, og at direkte `ProjectID`/`ProjectReference` params ikke filtrerede.
- V4 project detail `GET /api/v4/projects/id/{EK ProjectID}` har tidligere returneret `fitterHours` for konkrete kontrolprojekter.

`verified` fra OpenAPI:

- V4 har `GET /api/v4/fitterhours` for timeregistreringer i interval.
- V4 har `POST /api/v4/fitterhours/query`.
- V4 har `GET /api/v4/paginatedfitterhours`.
- OpenAPI-teksten nævner ID-baseret lookup via en paginated query-variant, men de faktiske paths i specen viser ikke entydigt `/api/v4/paginatedfitterhours/query`.

Auditvurdering:

- V3 kan ikke fjernes sikkert fra fitterhours endnu.
- En V4-only fitterhours-beslutning kræver read-only smoke på mindst:
  - interval/pagination for `GET /api/v4/fitterhours`
  - project ID query for `POST /api/v4/fitterhours/query`
  - parity mellem V4 project detail `fitterHours` og V3 targeted rows
  - all-time coverage for åbne eksterne projekter
  - date ranges, paging, deleted entities og updatedAfter semantics

## Retirement matrix

Statuskoder:

- `A replace now`: V4 replacement er dokumenteret og passer til nuværende brug.
- `B replace after payload smoke`: V4 replacement findes sandsynligt, men kræver live/read-only payloadkontrol.
- `C replace by composition`: Ingen 1:1 endpoint, men V4 kan sandsynligvis beregne feltet fra flere kilder.
- `D keep temporarily`: V3 har stadig verificeret nødvendig værdi.
- `E remove/unknown`: Aktiv V3-brug har ingen klar produktværdi eller ingen V4 mapping; kræver beslutning.

| V3 familie | Status | Begrundelse |
| --- | --- | --- |
| `fitters` | A | V4 `GET /api/v4/fitters` er dokumenteret og tidligere verificeret som full-list employee-kilde. |
| `worksheets` | A | V4 worksheets er dokumenteret og bruges til tekniker-projektadgang. |
| `projects_v3` | B/C | Nuværende runtime bruger ikke V3 økonomikolonner; V4 projects har lifecycle, WIP-flag og identity. Budget/expected endpoints giver nu økonomi, men kræver payload-smoke før fuld fjernelse. |
| `invoices` | B/C | V4 `financialposts` og relaterede invoice/purchase endpoints findes, men nuværende `invoices` er non-materialized. Hvis produktet ikke bruger det, kan det fjernes; hvis det bruges senere, bør V4-kilde vælges eksplicit. |
| `purchaseinvoices` | B/E | OpenAPI har `purchaseorders` og `purchaseinvoicelines`, ikke en direkte `purchaseinvoices` path. Nuværende runtime er non-materialized; kræver mapping-beslutning. |
| `fitterhours` | D | V3 targeted ProjectID rows er stadig den dokumenteret sikre kilde til faktiske rows/all-time i nuværende docs. |
| `fittercategories` | E | Ingen entydig V4 path fundet i OpenAPI som 1:1 `fittercategories`; costcodes findes, men semantikken skal verificeres. |
| `users` | E | Ingen `/api/v4/users` fundet. Nuværende brug er read-only/non-materialized og default-on; bør enten fjernes som endpoint selection eller erstattes af en konkret V4 roles/fitters-baseret produktbeslutning. |


## IGVA IMPACT

Den lokale IGVA POC er oprettet i samme workspace som denne audit, men filerne er ikke tracked i git endnu. Auditvurderingen bygger på IGVA mappingdokumentet, calculator/service/query-filerne, IGVA UI og `test/igvaPocCalculator.test.js`.

Kort IGVA-konklusion:

- `verified`: POC'en er korrekt konservativ ved at markere actual labor/material og `RemainingHours` som unresolved.
- `verified`: POC'en bruger allerede V4 `projectExpectedValues.totalLaborExp`, `projectExpectedValues.totalPurchases`, `projectExpectedValues.totalTurnOverExp` og budgetfelter som `materials` og `salaryTotal`.
- `observed`: POC'en læser disse V4-data fra persistede `project_masterdata_v4` JSON-subtrees, ikke direkte fra de nye dedikerede V4 endpoints.
- `likely`: De dedikerede V4 endpoints er en bedre og mere autoritativ fremtidig kilde til IGVA end de embedded project payload subtrees.
- `unclear`: Der er stadig ikke dokumenteret 1:1 V4-erstatning for alle gamle V3 WIP-felter, især `ReadyToBill`, `Ongoing`, `BillingValueDifference` og en autoritativ actual labor/material split.

### KEEP

| IGVA datakilde/mapping | Begrundelse | Næste POC-regel |
| --- | --- | --- |
| Tenant- og user-scoped read path i `igvaPoc.js` | `verified`: query joiner tenant-scopet på `project_core`, `project_wip`, `project_masterdata_v4` og filtrerer brugerens scope. | Behold scope-modellen ved næste datakildeskift. Nye EK-data må stadig kun materialiseres/læses tenant-scopet. |
| Konservativ unresolved-håndtering | `verified`: calculator/adapter ekskluderer komponenter uden actuals fra økonomisk sandhed. | Behold `missing_actual` og `unresolved_mapping` indtil payload-parity er verificeret. |
| `projectExpectedValues.totalLaborExp` som expected labor | `verified` fra OpenAPI som expected labor-lignende felt; POC bruger det korrekt som expected, ikke actual. | Behold som expected labor, men hent fremover fra `GET /api/v4/projects/expectedvalues/latest/{projectId}`. |
| `projectExpectedValues.totalTurnOverExp` som expected turnover | `verified` i OpenAPI og matcher gemt V3 sample på `TotalTurnOverExpected` for `80229-001`. | Behold som expected turnover; brug latest endpoint som autoritativ kilde. |
| `projectBudget.projectBudgetCostResponseDTO.materials` som material budget | `verified` felt i OpenAPI; POC bruger det som budget/material envelope. | Behold mapping, men verificer mod dedicated budget endpoint payload. |
| `projectBudget.projectBudgetCostResponseDTO.salaryTotal` som labor budget | `verified` felt i OpenAPI; POC bruger det som budget/labor envelope. | Behold mapping, men verificer mod dedicated budget endpoint payload og EK UI. |
| `projectBudget.projectBudgetCostResponseDTO.expectedTotalCosts` som unresolved | `verified`: POC bruger ikke feltet som labor eller total uden verifikation. | Behold unresolved indtil semantikken er afklaret. |
| `RemainingHours` ikke beregnet fra økonomi/timepris | `verified`: testen beskytter mod at udlede remaining hours fra penge divideret med historisk timepris. | Behold denne regel. Remaining hours må kun beregnes efter en eksplicit timer/retention-model. |

### REPLACE

| Nuværende POC-kilde/mapping | Erstat med | Hvorfor |
| --- | --- | --- |
| Embedded `project_masterdata_v4.project_expected_values` som primær IGVA-kilde | `GET /api/v4/projects/expectedvalues/latest/{projectId}` | Dedicated endpoint er mere målrettet, sandsynligvis mere autoritativ for latest expected values og uafhængig af om project-list payload indeholder fuld subtree. |
| Embedded `project_masterdata_v4.project_budget` som primær IGVA-kilde | `GET /api/v4/projects/budgets/{projectId}` | Dedicated endpoint beskrives som projektets budget med omkostnings-, salgs- og budgetlinjer samt expected totals. Det er bedre til IGVA end opportunistisk project payload JSON. |
| POC uden expected-value historik | `GET /api/v4/projects/expectedvalues/history/{projectId}` | Historikken kan give direkte ændringslog for expected labor/purchases/turnover/hours med `userName`, `createdDate` og old/new values. |
| V3 `TotalTurnOverExpected` som historisk sammenligningskilde | V4 latest/history expected values | V4 `totalTurnOverExp` matcher kendt sample og har dedikeret history. |
| V3 `TotalLaborCost` som kandidat for IGVA expected labor | V4 `totalLaborExp` for expected labor; actual labor skal komme fra fitterhours/financialposts efter verifikation | Feltmatchen er tæt i sample, men V3-navnet lyder actual/total cost, mens V4-navnet er expected. Brug ikke V4 expected som actual labor. |
| V3 `TotalPOCost` som kandidat for material actual | V4 `purchaseinvoicelines` og/eller `financialposts` efter project-scoped smoke | V4 expected `totalPurchases` er ikke actual material. Actual material bør komme fra purchase/financial data, ikke budget/expected snapshot. |

### VERIFY

| IGVA spørgsmål | Verifikationsbehov | Forventet POC-konsekvens |
| --- | --- | --- |
| Er dedicated `budgets/{projectId}` mere komplet end embedded project budget? | Sammenlign dedicated response mod embedded `projectBudget` for 5-10 projekter. | Hvis ja, flyt ingestion/read model til dedicated budget endpoint. |
| Er `expectedvalues/latest/{projectId}` identisk med eller nyere end embedded `projectExpectedValues`? | Sammenlign values og timestamps/source freshness. | Hvis dedicated er nyere/renere, brug den som autoritet og embedded som fallback/debug. |
| Kan `expectedvalues/history/{projectId}` bruges som IGVA change history? | Verificer sortering, pagination/fravær af pagination, old/new felter, user/date/note og retention. | Tilføj senere historikvisning eller audit trail for forventningsændringer. |
| Kan V4 erstatte actual labor? | Sammenlign V4 project detail `fitterHours`, `GET /api/v4/fitterhours`, `POST /api/v4/fitterhours/query` og V3 targeted fitterhours på samme projekter. | Først derefter kan labor actual flyttes fra unresolved til beregnet komponent. |
| Kan V4 erstatte actual materials/purchases? | Sammenlign `purchaseinvoicelines`, `purchaseorders/search` og `financialposts` mod V3 `TotalPOCost`/EK UI. | Hvis parity er god, kan material actual blive inkluderet i IGVA vægtet completion. |
| Kan `RemainingHours` beregnes moderne? | Verificer `hoursExpected`, budget timer, actual fitterhour rows og EK UI semantics. | Beregn kun som timerbaseret model; ikke som økonomisk residual. |
| Kan V4 forklare `Ongoing`, `Billed`, `Margin`, `Coverage`? | Sammenlign V4 expected/budget/financialposts/invoices mod V3 WIP og EK UI. | Enten beregn eksplicit med dokumenteret formel eller behold som source totals/unresolved. |

### REMOVE

| IGVA kilde/mapping | Fjernes fra POC-beregning | Hvorfor |
| --- | --- | --- |
| V3 `TotalLaborCost` som direkte actual labor | Ja, indtil bedre actual labor source er verificeret | Det er ikke persistet separat i normal Fielddesk read path, og V4 `totalLaborExp` må ikke bruges som actual. |
| V3 `TotalPOCost` som direkte actual material | Ja, indtil V4 purchase/financial parity er verificeret | Det er ikke persistet separat i normal Fielddesk read path. |
| V3 `RemainingHours` som beregnet eller autoritativ completion-felt | Ja, fra beregningen | POC viser det kun som unresolved metadata; det bør fortsætte sådan indtil timersemantik er verificeret. |
| Embedded project payloads som eneste moderne V4-antagelse | Ja, som fremtidig primær kilde | Efter denne audit er det forældet at antage, at IGVA kun kan bruge V4 project-list/detail subtrees. Dedicated budget/expected/history endpoints skal være næste model. |
| `project_wip.costs` som inkluderet component actual uden split | Ja, fortsat ekskluderet | Total actual uden komponentfordeling kan vises, men bør ikke indgå i labor/material weighted completion. |

IGVA POC'en er altså ikke "forkert" nu; den er forsigtigt ufuldstændig. Den eneste del, der allerede nu er baseret på en forældet antagelse, er at V4 budget/expected data kun behandles som project payload subtrees. Næste IGVA-opgave bør derfor opdatere datakildeplanen til dedicated V4 economy endpoints, men stadig bevare POC'ens unresolved-markeringer for actual labor, actual materials og remaining hours indtil read-only parity er gennemført.
## Anbefalet V3-retirement plan

Dette er en plan, ikke en implementering.

1. Gør `fitters` og `worksheets` V4-only i sync endpoint discovery, efter en smal tenant-smoke bekræfter samme payloadshape som docs.
2. Slå `users`, `invoices` og `purchaseinvoices` fra som default read-only endpoints, eller erstat dem med eksplicitte V4 endpoints med kendt produktformål.
3. Indfør en ny read-only V4 project-economy probe for:
   - `GET /api/v4/projects/budgets/{projectId}`
   - `GET /api/v4/projects/expectedvalues/latest/{projectId}`
   - `GET /api/v4/projects/expectedvalues/history/{projectId}`
4. Sammenlign for 5-10 repræsentative projekter:
   - gamle V3 WIP fields
   - V4 project expected values
   - V4 project budget
   - V4 financialposts/purchaseinvoicelines
   - V4/V3 fitterhours rows
5. Beslut ny `project_wip` semantics:
   - hvilke felter er direkte fra V4?
   - hvilke felter beregnes?
   - hvilke gamle V3 felter droppes?
6. Først derefter fjernes `projects_v3` fra runtime.
7. Behold V3 `fitterhours` indtil V4 row-level/all-time parity er verificeret og retention-modellen er opdateret.

## Docs der er forældede eller delvist forældede

Må ikke ændres i denne audit, men bør opdateres i en efterfølgende docs-PR:

- `backend/docs/integrations/ek/projects_v3_wip.md`: Delvist forældet fordi V4 nu har budget/expected-values endpoints, men stadig relevant om lifecycle-reglen.
- `backend/docs/audits/missing_business_semantics.md`: Delvist forældet på V4 endpoint-tilgængelighed, men stadig relevant om manglende aktiv writer/semantik for økonomifelter.
- `backend/docs/mappings/project_wip_mapping.md`: Delvist forældet, fordi nuværende `syncWorker` faktisk skriver `project_wip.is_work_in_progress`, men økonomifelterne har stadig ingen almindelig produktionswriter.
- `backend/docs/integrations/ek/fitterhours.md` og `fitterhours_retention_model.md`: Stadig relevante, men bør suppleres med ny V4 fitterhours/query smoke, fordi OpenAPI nu dokumenterer flere V4 fitterhours paths.

## Endelig vurdering

Svar på "kan V3 fjernes?": Nej, ikke fuldt ud endnu.

Svar på "er den gamle konklusion outdated?": Ja, delvist. V4 budget/expected-values/history gør den gamle antagelse om manglende V4 økonomikilder for snæver. Men den gamle forsigtighed om V3 som nødvendig for visse WIP/fitterhours-data er stadig berettiget, indtil payload-parity er verificeret.

Praktisk retirement-status:

- Fjern/erstat sandsynligvis: `fitters`, `worksheets`.
- Ryd op eller beslut produktformål: `users`, `invoices`, `purchaseinvoices`.
- Migrer efter V4 economy smoke: `projects_v3`.
- Behold midlertidigt: `fitterhours` og måske `fittercategories`, indtil V4-kilde og semantik er verificeret.
