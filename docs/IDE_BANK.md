# Fielddesk IDE_BANK

## Procesregel

Når Dennis skriver:

- ny idé
- ide_bank
- smid i banken

må der kun ske:

1. strukturering af idé
2. placering i IDE_BANK
3. valg mellem gemme eller vurdere

Ingen implementering eller arkitekturdesign må startes alene på baggrund af en idé.

---

## IDE_COUNTER

Næste ledige ID: IDE-0030

---

## 🟢 Godkendt – Afventer plan

---

## 🟡 Under vurdering

### IDE-0029 – CCTV arkivering, pins og aktiv rapportering

Dato: 2026-07-13
Kilde: Chat / arkitekturbeslutning for arkiverede kameraer, pins og rapportering
Status: Under vurdering
Problem: CCTV-kameraer skal kunne fjernes fra den aktive installation uden at historik, billeder, noter, audit eller pin-placering går tabt. Hvis en pin slettes ved arkivering, kan et senere gendannet kamera miste sin dokumenterede placering. Samtidig må arkiverede kameraer ikke forurene standardvisninger, optællinger, rapporter eller eksport, som skal vise den aktuelle aktive installation.
Mulig løsning: Arkivering skal være den primære brugerhandling frem for slet. Kameraets relationer, billeder, noter, audit, historik og pin bevares. Pinnen skjules kun i aktive standardvisninger, fordi kameraet er arkiveret. Ved gendannelse aktiveres samme kamera igen, og den eksisterende pin vises automatisk med samme `x_percent` / `y_percent`; der oprettes ikke en ny pin. Standardlister, tegninger, kontrolflow, dashboard, KPI, CSV og PDF skal kun medtage aktive kameraer. En senere eksplicit `Vis arkiverede` / `Medtag arkiverede` funktion kan vise arkiverede kameraer og pins med tydelig visuel markering.
Forretningsværdi: Bevarer dokumentation og historik uden at gøre den aktive installation rodet. Gør det sikkert at gendanne kameraer uden datatab og understøtter revisionsklar historik.
Risiko: Restore kan give konflikter, hvis et nyt aktivt kamera bruger samme MAC-adresse eller serienummer, mens det gamle kamera er arkiveret. Queries, rapporter og eksport skal være konsekvente, så arkiverede kameraer ikke utilsigtet tælles med. En `Vis arkiverede` funktion skal være tydelig, så arkiverede pins ikke forveksles med aktive installationer.
Afhængigheder: Project Equipment CCTV, `project_equipment_cctv.archived_at`, `project_equipment_cctv_pin`, partial unique indexes for aktive MAC/S/N, audit events, rapportmotor, CSV/PDF export, dashboard/KPI, fremtidig restore-endpoint og eventuel admin/support-visning for arkiverede pins.
Noter: Arkitekturbeslutningen er registreret i `docs/modules/project-equipment/CCTV_ARCHIVE_PIN_REPORTING_DECISION.md`. Dette er ikke en implementering og ændrer ikke nuværende funktionalitet.

---
### IDE-0027 – Medarbejderportal og Projektroller

Dato: 2026-06-08  
Kilde: Chat / IDE-0027 Del 1, Del 2 og Del 3 + Solar-kurv præcisering  
Status: Under vurdering  

#### FORMÅL

Skabe en rollebaseret medarbejderportal i Fielddesk, hvor teknikere, elektrikere, formænd og projektledere arbejder i samme projekt, men ser forskellige oplysninger afhængigt af rolle og permissions.

Portalen skal være den primære arbejdsflade for udførende medarbejdere og samtidig danne fundament for QA, projektkommunikation, projektpersoner, materialestyring, notifikationer, statistik og fremtidige moduler.

Målet er at samle relevant information ét sted, så medarbejdere ikke skal skifte mellem Outlook, telefon, Excel, EK og andre systemer for at finde information om projektet.

#### BAGGRUND

I dag mangler udførende medarbejdere ofte:

- Overblik over egne projekter
- Kontaktoplysninger på relevante personer
- Projektinformation og praktiske forhold
- QA-overblik
- Status på materialer
- Status på egne timer
- Fælles projektkommunikation

Samtidig mangler projektledere ofte:

- En enkel måde at kommunikere til hele projektet
- Overblik over QA
- Overblik over ressourcer
- Overblik over manglende tidsregistrering
- Overblik over hvem der er tilknyttet projektet

IDE-0027 skal skabe den fælles projektportal, hvor alle roller arbejder i samme projekt, men med forskellig visning.

#### MÅLGRUPPER

Primære roller:

- Tekniker
- Elektriker
- Formand
- Projektleder

Sekundære roller:

- Afdelingsleder
- Økonomi
- Andre ledere
- Eksterne kontaktpersoner senere

Roller er projektspecifikke.

Samme person kan derfor være:

- Projekt A: Formand
- Projekt B: Tekniker
- Projekt C: Ingen adgang

#### A. TEKNIKERPORTAL

##### A1. Projektoversigt

Teknikeren skal kunne se:

- Egne projekter
- Projektnavn
- Sagsnummer
- Kunde
- Adresse
- Kontaktperson
- Projektleder
- Formand

Projektet åbnes direkte fra dashboard.

##### A2. Projektinformation

Teknikeren skal kunne se:

- Praktisk information
- Arbejdstider
- Adgangsforhold
- Parkering
- Kontaktpersoner
- Projektinformation

Praktisk information er relativt statisk.

##### A3. Projektlederbeskeder

Teknikeren skal kunne se projektlederbeskeder.

Eksempel:

"Husk ABA-test fredag."

Beskeder kan:

- Markeres som læst
- Flyttes til beskedhistorik
- Være tagget med @person
- Være tagget med @Alle

Alle kan se beskeden.

Taggede personer modtager særskilt notifikation.

##### A4. QA

Teknikeren kan:

- Se QA
- Oprette QA
- Svare på QA
- Genåbne QA
- Acceptere svar

Teknikeren kan ikke lukke QA.

QA er projektspecifik.

Alle tilknyttede personer på projektet kan se QA.

##### A5. Milepæle

Teknikeren kan:

- Se milepæle

Teknikeren kan ikke:

- Markere milepæle
- Oprette milepæle
- Redigere milepæle
- Slette milepæle

##### A6. Projektpersoner

Teknikeren kan se:

- Projektleder
- Formand
- Teknikere
- Kunde
- Kontaktpersoner

På personer vises:

- Ring
- SMS
- Mail

Handlingerne skal være direkte links og ikke noter.

##### A7. Egne timer

Teknikeren kan se:

- Egne timer
- Egne lønkoder
- Egne registreringer

Liste skal kunne:

- Sorteres
- Filtreres
- Scrolles

Sortering:

- Dato
- Lønkode
- Timer
- Projekt

##### A8. Egne timer-cards

Eksempler:

- Denne uge
- Denne måned
- Egne produktive timer
- Egne timer pr. lønkode

Visning afhænger af lønkodekonfiguration.

##### A9. Fælles noter

Projektet skal understøtte fælles noter.

Alle tilknyttede personer kan:

- Oprette noter
- Læse noter

Noter er synlige for alle tilknyttede på projektet.

##### A10. Begrænset økonomi

Teknikeren skal som udgangspunkt ikke kunne se:

- Budget
- DB
- DG
- Forecast
- Materialebeløb
- Lønsum

Teknikeren kan se:

- Antal ordre
- Materialestatus
- Restordrestatus
- Eventuelt begrænset projektinformation

##### A11. Dashboard

Tekniker-dashboard skal indeholde:

- Mine projekter
- QA
- Egne timer
- Streak uden manglende registrering
- Dage til næste ferie/fravær
- Materialestatus
- Projektlederbeskeder
- Notifikationer

Dashboardet er rollebaseret.

#### B. FORMANDSPORTAL

Formanden arver alt fra Tekniker-portalen.

##### B1. Ressourcepanel

Formanden skal kunne se:

- Antal tilknyttede personer
- Personer på projekt
- Ferie
- Kursus
- Planlagt fravær

Sygdom som projektrelateret status er foreløbig åbent spørgsmål.

##### B2. Timer

Formanden kan se:

- Samlede projekttimer
- Timer pr. medarbejder
- Produktive timer

Visning af lønkoder skal være konfigurerbar.

Eksempel:

- `show=true`
- `show=false`

På lønkode-/fitterhour-niveau.

##### B3. Materialestatus

Formanden kan se:

- Solar ordre
- LM ordre
- AO ordre
- Restordre
- Leveringsstatus

##### B4. Solar-kurv

Formanden kan:

- Se kurv
- Redigere kurv
- Tilføje varer
- Se lagerstatus
- Se alternativer
- Se restordre

Formanden kan sende ordre, hvis permission tillader det.

##### B5. Milepæle

Formanden kan:

- Se milepæle
- Markere milepæle

Formanden kan ikke:

- Redigere milepæle
- Slette milepæle

##### B6. Manglende tidsregistrering

Formanden skal modtage systeminformation om medarbejdere, der ikke har registreret tid.

Eksempel:

"Mikkel har ikke registreret tid for i går."

Beskeden skal:

- Være midlertidig
- Forsvinde automatisk når tiden registreres
- Ikke logges
- Ikke flyttes til beskedhistorik

##### B7. Økonomi

Formanden må som standard ikke se:

- Lønsum
- Materialebeløb

Projektleder kan pr. projekt aktivere:

- Vis lønsum
- Vis materialebeløb

Default er OFF.

#### C. PROJEKTLEDERSTYRING

Projektleder er projektets administrator og ejer.

Projektleder styrer:

- Projektinformation
- Projektpersoner
- Roller
- Permissions
- QA
- Milepæle
- Projektlederbeskeder
- Solar-kurv
- Ressourcer

##### C1. Medarbejderstyring

Projektleder skal kunne:

- Tilføje personer
- Fjerne personer
- Ændre rolle
- Tildele midlertidige roller
- Tildele faste roller

Projektleder kan tilføje:

- Teknikere
- Elektrikere
- Formænd
- Projektledere
- Afdelingsledere
- Andre ledere

Der er ingen rollebegrænsning.

##### C2. Medarbejdersøgning

Søgning skal understøtte:

- Initialer
- Navn

Eksempler:

- `S` viser `SLA`, `STE`, `SØH` i alfabetisk rækkefølge
- `SØ` viser `SØH`
- Søgning på `Henrik` skal vise alle relevante Henrik-resultater

##### C3. Projektspecifik rolle

Roller er projektspecifikke.

Eksempel:

- Henrik på Projekt A: Formand
- Henrik på Projekt B: Tekniker
- Henrik på Projekt C: Ingen adgang

##### C4. Midlertidige roller

Projektleder kan oprette fast rolle eller tidsreguleret rolle.

Eksempel:

- Henrik
- Formand
- Fra: 01-08-2027
- Til: 15-08-2027

Når slutdato passeres, fjernes rollen automatisk.

##### C5. Projektinformation

Projektleder kan redigere:

- Praktisk information
- Kontaktoplysninger
- Adgangsforhold
- Arbejdstider
- Projektinformation

Disse oplysninger vises til teknikere og formænd.

Projektleder skal også selv kunne se disse oplysninger.

##### C6. Projektledernoter

Projektleder skal have et privat notefelt.

Noterne må kun være synlige for projektleder.

Eksempler:

- Egne observationer
- Ledelsesnoter
- Opfølgningspunkter
- Følsomme bemærkninger

Teknikere og formænd må aldrig kunne se disse noter.

##### C7. QA-administration

Projektleder kan:

- Se QA
- Oprette QA
- Svare på QA
- Genåbne QA
- Lukke QA

Projektleder ser kun QA på projekter hvor vedkommende har adgang.

Der findes ikke global QA-adgang.

##### C8. Milepæler

Projektleder kan:

- Oprette milepæler
- Redigere milepæler
- Slette milepæler
- Markere milepæler
- Genåbne milepæler

Projektleder er ejer af milepælsmodulet.

##### C9. Ressourcepanel

Projektleder skal kunne se:

- Antal tilknyttede personer
- Personer på projekt
- Ferie
- Kursus
- Planlagt fravær

Eksempel:

- Tilknyttet: 14 personer
- I dag: 9 på projekt
- Ferie: 2
- Kursus: 1

Panelet skal senere kunne integreres med kalender- og planlægningsmoduler.

##### C10. Solar-kurv administration

Projektleder er ejer af kurven.

Projektleder kan:

- Se alt
- Redigere alt
- Godkende alt
- Sende ordre

Projektleder kan altid sende ordre.

#### D. PROJEKTPERSONER

Projektpersoner er et selvstændigt projektmodul.

##### D1. Projektpersoner-panel

Panelet skal kunne vise:

- Projektledere
- Formænd
- Teknikere
- Elektrikere
- Kunde
- Kontaktperson
- Rådgiver
- Byggeleder
- Vagt
- Andre relevante personer

##### D2. Handlinger

På personer skal der kunne vælges:

- Ring
- Send SMS
- Send mail

Disse skal være direkte handlinger.

Ikke noter.

##### D3. Eksterne personer

Projektet skal kunne indeholde personer som ikke er FD-brugere.

Eksempler:

- Kunde
- Kontaktperson
- Rådgiver
- Byggeleder
- Vagt
- Leverandørkontakt

##### D4. Historik

Tilføjelse og fjernelse af personer må ikke slette historik.

Eksempel:

- Henrik
- Tilknyttet: 01-04-2027
- Fjernet: 17-06-2027

Historikken skal bevares.

##### D5. Projektperson-status

Fremtidig mulighed:

- Henrik
- Sidst aktiv: I dag
- QA: 2 åbne
- Timer registreret: Ja

Denne del er foreløbig fremtidssikring.

#### E. QA V2

QA er projekt- og sagsnummer-specifik.

Alle tilknyttede personer på projektet kan se QA.

##### E1. QA-rettigheder

Som udgangspunkt:

Alle:

- Opret
- Svar
- Genåbn

Projektleder:

- Luk

Permissionmodel:

- `new=true`
- `respond=true`
- `close=false`
- `reopen=true`

Kan ændres senere.

##### E2. Modtagere

QA kan have:

- Ingen specifik modtager
- Én modtager
- Flere modtagere

Eksempel:

- Modtager: Henrik
- Modtagere: Henrik, Dennis, Thomas

Alle kan stadig læse og svare.

##### E3. Besvarelsesregel

Ved flere modtagere kan opretteren vælge:

- Én accept er nok
- Alle modtagere skal acceptere

Default:

- Én accept er nok

##### E4. Acceptmodel

Hvis modtager selv svarer, ændres status straks til:

- Besvaret

Der kræves ikke accept af eget svar.

##### E5. Svar fra anden person

Hvis Dennis svarer på en QA til Henrik:

- Status: Svar modtaget
- Afventer Henrik

Henrik kan acceptere svaret.

Derefter:

- Besvaret
- Accepteret af Henrik

##### E6. Flere modtagere

Hvis Henrik svarer:

- Dennis og Thomas kan acceptere samme svar.
- De behøver ikke skrive egne svar.

Eksempel:

- Svar af Henrik
- Accepteret af Dennis
- Accepteret af Thomas

##### E7. Dashboardstatus

Pr. bruger:

- Afventer mit svar
- Afventer min accept
- Nye svar
- Ulæste svar

Hvis en anden allerede har svaret:

- Afventer mit svar = 0
- Afventer min accept = 1

##### E8. Læsestatus

QA skal understøtte pr.-bruger status.

Samme QA kan være:

- Dennis: Læst
- Henrik: Ulæst
- Mikkel: Afventer svar

Status er derfor ikke global.

#### F. PROJEKTLEDERBESKEDER

Projektlederbeskeder er adskilt fra QA.

QA = spørgsmål.

Projektlederbesked = information.

##### F1. Projektlederbeskeder

Eksempler:

- ABA-test flyttet til fredag.
- Port 14 udgår af uge 32.
- Nye adgangskrav gælder fra mandag.

##### F2. @Tag

Understøttes:

- @Henrik
- @Mikkel
- @Alle

Alle kan se beskeden.

Taggede personer får notifikation.

##### F3. Læst-status

Teknikere og formænd kan markere som læst.

Når beskeden er læst, flyttes den til beskedhistorik.

##### F4. Beskedhistorik

Gamle beskeder skal kunne genfindes.

Beskeder er ikke QA.

Beskeder kræver ikke svar.

De fungerer som projektets opslagstavle.

#### G. DASHBOARD

Fielddesk skal anvende rollebaserede dashboards.

Det er ikke ét fælles dashboard med skjulte cards.

Det er forskellige layouts.

Eksempel:

- Layout 1: Økonomi
- Layout 2: Tekniker
- Layout 2+: Formand, tekniker-layout plus ekstra cards
- Layout 3: Projektleder
- Layout 4: Afdelingsleder

Cards vises/skjules baseret på rolle og permissions.

##### G1. Tekniker-dashboard

Skal som minimum kunne vise:

- Mine projekter
- QA: Afventer mit svar, afventer min accept, ulæste svar, nye tråde
- Projektlederbeskeder
- Mine timer
- Streak: Dage uden manglende registrering
- Highscore
- Dage til næste ferie/fravær
- Mine materialer
- Restordre
- Notifikationer

##### G2. Formand-dashboard

Arver tekniker-dashboard.

Ekstra cards:

- Ressourcepanel
- Manglende tidsregistrering
- Restordre
- Solar-kurve
- Åbne QA
- Samlede produktive timer
- Projekter med problemer

##### G3. Projektleder-dashboard

Skal vise:

- Mine projekter
- QA-overblik
- Manglende tidsregistrering
- Ressourcepanel
- Projektlederbeskeder
- Restordre
- Solar-ordrer
- Milepæler
- Notifikationer
- Statistik og milepælsbeskeder

##### G4. Hurtige projektkort

Dashboardet skal vise projekter direkte.

Eksempel:

- Sagsnummer
- Kunde
- Adresse
- QA: 2
- Restordre: 1
- Milepæle: 4/6

Klik åbner projektet.

#### H. NOTIFIKATIONER

Notifikationer skal opdeles efter relevans.

##### H1. Handling kræves

Eksempler:

- QA afventer dit svar
- QA afventer din accept
- Ordre kræver godkendelse
- Manglende tidsregistrering

##### H2. Information

Eksempler:

- @Henrik
- Projektlederbesked
- Milepæl ændret

##### H3. Systeminformation

Eksempler:

- Manglende tidsregistrering

Disse er flygtige og må ikke blive historik.

##### H4. Statistik/milepæler

Eksempler:

- 50 dage uden manglende registrering
- 365 dage uden sygdom

Disse er informationsnotifikationer.

##### H5. Visning

- Dashboard-cards
- Notifikationscenter
- Projektkort
- Push-notifikationer

##### H6. Push-notifikationer

Push skal understøttes via PWA.

Push-egnede:

- QA afventer svar
- QA afventer accept
- @tag
- @Alle
- Projektlederbeskeder
- Ordre kræver handling
- Kritiske restordreændringer

Ikke push-egnede:

- Almindelige kurvændringer
- Historik
- Små statusændringer

##### H7. Brugerindstillinger

Senere skal brugeren kunne vælge:

- QA
- Beskeder
- Push
- Materialer
- Milepæler
- Statistik
- Til/Fra

#### I. SOLAR-KURV

Solar-kurven er et selvstændigt projektmodul.

Den er ikke blot en liste med materialer.

Fielddesk bygger ikke en Solar-klon, men et projektcentreret materialekoordineringslag, der bruger Solar som backend procurement-kilde.

Fielddesk skal bygge sin egen projektspecifikke kurv. Kurven skal ikke kopiere Solar UI eller checkout. Fielddesk skal bruge eksisterende eller kommende Solar-endpoints til produktsøgning, lagerstatus, pris/CO2-data, udfyldning af ordre-/leveringsfelter og senere ordreafsendelse.

FD-kurven er projektets samarbejdslag:

- Hvem har lagt varen i kurven
- Hvorfor/note
- Dubletter samlet pr. produkt
- Projekt-/opgavespecifik kontekst
- Rollebaseret prisvisning
- Restordreoverblik
- Snapshots/audit
- Ordre-permissions

Solar er handels-/ordrelaget.

##### I1. Fælles projektkurv

Alle tilknyttede personer kan:

- Søge produkter
- Tilføje produkter
- Se produkter
- Se kurven
- Undgå dobbeltbestillinger

##### I2. Produktvisning

Produktlinje viser:

- Produkt
- Antal
- Lagerstatus
- CO2 pr. stk.
- CO2 total
- Bestiller
- Timestamp

##### I3. Prisvisning

Global default:

- Listepris

Projektleder kan ændre pr. projekt/person:

- Nettopris
- Listepris

##### I4. Produktnoter

Ved tilføjelse:

- "Til kanalen ved hoveddøren"
- "Til ABA-rum"

Noter vises for alle.

##### I5. Dublet-håndtering

Samme produkt samles.

Eksempel:

- EL580
- Henrik: 5 stk.
- Mikkel: 2 stk.
- Total: 7 stk.

##### I6. Redigering

Antal kan ændres.

Modal:

- `[-]`
- `[7]`
- `[+]`
- Opdater
- Annuller

Ændringer registreres i historik.

##### I7. Alternativer

Produkter kan vise:

- Alternative produkter
- CO2
- Besparelse
- Lagerstatus

Kun alternativer med tilstrækkelig lagerstatus vises.

Ellers:

- Ingen alternativer, nedtonet

##### I8. Lagerstatus

Vis lagerantal.

Ved restordre:

- Aktiv advarsel
- Bruger skal acceptere

##### I9. Restordre

Projektet skal vise:

- Bestiller
- Bestillingsdato
- Antal
- Restordre
- Forventede leveringsdatoer
- Split-leveringer
- Leveringsændringer

Datoer skal opdateres dynamisk.

##### I10. Ordreafsendelse

Projektleder kan altid sende ordre.

Andre kan sende ordre via permission:

- `send_order=true`

##### I11. Snapshot

Kurven skal understøtte:

- Snapshot
- Audit
- Historik

Så tidligere tilstande kan genskabes.

#### J. HISTORIK / SNAPSHOT / AUDIT

Historik er kun tilgængelig for projektleder.

##### J1. Audit

Viser:

- Hvem
- Hvad
- Hvornår

Eksempel:

- Henrik tilføjede 5 EL580
- DEP sendte ordre

##### J2. Snapshot

Viser tidligere tilstande.

Eksempel:

- Kurv 07-06-2027
- EL580: 7 stk.
- EL574: 3 stk.

##### J3. Omfatter

- Solar-kurv
- Ordreafsendelse
- QA-status
- Milepæler
- Projektpersoner
- Roller
- Permissions

##### J4. Filtrering

Efter:

- Hændelse
- Dato
- Person
- Fritekst

##### J5. Væsentlige hændelser

Historikken skal ikke vise:

- Projekt åbnet
- QA læst
- Besked læst

Kun væsentlige hændelser.

#### K. STATISTIK / GAMIFICATION

##### K1. Teknikerstatistik

- Dage uden manglende registrering
- Highscore
- Dage til næste ferie
- Dage til næste planlagte fravær

##### K2. Historiske data

- Manglende registreringer
- Sygdom
- Ferie
- Feriefri
- SH-dage
- Andet fravær

##### K3. Sygdomsstatistik

Skal kunne vises pr. ugedag.

Eksempel:

- Mandag: 5
- Tirsdag: 1
- Onsdag: 0

##### K4. Milepæler

Projektleder kan modtage beskeder om:

- 50 dage uden manglende registrering
- 100 dage uden manglende registrering
- 365 dage uden sygdom

FD bestemmer ikke belønning.

Kun information.

#### L. PERMISSIONS / RBAC

Roller giver standard-permissions.

Projektleder kan overstyre udvalgte permissions pr. projekt/person.

##### L1. QA

- `qa_view`
- `qa_create`
- `qa_respond`
- `qa_close`
- `qa_reopen`
- `qa_accept`

##### L2. Milepæler

- `milestone_view`
- `milestone_mark`
- `milestone_edit`
- `milestone_delete`

##### L3. Solar

- `cart_view`
- `cart_add`
- `cart_edit`
- `cart_send_order`
- `cart_view_prices`
- `cart_view_net_prices`
- `cart_view_co2`

##### L4. Økonomi

- `economy_view_hours`
- `economy_view_materials`
- `economy_view_labor_cost`
- `economy_view_material_cost`
- `economy_view_budget`
- `economy_view_db`
- `economy_view_dg`
- `economy_view_forecast`

##### L5. Personer

- `person_view`
- `person_add`
- `person_remove`
- `person_change_role`

##### L6. Beskeder

- `message_view`
- `message_create`
- `message_tag`
- `message_delete`

##### L7. Historik

- `history_view`

Kun projektleder som udgangspunkt.

#### ÅBNE SPØRGSMÅL

- Sygdom som projektrelateret status
- Hvordan sygdom skal kobles til konkrete projekter
- Detaljeret kalenderintegration
- Ressourceplanlægning

#### AFHÆNGIGHEDER

- QA-modul
- Notifikationsmodul
- Solar-integration
- CO2-database
- Projektpersoner
- Kalendermodul
- Fremtidig planlægningsmotor

#### FORVENTET GEVINST

Samlet projektportal for:

- Teknikere
- Formænd
- Projektledere

Mindre brug af Outlook, Excel og telefonopkald.

Bedre QA-flow.

Bedre projektkommunikation.

Mindre dobbeltbestilling af materialer.

Mere synlig projektinformation.

Bedre tidsregistreringsdisciplin.

Forberedelse til fremtidige moduler som:

- Kalender
- Planlægning
- CO2
- Ressourcestyring
- Projektstatusindikatorer
- AI-assisterede workflows

Medarbejderportal og Projektroller bliver det centrale daglige arbejdsområde for udførende medarbejdere i Fielddesk.

---

### IDE-0028 – FD som ERP-orchestrator og mulig selvstændig ERP-retning

Dato: 2026-06-13  
Kilde: Chat / EK v4 API-discovery, fitterhours, materialer, financialposts og dokumentation  
Status: RAW IDEA / Ikke promoveret til BACKLOG eller SPEC  

#### FORMÅL

Gemme den strategiske idé om, at Fielddesk på lang sigt kan bevæge sig fra dashboard ovenpå E-Komplet til egentlig arbejdsflade/orchestrator for projektstyring, økonomi, timer, materialer, dokumentation og QA.

Idéen er et fremtidsspor. Den må ikke implementeres nu og må ikke behandles som backlog eller spec uden særskilt vurdering.

#### OBSERVATIONER

Ny EK v4 API-dokumentation og safe probes viser, at EK har flere projektorienterede læse- og write-side muligheder:

- `GET /api/v4/projects/id/{id}` kan returnere project detail med noter og timeregistreringer.
- `purchaseinvoicelines` kan give faktiske materialelinjer/varelinjer pr. projekt via ProjectID-filter.
- `purchaseorders` kan give købs-/leverandørhoveddata pr. projekt.
- `financialposts` kan fungere som bro mellem projekt, faktura, `purchaseOrderID`, `fileID` og økonomiske posteringer.
- `projects/{id}/documentation` kan bruges som dokument-/PDF-/ZIP-kilde.
- `projects/upload` viser mulighed for at bruge EK som dokumentlager.
- `projects/{id}/items`, `projects/budgets`, `fitterhours`, `worksheets` m.fl. peger på, at EK API'et også har write-side muligheder.

#### STRATEGISK IDÉ

FD kan på lang sigt udvikle sig i trin:

1. EK-læser

- FD læser projekter, timer, økonomi, materialer og dokumentation fra EK.

2. EK-arbejdsflade

- Projektleder arbejder primært i FD, mens EK fortsat er ERP/bogholderi-systemet bagved.

3. EK-orchestrator

- FD styrer godkendelser, ændringsnoter, forecast, budgetjusteringer, materialer, QA, dokumentation og evt. timer, og skriver kontrolleret tilbage til EK via API.

4. Selvstændig ERP-retning

- På længere sigt kan FD muligvis blive et selvstændigt ERP-lignende system med egen sandhed, egne workflows og valgfri integration til EK, Solar, økonomisystemer og andre datakilder.

#### PRINCIPPER

- Må ikke implementeres nu.
- Må først vurderes efter læsning, sync, activity, økonomi, materialer og dokumentation er stabile.
- Write-back til EK må kun ske med audit, ændringsnote, RBAC, tenant-isolation, godkendelsesflow, rollback-/fejlstrategi og tydelig markering af hvilken sandhed der er FD, og hvilken der er EK.
- FD skal kunne fungere uden EK på længere sigt, men EK-integration kan bruges som læring og overgangsbro.
- Idéen skal gemmes som fremtidsspor og ikke backlog-promoveres endnu.

#### RISICI

- Risiko for at FD bliver for tæt koblet til EK som implicit sandhed.
- Risiko for write-back uden tilstrækkelig governance, audit og rollback.
- Risiko for at projektleder-workflows, økonomi og bogholderi blandes uden klare ejerskabsgrænser.
- Risiko for at dokumenter, materialer og finansdata bliver gemt eller vist uden tydelig kilde- og sandhedsmarkering.

#### AFHÆNGIGHEDER

- Stabil EK read-side sync.
- Afklaret project activity-model.
- Materiale- og økonomimapping.
- Dokument-/filstorage-governance.
- RBAC, audit, tenant isolation og godkendelsesflow.
- Klar data ownership-model for FD-owned truth vs EK-owned truth.

#### NOTER

Denne idé er beslægtet med medarbejderportal, QA, materialestyring, Solar, rapportering og project context, men skal blive i IDE_BANK som RAW IDEA indtil de underliggende datakontrakter er modne.

---

### IDE-0002 – FD Office / mødelokaler

Dato: 2026-02-28  
Kilde: IDEBANK_MERGED_2026_02_28.md  
Status: Under vurdering  
Problem: Brugere mangler et hurtigt overblik over ledige/optagede mødelokaler og hurtig booking direkte i FD.  
Mulig løsning: Separat FD Office-modul med mødelokaleoversigt via Microsoft Graph: status, nuværende booking, næste booking og hurtig booking i 30/60 minutter eller valgt tid.  
Forretningsværdi: Hurtig ROI som add-on, især for kontor-/serviceorganisationer der allerede bruger Microsoft 365.  
Risiko: Graph permissions, room mailbox access, konflikthåndtering og tenant-specifik opsætning kan give kompleksitet.  
Afhængigheder: Microsoft 365, Entra app registration, Graph Places/Rooms, CalendarView og brugerrettigheder til room booking.  
Noter: Bør holdes separat fra OEF/KS. Flyttet fra "Godkendt – afventer plan", fordi idéen fremstår som defineret scope snarere end en aktivt godkendt plan.

---

### IDE-0003 – Dalux integration

Dato: 2026-02-24  
Kilde: IDEBANK.md; IDEBANK_MERGED_2026_02_28.md  
Status: Under vurdering  
Problem: Dalux-opgaver og markeringer kan ligge udenfor FD, hvilket kan skabe dobbeltarbejde mellem bygge-/feltværktøjer og FD-projektflow.  
Mulig løsning: Integration via projekt-invitation/API-adgang med mulighed for read/write, import af opgaver/markeringer og synkronisering med Fielddesk-projekter.  
Forretningsværdi: Kan gøre FD mere attraktiv i bygge-/installationsmiljøer hvor Dalux allerede bruges.  
Risiko: API-adgang, rettigheder, data ownership og konflikt mellem Dalux og FD-sandhed.  
Afhængigheder: Dalux API/dialog, projektmapping, tenant permissions, audit.  
Noter: Afventer dialog.

---

### IDE-0004 – Microsoft 365 Outlook projektintegration

Dato: 2026-02-24  
Kilde: IDEBANK.md; IDEBANK_MERGED_2026_02_28.md  
Status: Under vurdering  
Problem: Projektkommunikation i mail ligger ofte udenfor FD og er svær at finde pr. sag.  
Mulig løsning: Når nyt projekt oprettes/synces fra E-Komplet, opretter FD en Outlook/SharePoint/OneDrive-struktur som "Projekter/XXXX – Navn" og mailregler, der flytter mails med projektnummer i emne til projektmappen.  
Forretningsværdi: Mindre manuelt mailarbejde, bedre projektsporbarhed og bedre sammenhæng mellem FD og Microsoft 365.  
Risiko: Graph permissions, bruger-/tenant-samtykke, mailregel-konflikter, GDPR og support ved M365-politikker.  
Afhængigheder: Microsoft Graph API, Entra app registration, delegated/application permissions, E-Komplet projektnumre.  
Noter: Konsoliderer også idéerne om automatisk projektmappestruktur og mail-opsamling pr. projekt.

---

### IDE-0005 – Solar Procurement Connector

Dato: 2026-02-25  
Kilde: IDEBANK.md; IDEBANK_MERGED_2026_02_28.md  
Status: Under vurdering  
Problem: Materialesøgning, bestilling og varedata kan være adskilt fra projektflowet i FD.  
Mulig løsning: Integrér Solar via API som procurement connector: scan stregkode/EAN på mobil, find vare, læg i bestillingsliste, vælg antal og send ordre. Senere mulighed for "lager i bil" som liste/registrering, ikke regnskab.  
Forretningsværdi: Hurtigere materialeflow, færre fejl ved varevalg og bedre kobling mellem projekt, materialer og indkøb.  
Risiko: Solar credentials, priser, ordreafsendelse og delivery-address mapping er følsomt og rolleafhængigt.  
Afhængigheder: Solar OAuth2/client credentials, subscription key hvis relevant, catalog/product lookup, prices, ATP availability, orders, tenant-specific accountId og delivery addresses.  
Noter: RBAC-princip: alle kan evt. scanne/søge, men ordre/priser skal begrænses pr. rolle/capability. FD frontend må ikke håndtere Solar credentials direkte.

---

### IDE-0006 – Solar/CO₂ produktdata og EPD/PEP evidence

Dato: 2026-02-25  
Kilde: IDEBANK.md; IDEBANK_MERGED_2026_02_28.md; fielddesk_document_search_strategy_B_to_C.md; fielddesk_pdf_to_search_pipeline.md  
Status: Under vurdering  
Problem: FD kan få brug for produkt- og dokumentdata som grundlag for fremtidige CO₂-/ESG-vurderinger, men værdier må ikke gættes eller opstå uden kildebevis.  
Mulig løsning: Brug Solar produktdata og tekniske dokumenter som evidence-kilder. PDF'er, EPD/PEP-dokumenter og metadata gøres søgbare og kan senere kobles til CO₂-kandidater, datakvalitet og confidence.  
Forretningsværdi: Giver fundament for ESG/CO₂-modul, materialeforståelse og dokumenteret produktdata uden at gøre FD til et løst parsingværktøj.  
Risiko: Risiko for at blande research, local extraction tooling og runtime FD-model. CO₂-værdier må ikke opfindes, og datakilder skal være tydelige.  
Afhængigheder: Solar data, dokumentbibliotek, PDF-pipeline, storage, metadata, tenant isolation, fremtidigt CO₂-modul.  
Noter: Skal adskilles fra standalone CO₂ Beregner tooling. FD-sporet bør eje research, integrationsviden og modulstrategi.

---

### IDE-0026 – Foreløbigt CO₂-overblik på projektdetaljeside

Dato: 2026-05-29  
Kilde: Chat / nyere Fielddesk-retning  
Status: Under vurdering  
Problem: Fielddesk kan allerede hente projekter, og projektdata bør senere kunne kobles med materiale-/produktdata fra Solar og andre kilder. Der mangler et klart koncept for, hvordan en projektleder kan se et samlet foreløbigt CO₂-regnskab direkte på projektdetaljesiden, uden at dette forveksles med en verificeret slutopgørelse.  
Mulig løsning: Tilføj senere et CO₂-overblik på projektdetaljesiden, som viser "Foreløbigt CO₂ pr. dags dato". Overblikket skal være dynamisk og må ændre sig løbende, fordi projektets materialer og datagrundlag kan ændre sig over tid. Når et projekt bliver verificeret lukket, skal systemet kunne danne et låst/verificeret CO₂-snapshot.

CO₂-modellen skal understøtte tre sandheder:

1. Live CO₂

- Beregnes løbende ud fra aktuelle materialer og data.
- Kan ændre sig dagligt.
- Anvendes under projektets udførelse.
- Er operationel projektinformation.

2. Snapshot CO₂

- Kan gemmes på bestemte tidspunkter.
- Bruges til historik, udvikling og sammenligning.
- Må ikke ændres efter snapshot er oprettet.

3. Verificeret CO₂

- Oprettes når projektet er verificeret lukket.
- Er projektets officielle CO₂-regnskab.
- Må aldrig ændres efter godkendelse.
- Skal være den værdi rapporter, ESG-opgørelser og revision refererer til.

Forretningsværdi: Giver projektleder, ledelse og senere kunder et tidligt overblik over CO₂-belastning pr. projekt. Kan senere bruges til ESG-rapportering, projektstyring, materialevalg, kundeafrapportering og sammenligning mellem forventet og realiseret CO₂.  
Risiko: Risiko for at foreløbige tal misforstås som officielle tal. Datagrundlaget kan være ufuldstændigt, især hvis materialer mangler EAN/EL-nr., Solar-match, PEP/EPD eller verificerede A1-A3 værdier. Kræver tydelig datakvalitet, confidence og statusvisning.  
Afhængigheder:

- Projektdata fra Fielddesk/E-Komplet
- Materiale-/produktdata
- Solar integration
- CO₂/EPD/PEP datagrundlag
- Snapshot-princip
- Tenant isolation
- RBAC
- Rapportmotor

Noter: Minimum skal A1-A3 understøttes hvor muligt. Senere kan A4, A5, B, C og D tilføjes. Visning bør inkludere matched/unmatched materialer, datakilde, datakvalitet/confidence og seneste beregningstidspunkt. Projektets historiske/verificerede CO₂-regnskab må ikke ændre sig efter verificeret lukning.

---

### IDE-0007 – Dokument-søgning og PDF til søgetekst pipeline

Dato: 2026-03-06  
Kilde: fielddesk_document_search_strategy_B_to_C.md; fielddesk_pdf_to_search_pipeline.md  
Status: Under vurdering  
Problem: Tekniske PDF'er som montagevejledninger og datablade er svære at finde og søge i, hvis FD kun gemmer originalfilen.  
Mulig løsning: Gem original PDF som sandhed, udlæs raw_text/search_text, gem metadata og byg først database full-text search. Design datamodellen så den senere kan udvides med OCR, chunking, embeddings og hybrid semantic search.  
Forretningsværdi: Stærkere dokumentmodul for teknikere, bedre søgning på produktnavne/koder og fundament for AI-svar med dokumentreference.  
Risiko: OCR/tekst extraction kan fejle; metadata og chunks kan blive upræcise; storage og adgangskontrol skal være stærk.  
Afhængigheder: Dokument-storage, PDF parser, metadata model, text_status, chunk_status, embedding_status, fremtidigt vector index.  
Noter: Konsoliderer dokument-søgestrategi B→C og PDF-til-søgetekst pipeline. C erstatter ikke B; semantic search er et ekstra lag ovenpå full-text.

---

### IDE-0008 – AI kontrakthjælper og agent-system

Dato: Ukendt legacy  
Kilde: IDEBANK.md; IDEBANK_MERGED_2026_02_28.md  
Status: Under vurdering  
Problem: Kontraktanalyse kræver RAG, strukturerede outputs, værktøjer og kvalitetssikring; én simpel chat er ikke nok.  
Mulig løsning: Byg AI-system med frontend chat, API gateway, auth, agent orchestrator, tools layer og specialiserede agents: Contract Agent, Risk Agent, QA Agent og Support Agent.  
Forretningsværdi: Kan differentiere FD som intelligent kontrakt-/projektplatform med risikoudtræk, forpligtelser, deadlines og intern QA.  
Risiko: Hallucinationer, for bred datatilgang, høj AI-cost, uklare outputformater og compliance-risiko.  
Afhængigheder: Solid RAG, PDF parser, clause extractor, obligation classifier, risk scoring engine, policy/guardrails, tenant scoping, logging.  
Noter: Fine-tuning bør kun overvejes ved mange labeled examples eller behov for ekstrem ensartet juridisk formulering.

---

### IDE-0009 – Udvidet ordliste-system

Dato: 2026-02-24  
Kilde: IDEBANK.md; IDEBANK_MERGED_2026_02_28.md  
Status: Under vurdering  
Problem: Risikotermer kan variere mellem tenants, brancher og kontrakttyper.  
Mulig løsning: Tenant kan tilføje egne risikotermer; global admin kan godkende og udrulle forbedringer; baseline dictionary versioneres.  
Forretningsværdi: Mere præcis kontrakt-/risikoanalyse og mulighed for løbende produktforbedring på tværs af tenants.  
Risiko: Forkerte eller tenant-specifikke termer kan forurene global baseline.  
Afhængigheder: Dictionary governance, tenant/global scopes, approval flow, versionering.  
Noter: Bør kobles til AI kontrakthjælper, ikke bygges isoleret.

---

### IDE-0010 – Multi-sprog kontraktanalyse

Dato: 2026-02-24  
Kilde: IDEBANK.md; IDEBANK_MERGED_2026_02_28.md  
Status: Under vurdering  
Problem: Kontrakter kan forekomme på flere sprog end dansk.  
Mulig løsning: Dansk som baseline og senere engelsk, tysk og fransk med evt. differentieret token-beregning.  
Forretningsværdi: Gør kontraktmodulet anvendeligt i flere kunderelationer og internationale projekter.  
Risiko: Juridiske termer og risiko-score kan ændre betydning mellem sprog.  
Afhængigheder: Sprogdetektion, oversættelsesstrategi, RAG, evalueringssæt pr. sprog, token/cost model.  
Noter: Bør vente til baseline dansk kvalitet er stabil.

---

### IDE-0011 – Advanced Risk Wizard

Dato: 2026-02-24  
Kilde: IDEBANK.md; IDEBANK_MERGED_2026_02_28.md  
Status: Under vurdering  
Problem: Standard risikospørgsmål kan være for grove til premium/branchebrug.  
Mulig løsning: Udvidet wizard med fx 20 spørgsmål i stedet for 10 og branche-specifik risikomodel.  
Forretningsværdi: Mulighed for premium-differentiering og mere præcis rådgivning.  
Risiko: Mere friktion for brugeren og risiko for falsk præcision.  
Afhængigheder: Risk scoring engine, branchemodeller, UX-test, evalueringsdata.  
Noter: Bør vurderes efter første risk model er dokumenteret.

---

### IDE-0012 – Tenant branding

Dato: 2026-02-24  
Kilde: IDEBANK.md; IDEBANK_MERGED_2026_02_28.md  
Status: Under vurdering  
Problem: Enterprise-kunder kan ønske at FD føles som deres egen platform.  
Mulig løsning: Tenant branding med logo, farvetema og egen subdomain.  
Forretningsværdi: Øget enterprise-fit, mere professionel kundevendt oplevelse og mulig premium feature.  
Risiko: For meget branding kan skade FD-identitet og øge support/design-kompleksitet.  
Afhængigheder: Tenant config, asset upload, theming boundaries, custom domain/subdomain governance.  
Noter: Skal respektere FD dark shell og ikke give frontend sandhed over permissions.

---

### IDE-0013 – KPI modul

Dato: 2026-02-24  
Kilde: IDEBANK.md; IDEBANK_MERGED_2026_02_28.md  
Status: Under vurdering  
Problem: Ledere har brug for samlet overblik over fravær, ressourceudnyttelse og AI-forbrug.  
Mulig løsning: KPI-modul med fraværsprocenter, ressourceudnyttelse og AI-forbrug pr. bruger.  
Forretningsværdi: Ledelsesoverblik, bedre drift og mulighed for enterprise dashboards.  
Risiko: KPI'er kan misforstås eller blive for brede uden klare datakontrakter.  
Afhængigheder: Data governance, rollebaseret adgang, audit, E-Komplet/fitter data, AI usage logging.  
Noter: Bør bygges modulært og tenant-isoleret.

---

### IDE-0014 – Dokument-sikkerhedslag

Dato: 2026-02-24  
Kilde: IDEBANK.md; IDEBANK_MERGED_2026_02_28.md  
Status: Under vurdering  
Problem: Dokumenter kan indeholde følsomme oplysninger og skal kunne håndteres sikkert ved roller, fravær, død eller password-tab.  
Mulig løsning: Rollebaseret dokumentadgang, nøgleperson-adgang ved fravær/død og recovery flow ved password-tab.  
Forretningsværdi: Øger tillid og enterprise/compliance-parathed.  
Risiko: Recovery-flows kan skabe sikkerhedshuller, hvis governance er uklar.  
Afhængigheder: RBAC, audit, storage policy, recovery governance, tenant admin workflows.  
Noter: Skal koordineres med dokumentmodul og security model.

---

### IDE-0016 – Marketplace og partner-integrationer

Dato: 2026-02-24  
Kilde: IDEBANK.md; IDEBANK_MERGED_2026_02_28.md  
Status: Under vurdering  
Problem: Fielddesk kan få behov for eksterne moduler og partnerintegrationer uden at alt bygges i core.  
Mulig løsning: Marketplace for eksterne moduler og partnerintegrationer.  
Forretningsværdi: Økosystem, partnerkanal og bedre modularitet.  
Risiko: Governance, sikkerhed, support og module lifecycle kan blive svært.  
Afhængigheder: Module registry, permissions, tenant enablement, API boundaries, partner contracts.  
Noter: Bør vente til intern modulmodel er stærk.

---

### IDE-0017 – Public API access

Dato: 2026-02-24  
Kilde: IDEBANK.md; IDEBANK_MERGED_2026_02_28.md  
Status: Under vurdering  
Problem: Kunder/partnere kan få brug for programmatisk adgang til Fielddesk-data og workflows.  
Mulig løsning: Dokumenteret REST API med OAuth-adgang.  
Forretningsværdi: Integrationsmuligheder, enterprise-salg og partnerøkosystem.  
Risiko: Sikkerheds- og supportomkostninger; stor risiko ved forkert tenant isolation.  
Afhængigheder: OAuth, API docs, scopes, rate limits, audit, versionering.  
Noter: Må ikke bygges før tenant/RBAC/audit er helt solidt.

---

### IDE-0018 – Enterprise onboarding og demo eligibility

Dato: 2026-02-22  
Kilde: IDEBANK.md; IDEBANK_MERGED_2026_02_28.md  
Status: Under vurdering  
Problem: Demo/signup kan give økonomisk og integrationsmæssig risiko, hvis alle får fuld adgang uden vurdering.  
Mulig løsning: Enterprise demo flow med CVR validation, risk scoring, EAN format check, demo statuses og feature locking indtil godkendelse.  
Forretningsværdi: Mere kontrolleret onboarding, bedre enterprise pipeline og mindre misbrug.  
Risiko: Kan gøre signup tungere og kræver eksterne datakilder.  
Afhængigheder: CVR lookup, EAN/GLN validation, credit bureau, tenant lifecycle, usage limits.  
Noter: Konsolideres med onboarding risk model, men holdes som separat procesidé.

---

### IDE-0019 – Onboarding risk model

Dato: 2026-02-22  
Kilde: IDEBANK.md; IDEBANK_MERGED_2026_02_28.md  
Status: Under vurdering  
Problem: Der mangler en struktureret score til at afgøre billing eligibility ved demo/signup.  
Mulig løsning: Risk score 0-100 baseret på CVR, company name, EAN, invoice email, reference person, CVR registry, credit bureau og GS1/EAN lookup. Decision matrix: auto approved, review, Stripe-only eller blocked.  
Forretningsværdi: Gør demo- og betalingsflow mere robust og automatiserbart.  
Risiko: Fejlklassificering kan blokere gode kunder eller åbne for dårlige.  
Afhængigheder: CVR registry, credit bureau API, GS1/EAN lookup, audit, manual review flow.  
Noter: Relateret til IDE-0018, men mere konkret datamodel/score.

---

### IDE-0020 – Support Agent som embedded consultant

Dato: Ukendt legacy  
Kilde: IDEBANK.md; IDEBANK_MERGED_2026_02_28.md  
Status: Under vurdering  
Problem: Support kan være mere end FAQ, men må ikke få ukontrolleret adgang til kundedata.  
Mulig løsning: Support Agent der kan se rolle, tenant, feature usage og relevante logs, generere guides, oprette tickets og forklare fx hvorfor risiko-score er høj.  
Forretningsværdi: Bedre onboarding, lavere supportbyrde og højere retention.  
Risiko: Support-agenten kan lække data eller give forkerte forklaringer uden guardrails.  
Afhængigheder: Scoped support data, logs, role model, ticket integration, policy guardrails.  
Noter: Skal ikke have direkte adgang til kontrakter uden eksplicit scope.

---

### IDE-0021 – Drift, SLA og redundans

Dato: Ukendt legacy  
Kilde: IDEBANK.md; IDEBANK_MERGED_2026_02_28.md  
Status: Under vurdering  
Problem: Fielddesk skal kunne sælges til kunder med driftskrav, men høj tilgængelighed kræver klare SLO/SLA-valg.  
Mulig løsning: Definér SLA-niveauer som produkt, byg logging, monitoring, incident playbook, backups/restore-test, rate limits, circuit breakers og senere HA/multi-region efter enterprise-behov.  
Forretningsværdi: Tillid, enterprise-parathed og bedre incident-håndtering.  
Risiko: Multi-region/HA kan blive overkill for tidlig fase og øge omkostninger.  
Afhængigheder: Managed DB, backups, monitoring, status page, queue/retry, idempotente API'er, runbooks.  
Noter: Start med hurtig recovery og design for senere failover.

---

## 🔵 Vilde tanker

### IDE-0015 – Dedikeret AI resource

Dato: 2026-02-24  
Kilde: IDEBANK.md; IDEBANK_MERGED_2026_02_28.md  
Status: Vild tanke  
Problem: Enterprise-kunder kan kræve isolation af AI-forbrug, region og token budget.  
Mulig løsning: Dedikeret Azure OpenAI resource, egen region og separat token budget for udvalgte kunder.  
Forretningsværdi: Enterprise compliance og premium SaaS-tier.  
Risiko: Driftsomkostninger, provisioning og support bliver markant mere komplekst.  
Afhængigheder: Cloud provider setup, tenant billing, AI routing, observability.  
Noter: Kun relevant ved stærke enterprise-krav og derfor flyttet til vilde tanker som special-case enterprise-spor.

---

### IDE-0022 – Self-hosted GPU option

Dato: 2026-02-24  
Kilde: IDEBANK.md; IDEBANK_MERGED_2026_02_28.md  
Status: Vild tanke  
Problem: Enkelte kunder kan have krav om særligt isoleret AI-drift.  
Mulig løsning: Self-hosted GPU option som separat SaaS-tilbud ved særlige krav.  
Forretningsværdi: Kan åbne meget specielle enterprise/compliance cases.  
Risiko: Meget høj drift, support, sikkerhed og hardware-kompleksitet.  
Afhængigheder: AI hosting strategy, kundekontrakter, model deployment, observability.  
Noter: Ikke relevant for normal FD roadmap.

---

## ⚫ Delvist realiseret / Overhalet af nyere arbejde

### IDE-0001 – Operational Execution Foundation

Dato: 2026-02-28  
Kilde: IDEBANK_MERGED_2026_02_28.md  
Status: Delvist realiseret / overhalet af nyere arbejde  
Problem: Fielddesk startede som Q&A og intern koordinering ovenpå E-Komplet, men skal kunne blive et egentligt operational execution layer med KS, audit og rapportering.  
Mulig løsning: Et Execution Board pr. sag med roller, WorkItems, KS-upload motor, upload counters, manuel override, FD-lukning, rapportmotor og source_snapshot_hash. E-Komplet håndterer sagsnr., timer, økonomi og fakturering; FD håndterer roller, opgaver, KS, uploads, audit og rapporter.  
Forretningsværdi: Gør FD til daglig drifts- og dokumentationsplatform, ikke kun et hjælpeværktøj. Skaber revisionsklar historik og stærkere projektstyring.  
Risiko: Meget stort scope; kræver klare module boundaries, tenant isolation, rapport-retention, storage-policy og audit-design.  
Afhængigheder: E-Komplet projektdata, projektroller, storage, audit, rapportmotor, projektlukning, module governance.  
Noter: Flyttet fra "Godkendt – afventer plan", fordi nyere QA/project-context/runtime module-arbejde allerede har realiseret dele af foundation-retningen. WorkItems, KS, rapportmotor og fuld execution layer er stadig ikke realiseret.

---

### IDE-0023 – Server-side scoping og tenant isolation

Dato: Ukendt legacy  
Kilde: IDEBANK.md; IDEBANK_MERGED_2026_02_28.md  
Status: Delvist realiseret / overhalet af nyere arbejde  
Problem: Frontend kan manipuleres, så backend må aldrig stole på tenant_id eller permissions fra browseren.  
Mulig løsning: Backend validerer token, tenant, rettigheder og tvinger alle DB-queries til tenant/user scope. RLS kan senere supplere backend policy layer.  
Forretningsværdi: Grundlæggende SaaS-sikkerhed og datatillid.  
Risiko: Manglende scoping er "game over" for multi-tenant SaaS.  
Afhængigheder: Auth, tenant resolution, RBAC, query policy, evt. RLS.  
Noter: Nyere FD-foundation har tenant isolation og module access som centrale principper, så idéen er delvist realiseret som foundation-princip.

---

### IDE-0024 – Proper logging, audit og AI-telemetri

Dato: Ukendt legacy  
Kilde: IDEBANK.md; IDEBANK_MERGED_2026_02_28.md  
Status: Delvist realiseret / overhalet af nyere arbejde  
Problem: Systemet skal kunne forstå, bevise og genskabe hændelser uden at lække følsomme data.  
Mulig løsning: Struktureret logging med request-id, user_id, tenant_id, endpoint, status, latency, fejltype og feature. For AI-kald også model, tokens, cost, latency, RAG-kilder og sikkerhedsflags.  
Forretningsværdi: Fejlsøgning, audit, cost control, kvalitet og misbrugsdetektion.  
Risiko: Logging kan selv blive datalæk, hvis prompts, kontrakter, tokens eller persondata logges råt.  
Afhængigheder: Audit service, redaction, retention, request IDs, AI telemetry model.  
Noter: Nyere FD-foundation har audit service og runtime audit logging; AI-telemetri/cost logging er stadig en fremtidig udvidelse.

---

### IDE-0025 – QA / intern koordinering mellem teknikere og ledere

Dato: 2026-02-28  
Kilde: IDEBANK_MERGED_2026_02_28.md  
Status: Delvist realiseret / overhalet af nyere arbejde  
Problem: Oprindelig Fielddesk-idé var Q&A-side og intern koordinering ovenpå E-Komplet med bedre daglig struktur pr. sag.  
Mulig løsning: Projektorienteret dialog/Q&A mellem teknikere og ledere, senere som del af et bredere Operational Execution Layer.  
Forretningsværdi: Hurtigere afklaringer pr. sag og mindre tabt projektviden.  
Risiko: Kan blive løs chat, hvis den ikke bindes til projekt, roller, audit og module access.  
Afhængigheder: Project context, QA module, tenant auth, audit, module access.  
Noter: Nyere QA backend/frontend arbejde betyder at denne idé er delvist realiseret; den bredere OEF/KS-retning ligger stadig i IDE-0001.

---

## 🔴 Afvist / Arkiveret

Ingen idéer arkiveret i denne konsolidering.
