# PR4 - Fravaersnotifikationer og email outbox

Status: PR4 released; PR5 manager decision extensions implemented locally.

## Scope

PR4 etablerer et fundament for interne notifikationer, mailtemplates og transactional email outbox for medarbejderens fravaersanmodninger.

Implemented:

- `internal_notification` til tenant-scopede interne notifikationer.
- `email_template` med systemtemplates og fremtidig tenant override.
- `email_outbox` med `queued`, `processing`, `sent`, `retry` og `dead_letter`.
- Systemtemplates for submit og cancel i `da-DK`.
- PR5 adds systemtemplates for manager approve/reject employee mails in `da-DK`.
- Template rendering med eksplicit variable allowlist og HTML escaping.
- Atomisk enqueue ved `absence_request.submitted` og `absence_request.cancelled`.
- PR5 adds atomic employee notification/outbox enqueue for `absence_request.approved` and `absence_request.rejected`.
- Whitelisted, manuelt aktiveret maintenance job `email-outbox-process`.

Not implemented in PR4:

- Leader approval, reject, change proposal or review UI.
- In-app notification API/UI.
- Template admin UI.
- Calendar feed, `resource_absences`, EK sync or worksheet sync changes.
- Production mail test or automatic mail sending.
- Render environment or service configuration changes.

## Transaction Boundary

Submit and cancel still run in the existing absence request transaction. PR4 adds only database writes inside that transaction:

- absence request update
- absence event
- audit event
- internal notification rows
- email outbox rows

If notification or outbox enqueue fails, the whole submit/cancel transaction rolls back. No mail provider is called from the request transaction. Mail provider calls are isolated to the maintenance processor.

## Recipient Rules

Recipients are resolved server-side from tenant-owned `tenant_user` rows.

- Active tenant users with active login can receive internal notifications.
- Inactive users or users with inactive login are not materialized to `internal_notification` or `email_outbox`.
- Active users with a valid email get a queued outbox row.
- Active users with missing email get an outbox row created directly as `dead_letter` with `recipient_email_missing`.
- Active users with invalid email get an outbox row created directly as `dead_letter` with `recipient_email_invalid`.
- Missing or invalid email does not fail submit/cancel.
- `employee_comment` is not included in notification payloads, outbox payloads, rendered mail content, processor logs, or audit metadata.

## Templates

Template rendering supports only `{{variable}}` placeholders. Unknown placeholders, missing required variables, property traversal, template logic, and arbitrary code are rejected by shape or allowlist.

Tenant-specific active templates may override copy later, but their `allowed_variables_json` must be a subset of the active systemtemplate allowlist for the same `template_key` and locale. A tenant override cannot add new variables beyond the systemtemplate contract.

The PR4 seed uses systemtemplates only and is protected with `ON CONFLICT DO NOTHING` to avoid duplicate seed rows if the seed statement is re-run in a rebuild/test context.

## Tenant URL

Action URLs are built server-side:

- Prefer active verified `tenant_domain.domain`.
- Fall back to `https://{tenant.slug}.fielddesk.dk/login#absence-request-{id}`.

Until PR5 adds absence UI, the temporary destination is the existing tenant `/login` page with a hash. The hash avoids backend 404s and does not contain tokens or private data.

## Processor

The maintenance dispatcher exposes:

```bash
node scripts/fd_maintenance_job.js --job email-outbox-process --mode status-only --tenant hoyrup-clemmensen
node scripts/fd_maintenance_job.js --job email-outbox-process --mode dry-run --tenant hoyrup-clemmensen --limit 25
node scripts/fd_maintenance_job.js --job email-outbox-process --mode apply --tenant hoyrup-clemmensen --limit 25 --confirm APPLY:email-outbox-process:hoyrup-clemmensen
```

`status-only` reads queue counts only. `dry-run` reads due rows only and does not mutate queue status or send mail. `apply` must be explicitly invoked with the confirmation string; it claims due rows with `FOR UPDATE SKIP LOCKED`, sends one email per claimed row, then marks the row as sent, retry or dead-letter.

Backoff is exponential by attempts: 1, 2, 4, 8, 16, 32, then capped at 60 minutes. Permanent 4xx provider failures except 429 dead-letter. 429, timeout and 5xx-class failures retry until `max_attempts`; exhausted attempts dead-letter. Stuck `processing` rows can be recovered after the processor timeout predicate.

The processor is not started by the webprocess, not scheduled, and not activated by deploy. Deploying PR4 can create queued rows when submit/cancel is used, but no real mail is sent unless the maintenance `apply` command is run separately.

## PR5 Recommendation

Recommended next PR:

- Manager pending list.
- Manager request detail.
- Approve.
- Reject.
- Audit.
- Notification/outbox side effects for approval outcomes.
- No calendar materialization.
- No notification UI in the same PR.
## PR5 Manager Decision Notifications

PR5 reuses the PR4 notification/outbox foundation for manager decisions. Approve and reject create employee-facing internal notifications and email outbox rows inside the same absence-request transaction as the status update, request event, and audit event.

Template keys:

- `absence_request.approved.employee`
- `absence_request.rejected.employee`

Allowed variables are limited to `employee_name`, `manager_name`, `absence_type`, `start_date`, `end_date`, `start_time`, `end_time`, `action_url`, `tenant_name`, and, for rejection only, `decision_reason`. Tenant overrides still cannot expand the systemtemplate allowlist.

Rejection reason policy:

- The full reason is stored in `absence_request_event.reason`.
- The full reason is allowed in the employee rejection email body because it is the intended message content.
- The full reason is not copied to internal notification body, notification payload, outbox payload, audit metadata, route logs, or processor logs.

Approval message policy:

- An optional manager approval message is stored in `absence_request_event.reason` for the approved event and shown in employee/assigned-manager request history.
- It is not copied to audit metadata, calendar events, internal notification payload/body, email outbox payload, rendered mail templates, route logs, or processor logs in this slice.
- Adding the approval message to employee email later requires an explicit email-template allowlist/template migration.

PR5 still does not activate automatic outbox `apply`, send production mail, create notification UI, or materialize calendar/resource absence rows.

## PR7 Special-Window Submit Templates

PR7 reuses the PR4 outbox foundation for special vacation window submit receipts. It adds system template keys:

- `absence_request.submitted_special_window.employee`
- `absence_request.submitted_special_window.manager`

Allowed variables are limited to `employee_name`, `manager_name`, `absence_period`, `special_window_name`, `submission_deadline`, `review_start_date`, `receipt_text`, `action_url`, and `tenant_name`.

The special-window submit notification confirms receipt for collective review. It must not imply approval, priority, first-come-first-served handling, or a final calendar absence. Employee comments remain excluded from internal notification payloads, outbox payloads, rendered special-window submit templates, audit metadata, and processor logs.

PR7 still does not activate outbox `apply`, send real mail, create notification UI, or make Render/service configuration changes.

## Tenant-admin ekstra CC/BCC til driftsmails

Status 23. oktober 2026: implementeret i lokal kode; dette tillæg er en
kontraktbeskrivelse, ikke bevis for validering, produktionsudrulning eller gemte
modtagere. Ovenstående PR4/PR5/PR7-status og fraværsflows bevarer deres betydning.
Dette afsnit er den kanoniske kontrakt for den afgrænsede ekstra routing.

`verified` ved læsning af
[`operationalMailRouting.js`](../../../backend/src/modules/notifications/operationalMailRouting.js),
[policy](../../../backend/src/modules/notifications/operationalMailRouting.policy.js),
[routes](../../../backend/src/modules/notifications/operationalMailRouting.routes.js)
og integrationerne i Timekontrol, Godkendelseskontrol og `mailService`:

| Indstillingsnøgle | Omfattede automatiske mails |
| --- | --- |
| `time_control_missing_hours` | Individuel Timekontrol: både `time_control.missing_hours.employee` og `time_control.employee_weekly_reminder_v1` |
| `time_control_friday_status` | Kun ugens lederoversigt `time_control.friday_weekly_summary_v1` |
| `approval_control_summary` | Godkendelseskontrols planlagte oversigtsmail via `approvalControl.mailJob`; fortsat slukket |

Timekontrols monitor/driftsstatus, watchdog, diagnostik og
`time_control.internal_error` er alle udenfor. Fredagsstatus betyder her kun
lederoversigten, aldrig monitorens statusmail, heller ikke om fredagen.
Manuelle previews, POC/testmails, fraværsnotifikationer og øvrige mailflows
får ingen ekstra modtagere gennem denne kontrakt.

### Indstillinger og API

Migration [`0065_operational_mail_routing.sql`](../../../migrations/0065_operational_mail_routing.sql)
tilføjer `tenant_operational_mail_routing`, entydig på `(tenant_id, mail_type)`.
Ingen tenant eller adresse seedes, og eksisterende indstillinger/køposter ændres
ikke. Uden gemt række returneres revision `0`, begge kanaler slukket og tomme
lister. Første faktiske gemte ændring får revision `1`.

- `GET /api/tenant/admin/operational-mail-routing` returnerer
  `{success:true,mail_types:[setting,...]}` med de tre kendte typer.
- `PUT /api/tenant/admin/operational-mail-routing/:mailType` accepterer præcis
  `revision` som ikke-negativt heltal, `extra_cc_enabled` og `extra_bcc_enabled`
  som booleans samt `extra_cc_emails` og `extra_bcc_emails` som
  **semikolonseparerede strenge**. Ingen tenant-, rolle- eller scopeparametre;
  queryparametre og ukendte felter/typer afvises.
- PUT returnerer `{success:true,setting:...}`. Et `setting` har `mail_type`,
  `title`, `revision`, de to enabled-felter, de to mailfelter som
  **normaliserede arrays** samt `updated_at`.
- Serveren trimmer og normaliserer adresser til små bogstaver, validerer
  højst 20 adresser pr. kanal og kræver mindst én adresse for en tilvalgt kanal.
  Ugyldige adresser og dubletter afvises. Aktive ekstra CC/BCC må ikke
  overlappe; ved sammensætning af mailen kontrolleres også overlap med dens
  eksisterende Til/CC. Eksisterende primær modtager og basis-CC erstattes ikke.
  Slukkede kanalers gyldige adresser kan bevares uden at være effektive.
- Begge routes er `no-store` og kræver tenant-host, adgangstoken med samme
  tenant, `tenant_admin` samt modulets read/update-adgang. Tenant og aktør
  afledes server-side og genvalideres mod aktiv tenant/bruger/login.
- Faktiske ændringer gemmes sammen med `tenant_config_changed`-audit i samme
  transaktion med aktør, tenant, mailtype og **before/after**. Uændret input
  bevarer revisionen. Forkert revision giver HTTP 409
  `operational_mail_routing_conflict`; klienten skal genindlæse før nyt gem.
  Inputfejl omfatter `operational_mail_recipients_invalid`,
  `operational_mail_recipients_required`, `operational_mail_recipients_duplicate`
  og `operational_mail_routing_input_invalid`.

Tenant-admin-panelet på Timekontrol viser de to Timekontroltyper; panelet på
Godkendelseskontrol viser den tredje. Browseren bruger Bearer-token fra
`fielddesk_access_token`, henter kun ved sidevisning og gemmer kun ved eksplicit
submit. Toggles deaktiverer tekstfelterne uden at rydde værdierne; gemt resultat
viser serverens normaliserede effektive ekstra modtagere pr. kanal. HTTP 401/403
skjuler og rydder hele panelet. Ukendte typer ignoreres i UI. Panelet er adskilt
fra normale mailpreviews og har ingen aktiverings- eller afsendelsesknapper.

### Privat BCC og låsning før afsendelse

BCC er et transportfelt til mailudbyderen, ikke tekst i emne, mailbody eller
normale previews/statussvar. Adresserne vises kun i det afskærmede
tenant-admin-indstillingspanel og dets API; de nødvendige serverinterne
outbox-/jobdata og before/after-audit er også private. Rå providerfejl eller
logs må ikke afsløre BCC. `mailService` understøtter transportfeltet for
Resend og Postmark og undertrykker rå providerfejl ved BCC.

Nye omfattede Timekontrol-køposter gemmer de konkrete modtagere samt
`mail_routing` med mailtype/revision; Godkendelseskontrol binder sit job til
samme snapshot i sit eksisterende audit-/jobspor, ikke i den fælles outbox.
Før provideradgang genvalideres revision og alle Til/CC/BCC mod den aktuelle
tenantindstilling. Save bruger eksklusiv og afsendelse delt transaktionslås
pr. tenant/mailtype i advisory namespace 6124; afsendelseslåsen holdes gennem
providerkaldet. Ændret revision eller modtagermismatch blokerer afsendelsen
fail-closed, også hvis en ny snapshotbærende post senere møder samme adresser
under en anden revision.

Legacykøposter uden snapshot får aldrig ekstra adresser eftermonteret. De kan
kun passere, når den effektive routing stadig svarer til deres oprindelige
Til/CC uden ekstra BCC; aktivering/ændring, som kræver andre effektive
modtagere, blokerer dem før provideradgang. Ingen køpost omskrives, replayes
eller genafsendes for at få en ny kopi. Eksisterende regler for idempotens,
driftsbeviser, tidsvinduer og højst ét Timekontrol-/Godkendelseskontrol-forsøg
gælder fortsat. Et allerede påbegyndt providerkald kan ikke trækkes tilbage.

### HC-ønske og fremtidig ibrugtagning

Brugerønsket er JEL som ekstra **BCC** på de to Timekontrolfamilier ovenfor
og ekstra **CC** på Godkendelseskontrol. Det er **ikke gemt**, ikke seedet og
har ikke ændret produktionsmodtagere. Der fastsættes ingen adresse ved default.

Præcis ønsket opsætning for HC (`hoyrup-clemmensen`), **IKKE GEMT**:

| `mail_type` | `extra_cc_enabled` | `extra_cc_emails` (PUT-streng) | `extra_bcc_enabled` | `extra_bcc_emails` (PUT-streng) |
| --- | --- | --- | --- | --- |
| `time_control_missing_hours` | `false` | `""` | `true` | `"jel@hoyrup-clemmensen.dk"` |
| `time_control_friday_status` | `false` | `""` | `true` | `"jel@hoyrup-clemmensen.dk"` |
| `approval_control_summary` | `true` | `"jel@hoyrup-clemmensen.dk"` | `false` | `""` |

Tabellen er alene dokumentation af ønsket til et senere eksplicit admin-gem
med den da aktuelle revision. Adressen må stå her, men må ikke hardcodes i
source eller seedes via migration; default forbliver slukket med tomme lister.

Efter særskilt eksplicit godkendelse af den konkrete produktionsændring kræves
anvendelse af migration 0065 og webudrulning med routingkode/API/UI samt et
eksplicit tenant-admin-gem af de konkrete adresser/kanaler **før nye køposter
eller jobmeddelelser dannes**. Udrulning alene aktiverer ingen ekstra modtagere;
der udføres ingen gammel replay, catch-up eller testafsendelse som led heri.
Timekontrols eksisterende monitor-cron og diagnostik er udenfor denne ændring.
Godkendelseskontrol forbliver disabled uden startdato/aktiv periode;
modtagerindstillinger udgør ingen scheduler-/mailaktivering og erstatter ikke
dens særskilte fase 2-godkendelser. Produktionsverifikation tilføjes først
efter faktisk, særskilt godkendt udrulning.

### Lokal verifikation 23. oktober 2026

`verified`, kun lokalt og med simuleret transport:

- `npm run check`: 705 beståede tests, 0 fejl, 14 opt-in skips samt grønne
  syntaks-, whitespace-, encoding-, secrets-, migrations- og static-checks.
- De fem isolerede PostgreSQL-filer for routing, Godkendelseskontrols
  preview/mail/aktivering og Timekontrols automatiske outbox: 40 bestået,
  0 fejl, 0 skips. Ny lokal testdatabase, faktisk migration 0065, ingen
  ekstern transport; testclusteren stoppet bagefter.
- Fokuseret routing/mail/dispatch-regression: 88 bestået, inklusive 20 ekstra
  CC oven i normal CC, private Resend/Postmark-payloads og fortsat slukket
  Godkendelseskontrol. Uafhængigt review har ingen resterende konkrete fund.
- Playwright på de faktiske statiske sider med isolerede, simulerede API-svar:
  desktop 1365 px, mobil 390/320 px, gem/normalisering, toggles, validering,
  revisionskonflikt og skjult/ryddet panel ved 403. Ingen preview-kørsel,
  mail-, EK- eller produktionskald. Screenshots er visuelt kontrolleret.
- Nye, endnu ikke trackede filer er særskilt kontrolleret for syntaks,
  encoding og secrets; dette er ikke en commit eller staging-handling.

Ingen rigtig mail eller inbox-levering er verificeret i denne opgave.
HC's produktionsindstillinger, Timekontrols aktive drift og
Godkendelseskontrols slukkede tilstand er ikke ændret. Ingen commit, push,
deploy eller produktionsmigration er udført.
