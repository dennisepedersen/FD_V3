# Fielddesk AI Development Workflow

Status: current working model
Scope: defines collaboration between ChatGPT, Codex, and Dennis

## Dokumenthierarki

`docs/AI_GOVERNANCE.md` er autoritativ for overordnede AI-sikkerheds-, governance- og adfærdsregler.

`docs/AI_DEVELOPMENT_WORKFLOW.md` er autoritativ for den praktiske arbejdsdeling og leveranceproces mellem ChatGPT, Codex og Dennis.

Dokumenterne supplerer hinanden. Ved konflikt gælder den strengeste sikkerhedsregel. Produkt-, arkitektur- og sikkerhedsbeslutninger i relevante canonical docs og `docs/DECISIONS.md` tilsidesættes ikke af workflow-dokumentet.

## Formål

Fastlæg den autoritative arbejdsdeling mellem:

- ChatGPT i Fielddesk-projektchatten
- Codex
- Dennis

Formålet er at undgå dobbeltarbejde, brede gentagne audits, uklart ansvar, falske readiness-blockers og unødige stop i udviklingsflowet.

## Roller

### ChatGPT / Fielddesk-Projektchat

Ansvar:

- analysere produktkrav og scope
- undersøge eksisterende kode og arkitektur via GitHub
- læse PR-diffs direkte
- udføre kode-, arkitektur- og sikkerhedsreview
- finde fejl, race conditions og manglende guards
- vurdere om en PR er merge-klar
- skrive præcise implementerings- og rettelsesprompts til Codex
- holde styr på beslutninger, scope og næste trin
- beskytte mod scope creep
- afgøre hvilke fund der er reelle blockers, og hvilke der er kendte miljøforskelle eller falske positiver

ChatGPT er review-, arkitektur- og styringslaget.

### Codex

Ansvar:

- arbejde i det lokale repository
- starte fra opdateret `main`
- oprette branches
- ændre kode
- køre `npm test`
- køre `npm run check`
- køre målrettede tests
- committe og pushe
- oprette og opdatere PR'er
- merge efter eksplicit godkendelse
- kontrollere GitHub Actions
- udføre Render-deploykontrol
- køre Render one-off jobs
- køre migrationer efter godkendt gate
- udføre live API-tests med lokale credentials
- holde secrets ude af output og repository
- rapportere konkrete verificerede blockers i stedet for brede antagelser

Codex er det udførende udvikler- og terminaloperatørlag.

### Dennis

Ansvar:

- produktbeslutninger
- prioritering
- godkendelse af scope
- godkendelse af merge, deploy og andre risikofyldte handlinger
- manuel UI-, mail- og mailbox-verifikation
- indtastning og opbevaring af lokale credentials
- endelig forretningsmæssig accept

## Standard Workflow

1. Dennis beskriver opgaven i Fielddesk-projektchatten.
2. ChatGPT undersøger relevant kode, dokumentation, arkitektur og tidligere beslutninger.
3. ChatGPT skriver en præcis Codex-implementeringsprompt.
4. Codex implementerer på en ny branch fra frisk `main`.
5. Codex kører tests og checks, pusher og opretter PR.
6. ChatGPT læser og reviewer PR-diff direkte via GitHub.
7. ChatGPT beskriver eventuelle konkrete review-fund.
8. Codex retter fundene på samme branch og PR.
9. ChatGPT vurderer merge-readiness.
10. Codex merger først efter godkendelse og med forventet head-SHA.
11. Codex verificerer `main`, deploy, migration og live-state efter den aftalte gate.
12. ChatGPT vurderer resultatet og definerer næste trin.

## Ingen Gentagen Bred Audit

Codex skal ikke starte med en generel read-only audit, når ChatGPT allerede har:

- undersøgt repoet
- fastlagt scope
- identificeret relevante filer
- beskrevet konkrete krav og risici

Codex må lave den målrettede inspektion, der er nødvendig for implementeringen.

Hvis Codex finder noget, der modsiger promptens forudsætninger, skal den stoppe og rapportere det konkret.

Codex skal ikke gentage arbejde, som ChatGPT allerede har udført via GitHub-review, medmindre der er en konkret teknisk grund.

## GitHub Og Review

ChatGPT bør som udgangspunkt:

- læse PR metadata
- læse changed files
- læse diff og relevante filer
- udføre review
- vurdere merge-readiness
- formulere review-fund og næste Codex-opgave

Codex bør som udgangspunkt:

- ændre kode
- køre lokale checks
- committe og pushe
- oprette og opdatere PR
- merge med lokal GitHub-adgang efter godkendelse
- udføre handlinger, der kræver lokal working tree, credentials eller terminaladgang

## Readiness For Nye Opgaver

`READY FOR NEW TASKS` kræver:

- aktiv branch er `main`
- worktree er clean
- lokal `main` matcher `origin/main`
- `main` er `0 ahead` og `0 behind`
- ingen merge, rebase, cherry-pick eller revert er i gang
- ingen åben PR fra den netop afsluttede opgave
- `npm test` er grøn
- `npm run check` er grøn
- live deploy matcher `main`, når relevant
- health endpoints er grønne, når relevant
- produktionsmigrationstatus verificeres i Render/Linux

Gamle lokale `backup/`, `archive/`, `safety/`, `hold/` eller historiske branches er ikke automatisk blockers, når:

- aktiv branch er `main`
- worktree er clean
- lokal `main` matcher `origin/main`
- ahead/behind er `0/0`
- ingen åben PR bygger på de gamle branches
- næste opgave starter fra frisk `main`

De skal kun være blockers, hvis:

- næste opgave bygger på dem
- de indeholder aktuelt arbejde, der burde være pushet
- de skaber konkret risiko for tab af arbejde
- de er basis for en åben PR eller aktiv opgave
- næste opgave ved en fejl bygger videre på dem

Der må ikke gives `NOT READY FOR NEW TASKS` alene fordi historiske lokale branches eksisterer.

## Readiness Og Platformsspecifikke Falske Positiver

Readiness må ikke fejle på grund af kendte platformsspecifikke forskelle alene.

### Migration Checksums

Produktionsmigrationstatus skal vurderes i Render/Linux, hvor migrationerne faktisk køres.

Lokale Windows-checksum mismatches må ikke alene give `NOT READY FOR NEW TASKS`, når:

- `git diff -- migrations` er tom
- Git blob bruger LF
- lokal working tree bruger CRLF
- LF-normaliseret lokal hash matcher Git blob
- Git blob matcher DB-registreret checksum
- Render/Linux viser `0 checksum mismatch`

I denne situation er mismatchen et lokalt line-ending-falsk positiv og ikke migrationsdrift.

Codex må aldrig:

- ændre gamle anvendte migrationsfiler for at få lokal status grøn
- opdatere DB-checksums for at skjule mismatch
- genkøre migrationer uden godkendt gate
- lave line-ending rewrite commits uden særskilt godkendelse

## Migrationstatus

Produktionsmigrationstatus skal verificeres i det miljø, hvor migrationerne køres, normalt Render/Linux.

Lokale Windows-checksum mismatches må ikke alene behandles som produktionsblocker, før line endings og Git blob-hashes er undersøgt.

Render/Linux er autoritativ for produktionsmigrationstatus.

Ved lokal mismatch skal Codex sammenligne:

- lokal filhash
- LF-normaliseret lokal hash
- Git blob-hash fra `origin/main`
- DB-registreret checksum
- Render/Linux status

Der må aldrig:

- opdateres checksums i produktion for at skjule mismatch
- redigeres i anvendte migrationer uden særskilt beslutning
- genkøres migrationer uden godkendt gate

## Secrets

ChatGPT skal ikke modtage passwords, JWT'er, API keys eller invitation tokens i chatten.

Codex må kun læse secrets fra:

- lokalt ignorerede filer
- godkendte secret stores
- sikre environment variables

Secrets må ikke:

- udskrives
- logges
- committes
- indsættes i PR'er
- gemmes i audit metadata
- gemmes i lifecycle metadata
- eksponeres i terminal-output

Lokale credential-filer skal være Git-ignorerede og må ikke læses eller vises uden konkret behov i en godkendt opgave.

## Stopregler

Codex skal stoppe før:

- merge, medmindre merge er eksplicit godkendt
- deploy, hvis deploy ikke er en del af den godkendte opgave
- produktionsmigration, indtil precheck-gate er godkendt
- brugerændringer, hvis target eller credentials ikke er sikkert verificeret
- workaround, der omgår normal auth eller sikkerhed
- sletning eller push af gamle lokale branches uden særskilt besked
- ændring af produktionschecksums eller anvendte migrationer

Hvis Codex stopper, skal årsagen være konkret og verificeret.

## Outputformat

Codex skal rapportere faktiske resultater og hashes, ikke blot "done".

Rapporter efter behov:

- branch
- PR
- head commit
- tests
- GitHub Actions
- merge commit
- deploy-ID
- migrationsstatus
- health
- kendte begrænsninger
- præcis stopstatus

Readiness skal afsluttes med præcis én af:

`READY FOR NEW TASKS`

eller

`NOT READY FOR NEW TASKS`

`NOT READY FOR NEW TASKS` må kun bruges ved konkrete, verificerede blockers.
