# V3_FOUNDATION_DESIGN

Formaal: Fastlaegge hele Fielddesk V3 fundamentet foer kode.
Kilde for beslutningsretning: V3/audit/RESET_DECISION.md.
Status: Endeligt build blueprint.

---

## 1. GLOBAL START STATE

V3 starter i platform-tilstand uden tenants.

Faste regler:
- Der findes ingen tenant ved systemstart.
- Der findes kun global admin identitet.
- Der findes kun en aktiv side: invitation.
- Alle andre routes returnerer deny, indtil en invitation er accepteret.

Global admin identifikation:
- actor_scope = global.
- role = global_admin.
- Global admin er platform-identitet, ikke tenant-bruger.
- Global admin maa ikke have implicit tenant access.

Adgangssikring:
- JWT valideres i backend paa alle beskyttede routes.
- Manglende eller ugyldig token giver hard deny.
- Global admin kan kun kalde invitation-endpoints i starttilstand.
- Alle tenant-relaterede endpoints kraever eksisterende tenant_id og afvises ellers.
- Frontend bruges kun til visning; autorisation sker kun i backend.

---

## 2. TENANT MODEL

Tabelnavn: tenant

Felter:
- id: uuid, primary key.
- slug: text, unique, not null.
- name: text, not null.
- status: enum invited | onboarding | active | suspended | deleted.
- created_at: timestamptz, not null.
- updated_at: timestamptz, not null.

Regler:
- slug er immutable efter oprettelse.
- slug er case-insensitive unik.
- der findes ingen fallback slug.
- der findes ingen default tenant.
- deleted er soft-delete status; data bevares til audit.
- alle tenant-referencer i systemet peger paa tenant.id, ikke slug.

---

## 3. TENANT DOMAIN MODEL

Tabelnavn: tenant_domain

Felter:
- id: uuid, primary key.
- tenant_id: uuid, not null, foreign key til tenant.id.
- domain: text, not null, unique.
- verified: boolean, not null.
- active: boolean, not null.
- created_at: timestamptz, not null.
- updated_at: timestamptz, not null.

Regler:
- der maa kun vaere praecis 1 aktiv domain pr tenant.
- domain maa ikke genbruges af andre tenants.
- active kan kun vaere true, hvis verified er true.
- host-resolution sker kun via tenant_domain, aldrig via fallback.

Domain og slug lifecycle:
- slug reserveres i samme transaktion som tenant-oprettelse i invitation accept.
- domain oprettes i onboarding lige efter tenant-oprettelse med active=false og verified=false.
- domain aktiveres kun efter verificering, og kun hvis tenant.status = active.
- ved tenant.status = suspended saettes tenant_domain.active = false.
- ved tenant.status = deleted saettes tenant_domain.active = false og domain forbliver reserveret.
- slug og domain er 1:1 i fase 1: praecis et aktivt domain pr slug og praecis en slug pr domain.

---

## 4. INVITATION FLOW

Tabelnavn: tenant_invitation

Felter:
- id: uuid, primary key.
- email: text, not null.
- token_hash: text, not null.
- expires_at: timestamptz, not null.
- status: enum pending | accepted | expired | revoked.
- tenant_id: uuid, nullable, foreign key til tenant.id.
- created_at: timestamptz, not null.
- accepted_at: timestamptz, nullable.
- revoked_at: timestamptz, nullable.

Flow:
1. global admin opretter invitation med email og udloeb.
2. system genererer plaintext token og gemmer kun token_hash.
3. token sendes til email-modtager.
4. modtager aabner invitation-side og sender token plus profilinfo.
5. backend validerer token_hash, status = pending og expires_at i fremtid.
6. backend opretter tenant med status = onboarding.
7. backend opretter foerste tenant_admin bruger i tenant_user.
8. backend opretter tenant_domain med active = false og verified = false.
9. backend markerer invitation som accepted og binder tenant_id.
10. backend udsteder tenant JWT for ny tenant_admin.

Ufravigelige regler:
- token lagres aldrig i klartekst.
- udloebne invitationer kan ikke aktiveres.
- revoked invitationer kan ikke aktiveres.
- samme invitation kan kun accepteres een gang.

---

## 5. TENANT USER MODEL

Tabelnavn: tenant_user

Felter:
- id: uuid, primary key.
- tenant_id: uuid, not null, foreign key til tenant.id.
- email: text, not null.
- name: text, not null.
- role: enum tenant_admin | project_leader | technician.
- status: enum active | suspended | invited | deleted.
- password_hash: text, not null.
- created_at: timestamptz, not null.
- updated_at: timestamptz, not null.

Regler:
- unique (tenant_id, lower(email)).
- brugeridentitet er tenant-bundet.
- ingen global username model i tenant_user.
- deleted er soft-delete status.

---

## 6. TEAM MODEL

Tabelnavne:
- team
- team_membership

team felter:
- id: uuid, primary key.
- tenant_id: uuid, not null, foreign key til tenant.id.
- name: text, not null.
- status: enum active | inactive.
- created_at: timestamptz, not null.
- updated_at: timestamptz, not null.

team_membership felter:
- team_id: uuid, not null, foreign key til team.id.
- tenant_user_id: uuid, not null, foreign key til tenant_user.id.
- tenant_id: uuid, not null, foreign key til tenant.id.
- membership_role: enum member | lead.
- created_at: timestamptz, not null.

Regler:
- team er altid tenant-bundet via tenant_id.
- tenant_user kan vaere medlem af et eller flere teams.
- unique (team_id, tenant_user_id).
- team_membership.tenant_id skal matche baade team.tenant_id og tenant_user.tenant_id.
- team-scope forklares udelukkende via team og team_membership.
- team_membership er create-delete uden update: en membership aendres ved sletning og genskabelse, aldrig ved UPDATE.

---

## 7. RBAC MODEL

V3 fase 1 starter med et minimumsrolle-sæt.
RBAC-modellen skal dog være udvidbar, så nye tenant-roller som fx finance, payroll, planner eller department_manager kan tilføjes senere uden ændring af auth-grundmodel eller tenant isolation.

Roller:
- global_admin
- tenant_admin
- project_leader
- technician

Ansvarsmodel:
- global_admin: platform governance, invitationer og tenant lifecycle. Ingen automatisk tenant dataadgang.
- tenant_admin: fuld tenant administration inklusiv brugere, teams, konfiguration og integrationsopsaetning.
- project_leader: projekt- og teamrelateret adgang inden for tenant.
- technician: egen opgave- og tidsadgang inden for tenant.

Backend enforcement:
- Hver route har fast policy: required_scope plus allowed_roles plus required_entitlements.
- Policy evalueres i backend middleware foer handler.
- Mangler en check, returneres deny.
- Ingen frontend-beslutning accepteres som sikkerhed.
- Ingen implicit elevation fra global_admin til tenant data.

---

## 8. PROJECT MODEL

Tabelnavne:
- project_core
- project_wip

Formaal:
- project_core er kanonisk, stabil projektrepraesentation.
- project_wip er mutable arbejdsdata til mellemtilstande.

project_core minimum:
- project_id: uuid, primary key.
- tenant_id: uuid, not null.
- external_project_ref: text, nullable.
- name: text, not null.
- status: enum open | closed | archived.
- owner_user_id: uuid, nullable.
- created_at: timestamptz, not null.
- updated_at: timestamptz, not null.

project_wip minimum:
- project_id: uuid, primary key, foreign key til project_core.project_id.
- tenant_id: uuid, not null.
- current_stage: text.
- risk_level: text.
- notes: text.
- updated_by_user_id: uuid.
- updated_at: timestamptz, not null.

Regler:
- join sker paa project_id.
- tenant_id skal matche mellem project_core og project_wip.
- API reads bruger project_core som baseline og project_wip som supplement.

---

## 9. PROJECT ASSIGNMENT MODEL

Tabelnavn: project_assignment

Felter:
- id: uuid, primary key.
- tenant_id: uuid, not null, foreign key til tenant.id.
- project_id: uuid, not null, foreign key til project_core.project_id.
- tenant_user_id: uuid, not null, foreign key til tenant_user.id.
- assignment_role: enum owner | contributor | reviewer.
- created_at: timestamptz, not null.
- updated_at: timestamptz, not null.

Regler:
- project_assignment kobler tenant_user til project_core.
- unique (project_id, tenant_user_id).
- tenant_id i project_assignment skal matche project_core.tenant_id.
- tenant_id i project_assignment skal matche tenant_user.tenant_id.
- project_assignment er grundlag for mine-scope og team-scope.

---

## 10. SCOPE MODEL

Scopes:
- mine
- team
- tenant

Definitioner:
- mine: data knyttet til requester via project_assignment.tenant_user_id = requester_user_id.
- team: data knyttet til projekter hvor mindst en assignment ligger hos bruger i requesterens teams.
- tenant: alle data i requesterens tenant.

DB-filtrering:
- mine:
   where resource.tenant_id = :tenant_id
   and exists (
      select 1 from project_assignment pa
      where pa.project_id = resource.project_id
         and pa.tenant_user_id = :requester_user_id
         and pa.tenant_id = :tenant_id
   )
- team:
   where resource.tenant_id = :tenant_id
   and exists (
      select 1
      from project_assignment pa
      join team_membership tm_assignee on tm_assignee.tenant_user_id = pa.tenant_user_id and tm_assignee.tenant_id = :tenant_id
      join team_membership tm_requester on tm_requester.team_id = tm_assignee.team_id and tm_requester.tenant_user_id = :requester_user_id and tm_requester.tenant_id = :tenant_id
      where pa.project_id = resource.project_id
         and pa.tenant_id = :tenant_id
   )
- tenant:
   where resource.tenant_id = :tenant_id

API-enforcement:
- scope kommer fra whitelist query parameter.
- role bestemmer hvilke scopes der maa bruges:
   - technician: mine
   - project_leader: mine, team
   - tenant_admin: mine, team, tenant
   - global_admin: ingen tenant-data scope i fase 1
- ugyldig scope eller scope uden rettighed giver hard deny.

Ufravigeligt krav:
- ingen in-memory fallback.
- alle scope-resultater hentes og filtreres i DB.

---

## 11. AUTH MODEL

Tokenstandard:
- JWT standard.
- signeret med secret.
- claims inkluderer tenant_id og role.

Obligatoriske claims:
- sub: user id.
- actor_scope: global eller tenant.
- tenant_id: uuid eller null for global scope.
- role: global_admin | tenant_admin | project_leader | technician.
- iat.
- exp.

Flow:
1. login endpoint modtager credentials.
2. backend finder bruger i korrekt scope.
3. backend validerer password_hash.
4. backend udsteder JWT med faste claims.
5. verify middleware validerer signatur, expiry og claim-konsistens.
6. tenant resolve sker via token tenant_id plus verificeret domain mapping.
7. user resolve sker via token sub i tenant_user.
8. mismatch mellem token, domain og user giver hard deny.

Forbud:
- ingen custom tokenformat.
- ingen default secret.
- ingen plaintext password compare.
- ingen implicit tenant afledning.

---

## 12. TENANT CONFIG MODEL

Tabelnavn: tenant_config

Felter:
- tenant_id: uuid, primary key, foreign key til tenant.id.
- ek_base_url: text, not null.
- ek_api_key_encrypted: text, not null.
- last_tested_at: timestamptz, nullable.
- status: enum not_configured | configured | test_ok | test_failed.
- updated_at: timestamptz, not null.

Regler:
- ek_api_key lagres kun krypteret.
- secrets returneres aldrig i API responses.
- status opdateres kun af backend test-flow.
- config kan kun skrives af tenant_admin.

---

## 13. TENANT CONFIG SNAPSHOT MODEL

Tabelnavn: tenant_config_snapshot

Felter:
- id: uuid, primary key.
- seq: bigserial, not null.
- tenant_id: uuid, not null, foreign key til tenant.id.
- changed_at: timestamptz, not null.
- changed_by_actor_id: text, not null.
- changed_by_actor_scope: enum global | tenant | system, not null.
- config_snapshot: jsonb, not null.
- reason: text, not null.

Regler:
- historik af konfigurationsaendringer gemmes append-only.
- snapshot refererer altid tenant_id.
- changed_at registrerer entydigt aendringstidspunkt.
- changed_by_actor_id registrerer hvem der aendrede.
- snapshot-raekkefoelge er entydig via seq, uafhaengigt af timestamptz-precision.
- config_snapshot maa ikke indeholde secrets i klartekst.
- krypterede vaerdier maa lagres som masked eller encrypted metadata.

---

## 14. AUDIT MODEL

Tabelnavn: audit_event

Felter:
- id: uuid, primary key.
- occurred_at: timestamptz, not null.
- actor_id: text, not null.
- actor_scope: enum global | tenant | system, not null.
- tenant_id: uuid, nullable.
- event_type: text, not null.
- target_type: text, not null.
- target_id: text, nullable.
- outcome: enum success | fail | deny, not null.
- reason: text, nullable.
- metadata: jsonb, not null.

Event-typer der skal logges:
- invitation_created
- invitation_accepted
- invitation_revoked
- login_success
- login_fail
- tenant_status_changed
- tenant_config_changed
- role_changed
- sync_success
- sync_fail
- support_access_requested
- support_access_denied
- support_access_granted

Regler:
- audit_event er append-only.
- audit_event maa ikke indeholde secrets i klartekst.
- alle kritiske flows skal skrive audit_event i samme request-kontekst.
- fail og deny skal logges paa linje med success.

---

## 15. SYNC MODEL

Tabelnavn: sync_job

Felter:
- id: uuid, primary key.
- tenant_id: uuid, not null, foreign key til tenant.id.
- type: enum bootstrap | delta.
- status: enum queued | running | success | failed.
- last_run: timestamptz, nullable.
- error: text, nullable.
- rows_processed: bigint, not null.
- pages_processed: integer, not null.
- created_at: timestamptz, not null.
- updated_at: timestamptz, not null.

Regler:
- sync koeres pr tenant.
- bootstrap skal vaere success foer delta aktiveres.
- failed jobs bevarer fejltekst og kan resumere.
- alle sync writes er idempotente og tenant-scopede.

---

## 16. SUPPORT SESSION BESLUTNING

Beslutning: A.

support_session er ikke med i V3 fase 1.

Konsekvens i fase 1:
- ingen support_session tabel.
- ingen support_session API.
- ingen midlertidig tenant elevation for global_admin.
- global_admin kan ikke tilgaa tenant-data via support-flow.

Audit-krav i fase 1:
- hvis support access forsoges, logges det som deny i audit_event.

---

## 17. TENANT RESOLUTION (CRITICAL)

Tenant resolution sker foer alle tenant-routes inklusive login paa subdomain.

Flow:
1. laes hostname.
2. identificer root kontra subdomain.
3. hvis root: vis central invitation entry og stop tenant-lookup.
4. hvis subdomain: extract slug og slaa op tenant via slug.

Resultat:
- slug ikke fundet: HTTP 404.
- slug fundet og tenant.status = suspended: HTTP 410.
- slug fundet og tenant.status = deleted: HTTP 410.
- slug fundet og tenant.status = active: tenant context attach'es til request.
- slug fundet og tenant.status = invited eller onboarding: tenant context attach'es; adgang begraenses via lifecycle mapping nedenfor.

Lifecycle mapping for adgang:
- invited: kun invitation/accept flow. Ingen adgang til login eller app-routes.
- onboarding: kun onboarding flow. Ingen adgang til login eller app-routes.
- active: normal tenant adgang.
- suspended: ingen tenant app-adgang.
- deleted: ingen tenant app-adgang.

Garanti: ingen tenant-bruger kan naa login eller app-routes foer tenant.status = active.

---

## 18. DATA FLOW (VIGTIG)

Entydigt flow:
1. EK leverer data via tenant-specifik forbindelse.
2. sync proces henter pages og validerer payload pr tenant.
3. backend persisterer i DB via idempotent upsert til tenantens data.
4. scope filter koeres i DB ved query-tid via project_assignment og team_membership.
5. API returnerer kun scope-godkendte data.
6. frontend renderer kun API-resultat.

Kontrolpunkter:
- tenant_id valideres i alle lag.
- RBAC evalueres foer scope query.
- scope evalueres foer data serialization.
- alle deny udfald er fail-closed.

---

## Ufravigelige designregler for build

- Ingen hardcoded tenants, credentials eller fallback identiteter.
- Ingen implicit adgang, ingen implicit tenant, ingen default allow.
- Backend er eneste source of truth for auth, RBAC, scope og entitlements.
- DB schema godkendes foer API implementation.
- API implementation godkendes foer UI implementation.
- V2 bruges kun som reference, aldrig som kodegrundlag.
