# Projektudstyr Beta - CCTV

Status: Beta / MVP

Scope:
- Project-scoped CCTV equipment registration for assigned project users.
- Fielddesk-owned persisted data in `project_equipment_cctv`.
- Manual create, update, archive, list, search/check, checked-status update, and CSV export.
- Tenant isolation, project access, module permission checks, beta env gating, optional tenant/project/user allowlists, and mutation/export audit events use existing Fielddesk backend patterns.

Implemented in beta:
- CCTV only.
- MAC normalization before write.
- Active duplicate protection for MAC and serial number within tenant + project scope.
- `location_text` is the primary placement field.

Intentionally not implemented in this beta:
- Full Projektudstyr / IDE_BANK equipment model.
- External integrations or full sync.
- CSV import.
- Browser camera/barcode scanning.
- Pictures/uploads.
- Drawing or pin placement.

## Local DB notes

The normal local development default is PostgreSQL on `localhost:5432`:

```text
DATABASE_URL -> postgresql://postgres:postgres@localhost:5432/fielddesk_v3
```

Some older local verification notes and scripts mention `127.0.0.1:55432`. Treat `55432` as a Docker/tunnel/proxy port only. Use it only when that container or proxy is actually running and `Test-NetConnection 127.0.0.1 -Port 55432` succeeds. If no such service is running, use the normal local `5432` setup from `backend/README_LOCAL_RUN.md`.

Quick checks:

```powershell
Test-NetConnection 127.0.0.1 -Port 5432
Test-NetConnection 127.0.0.1 -Port 55432
cd backend
npm run db:migrate:status
```

Do not commit private `.env` values or database credentials.

## Safe beta activation

The API is disabled by default unless `PROJECT_EQUIPMENT_BETA_ENABLED=true` is set.

Required staging/dev env vars for a limited beta:

```text
PROJECT_EQUIPMENT_BETA_ENABLED=true
PROJECT_EQUIPMENT_BETA_TENANT_IDS=<tenant uuid>
PROJECT_EQUIPMENT_BETA_PROJECT_IDS=<project uuid>
PROJECT_EQUIPMENT_BETA_USER_IDS=<comma-separated user uuids>
```

Rules:
- Leave the beta disabled in shared environments until the migration is applied and allowlist UUIDs are known.
- Set at least tenant and project allowlists for staging/dev testing.
- Add only the specific users who should test the beta.
- Remove test users from `PROJECT_EQUIPMENT_BETA_USER_IDS` when the test window is done.

Existing role permissions still apply:
- `tenant_admin`: read/create/update/delete/export.
- `project_leader`: read/create/update/delete/export.
- `technician`: read/create/update/export; no delete/archive.

The user must also have normal tenant context and project access through the existing Fielddesk project access rules.

## Staging/dev checklist

Before testing on a real project:

1. Confirm the target environment `DATABASE_URL` points to the intended staging/dev database.
2. Run migrations with the normal runner:

```bash
cd backend
npm run db:migrate
npm run db:migrate:status
```

3. Verify `0029_project_equipment_cctv_beta.sql` is applied and `project_equipment_cctv` exists.
4. Set `PROJECT_EQUIPMENT_BETA_ENABLED=true`.
5. Set `PROJECT_EQUIPMENT_BETA_TENANT_IDS` to the target tenant UUID.
6. Set `PROJECT_EQUIPMENT_BETA_PROJECT_IDS` to the target project UUID.
7. Set `PROJECT_EQUIPMENT_BETA_USER_IDS` to the tester user UUIDs.
8. Restart/redeploy the service so env vars are loaded.
9. Confirm a non-allowlisted user cannot see/use the beta endpoints.
10. Confirm a technician cannot archive/delete.
11. Confirm `tenant_admin` or `project_leader` can create/update/check/export/archive.

For Render-like environments, run migrations as an explicit shell/one-off job with the environment `DATABASE_URL`. Do not run migrations at app startup and do not reset staging/prod from `schema.sql`.

## Manual browser smoke plan

Use this plan if automated browser tooling is not available.

Desktop viewport:
- Log in as an allowlisted `project_leader` or `tenant_admin`.
- Open the allowlisted project page.
- Confirm `Projektudstyr Beta - CCTV` is visible.
- Confirm the list loads without error.
- Click `Tilfoej kamera`; confirm the drawer opens.
- Create `CAM-001` with a MAC, S/N, model and placement.
- Confirm it appears in the list after save.
- Edit `CAM-001`; change placement or model; save and confirm the change is visible.
- Use `Kontroller kamera` with MAC, S/N and Kamera-ID; each should find the camera.
- Mark the camera as `Monteret` and then `Kontrolleret` if the UI flow is used for status checks.
- Export CSV and confirm the file includes the active row.
- Archive/delete as `project_leader` or `tenant_admin`; confirm the row disappears from the active list.

Desktop negative access:
- Log in as a user outside `PROJECT_EQUIPMENT_BETA_USER_IDS`; the CCTV section should not be visible and API calls should return 403.
- Open a project outside `PROJECT_EQUIPMENT_BETA_PROJECT_IDS`; the CCTV section should not be visible and API calls should return 403.
- Log in as `technician`; create/update/check/export should work if the user is allowlisted, but archive/delete should return 403.

Mobile viewport:
- Open the allowlisted project page on a phone-sized viewport.
- Confirm the CCTV section can be found by scrolling.
- Confirm `Kontroller kamera`, `Tilfoej kamera` and `CSV` are tappable.
- Create and edit one camera without horizontal layout breakage.
- Run check by MAC or S/N.
- Confirm cards remain readable: camera id, MAC, S/N, location and status are visible.

## API smoke checklist

Use a bearer token for an allowlisted tester on the tenant host.

- `GET /api/projects/:projectId/equipment/cctv` returns 200 and a list.
- `POST /api/projects/:projectId/equipment/cctv` creates a camera.
- `PATCH /api/projects/:projectId/equipment/cctv/:cameraRecordId` updates status/details.
- `GET /api/projects/:projectId/equipment/cctv/check?q=<mac-or-sn-or-camera-id>` finds the camera.
- `GET /api/projects/:projectId/equipment/cctv/export.csv` returns CSV.
- `DELETE /api/projects/:projectId/equipment/cctv/:cameraRecordId` archives for `tenant_admin`/`project_leader` only.
- Duplicate active MAC/S/N returns `409 project_equipment_cctv_duplicate`.
- Non-allowlisted tenant/project/user returns 403.

## Suggested real-project test data

Do not hardcode this into staging unless the project owner approves. Enter manually during the test or use it as a checklist.

| Camera | MAC input | S/N | Model | Placement | Start status |
| --- | --- | --- | --- | --- | --- |
| CAM-001 | 001122334455 | CCTV-SN-001 | Axis P1455-LE | Indgang nord | registered |
| CAM-002 | 00-11-22-33-44-66 | CCTV-SN-002 | Axis M2035-LE | Port vest | planned |
| CAM-003 | 00:11:22:33:44:77 | CCTV-SN-003 | Hikvision DS-2CD | Lager syd | mounted |
| CAM-004 | AA:BB:CC:DD:EE:04 | CCTV-SN-004 | Dahua IPC-HFW | Teknikrum | checked |
| CAM-005 | AA-BB-CC-DD-EE-05 | CCTV-SN-005 | Uniview IPC | Rampe ost | deviation |

Specific duplicate checks:
- After creating `CAM-001`, try another camera with `00-11-22-33-44-55`; it should be blocked as duplicate MAC.
- Try another camera with `CCTV-SN-001`; it should be blocked as duplicate S/N.
- Archive `CAM-001`, then create a new active camera with the same MAC/S/N; it should be allowed by the current active-only model.

## Known limitations

- No images.
- No browser scanning.
- No drawing or pins.
- No CSV import.
- No external equipment sync.
- No general equipment model beyond CCTV.
- Audit is logged for create/update/archive/checked/export; the read-only check endpoint does not create a separate audit event.

## Notes

- Browser scanning should be added only after a shared camera/barcode pattern is accepted.
- Pictures should be added only through the future Fielddesk file/storage contract.
- Drawing/pin placement should reuse a future drawing/restarbejde component instead of creating a separate beta-only drawing system.
## Controlled staging/dev test runbook

This section is the operational handoff for a limited staging/dev or testtenant run. Do not hardcode UUIDs in code. UUIDs belong only in environment variables or operator notes for the active test window.

### 1. Find required UUIDs

Run these against the target staging/dev database. Use `DATABASE_URL` for the target environment; do not use production unless the test has explicitly been approved there.

Find tenant UUID by slug or domain:

```sql
SELECT
  t.id AS tenant_id,
  t.slug,
  t.name,
  t.status,
  td.domain,
  td.verified,
  td.active
FROM tenant t
LEFT JOIN tenant_domain td ON td.tenant_id = t.id
WHERE lower(t.slug) = lower('<tenant-slug>')
   OR lower(td.domain) = lower('<tenant-domain>')
ORDER BY td.active DESC, td.verified DESC, t.slug;
```

Find the CCTV test project UUID by Fielddesk project id, external project reference, name, or EK project id:

```sql
SELECT
  pc.project_id,
  pc.tenant_id,
  pc.external_project_ref,
  pc.name,
  pc.status,
  pc.is_closed,
  pc.has_v4,
  pc.owner_user_id,
  pm.ek_project_id
FROM project_core pc
LEFT JOIN project_masterdata_v4 pm
  ON pm.project_id = pc.project_id
 AND pm.tenant_id = pc.tenant_id
WHERE pc.tenant_id = '<tenant uuid>'::uuid
  AND (
    pc.project_id::text = '<project uuid or blank>'
    OR lower(btrim(coalesce(pc.external_project_ref, ''))) = lower(btrim('<external project ref>'))
    OR lower(pc.name) LIKE lower('%<part of project name>%')
    OR pm.ek_project_id::text = '<ek project id or blank>'
  )
ORDER BY pc.updated_at DESC
LIMIT 20;
```

Find tester user UUIDs for Dennis and selected employees:

```sql
SELECT
  id AS tenant_user_id,
  tenant_id,
  email,
  username,
  name,
  role,
  status
FROM tenant_user
WHERE tenant_id = '<tenant uuid>'::uuid
  AND status = 'active'
  AND (
    lower(email) IN (lower('<email-1>'), lower('<email-2>'))
    OR lower(username) IN (lower('<username-1>'), lower('<username-2>'))
    OR lower(name) LIKE lower('%<name part>%')
  )
ORDER BY role, name, email;
```

Verify tester project access before enabling the beta:

```sql
SELECT
  tu.id AS tenant_user_id,
  tu.email,
  tu.name,
  tu.role,
  pc.project_id,
  pc.external_project_ref,
  pc.name AS project_name,
  CASE
    WHEN pc.owner_user_id = tu.id THEN 'owner_user_id'
    WHEN pa.tenant_user_id IS NOT NULL THEN 'project_assignment'
    WHEN lower(btrim(coalesce(pc.responsible_code, ''))) = lower(btrim(coalesce(tu.username, ''))) THEN 'responsible_code'
    WHEN lower(btrim(coalesce(pc.team_leader_code, ''))) = lower(btrim(coalesce(tu.username, ''))) THEN 'team_leader_code'
    ELSE 'no_project_access_match'
  END AS access_path
FROM tenant_user tu
CROSS JOIN project_core pc
LEFT JOIN project_assignment pa
  ON pa.tenant_id = pc.tenant_id
 AND pa.project_id = pc.project_id
 AND pa.tenant_user_id = tu.id
WHERE tu.tenant_id = '<tenant uuid>'::uuid
  AND pc.tenant_id = '<tenant uuid>'::uuid
  AND pc.project_id = '<project uuid>'::uuid
  AND tu.id = ANY(ARRAY['<user uuid 1>'::uuid, '<user uuid 2>'::uuid]);
```

Any tester with `no_project_access_match` should not be expected to see or use the project until normal Fielddesk project access is fixed.

### 2. Env var plan

Set these on the staging/dev backend service only:

```text
PROJECT_EQUIPMENT_BETA_ENABLED=true
PROJECT_EQUIPMENT_BETA_TENANT_IDS=<tenant uuid>
PROJECT_EQUIPMENT_BETA_PROJECT_IDS=<project uuid>
PROJECT_EQUIPMENT_BETA_USER_IDS=<user uuid 1>,<user uuid 2>,<user uuid 3>
```

Render-style setup:
- Use the backend web service Environment tab for a controlled test.
- Add the values as service-level environment variables, not committed files.
- Values are strings; use comma-separated UUID strings for the allowlists.
- Save and deploy/restart the service so Node reads the new environment.
- If the service is managed by Blueprint later, keep real UUIDs out of Git and set sensitive or environment-specific values in the Dashboard or environment group.

### 3. Migration and deploy order

1. Confirm the branch/PR includes `migrations/0029_project_equipment_cctv_beta.sql`, backend module routes/services, schema documentation, and the beta env gate.
2. Confirm no broad enablement is committed; `PROJECT_EQUIPMENT_BETA_ENABLED` should default to false in examples.
3. Merge/deploy to staging/dev only.
4. Run migration explicitly on the staging/dev database:

```bash
cd backend
npm run db:migrate
npm run db:migrate:status
```

5. Confirm migration status includes `0029_project_equipment_cctv_beta.sql` as applied.
6. Set the four beta env vars above on the staging/dev backend service.
7. Restart/redeploy backend.
8. Confirm health check on the service.
9. Confirm a non-allowlisted user gets 403 or does not see the CCTV section.
10. Confirm the allowlisted project leader can load `GET /api/projects/:projectId/equipment/cctv` with 200.
11. Begin manual browser test.

For Render, run migrations as a Shell/one-off job with the service `DATABASE_URL`. Do not run migrations at app startup. Do not use `schema.sql` to reset staging/dev.

### 4. Manual test guide for Dennis

Use an allowlisted `project_leader` first.

1. Log in as the allowlisted project leader.
2. Open the agreed CCTV test project.
3. Confirm `Projektudstyr Beta - CCTV` is visible.
4. Create these five cameras:
   - `CAM-001`, MAC `001122334455`, S/N `CCTV-SN-001`, placement `Indgang nord`, status `Registreret`.
   - `CAM-002`, MAC `00-11-22-33-44-66`, S/N `CCTV-SN-002`, placement `Port vest`, status `Planlagt`.
   - `CAM-003`, MAC `00:11:22:33:44:77`, S/N `CCTV-SN-003`, placement `Lager syd`, status `Monteret`.
   - `CAM-004`, MAC `AA:BB:CC:DD:EE:04`, S/N `CCTV-SN-004`, placement `Teknikrum`, status `Kontrolleret`.
   - `CAM-005`, MAC `AA-BB-CC-DD-EE-05`, S/N `CCTV-SN-005`, placement `Rampe ost`, status `Afvigelse`.
5. Confirm all five appear in the list.
6. Try to create a duplicate of `CAM-001` with MAC `00-11-22-33-44-55`; it should be blocked.
7. Try to create a duplicate using S/N `CCTV-SN-001`; it should be blocked.
8. Edit `CAM-002`: change placement, status and note; confirm the list updates.
9. Use `Kontroller kamera` with:
   - MAC from one camera.
   - S/N from one camera.
   - Kamera-ID from one camera.
10. Mark one camera as `Monteret` and one as `Kontrolleret` through the UI-supported status flow.
11. Export CSV and confirm the file contains the active cameras.
12. Archive one camera as project leader; confirm it disappears from active list.
13. Log in as an allowlisted `technician`; confirm create/update/check/export works, but archive/delete is denied or unavailable.
14. Log in as a non-allowlisted user; confirm the CCTV section is not visible and direct API calls are denied.
15. Open another project outside the project allowlist; confirm the CCTV section is not visible.

### 5. Rollback / stop plan

Fast stop:

```text
PROJECT_EQUIPMENT_BETA_ENABLED=false
```

Or remove these values entirely:

```text
PROJECT_EQUIPMENT_BETA_ENABLED
PROJECT_EQUIPMENT_BETA_TENANT_IDS
PROJECT_EQUIPMENT_BETA_PROJECT_IDS
PROJECT_EQUIPMENT_BETA_USER_IDS
```

Operational notes:
- Restart/redeploy backend after changing env vars.
- With the flag off, API access is denied and the UI section remains hidden because it cannot load equipment data.
- Existing `project_equipment_cctv` rows remain in the database.
- Prefer preserving test data until the test is reviewed; it is useful for audit and debugging.
- If the test is dropped and data must be removed, delete manually only after an explicit decision and a backup/export. The table is project-scoped, so filter by tenant and project.
- Do not roll back by dropping the migration on a shared database; use env disablement as the stop mechanism.

Optional manual cleanup query after explicit approval only:

```sql
SELECT id, camera_id, mac_address, serial_number, status, archived_at
FROM project_equipment_cctv
WHERE tenant_id = '<tenant uuid>'::uuid
  AND project_id = '<project uuid>'::uuid
ORDER BY created_at;
```

Use the select result for review before any delete/archive cleanup.

### 6. Text for test users

This is a limited beta of Projektudstyr for CCTV on the agreed test project only. Data you enter is saved in Fielddesk. Scanning, pictures, drawing placement and CSV import are not part of this beta yet. Please create and edit only the agreed test cameras, try the check and CSV export flows, and report errors or wishes back to Dennis with the camera ID and what you tried.
