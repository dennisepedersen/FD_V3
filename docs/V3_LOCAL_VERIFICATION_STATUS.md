# FIELDESK V3 – LOCAL VERIFICATION STATUS

## OVERBLIK

Dato: (indsæt dato)
Milestone: Backend Phase-1 Auth + Onboarding VERIFIED

---

## INFRA

- Backend: localhost:3000
- Root domain: fielddesk.local
- Tenant domain: test.fielddesk.local

- Docker Postgres:
  - container: fielddesk-postgres
  - host port: 55432
  - db: fielddesk_v3

- DATABASE_URL:
  postgresql://postgres:postgres@127.0.0.1:55432/fielddesk_v3

---

## DATABASE

- migrations/0001_init.sql anvendt
- følgende tabeller verificeret:
  - tenant
  - tenant_domain
  - tenant_invitation
  - tenant_user
  - øvrige fase-1 tabeller

---

## AUTH FLOW (VERIFIED)

### 1. Invitation (seeded)

- tenant_invitation oprettet manuelt
- token_hash = sha256(token)

---

### 2. Invitation Accept

POST /v1/invitations/accept

Resultat:
- tenant oprettet
- tenant_admin oprettet
- onboarding_token returneret

---

### 3. Onboarding State

GET /v1/onboarding/state

Resultat:
- tenant_status = onboarding
- domain korrekt registreret

---

### 4. Onboarding Complete

POST /v1/onboarding/complete

Resultat:
- tenant aktiveret
- tenant_login_url returneret

---

### 5. Tenant Login

POST /v1/auth/login

Host:
test.fielddesk.local

Resultat:
- access_token (Bearer) returneret
- korrekt tenant_scope

---

## VERIFICEREDE PRINCIPPER

- Tenant isolation virker
- Root vs tenant routing virker
- JWT typer virker:
  - onboarding
  - access
- Backend er single source of truth
- Ingen implicit tenant

---

## KENDTE WORKAROUNDS

- Port 5432 konflikt med lokal Postgres
  → løst ved 55432

- Ingen invitation create endpoint
  → seed via DB

- PowerShell JSON issues
  → løst via ConvertTo-Json

---

## NÆSTE STEP (IKKE UDFØRT)

- Test beskyttede endpoints med access_token
- Test negative cases (no token / wrong tenant)
- Render deploy

---

## STATUS

READY FOR NEXT PHASE