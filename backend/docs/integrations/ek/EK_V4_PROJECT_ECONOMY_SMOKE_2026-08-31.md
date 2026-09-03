# E-Komplet V4 project economy smoke

Dato: 2026-08-31

Status: READ-ONLY smoke mod rigtig E-Komplet tenant. Ingen E-Komplet writes. Ingen POST, PUT, PATCH eller DELETE mod E-Komplet.

Tenant: `hoyrup-clemmensen`

Primært kontrolprojekt: `80396-003`

EK ProjectID: `25906`

Fielddesk project: `1f397d2b-14c6-4e78-b181-93c4b1efd3f5`

## Scope og begrænsninger

`verified`: Lokal `.env` pegede på en lokal DB på `127.0.0.1:55432`, men den database svarede ikke. Smoke-testen brugte derfor `backend/.env.production` til read-only DB metadata lookup og dekryptering af tenantens eksisterende EK API key. Secrets blev ikke printet.

`verified`: Projekt `80396-003` blev fundet via eksisterende tenant/integration setup som åbent V4-projekt med EK ProjectID `25906`.

`verified`: Følgende EK-kald blev udført som GET-only:

- `GET /api/v4/projects/id/25906`
- `GET /api/v4/projects/budgets/25906`
- `GET /api/v4/projects/expectedvalues/latest/25906`
- `GET /api/v4/projects/expectedvalues/history/25906`
- `GET /api/v4/financialposts?searchAttribute=ProjectID&search=25906&page=1&pageSize=1000`
- `GET /api/v4/purchaseinvoicelines?...` med flere ProjectID/ProjectReference-varianter
- `GET /api/v4/fitterhours?...` med flere ProjectID-varianter
- `GET /api/v4/paginatedfitterhours?...`
- `GET /api/v3.0/fitterhours?...searchAttribute=ProjectID&search=25906`
- `GET /api/v3.0/projects?...searchAttribute=ProjectID/ProjectReference...` som V3 parity reference

`not tested`: POST-baserede read/query endpoints blev ikke kaldt, fordi opgaven eksplicit forbød POST mod E-Komplet. Det gælder:

- `POST /api/v4/fitterhours/query`
- `POST /api/v4/purchaseorders/search`
- `POST /api/v4/purchaseinvoicelines/search`
- `POST /api/v4/financialposts/search`

## Endpoint smoke-resultat

`verified` for `80396-003`:

| Endpoint | Status | Resultat |
| --- | ---: | --- |
| `GET /api/v4/projects/id/25906` | 200 | 1 project row med `projectExpectedValues`, `projectBudget`, `fitterHours` |
| `GET /api/v4/projects/budgets/25906` | 200 | `successObjects` object med `projectBudget` og `projectExpectedValues` |
| `GET /api/v4/projects/expectedvalues/latest/25906` | 200 | `successObjects` array med 1 expected-values row |
| `GET /api/v4/projects/expectedvalues/history/25906` | 200 | `successObjects` array med 19 history rows |
| `GET /api/v4/financialposts?...ProjectID...` | 200 | 706 financial posts |
| `GET /api/v4/purchaseinvoicelines?...ProjectID/ProjectReference...` | 200 | 0 rows i alle GET-varianter |
| `GET /api/v4/fitterhours?...ProjectID...` | 200 | 742 rows, men ProjectID-filter blev ikke respekteret |
| `GET /api/v4/paginatedfitterhours?...ProjectID...` | 200 | Samme som V4 fitterhours GET |
| `GET /api/v3.0/fitterhours?...ProjectID=25906` | 200 | 538 rows, matcher projektet |
| `GET /api/v3.0/projects?...ProjectID/ProjectReference...` | 200 | 1 WIP row, matcher projektet |

## 80396-003 mod kendte UI-tal

### Omsætning

`verified`:

- UI realiseret omsætning: `4.383.492`
- V4 financialposts: account `1020 Fakturering`, value `-4.383.492`
- Fielddesk bør normalisere realized turnover som positivt beløb `4.383.492`

`verified`:

- UI forventet omsætning: `9.300.525`
- V4 project payload `projectExpectedValues.totalTurnOverExp`: `9.300.525`
- V4 latest endpoint `totalTurnOverExp`: `9.300.525`
- V4 budget endpoint `projectExpectedValues.totalTurnOverExp`: `9.300.525`

`verified`:

- Resterende forventet omsætning: `9.300.525 - 4.383.492 = 4.917.033`

### Materialer expected

`verified`:

- V4 project payload `projectExpectedValues.totalPurchases`: `3.030.260`
- V4 latest endpoint `totalPurchases`: `3.030.260`
- V4 budget endpoint `projectExpectedValues.totalPurchases`: `3.030.260`

Konklusion om screenshot-forskellen `3.030.260` / `3.030.525`:

- `verified`: API-værdien i alle tre V4-kilder er `3.030.260`.
- `unclear`: `3.030.525` blev ikke reproduceret via V4 API. Det kan være en UI-afrunding, et ældre screenshot eller en anden UI-sum, men API-smoken peger entydigt på `3.030.260` som aktuel expected purchases/material total.

### Expected material breakdown

`verified` fra `projectExpectedValues.creditorExpectedValues` på project payload og budget endpoint:

| Row | V4 identity | Expected |
| --- | --- | ---: |
| Sveistrup A/S | creditorID `139`, ref `45907000` | `570.000` |
| Siemens A/S | creditorID `135`, ref `44774477` | `564.200` |
| Sydkystens Sikring ApS | creditorID `366`, ref `29685121` | `330.000` |
| Lager/Bil-like bucket | creditorID `1`, creditorName `null`, ref `-1` | `100.000` |

`verified`:

- Sum af alle expected material breakdown rows inkl. null-creditor/ref `-1`: `2.860.848`
- Total expected materials: `3.030.260`
- `Uspecificeret = 3.030.260 - 2.860.848 = 169.412`

Konklusion:

- `Uspecificeret` er ikke en selvstændig creditor.
- `Uspecificeret` skal beregnes som residual:
  `unallocated_expected_materials = total_expected_materials - sum(expected_material_breakdown_rows)`
- Hvis expected total holdes fast og creditor rows justeres, skal `Uspecificeret` stige/falde automatisk.

### Lager/Bil

`verified`:

- V4 expected breakdown har en row med `creditorID=1`, `creditorName=null`, `creditorReference="-1"`, `budget=100.000`.
- Den row matcher UI-konceptet Lager/Bil bedre end en rigtig creditor.
- UI viser nu eksplicit `Lager/Bil` actual som `95.905`.

Konklusion:

- Lager/Bil må ikke mappes til leverandør.
- Fielddesk bør repræsentere den som `source_category = lager_bil` eller `provider_bucket = ek_null_creditor_ref_minus_1`.
- Den skal indgå i expected material breakdown før `Uspecificeret` beregnes.

`verified` fra V4 financialposts:

- `GET /api/v4/financialposts?searchAttribute=ProjectID&search=25906&page=1&pageSize=1000` returnerede `706` rows.
- Ingen row havde value `95.905` eller en to-row `2020`-kombination på præcis `95.905`.
- En nær row var RNTM ApS invoice `3676`, value `95.600`, account `2020`, type `Standard`, description `Timer HC , Spotter HC_køge`; den er en supplier/timer-like row og må ikke bruges som Lager/Bil.
- De eneste `ProjectPost` rows på kontrolprojektet var:

| Appendix | Target row | Source/counter row | Net på `80396-003` |
| --- | ---: | ---: | ---: |
| `212693` | `+66.825` på project `25906` / `80396-003` | `-66.825` på project `1394` / `99999` | `+66.825` |
| `212694` | `-133.650` på project `25906` / `80396-003` | `+133.650` på project `1394` / `99999` | `-133.650` |

`observed`:

- Appendix lookup viser source/destination for project transfers, men disse to ProjectPost rows netto `-66.825` på kontrolprojektet, ikke UI `Lager/Bil = 95.905`.
- `projects/id/25906`, `projects/budgets/25906`, `expectedvalues/latest/25906` og `expectedvalues/history/25906` udstiller ikke `95.905`, `1.956.829` eller en actual material total som eget felt.

Konklusion:

- Lager/Bil actual er ikke fundet som autoritativ GET-exposed V4 source row i denne audit.
- Det kan ikke dokumenteres, at `ProjectPost` alene producerer UI `Lager/Bil = 95.905`.
- Næste mapping-opgave skal enten have et EK endpoint/UI-export, der viser actual breakdown source rows, eller tilladelse til POST-baserede read/search endpoints, før `lager_bil` actual kan implementeres som andet end UI-observeret kontroltal.

### Creditor actuals via financialposts

`verified` fra V4 financialposts og `purchaseinvoicelines`, grupperet ved creditor:

| Creditor/source | V4 actual | UI-observation | Vurdering |
| --- | ---: | ---: | --- |
| Siemens A/S | `564.193` | ca. `564.193` | `verified 1:1` |
| Sveistrup A/S | `484.088,71` | ca. `484.073` | `near match`; API afviger ca. `15,71` |
| Sydkystens Sikring ApS | `0` | `0` | `verified 1:1` |

`observed`:

- V4 financialposts kan forklare creditor-level actuals for almindelige kreditorfakturaer.
- `purchaseinvoicelines` GET returnerede stadig 0 rows for direkte ProjectID/ProjectReference-varianter.
- `purchaseinvoicelines` GET virker via `PurchaseInvoiceID` for de invoice ids, der findes i financialposts.
- 225 `PurchaseInvoiceID`-opslag for relevante materialeposteringer returnerede `806` project lines; alle havde `igva=true`.
- Purchase-line sum ekskl. RNTM ApS var `1.860.896,66`.

### Total materials actual

UI observed total materials actual: `1.956.829`

`verified` V4 source data:

- Den tidligere smoke-sum `1.857.591,47` var faktura-only på `2020 Vareforbrug` ekskl. RNTM ApS.
- Parseren udelod Solar kreditnota `-424,87`.
- Korrekt `2020 Vareforbrug` supplier net ekskl. RNTM ApS, inkl. kreditnotaer, er `1.857.166,60`.
- Materiale-lignende purchase lines findes også på account `3880 Arbejdstøj m. moms`: `3.730,06`.
- `purchaseinvoicelines` via `PurchaseInvoiceID` bekræfter samme net: `1.857.166,60 + 3.730,06 = 1.860.896,66`.
- RNTM ApS summerer til `1.791.115` på purchase lines/account `2020`, men descriptions er `Timer HC` / `Spotter HC_køge`; de skal ikke klassificeres som materialer uden separat forretningsregel.

De tidligere manglende `ca. 3.332,53` består derfor ikke af én skjult materialerow:

| Difference-komponent | Beløb | Status |
| --- | ---: | --- |
| Konto `3880 Arbejdstøj m. moms`, Carl Ras A/S + LM | `+3.730,06` | `verified`, skulle med i creditor material actual |
| Solar kreditnota på account `2020` | `-424,87` | `verified`, tidligere faktura-only parser udelod den |
| Resterende difference efter corrected net + UI Lager/Bil | `+27,34` | `VERIFY`, ikke fundet som selvstændig materialerow |

Reconciliation efter korrigerede creditor rows og UI Lager/Bil:

```text
supplier_material_actual_net_excl_rntm = 1.860.896,66
ui_lager_bil_actual                  =    95.905,00
classified_total                     = 1.956.801,66
ui_material_actual_total             = 1.956.829,00
remaining_difference                 =        27,34
```

`observed` om de sidste `27,34`:

- Ingen FinancialPosts row eller purchase invoice line havde præcis value/price `27,34`.
- Carl Ras appendix `576036` har purchase lines `109,00 + 0,51 = 109,51`, all `igva=true`, account `3880`.
- Samme appendix har financialposts: `3880 = 109,51`, `9820 Indgående moms = 27,38`, creditor total `-136,89`.
- Hvis denne ene VAT row `27,38` medtages, bliver totalen `1.956.829,04`, som UI kan vise som `1.956.829` ved helkronevisning.
- Det er dog ikke verificeret, at EK UI medtager netop denne VAT row i Materialer actual; andre VAT rows på samme materialemodel medtages ikke i den simple formula.

Konklusion:

- Creditor-level material actual bør baseres på `purchaseinvoicelines` via invoice ids fra financialposts, ikke kun account `2020`.
- Kreditnotaer skal indgå med negativt fortegn.
- Account `3880` skal behandles som material actual for dette projekt, selv om den ikke er `2020 Vareforbrug`.
- Total actual materials er ikke endeligt 1:1 verificeret: corrected source rows + UI Lager/Bil efterlader `27,34`.
- `Uspecificeret actual` ser ud til at være residual. Med UI breakdown-totalen er residual `0`; med kun GET-verificerede V4 rows er residual `27,34`, indtil VAT/UI-category-sporet eller et actual breakdown endpoint bekræftes.
- Fielddesk må ikke gemme `Uspecificeret` som creditor. Den skal beregnes dynamisk:
  `unallocated_actual_materials = total_actual_materials - sum(actual_material_breakdown_rows)`.

### Labor/timer

`verified` from V4 expected values:

- `netLaborExp`: `1.182.800`
- `socialFeeExp`: `721.508`
- `totalLaborExp`: `1.904.308`
- `hoursExpected`: `0`

`verified` from V3 targeted fitterhours:

- Rows: `538`
- `BasisTotalHours`: `2.868`
- `SocialTaxes`: `516.385,05375`
- `BasisTotalCost`: `1.262.635,05375`
- `BasisHoursSocialCost`: `478.389,67875`
- Derived net labor actual: `BasisTotalCost - BasisHoursSocialCost = 784.245,375`
- This matches UI observed net labor actual `ca. 784.245` and social actual `ca. 516.385`.

`observed` from V4:

- V4 project detail `fitterHours` returned `538` rows and `hourSpent` sum `4.176,5`, but only sparse fields: `fitterHourID`, `projectID`, `worksheetID`, `fitterID`, `fitterCategoryID`, `date`, `approvedDate`, `billedDate`, `hourSpent`, `description`, `isBilled`, `projectCostCodeID`.
- V4 project detail does not include labor cost fields required to reproduce net labor/social actual.
- V4 `GET /api/v4/fitterhours` and `GET /api/v4/paginatedfitterhours` with ProjectID/search params returned 742 rows from a broader tenant interval and 0 rows with `projectID=25906`; ProjectID filtering was not respected in these GET variants.
- V4 POST query was not tested due the no-POST instruction.

Konklusion:

- Actual hours/cost cannot be made V4-only yet.
- V3 targeted fitterhours still gives the only verified source for UI-matching actual labor/timer cost in this smoke.
- Do not derive expected/remaining hours from kroner divided by historical hourly cost.
- `hoursExpected=0` in V4 expected values and V3 WIP for this project; `RemainingHours=-2868` in V3 WIP simply mirrors `0 - BasisTotalHours` for this case, but this should remain unresolved until EK hour semantics are documented.

## Expected history

`verified`:

- `GET /api/v4/projects/expectedvalues/history/25906` returned 19 rows.
- Rows include:
  - `id`
  - `createdDate`
  - `userName`
  - `note`
  - `totalTurnOverExpOld` / `totalTurnOverExp`
  - `totalPurchasesOld` / `totalPurchases`
  - `totalLaborExpOld` / `totalLaborExp`
  - `netLaborExpOld` / `netLaborExp`
  - `socialFeeExpOld` / `socialFeeExp`
  - `hoursExpectedOld` / `hoursExpected`
  - `projectPostsOld` / `projectPosts`

Examples:

| ID | Date | User | Note | Turnover old -> new | Purchases old -> new |
| ---: | --- | --- | --- | ---: | ---: |
| `62420` | `2026-08-12T20:46:11.67` | `DEP` | empty | `1.904.308 -> 9.300.525` | `1.904.308 -> 3.030.260` |
| `59234` | `2026-03-11T15:13:36.557` | `DEP` | `Jf. tilbudsbrev á 19. januar` | `3.220.000 -> 9.252.525` | `3.220.000 -> 2.900.000` |
| `60350` | `2026-05-07T08:58:16.053` | `DEP` | `jf. revideret tilbud pr. 5. maj 2026` | `3.220.000 -> 9.300.525` | `3.220.000 -> 2.900.000` |

`unclear`:

- The UI-observed turnover change `9.252.525 -> 9.300.525` was not reproduced as a single API row.
- The API history has an event creating `9.252.525` and later events creating `9.300.525`, but many `Old` fields appear to carry prior labor/purchase values rather than the immediately previous turnover value.
- Ordering appears newest-first in this payload.
- Retention and pagination are not documented by the observed response; this project returned all 19 rows in one `successObjects` array.

Konklusion:

- V4 history is usable as an import source for expected-value events, but Fielddesk must not blindly present EK `Old` fields as UI-exact history until parity is verified.
- Fielddesk should store imported EK history as provider events and also maintain its own canonical event stream.

## 8-project sample

`verified`: The three new V4 economy endpoints were tested across 8 projects.

| Project | EK ID | Latest | Budget | History | Notes |
| --- | ---: | --- | --- | --- | --- |
| `80396-003` | `25906` | 200, 1 row | 200, 1 object | 200, 19 rows | Main case, rich expected + creditors |
| `80229-001` | `29167` | 200, 1 row | 200, 1 object | 200, 4 rows | Matches old audit sample |
| `80256-003-005` | `26649` | 200, 1 row | 200, 1 object | 200, 8 rows | Has expected values |
| `33023` | `26474` | 200, 1 row | 200, 1 object | 200, 1 row | Zero expected values |
| `31660-002` | `26521` | 500 | 200, 1 object | 200, 0 rows | Latest endpoint can fail for some projects |
| `31660-003` | `26523` | 500 | 200, 1 object | 200, 0 rows | Latest endpoint can fail for some projects |
| `33003-026` | `26454` | 200, 1 row | 200, 1 object | 200, 1 row | Expected turnover only |
| `33075-001` | `26551` | 500 | 200, 1 object | 200, 0 rows | Latest endpoint can fail for some projects |

`observed`:

- `GET /projects/budgets/{projectId}` was the most robust endpoint in the sample; it returned an object even when `latest` returned 500.
- `GET /projects/expectedvalues/latest/{projectId}` is useful but not robust enough to be the only source without fallback/error handling.
- `GET /projects/expectedvalues/history/{projectId}` returns useful rows where history exists and 0 rows for some projects.

## Mapping matrix

| FD concept | V4 endpoint | V4 field/path | UI-verificeret | Confidence | Notes |
| --- | --- | --- | --- | --- | --- |
| project turnover actual | `GET /api/v4/financialposts` | account `1020 Fakturering`, `value` normalized positive | Ja | `verified` | `-4.383.492` -> `4.383.492` |
| project turnover expected | `GET /api/v4/projects/expectedvalues/latest/{projectId}` | `totalTurnOverExp` | Ja | `verified` | `9.300.525`; also present in project detail and budget endpoint |
| total materials actual | `GET /api/v4/financialposts` + `GET /api/v4/purchaseinvoicelines` via `PurchaseInvoiceID` | supplier lines on material accounts incl. `2020` + `3880`, excl. RNTM, plus Lager/Bil source | Delvist | `VERIFY` | Corrected supplier net `1.860.896,66`; with UI Lager/Bil `95.905` leaves `27,34` residual |
| total materials expected | `GET /api/v4/projects/expectedvalues/latest/{projectId}` or budget endpoint | `totalPurchases` | Ja | `verified` | API value `3.030.260` |
| creditor material actual | `GET /api/v4/purchaseinvoicelines` via `PurchaseInvoiceID` from financialposts | `Price`, `Creditor`, `FinancialAccount`, `Igva`; include kreditnota signs from postings | Ja for examples | `verified/likely` | Include `3880`; ProjectID direct GET returned 0, invoice-id path returned `806` lines |
| creditor material expected | `GET /api/v4/projects/budgets/{projectId}` | `projectExpectedValues.creditorExpectedValues[].budget` | Ja | `verified` | Dedicated budget endpoint includes creditor rows |
| Lager/Bil actual | Not found in GET-exposed V4 fields | UI bucket `95.905`; ProjectPost candidates tested separately | Nej | `VERIFY` | ProjectPost appendices `212693`/`212694` net `-66.825`, not `95.905`; do not map to creditor |
| Lager/Bil expected | `GET /api/v4/projects/budgets/{projectId}` | creditor row with `creditorName=null`, `creditorReference="-1"`, `budget=100000` | Ja | `verified` | Treat as source bucket, not creditor |
| unallocated/uspecificeret expected | computed in FD | `totalPurchases - sum(expected_material_breakdown)` | Ja | `verified` | `3.030.260 - 2.860.848 = 169.412` |
| unallocated/uspecificeret actual | computed in FD | `totalActualMaterials - sum(actual_material_breakdown)` | Delvist | `VERIFY` | UI says `0`; GET source reconstruction leaves `27,34` unless VAT/UI-category row is confirmed |
| labor actual | V3 targeted fitterhours currently | V3 aggregate `BasisTotalCost - BasisHoursSocialCost` | Ja | `verified via V3`, `V4 not enough` | V4 GET filter failed; V4 project detail lacks costs |
| labor expected | `GET /api/v4/projects/expectedvalues/latest/{projectId}` | `netLaborExp`, `socialFeeExp`, `totalLaborExp` | Ja | `verified` | `1.182.800`, `721.508`, `1.904.308` |
| actual hours | V3 targeted fitterhours currently | aggregate `BasisTotalHours` | Ja | `verified via V3`, `V4 unclear` | V4 detail `hourSpent=4.176,5`, not UI `2.868` |
| expected hours | V4 expected values | `hoursExpected` | Ja as zero | `verified value`, `unclear semantics` | Do not infer remaining hours from money |
| budget labor | `GET /api/v4/projects/budgets/{projectId}` | `projectBudget.projectBudgetCostResponseDTO.salaryTotal` | Ikke for this project | `VERIFY` | Main project has 0 budget fields but expected labor exists |
| budget materials | `GET /api/v4/projects/budgets/{projectId}` | `projectBudget.projectBudgetCostResponseDTO.materials` | Ikke for this project | `VERIFY` | Main project has 0 budget material but expected purchases exists |
| total budget | `GET /api/v4/projects/budgets/{projectId}` | `projectBudget.projectBudgetCostResponseDTO.total` / `expectedTotalCosts` | Ikke for this project | `VERIFY` | Dedicated endpoint robust, but project budget totals may be 0 |
| expected history | `GET /api/v4/projects/expectedvalues/history/{projectId}` | `successObjects[]` | Delvist | `verified source`, `old/new VERIFY` | API has rows, but old turnover did not match UI row exactly |
| user | history endpoint | `userName` | Ja | `verified` | e.g. `DEP`, `SOE`, `KIN`, `JGR` |
| timestamp | history endpoint | `createdDate` | Ja | `verified` | Newest-first observed |
| note | history endpoint | `note` | Ja | `verified` | Notes returned for several events |
| old value | history endpoint | `*Old` fields | Delvist | `VERIFY` | Present, but not always UI-sequential |
| new value | history endpoint | non-Old fields | Ja | `verified` | Latest values match expected snapshot |

## Canonical Fielddesk economy direction

E-Komplet must remain an external provider, not Fielddesk's permanent internal model.

Recommended architecture:

```text
External provider: E-Komplet
  -> tenant-scoped adapter/sync/probe
  -> canonical Fielddesk economy source tables/events
  -> derived Fielddesk economy model
  -> IGVA/calculation/UI
```

Recommended classification:

| V4 data | Import as source data | Materialize in FD | Compute in FD | Provider metadata |
| --- | --- | --- | --- | --- |
| `expectedvalues/latest` totals | Yes | Yes, latest expected snapshot | Remaining expected, deviations | EK source id/raw payload hash |
| `expectedvalues/history` rows | Yes | Yes, event stream | Derived deltas/rollups | EK event id/raw row |
| `budgets/{id}` budget object | Yes | Yes, budget snapshot + expected creditor rows | Budget envelopes/weights | EK budget id/raw snapshot |
| financialposts | Yes | Yes, normalized postings | turnover actual, creditor actuals, material actual categories | account numbers, EK posting ids |
| project detail `fitterHours` | Maybe | Only if used for sparse activity | activity dates/counts | EK fitterHour ids |
| V3 targeted fitterhours | Temporarily | Yes until V4 parity | actual labor/hours | V3 endpoint marker |
| V4 GET fitterhours | Not yet | No | None | keep smoke evidence only |

## History architecture recommendation

Fielddesk should not depend on EK history as its only history. Add a future canonical event model that can represent imported and native economy changes.

Conceptual event fields:

- `tenant_id`
- `project_id`
- `source_provider`
- `source_event_id`
- `category`
- `entity_type`
- `entity_reference`
- `old_value`
- `new_value`
- `delta`
- `actor_source`
- `actor_display`
- `occurred_at`
- `note`
- `derived_from_event_id`
- `metadata`
- `source_payload_hash`

Event categories should support:

- imported EK expected-value history
- native Fielddesk changes
- Kalkia-derived changes
- project-manager completion changes
- future resource forecast changes
- system-derived recalculations

## IGVA impact

### KEEP

| Mapping/data | Why |
| --- | --- |
| Conservative unresolved actual labor/material handling | Still correct. V4 did not fully replace actual labor/material in this smoke. |
| `totalLaborExp`, `netLaborExp`, `socialFeeExp` as expected labor | V4 latest/budget/project payload all match UI. |
| `totalTurnOverExp` as expected turnover | V4 latest/budget/project payload all match UI. |
| `totalPurchases` as expected materials | V4 latest/budget/project payload all match UI at `3.030.260`. |
| `RemainingHours` unresolved | V4 and V3 show `hoursExpected=0`; no safe hours forecast semantics. |

### REPLACE

| Current POC source | Replace with | Why |
| --- | --- | --- |
| Embedded project `projectExpectedValues` as primary source | `GET /api/v4/projects/expectedvalues/latest/{projectId}` with budget endpoint fallback | Latest endpoint is explicit, but has 500s for some projects, so fallback is needed. |
| Embedded project `projectBudget` as primary source | `GET /api/v4/projects/budgets/{projectId}` | Budget endpoint includes `projectBudget` and `projectExpectedValues`, including creditor expected rows. |
| No expected history in POC | Imported events from `GET /api/v4/projects/expectedvalues/history/{projectId}` | Endpoint returns user/date/note/old/new fields and can feed canonical FD events. |

### VERIFY

| Mapping/data | What to verify next |
| --- | --- |
| Actual materials total | Verify the remaining `27,34`: either confirm Carl Ras appendix `576036` VAT row `27,38` is UI-included, or find the missing actual breakdown source. |
| Lager/Bil actual | Identify exact source for UI `95.905`; current GET evidence rejects direct `ProjectPost` net and RNTM `95.600` as safe matches. |
| Actual labor V4-only | Test `POST /api/v4/fitterhours/query` only if POST-read is approved later; GET variants did not filter by project. |
| V4 project detail hours | `hourSpent=4.176,5` does not equal UI actual hours `2.868`; document/verify semantics before use. |
| History old/new | API history rows exist, but UI change `9.252.525 -> 9.300.525` was not reproduced as a single row. |
| Budget fields | Main project budget cost/sales fields are 0 while expected values are populated; test projects with real budget lines before using budget fields for weighting. |

### REMOVE

| Mapping/data | Why |
| --- | --- |
| V4 `totalPurchases` as actual materials | It is expected purchases/materials, not actual. |
| V4 `totalLaborExp` as actual labor | It is expected labor, not actual. |
| Remaining hours derived from money/hourly cost | Forbidden by requirement and not supported by payload semantics. |
| Treating `creditorName=null/ref=-1` as a supplier | This is Lager/Bil-like source bucket, not creditor. |

## V3 retirement impact after smoke

| V3 dependency | Status | Why |
| --- | --- | --- |
| `projects_v3` | `REPLACE_AFTER_MAPPING` | V4 covers expected economy and lifecycle, but V3 WIP still has direct `Billed`, `Costs`, `Ongoing`, `TotalPOCost`, `RemainingHours`. Replace only after canonical economy mapping decides what to keep/compute/drop. |
| `fitterhours` | `KEEP_TEMPORARILY` | V3 targeted fitterhours is still the only verified source matching UI actual hours/labor cost for 80396-003. |
| `fitters` | `REPLACE_NOW` | No new blocker; V4 fitters already documented/verified elsewhere. |
| `worksheets` | `REPLACE_NOW` | No new blocker; V4 worksheets remain source for access. |
| `invoices` | `REPLACE_AFTER_MAPPING` | V4 financialposts can reproduce turnover actual, but invoice model should be canonicalized before removing all legacy assumptions. |
| `purchaseinvoices` | `REPLACE_AFTER_MAPPING` | Direct ProjectID GET returned 0, but `purchaseinvoicelines` via `PurchaseInvoiceID` from financialposts returned project material lines. Needs canonical invoice-id bridge before retirement. |
| `fittercategories` | `UNKNOWN` | Not resolved by this project economy smoke. |
| `users` | `REMOVE` or `UNKNOWN` | No project economy need found. If no other product use, remove as read-only endpoint; otherwise decide separately. |

## Final smoke answer

1. V4 ramte de kendte UI-tal for expected turnover, expected materials, expected labor and turnover actual. V4 ramte creditor actuals for Siemens and near-matched Sveistrup.
2. 1:1 matches: turnover expected `9.300.525`, turnover actual `4.383.492`, remaining turnover `4.917.033`, total expected materials `3.030.260`, Siemens expected/actual, Sydkystens expected/actual, net/social labor expected.
3. Composition required: total actual materials, Lager/Bil actual, turnover actual sign normalization, remaining expected amounts; creditor actuals are now stronger via purchase invoice lines bridged from financialposts.
4. Expected Uspecificeret beregnes som `totalPurchases - sum(creditorExpectedValues budgets including Lager/Bil/null-creditor row) = 169.412`; actual Uspecificeret should also be residual, and UI shows `0`.
5. Lager/Bil repræsenteres som provider-specific source/category, not creditor: V4 expected row `creditorName=null`, `creditorReference=-1`, `budget=100.000`.
6. Actual materials er korrigeret til `1.860.896,66` supplier net ekskl. RNTM plus UI Lager/Bil `95.905`, hvilket efterlader `27,34`; Carl Ras appendix `576036` VAT `27,38` is a concrete but not yet canonical UI-inclusion candidate.
7. Actual labor kan ikke beregnes sikkert V4-only endnu; V3 targeted fitterhours matcher UI.
8. Expected history indeholder 19 rows med user/date/note/old/new fields, men old/new turnover skal verificeres yderligere mod UI.
9. RemainingHours er stadig usikkert og skal ikke bruges som økonomisk sandhed.
10. V3-afhængigheder der kan fjernes nu: ingen nye direkte fra denne smoke ud over tidligere `fitters`/`worksheets` vurdering. `fitterhours` skal beholdes midlertidigt.
11. Næste IGVA-opgave bør flytte expected/budget/history til dedicated V4 endpoints, indføre canonical FD economy/event model, beholde unresolved actuals, og bygge financialposts category mapping før actual materials/labor indgår i weighted completion.





## Follow-up scope: V4 fitterhours and labor actual

`verified`: Denne follow-up er stadig read-only mod E-Komplet. Ingen E-Komplet writes. Ingen IGVA-kodeændringer. Det eneste POST-kald i follow-up'en var `POST /api/v4/fitterhours/query`, testet som read-only søgning, fordi OpenAPI beskriver endpointet som "Søg i timeregistreringer".

`verified`: OpenAPI for `POST /api/v4/fitterhours/query` dokumenterer ingen JSON request body. Den dokumenterede kontrakt er query parameters: `id`, `fromDate`, `toDate`, `page`, `pageSize`, `searchAttribute`, `search`, `delta`, `updatedAfter`. `searchAttribute` er reserveret/ikke aktivt brugt i de relaterede V4 GET endpoints.

`verified`: Følgende read-only query-varianter blev testet mod kontrolprojekt `25906` / `80396-003`:

- `POST /api/v4/fitterhours/query?search=25906&page=1&pageSize=1000&fromDate=2020-01-01&toDate=2026-12-31`
- `POST /api/v4/fitterhours/query?search=80396-003&page=1&pageSize=1000&fromDate=2020-01-01&toDate=2026-12-31`
- `POST /api/v4/fitterhours/query?searchAttribute=ProjectID&search=25906&page=1&pageSize=1000&fromDate=2020-01-01&toDate=2026-12-31`
- samme ProjectID-variant med tom JSON body `{}`
- en spekulativ body-filter variant med `filters: [{ field: "ProjectID", value: "25906" }]`

`observed`: Alle POST-query-varianter returnerede HTTP `200`, men EK payload havde `hasErrors=true`, ingen brugbare rows, og EK-side fejl `ArgumentNullException: Value cannot be null. (Parameter 'source')` fra `FitterHourQueries.GetAllWithFilters`.

`not verified`: 3-5 ekstra live projektprøver blev ikke udført i denne follow-up. Auto-review blokerede den ekstra scope-udvidelse uden særskilt eksplicit godkendelse. Eksisterende repo-dokumentation har dog allerede bredere V4 project-detail fitterhours-verifikation for aktivitet/refresh, og hovedkonklusionen for økonomi er ikke afhængig af ekstra prøver, fordi V4 project detail mangler cost/social felter.

## FITTERHOURS RECONCILIATION

`verified` for kontrolprojekt `80396-003` / EK ProjectID `25906`:

| Source | Rows | Timer/sum | Vurdering |
| --- | ---: | ---: | --- |
| V3 targeted `GET /api/v3.0/fitterhours?searchAttribute=ProjectID&search=25906` | `538` | `BasisTotalHours = 2.868` | Matcher UI actual hours |
| V3 targeted samme rows | `538` | `Hours = 4.176,5` | Matcher V4 project-detail `hourSpent` |
| V3 targeted samme rows | `538` | `FitterHourWorkTypeOtherTotalHours = 1.308,5` | Forklarer forskellen mellem raw hours og basis/UI hours |
| V4 project detail `GET /api/v4/projects/id/25906` | `538` | `hourSpent = 4.176,5` | Samme row-identitet som V3, men ikke UI actual hours |
| V4 GET `/api/v4/fitterhours` med ProjectID/search | `742` page-1 rows fra bredere tenant-sæt | `3.677,3` page-1 hours | ProjectID-filter ikke respekteret |
| V4 POST `/api/v4/fitterhours/query` | `0` brugbare rows | n/a | EK-side query-fejl |

`verified`: V3 targeted og V4 project detail har samme `538` `FitterHourID`-identiteter for kontrolprojektet: `common=538`, `onlyV3=0`, `onlyV4=0`. Forskellen er derfor ikke dubletter eller manglende row coverage.

`verified`: Forklaringen på `V4 hourSpent = 4.176,5` vs. `V3/UI BasisTotalHours = 2.868` er:

```text
V4 project detail hourSpent = V3 Hours = 4.176,5
V3/UI actual hours          = V3 BasisTotalHours = 2.868,0
Difference                  = 1.308,5
V3 other work type hours    = FitterHourWorkTypeOtherTotalHours = 1.308,5
```

`observed`: V3 rows med difference mellem `Hours` og `BasisTotalHours` ligger i andre/ikke-basis worktype-bidrag. De tæller med i raw `Hours`/V4 `hourSpent`, men ikke i UI actual hours/BasisTotalHours.

`verified`: V4 project detail `fitterHours` er en sparsom embedded liste med felter som `fitterHourID`, `projectID`, `worksheetID`, `fitterID`, `fitterCategoryID`, `date`, `approvedDate`, `billedDate`, `hourSpent`, `description`, `isBilled`, `projectCostCodeID`. Den indeholder ikke de økonomifelter, der skal bruges til UI actual hours/labor/social.

Konklusion:

- V4 project detail kan bruges til projekt-scoped row identity, aktivitet og raw `hourSpent`.
- V4 project detail må ikke bruges som Fielddesk/IGVA actual hours, fordi `hourSpent` er V3 `Hours`, ikke V3/UI `BasisTotalHours`.
- V4 GET `/fitterhours` og V4 POST `/fitterhours/query` er ikke verified project-scoped økonomikilder i denne audit.
- V3 fitterhours retirement answer: `PARTIALLY` samlet set, men `NO` for economy/IGVA actual hours. V4 kan erstatte nogle project-detail/refresh-behov, men V3 targeted fitterhours er stadig nødvendig for UI-paritet på `BasisTotalHours`.

## LABOR ACTUAL RECONCILIATION

`verified` expected labor fra V4 expected values for `80396-003`:

| Concept | V4 field | Value |
| --- | --- | ---: |
| Expected net labor | `projectExpectedValues.netLaborExp` | `1.182.800` |
| Expected social fee | `projectExpectedValues.socialFeeExp` | `721.508` |
| Expected total labor | `projectExpectedValues.totalLaborExp` | `1.904.308` |

`verified`: De samme expected labor values findes via dedicated V4 expected/budget endpoints og matcher UI-observationen. IGVA bør derfor flytte expected labor til dedicated V4 endpoints, ikke bruge project payload som primær kilde.

`verified` actual labor/social via V3 targeted fitterhours:

| Concept | Formula/source | Value | UI parity |
| --- | --- | ---: | --- |
| Actual hours | `sum(BasisTotalHours)` | `2.868` | Matcher UI `2.868` |
| Actual gross/basis labor cost | `sum(BasisTotalCost)` | `1.262.635,05375` | EK legacy source |
| Actual net labor | `sum(BasisTotalCost) - sum(BasisHoursSocialCost)` | `784.245,375` | Matcher UI ca. `784.245` |
| Actual social additions | `sum(SocialTaxes)` | `516.385,05375` | Matcher UI ca. `516.385` |

`observed`: V4 OpenAPI beskriver en rig fitterhours model med `basisTotalHours`, `basisTotalCost`, `basisHourSocialCosts`, `socialTaxes`, `socialTaxesInPercent` og `fitterHourWorkTypeOtherTotalHours`. Den model er dog ikke opnået project-scoped i denne audit: GET filtrerer ikke korrekt, POST query fejler, og project detail returnerer kun sparse rows.

`verified`: Social actual skal ikke beregnes fra expected `socialFeeExp` og ikke fra V4 `hourSpent`. Den eneste UI-paritetsformel i denne audit er V3 targeted:

```text
actual_hours          = sum(V3.BasisTotalHours)
actual_labor_net      = sum(V3.BasisTotalCost) - sum(V3.BasisHoursSocialCost)
social_additions      = sum(V3.SocialTaxes)
actual_labor_total_ui = actual_labor_net + social_additions
```

`unclear`: EKs interne forskel mellem `BasisHoursSocialCost` og `SocialTaxes` kræver leverandørdokumentation, før Fielddesk må omskrive social-modellen. Audit-resultatet er dog stærkt nok til at sige, at V4 project detail ikke er tilstrækkelig.

Konklusion:

- Actual labor kan ikke beregnes sikkert V4-only endnu.
- V3 targeted fitterhours er stadig den eneste verificerede kilde til UI-paritet for actual hours, net labor og social additions på kontrolprojektet.
- `RemainingHours` skal fortsat være unresolved: `hoursExpected=0` i V4/V3 WIP, og `RemainingHours=-2868` er her blot `0 - BasisTotalHours`, ikke en selvstændig forecast-sandhed.

## Actual materials correction

`verified`: Den tidligere actual-materials analyse skal ikke genstartes her, men én fortolkning skal korrigeres: `Lager/Bil` er en material source/economic bucket inden for Materialer actual, ikke et beløb der blindt skal lægges oven på en total, hvis totalen allerede er en breakdown/export-sum.

`verified` fra brugerens nye UI/export-facit:

```text
EK material actual UI total / target = 1.956.829,00
EK purchase/material export total    = 1.956.801,43
remaining UI/export difference       =        27,57
UI Lager/Bil bucket                  =    95.905,00
```

`observed`: Den gamle smoke forklarer stadig de vigtige komponenter i den tidligere `ca. 3.332,53` difference: konto `3880 Arbejdstøj m. moms` `+3.730,06` og Solar kreditnota `-424,87`. Men `Lager/Bil` må i den fremtidige Fielddesk-model gemmes som bucket/source classification, ikke som creditor og ikke som dobbelt addition over en allerede klassificeret materialetotal.

`VERIFY`: Den sidste difference er nu `27,57` mod UI-totalen. Carl Ras appendix `576036` har en konkret VAT-kandidat på `27,38`, men auditten har ikke bevist en generel regel om at medtage moms i Materialer actual. VAT-sporet skal derfor stå som `VERIFY`, ikke som implementeringsregel.

## IGVA IMPACT

| EK mapping | Source endpoint | Status | Mapping | Confidence | IGVA may use now |
| --- | --- | --- | --- | --- | --- |
| `actual_materials` | `GET /api/v4/financialposts` + `GET /api/v4/purchaseinvoicelines` via invoice ids | `VERIFY` | Sum classified material actual source rows; include credit notes; include material accounts beyond `2020` such as `3880`; preserve source bucket separately | `partial` | `NO` for final IGVA weight until `27,57` residual/source category is resolved |
| `actual_hours` | V3 targeted `/api/v3.0/fitterhours?searchAttribute=ProjectID&search=<EK ProjectID>` | `KEEP` temporarily | `sum(BasisTotalHours)` | `verified via V3` | `YES`, but only as explicit legacy bridge, not V4-modern source |
| `actual_labor` | V3 targeted fitterhours | `KEEP` temporarily | `sum(BasisTotalCost) - sum(BasisHoursSocialCost)` | `verified via V3` | `YES`, but only as explicit legacy bridge; `NO` as V4-only mapping |
| `social_additions` | V3 targeted fitterhours | `KEEP` temporarily | `sum(SocialTaxes)` | `verified via V3` | `YES`, but only as explicit legacy bridge; do not derive from expected social fee |
| `Lager/Bil actual` | Not found as exact authoritative V4 row in GET/project-detail sources | `VERIFY` | UI bucket `95.905`; should become `source_type=internal_material`/`lager_bil` when exact V4 source rows are found | `UI observed, source unresolved` | `NO`; may display as observed control value only |
| `Lager/Bil expected` | `GET /api/v4/projects/budgets/{projectId}` | `KEEP` | `creditorExpectedValues` row with `creditorName=null`, `creditorReference="-1"`, budget `100.000` | `verified` | `YES`, as bucket, not creditor |
| `expected_materials` | `GET /api/v4/projects/expectedvalues/latest/{projectId}` with `budgets/{projectId}` fallback | `REPLACE` | `totalPurchases` | `verified` | `YES` |
| `expected_labor` | `GET /api/v4/projects/expectedvalues/latest/{projectId}` with `budgets/{projectId}` fallback | `REPLACE` | `netLaborExp`, `socialFeeExp`, `totalLaborExp` | `verified` | `YES` |
| `expected_history` | `GET /api/v4/projects/expectedvalues/history/{projectId}` | `REPLACE` | Import raw EK events with `id`, `createdDate`, `userName`, `note`, old/new value fields | `verified source`, `old/new UI sequence VERIFY` | `YES` for raw event import; `VERIFY` before UI-exact delta display |
| `RemainingHours` | V3 WIP / V4 expected values | `REMOVE` from IGVA economy truth | Do not use as weighted-completion input; for this project it mirrors `hoursExpected - BasisTotalHours = 0 - 2868` | `unresolved` | `NO` |
| V4 project detail `fitterHours.hourSpent` as actual hours | `GET /api/v4/projects/id/{projectId}` | `REMOVE` | Do not map to UI actual hours; it equals V3 raw `Hours`, not `BasisTotalHours` | `verified mismatch` | `NO` |

### KEEP

- Keep IGVA POC's conservative unresolved treatment for actual materials/labor where it requires modern V4-only truth.
- Keep V4 expected fields `totalPurchases`, `netLaborExp`, `socialFeeExp`, `totalLaborExp`, `totalTurnOverExp` as valid expected economy inputs.
- Keep `Lager/Bil` as a separate material bucket/source type, never as a creditor.
- Keep `Uspecificeret` as computed residual, never as creditor.

### REPLACE

- Replace project-payload-first expected mappings with dedicated V4 endpoints:
  - `GET /api/v4/projects/expectedvalues/latest/{projectId}` for latest expected snapshot.
  - `GET /api/v4/projects/budgets/{projectId}` for robust fallback and creditor/bucket expected rows.
  - `GET /api/v4/projects/expectedvalues/history/{projectId}` for expected history events.
- Replace any IGVA use of `projectExpectedValues` embedded in `/projects/id` as primary source with dedicated endpoint reads plus fallback logic.
- Replace material actual parsing that only sums `2020 Vareforbrug` with a classified source-row model including credit notes and material-related accounts such as `3880`.

### VERIFY

- Verify exact V4 source rows for `Lager/Bil actual = 95.905`.
- Verify the remaining material actual residual `27,57`; Carl Ras VAT `27,38` is a candidate, not a rule.
- Verify whether EK can expose project-scoped rich V4 fitterhours rows with `basisTotalHours`, `basisTotalCost`, `basisHourSocialCosts`, and `socialTaxes`; current GET/POST paths did not.
- Verify history `Old` fields before displaying EK history as UI-exact sequential changes.
- Verify budget `materials`/`salaryTotal` fields on projects where budget lines, not expected values, are the intended economy source.

### REMOVE

- Remove any assumption that V4 `hourSpent` equals UI actual hours.
- Remove any assumption that `totalLaborExp`, `netLaborExp`, `socialFeeExp`, or `totalPurchases` are actuals; they are expected values.
- Remove any assumption that `RemainingHours` is a reliable economy input for IGVA.
- Remove any mapping that treats `creditorName=null` / `creditorReference=-1` as a supplier.
- Remove any IGVA path that stores `Uspecificeret` as a standalone creditor row.

## Canonical Fielddesk economy model recommendation

Fielddesk bør skille EK source data, Fielddesk canonical events og beregnede økonomital ad:

```text
EK source snapshots/events
  -> tenant-scoped EK adapter
  -> canonical FD economy source rows/events
  -> derived FD economy snapshot
  -> IGVA/UI/calculators
```

Recommended canonical concepts:

| FD concept | Canonical source | Derived rule |
| --- | --- | --- |
| `expected_materials_total` | V4 expected latest/budget | `totalPurchases` |
| `expected_material_breakdown` | V4 budget/expected creditor rows | creditor rows plus bucket rows; `Lager/Bil` as bucket |
| `expected_materials_unallocated` | FD computed | total minus expected breakdown |
| `actual_material_source_rows` | V4 financialposts + invoice-line bridge | normalized signed rows with account, creditor, appendix, source bucket, VAT/correction flags |
| `actual_materials_total` | classified actual source rows | must reconcile to UI total; no near-enough mapping |
| `actual_materials_unallocated` | FD computed | total minus classified breakdown; UI control currently `0`, API/export residual `27,57` unresolved |
| `actual_hours_basis` | V3 targeted fitterhours until V4 parity | `sum(BasisTotalHours)` |
| `actual_hours_raw` | V4 project detail or V3 targeted | `sum(hourSpent)` / `sum(Hours)` for activity only |
| `actual_labor_net` | V3 targeted fitterhours until V4 parity | `sum(BasisTotalCost) - sum(BasisHoursSocialCost)` |
| `actual_labor_social` | V3 targeted fitterhours until V4 parity | `sum(SocialTaxes)` |
| `expected_history_events` | V4 expectedvalues history | import raw provider events, then derive UI deltas only after parity verification |

Important modelling rule for materials:

- Preserve both original creditor/source and current economic bucket.
- `Lager/Bil` can originate from purchases, warehouse, van, main project, another project or correction flow, but the project economy bucket must be `internal_material`/`lager_bil`, not the original creditor.
- `Uspecificeret` is a residual calculation over the current model state.

## Follow-up final answer

1. V4 can reproduce expected labor/material/turnover through dedicated expected/budget endpoints, but cannot yet reproduce UI actual hours/labor/social V4-only.
2. `POST /api/v4/fitterhours/query` has no documented request body and failed as a usable project-scoped query with EK `ArgumentNullException` despite HTTP 200.
3. `V4 project detail hourSpent=4.176,5` equals V3 raw `Hours`, while UI actual hours `2.868` equals V3 `BasisTotalHours`; the difference `1.308,5` equals V3 other work type hours.
4. Actual labor UI parity is still V3 targeted: net labor `784.245,375` from `BasisTotalCost - BasisHoursSocialCost`, social additions `516.385,05375` from `SocialTaxes`.
5. V3 fitterhours retirement answer is `PARTIALLY` overall, but `NO` for IGVA/economy actuals until V4 exposes project-scoped rich fitterhours rows or another authoritative labor actual endpoint.
6. IGVA should replace project-payload expected mappings with dedicated V4 expected/budget/history endpoints now.
7. IGVA should keep actual_materials, Lager/Bil actual, actual_hours, actual_labor and social_additions behind `VERIFY`/legacy-bridge status rather than pretending they are modern V4-complete.
8. The canonical FD model should store EK provider source rows/events separately from derived economy totals, with material buckets, residuals, expected snapshots/history and labor actual bridge clearly separated.