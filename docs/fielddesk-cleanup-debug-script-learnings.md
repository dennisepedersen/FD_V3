# Fielddesk Cleanup: Debug Script Learnings

## Purpose

This note preserves useful learnings from temporary local debug and investigation scripts found during Fielddesk cleanup.

The original scripts are local cleanup artifacts and should not be committed as-is. Several contain hardcoded tenant or project references, live endpoint probing, production environment loading, repair/reset logic, or token-generation helpers.

This document intentionally does not include secrets, tokens, encrypted API keys, full connection strings, live credentials, or executable repair/reset code.

## Fitterhour Sync Learnings

The fitterhour investigation scripts showed that sync health needs to be understood across several layers, not only by counting rows in `fitter_hour`.

Useful operational checks:

- Inspect endpoint state for `fitterhours`, including status, last attempt/success timestamps, paging/cursor fields, row counters, backlog counters, failed pages, and last error.
- Compare endpoint state with recent `sync_job` records to determine whether a sync is idle, stuck, recently completed, or failing repeatedly.
- Validate database row counts after sync by tenant and by project reference.
- Cross-check project-hour visibility through the same business query layer used by the app, not only through raw `fitter_hour` totals.
- Separate raw imported hours from business-relevant hours after category filters are applied.
- Verify that UI-facing totals remain scoped by tenant and project assignment rules.

The cleanup scripts also showed that manual repair or reset operations are risky when mixed with investigation scripts. Read-only checks should be separated from mutation tools.

## EK Live Endpoint Learnings

Some temporary scripts probed live E-Komplet fitterhour endpoints to compare remote data with local synchronized rows.

Useful conceptual learnings:

- Live endpoint probing can help determine whether missing local rows are caused by sync state, pagination boundaries, filter parameters, or local mapping logic.
- `updatedAfter` behavior must be verified carefully. A date filter can change which pages contain relevant rows, and page scanning may miss older project rows if the scan stops too early.
- API pagination should be treated as an operational contract that needs evidence: page size, max pages, retry behavior, and termination conditions should be logged conceptually.
- Endpoint probing should never print API keys, bearer tokens, encrypted credentials, or decrypted credential values.
- Any learning from live endpoint probes should be moved into documentation or tested integration assumptions before code is committed.

Live endpoint scripts should remain outside the repo unless rewritten as safe, parameterized, read-only tooling.

## Project Filter / Reference Case Learnings

The `80279-003` investigation was useful as a non-secret operational reference case for fitterhour matching and business-hour filtering.

Important learnings:

- Project matching may need to compare multiple reference forms, including external project references and EK project identifiers.
- Raw fitterhour rows can match through different fields, so verification should inspect both `external_project_ref` and imported project-id-like values.
- Business totals differ from raw totals because internal-only categories, absence/leave categories, allowance categories, and non-invoice categories may be excluded.
- Category matching should be verified with both category metadata and raw payload text fields.
- A single reference project is useful for diagnosis, but future scripts should accept project references as parameters instead of hardcoding them.
- Multi-project verification is more valuable than single-project verification when validating generalized business rules.

Avoid personal data in future docs and tooling. If a person's name appears during investigation, preserve only the finding unless the name is required for a reproducible test fixture.

## Risk Classification

The original local scripts were classified into these categories:

- Read-only investigation: scripts that query database state, schema, counts, project-hour totals, or sync status without writing data.
- Live endpoint/API risk: scripts that call live EK endpoints, decrypt stored API credentials, generate request headers, or depend on production-like endpoint configuration.
- Repair/reset/mutation risk: scripts that update sync state, enqueue/reset operational state, or upsert fitterhour rows.
- Duplicate/obsolete variants: iterative debug scripts created during one investigation, where later versions overlap earlier versions.

## Future Dev-Script Rule

Any future Fielddesk dev scripts should follow these rules before being committed:

- Be parameterized through CLI flags or safe environment variables.
- Avoid hardcoded tenants, projects, users, domains, or dates unless they are clearly documented test fixtures.
- Default to read-only behavior.
- Require explicit confirmation for mutation.
- Never print secrets, tokens, decrypted credentials, full connection strings, or authorization headers.
- Avoid casual use of `.env.production`; prefer local development configuration or explicit operator confirmation.
- Include dry-run mode for repair tools.
- Separate investigation scripts from repair/reset scripts.
- Log operational evidence without leaking credentials or personal data.
- Be reviewed before committing.

## Files Reviewed

- `check_fitterhours_sync_state.js`
- `check_morten_2026_02_09.js`
- `check_sync_progress.js`
- `check_tenant_host_resolution.js`
- `debug_80279_003.js`
- `debug_80279_003_b.js`
- `debug_80279_003_c.js`
- `debug_80279_003_category_match.js`
- `debug_80279_003_d.js`
- `debug_80279_003_ek_date_probe.js`
- `debug_80279_003_ek_probe.js`
- `debug_80279_003_ek_updatedafter.js`
- `debug_80279_003_targeted.js`
- `debug_fitterhour_date_coverage.js`
- `debug_project_filters.js`
- `final_report.js`
- `find_projects_with_fitterhours.js`
- `find_sync_tables.js`
- `inspect_sync_endpoint_state.js`
- `inspect_sync_job_schema.js`
- `inspect_tenant_domain_schema.js`
- `prepare_live_endpoint_call.js`
- `repair_80279_003_fitterhours.js`
- `repair_80279_003_fitterhours_fast.js`
- `reset_fitterhours_sync_state.js`
- `verify_80279_003_after_fix.js`
- `verify_80279_003_complete.js`
- `verify_multiple_projects.js`
- `verify_three_projects.js`
