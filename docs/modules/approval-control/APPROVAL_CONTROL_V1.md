# Godkendelseskontrol V1

Aktuel status, 23. oktober 2026 kl. 13.56, Europe/Copenhagen:
**ADMINSTYRING UDRULLET OG READ-ONLY VERIFICERET; GODKENDELSESKONTROL ER
FORTSAT DEAKTIVERET UDEN STARTDATO**. Kodecommit `4e1f641` er live som
Render-webdeploy `dep-dbdkm30u01pc73cqmoag`. Ingen migration er anvendt.
Tenant-admin kan selv tage stilling til aktivering via
[aktiverings-/pausekontrakten](#lokal-adminstyring); deploy er ikke aktivering.
HC's eksisterende JEL-CC er bevaret. Se den aktuelle deploykvittering nedenfor.

Dateret fase 1-status: **FASE 1 UDRULLET OG VERIFICERET; PRODUKTIONSAKTIVERING IKKE GODKENDT**,
23. oktober 2026 kl. 10.46, Europe/Copenhagen. Produktionskode `080b902` og
auditmigrationer 0062/0063/0064 er udrullet; se fase 1-beviset nedenfor.
Tidligere lokale implementerings-/testresultater er ikke i sig selv deploybevis.
Før produktionsaktivering findes ingen aktiv kontrolperiode eller automatisk mail.
Feature: `approval_control`. Ingen scheduler er tilkoblet eller aktiveret;
ingen rigtig mail eller medarbejdermail er sendt fra Godkendelseskontrol.

## Korrigeret beslutning: eksisterende scope=mine

Dennis har udtrykkeligt fastlagt, at den eksisterende sagsoversigt er V1's
autoritative projektomfang. Den tidligere foreslåede EK-GUID-gate er derfor
**forkastet som krav for denne funktion**, ikke en opgave der skal løses.

`verified`: `GET /api/projects?scope=mine` i
[tenantSurfaceRoutes](../../../backend/src/routes/tenantSurfaceRoutes.js)
kalder direkte `projectQueries.listProjectsForUser(client, { tenantId, userId })`.
Den nye [scope-adapter](../../../backend/src/modules/approvalControl/approvalControl.scope.js)
kalder **præcis samme funktion** med backendafledt tenant og aktør.
Ingen kopierede SQL-adgangsprædikater, alternativ identitetsmodel eller ekstra
ansvarligfilter. `findProjectForUser` er ikke en erstatning for den fulde liste,
som også har lifecyclefiltre og referencebaseret deduplikering.

`verified`: tenant-host og adgangstoken valideres; `requireAuth` genlæser
tenantbruger, aktiv loginstatus og sessionversion fra databasen.
Projektfunktionens eksisterende ansvarligkode-, teamlederkode-, ejer- og
assignment-grene bevares uændret. Dette er den allerede eksisterende
autorisationsmodel, **ikke ny udledning fra initialer** i Godkendelseskontrol.

Listen vedligeholdes af eksisterende projektsync, tenant-admins autoriserede
assignment-handlinger og worksheet-assignment-materialisering. Godkendelseskontrol
læser kun resultatet; den opretter, ændrer, reparerer eller forfrisker ikke disse
relationer. Kildeansvarligens GUID er hverken krav eller fallback.

### Faktisk read-only scope-kontrol

`observed`: **22. oktober 2026 kl. 23.52.56, Europe/Copenhagen**
(`2026-10-22T21:52:56.340Z`). Den eksisterende funktion blev kaldt direkte for
DEP i en tvungen read-only transaktion, afsluttet med ROLLBACK:

| Kontrol | Resultat |
| --- | --- |
| DEP's scope=mine | **64 sager** |
| 80396-003 | Med |
| 9015 | **Ikke med** |

Lokalt observationsbevis: `.tmp/approval-control-audit/scope-mine-evidence.json`.
Ingen EK-kald, manuelle Timekontrol-kørsler eller produktionsskrivninger blev
udført. Dette er en dateret observation; nye previews genlæser scope.

## EK-status og datagrundlag

Dennis har efterfølgende eksplicit bekræftet HC-reglen:
**begge tilstedeværende felter `approvedBy=null` og `approvedDate=null` betyder
afventer godkendelse** i den fulde FitterHours-respons. Det er en konkret
HC-domænebekræftelse, ikke en universel antagelse for andre tenants.

| Kildedata | Klassifikation | Preview |
| --- | --- | --- |
| Begge felter findes og er præcis JSON null | Afventer godkendelse | Medtages kun inden for scope=mine |
| Ikke-tom godkender og gyldig godkendelsesdato | Godkendt | Udelades |
| Manglende felt, tom streng, ugyldig dato eller modstrid | Afventer dataklaring | Særskilt begrundelse; aldrig i mailbeholdning |

Det tidligere [før/efter-bevis](../time-control/EK_RESOURCE_GROUP_OWNERSHIP_MATRIX.md#manglende-godkendelse)
for ID 360926, 360927, 360931 og 360932 på 9015 understøtter felternes betydning:
29 timer gik fra null/null til DEP og udfyldt dato efter normal EK-godkendelse.
Det er historisk dokumentation, ikke en frisk godkendelsesstatus. Tidligere
`ApprovedBy=DEP` gør ikke 9015 til DEP's sag.

Kilden er `GET /api/v4/paginatedfitterhours`, med eksplicit datoperiode,
`page` og `pageSize=100`. Den officielle lokale OpenAPI indeholder felterne
`id`, `projectID`, `date`, `hours`, `fitterID`, `fitterName`,
`approvedBy` og `approvedDate`. Projekt-detaljens smallere `fitterHours[]`
har ikke begge godkendelsesfelter og bruges derfor ikke som statuskilde.

[Readeren](../../../backend/src/modules/approvalControl/approvalControl.source.js)
kræver to ens komplette passes: stabile totals, entydige ID'er, korrekt
pagination og terminalside. API-fejl, dubletter, ustabil godkendelse og afkortet
udtræk blokerer hele previewet. Ingen automatisk retry, delta eller sync.
Maksimum syv kalenderdage, 20 sider pr. pass, 40 GETs og 30 sekunder i alt,
højst 8 sekunder pr. request inklusive læsning af svaret.

Endpointet har intet dokumenteret projekt-ID-filter. Readeren læser derfor
den afgrænsede tenantperiode i hukommelsen, men kun rækker koblet via de
allerede eksisterende tenantafgrænsede EK-projektrelationer til de returnerede
`scope=mine`-projekt-ID'er kan indgå i resultat, tællere, audit og mailpreview.
Der opfindes ikke et EK-filter. Ukendt/ugyldig projektrelation vises som
dataklaring for den autoriserede sag.

## Afgrænset live-verifikation 23. oktober 2026

`observed` / `verified`: ét kontrolleret capture for **19.-23. oktober 2026**,
den aktuelle arbejdsuge ved kontrollen. EK-læsning **23. oktober kl.
00.30.02-00.30.13, Europe/Copenhagen**
(`2026-10-22T22:30:02.131Z` til `2026-10-22T22:30:13.173Z`).
Efterkontrol afsluttet kl. 00.30.16. Perioden er ikke et udtræk af alle
historisk åbne godkendelser eller en gentagelse af ugen 12.-16. oktober.

Den implementerede `service.preview` og EK-reader blev kørt direkte i en
isoleret proces med de eksisterende HC-credentials. Alle databaseforbindelser
var tvunget read-only, og den faktiske `listProjectsForUser` blev kaldt før
og efter capture. Kun admission- og auditfunktionernes produktionsskrivninger
blev erstattet i hukommelsen; beskyttet tidsvindue og nyligt capture blev
kontrolleret med læsninger. Ingen produktions-HTTP-preview, auditrecord,
advisory claim, outbox, mail eller scheduler blev kaldt/oprettet. Dette
verificerer **reader, projektudvælgelse og preview**, ikke den endnu
uudrullede produktionsrute eller audit/admission under samtidighed.

### Resultat og dækning

| Kontrol | Faktisk resultat |
| --- | --- |
| DEP's uændrede `scope=mine`, før/efter | **64 sager**; 80396-003 med, 9015 ikke med |
| Eksisterende EK-projektrelationer | Ingen manglende relationer i DEP-scope |
| Komplet tenantudtræk | **928 unikke rækker pr. pass**, ikke 1.856 registreringer |
| Pagination | 10 sider pr. pass, 100 pr. side og 28 på terminalside; 20 GETs i ét capture |
| Stabilitet | Begge komplette passes ens på readerens nødvendige felter; alle svar HTTP 200 uden API-fejl |
| Rækker på DEP's sager i perioden | **42** |
| Begge godkendelsesfelter eksplicit null | **9 rækker, 66,5 timer**, fordelt på 3 sager |
| Dokumenteret godkendt, korrekt udeladt | **33 rækker, 246,5 timer** |
| Dataklaringsrækker | **0**; ingen observerede fejltyper eller manglende godkendelsesfelter i de 42 rækker |
| Ældste åbne arbejdsdato | 22. oktober 2026 |
| Rækker på 9015 | 28 i tenantudtrækket, **ingen i DEP-previewet** |

En uafhængig klassifikation af de nødvendige råfelter gav præcis samme åbne
EK-ID'er, godkendt-antal og ukendt-ID'er som previewet. Rækkeidentitet,
projektkobling/reference, medarbejder-ID/navn, arbejdsdato, timer og
godkendelsesfelter blev sammenholdt; summer, sagsgrupper og ældste dato
matchede. Ingen gentagne EK-ID'er. Ingen afvigende sagsreferencer mellem
EK-rækker og Fielddesk. Feature- og scope-kildefilers SHA-256 var uændret
før/efter kontrollen.

| Sag | Åbne rækker | Timer |
| --- | ---: | ---: |
| 80548 | 4 | 29 |
| 80396-003 | 3 | 22,5 |
| 80279-003 | 2 | 15 |

### Genkendelig stikprøve

Alle tre rækker har `approvedBy=null` og `approvedDate=null` i EK og status
afventer i previewet. Tabellen er kun et eksempel, ikke hele beholdningen.

| EK-række-ID | Sag | Medarbejder | Arbejdsdato | Timer |
| --- | --- | --- | --- | ---: |
| 361429 | 80548, NN HI 25B / Security project Phase 2 | Michael Peter Jensen | 22.10.2026 | 7,5 |
| 361847 | 80396-003, NNPR/KNSF - Køge - Sikring | Martin Uth Møller | 22.10.2026 | 7,5 |
| 361877 | 80279-003, Novo Nordisk KA bygn. JF - SIKRING | Mikkel Hyldebo Jensen | 22.10.2026 | 7,5 |

`observed`: Martin har **tre forskellige EK-ID'er** 361847/361848/361849
med samme sag, arbejdsdato og 7,5 timer; Mikkel har to, 361877/361881.
De medtages som selvstændige kilderækker, ikke som gentagne sync-linjer.
Det nødvendige feltudsnit dokumenterer ikke, om der er tale om forskellige
løndele eller fejlregistreringer. Tallene er derfor **registreringernes
timemængde**, ikke bevis for unikke arbejdstimer. Dette bør gennemgås i EK,
før tallene eventuelt bruges som arbejdstid; der er ikke foretaget nye
detailkald eller automatisk sammenlægning.

### Grænser ved ovenstående live-kontrol

Dette var status ved den daterede læsekontrol, før den efterfølgende lokale
mailimplementering nedenfor. Det er ikke en aktivering af maildrift.

- Ingen observeret status-/projektkontraktfejl i denne afgrænsede læsning.
  Null-parrets betydning bygger fortsat på Dennis' eksplicitte HC-bekræftelse;
  kontrollen beviser ikke en universel godkendelsespligt for andre tenants.
- Resultatet er et dateret øjebliksbillede for den valgte periode, ikke alle
  historiske restancer. Ukendte felter/statusser ville blive udeladt med
  dataklaringsårsag; ingen sådanne typer blev observeret her.
- Migration 0062 og produktionsdeploy er fortsat ikke udført. Denne kontrol
  beviser ikke produktionsaudit, HTTP-adgang eller admission-låse i drift.
- Ingen sender, permanent afsendelsesclaim, interval-idempotens eller scheduler
  er implementeret/aktiveret. Ny scope- og godkendelsesvalidering før en
  fremtidig afsendelse samt særskilt godkendelse er nødvendig. Snapshot må ikke
  senere sendes ukritisk, fordi godkendelser og adgang kan være ændret.
- Mailpreviewets To er `dep@hoyrup-clemmensen.dk`, CC tom; `sending_enabled`
  og `scheduler_enabled` er false, `delivery=not_attempted`. Dette er ikke
  mailtransportbevis eller tilladelse til udsendelse.

Lokalt, ikke-versioneret observationsbevis med nødvendige DEP-råfelter,
preview, paginationsmetadata og kildehashes:
`.tmp/approval-control-audit/20261023-live-readonly-capture.json`.
To indledende lokale harnessproblemer stoppede før første EK-kald: manglende
lokal miljøværdi samt adapterhåndtering af SQL-kommentar/callback. De blev
rettet alene i kontrolprocessen. Ingen featurekode eller produktionsdata blev
ændret; der blev gennemført præcis ét EK-capture og ingen automatisk retry.

## Implementeret V1

- DEP alene i HC, valideret mod den eksisterende aktive session/tenantbruger.
  Ingen ny identitetskonfiguration, GUID-linkning, tabel eller identitetskæde.
- Manuel POST-preview; intet EK-kald ved sidevisning eller statusopslag.
  Valgfrit `project_id` kan kun indsnævre den eksisterende liste. Ukendte
  requestfelter, `scope=all`, aktør-/tenantvalg, modtagere og sendeflag afvises.
- Scope genlæses efter EK-læsning. Ændret projektliste/relation blokerer resultatet.
  Alle projektrelationer og timelinjer afgrænses server-side. En ændret URL
  kan ikke tilføje 9015 eller andre ikke-autoriserede sager.
- Deduplikering på tenant + EK-registrerings-ID. Modstridende dubletter giver
  dataklaring, aldrig første/sidste-række-vinder. Senere godkendelse fjerner
  rækken fra næste friske preview.
- Sagsgrupperet liste og mailpreview med sag, sagsnavn, medarbejder, arbejdsdato,
  timer og status; totals, ældste arbejdsdato og konkret Fielddesk-filterlink.
  To er den aktuelle sessionsbrugers gemte mail, CC er altid tom.
  Det manuelle preview har **ingen** sendeknap eller providerkald og opretter
  ingen mailclaim. Det særskilte, deaktiverede mailjob er beskrevet nedenfor.
- Separat side under Drift: `/tenant/approval-control.html`. Seneste gemte
  kontrol, antal åbne rækker/projekter, timer, ældste dato og dataklaring.
  Historiske rækker vises kun, hvis deres sag stadig er i aktørens aktuelle scope.
  V1 giver ikke tenant-admin en ekstra tenantbred projektadgang.
- Fejl i kilde/audit blokerer preview og vises på siden. Fejlkoder findes i
  separat kørselsaudit; ingen ændring af Timekontrols driftsoverblik.
- En tenantbred, ikke-blokerende advisory admission-lås i egen namespace 6121
  forhindrer samtidige previews på tværs af processer. Der er 60 sekunders
  pause efter hvert optaget capture-forsøg, uafhængigt af beholdningsdeduplikering.
  Faktisk klokkeslæt genkontrolleres efter databaseventetid og lige før læsning.
  Source-read, reautorisation og audit er under
  samme admission. Statusopslag læser kun databasen.
- Preview er lukket tirsdag-fredag 08.59-09.30 og fredag 11.59-14.31,
  Europe/Copenhagen. Det er **nye preview-begrænsninger**, ikke ændrede
  Timekontrol-vinduer. Tidszone/DST testes. Ingen eksisterende worker,
  kø, capture, head, lock, mailregel eller rateindstilling ændres.

## Audit uden ny tabel

Eksisterende `audit_event` anvendes, adskilt med `module_key=approval_control`
og nye events `approval_control.capture_admitted`, `approval_control.previewed`
og `approval_control.preview_failed`.
[Migration 0062](../../../migrations/0062_approval_control_audit_events.sql)
udvider kun den eksisterende eventtype-constraint med OR og bevarer hele den
gamle expression. Ingen datarækker, flags, modtagere, roller eller tabeller
ændres. Lock-timeout er 3 sekunder og statement-timeout 30 sekunder; timeout
ruller migrationen tilbage. Anvendelse/validering kan kræve tabellås og skal
planlægges ved en senere godkendt udrulning. Eksisterende migrationer er urørte.

Audit gemmer aktør, modtager, perioder, faktiske kilde-/køretider, inkluderede
linjer, ukendte linjer, tællere, beholdningsfingerprint, resultat og eksplicit
`mail_attempted=false`, `provider_id=null`.
En separat audit-xact-lås i namespace 6120 serialiserer aktørens audit.
Gentagelse af samme kildeobservation og beholdning genbruger samme record.
En frisk capture får eget tidspunkt/audit, også ved uændret beholdning;
A → B → A opretter en ny A-observation, så seneste status ikke peger på B.
Capture-start gemmes særskilt og kan vises som startet uden afsluttet resultat.
Dette er preview-idempotens, **ikke** en implementeret tilladelse til senere mail.

Migration 0062 skal være anvendt, før preview kan gemme nye eventtyper.
Auditfejl giver ingen succesbesked og ingen frigivet mailbeholdning.
Migration 0062 er anvendt i den senere fase 1-udrulning, se produktionsbeviset nedenfor.

## API og manuel verifikation

- `GET /api/approval-control/status`: HC/DEP med aktuel scope-autorisation;
  seneste manuelle preview vises kun som audit-ID/tidspunkt/resultat, ingen
  historiske rækker eller timetal uden et udtrykkeligt interval-preview.
- `POST /api/approval-control/preview`: JSON `from_date`, `to_date` og valgfrit
  `project_id`; ingen andre felter eller query-parametre.
- Begge kræver tenant-host, aktiv adgangstoken/session og tenantmatch.
- Manuel preview aktiverer ikke udsendelse. Det efterfølgende deaktiverede
  hverdagsmailjob er beskrevet nedenfor. Andre intervaller og faktisk
  aktivering kræver særskilt godkendelse; previewets To/CC giver ikke sendetilladelse.

## Mailjob V1, implementeret lokalt og slukket

### Regel og projektomfang

Dennis har godkendt lokal implementering, ikke aktivering eller rigtig mail.
Dennis har godkendt **mandag-torsdag kl. 14.30 og fredag kl.
14.31, Europe/Copenhagen**. V1 er rent fremadrettet fra faktisk
produktionsaktivering, ikke historisk oprydning. Kun en
start i det konfigurerede minut tillades; ingen efterfølgende indhentning af
mistede dage. Faktisk start og kildetid gemmes uden tilbagedatering. Weekender
udelades; danske helligdage er ikke særskilt filtreret.

Jobbet genbruger `scope.loadMine` og dermed den uændrede
`listProjectsForUser`. Tenant skal stadig være aktiv med aktivt, verificeret
domæne; den eksisterende HC/DEP-bruger skal være aktiv og have sin eksisterende
DEP-mailadresse. Ingen ny bruger-, GUID-, fitter- eller gruppemapping.
Scope og modtager genlæses efter EK-læsningen og lige før provideradgang.
Ændrede relationer, manglende EK-projektrelationer eller usikker kilde blokerer.

Kun eksplicit `approvedBy=null` **og** `approvedDate=null` kan medtages.
Arbejdsdato skal være i dag eller tidligere i København; fremtidige datoer
kan aldrig udløse mail. Godkendte og dataklaringsrækker udløser ikke mail.
Dataklaring vises særskilt; kendte, gyldige åbne rækker kan stadig medtages.
9015 er fortsat ude, så længe den ikke er i DEP's faktiske `scope=mine`.

EK-ID er fortsat linjens identitet. Flere ID'er med samme person/sag/dato/timer
bevares. Kun mailens visning grupperer pr. sag og medarbejder/dato med
summerede timer og antal registreringer. Audit beholder de enkelte ID'er.

### Produktionsaktivering bestemmer perioden

Denne regel erstatter den tidligere faste kalenderperiode. Kun arbejdsdatoer
fra og med tenantens **første faktiske produktionsaktiveringsdato** til og med
kontroltidspunktets lokale dato er mailberettigede. Før aktivering er
`coverage_from`, `coverage_to` og næste driftskørsel null; ingen EK-capture,
dagsclaim eller automatisk mail frigives. Miljøflags alene skaber ingen periode.

Aktiveringsdatoen fastlåses automatisk ved tenantens produktionsaktivering.
Der findes ingen startdatoparameter eller fallback til dagsdatoen ved en senere
jobkørsel. `APPROVAL_CONTROL_COVERAGE_FROM` er ikke en gyldig datokilde;
en efterladt override blokerer frem for at ændre perioden.

UI og mailens HTML/plain-text-fodnote bruger den gemte dato og formuleringen
**Kontrollen omfatter registreringer fra og med [aktiveringsdato].**
Før aktivering står der **Ingen aktiv kontrolperiode**. Starten flyttes ikke
ved pause, genstart, genaktivering, brugerændring eller årsskifte. Ingen
tenant-admin-editor til tilbagedatering eller ændring af første go-live etableres.

Historiske åbne eller ugyldige godkendelser før denne arbejdsdato indgår
hverken i mail, åbne driftsrækker eller dataklaringsfejl. Gamle job uden den
samme aktiveringskvittering vises ikke som aktuelle driftsresultater.
Historik undersøges kun i et udtrykkeligt manuelt preview med valgt interval;
preview ændrer aldrig aktivering, dato eller mailbeholdning for dagsjobbet.
Det automatiske statusopslag giver kun metadata (audit-ID, tidspunkt og resultat)
om tidligere manuelle previews, aldrig historiske timerækker, timetal eller
dataklaringsårsager. Rådata og fuld audit bevares uændret.

Den eksisterende reader modtager det eksplicitte interval, ikke EK's
årsstandard. Det manuelle previews syvdagesgrænse er uændret. Jobbet genbruger
to komplette passes, højst 20 sider à 100 rækker pr. pass, 40 GETs/30 sekunder
og ingen retries. **Over 2.000 tenantrækker i intervallet eller overskredet
budget blokerer hele jobbet**, ikke kun de sidste rækker. Ingen skjult
forkortelse af intervallet eller delvis mail. Der foretages **ingen undersøgelse
eller udvidelse af loftet for historiske data**: disse indgår ikke i den
planlagte kontrol. Budgetoverskridelse på fremtidige driftsdata håndteres som
en synlig kildefejl uden mail; datakravene er ikke lempet. Ingen live-læsning
er foretaget som del af mailimplementeringen.

### Uforanderlig aktiveringskvittering

Nedenstående aktiveringsindgang beskriver fase 1-koden. Den nye lokale
adminstyring bevarer 0064-kvitteringen, men erstatter operatør-/masterflagkravet
med den atomiske tenanttilstand beskrevet i [Lokal adminstyring](#lokal-adminstyring).
Det er endnu ikke en ændring af den deployede drift.

[Migration 0064](../../../migrations/0064_approval_control_scheduler_activation.sql)
udvider kun eksisterende audit med `approval_control.scheduler_activated`,
en metadata-constraint og et unikt partielt indeks pr. tenant. Ingen ny tabel,
identitetsmapping eller ændring af tidligere migrationer. Tidsstempel hentes
én gang fra databaseuret, efter tenantens aktiveringslås i namespace 6123;
startdatoen afledes fra netop dét tidspunkt i Europe/Copenhagen. Kaldende
klient, URL, miljøværdi og applikationsur kan ikke levere eller tilbagedatere den.

Aktivering kræver produktionsmiljø, eksplicit scheduler-mastergate,
bekræftelse samt den eksisterende aktive HC/DEP-bruger og tenant. Kommandoen
er grænsen for tenantens aktivering og skal indgå i den senere, særskilt
godkendte aktivering af den faktiske scheduler, ikke først i et forsinket job.
Den provisionerer ikke Render eller sender mail. Første kvittering vinder
ved samtidighed; senere genaktivering genbruger den, uden en ny dato.
Statusopslag, preview, simulation og almindelige job kan kun læse kvitteringen.

Hvert dagsclaim/audit og mailpayload bindes til aktiverings-ID, faktisk
aktiveringstid og lokal startdato. Mail/afsendelsesidempotens er ellers uændret.
Migreringen er anvendt i fase 1; ingen aktiveringskvittering eller startdato er oprettet.

### Senere effektstatistik

Effektstatistik for Godkendelseskontrol skal starte ved denne features
faktiske produktions-go-live; Timekontrol-statistik skal tilsvarende bruge
Timekontrols egen verificerede go-live. Gamle EK-data, historiske/manuelle
kontroller og previews er ikke dokumentation for systemets effekt og må ikke
tælles, som om systemet påvirkede dem. Ingen statistikfunktion eller ændring
af aktiv Timekontrol implementeres i denne rettelse.

### Fredag og beskyttelse af Timekontrol

Den eksisterende admission/lås, cooldown og beskyttelsesvinduer genbruges
uændret. **Fredag kl. 14.30 er fortsat blokeret til kl. 14.31**. Godkendelseskontrol
har derfor nu den udtrykkeligt godkendte fredagsstart **14.31**, uden undtagelse
fra beskyttelsen. `APPROVAL_CONTROL_FRIDAY_TIME` kan udelades eller være
`14:31`; anden værdi blokerer jobbet. Mandag-torsdag er fortsat 14.30.
Koden er udrullet i fase 1, men ingen scheduler eller produktionsflag
er aktiveret for Godkendelseskontrol. Timekontrols frister, kode og afsendelse ændres ikke.

### Samlet mail og leveringsresultat

Én mail til DEP alene, ingen CC. Eksisterende `mailService.sendEmail`,
`MAIL_FROM`, `MAIL_REPLY_TO`, provider og Fielddesk-mailramme genbruges;
ingen ny afsender eller integration. Skabelontag er `approval_control`
(gyldigt i Resend), ikke et nyt Timekontrol-tag. Emne:
`Godkendelseskontrol: X registreringer afventer på dine sager`.

Mailen viser antal registreringer, registreringernes samlede timer, antal
sager og ældste arbejdsdato. Hver sag viser medarbejder, dato, timer og antal
registreringer. Et dybt link med job-ID kræver normal login og genafgrænser
den gemte liste mod brugerens **aktuelle** server-side scope. Et ændret job-ID,
tenantvalg eller browserparametre giver ikke adgang til andres sager.

Ingen åbne rækker giver `no_open`, ikke et providerkald. Provideraccept,
afvisning og uafklaret resultat gemmes særskilt. Accept er ikke bevis for
levering eller indbakke. Fejltekst fra rå providerrespons/credentials gemmes
ikke. Uklart resultat, manglende kvittering, 5xx, timeout, 408/409/429 og
afbrudt afsendelsesclaim må aldrig udløse automatisk genafsendelse.

### Dagskrav, audit og simuleret outbox

[Migration 0063](../../../migrations/0063_approval_control_mail_runs.sql)
udvider den eksisterende audit-constraint kumulativt og tilføjer tre partielle
unikke indekser samt en metadata-constraint. Ingen ny tabel, identitetsmodel,
fælles mailkø eller ændring af tidligere migrationer:

- `approval_control.mail_run_started`: permanent claim på tenant, bruger,
  dansk dato og mode. Gentagelse/genstart samme dag genbruger claim uden
  ny capture eller mail. Simulation har separat mode og frigiver ikke live.
- `approval_control.mail_attempt_started`: højst ét permanent providerclaim
  pr. job; gemt/committed **før** provideradgang. Intet claim overtages igen.
- `approval_control.mail_run_completed`: ét append-only afslutningsresultat
  med tidspunkt, tidszone, bruger/modtager, dækning, tællere, alle medtagne
  EK-ID'er, dataklaring, mailresultat og eventuelt provider-ID.

Egen advisory namespace 6122 og databaseunikhed beskytter på tværs af
processer. Eksisterende capture-admission er stadig namespace 6121.
Mail-capture markeres med job-ID i den eksisterende captureaudit: samme
cooldown gælder, men mailjobbet kan ikke ligne et uafsluttet manuelt preview.
Auditrows er den særskilte features holdbare job-/outboxspor; den fælles
`email_outbox` berøres ikke og kan ikke begynde at sende Godkendelseskontrol
via andre flags. Ved `simulation` gemmes mailpayload til lokal inspektion,
men transporten kaldes aldrig. Ved live afsendelse bruges både permanent
dagsclaim og providerens nøgle `approval_control:<tenant>:<bruger>:<dato>`.
Næste hverdag får eget claim, så stadig åbne linjer kan medtages igen.

Hvis processen dør før resultat, viser UI uafsluttet job eller uafklaret
providerclaim; faktisk mailforsøg vises da som ukendt, ikke bevist af claimet
alene. Der gøres ikke automatisk et nyt forsøg. Pre-provider auditfejl
blokerer providerkald; post-provider auditfejl må ikke fortolkes som sikkert
ikke-sendt. Migrationens constraintvalidering/indeksoprettelse kan låse den
fælles audittabel; lokal test er ikke tilladelse til produktionsmigration.

### Operatørindgang og aktiveringsgrænse

Dette afsnit beskriver den lokale adminudvidelses procedure; det er ikke
tilladelse til deploy eller aktivering. De daterede fase 1-kvitteringer nedenfor
bevarer deres oprindelige betydning. Efter godkendt deploy gælder
[admin-kontrakten](#lokal-adminstyring) og et separat tenant-admin-klik.

`backend/scripts/approval_control.js` er en separat operatørindgang, ikke
tenantens aktiveringsvej eller en tilkoblet cron. Den importerer ikke app, sync-worker eller
Timekontrol-scheduler. Den finder HC og den eksisterende aktive DEP-bruger
server-side; ingen argumenter til at vælge anden modtager eller tenant.

| Indgang | Virkning, hvis operatøren senere kører den |
| --- | --- |
| `--status` | Kun database/status; ingen EK eller mail |
| Historisk `--activate-scheduler --confirm=ACTIVATE:approval_control:hoyrup-clemmensen` | Udfaset i den lokale adminudvidelse: fejler med `approval_control_use_tenant_admin_activation` før SQL; kan ikke oprette første aktivering |
| `--simulate` | Kun i planlagt slot og med allerede aktiv tenanttilstand/produktionsperiode; aldrig provider eller ny startdato |
| `--run-scheduled` | Kun produktion, aktiv tenanttilstand, gyldigt fremtidigt slot og alle guards; ingen genafsendelse/catchup. Ikke almindelig aktiveringsvej |

Den vedvarende tenanttilstand er default-off og kan ikke aktiveres af
udeladte eller positive miljøflags alene. `APPROVAL_CONTROL_SCHEDULER_ENABLED`
og `APPROVAL_CONTROL_MAIL_ENABLED` kan hver sættes eksplicit til false som
nødstop; ugyldige værdier blokerer. De ændrer ikke Timekontrols flags.
Den nye separate Godkendelseskontrol-scheduler kobles til webprocessen efter
deploy, men kalder kun mailjob for en aktiveret tenant i det planlagte minut.
Ingen startup-/aktiveringskørsel, laptop eller åben Codex-session kræves.
Ingen ny Render-cron er nødvendig. Lokal tid og DST genvalideres af jobbet.
UI adskiller beregnet næste tidspunkt, aktiv tenanttilstand og faktisk
tilkoblet scheduler. Ingen af operatørkommandoerne er kørt live her.

Normalt stop: tenant-admin vælger **Sæt på pause** og bekræfter i UI.
Startdato, audit, modtagere og historik bevares; genoptagelse kræver ny
bekræftelse og må ikke replaye gamle dagsclaims. Miljøflags er alene et
separat operatørnødstop og skal være indlæst i den kørende proces. Et flag
ændret i Render hot-opdaterer ikke en gammel proces. Timekontrols flags og
eksisterende Render-cron må ikke ændres. Allerede påbegyndt provideradgang
kan ikke trækkes tilbage; pause kan ved låseventetid fejle synligt uden at
foregive succes.

Driftsstatus udvides med næste tidspunkt, flags, synlig dækning samt seneste
job/årsag/providerresultat. `GET /api/approval-control/runs/:runId` læser
kun egen tenant/aktør og filtrerer rækker mod aktuel scope; ingen kørsel eller
mail ved statusopslag/link. Ukendte rækker vises separat i UI.

## Ekstra CC/BCC: tillæg 23. oktober 2026

`verified` ved læsning af den lokale `operationalMailRouting`-implementation og
`approvalControl.mailJob`: `approval_control_summary` kan tilføje tenant-admins
ekstra CC/BCC til den planlagte oversigtsmail. Den eksisterende primære
DEP-modtager, `scope=mine`, dagsclaim og højst ét providerforsøg bevares.
Den [kanoniske kontrakt](../calendar/ABSENCE_NOTIFICATIONS_OUTBOX_PR4.md#tenant-admin-ekstra-ccbcc-til-driftsmails)
beskriver API, tenant-/adminadgang, normalisering, before/after-audit og
revision/låsning. Begge ekstra kanaler er default-off uden seedede adresser.

Jobbet binder de konkrete modtagere til routingrevisionen i sit eksisterende
audit-/jobspor. Før providerkald genvalideres de under tenant/mailtype-lås;
ændret revision eller routing blokerer fail-closed uden nyt forsøg eller
replay af gamle dagsclaims. Godkendelseskontrol bruger fortsat ikke den fælles
`email_outbox`. BCC bevares som privat transport-/auditdata og vises kun i det
afskærmede admin-indstillingspanel/API, ikke i normal preview, jobstatus,
mailbody eller logs. Manuel preview og den særskilt foreslåede fase 2-testmail
er udenfor denne routing.

`verified` 23. oktober kl. 12.48: HC har JEL gemt som ekstra **CC**, revision 1,
efter den konkrete godkendelse af migration 0065, webdeploy og tenant-admin-gem.
Ekstra BCC er slukket/tom. Kodecommit `c19ab93`, deploy
`dep-dbdjlrbm8hqs73ed0p30`; API, database og audit er læst tilbage.
Det ændrer ikke de daterede fase 1-beviser eller den
allerede beskrevne DEP-alene-test i fase 2. Godkendelseskontrol er fortsat
**disabled uden startdato/aktiv periode**; modtagervalg starter ingen scheduler
eller maildrift og erstatter ikke de særskilte fase 2-godkendelser.
Ingen Godkendelseskontrol-kørsel, mail eller test er udført ved udrulningen.
JEL er alene en konfigureret kopi på en fremtidig godkendt driftsmail, ikke
bevis for afsendelse eller indbakkemodtagelse. Fuld kvittering er samlet i
routingkontrakten ovenfor.

## Lokal adminstyring

Status: **DEPLOYET OG READ-ONLY VERIFICERET; INGEN AKTIVERING**,
23. oktober 2026 kl. 13.56. Kontrakten er implementeret, lokalt valideret
og nu udrullet efter særskilt godkendelse; produktionskvitteringen nedenfor
erstatter de tidligere lokale leverancestatusser, ikke deres testhistorik.
Ingen mailkvittering foreligger. Ingen ny migration er skrevet eller anvendt.
Den nye PostgreSQL-prøve bruger alene en kopi af et allerede migreret lokalt
testskema, ikke migrationsfiler eller en migrationsrunner. Ældre daterede
PG-resultater nedenfor gælder fortsat deres oprindelige ændringer.

### Adgang, tilstand og atomisk startdato

Tenant og aktør afledes server-side fra tenant-host og aktiv session.
Kontrolhandlinger kræver, at databasen genbekræfter aktiv tenant, aktiv
tenantbruger/login og rollen `tenant_admin`; en klientrolle eller et
klientleveret tenant-/aktørvalg giver ingen adgang. Administration udvider
ikke projektadgangen. V1's HC/DEP-afgrænsning bevares: scheduler og mail
genbruger den eksisterende aktive DEP-tenantbruger, eksisterende DEP-modtager
og brugerens uændrede `scope=mine`. Ingen manuel mapping eller ny primær modtager.

Når både gemt kontroltilstand og tidligere 0064-aktiveringskvittering mangler,
er status `inactive`, også hvis miljøflags er udeladt eller sat til true.
Før første aktivering findes ingen startdato eller aktiv kontrolperiode.
Findes der derimod en 0064-kvittering uden ny kontroltilstand, vises
adminstatus som `paused`, revision **0**, med den oprindelige startdato;
schedulerstatus viser tilsvarende `control_status=paused`. Genoptagelse
genbruger den oprindelige kvittering/dato og kan ikke starte perioden forfra.
Legacy-kvitteringen giver ikke automatisk aktiv drift. Status og sidevisning
opretter ingen kontroltilstand eller aktivering. Den read-only verificerede
produktionstilstand har fortsat første aktivering null.

`verified` ved læsning af den lokale kode: `backend/scripts/approval_control.js`
afviser den tidligere `--activate-scheduler`-indgang med
`approval_control_use_tenant_admin_activation` før SQL. Den gamle operatørvej
kan derfor ikke oprette en første kvittering uden tenantens kontroltilstand.
`job.activateScheduler` delegerer til `control.change` med den fulde
kontrolrequest og dens guards; funktionsnavnet giver ingen alternativ genvej.
Efter godkendt deploy sker almindelig aktivering, pause og genoptagelse
udelukkende gennem tenant-admin-UI og bekræftelsesdialogen. Codex, en
operatørkommando eller ændrede miljøflags er normalt ikke nødvendige;
miljøflags bevares som særskilt nødstop.

Aktivering/genoptagelse kræver også, at den eksisterende mailtransport er
konfigureret med Resend, afsender, Reply-To og API-nøgle. Manglende opsætning
vises som en aktiveringsblocker; admin kan ikke fastlåse første dato, før
transporten er klar. Status/fejlrespons indeholder ingen nøgle eller andre
hemmeligheder. En autoriseret pause er fortsat mulig trods
aktiveringsblockere; adgangskontrol og bekræftelsesguards gælder stadig.

Tilstanden gemmes kanonisk i eksisterende append-only `audit_event` med
`event_type=tenant_config_changed`, `module_key=approval_control` og
`audit_event.target_type=approval_control_settings` via auditservicens
`resourceType`. Aktør og før/efter-tilstand
auditeres. Der oprettes ingen ny tabel, schemaændring eller migrationsfil;
den eksisterende auditmodel og migration 0064 er tilstrækkelige.

Ved første aktivering oprettes den uforanderlige
`approval_control.scheduler_activated`-kvittering fra 0064 og den aktive
kontroltilstand **i samme databasetransaktion**. Databaseuret bestemmer det
faktiske tidspunkt og startdatoen i Europe/Copenhagen. Fejl eller auditfejl
ruller begge skrivninger tilbage. Ingen klientdato, historisk skæringsdato
eller miljøoverride kan fastlægge perioden.

Bekræftelsesdialogen binder handlingen til tre kontroller: forventet
kontrolrevision, den viste aktuelle København-dato og forventet
routingrevision for `approval_control_summary`. Backend genkontrollerer dem
mod database/tilstand/routing; ændring, samtidighed eller datoskifte kræver
en frisk dialog, ikke tavs accept af forældede oplysninger. Datoen er en
bekræftelse af dagens serverdato, ikke et redigerbart startdatovalg.

### Pause, genoptagelse og samtidighed

Pause og genoptagelse øger kontrolrevisionen og bevarer altid den første
aktiveringskvittering/startdato. Hver aktiv generation har sit aktuelle
serverdaterede `enabled_at`. Dagsclaims og afsendelsesforsøg bindes til
kontrolgenerationen og genvalideres før provideradgang. Gamle claims bliver
ikke gyldige igen efter pause efterfulgt af genoptagelse; eksisterende
permanente dagsclaims og reglen om højst ét providerforsøg bevares.

En separat tenantafgrænset advisory-lås i namespace **6125** anvendes shared
ved afsendelse og exclusive ved kontrolændring/pause. Sendelåsen holdes
gennem det faktiske providerforsøg. Pause kan derfor ikke rapporteres som
gemt, mens et tidligere forsøg stadig har shared-låsen. Låsekonflikt har en
grænse på **3 sekunder** og giver synlig fejl uden falsk pause-succes eller
delvist gemt tilstand. En allerede accepteret mail kan ikke trækkes tilbage.
Låsen er særskilt fra routinglåsen 6124 og Timekontrols drift.
`SET LOCAL lock_timeout='3s'` og `statement_timeout='15s'` sættes før
autorisationsopslaget i kontroltransaktionen. Ventetid på aktør-/tenantrækker
er dermed også afgrænset, ikke kun ventetid på advisory-låsen. Timeout giver
fejl og rollback, aldrig en bekræftet kontrolændring.

### Scheduler, nødstop og senere udrulning

Godkendelseskontrol får sin egen minutjusterede scheduler, alene i
`NODE_ENV=production`. Der startes ingen scheduler i test/development og
ingen startup-catchup. Mandag-torsdag 14.30 og fredag 14.31, København,
bevares; det planlagte slots tidspunkt skal ligge **strengt efter** den
aktuelle generations `enabled_at`. Aktivering midt i et planlagt minut
frigiver ikke det allerede begyndte slot. Scheduler genbruger DEP's
eksisterende eget scope og de hidtidige kilde-/admissionsgrænser.

I den udrullede kontrakt er `APPROVAL_CONTROL_SCHEDULER_ENABLED` og
`APPROVAL_CONTROL_MAIL_ENABLED` ikke længere positive aktiveringsgates:
udeladte flags tillader kun drift, når tenantens gemte tilstand er aktiv;
eksplicit false er nødstop, og ugyldige værdier blokerer. True kan ikke
aktivere en inaktiv tenant. Manglende tilstand holder fortsat produktionen
slukket som standard. Produktionsmiljøet er ikke ændret; de daterede
fase 1-flagkvitteringer bevarer deres oprindelige betydning.

Commit/push/webdeploy er godkendt og gennemført. Næste grænse er
et separat, bekræftet tenant-admin-klik
for faktisk aktivering; deploy opretter hverken aktiv tilstand eller
startdato. Klikket fastlåser den faktiske databaseafledte dato, uden
historisk indhentning eller en fast kalendergrænse. Produktionsaktivering,
preview/testmail eller en bestemt afsendelse er ikke udført eller godkendt
ved denne udrulning. Fase 2-planen nedenfor er dateret
historik; dens operatørkommando erstattes af denne admin-aktiveringsvej.

Ingen Timekontrol-fil, scheduler, afsendelse, sync eller produktionsindstilling
ændres af denne udvidelse. De daterede beviser for fase 1 og `c19ab93` /
migration 0065 / JEL-CC ovenfor bevares som historiske kvitteringer.

### Verificeret produktionsudrulning af adminstyring

`verified`, 23. oktober 2026: Dennis godkendte commit/push og normalt
Render-webdeploy, uden aktivering, migration, preview, job eller mail.

- Kodecommit **`4e1f641a8c30d2a38a73a8b94bf5a82d59aac450`**, pushed til
  `origin/main`; webdeploy **`dep-dbdkm30u01pc73cqmoag`** er live på samme SHA
  siden **13.56.09 dansk tid** (`2026-10-23T11:56:09.170671Z`).
- Normal pre-deploy-runner: **`0 applied, 65 skipped`**. Før/efter viser
  65 anvendte migrationer, ingen ventende eller checksum-afvigelser og
  hash-identisk migrationshistorik. Ingen migration blev anvendt.
- Admin-GET og status-GET bekræfter `status=inactive`, revision 0,
  `effective_active=false`, `scheduler_enabled=false`, `mail_enabled=false`,
  `activation_valid=false`, `next_is_active=false`. Startdato, aktivering,
  aktiv kontrolperiode og næste aktive kørsel er null; ingen kontrolaudit.
- `scheduler_attached=true` betyder kun, at den selvstændige minutproces er
  tilkoblet webprocessen. Tenantens scheduler er **ikke aktiveret**, og ingen
  Godkendelseskontrol-job er kørt. Den viste mulige kørsel ved senere
  aktivering er en forhåndsberegning, ikke et planlagt aktivt job.
- HC's gemte routing er fortsat revision 1: DEP som normal To, JEL
  `jel@hoyrup-clemmensen.dk` som ekstra CC, ekstra BCC slukket/tom.
  Ingen konfigurationsblockere. Alle tre mailroutingindstillinger er uændrede.
- Faktisk tenant-admin-UI ved **1365/390/320 px** viser knappen
  **Aktivér Godkendelseskontrol**, uden åben bekræftelsesdialog, browserfejl
  eller vandret overløb. Kun GET; ingen knap er klikket. Health 200,
  anonym adminadgang 401, klientleveret tenantparameter 400, `no-store`.
- Timekontrols indstillinger, seks-personers gruppe, web-/cronmiljøfingerprints
  og separate cron-version/tidsplan er uændrede. Alle **85** eksisterende
  outboxposter er hash-identiske; **0 nye poster**, ingen afsendelse/replay.
  Ingen EK-kald, fitter-sync eller manuelle preview-/schedulerkørsler.
- Releasegate genkørt på de staged 21 featurefiler: `npm run check`,
  **770 bestået, 0 fejl, 15 opt-in skips**; alle øvrige checks grønne.
  Windows-sandboxens første EPERM-start blev løst med dokumenteret
  `NODE_OPTIONS`; ingen produktions- eller migrationssuite blev kørt.

Præcis produktionsadresse:
<https://hoyrup-clemmensen.fielddesk.dk/tenant/approval-control.html>.
Lokale læsebeviser/screenshots: `.tmp/approval-control-admin/deploy-*` og
`production-inactive-*.png`, uden credentials. Dokumentationskvitteringen
pushes med `[skip render]`; der udføres ikke endnu et webdeploy.
**Stop her: Dennis tager selv stilling til aktivering i UI.**

### Verificeret lokal adminudvidelse, 23. oktober 2026

- `npm run check`: **770 bestået, 0 fejl, 15 opt-in skips**, inklusive alle
  almindelige Timekontrol-/mailregressioner og 18 static assertions. Syntaks,
  whitespace, encoding, secrets og migrationsstruktur er grønne; sidstnævnte
  er kun en filkontrol, ikke migrationseksekvering.
- Målrettet `approvalControlAdmin`, `approvalControlAdminUi`,
  `approvalControlScheduler`, `approvalControlMail` og `approvalControl`:
  **117 bestået, 0 fejl/skips**. Dækker reelle HTTP-middleware med simuleret
  storage, session/rolle/tenantafvisning, rollback, serverdato ved midnat,
  revisioner, første dato, pause/genoptagelse, fremtidsfilter, købeskyttelse,
  uændret scope, transport-/konfigurationsblockere og UI-usikkerhed uden retry.
- Kun den nye `approvalControlAdminPostgres.integration.js` er kørt mod
  PostgreSQL: **8 bestået, 0 fejl/skips**. Testen klonede et allerede migreret,
  isoleret lokalt skema med de 65 eksisterende migrationsposter. Ingen
  migrationsrunner, migrationsfil eller schemaændring blev kørt. Den faktiske
  SQL, atomisk første kvittering/kontrolaudit, rollback, otte samtidige første
  aktiveringer og begge send/pause-ræs er verificeret, inklusive 3s timeout.
  Forældede generationer er fortsat blokerede efter genoptagelse.
- Både den read-only template og testkopiens Timekontrol-, outbox- og syncdata
  er uændrede, ligesom migrationsmetadata. Eksisterende opt-in-suites, der
  anvender migrationer, er med vilje ikke kørt. Testserveren er stoppet igen.
- Playwright med kun lokalt, syntetisk UI: **1365/390/320 px**, ingen scriptfejl
  eller overløb; første bekræftelse, Escape/annuller uden POST, aktiv/pause/
  genoptagelse med bevaret dato, 409 uden automatisk retry og skjult/ryddet
  adminsektion ved 403. Bekræftet POST kan ikke foregives annulleret under
  ventetid; timeout viser usikkert resultat og kræver ny læsning. Screenshots
  er visuelt kontrolleret. Ingen EK-, database-, preview- eller mailkald fra UI.
- Uafhængigt read-only review: to fund om blokkeret pause-UI og timeout før
  autorisation er rettet og genverificeret; ingen resterende konkrete fund.
  Nye/ikke-trackede feature- og testfiler er kontrolleret særskilt for syntaks,
  encoding og secrets. Git-indholdsdiff er tom for hele Timekontrol,
  fitter/sync, projekt-scope, fælles mailadapter/routing og migrationsfiler.

Produktion, startdato og aktive indstillinger er ikke tilgået/ændret i denne
opgave. Ingen rigtig mail, EK-kald, migration, deploy, commit eller push.
Den lokale UI-simulering på `http://127.0.0.1:4131` har alene hukommelsestilstand
og kan ikke aktivere produktion, skrive til databasen eller kontakte EK/mail.
Lokale testlogs/screenshots ligger i `.tmp/approval-control-admin/`.

## Backlog og testgrænse

| Status | Arbejde |
| --- | --- |
| Udrullet fase 1 | Direkte scope=mine-genbrug, server-side indsnævring og scope-genkontrol |
| Udrullet fase 1 | HC-bekræftet null-status, godkendt/ukendt, gruppering, deduplikering og manuel preview; intet preview kørt ved deploy |
| Udrullet fase 1 | Audit i eksisterende tabel, statusvisning, tenant/aktør-adgang og isolerede regressionsprøver |
| Verificeret fase 1 | Migration 0062/0063/0064, deploy og læsende produktionskontroller; ingen aktiv periode |
| Afgrænset live-verificeret | 23. oktober kl. 00.30, perioden 19.-23. oktober: ny reader med pageSize 100/to komplette passes og faktisk preview matcher rådata. Produktions-HTTP, audit/admission og maildrift er ikke live-verificeret |
| Udrullet fase 1, slukket | DEP-mailjob med dagsclaim, simuleret payload, eksisterende mailtransport, fremtidsfilter, status og sikker provider-usikkerhed |
| Udrullet fase 1, ikke aktiveret | Fremadrettet dækning fra første produktionsaktivering, fredag 14.31, mandag-torsdag 14.30 og dynamisk periode/fodnote |
| Dateret fase 2-plan, ikke udført | Eksplicit live-preview, særskilt låst testmailvej før aktivering, én test og bekræftet indbakke; ingen ny preview-/sendetilladelse |
| Dateret aktiveringsvej, erstattet af udrullet adminvej | Tidligere operatør-/flagaktivering erstattes af faktisk tenant-admin-bekræftelse i UI; ingen aktivering er udført |
| Udrullet og settings verificeret 23. oktober | Tenant-admin ekstra CC/BCC til `approval_control_summary`; HC's JEL-CC revision 1 gemt. Selve Godkendelseskontrol er fortsat slukket; ingen startdato, aktivering, mail eller replay |
| Udrullet og read-only verificeret; fortsat deaktiveret | Tenant-admin aktivering/pause/genoptagelse, atomisk 0064-kvittering og kontrolaudit, tre dialogguards, generationsbinding og separat send-/kontrollås 6125; egen produktionsscheduler, ingen ny migration. `4e1f641` / `dep-dbdkm30u01pc73cqmoag` |
| Afventer separat faktisk tenant-admin-aktivering efter godkendt deploy | Databaseuret fastlåser første dato ved klik; deploy/routing/udeladte flags aktiverer intet. Pause/genoptagelse bevarer datoen og spærrer gamle claims |
| Senere særskilt scope | Go-live-afgrænset effektstatistik, andre modtagere/tenants, andre intervaller, helligdage og automatisk retry |

Ekstra CC/BCC-tillægget afgrænser modtagersporet i den sidste backlogrække:
den beskrevne ekstra kopifunktion er nu udrullet; bredere valg
af primær modtager eller tenant er fortsat senere særskilt scope.

`test/approvalControl.test.js` dækker de ti oprindelige adfærdskrav:
afventende med, godkendte ude, anden sag ude, entydige linjer, ukendt giver
ingen mailbeholdning, sagsgruppering, ændret godkendelse, gentagelsesidempotens,
tenant/adgang samt uændrede Timekontrol-beregnings-, scheduler-, sync- og
identitetskilder. Det godkendte ekstra modtagertillæg testes separat. Desuden testes
pagination, API-fejl, beskyttede preview-vinduer, ugyldig binding og A/B/A-audit.
HTTP-, EK-, mail- og databasetransport er isoleret/mocket; disse tests er ikke
produktionsevidens eller faktisk Outlook-levering.

### Verifikation gennemført

- `npm run check`: bestået, **653 tests bestået, 0 fejl, 11 opt-in skips**.
  De 21 nye isolerede funktionstests er bestået. Node køres lokalt med
  `NODE_OPTIONS=--preserve-symlinks --preserve-symlinks-main` på grund af
  Windows-sandboxens realpath-begrænsning.
- Nye ikke-trackede filer er desuden kontrolleret eksplicit med syntax-,
  encoding- og secretschecks; den almindelige gate scanner tracked filer.
- `test/approvalControlPostgres.integration.js`: bestået separat med eksplicit
  loopback-opt-in. En **ny isoleret** PostgreSQL 17-instans anvendte alle 62
  faktiske migrationer på en frisk fixture-database, verificerede den rigtige
  projekt-SQL uden EK-GUID, udelukkelse af 9015, tenant-afvisning, samtidige
  auditclaims, A/B/A, append-only og gentagelse af 0062 uden dataændringer.
  Gamle Timekontrol-eventtyper blev accepteret; ukendte typer blev afvist.
  Den nye lokale testinstans er stoppet efter testen. Ingen eksisterende
  database eller server blev genstartet.
- To historiske statiske audittests er tilpasset den kumulative 0062-udvidelse.
  De kræver fortsat bevaring af alle tidligere eventtyper. Ingen gammel
  migrationsfil eller Timekontrol-runtimefil er ændret.
- Playwright/Chrome: visuel kontrol og layoutchecks ved 1365, 390 og 320 px,
  logo, pending/unknown-tællere, mailpreview og kildefejl, som skjuler gammelt
  resultat. Kun lokale syntetiske fixtures; ingen EK-/providerkald.

Ingen EK-skrivning, oprettelse af fitters/brugere, gruppeændring, generel sync,
Timekontrol-kørsel, afsendelse, scheduler-aktivering, deploy eller genstart.

### Lokal mailverifikation før datovalg, 23. oktober 2026

- `npm run check`: **675 bestået, 0 fejl, 12 opt-in skips**, 687 tests i alt;
  migrationstjek af alle 63 filer og 18 statiske assertions bestået.
- `node --test test/approvalControl.test.js test/approvalControlMail.test.js`:
  de eksisterende preview-/scope-regressioner og 22 nye mailtests. Dækker alle
  ti bestilte krav samt reelt serialiseret Resend-payload med simuleret fetch,
  terminal providerusikkerhed, sidste adgangs-/stop-/freshnesscheck,
  auditfejl efter accept og den faktiske readers 2.000/2.001-rækkersgrænse.
- `node --test test/approvalControlPostgres.integration.js test/approvalControlMailPostgres.integration.js`:
  **12 bestået, 0 skips**, med eksplicit opt-in mod isoleret PostgreSQL 17
  på loopback. Hver suite opretter ny fixture-database og anvender alle 63
  faktiske migrationer. Fire samtidige jobforsøg giver én capture og ét
  simuleret providerkald, med committed permanent claim før kaldet. Genstart,
  samme dags gentagelse, tenant-/aktørafvisning, append-only, auditrollback og
  gentagen 0063 er verificeret. Ingen ekstern netværksadgang i fixtures.
- Playwright/Chrome på faktisk UI ved **1365, 390 og 320 px**: næste slot og
  deaktivering, dækning, seneste job, separat joblink, åbne/ukendte rækker,
  afvist joblink uden gamle data og eksisterende preview inklusive kildefejl
  bestået. Ingen POST ved sidevisning, ingen browserfejl eller side-overflow.
- Selve mail-HTML er kontrolleret ved **650, 390 og 320 px** med lokal
  logosimulering; ingen overflow. En først observeret mobil tabelbreddefejl
  blev rettet kun i Godkendelseskontrol-rendereren, ikke i den fælles ramme.
  Dette er browserrendering, ikke Outlook-levering eller providerbevis.
- Nye ikke-trackede feature-/CLI-/testfiler kontrolleres eksplicit med syntax,
  encoding og secrets. `git diff --exit-code` for hele Timekontrol-runtime,
  fælles mailadapter/ramme/config, notifications/outbox, sync og identitet
  viser ingen ændringer. De to eksisterende statiske audittests er udvidet til
  at verificere den kumulative 0063, ikke til at lempe tidligere eventkrav.

Første lokale databaseforsøg manglede den dedikerede fixture-admindatabase;
den blev oprettet kun på loopback. En ny fixture brugte for lange usernames
og blev rettet til den eksisterende firetegnskontrakt. Den endelige gentest er
bestået. Eksplicit secretscheck krævede, at de ufølsomme fixtureværdier blev
navngivet som variable; ingen checkerregel eller hemmelighed blev ændret.
Den ejede testinstans er stoppet. Ingen produktionsdatabase,
EK-kilde, mailkonto, Render-service eller aktiv Timekontrol er kontaktet eller
ændret som del af denne mailimplementering. Ingen commit/push/deploy.

### Verifikation af fremadrettet aktiveringsperiode

Dennis' seneste rettelse erstatter den faste kalenderperiode i kode, tests,
UI, mail, beslutningslog og backlog. Der findes ingen aktiv periode før den
faktiske produktionsaktivering. Fredag `14:31`, mandag-torsdag `14:30` og
Timekontrols eksisterende beskyttelse er uændret. Begge flags er default false.

- `node --test test/approvalControl.test.js test/approvalControlMail.test.js`:
  **50 bestået, 0 fejl/skips**. Dækker manglende aktivering trods aktive flags,
  inklusiv go-live-arbejdsdato, gamle åbne/ugyldige rækker uden driftsfejl,
  fremtidige datoer, pause/genaktivering/årsskifte med samme startdato,
  København-dato over UTC-midnat og vintertid, afviste datooverrides,
  separat manuelt historisk preview og dynamisk mailfodnote.
- De tre opt-in PostgreSQL-suites (`approvalControlPostgres.integration.js`,
  `approvalControlMailPostgres.integration.js` og
  `approvalControlActivationPostgres.integration.js`) på nye isolerede lokale
  databaser: **21 bestået, 0 fejl/skips**, alle 64 faktiske migrationer.
  Otte samtidige aktiveringsforsøg gemmer én kvittering fra databaseuret;
  datooverrides ignoreres af lagringen, append-only og tenantunikhed bevises.
  Pause/genaktivering og modulgenstart bevarer datoen. Samtidige job har ét
  simuleret providerkald; aktivering/startdato bevares i audit. Testinstansen
  er stoppet. Ingen eksterne EK- eller providerkald er tilladt i disse fixtures.
- Endelig `npm run check`: **682 bestået, 0 fejl, 13 opt-in skips**,
  695 tests i alt; syntax, whitespace, encoding, secrets, migrationstruktur
  og 18 statiske assertions bestået. De 13 skips er ikke databasebevis;
  de tre Godkendelseskontrol-databasesuites er kørt særskilt som ovenfor.
- Nye/ikke-trackede featurefiler kontrolleret eksplicit: syntax **19 filer**,
  encoding og secrets **26 filer**, samt whitespace. Ingen faste
  kalenderstartreferencer er tilbage i featurekode, tests, UI eller dokumentation.
- Playwright/Chrome med rent lokale syntetiske fixtures: før aktivering er
  periode/næste kørsel tomme, ingen gamle driftsrækker; gemt aktiveringsdato
  og dynamisk fodnote vises i et separat eksempel med stoppet drift.
  UI kontrolleret ved **1365/390/320 px**, mail ved **650/390/320 px**;
  ingen overflow eller browserfejl og kun GET ved sidevisning. En mindre
  mobiloverskriftsoverskridelse blev rettet alene i featurets mailskabelon.
- `git diff --exit-code` bekræfter uændret Timekontrol-runtime/runbook,
  sync-worker, fitter-identitet, projektudvælgelse, fælles mailadapter,
  mailramme, config og notifikationsmodul. Eksisterende audit-eventtyper
  bevares af den kumulative migration og dens PostgreSQL-regressionstest.

Aktivering er **fortsat ikke godkendt eller udført**. Ingen undersøgelse af
historiske datamængder/loft indgår. Ingen live-EK-læsning, produktionsmigration,
rigtig mail, deploy, commit eller push er udført i denne rettelse.

## Produktionsudrulning fase 1 og senere fase 2

Dennis har 23. oktober godkendt commit/push og produktionsudrulning af den
færdige feature med migration 0064, men **ingen aktivering, startdato,
Godkendelseskontrol-cron, EK-kontrol, outbox-apply eller rigtig mail**.
Forhåndskontrol kl. 10.24 dansk tid fandt produktionen på migration 0061;
Dennis godkendte derefter udtrykkeligt 0062 og 0063 sammen med 0064 som fase 1.
Webservicen er
auto-deploy på `main`; push er dermed selve deploygrænsen. Timekontrols
eksisterende særskilte monitor-cron skal ikke deployes eller ændres i fase 1.

Fase 1 bruger kun den eksisterende `npm run db:migrate`-procedure og efterfølgende
read-only kontroller: checksums/status, HTTP/UI, server-side adgangsafgrænsning,
ingen aktiveringskvittering, tom kontrolperiode, slukkede featureflags samt
uændrede Timekontrol-indstillinger, kontrolgruppe og monitor-cron. Ingen
preview-POST eller aktiverings-/mailkommando indgår i efterkontrollen.

### Verificeret fase 1-resultat, 23. oktober 2026

`verified`: commit **`080b9023d3c43030f20582beab559bc9fea349b9`** er pushed
til `origin/main`. Webservice `srv-d6h0h8fgi27c73a99jgg` er live på præcis
denne SHA som deploy **`dep-dbdhr6m417fc738kkc9g`**, afsluttet kl.
**10.41.50 dansk tid** (`2026-10-23T08:41:50.659224Z`). Ingen separat
manuel deploy eller ændring af servicekonfigurationen blev udført.

- Normal pre-deploy log: `3 applied, 61 skipped`. 0062 tog 151 ms, 0063
  300 ms, 0064 196 ms. Læsende databasekontrol finder **64 anvendte,
  0 ventende, 0 fejlede, 0 checksum-afvigelser** mod committede Git-blobs.
  De tre relevante constraints er validerede og fire unikke auditindekser gyldige.
- Faktisk produktionsstatus: `scheduler_enabled=false`, `mail_enabled=false`,
  `scheduler_attached=false`, `activation_valid=false`. `activation_id`,
  `activated_at`, `coverage_from`, `coverage_to` og næste kørsel er alle null.
  Render har ingen `APPROVAL_CONTROL_*`-flags; default-off er verificeret i HTTP-responsen.
- HC har **0 Godkendelseskontrol-auditposter og 0 outboxposter** efter alle
  kontroller. Ingen capture, preview, dagsclaim, startdato, testmail eller
  afsendelsesforsøg er oprettet. Ingen EK-kald eller scheduler-job blev kørt.
- `/health`, faktisk UI/JS og DEP-status giver 200. Uden login: 401;
  anden HC-bruger: 403; eksisterende bruger fra anden tenant på HC-host: 403;
  scope-/tenantparametre: 400; ukendt job-ID: 404. Status er `no-store`.
  Eksisterende DEP-scope er stadig **64 sager**, med 80396-003 og uden 9015.
- Playwright på det faktiske produktions-UI ved **1365/390/320 px**:
  korrekt slukket visning uden periode/næste kørsel, indlæst logo, ingen
  overflow eller scriptfejl. Kun GET; ingen preview-knap blev aktiveret.
- Timekontrol: komplette miljøhashes, indstillings-/medarbejderhashes og
  seks-personers gruppe er uændrede. Monitor-cron `crn-db73jjrl550s73aljjo0`
  er ikke redeployed, har samme kode/kommando og `*/5 * * * *`, ikke suspenderet.
  Webloggen viser den eksisterende minuttakt-scheduler startet kl. 10.41.42.
  Status-/drifts-/operations-GETs giver 200, operation er aktiv. Næste
  beregnede Timekontrol-slot er fredag 23. oktober kl. 12.00, uændret.
  Ingen nye Timekontrol-outboxposter eller mailforsøg siden forhåndskontrollen
  kl. 10.40.41 og ingen operationsændring er observeret frem til kl. 10.46.
- Post-deploy lokal regression, med simuleret transport og uden drift:
  `timeControlEmail`, `tenantUserInvitationEmail`, `timeControlMonitor`,
  `timeControlProviderIncident`, `timeControlAutomaticMail`,
  `notificationOutboxFoundation`, `approvalControl` og `approvalControlMail`:
  **135 bestået, 0 fejl/skips**. Den tidligere fulde releasegate er fortsat
  gyldig for den uændrede kode: **682 bestået, 13 opt-in skips**.

Lokale, ikke-committede beviser ligger i `.tmp/approval-control-audit/phase1-*`:
før/efter-snapshots, HTTP-/browserresultater, regressionslog og slutkontrol med
filtrerede migrations-/schedulerlogs. Credentials/tokens er ikke gemt i beviserne.
Driftsdokumentationens efterfølgende commit bruger `[skip render]` for ikke
at genstarte produktionen ved en ren dokumentationsopdatering; dette følger
[Renders dokumenterede skip-mekanisme](https://render.com/docs/deploys#skipping-an-auto-deploy).

### Fase 2, endnu ikke godkendt

Den følgende plan er den daterede fase 1-plan. Den nu udrullede
[admin-kontrakt](#lokal-adminstyring) erstatter dens operatørbaserede
aktivering med tenant-admin-bekræftelse; ingen aktivering er udført.
Historiske preview-/testmailforslag er ikke bevis for udført test eller ny
sendetilladelse; konkrete senere handlinger skal godkendes særskilt.

Fase 2 er en separat, endnu ikke godkendt sekvens:

1. Godkend et konkret manuelt live-preview-interval. Kald den eksisterende
   `POST /api/approval-control/preview` som HC/DEP med `from_date` og `to_date`
   (højst syv dage). Sammenhold ID'er/tællere med det komplette EK-grundlag,
   godkendte/ukendte/fremtidige rækker og den aktuelle `scope=mine`. Det er et
   udtrykkeligt manuelt preview, ikke starten på en driftsperiode.
2. Klargør derefter præcis én låst testmail til DEP alene, uden CC, med tydelig
   testtekst og eksplicit manuelt interval. Vis indhold, modtager, afsender,
   test-ID og konkret engangskommando til særskilt godkendelse. **Den nuværende
   feature har ikke en sådan før-aktiverings-testmailvej**: `--simulate` og
   `--run-scheduled` kræver med vilje en rigtig aktivering og må ikke bruges
   som genvej. En snæver testmailvej med holdbart engangsclaim/audit skal derfor
   implementeres/testes efter ny godkendelse, uden at oprette en falsk
   produktionsaktivering eller genbruge Timekontrols låste tests.
3. Efter særskilt sendegodkendelse afsendes kun den viste test én gang.
   Gem providerresultat; uafklaret accept må ikke genafsendes automatisk.
   Afvent Dennis' bekræftelse af faktisk indbakkemodtagelse.
4. Først derefter godkendes den konkrete scheduler-/mailaktivering separat.
   Tilkobl kun Godkendelseskontrol, mandag-torsdag 14.30 og fredag 14.31,
   Europe/Copenhagen. Den historiske plan beskrev
   `--activate-scheduler --confirm=ACTIVATE:approval_control:hoyrup-clemmensen`;
   **kommandoen er udfaset i den lokale adminudvidelse og må ikke bruges som
   aktiveringsvej**. Efter godkendt deploy sker faktisk aktivering alene ved
   tenant-admins bekræftede UI-handling, normalt uden Codex eller miljøændring;
   databaseuret fastlåser startdatoen én gang. Verificér
   gemt dato, første planlagte slot, DEP/ingen CC og stopprocedure. Ingen
   historisk indhentning eller ændring af aktiv Timekontrol.
