# Timekontrol: fredagens ugepaamindelse

Status: besluttet til naeste version; ikke implementeret eller deployed
Beslutningsdato: 2026-10-11
Godkendt af: Dennis Espersen Pedersen
Scope: fredagens medarbejderpaamindelse i Timekontrol

## Afgrænsning fra dagsbaseret POC

Denne beslutning ændrer ikke den igangværende dagsbaserede POC/demo.
Den nuværende `friday_12` vurderer en enkelt fredag med dagsnorm 7 timer.
Ugekontrollen maa ikke implementeres, migreres, aktiveres eller deployes som
del af denne demo. Den aktuelle deploy-/migrationsblokering er et separat
forhold og løses ikke af denne beslutning.

## Reglement for næste version

- Fredag kl. 12.00 i `Europe/Copenhagen` kontrolleres summen af godkendte
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
- Mailen maa vise registrerede godkendte timer og ugenormen. Forskellen maa
  ikke beskrives som en konstateret mangel: fredagens arbejde og registrering
  er stadig i gang ved kontrollen.
- Mailen skal oplyse, at medarbejderen kan se bort fra beskeden, hvis resten
  allerede er registreret efter kontrollen.

Eksempel paa den fremtidige mailtekst (ikke en aktiv mailskabelon):

> Ved kontrollen fredag kl. 12.00 kunne Fielddesk se {godkendte_timer}
> godkendte timer for denne uge. Ugenormen er 37 timer.
> Husk at færdiggøre ugens timeregistrering inden hjemgang kl. 14.30.
> Fredagen er stadig i gang. Du kan se bort fra denne besked, hvis du allerede
> har registreret resten efter kontrollen.

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
  godkendte timer, norm, klassifikationsstatus og paamindelsesbeslutning.
  Under 37 timer ved middag er en paamindelsesbeslutning, ikke et konstateret
  slutunderskud.

## Backlog og acceptkriterier

Alle punkter er til næste version og er ikke udført:

- [ ] Implementér ugeperiode mandag-fredag i København, inklusive uge-/aarskift.
- [ ] Implementér samlet, datasætbundet ugebevis med freshness og
  invalidation ved rettelser/sletninger; dækningsfejl skal være fail-closed.
- [ ] Implementér sum af godkendte lønartsreferencer mod 37 timer uden
  selvstændig fredagsnorm eller krav om fem bestaaede dagskontroller.
- [ ] Adskil ugepaamindelsesstatus fra POC'ens konstaterede dagsmangel.
- [ ] Tilføj særskilt mailskabelon med kl. 14.30, snapshot-timer/norm og
  besked om at se bort fra mailen efter senere registrering.
- [ ] Implementér tenant/fitter/uge/mailtype-idempotens og audit med
  databaseconstraints; test samtidighed, retry og adresseændring.
- [ ] Test under, præcis og over 37 timer; godkendt fravær; ekskluderede
  tillæg; ukendte lønarter; manglende dag; komplet nul-dag; ændrede datasæt.
- [ ] Test højst én ugepaamindelse og ingen medarbejdermail ved usikkert
  datagrundlag; bevar intern diagnosticering og nul provider-mail i dry-run.
- [ ] Afklar ledermailens ugeindhold separat. Denne beslutning fastlægger
  medarbejderpaamindelsen, ikke en ny ledermailkontrakt.
- [ ] Afklar driftsmæssig retry/catch-up uden forsinket paamindelse efter
  fristen; ret schedulerens kendte retry-/tenant-statusforhold før aktivering.
- [ ] Gennemfør særskilt implementering, review, migration-/runtimevalidering
  og godkendelse før deploy eller aktivering af ugekontrol/live/scheduler.

## Referencer

- [Nuværende POC og demo-runbook](../../runbooks/MAIL_PROVIDER_VERIFICATION.md)
- [Beslutningsindeks](../../DECISIONS.md)
- [EK timedækning](../../../backend/docs/integrations/ek/fitterhours.md)
