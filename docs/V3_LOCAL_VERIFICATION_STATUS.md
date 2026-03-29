# FIELDESK V3 – VERIFICATION STATUS

## OVERBLIK

Dato: 2026-03-29  
Milestone: Backend Phase-1 Auth + Onboarding + Render Deploy VERIFIED

---

## INFRA (LOCAL)

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

## INFRA (PRODUCTION – RENDER)

- Hosting: Render Web Service
- Node: 20.x (pinned)
- Database: Render Postgres (internal URL)
- Deploy: GitHub repo (FD_V3)

- Backend status:
  ✔ Service running
  ✔ Connected to DB
  ✔ No native module errors (bcrypt fixed)
  ✔ Health endpoint public

---

## DATABASE

- migrations/0001_init.sql anvendt lokalt og i Render
- schema verified i begge miljøer

---

## AUTH FLOW (LOCAL – VERIFIED)

### 1. Invitation (seeded)
- tenant_invitation oprettet manuelt
- token_hash = sha256(token)

### 2. Invitation Accept
POST /v1/invitations/accept

Resultat:
- tenant oprettet
- tenant_admin oprettet
- onboarding_token returneret

### 3. Onboarding State
GET /v1/onboarding/state

Resultat:
- tenant_status = onboarding
- domain korrekt registreret

### 4. Onboarding Complete
POST /v1/onboarding/complete

Resultat:
- tenant aktiveret
- tenant_login_url returneret

### 5. Tenant Login
POST /v1/auth/login

Host:
test.fielddesk.local

Resultat:
- access_token (Bearer) returneret
- korrekt tenant_scope

---

## RENDER DEPLOY (VERIFIED)

### Fixes udført:

- ❌ node_modules committed → fjernet
- ❌ bcrypt invalid ELF → løst (clean install + cache clear)
- ❌ Node 25 → pinned til Node 20
- ❌ manglende env (ROOT_DOMAIN) → tilføjet
- ❌ health bag host-gating → flyttet før tenantResolution
- ❌ health ikke mounted korrekt → fixed i app.js
- ❌ Render cache → cleared

---

## HEALTH CHECK (PRODUCTION)

GET /health  
GET /api/health  

Resultat:
✔ 200 OK  
✔ { "ok": true }

---

## VERIFICEREDE PRINCIPPER

- Tenant isolation virker
- Root vs tenant routing virker (lokalt)
- JWT typer virker:
  - onboarding
  - access
- Backend er single source of truth
- Ingen implicit tenant
- Render deploy pipeline fungerer
- Repo → deploy flow verified

---

## KENDTE WORKAROUNDS

- Port 5432 konflikt → brug 55432
- Ingen invitation endpoint → seed via DB
- PowerShell JSON → ConvertTo-Json
- Render cache issues → “Clear build cache” nødvendigt

---

## NUVÆRENDE STATUS

BACKEND FOUNDATION VERIFIED (LOCAL + PRODUCTION)

---

## NÆSTE STEP

- Verificér tenant routing i production
- Verificér auth flow i production
- Test negative cases (auth / tenant mismatch)
- Først derefter:
  - custom domains
  - frontend integration