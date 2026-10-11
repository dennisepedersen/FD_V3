# Tenant Admin Fitters and Resource Groups

Status: implemented first slice
Date: 2026-07-10

## Verified EK Inputs

- `GET /api/v4/fitters` is the verified fitter master endpoint in this repo.
- Existing docs verify a full-list `data: FitterResponseDTO[]` response and persisted fields such as `id`, `employeeNumber`, `name`, `email`, `phone`, `startDate`, `endDate`, `userID`, `jobPosition`, `salaryID`, and `isPlannable`.
- `GET /api/v3.0/users` is observed/read-only in the current sync worker and is not materialized into tenant admin users yet.
- `GET /api/v4.0/roles` is not verified or materialized in this repo state.

## Defensive EK Fields

The tenant admin fitter import now recognizes these optional group fields if EK returns them:

- `resourceGroupID` / `ResourceGroupID`
- `resourceGroupName` / `ResourceGroupName`
- `resourceGroups` / `ResourceGroups`

These fields were not part of the previously verified fitter contract, so they are treated as optional adapter inputs. If they are absent, fitters still import normally and no resource-group membership is inferred.

## Resource Group Mapping

Current code inspection: `upsertResourceGroupsFromFitterBatch` exists, but the
worker's fitter persistence paths do not call it. Fitter sync therefore does not
currently import groups or membership, even when optional group inputs exist.
The following is the helper's behavior, not a verified end-to-end import:

- It upserts `resource_groups` by `(tenant_id, external_source, external_id)` with `external_source = ekomplet`.
- It upserts `resource_group_members` by `(tenant_id, group_id, fitter_id)`.
- Missing EK fitters are not deleted by later syncs.
- Manual Fielddesk groups and users continue to exist independently of EK.

Before wiring this helper, verify an authoritative group-ID source. It does not
adopt manual groups by name. Reusing an existing manual group requires explicit
approval of its tenant/group UUID and external identity, a uniqueness check, and
an audited change preserving the UUID; otherwise import can create a duplicate.
Name parsing or email prefixes do not establish authoritative membership.

### Group Identity and Membership Evidence (Source Qualifications Apply)

verified by local OpenAPI inspection: Planning's
`ExternalFitterResponseDTO` has `fitterID` and `resourceGroups[]` containing
group `id` and `name`, explicitly described as the fitter's groups. The current
OpenAPI also references that DTO through CalendarEvents:
`GET /api/v4/calendarevents/{id}` returns an
`ExternalResponseContainerDTO`, whose `data[]` entries are calendar events with
`fitters[]`; each fitter has `fitterID`, `fitterName`, `fitterReference`, and
`resourceGroups[]` (`id`, `name`). `GET /api/v4/calendarevents` accepts
`fromDate`, `toDate`, `page`, `pagesize`, and `updatedAfter`.

This establishes an OpenAPI-documented transitive response path. A bounded
live check on 2026-10-11 verified the shape through
`GET /api/v4/calendarevents/{id}`: event 146500 returned fitter 48
(`Søren Boe Jacobsen`) with groups `(16, "12X - EL & Data")`,
`(28, "Alle")`, and `(45, "123 - El & Data Service ( SSE)")`.
`GET /api/v4/calendarevents` returned 10 rows per page and `total=90`; pages
1–9 were fetched with no API errors. Two additional page-1 list reads were
made while selecting a detail example; all 11 list GETs and the one detail GET
returned HTTP 200. Although the request specified
`fromDate=2026-06-12&toDate=2026-06-12`, event 146500 had
`start=2026-01-01T07:00:00`. Thus the returned list did not demonstrate the
requested date bound. Its 90 rows must not be treated as a June 12-only
calendar sample.

The detailed event proves the documented fitter/group ID/name nesting exists
in a live response. It did not contain the name
`183 - Pharma - Sikring - Service (DEP)` or ID 183. Calendar-event groups may
describe event-time associations and cannot alone establish present membership.

**User-provided Network Admin observation (not independently fetched or
authenticated here; user-approved as a one-time demo membership basis only):**
the user reports that the Network Admin view at
`https://hoyrup-clemmensen.e-komplet.dk/Admin/ResourceGroups_Get` showed active
EK resource group ID `61`, displayed name
`183 - Pharma - Sikring - Service (DEP)`, `IsActive=true`, and active fitter
IDs `15, 17, 18, 208, 290, 295, 498, 576`. The method and observation timestamp
are unknown. The raw JSON is not available in this workspace; this record is
the user-provided observation only. User approval is limited to using those
eight reported members as a demo-source membership basis; it does not approve
an ongoing import or a Render mutation. It distinguishes the displayed leading
label `183` from EK resource-group ID `61`: it is not evidence that the EK
group ID is `183`, nor has the Network Admin endpoint/method been verified
against the canonical integration contract.

A separately authorized single live detail request was attempted for the
user-supplied calendar event containing fitters 15 and 208:
`GET /api/v4/calendarevents/147572` (event window reported by the user as
`2026-10-11T06:00:00` through `2026-10-18T08:00:00`). It returned HTTP 200
with no top-level error flag/count, but the bounded response projection did
not locate the requested event or a lowercase `fitters` array under the
expected event-ID field variants. The response body was not retained, so this
is an extraction limitation rather than evidence that the API returned no
fitters/groups. No fitter IDs or `resourceGroups` from event 147572 can
therefore be reported as verified. This attempt does not corroborate the
Network Admin membership observation. No additional CalendarEvents request
was made.

FitterHours exposes group name strings, not group IDs. Worksheet
`resourceGroups[]` has IDs but describes worksheet associations, not the
employee's current authoritative membership. Neither is a safe replacement.
The prior live CalendarEvents sample cannot establish the DEP group's ID or
current membership. The Network Admin report is a user-provided observation of
active membership at an unknown observation time; it is not an independently
verified current membership snapshot. Event-time CalendarEvents associations
remain a separate source and were not extracted from event 147572.

The selected control cohort remains exactly fitter IDs `15, 295, 18, 208, 290,
498`; it excludes the additional reported active members `17` and `576`.
User-approved demo-source use of the eight reported members does not approve
changing Fielddesk membership or recipients.

### Read-only Render Adoption and Recipient Preview

On 2026-10-11, one explicit `BEGIN READ ONLY` / `COMMIT` transaction ran ten
Render `SELECT`s scoped to tenant UUID
`f1f51c07-2d88-4ee4-a766-78eac833a9d0`, target group UUID
`bdcea2d1-14e2-4477-813b-8657de826905`, and exact fitter IDs. The existing
group is active, named `183 - Pharma - Sikring - DEP`, and currently has
`external_source=NULL`, `external_id=NULL`. No tenant-scoped group row was
bound to `(ekomplet, 61)`, so the read-only conflict lookup returned zero rows.
Current group membership contains only fitter 18 (Jesper Sahner Kaiser,
external source/id `ekomplet` / `18`, active). Thus comparing current membership
of one with the user-reported eight-member demo basis yields seven reported
candidate additions: `15, 17, 208, 290, 295, 498, 576`. This comparison
describes the full reported group, not the selected Timekontrol cohort.

All six selected exact IDs resolve to active EK fitter rows in this tenant.
Their exact Render preview values are:

| `fitter_id` | `name` | Fitter `external_id` | Stored `old_reference` | Imported `fitter.email` candidate | Linked `tenant_user` |
|---|---|---|---|---|
| 15 | Mikkel Hyldebo Jensen | 15 | 127 | `mhj@hoyrup-clemmensen.dk` | none |
| 295 | Martin Uth Møller | 295 | 675 | `mum@hoyrup-clemmensen.dk` | active user; same email; link method `preexisting` |
| 18 | Jesper Sahner Kaiser | 18 | 133 | `jsk@hoyrup-clemmensen.dk` | none |
| 208 | Patrick Mylord Pedersen | 208 | 628 | `pep@hoyrup-clemmensen.dk` | none |
| 290 | Morten Bode | 290 | 472 | `mbo@hoyrup-clemmensen.dk` | none |
| 498 | Michael Peter Jensen | 498 | 3000 | `mpj@hoyrup-clemmensen.dk` | none |

The numeric values above are the stored Fielddesk `fitter.old_reference`
values, not independently verified current EK raw references. The targeted
read also found queried raw JSON keys `FitterReference`, `EmployeeNumber`, and
`Reference` all null, and `ek_user_id` null, for each selected fitter.

Each selected fitter row has `source=ekomplet`, `external_source=ekomplet`, and
`external_id` equal to the exact fitter ID. The email candidates in the table
come from imported `fitter.email`; only fitter 295 also has a linked active
tenant-user row, with the same email. No email-source metadata was available
for that tenant-user email, and the other five have no linked tenant-user row.
No `ek_user_id` was present for these six. Fitter 18 is already a member of
the target group; within the selected six, five are candidate additions
(`15, 295, 208, 290, 498`) and no selected fitter is a candidate removal.
These six are a Timekontrol/control cohort only, not the full group membership
candidate set. Full adoption of the user-approved eight-member demo basis
would instead have seven reported candidate additions
(`15, 17, 208, 290, 295, 498, 576`) relative to the current one-member group.
IDs 17 and 576 are in the reported full-group observation but explicitly
outside the selected six-person cohort. Their local fitter identities,
names and exact tenant-scoped EK bindings were queried separately, without
retrieving email values. Fitter 17 is Dennis Espersen Pedersen, active, with
`source=ekomplet`, `external_source=ekomplet`, `external_id=17`, and stored
`old_reference=132`. Fitter 576 is Ferhat Dalga, active, with
`source=ekomplet`, `external_source=ekomplet`, `external_id=576`, and stored
`old_reference=3050`. These rows verify the local fitter identities/bindings,
not their current membership in the EK group; that membership is only present
in the user-provided Network Admin observation. Neither is part of the
Timekontrol six-person cohort.

The exact six selected preview rows are:

| `fitter_id` | `name` | `old_reference` | imported `fitter.email` | user-approved address mapping | optional linked `tenant_user` |
|---|---|---:|---|---|
| `15` | Mikkel Hyldebo Jensen | `127` | `mhj@hoyrup-clemmensen.dk` | approved: `mhj@hoyrup-clemmensen.dk` | none |
| `295` | Martin Uth Møller | `675` | `mum@hoyrup-clemmensen.dk` | approved: `mum@hoyrup-clemmensen.dk` | active; `mum@hoyrup-clemmensen.dk` |
| `18` | Jesper Sahner Kaiser | `133` | `jsk@hoyrup-clemmensen.dk` | approved: `jsk@hoyrup-clemmensen.dk` | none |
| `208` | Patrick Mylord Pedersen | `628` | `pep@hoyrup-clemmensen.dk` | approved: `pep@hoyrup-clemmensen.dk` | none |
| `290` | Morten Bode | `472` | `mbo@hoyrup-clemmensen.dk` | approved: `mbo@hoyrup-clemmensen.dk` | none |
| `498` | Michael Peter Jensen | `3000` | `mpj@hoyrup-clemmensen.dk` | approved: `mpj@hoyrup-clemmensen.dk` | none |

`old_reference` is the stored Fielddesk fitter value, not a verified current
EK raw reference. The linked tenant-user identity for fitter 295 was
`f0333e28-0637-4ff6-bf8a-434689162700`, status active, link method
`preexisting`; no email-source metadata was present. The five other selected
fitters had no `tenant_user` row linked by the exact tenant-scoped join.

The user has explicitly approved these six exact fitter-to-email mappings:
15→`mhj@hoyrup-clemmensen.dk`, 295→`mum@hoyrup-clemmensen.dk`,
18→`jsk@hoyrup-clemmensen.dk`, 208→`pep@hoyrup-clemmensen.dk`,
290→`mbo@hoyrup-clemmensen.dk`, and 498→`mpj@hoyrup-clemmensen.dk`.
The user also approved DEP/LKE routing with uppercase normalization. This is
user-supplied approval evidence, not an approval persisted in Fielddesk's
database. The current Render schema did not contain
`time_control_employee_config`, so no persisted per-fitter approval/config
state or approval invalidation state could be verified. Fitter 295's linked
tenant-user email is the same approved address but does not itself constitute
recipient approval. Do not infer mail authorization from this documentation
alone or send mail as part of this preview.

Approver identity check, later same-task follow-up: two exact-name / exact-link
Render reads were performed in `BEGIN READ ONLY` transactions scoped to this
tenant. No `tenant_user` row matched the full name `Dennis Espersen Pedersen`.
The exact tenant-scoped fitter-17 relation does link the fitter
`Dennis Espersen Pedersen` (`external_id=17`) to active `tenant_user`
`8eaddbc0-8fc7-414a-9c5c-064617972394`. That linked user has stored name
`Dennis`, email `dep@hoyrup-clemmensen.dk`, role `tenant_admin`, status
`active`, and login status `active`. Thus the active tenant-admin account is
verified through the fitter's explicit tenant-scoped `tenant_user_id` foreign
key, not by matching the tenant-user display name to the full fitter name or
inferring identity from the email prefix. The full-name lookup itself returned
no row.

Do not conflate membership with recipient configuration: the user-approved
eight-member demo basis is a proposed group membership source only. It does not
approve sending to any of its eight members or the selected six.

This is a read-only preview, not a mutation plan execution. No Render write,
resource-group membership change, import, or recurring source integration
occurred. The Network Admin method, raw response, and observation timestamp
remain unavailable, so this demo basis is not proof of a live/current EK
membership snapshot.

The additional exact-reference read used one further `SELECT` in its own
`BEGIN READ ONLY` / `COMMIT` transaction, bringing this Render preview to eleven
SELECTs over two read-only transactions. Credential note for the probe:
`backend/.env.production` is the configured
`JWT_SECRET` source used by existing EK probe scripts and decrypts the stored
credential. The root `.env.production` secret fails AES-GCM authentication;
the initial blocker was selecting the wrong configured secret file, not
import order. Values were not printed. The Render tenant-config read was one
`SELECT` per request in `BEGIN READ ONLY` / `COMMIT`; eight such SELECTs were
run before this follow-up, followed by one additional read-only SELECT for the
event-detail request. The earlier 19 EK GETs returned HTTP 200; this additional
single EK GET also returned HTTP 200, but its event/fitter/group projection was
inconclusive as described above. No import, sync, write, or Timekontrol
database run occurred.

Proposed duplicate-free adoption, not implemented:

1. The user-approved scope is limited to a one-time demo based on the reported
   eight-member list. The method, raw response and observation time remain
   unverified. This is not approval for a mutation or recurring import. If a
   separately approved adoption is later proposed, use EK external group ID
   `61`; `183` is the displayed name label, not the external ID. Do not infer
   an automated source integration from the URL or unknown method.
2. Target the existing group UUID
   `bdcea2d1-14e2-4477-813b-8657de826905` in tenant
   `f1f51c07-2d88-4ee4-a766-78eac833a9d0`, never a name-based lookup.
3. Require explicit operator approval before any change. In one approved
   transaction, lock the target group and coordinate with importer operations.
   Verify the existing UUID is in the stated tenant and check its current
   external-source/external-ID binding. Check for conflicts on
   `(tenant, ekomplet, 61)` and verify every proposed fitter identity resolves
   to the same tenant's EK fitter. Reject conflicting identity, stale approval,
   or foreign/inactive fitters. Let the existing unique external-identity index
   be the final race guard; roll back on conflict, never merge/delete
   automatically.
4. Preserve UUID, name, managers and unrelated manual memberships. If
   explicitly approved for the demo group membership, compare the complete
   reported eight against current members and apply only the seven candidate
   additions `15, 17, 208, 290, 295, 498, 576`; retain current fitter 18.
   Separately retain the selected six-person Timekontrol cohort
   `15, 295, 18, 208, 290, 498`. The cohort does not limit or redefine group
   membership. Do not infer removals from an incomplete or stale observation.
5. Write `resource_group_updated` and `resource_group_member_changed` audit
   events in that transaction: server-derived tenant/actor, target UUID,
   old/new IDs, source/evidence revision, explicit operator approval and exact
   member additions or removals. A repeated identical approval is a no-op, not
   a second group.
6. Read back exactly one external group 61, the unchanged UUID and approved
   fitter IDs; verify the audit and that unrelated groups/members are intact.

This also requires an explicit policy decision: the security model makes
Fielddesk-owned groups canonical once created. EK provenance must not silently
transfer ownership of manual memberships to an automatic importer.

Names like `183 - Pharma - Sikring - (service) - DEP` are parsed defensively.
The `183` label is display metadata here and is not an external identity:

- `display_label`: `183`
- `area`: `Pharma`
- `discipline`: `Sikring`
- `category`: `service`
- `short_code`: `DEP`

No owner code such as `DEP` is global behavior; it is stored only as metadata found in that tenant import.

## Initials

Email prefixes are used for display/search metadata only. For example `jsk@example.dk` becomes `JSK`. Identity still uses tenant-scoped ids and external references.

## Sync

- Manual endpoint: `POST /api/tenant/admin/integrations/ekomplet/fitters/sync`.
- Status endpoint: `GET /api/tenant/admin/integrations/sync-status`.
- Manual sync creates an endpoint-scoped `sync_job` with `type = manual_full_resync` and `endpoint_key = fitters`.
- The worker now schedules automatic delta/reconcile jobs every 12 hours.
- `/api/v4/fitters` has no verified delta parameters in this repo, so fitters use idempotent full-list upsert.

## Tenant Admin UI/API

Tenant admins can:

- List imported and manual employees via `GET /api/tenant/admin/users`.
- Create manual users via `POST /api/tenant/admin/users`.
- List resource groups with source/external metadata via `GET /api/tenant/admin/resource-groups`.
- Trigger fitter sync from the tenant admin UI; resource-group derivation is
  not currently wired to that import.

RBAC uses the `tenant_admin` module permission. Routes require tenant host resolution, access token auth, tenant-context match, and tenant admin role.
