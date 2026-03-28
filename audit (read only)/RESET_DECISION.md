# RESET_DECISION.md
## Fielddesk V2 -> V3 beslutningsgrundlag

Kilder anvendt:
- DB_OVERVIEW.md
- API_MAP.md
- ENV_MAP.md
- TENANT_MAP.md
- AUTH_FLOW.md
- SCOPE_MODEL.md
- FILE_USAGE.md

Dato: 2026-03-24
Type: Beslutningsanalyse. Ingen kodeaendringer.

---

## 1. Executive summary

Anbefaling: B) Genopbyg som clean V3 workspace.

V2 indeholder flere samtidige hard blockers, som goer sikker sanering i samme kodebase hoejrisiko.
Tenant-model, auth-flow, scope-logik, env-struktur og dokumentationslag er ikke konsistente nok til kontrolleret in-place oprydning.
Der er hardcodede tenants (dep), legacy auth paths, plaintext fallback-login, default secrets og dobbelt schema-kilde.
Scope er implementeret baade i DB-paths og in-memory fallback, hvilket giver uforudsigelig adfaerd pr endpoint.
Doc/reality mismatch er kritisk: beslutningskrav omtaler tabeller som ikke findes i schema/migrationer.
Sandbox og dev-override spor er blandet ind i runtime-adfaerd og kan laekke ind i produktion ved forkert env.
V2 kan fortsat bruges som referencekilde, men ikke som sikker fundamentkode.
Risikobilledet er arkitektonisk, ikke kun teknisk gaeld.
En V3 clean start reducerer risiko for skjult legacy-adfaerd og giver mulighed for formel godkendelse af data-, auth- og tenant-grundmodel foer UI.
Konklusion: Vaelg B nu, og laas V2 til read-only reference.

---

## 2. Hard blockers i V2

- Hardcodede tenants og fallback-spor:
  - dep som sandbox tenant
  - default tenant slug = dep
  - dev username override = dep
- Env-var forvirring og usikre defaults:
  - APP_AUTH_SECRET default vaerdi i kode
  - AUTH_TOKEN_SECRET alias/fallback
  - FD_CREDENTIALS_SECRET fallback til auth secret (samme noegle til signering + kryptering)
  - flere legacy aliaser med overlap
- Auth/tenant resolution problemer:
  - custom tokenformat uden standard JWT-kontrol og uden key-rotation
  - legacy plaintext login-fallback (owner/member)
  - global admin plaintext compare
  - sandbox login uden credentials
- Scope-logik er splittet:
  - mine delvist DB-baseret, men all/team in-memory
  - time-entries scope in-memory only
  - team scope ikke reelt defineret
- Tenant isolation mangler DB safety-net:
  - ingen RLS
  - isolation afhanger af korrekt tenant filter i hver query
- Doc/reality mismatch (kritisk):
  - audit_events paakraevet i beslutninger men findes ikke i schema
  - tenant_configuration_snapshots omtalt i status men findes ikke i schema
- Schema drift og dual authority:
  - schema.sql og postgres.js begge schema-kilder
  - tenants seed refererer slug-kolonne som ikke findes i tabeldefinition
- Legacy/forkerte driftsspor:
  - in-memory fallback paths i kritiske API flows
  - global E-komplet env credentials parallelt med per-tenant credentials

---

## 3. Hvad der er vaerd at bevare

- UI/design-retning og navigationens modul-opdeling (dashboard, projects, time, review, qa).
- Verificerede governance-principper i dokumenter:
  - backend as source of truth
  - tenant isolation is absolute
  - fail-closed/default deny
- Datamodeller der kan genbruges i moderniseret form:
  - tenants, tenant_features, tenant_admin_invites, tenant_admin_credentials
  - tenant_integration_credentials
  - users, projects, ek_fitterhours, ek_fittercategories
  - tenant_sync_state
- EK integrationsprincipper:
  - per-tenant credentials
  - paged sync med retry/resume-state
- Role mapping-konceptet (EK roller -> FD roller) som domaenelogik.
- Auditdokumenterne i V3/audit som referencegrundlag for V3 blueprint.

---

## 4. Hvad der IKKE maa flyttes til V3

- Konkrete tenants fra V2:
  - dep
  - hoyrup-clemmensen
- Demo/test tenants, historiske subdomaener og alle tenant-specifikke seeds.
- Hardcoded defaults i auth/tenant:
  - default tenant slug
  - default owner/member credentials
  - insecure default token secret
- Legacy auth shortcuts:
  - plaintext fallback login
  - sandbox token uden credential check
  - admin plaintext compare
- Ubrugte/uklare runtime paths:
  - in-memory scope fallback som primarlag
  - global E-komplet env key path i stedet for tenant credentials
- Ubrugte eller uklare endpoints/tabeller uden verificeret ansvar.
- Uklare scope-definitioner (team/all) uden explicit policy-model.

---

## 5. Anbefalet V3 foundation (raekkefolge)

1. Global admin only starttilstand.
2. Tenant invitation model (token lifecycle, expiry, revoke, accept).
3. Tenant table design (id, lifecycle state, audit fields, immutable identity).
4. Tenant domain/slug model (unik, valideret, ingen implicit fallback).
5. Tenant onboarding flow (invitation -> activation -> first admin -> ready).
6. Tenant config storage (versioneret tenant configuration + snapshots).
7. RBAC/roles model (platform roles vs tenant roles, explicit precedence).
8. Scope model (mine/team/all med entydig semantik og backend enforcement).
9. EK connection model (kun per-tenant credentials, test-status, rotation).
10. Sync model (bootstrap/delta/resume state, fail-closed, idempotent writes).
11. Project core/WIP model (projekter, statushistorik, relationer, ownership).
12. Godkendt DB schema før API/UI implementation.

---

## 6. Reset-strategi (praecis sletteplan)

Database:
- Slet alle V2 runtime data-tabeller og seed-data i reset-miljoe.
- Behold intet tenantindhold.
- Drop/arkiver alle rows for:
  - tenants
  - users/projects
  - tenant mappings
  - integration credentials
  - sync state
  - ek time/category data
  - qa thread/message data
- Opret V3 schema fra nul efter godkendelse.

Env vars:
- Fjern alle legacy aliaser fra runtime-konfiguration.
- Fjern default credentials og default secrets.
- Fjern dep-relaterede fallback envs.
- Fjern globale E-komplet noegler som ikke er tenant-specifikke.

Subdomaener:
- Afmeld alle eksisterende tenant subdomaener.
- Behold kun neutral V3 entrypoint + admin invitation entrypoint.
- Ingen auto-routing til tenant uden aktiv onboarding.

Blobs/files:
- Ryd blob/storage for tenant-specifikke uploads, exports, rapport-cache og QA artefakter.
- Ryd historiske sync-debug filer der indeholder tenantdata.

Seed/demo data:
- Fjern alle dep/demo seeds.
- Ingen default owner/member users i V3.
- Ingen hardcodet sandbox tenant.

Hardcoded kode:
- Fjern alle dep/HC faste vaerdier.
- Fjern dev identity bypass paths fra produktionskode.
- Fjern legacy auth fallback og implicit tenant fallback.

---

## 7. Acceptkriterier foer V3 maa begynde

- System er tomt for tenantdata og demo/seed spor.
- Kun global admin invitation side er aktiv ved opstart.
- Ingen dep/HC spor i kode, env eller data.
- Tenant isolation model er dokumenteret og godkendt.
- Auth + onboarding flow er visualiseret og godkendt.
- RBAC + scope model er specificeret med backend enforcement.
- V3 DB schema er godkendt foer API/UI arbejde starter.
- Ingen legacy aliaser/noedpaths i runtime-konfiguration.

---

## 8. Kendte unknowns

- Fuldt ansvar for alle defaultFeaturesForRole/defaultPermissionsForRole paths er ikke endeligt kortlagt.
- Om enkelte reports/static datafiler bruges i drift eller kun audit er ikke fuldt verificeret.
- Endelig liste over alle historiske subdomaener uden for kode er ikke verificeret i DNS/platform.
- Endelig klassifikation af potentielt ubrugte endpoints/tabeller kraever runtime-telemetri.
- Visse onboarding state transitions er ikke fuldt verificeret i alle edge-cases.

---

## Beslutning

Endelig anbefaling: B) Clean V3 workspace.

Begrundelse: Risikoen for skjulte legacy-spor, sikkerhedsafvigelser og governance-mismatch i V2 er for hoej til sikker sanering som primar strategi.
