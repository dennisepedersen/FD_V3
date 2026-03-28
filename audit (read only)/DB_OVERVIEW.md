# DB_OVERVIEW.md — Fielddesk V2 Database Audit

Generated: 2026-03-22
Source: `backend/db/schema.sql` + `backend/db/postgres.js` + migration files
Status: VERIFIED from code

---

## Database Engine

- PostgreSQL (hosted, connection via `DATABASE_URL`)
- SSL: required by default (`PGSSL=require`)
- Driver: `pg` (node-postgres) via connection pool (`Pool`)
- No RLS policies found in code (schema.sql has none; postgres.js creates none)

> ⚠ RLS: NOT implemented. Tenant isolation is application-layer only (WHERE tenant_id = $1 in every query). This is a known gap vs. the locked security model which says RLS is part of enforcement.

---

## Tables

### 1. `users`

| Column | Type | Notes |
|---|---|---|
| tenant_id | TEXT | PK part 1 |
| user_uuid | TEXT | PK part 2 |
| username | TEXT | |
| email | TEXT | |
| employee_id | TEXT | |
| display_name | TEXT | |
| raw | JSONB NOT NULL | E-komplet raw payload |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() |

**PK:** (tenant_id, user_uuid)

**Indexes:**
- `idx_users_tenant_username` ON (tenant_id, LOWER(username))
- `idx_users_tenant_email` ON (tenant_id, LOWER(email))
- `idx_users_tenant_employee` ON (tenant_id, employee_id)

**FK:** None

---

### 2. `projects`

| Column | Type | Notes |
|---|---|---|
| tenant_id | TEXT | PK part 1 |
| project_uuid | TEXT | PK part 2 |
| project_id_text | TEXT | |
| reference | TEXT | |
| project_name | TEXT | |
| customer_name | TEXT | |
| responsible | TEXT | username |
| responsible_name | TEXT | display name |
| responsible_uuid | TEXT | |
| team_leader | TEXT | username |
| team_leader_name | TEXT | |
| team_leader_uuid | TEXT | |
| is_closed | BOOLEAN | DEFAULT FALSE |
| activity_date | TIMESTAMPTZ | |
| raw | JSONB NOT NULL | |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() |

**PK:** (tenant_id, project_uuid)
**Unique:** `ux_projects_tenant_project_uuid` ON (tenant_id, project_uuid)

**Indexes:**
- `idx_projects_tenant_isclosed` ON (tenant_id, is_closed)
- `idx_projects_tenant_responsible` ON (tenant_id, LOWER(responsible))
- `idx_projects_tenant_teamleader` ON (tenant_id, LOWER(team_leader))
- `idx_projects_tenant_resp_uuid` ON (tenant_id, responsible_uuid)
- `idx_projects_tenant_team_uuid` ON (tenant_id, team_leader_uuid)
- `idx_projects_tenant_activity` ON (tenant_id, activity_date DESC)

**FK:** None

---

### 3. `project_status_history`

| Column | Type | Notes |
|---|---|---|
| tenant_id | TEXT | |
| project_id | TEXT | |
| was_closed | BOOLEAN | |
| is_closed | BOOLEAN | |
| detected_at | TIMESTAMPTZ | DEFAULT NOW() |
| source_sync_type | TEXT | |
| sync_run_id | TEXT | |
| project_reference | TEXT | |

**PK:** None (no primary key defined)

**Indexes:**
- `idx_psh_tenant_detected_at` ON (tenant_id, detected_at DESC)
- `idx_psh_tenant_project_id` ON (tenant_id, project_id)
- `idx_psh_tenant_isclosed_detected` ON (tenant_id, is_closed, detected_at DESC)

**FK:** None

> ⚠ No primary key — UNKNOWN if this causes issues at scale.

---

### 4. `tenant_user_mappings`

| Column | Type | Notes |
|---|---|---|
| tenant_id | TEXT | PK part 1 |
| ek_user_uuid | TEXT | PK part 2 |
| ek_username | TEXT | |
| full_name | TEXT | |
| email | TEXT | |
| fd_username | TEXT | Fielddesk mapped username |
| role_names | JSONB | DEFAULT '[]' |
| role_ids | JSONB | DEFAULT '[]' |
| responsible | TEXT | |
| responsible_id | TEXT | |
| phone | TEXT | |
| hide_phone | BOOLEAN | DEFAULT FALSE |
| placeholder1-4 | TEXT | |
| mapping_status | TEXT | DEFAULT 'draft' |
| approved_by | TEXT | |
| approved_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

**PK:** (tenant_id, ek_user_uuid)

**Indexes:**
- `idx_tum_tenant_id` ON (tenant_id)
- `idx_tum_tenant_ek_user_uuid` ON (tenant_id, ek_user_uuid)
- `idx_tum_tenant_responsible_id` ON (tenant_id, responsible_id)

**FK:** None

---

### 5. `tenants`

| Column | Type | Notes |
|---|---|---|
| tenant_id | TEXT | PK |
| name | TEXT NOT NULL | |
| status | TEXT | DEFAULT 'active' |
| onboarding_state | TEXT | DEFAULT 'draft' |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() |

> ⚠ `slug` column referenced in seed INSERT in postgres.js (`tenant_id, slug, name, status`) but NOT in the CREATE TABLE. This means the schema has a drift between the table definition and the seed query. Likely the `slug` column was removed or never added.
> Status: MISMATCH — postgres.js INSERT references `slug` column that does not exist in CREATE TABLE.

**PK:** tenant_id

**Indexes:**
- `idx_tenants_status` ON (status)

**FK:** Referenced by tenant_features, tenant_first_admin_contacts, tenant_admin_invites, tenant_admin_credentials, tenant_integration_credentials (all ON DELETE CASCADE)

---

### 6. `tenant_features`

| Column | Type | Notes |
|---|---|---|
| tenant_id | TEXT | PK part 1, FK → tenants |
| feature_key | TEXT | PK part 2 |
| enabled | BOOLEAN | DEFAULT TRUE |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() |

**PK:** (tenant_id, feature_key)
**FK:** tenant_id → tenants(tenant_id) ON DELETE CASCADE

**Indexes:**
- `idx_tenant_features_tenant` ON (tenant_id)

---

### 7. `tenant_first_admin_contacts`

| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL | PK |
| tenant_id | TEXT | FK → tenants, UNIQUE |
| email | TEXT NOT NULL | |
| full_name | TEXT NOT NULL | |
| status | TEXT | DEFAULT 'draft' |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

**PK:** id
**Unique:** (tenant_id) — only one per tenant
**FK:** tenant_id → tenants(tenant_id) ON DELETE CASCADE

**Indexes:**
- `idx_first_admin_contacts_tenant` ON (tenant_id)

---

### 8. `tenant_admin_invites`

| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL | PK |
| tenant_id | TEXT | FK → tenants |
| token_hash | TEXT NOT NULL UNIQUE | SHA256 of invite token |
| status | TEXT | DEFAULT 'pending' |
| expires_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | |
| used_at | TIMESTAMPTZ | |

**Status CHECK:** pending, sent, accepted, expired, revoked

**FK:** tenant_id → tenants(tenant_id) ON DELETE CASCADE

**Indexes:**
- `idx_tenant_admin_invites_tenant` ON (tenant_id, created_at DESC)

---

### 9. `tenant_admin_credentials`

| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL | PK |
| tenant_id | TEXT | FK → tenants |
| email | TEXT NOT NULL | |
| password_hash | TEXT NOT NULL | bcrypt |
| role | TEXT | DEFAULT 'tenant_admin' |
| status | TEXT | DEFAULT 'active' |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |
| last_login_at | TIMESTAMPTZ | |

**Role CHECK:** tenant_admin only
**Status CHECK:** active, inactive
**Unique:** (tenant_id, email)

**FK:** tenant_id → tenants(tenant_id) ON DELETE CASCADE

**Indexes:**
- `idx_tenant_admin_credentials_tenant_email` ON (tenant_id, LOWER(email))

---

### 10. `tenant_integration_credentials`

| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL | PK |
| tenant_id | TEXT | FK → tenants |
| integration_key | TEXT | e.g. "ekomplet" |
| sitename | TEXT | |
| api_key_encrypted | TEXT | AES-256-GCM, format: v1:iv:tag:cipher |
| base_url | TEXT | DEFAULT 'https://externalaccessapi.e-komplet.dk' |
| status | TEXT | DEFAULT 'configured' |
| last_tested_at | TIMESTAMPTZ | |
| last_test_ok | BOOLEAN | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

**Status CHECK:** not_configured, configured, test_ok, test_failed
**Unique:** (tenant_id, integration_key)

**FK:** tenant_id → tenants(tenant_id) ON DELETE CASCADE

**Indexes:**
- `idx_tenant_integration_credentials_tenant` ON (tenant_id, integration_key)

---

### 11. `tenant_sync_state`

| Column | Type | Notes |
|---|---|---|
| tenant_id | TEXT | PK part 1 |
| sync_type | TEXT | PK part 2 |
| last_successful_sync_at | TIMESTAMPTZ | |
| last_attempt_at | TIMESTAMPTZ | |
| status | TEXT | DEFAULT 'idle' |
| rows_processed | INT | DEFAULT 0 |
| pages_processed | INT | DEFAULT 0 |
| error_text | TEXT | |
| updated_at | TIMESTAMPTZ | |

**PK:** (tenant_id, sync_type)

**Indexes:**
- `idx_tenant_sync_state_tenant` ON (tenant_id)
- `idx_tenant_sync_state_status` ON (status)

**FK:** None (no FK to tenants — potential orphan rows if tenant deleted)

---

### 12. `tenant_fitterhours_bootstrap_state`

| Column | Type | Notes |
|---|---|---|
| tenant_id | TEXT | PK part 1 |
| sync_type | TEXT | PK part 2 |
| status | TEXT | DEFAULT 'idle' |
| bootstrap_from_date | DATE | |
| bootstrap_to_date | DATE | |
| current_page | INT | DEFAULT 1 |
| page_size | INT | DEFAULT 100 |
| rows_processed | BIGINT | |
| pages_processed | INT | |
| started_at | TIMESTAMPTZ | |
| last_attempt_at | TIMESTAMPTZ | |
| last_successful_page_at | TIMESTAMPTZ | |
| completed_at | TIMESTAMPTZ | |
| error_text | TEXT | |
| updated_at | TIMESTAMPTZ | |

**PK:** (tenant_id, sync_type)

**Indexes:**
- `idx_fitterhours_bootstrap_state_tenant` ON (tenant_id)
- `idx_fitterhours_bootstrap_state_status` ON (status)

---

### 13. `ek_fitterhours`

| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL | PK |
| tenant_id | TEXT | |
| external_fitterhour_id | TEXT | |
| external_fitter_id | TEXT | |
| external_project_id | TEXT | |
| external_fitter_category_id | TEXT | |
| fitter_reference_number | TEXT | |
| fitter_salary_id | TEXT | |
| fitter_name | TEXT | |
| hours | NUMERIC | |
| hours_original_value | NUMERIC | |
| category_reference | TEXT | |
| category_name | TEXT | |
| fitter_category_type | TEXT | |
| unit | TEXT | |
| work_type | TEXT | |
| work_type_id | TEXT | |
| project_reference | TEXT | |
| project_name | TEXT | |
| project_description | TEXT | |
| project_responsible | TEXT | |
| debtor_name | TEXT | |
| debtor_reference | TEXT | |
| department | TEXT | |
| ressource_group_string | TEXT | |
| approved_by | TEXT | |
| approved_date | TIMESTAMPTZ | |
| created_by | TEXT | |
| date | TIMESTAMPTZ | |
| date_created | TIMESTAMPTZ | |
| updated_date | TIMESTAMPTZ | |
| from_hour | TEXT | |
| to_hour | TEXT | |
| break_hour_as_decimal | NUMERIC | |
| expenses | NUMERIC | |
| piece_work | NUMERIC | |
| social_taxes | NUMERIC | |
| social_taxes_in_percent | NUMERIC | |
| basis_total_hours | NUMERIC | |
| overtime_total_hours | NUMERIC | |
| fitterhour_worktype_other_total_hours | NUMERIC | |
| basis_total_cost | NUMERIC | |
| overtime_total_cost | NUMERIC | |
| fitterhour_worktype_other_total_cost | NUMERIC | |
| dimension_department_id | TEXT | |
| dimension_carrier_id | TEXT | |
| dimension_purpose_id | TEXT | |
| is_intern | BOOLEAN | |
| is_complaint | BOOLEAN | |
| raw_payload_json | JSONB | |
| imported_at | TIMESTAMPTZ | DEFAULT NOW() |
| last_seen_at | TIMESTAMPTZ | DEFAULT NOW() |
| source_from_date | DATE | |
| source_to_date | DATE | |

**PK:** id (BIGSERIAL)
**Unique:** `ux_ek_fitterhours_tenant_external` ON (tenant_id, external_fitterhour_id)

**Indexes:**
- tenant, external_project_id, project_reference, external_fitter_id, fitter_name, external_fitter_category_id, approved_by, date

**FK:** None explicit (external_project_id relates to projects.project_uuid logically, but no FK constraint)

---

### 14. `ek_fittercategories`

| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL | PK |
| tenant_id | TEXT | |
| external_fitter_category_id | TEXT | |
| reference | TEXT | |
| description | TEXT | |
| display | TEXT | |
| include_illness | BOOLEAN | |
| include_in_salary_calculation | BOOLEAN | |
| salary_company_absence_code | TEXT | |
| bluegarden_salary_type | TEXT | |
| visma_salary_type | TEXT | |
| work_type_id | TEXT | |
| show_in_app | BOOLEAN | |
| is_only_for_internal_projects | BOOLEAN | |
| raw_payload_json | JSONB | |
| imported_at | TIMESTAMPTZ | |
| last_seen_at | TIMESTAMPTZ | |

**PK:** id
**Unique:** `ux_ek_fittercategories_tenant_external` ON (tenant_id, external_fitter_category_id)

---

### 15. `ekomplet_endpoint_runs` (harvester)

| Column | Type | Notes |
|---|---|---|
| run_id | TEXT | PK |
| started_at | TIMESTAMPTZ | |
| finished_at | TIMESTAMPTZ | |
| mode | TEXT | DEFAULT 'full' |
| status | TEXT | DEFAULT 'running' |
| total_fetches | INT | |
| total_items | INT | |
| total_errors | INT | |
| report | JSONB | |
| notes | TEXT | |

**PK:** run_id

---

### 16. `ekomplet_endpoint_fetches` (harvester)

| Column | Type | Notes |
|---|---|---|
| fetch_id | BIGSERIAL | PK |
| run_id | TEXT | FK conceptual → ekomplet_endpoint_runs |
| endpoint_name | TEXT | |
| api_version | TEXT | |
| path_called | TEXT | |
| phase | INT | DEFAULT 1 |
| page_num | INT | |
| http_status | INT | |
| item_count | INT | |
| raw_response | JSONB | |
| error_message | TEXT | |
| fetched_at | TIMESTAMPTZ | |

**Indexes:**
- `idx_ek_fetches_run_id` ON (run_id)
- `idx_ek_fetches_endpoint` ON (endpoint_name, api_version)

---

### 17. `ekomplet_endpoint_queue` (harvester)

| Column | Type | Notes |
|---|---|---|
| queue_id | BIGSERIAL | PK |
| run_id | TEXT | |
| endpoint_name | TEXT | |
| api_version | TEXT | |
| path_template | TEXT | |
| resolved_path | TEXT | |
| phase | INT | |
| parent_id_value | TEXT | |
| status | TEXT | DEFAULT 'pending' |
| attempts | INT | |
| max_attempts | INT | DEFAULT 6 |
| last_error | TEXT | |
| last_attempted_at | TIMESTAMPTZ | |
| completed_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | |

**Indexes:**
- `idx_ek_queue_run_status` ON (run_id, status)
- `idx_ek_queue_pending` ON (status, attempts, run_id) WHERE pending/retrying

---

### 18. `qa_threads`

| Column | Type | Notes |
|---|---|---|
| tenant_id | TEXT | PK part 1 |
| thread_id | TEXT | PK part 2 |
| title | TEXT | |
| context_type | TEXT | e.g. 'project' |
| context_id | TEXT | |
| status | TEXT | DEFAULT 'open' |
| created_by_user_id | TEXT | |
| last_message_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

**PK:** (tenant_id, thread_id)

**Indexes:**
- `idx_qa_threads_tenant_updated` ON (tenant_id, updated_at DESC)
- `idx_qa_threads_tenant_context` ON (tenant_id, context_type, context_id)

---

### 19. `qa_messages`

| Column | Type | Notes |
|---|---|---|
| tenant_id | TEXT | PK part 1 |
| message_id | TEXT | PK part 2 |
| thread_id | TEXT | |
| role | TEXT | |
| content | TEXT | |
| model | TEXT | |
| created_by_user_id | TEXT | |
| prompt_tokens | INT | |
| completion_tokens | INT | |
| total_tokens | INT | |
| created_at | TIMESTAMPTZ | |

**PK:** (tenant_id, message_id)
**FK:** (tenant_id, thread_id) → qa_threads ON DELETE CASCADE

**Indexes:**
- `idx_qa_messages_tenant_thread_created`
- `idx_qa_messages_tenant_role`

---

### 20. `qa_thread_views`

| Column | Type | Notes |
|---|---|---|
| tenant_id | TEXT | PK part 1 |
| thread_id | TEXT | PK part 2 |
| viewer_user_id | TEXT | PK part 3 |
| last_viewed_message_id | TEXT | |
| last_viewed_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

**PK:** (tenant_id, thread_id, viewer_user_id)
**FK:** (tenant_id, thread_id) → qa_threads ON DELETE CASCADE

**Indexes:**
- `idx_qa_thread_views_tenant_viewer`

---

### 21. `ai_usage_logs`

| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL | PK |
| tenant_id | TEXT | |
| thread_id | TEXT | |
| message_id | TEXT | |
| actor_user_id | TEXT | |
| provider | TEXT | |
| model | TEXT | |
| operation | TEXT | |
| status | TEXT | DEFAULT 'ok' |
| prompt_tokens | INT | |
| completion_tokens | INT | |
| total_tokens | INT | |
| cost_estimate | NUMERIC(12,6) | |
| error_code | TEXT | |
| created_at | TIMESTAMPTZ | |

**PK:** id
**FK:** (tenant_id, thread_id) → qa_threads ON DELETE SET NULL

**Indexes:**
- `idx_ai_usage_logs_tenant_created`
- `idx_ai_usage_logs_tenant_thread`
- `idx_ai_usage_logs_tenant_actor`

---

## Relation Overview

```
tenants (1) ──< tenant_features
tenants (1) ──< tenant_first_admin_contacts  (UNIQUE → max 1)
tenants (1) ──< tenant_admin_invites
tenants (1) ──< tenant_admin_credentials
tenants (1) ──< tenant_integration_credentials

users          (no FK to tenants — application isolation only)
projects       (no FK to tenants — application isolation only)
project_status_history  (no FK, no PK — UNKNOWN)
tenant_user_mappings    (no FK to tenants — application isolation only)
tenant_sync_state       (no FK to tenants — orphan risk)
tenant_fitterhours_bootstrap_state (no FK to tenants)
ek_fitterhours          (no FK — logical link via tenant_id + external_project_id)
ek_fittercategories     (no FK)

qa_threads (1) ──< qa_messages  (CASCADE)
qa_threads (1) ──< qa_thread_views  (CASCADE)
qa_threads (1) ──< ai_usage_logs    (SET NULL)

ekomplet_endpoint_runs (conceptual) ──< ekomplet_endpoint_fetches
ekomplet_endpoint_runs (conceptual) ──< ekomplet_endpoint_queue
```

---

## Known Gaps / Findings

| # | Observation | Severity |
|---|---|---|
| 1 | NO RLS policies anywhere — isolation is app-layer only | HIGH |
| 2 | `project_status_history` has no primary key | MEDIUM |
| 3 | `tenant_sync_state` / `tenant_fitterhours_bootstrap_state` have no FK to tenants (orphan risk) | MEDIUM |
| 4 | `users`, `projects`, `tenant_user_mappings`, `ek_fitterhours`, `ek_fittercategories` have no FK to `tenants` | MEDIUM |
| 5 | postgres.js seed INSERT references `slug` column not in CREATE TABLE for `tenants` | HIGH (runtime error risk) |
| 6 | `ekomplet_endpoint_fetches` / `ekomplet_endpoint_queue` have no FK to `ekomplet_endpoint_runs` | LOW |
| 7 | No `audit_events` table found in code. Locked decision in DECISIONS.md says audit is required | CRITICAL UNKNOWN |
| 8 | No `tenant_configuration_snapshots` table found. Required by FIELDESK_STATUS.md (locked) | CRITICAL UNKNOWN |
