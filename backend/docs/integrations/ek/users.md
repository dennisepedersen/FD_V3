# EK Users Contract

Contract status: observed
Endpoint family: generic users endpoint variants from syncWorker
Consumer: backend/src/services/syncWorker.js

## Purpose
- Endpoint may be selected in tenant_endpoint_selection.
- Current implementation is read-only/non-materialized in this repo state.

## Verified Behavior
- users is included in READ_ONLY_ENDPOINT_KEYS.
- runReadOnlyEndpoint can fetch/paginate/log/backlog users pages.
- Materialized persist table for users is not implemented in current backend/src/services/syncWorker.js.
- Endpoint state marks non-materialized flows with persist_skipped:no_supported_table.

## Verified Allowed Usage
- Connectivity validation
- Endpoint health/paging behavior
- Sync state observability

## Unclear
- Definitive users table mapping in Fielddesk V3 schema for EK users payload is unclear in this codebase snapshot.
- No schema change is introduced by this audit.
