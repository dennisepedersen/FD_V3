# Projektudstyr Beta - CCTV

Status: Beta / MVP

Scope:
- Project-scoped CCTV equipment registration for users with normal project access.
- Fielddesk-owned persisted data in `project_equipment_cctv`.
- Manual create, update, archive, list, search/check, checked-status update, images, drawings/pins, CSV export and PDF export.
- Tenant isolation, project access, module permission checks, the global beta env gate, and mutation/export audit events use existing Fielddesk backend patterns.

Implemented in beta:
- CCTV only.
- MAC normalization before write.
- Active duplicate protection for MAC and serial number within tenant + project scope.
- `location_text` is the primary placement field.
- Image slots for projection/installation.
- Drawing upload/import and percent-based pin placement.

Intentionally not implemented in this beta:
- Full Projektudstyr / IDE_BANK equipment model.
- External integrations or full sync.
- CSV import.
- Personal project-leader module defaults.

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

## Availability model

The API is disabled by default unless `PROJECT_EQUIPMENT_BETA_ENABLED=true` is set.

Required env var while the module is still globally gated:

```text
PROJECT_EQUIPMENT_BETA_ENABLED=true
```

Rules:
- The global switch controls whether the module is available at all.
- Tenant, project and user allowlists are no longer used by code.
- Existing and future projects require no per-project Render env var or database backfill to show Udstyr when the global switch is active.
- Access is still controlled by tenant isolation, normal project access and role permissions.
- A user must already be allowed to access the project before any CCTV endpoint may return project data.

Legacy Render env vars safe to remove after a successful broad-availability deploy:

```text
PROJECT_EQUIPMENT_BETA_TENANT_IDS
PROJECT_EQUIPMENT_BETA_PROJECT_IDS
PROJECT_EQUIPMENT_BETA_USER_IDS
```

## Role permissions

Existing role permissions still apply through `project_equipment_beta` module access:

| Role | Read | Create | Update | Archive/delete | Check | Images | Drawings/pins | CSV/PDF export |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `tenant_admin` | yes | yes | yes | yes | yes | yes | yes | yes |
| `project_leader` | yes | yes | yes | yes | yes | yes | yes | yes |
| `technician` | yes | yes | yes | no | yes | upload/update yes, delete no | save/update yes, delete no | yes |

The user must also have normal tenant context and project access through existing Fielddesk project access rules.

## Staging/dev checklist

Before testing on a real project:

1. Confirm the target environment `DATABASE_URL` points to the intended staging/dev database.
2. Verify migrations are already applied with the normal runner:

```bash
cd backend
npm run db:migrate:status
```

3. Verify `0029_project_equipment_cctv_beta.sql` is applied and `project_equipment_cctv` exists.
4. Set `PROJECT_EQUIPMENT_BETA_ENABLED=true`.
5. Restart/redeploy the service so env vars are loaded.
6. Confirm a user without normal project access cannot access project equipment endpoints for that project.
7. Confirm a technician cannot archive/delete.
8. Confirm `tenant_admin` or `project_leader` can create/update/check/export/archive on projects they can access.

For Render-like environments, run migrations only as an explicit shell/one-off job when needed. Do not run migrations at app startup and do not reset staging/prod from `schema.sql`.

## Manual browser smoke plan

Use this plan if automated browser tooling is not available.

Desktop viewport:
- Log in as a `project_leader` or `tenant_admin` with access to the project.
- Open a project page the user can access.
- Confirm `Udstyr` / CCTV is visible when `PROJECT_EQUIPMENT_BETA_ENABLED=true`.
- Confirm the list loads without error, including projects with zero cameras.
- Click `Tilfoej kamera`; confirm the drawer opens.
- Create a camera with Kamera-ID, optional MAC, S/N, model and placement.
- Confirm it appears in the list after save.
- Edit the camera; change placement, status or note; save and confirm the change is visible.
- Use `Kontroller kamera` with MAC, S/N and Kamera-ID; each should find the camera.
- Export CSV/PDF and confirm the file includes active cameras.
- Archive/delete as `project_leader` or `tenant_admin`; confirm the row disappears from the active list.

Desktop negative access:
- Log in as a user without access to the project; project and CCTV API calls should remain denied by normal project access rules.
- Turn `PROJECT_EQUIPMENT_BETA_ENABLED=false` in a controlled environment; the CCTV API should return 403 through module access.
- Log in as `technician`; create/update/check/export should work on accessible projects, but archive/delete should return 403.

Mobile viewport:
- Open an accessible project page on a phone-sized viewport.
- Confirm the CCTV section can be found by scrolling.
- Confirm `Kontroller kamera`, `Tilfoej kamera`, drawing actions and export actions are tappable.
- Create and edit one camera without horizontal layout breakage.
- Run check by MAC, S/N or Kamera-ID.
- Confirm cards remain readable: camera id, MAC, S/N, location, images/pin and status are visible.

## API smoke checklist

Use a bearer token for a project-scoped user on the tenant host.

- `GET /api/projects/:projectId/equipment/cctv` returns 200 and a list for accessible projects.
- `POST /api/projects/:projectId/equipment/cctv` creates a camera for roles with create permission.
- `PATCH /api/projects/:projectId/equipment/cctv/:cameraRecordId` updates status/details for roles with update permission.
- `GET /api/projects/:projectId/equipment/cctv/check?q=<mac-or-sn-or-camera-id>` finds active cameras for roles with read permission.
- `GET /api/projects/:projectId/equipment/cctv/export.csv` returns CSV for roles with export permission.
- `GET /api/projects/:projectId/equipment/cctv/export.pdf` returns PDF for roles with export permission.
- Drawing, pin and image endpoints follow the same read/create/update/delete module actions used by the routes.
- `DELETE /api/projects/:projectId/equipment/cctv/:cameraRecordId` archives for `tenant_admin`/`project_leader` only.
- Duplicate active MAC/S/N returns `409 project_equipment_cctv_duplicate`.
- Users without normal tenant/project access return 403; `PROJECT_EQUIPMENT_BETA_ENABLED=false` also returns 403 through module access.

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

- No CSV import.
- No external equipment sync.
- No general equipment model beyond CCTV.
- Audit is logged for create/update/archive/checked/export/image/drawing/pin mutations; the read-only check endpoint does not create a separate audit event.

## Future project-leader module defaults

Not part of this beta change:

- each project leader may later define standard modules for their own projects, `scope=mine`;
- DEP can have one set of defaults and TKJ another;
- defaults can apply to the project leader's new/imported projects;
- each concrete project can later override the project leader default;
- a project override must not mutate the user's global default;
- access must remain limited by tenant isolation, project scope and RBAC.

Do not add database, API or UI for this in the broad-availability change.

## Rollback / stop plan

Fast stop:

```text
PROJECT_EQUIPMENT_BETA_ENABLED=false
```

Or remove this value entirely:

```text
PROJECT_EQUIPMENT_BETA_ENABLED
```

Operational notes:
- Restart/redeploy backend after changing env vars.
- With the flag off, API access is denied and the UI section remains hidden because it cannot load equipment data.
- Existing `project_equipment_cctv`, image, drawing and pin rows remain in the database.
- Do not roll back by dropping the migration on a shared database; use env disablement as the stop mechanism.
- Legacy tenant/project/user allowlist env vars are ignored by code after broad availability and may be removed from Render after a successful deploy.

## Text for test users

Projektudstyr for CCTV is available on projects you already have access to when the global module switch is active. Data you enter is saved in Fielddesk. Use the agreed project data carefully, try create/edit/check/drawing/image/export flows where relevant, and report errors or wishes back to Dennis with the camera ID and what you tried.
