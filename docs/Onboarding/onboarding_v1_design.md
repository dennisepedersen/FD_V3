VERSION: v1
DATE: 2026-03-29
OWNER: Dennis

STATUS: DESIGN (NOT IMPLEMENTED / NOT VERIFIED)

Onboarding V1 – UI flow
Step 0 – Invitation oprettet af global admin

Global admin opretter invitation fra root-admin.

Felter:

company_name
desired_slug
admin_name
admin_email
invitation_note (valgfri)
expiry_date
evt. prefill af EK-step = ja/nej

Systemet gør:

validerer slug-format
validerer at slug ikke er optaget
opretter invitation med token
sætter status = pending
sender/intern viser onboarding-link

Output:

onboarding URL
invitation status
expiry
Step 1 – Basic info

Brugeren åbner invitation på root host.

Vis:

virksomhedsnavn
slug
admin-navn
admin-email

Redigerbart eller låst:

company_name: normalt låst hvis global admin har sat det
slug: helst låst i V1 når invitation er sendt
admin_name: redigerbar
admin_email: redigerbar hvis ønsket

Ekstra felter:

password
confirm_password

Validering:

token gyldigt
invitation ikke udløbet
status stadig pending
password regler opfyldt
Step 2 – Vilkår

Brugeren ser vilkår og accepterer.

Vis:

terms title
terms version
terms text eller reference

Felter:

checkbox: “Jeg accepterer vilkårene”

Systemet gemmer senere:

terms_version
accepted_at
accepted_by_email eller user_id
evt. terms_snapshot/reference
Step 3 – EK integration

Brugeren angiver EK-oplysninger.

Felter:

ek_base_url
ek_api_key
evt. ek_site_name hvis jeres integration kræver det

Knap:

Test connection

Validering:

felter ikke tomme hvis EK er påkrævet
connection test skal kunne køres
fejl skal vises menneskeligt

Status:

not_tested
success
failed

I V1 kan step godt gemmes uden succes, hvis I vil tillade “spring over”.
Mit forslag:

tillad “skip for now” kun hvis global admin har valgt det ved invitation
Step 4 – Endpoint-valg

Brugeren vælger hvilke EK endpoints der skal aktiveres.

Default valgt:

projects
fitterhours
users

Valgfrie:

fittercategories
andre senere

Hver række skal vise:

endpoint-navn
kort forklaring
bruges til hvad
kritisk/valgfri

Eksempel:

projects – henter sagsgrunddata, struktur og budgetbase
fitterhours – henter timeregistreringer og aktivitet
users – henter brugere til mapping og ansvarlige
fittercategories – supplerende kategoridata til timer/roller
Step 5 – Review

Vis samlet oversigt før oprettelse:

company_name
slug
domain = <slug>.fielddesk.dk
admin_email
vilkår version
EK connection status
valgte endpoints

Knap:

Opret tenant
Step 6 – Success

Vis:

tenant oprettet
domain oprettet
admin oprettet
onboarding completed

Redirect:

til https://<slug>.fielddesk.dk/login

Ingen auto-login i V1.

API endpoints pr. step
Root admin
POST /v1/root/invitations

Opret invitation.

Input:

company_name
desired_slug
admin_name
admin_email
expires_at
allow_skip_ek

Output:

invitation_id
onboarding_token
onboarding_url
status
Onboarding state
GET /v1/onboarding/state?token=...

Returnerer invitation + step-status.

Output:

invitation status
slug
company_name
admin_email
current_step
allow_skip_ek
terms_version
Save basic info
POST /v1/onboarding/basic

Input:

token
admin_name
admin_email
password
confirm_password

Output:

ok
next_step
Accept terms
POST /v1/onboarding/terms

Input:

token
terms_version
accepted = true

Output:

ok
next_step
Test EK connection
POST /v1/onboarding/ek/test

Input:

token
ek_base_url
ek_api_key
ek_site_name (hvis relevant)

Output:

success
message
normalized_base_url hvis relevant
Save EK settings
POST /v1/onboarding/ek

Input:

token
ek_base_url
ek_api_key
ek_site_name
skipped

Output:

ok
next_step
Save endpoint selection
POST /v1/onboarding/endpoints

Input:

token
endpoints: [projects, fitterhours, users]

Output:

ok
next_step
Complete onboarding
POST /v1/onboarding/complete

Input:

token

Server-side krav før success:

invitation gyldig
basic info ok
terms accepteret
EK step completed eller eksplicit skipped
endpoints valgt
slug stadig ledig
domain stadig ledigt

Output:

success
tenant_id
tenant_slug
tenant_domain
redirect_url
DB writes pr. step
Ved invitation

Tabeller:

onboarding_invitation
evt. audit_event

Skriv:

invitation token hash eller token reference
company_name
desired_slug
admin_email
status = pending
expires_at
created_by = global_admin
Ved basic info

Enten:

gem midlertidigt i onboarding_session_data
eller
opdatér invitation-record med draft data

Gem:

admin_name
admin_email
password_hash
basic_completed_at

Password hash skal gemmes midlertidigt sikkert eller først hashes ved complete.
Mit forslag: hash ved save basic.

Ved terms

Gem:

accepted = true
terms_version
accepted_at

Enten i:

onboarding_terms_acceptance
eller som felter på invitation/session
Ved EK

Gem:

ek_base_url
ek_api_key_encrypted
ek_site_name
connection_test_status
tested_at
skipped
Ved endpoint-valg

Gem:

selected_endpoints som relation eller JSON

Mit forslag:

relationstabel er renest senere
men JSON er hurtigere i V1
Ved complete

Opret endeligt:

tenant
slug
name
status = active
tenant_domain
tenant_id
domain
verified = true
active = true
tenant_user
tenant_id
email
name
role = tenant_admin
status = active
password_hash
tenant_terms_acceptance
tenant_id
user_email eller user_id
terms_version
accepted_at
tenant_integration_credentials
tenant_id
provider = ek
api_key_encrypted
base_url
site_name
tenant_enabled_endpoints
tenant_id
endpoint_name
enabled = true
audit_event
invitation_created
onboarding_started
onboarding_completed

Til sidst:

invitation status = completed

Hele complete-step bør køre i én transaction.

Done-kriterier for V1

Flowet er færdigt når:

global admin kan oprette invitation
invitation kan åbnes kun på root host
basic info kan gemmes
vilkår accepteres og versionslogges
EK credentials kan testes og gemmes
endpoints kan vælges
complete opretter tenant/domain/admin korrekt
bruger kan logge ind på tenant-domain efter completion
invitation kan ikke genbruges efter completion
Testplan bagefter

Når VS Code har bygget flowet, tester vi i denne rækkefølge:

Teknisk test uden rigtig EK
invitation oprettes
onboarding state loader
basic info virker
terms virker
EK step kan vises
complete blokerer korrekt hvis EK kræves
eller skip virker korrekt hvis skip er tilladt
Fuldt testforløb med HC senere

Når HC-tenant skal oprettes:

rigtig admin = dig
rigtige EK credentials
rigtig connection test
endpoint-valg
complete
login på HC-domain
senere sync-test


NEXT STEP:
Implement via VS Code → validate → create implementation doc