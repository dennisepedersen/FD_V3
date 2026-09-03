# EK V4 material actual parity

Dato: 2026-09-01

Status: READ-ONLY parity audit. Ingen E-Komplet writes. Ingen production writes. Ingen migrations. Ingen deploy.

Tenant: `hoyrup-clemmensen`

Referencecase: `80396-003`

## Scope

`verified`: Lokal POC-database `fielddesk_v3_igva_poc` indeholdt 62 projekter for tenantens lokale seed, alle med `responsible_code=DEP`.

`verified`: Non-DEP kandidater blev derfor fundet via read-only E-Komplet V4/V3 GET-kald. Der blev ikke skrevet til E-Komplet eller production.

`verified`: For `80396-003` findes et stærkere UI-facit end V3 WIP:

```text
EK UI Materialer actual             = 1.956.829,00
EK purchase/material export total   = 1.956.801,43
UI/export residual                  =        27,57
UI Lager/Bil actual bucket          =    95.905,00
```

`observed`: Live V3 `TotalPOCost` for `80396-003` returnerede `3.682.387,13`. Det matcher ikke EK UI Materialer actual `1.956.829,00` og må derfor ikke bruges som direkte IGVA material actual på denne case.

## Method

Authoritative total blev valgt sådan:

1. For `80396-003`: EK UI-observeret Materialer actual `1.956.829,00`.
2. For øvrige projekter: V3 WIP `TotalPOCost` som bedste tilgængelige project economy total, men med `VERIFY` status fordi der ikke forelå screenshot/UI-facit for hver case.

Reconstruction blev testet sådan:

```text
reconstructed_material_actual =
  sum(V4 financialposts material accounts)
  minus likely timelike/labor rows
```

Material accounts i denne audit:

- `2020 Vareforbrug`
- `3880 Arbejdstøj m. moms`
- `2030 Vareforbrug EU moms/varer` blev observeret på `80279-003`, men er stadig account-mapping `VERIFY`.

For `80396-003` bruges den tidligere verifierede purchase/material export total som den bedste reconstruction, fordi financialposts alene ikke finder Lager/Bil-bucketten korrekt.

## Parity Table

| Project | Responsible | EK authoritative actual | Reconstructed | Diff kr. | Diff % | Explanation | Status |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| `80396-003` | DEP | `1.956.829,00` | `1.956.801,43` | `27,57` | `0,0014 %` | UI/export residual. Carl Ras VAT `27,38` er konkret kandidat, men ikke bevist generel regel. | `VERIFY_SMALL_RESIDUAL` |
| `80548` | DEP | `778.214,48` | `778.227,89` | `-13,41` | `0,0017 %` | V4 financialposts account `2020` matcher V3 `TotalPOCost` med lille residual. | `VERIFY_SMALL_RESIDUAL` |
| `80396-006-001` | DEP | `74.808,21` | `74.811,67` | `-3,46` | `0,0046 %` | Lille residual; sandsynlig rounding/timing, ikke bevist. | `VERIFY_SMALL_RESIDUAL` |
| `80440` | DEP | `1.327,78` | `1.327,46` | `0,32` | `0,0241 %` | Lille residual; sandsynlig rounding, ikke bevist. | `VERIFY_SMALL_RESIDUAL` |
| `80279-003` | DEP | `1.105.437,09` | `1.112.259,38` | `-6.822,29` | `0,6172 %` | Account `2030 Vareforbrug EU moms/varer` og/eller moms/account mapping kræver verifikation. | `VERIFY_RESIDUAL` |
| `38157` | CJ | `46.772,36` | `46.772,36` | `0,00` | `0,0000 %` | V4 financialposts account `2020` matcher V3 `TotalPOCost` 1:1. | `VERIFY_MATCH` |
| `38155` | KSA | `238,95` | `0,00` | `238,95` | `100,0000 %` | V3 har material total, men V4 financialposts returnerede 0 rows. Manglende source/bucket eller endpoint-timing. | `VERIFY_RESIDUAL` |
| `80288-001-004` | ELB | `93.817,00` | `93.817,00` | `0,00` | `0,0000 %` | V4 financialposts account `2020` matcher V3 `TotalPOCost` 1:1. | `VERIFY_MATCH` |

## DEP vs non-DEP

### DEP projects

| Metric | Value |
| --- | ---: |
| Antal projekter | `5` |
| Gennemsnitlig difference | `1.373,41 kr.` |
| Median difference | `13,41 kr.` |
| Max difference | `6.822,29 kr.` |
| Gennemsnitlig difference % | `0,1298 %` |
| Under 10 kr. | `2` |
| Under 100 kr. | `4` |
| Over 100 kr. | `1` |

### Non-DEP projects

| Metric | Value |
| --- | ---: |
| Antal projekter | `3` |
| Gennemsnitlig difference | `79,65 kr.` |
| Median difference | `0,00 kr.` |
| Max difference | `238,95 kr.` |
| Gennemsnitlig difference % | `33,3333 %` |
| Under 10 kr. | `2` |
| Under 100 kr. | `2` |
| Over 100 kr. | `1` |

Konklusion: Mønsteret er ikke DEP-specifikt. DEP har både små residualer og en stor account-mapping case (`80279-003`). Non-DEP har både 1:1 matches og en lille sag hvor V4 financialposts ikke returnerede material rows.

## Difference Classification

| Pattern | Projects | Evidence | Status |
| --- | --- | --- | --- |
| 1:1 financialposts material account parity | `38157`, `80288-001-004` | V4 `2020` sum = V3 `TotalPOCost`. | `verified for sample` |
| Small residual under 100 kr. | `80396-003`, `80548`, `80396-006-001`, `80440` | Differences `0,32` to `27,57`. | `VERIFY`, not enough to declare generic rounding rule |
| Account mapping residual | `80279-003` | V4 includes `2030 Vareforbrug EU moms/varer`; total differs by `6.822,29`. | `VERIFY` |
| Missing V4 financialposts rows | `38155` | V3 `TotalPOCost=238,95`, V4 financialposts rows `0`. | `VERIFY` |
| Lager/Bil/internal bucket | `80396-003` | UI bucket `95.905`; GET financialposts ProjectPost net does not prove exact source. | `VERIFY` |
| VAT/moms candidate | `80396-003`, possibly `80279-003` | Carl Ras VAT `27,38` is close to UI/export residual `27,57`; not a general rule. | `VERIFY` |

## Weighted Completion Impact

For `80396-003`, using the known UI actual material total:

```text
Actual materials     = 1.956.829
Expected materials   = 3.030.260
Material completion  = 64,58 %

Actual labor total   = ca. 1.300.631
Expected labor       = 1.904.308
Labor completion     = ca. 68,30 %

Weighted completion including labor + materials:
(1.300.631 + 1.956.829) / (1.904.308 + 3.030.260)
= 66,01 %
```

POC'ens labor-only completion for samme input er ca. `68,30 %`. Materials ændrer altså expected weighted completion til ca. `66,01 %`. Det er økonomisk væsentligt og bør med, når material actual-totalen er verified.

## Kontoudtog / Financial Extract

Repository indeholder ikke et separat kontoudtog/export med alle +/- posteringer for denne parity-sample.

Et senere EK-kontoudtog bør mindst indeholde:

- dato
- appendix/voucher
- konto og kontonavn
- projekt-ID og projektreference
- creditor/leverandør
- debit/credit eller signed value
- net, VAT/moms og total
- description/text
- posting type/source type
- purchase invoice id / purchase order id
- source project / target project for interne flytninger
- EK UI bucket/category hvis tilgængelig, fx `Lager/Bil`

Kontoudtoget vil især kunne forklare `80396-003` residual `27,57`, `80279-003` account/VAT residual og `38155` hvor financialposts ikke returnerede rows.

## Recommended IGVA Rule

`verified`: Breakdown parity behøver ikke være 100,00 %, hvis Fielddesk har en EK authoritative/UI-equivalent Materialer actual total.

`VERIFY`: Feltet/kilden for den authoritative total er endnu ikke generisk fundet som V4 project payload field. V3 `TotalPOCost` må ikke blindt bruges, fordi `80396-003` viser stor mismatch mod UI material actual.

Anbefalet praktisk tolerance:

```text
material_total_quality = VERIFIED
when:
  authoritative_material_actual source is UI-equivalent/direct EK total
  and abs(authoritative - reconstructed_breakdown) <= min(100 kr., authoritative * 0,0005)
  and no known excluded material account/internal bucket exceeds tolerance

material_breakdown_quality = PARTIAL
when:
  total is verified
  but individual creditor/internal bucket attribution still has residuals
```

Denne regel betyder:

- `80396-003` kan bruge authoritative material total i weighted completion, hvis UI/export source accepteres som authoritative.
- `80548`, `80396-006-001`, `80440`, `38157` og `80288-001-004` ligger inden for eller på 1:1 parity for den testede API-kilde.
- `80279-003` og `38155` må ikke auto-verificeres endnu.

## FINAL MATERIAL ACTUAL RULE

- Kan EK authoritative material actual bruges i IGVA? Ja, men kun når kilden er UI-equivalent/direct EK total og ikke blot V3 `TotalPOCost` uden parity.
- Skal breakdown parity være 100 % før totalen bruges? Nej. Total og breakdown skal have separate quality flags.
- Hvilken tolerance anbefales? `abs(diff) <= min(100 kr., 0,05 % af authoritative total)` plus ingen kendt stor unresolved source.
- Er mønsteret DEP-specifikt? Nej.
- Skal material actual nu inkluderes i weighted completion? Ikke generelt i POC-koden efter denne audit. Audit-resultatet understøtter reglen principielt, men viser også to residual-failures og at `TotalPOCost` ikke er sikker generisk UI-material source.

## Implementation Decision

`not changed`: IGVA POC v2-kode blev ikke opdateret i denne opgave.

Begrundelse:

- Audit-resultatet viser ikke, at forskellen generelt er lille på tværs af alle testede cases.
- `80396-003` kræver UI/export authoritative total; V3 `TotalPOCost` er ikke sikkert.
- `80279-003` og `38155` viser stadig mapping/source-gaps.

Næste implementeringsopgave bør først tilføje en eksplicit `authoritative_material_actual` source i adapteren, adskilt fra breakdown, og kun markere totalen `VERIFIED` når tolerance-reglen ovenfor er opfyldt.
