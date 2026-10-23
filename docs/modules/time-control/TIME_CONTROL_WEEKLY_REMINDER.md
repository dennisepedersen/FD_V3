# Timekontrol: fredagens ugepaamindelse

Status: HC's seks-personers drift, tenant-live og automatiske flags er aktiveret og verificeret 2026-10-12; foerste planlagte kontrol 2026-10-13 kl. 09.00 Copenhagen
Beslutningsdato: 2026-10-11
Godkendt af: Dennis Espersen Pedersen
Scope: fredagens medarbejderpaamindelse og lederoverblik i Timekontrol v1

## Aktuel HC-aktiveringsgraense (2026-10-12)

Den godkendte aktivering er gennemfoert med daekning fra 12. oktober.
Runbooken dokumenterer gemt epoch/live, Render-schedulerens faktiske opstart,
uaendret mailkoe og konkret stopprocedure. Foerste automatiske driftskoersel
13. oktober kl. 09.00 er endnu ikke verificeret i dokumentationen.
0/4 er observationen ved aktiveringen 12. oktober, ikke en ny produktionsstatus.
Ugen kvalificerer kun via faktiske planlagte gyldige kontroller, aldrig manuelle
eller historiske koersler. [AGENTS.md](../../../AGENTS.md) beskytter aktiv drift
mod sideeffekter, ogsaa fra faelles komponenter og fremtidig generel EK-sync;
konkrete adfaerdsaendringer kraever Dennis' udtrykkelige skriftlige accept.

Den konkrete [aktiveringsplan](../../runbooks/TIME_CONTROL_ACTIVATION.md)
gaelder den eksisterende gruppe paa seks teknikere. Den bevarer DEP alene
som medarbejder-CC, ledermodtager og intern fejlmodtager; LKE er fravalgt.
From er `Fielddesk Timekontrol <timekontrol@mail.fielddesk.dk>`, Reply-To
`admin@fielddesk.dk`. Generel EK-sync og regelprofiler aendres ikke.

Schedulerens nye automatiske forbindelse behandler kun den afsluttede
kontrols konkrete Timekontrol-outbox-ID'er, aldrig andre modulers koeer.
`TIME_CONTROL_MAIL_ENABLED=true` er en ny, saerskilt og som standard
slukket gate; scheduler, tenant-live og aktiv drifts-epoch kraeves ogsaa.
Timekontrol-providerforsog genproeves ikke automatisk; uklare resultater
bevares og diagnosticeres. Andre modulers retry-politik bevares.

Genstart i samme planlagte minut genbruger en afsluttet live-kontrol uden
nyt capture. Dagsafsendelse kraever den aktuelle epochs kvittering, og en
aendret/ufuldstaendig kontrolgruppe blokerer koerslen. Fredag kraever
fortsat alle fire faktiske planlagte dagskontroller plus fredagsgrundlag;
historiske og manuelle koersler kvalificerer aldrig ugen.

De nedenstaaende lokale implementeringsnotater og tidligere ikke-deployed
statusser er historisk evidens. Den aktuelle rollout-status dokumenteres i
aktiveringsplanen og mail-runbookens seneste sektion.

HC-specifik godkendelse: migration 0055 gemmer reference 9043
`Formandstillæg 4` og 9076 `Funktionstillæg` som kendte, ekskluderede tillæg
i `time_control_pay_code_rule` alene for `hoyrup-clemmensen`. Den ændrer ikke
globale fallbackregler, historiske resultater eller tidligere migrationer.
Oktoberugen genberegnes i en ny isoleret database; det tidligere blokerede
resultat og dets evidens bevares med deres oprindelige betydning.

## Ekstra CC/BCC: tillæg 23. oktober 2026

`verified` i den lokale routingpolicy og service-/dispatchintegration:
tenant-admin kan konfigurere ekstra CC og BCC separat via den
[kanoniske routingkontrakt](../calendar/ABSENCE_NOTIFICATIONS_OUTBOX_PR4.md#tenant-admin-ekstra-ccbcc-til-driftsmails).
Routing er nu udrullet efter konkret godkendelse; ovenstående daterede
driftsstatus og aktiveringsbeviser ændres ikke.

- `time_control_missing_hours` omfatter **både daglig individuel mail**
  (`time_control.missing_hours.employee`) **og individuel ugepåmindelse**
  (`time_control.employee_weekly_reminder_v1`).
- `time_control_friday_status` omfatter **kun**
  `time_control.friday_weekly_summary_v1`, ugens lederoversigt.
  Monitorens driftsstatus, watchdog og al diagnostik, herunder
  `time_control.internal_error`, er udenfor, også om fredagen.
- Begge ekstra kanaler er default-off uden forudfyldte adresser. Indstillingen
  ændrer hverken basis-Til/CC, gruppemedlemskab, regler, kørselsbeviser,
  tidsvinduer eller aktiveringsflags. Manuelle previews/POC/testmails er udenfor.
  BCC er privat i adminpanelet og serverinterne transport-/auditdata og vises
  ikke i normale mailpreviews, mailbody eller driftsstatus.
- Gem er tenant-admin-only med tenantafgrænsning, before/after-audit og
  revisionskontrol. Nye køposter bindes til routingrevisionen; ændret revision
  eller effektive modtagere blokerer før providerkald under routinglåsen.
  Legacykøposter får aldrig nye kopier eftermonteret og blokeres, hvis aktuel
  ekstra routing kræver andre modtagere. Ingen replay eller genafsendelse.

`verified` 23. oktober 2026 kl. 12.48: HC har JEL som ekstra BCC på **begge**
familier, revision 1, gemt/læst tilbage efter godkendt 0065/webudrulning.
Kodecommit `c19ab93`, webdeploy `dep-dbdjlrbm8hqs73ed0p30`. Normale Til/CC og
alle 85 gamle outboxposter er uændrede; ingen nye mails eller manuelle kørsler.
Monitor-cron og diagnostik er uændrede og uden JEL. Første mulige nye BCC er
en regelberettiget individuel mail ved kontrollen tirsdag 27. oktober kl. 09.00
af mandag 26. oktober; faktisk afsendelse/levering er ikke endnu bevist.
Fuld kvittering og stop af observerkopier findes i routingkontrakten ovenfor.

## Afgrænsning fra dagsbaseret POC

Den særskilt godkendte lokale implementering bruger `friday_weekly_v1`.
Historiske `friday_12`-kørsler, forhåndsvisninger og manuelle dagskontroller
vurderer fortsat en enkelt fredag med dagsnorm 7 timer. `daily_09` er uændret.
Schedulerens fredagsvindue kl. 12 vælger nu den nye version, men
`TIME_CONTROL_SCHEDULER_ENABLED=false` og eksisterende live-indstillinger er
ikke ændret. Ingen produktionsmigration, EK-kald, providerafsendelse,
deploy eller aktivering er udført i denne implementering.

## Reglement for næste version

- Fredag kl. 12.00 i `Europe/Copenhagen` kontrolleres summen af medregnede
  timer fra samme uges mandag til og med fredag mod en ugenorm paa 37 timer.
- Ved 37 timer eller mere sendes ingen medarbejdermail.
- Ved under 37 timer sendes højst én ugepaamindelse pr. medarbejder om at
  færdiggøre registreringen inden hjemgang kl. 14.30 samme fredag.
- Godkendte fraværstimer tæller med efter de allerede godkendte
  lønartsreferencer og regler. Tillæg tæller ikke med. Ukendte referencer
  maa ikke automatisk behandles som ekskluderede tillæg.
- Fredagen har ikke et selvstændigt minimumskrav paa 7 timer i denne kontrol.
  Ugekontrollen anvender ikke fem uafhængige dagsminimummer.
- Ufuldstændigt eller uklassificeret datagrundlag giver ingen medarbejdermail
  om manglende timer. Intern diagnosticering bevares.
- Mailen maa vise medregnede timer og ugenormen. Forskellen maa
  ikke beskrives som en konstateret mangel: fredagens arbejde og registrering
  er stadig i gang ved kontrollen.
- Mailen skal oplyse, at medarbejderen kan se bort fra beskeden, hvis resten
  allerede er registreret efter kontrollen.

Ugeversionens medarbejdermail (lokal skabelon, ikke aktiveret i produktion):

> Ved kontrollen fredag kl. 12.00 kunne Fielddesk se {medregnede_timer}
> medregnede timer for denne uge. Ugenormen er 37 timer.
> Husk at færdiggøre ugens timeregistrering inden hjemgang kl. 14.30.
> Fredagen er stadig i gang. Du kan se bort fra denne besked, hvis du allerede
> har registreret resten efter kontrollen.

Medregnede timer betyder timer fra de tenant-godkendte timearter, ikke
registreringer godkendt af en leder i EK. Historiske gemte previews og resultater
omskrives ikke ved denne skabelonrettelse.

En planlagt kontrol skal være afsluttet med status `completed`, før den
kan dokumentere driftsugen. Et blokeret resultat for en anden tekniker i
samme kontrol må ikke åbne gaten. Gaten genkontrollerer også kørselsstatus.
Scheduler starter højst fire tenants samtidigt; forsinkede køstarter efter
det planlagte minut diagnosticeres og kvalificerer ikke ugen.

Kildekontrakt v3 accepterer og validerer også fulde terminale sider:
26. september 2026 gav 30 distinkte rækker, tre sider pr. pass og 10 rækker
med `nextPage=null` på sidste side i to stabile faktiske udtræk. Tidligere
v1/v2-beviser bevarer deres oprindelige kontrakt. En faktisk tenant-nuldag
blev ikke fundet i otte snævre datoprober; adapteren blokerer fortsat nul-dage.

## Datadækning og tidspunkt

Der kræves komplet timedækning for mandag til og med fredag for den konkrete
tenant og medarbejder, inklusive relevante timer paa afsluttede projekter.
Komplet betyder et dokumenteret, valideret snapshot af registreringerne ved
kontrollen; det betyder ikke, at fredagens arbejde eller registrering er
afsluttet.

En succesfuld sync, et frisk timestamp eller fredagens dagsbevis er ikke
tilstrækkeligt ugebevis. Beviset skal være bundet til de præcise datasæt,
rækker og datoer, som summeres. En dag uden rækker maa kun tælle som nul,
hvis datadækningen for dagen faktisk er dokumenteret komplet.

Manglende/ugyldige kildedata, ukendt lønart eller usikker dækning paa en
evalueret dag blokerer medarbejderpaamindelsen for ugen og skal fremgaa af
intern diagnosticering. Senere rettelser, sletninger eller genimport maa
ikke lade et tidligere bevis gælde for ændrede rækker.

## Identitet, audit og idempotens

- Teknikeridentitet er tenant plus eksplicit `fitter_id`; Fielddesk-login
  er fortsat valgfrit. Aktiv fitter, godkendt autoritativt gruppemedlemskab
  og administratorgodkendt mailadresse er fortsat nødvendige.
- Mailens idempotensnøgle skal mindst indeholde serverafledt tenant,
  medarbejderens `fitter_id`, ugens mandagsdato i `Europe/Copenhagen`
  og en særskilt ugepaamindelses-mailtype.
- Nøglen maa ikke afhænge af login, mailadresse, kørsels-ID eller dataset-ID.
  Genkørsel, nyt datasæt eller adresseændring maa ikke skabe endnu en
  ugepaamindelse til samme medarbejder for samme uge/mailtype.
- Samtidige kørsler og provider-retries skal bruge samme logiske
  notifikation, med databasebaseret entydighed og tenant-afgrænsning.
  Dags-POC'ens mailnøgler maa ikke genbruges som ugekontrollens nøgler.
- Resultatet skal auditeres med periode, snapshot/dækningsbeviser,
  medregnede timer, norm, klassifikationsstatus og paamindelsesbeslutning.
  Under 37 timer ved middag er en paamindelsesbeslutning, ikke et konstateret
  slutunderskud.

## Implementeret lokal kontrakt

`verified` i lokal kode/tests:

- Kontroldatoen skal være en gyldig fredag. Ugenøglen er mandagens kalenderdato
  i København; UTC-middag bruges kun til sikker kalenderaritmetik over DST og
  årsskift. Normen er altid 37 timer. `weekly_reminder` har `missing_hours=NULL`.
- Fem UUID'er angives i rækkefølge mandag–fredag. Hver dag genvalideres mod
  tenant, dato, aktuelt head, rækker, SHA-256, revision og capture-key. Alle
  fem heads låses under evaluering; ingen læsning af legacy `fitter_hour` eller
  påstand om friskhed fra sync-job/importtid anvendes til ugekontrollen.
- `time_control_weekly_snapshot` og dens immutable
  `time_control_weekly_snapshot_day`-junction gemmer præcis fem
  tenant/dato/dataset-bindinger. Deferred PostgreSQL-constraints afviser
  manglende/ekstra dage; composite FK'er afviser cross-tenant/dato-bindinger.
  Run/result bindes til samme snapshot; audit gemmer snapshot-ID, periode,
  total, norm, klassifikation og påmindelsesbeslutning. Gamle snapshotbindinger
  bevares, selv om run/result opdateres ved genkørsel.
  Ved blokeret genkørsel arkiverer samme evalueringstransaktion først de gamle
  resultat-rækker med snapshot-ID, status, timer og proof i `run_blocked`-audit.
  Resultat-ID'er og mail-log-FK'er bevares; rækkerne bliver `data_incomplete`
  med `missing_hours=NULL`, ufuldstændig coverage/årsag og uden aktuel
  snapshot/proof-binding. Næste gyldige evaluering genbruger resultat-ID'erne.
- Freshness kræver kildeobservation fra `captureHoursDataset`: en serverstyret
  to-pass-læser med pagingvalidering og serverens tidspunkt ved capture-start,
  ikke CLI'ens importtid eller en klientangivet timestamp. `server_captured`
  sættes kun af denne trusted in-process capture. Importerede evidensfiler kan
  bruges historisk, men en angivet `--observed-at` giver ikke uge-live-freshness.
- Historiske dry-runs kræver eksplicit opt-in og mærkes altid
  `explicit_historical_demo`, også hvis en observationstid er nyere.
  Fredag 27. marts alene er aldrig ugebevis.
- Positive dage kan bruge `ek_v4_all_projects_single_day_two_pass_v2` for
  det verificerede v4-periodeendpoint uden projekt-/fitterstatusfilter.
  Kontrakten kræver præcise dags-/pageSize-parametre, scope/kildereference
  og alle eksisterende to-pass/pagination/fejl/dato/ID/hash-kontroller.
  En lukket-projekt-række er ikke et krav pr. dag. Projektets aktuelle
  status afgør ikke om timer tæller; kun godkendte timearter medregnes.
  V1 og historiske revisioner bevares; v2-revisioner er særskilte.
  Faktiske oktoberdata og martsregression er dokumenteret i
  [kilderapporten](evidence/FITTERHOURS_2026-10-05_2026-10-09.md).
- En komplet nul-dag kræver to identiske terminale request-side-1-svar med
  `currentPage=0`, total/rækker
  nul, begge hashes for det tomme array, nul API-fejl og eksplicit
  `ek_v4_all_projects_empty_day_v1`-endpointkontrakt med `emptyCurrentPage=0`, evidensreference,
  inkluderende datofilter og afsluttede projekter. 0054 tillader `row_count=0`
  kun med disse strukturelle beviser; 0052 er ikke ændret.
  `unclear`: faktisk EK-verifikation af nul-total på alle relevante endpoint-
  versioner er ikke udført her. Kontrakten skal underbygges af ekstern
  endpointdokumentation/observation før en rigtig nul-dag kan udgøre bevis;
  syntetiske testfixtures er ikke EK-bevis.
- Medarbejdermail: To administratorgodkendt fitter-mail, CC DEP.
  Lederoversigt: To DEP, CC LKE, kun medarbejdere med ugepåmindelse.
  Lederteksten viser medregnede timer/norm og igangværende registrering,
  ikke et konstateret antal manglende timer.
- Nøglen er tenant/fitter/mandag/`employee_weekly_reminder_v1`;
  ledertypen er `friday_weekly_summary_v1`. Nøglerne er uafhængige af run,
  datasæt, login og adresse. Session-advisory-lock er tenant/kontrolversion/
  mandag; eksisterende unikke mail-log/outbox-nøgler giver DB-idempotens.
  Provider-linkede logs ændres eller køsættes aldrig igen, heller ikke
  ved dry-run efter en tidligere live-kø.
- Live-evaluering/enqueue og outbox-dispatch afviser afsendelse uden for
  samme fredag kl. 12.00–14.29.59 i København. Ved kl. 14.30 eller senere
  dead-letteres en due ugepåmindelse uden providerkald. Dette er en
  deadlineguard, ikke en godkendt catch-up-/retry-driftsstrategi.
  Dispatch genvaliderer desuden tenant/run/snapshot/mail-log/result-binding,
  live/completed-status, klassificerede resultater og alle fem aktuelle
  server-captures med den aktuelle freshness-grænse. Historisk, udskiftet,
  invalideret eller forældet evidens dead-letteres uden providerkald.
  Run/result/heads holdes læselåst gennem providerkaldet, så publication eller
  genkørsel ikke kan ændre beslutningsgrundlaget mellem validering og afsendelse.

## Lokal anvendelse og næste godkendelsesgrænse

CLI fra repo-roden:

```powershell
node backend\scripts\run_time_control.js --tenant hoyrup-clemmensen --date 2026-03-27 --control-type friday_weekly_v1 --dry-run --hours-dataset-ids "<mandag-uuid>,<tirsdag-uuid>,<onsdag-uuid>,<torsdag-uuid>,<fredag-uuid>" --historical-snapshot
```

Admin-API `POST /api/tenant/admin/time-control/test-runs` kræver eksisterende
tenant-host/token/tenant-admin-scope. Ugeversionen bruger `control_type`,
`date`, `hours_dataset_ids` (fem UUID'er) og `historical_snapshot`; denne
admin-testvej tvinger altid dry-run. UI findes på `/tenant/time-control.html`
og via tenant-admin-navigationen; historiske dagsresultater og mailpreviews
vises med deres oprindelige type/ordlyd.

Schedulerens nye ugeversion henter fem dage sekventielt gennem den afgrænsede
v4-adapter og vælger de publicerede tenant/dag-heads server-side. Manglende
eller usikkert bevis blokerer uden legacy-sync. Generel full-resync benyttes
ikke af Timekontrol; øvrige syncflows ændres ikke.

Tests: `test/timeControlWeekly.test.js`,
`test/timeControlWeeklyPostgres.integration.js`, eksisterende daily/Friday-
integration samt upgrade-testen i `test/dbMigrate.test.js`. Lokal PG17-
verifikation bruger nye guarded disposable databases og faktiske 56 migrations;
legacy-audit-allowlisten (101 typer før Timekontrol plus de eksisterende
Timekontrol-typer) ændres ikke af 0054.

Fortsat ikke godkendt/udført: production 0054–0056, deploy, aktuel runtime-
dry-run, provider-mail eller scheduleraktivering. Eksterne beviser nedenfor
er de bevarede historiske EK-læsninger, ikke et nyt live-runtime-bevis.

## Dagsvis capture og opstart: lokal implementering, ikke aktiveret

Migration 0056 tilføjer immutable drifts-epochs og kontrolkvitteringer samt
en tenant-/gruppeafgrænset aktiv/pauset pointer. En gyldig historisk uge kan
beregnes internt, men er ikke tilladelse til at sende. Regelprofiler,
medlemsimport, generel FitterHours-import og stor historisk backfill venter.

### Planlagte kontroller og dokumentation af foerste fulde driftsuge

Alle tidspunkter og kalenderdatoer bruger Europe/Copenhagen:

| Koersel | Kontrolleret periode | Krav til dokumentation |
| --- | --- | --- |
| Tirsdag kl. 09, daily_09 | Mandag | Faktisk planlagt dagskontrol, gyldigt capture og klassifikation |
| Onsdag kl. 09, daily_09 | Tirsdag | Samme krav |
| Torsdag kl. 09, daily_09 | Onsdag | Samme krav |
| Fredag kl. 09, daily_09 | Torsdag | Samme krav |
| Fredag kl. 12, friday_weekly_v1 | Mandag-fredag | Genobservation af alle fem dage, inklusive foreloebig fredag |

Tenant-admin registrerer faktisk starttid, `covered_from` og den godkendte
kontrolgruppes identitets-/mailgodkendelser. Start mandag eller tirsdag før
kl. 09 kan kvalificere ugen, hvis gruppen udtrykkeligt har været omfattet
siden mandag. Start kl. 09 eller senere tirsdag (eller senere på ugen)
giver kun intern ugeopgørelse. En efterfølgende fuld uge kan kvalificere.
Pause/genstart opretter en ny epoch; gamle kvitteringer bliver ikke nye.

Server-side gate kræver fire immutable `daily_09`-kvitteringer samt en
`friday_weekly_v1`-kvittering bundet til den aktuelle ugesnapshot. De gemmer
run-ID, original result-JSON, dataset/snapshot, faktisk start/slut og
identitetshash. Kun live-kørsler startet af scheduler i det planlagte minut
og afsluttet før kl. 09.15 henholdsvis 12.15 udsteder kvitteringer.
Disse 15 minutter er et begrænset gennemførelsesvindue, ikke catch-up.
Manuelle kørsler tvinges til dry-run, og dry-run/backfill udsteder ingen
driftskvitteringer. En dagskontrol under dagsnormen er stadig gyldig.

En manglende, fejlet eller blokeret planlagt kontrol holder ugen intern.
Senere fredagsgenobservation maa ikke genfortolke den gamle dagskontrol;
dens originale snapshot/audit bevares. Driftsuge-gaten skal kontrolleres
baade ved enqueue og dispatch. Audit skal vise hvilke fem kontroller
afgoerelsen bygger paa, eller praecis hvilken kontrol der mangler.
Dispatch kræver alle fem friske, aktuelle server-captures igen, uændret
identitet og klassifikation samt samme aktive epoch. Dagsmails stopper
kl. 09.15; ugepåmindelser stopper kl. 14.30. Gamle køer dead-letteres uden
provider-kald. To/CC og tenant/fitter/uge/mailtype-idempotens bevares.

### Implementeret afgrænset datakæde og invalidering

1. Bind dokumenteret v4-periode-GET til eksisterende to-pass capture.
   Hent alle tenantens timer for een dag, uden projekt-/gruppefilter.
   Verificer response/errorflags, fast understøttet pageSize, faktisk
   nextPage-fremdrift, terminal respons, datoer, distinkte ID'er og total.
   API-fejl, ukendt responseform og afbrudt pagination er aldrig nul-dage.
2. Publicer kun komplette captures i immutable dagstabeller. Bevar korrekt
   capture-starttid, revision og henteevidens; importtid er ikke freshness.
   En ny observation med rettelser eller sletninger giver nyt capture/head,
   ikke mutation af historikken. Fejlet genhentning invaliderer aktuelt head
   med audit; genopretning kræver en nyere komplet observation.
3. Inden dagskontrol hentes den foregaaende arbejdsdag. Ved opstart hentes
   tidligere arbejdsdage separat som catch-up. Inden fredag kl. 12
   genobserveres mandag-torsdag og foreloebig fredag, saa alle fem captures
   er inden for freshness. Backfill forventes ikke at vaere live-bevis.
4. Tilfoej den eksplicitte driftsuge-gate ovenfor uden at aendre norm,
   loenartsregler eller mail-idempotens. Test start mandag kontra midt i ugen,
   manglende dagskontrol, catch-up, stale/ukendt data, gentagelser og overlap.
5. Verificer lokalt med PostgreSQL og historisk dry-run foer separat
   rollout-godkendelse. Test nul providerafsendelser og uændret historisk demo.

Invalidering committes **før** EK-læsning. Process-stop, API-fejl eller
ustabilt udtræk efterlader derfor intet sendbart gammelt head. Tidligere
datasets slettes ikke. Publication kræver nyere kildeobservation og gyldigt
to-pass-bevis; den ændrer kun den aktuelle pointer. En dato-advisory-lock
serialiserer captures. Kontrol-/mailnøgler og databaseconstraints beskytter
genstart og samtidige kontroller mod dobbeltpåmindelser. Forudgående mutable
run/result-visning arkiveres som audit-JSON før reevaluering; previews og
immutable kontrolkvitteringer beholder oprindelig betydning.

`POST /api/tenant/admin/time-control/catch-up` henter tidligere arbejdsdage i
indeværende uge og evaluerer dem som intern `manual`/`backfill` dry-run uden
medarbejderpreviews, forsinkede mails eller driftskvitteringer.
`GET/POST /api/tenant/admin/time-control/operation` viser/ændrer driftsstatus;
POST kræver tenant-admin og eksplicit tenant-/statusbekræftelse. Historiske
testkørsler behøver ingen scheduler.

Den faktiske nul-dagskontrakt er stadig uafklaret. Adapteren blokerer tomme
EK-svar med tydelig diagnose; syntetiske nul-dagsfixtures er ikke kildebevis.
API-budget og separat rollout står i mail-runbooken.

Endpointbevis for alle projekter er adskilt fra en konkret kontrolraekke
i den lokale v2-kontrakt. En fuld dag uden lukket-projekt-raekke accepteres
med det verificerede endpointbevis; ingen kunstig kontrolraekke indsættes.
V1's oprindelige beviser og krav ændres ikke.

### EK-grupper og FD-lederadgang: forslag, ikke strukturændring

EK er kilde til gruppedefinitioner og medlemskab. Tenant-afgrænsede
resource_groups/resource_group_members bevares som lokal lagring; fremtidig
synk skal bevare observationstid, kilde og historik for til-/afgang.
En fitter kan have flere grupper, og en leder kan have adgang til flere.
Gruppen med 183 i navnet har EK-ID 61; navn er aldrig identitetsnoegle.

Den nuvaerende eksterne OpenAPI dokumenterer resourceGroups[] med id/name
i kalenderens fitter-DTO, men ingen komplet gruppe-/medlemsliste.
Kalenderassociationer beviser kun observeret medlemskab; tidspunktets
betydning er uafklaret. Fravaer fra kalenderen maa ikke fjerne medlemskab.
Forventningen om mindst een gruppe for hvert EK-login er ikke verificeret.

Manglende kontrakt: autentificeret komplet gruppeliste, stabile gruppe-ID'er,
komplet medlemsliste pr. gruppe/fitter uden kalenderkrav, fleremedlemskaber,
aktiv/inaktiv-status, observation/version og semantik for fjernede medlemmer.
Desuden mangler ekstern dokumentation af gruppefiltre/timer til godkendelse
og sammenhaeng med lederens EK-dashboard. Admin/ResourceGroups_Get og
dashboardets F12-kald er spor til senere undersoegelse, ikke godkendte eksterne
API-adaptere. Ingen private endpoint-autentifikationsantagelse anvendes.

Tenant-admin administrerer FD-lederadgang og abonnementer, ikke fremtidige
EK-styrede medlemsrelationer. Genbrug resource_group_managers som udgangspunkt,
men afklar server-side rettigheder og audit foer lederkontroller implementeres.
Lederen kan kun vaelge kontrol/notifikation for tildelte grupper.
Timer deduplikeres efter tenant/registrerings-ID foer gruppeoplevelser summeres.
Ingen time summeres igen, fordi fitteren tilhoerer to valgte grupper.

Forslag til ansvar: een tenant/fitter/uge/mailtype-notifikation og een
administratorvalgt ansvarlig leder/routing pr. fitter. Flere abonnementer
modtager adgangsafgrænsede interne overblik, ikke ekstra teknikermails.
Ved overlappende ledere uden afklaret ansvar/routing blokeres enqueue med
intern diagnosticering frem for first-writer-wins. Prioritet/ansvar
fastsaettes auditeret af tenant-admin, ikke af gruppenavn eller EK-login.
Manuel gruppedefinition/medlemsadministration udfases kun for EK-styrede
grupper efter valideret kilde, konfliktkontrol og særskilt migreringsgodkendelse.

### Separat backlog, ikke dags-capture-opgaven

- Ekstra operationel CC/BCC er udrullet og HC's observermodtagere gemt efter
  [routingkontrakten](../calendar/ABSENCE_NOTIFICATIONS_OUTBOX_PR4.md#tenant-admin-ekstra-ccbcc-til-driftsmails).
  Verificeret 23. oktober efter godkendt migration 0065/webudrulning samt
  admin-gem af HC's JEL-BCC på individuel dags-/ugemail og ugens
  lederoversigt før nye køposter. Ingen monitor-/diagnostikkopi eller gammel
  replay er omfattet; gruppebaseret lederrouting er fortsat et separat spor.
- Historisk backfill: projektvis retention, omfang/omkostning, konfliktkontrol,
  dataklassifikation og ingen paastand om live-freshness fra importtid.
- Generel syncdrift: eksisterende parser læser ikke dokumenteret v4
  data.data[]-objektcontainer og afviser ikke API-fejlbody som saadan.
  Test/fix isoleret uden at omdanne tom respons til komplet dagsbevis.
- Generel syncdrift: side-resume efter last_successful_page, pageSize-skift
  ved 429, totalafstemning, delta-watermark og slettede rækker kræver
  selvstaendig review; det aendrer ikke dags-capture-kravet.
- Generel syncdrift: gammel delta-jobrække markeret running kan blokere ny
  planlægning. Undersøg proces/lease/heartbeat og dokumenteret recovery;
  ingen reset, restart eller jobstart er godkendt i kildeverifikationen.

## Referencer

- [Nuværende POC og demo-runbook](../../runbooks/MAIL_PROVIDER_VERIFICATION.md)
- [Beslutningsindeks](../../DECISIONS.md)
- [EK timedækning](../../../backend/docs/integrations/ek/fitterhours.md)
- [EK-gruppekilder og kalenderens begrænsninger](../../../backend/docs/integrations/ek/tenant_admin_fitters_resource_groups.md)
- [Eksisterende tenant-afgrænset gruppe-/lederlagring](../../../backend/src/modules/resourceGroups/resourceGroup.repository.js)
- [Eksisterende syncreader og parser](../../../backend/src/services/syncWorker.js)
- [Immutable dataset-publication og invalidering](../../../backend/src/modules/timeControl/timeControl.dataset.js)
