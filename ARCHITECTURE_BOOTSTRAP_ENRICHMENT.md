# Architecture Decision: Bootstrap vs. Enrichment Separation

**Date:** 2026-04-05  
**Status:** IMPLEMENTED  
**Scope:** Project sync flow in `backend/src/services/syncWorker.js`

---

## Problem

Previously, V4 (projects_v4) and V3 (projects_v3) endpoints were treated symmetrically in a single loop. If V3 discovery or paging failed (e.g., 404, 429), the entire bootstrap job would fail—even if V4 had successfully persisted all project masterdata.

**Example failure scenario:**
- V4 bootstrap: pages 1-147 ✓ Successfully persisted 810 rows to `project_masterdata_v4`
- V3 enrichment: discovery probe returns 404  
- Result: **Job status = FAILED** ✗ (despite V4 success)

This was fragile because:
- V4 = Project core/masterdata (critical for system operation)
- V3 = Project WIP/activity/economics (valuable but optional enrichment)
- V3 unavailability = Not project masterdata problem, yet killed the whole job

---

## Solution: Two-Phase Architecture

### Phase A: Bootstrap (V4) — CRITICAL
- Source: `/api/v4.0/projects` (primary E-Komplet projects API)
- Tables: `project_core`, `project_masterdata_v4`
- Failure behavior: **FATAL** — if V4 fails, entire job fails
- Logging: `[syncWorker] BOOTSTRAP-PHASE` prefixed messages
- Error handling: Errors thrown to `processSyncJob` catch block

### Phase B: Enrichment (V3) - OPTIONAL
- Source: `/Management/WorkInProgress` (activity/WIP API endpoints)
- Tables: `project_wip`, transaction/economics related
- Failure behavior: **NON-FATAL** — logged but does not fail job if Phase A succeeded
- Logging: `[syncWorker] ENRICHMENT-PHASE` prefixed messages
- Error handling: Caught locally, does not bubble to job-level failure

---

## Implementation Changes

### Before: Single Loop (Old)
```javascript
for (const source of sources) {  // ["projects_v4", "projects_v3"]
  const compatibleEndpoints = await discoverCompatibleProjectEndpoints(...);
  // ... paging loop ...
  // If ANY error on V3: throws → processSyncJob catches → job fails
}
```

**Outcome:** V3 404 = Job failed ✗

---

### After: Two-Phase Coordinator (New)
```javascript
async function runProjectsEndpoint({ job, cfg, mode }) {
  let bootstrapPhaseSucceeded = false;

  for (const source of sources) {  // ["projects_v4", "projects_v3"]
    const endpointKey = source.endpointKey;
    const isBootstrapPhase = endpointKey === "projects_v4";
    const isEnrichmentPhase = endpointKey === "projects_v3";

    if (isEnrichmentPhase && bootstrapPhaseSucceeded) {
      // Phase B: Enrichment (optional, non-fatal)
      try {
        const result = await runProjectsSourceSync(...);
        // ... accumulate results ...
      } catch (error) {
        // Log enrichment error but do NOT throw
        console.warn(`ENRICHMENT-PHASE error (non-fatal): ${error.message}`);
        // Mark endpoint state as "partial" + "enrichment_phase_skipped"
        // Continue to end of job
      }
      continue;
    }

    if (isBootstrapPhase) {
      // Phase A: Bootstrap (critical, fatal on error)
      try {
        const result = await runProjectsSourceSync(...);
        bootstrapPhaseSucceeded = true;
        // ... accumulate results ...
      } catch (error) {
        // Bootstrap error IS fatal → throw to processSyncJob
        console.error(`BOOTSTRAP-PHASE failed (FATAL): ${error.message}`);
        throw error;
      }
      continue;
    }
  }

  return { pagesProcessed, rowsProcessed, retriesQueued };
}

// Helper: Extract the paging logic for a single source
async function runProjectsSourceSync({ job, cfg, mode, source, headers }) {
  // Contains: discoverCompatibleProjectEndpoints, paging loop, 
  // persistProjectsPage, page state management
}
```

**Outcome:** V3 404 with V4 success = Job succeeds ✓

---

## Error Handling Flow

### V4 Bootstrap Phase
```
Try: Run V4 discovery + paging
├─ Success → bootstrapPhaseSucceeded = true, continue
└─ Error  → throw (fatal) → processSyncJob catches → job status = "failed"

Logging prefix: `[syncWorker] BOOTSTRAP-PHASE`
```

### V3 Enrichment Phase (only runs if V4 succeeded)
```
Try: Run V3 discovery + paging
├─ Success → accumulate results, continue
└─ Error  → catch locally, log warning, mark endpoint "partial", continue
           (does NOT throw, does NOT fail job)

Logging prefix: `[syncWorker] ENRICHMENT-PHASE`
```

---

## Job Status Semantics

| Scenario | V4 | V3 | Final Job Status | `sync_endpoint_state` |
|----------|----|----|------------------|-----------------------|
| Both succeed | ✓ | ✓ | `"success"` | V4: `"success"`, V3: `"success"` |
| V4 success, V3 404 | ✓ | ✗ | `"success"` | V4: `"success"`, V3: `"partial"` + errorMessage: `"enrichment_phase_skipped: ..."` |
| V4 success, V3 other-error | ✓ | ✗ | `"success"` | V4: `"success"`, V3: `"partial"` + errorMessage: `"enrichment_phase_skipped: ..."` |
| V4 failed, V3 not attempted | ✗ | — | `"failed"` | V4: `"partial"` or `"failed"`, V3: not updated |

---

## Metrics & Logging

### Bootstrap Phase Logs
```
[syncWorker] BOOTSTRAP-PHASE completed endpoint=projects_v4 pages=147 rows=810
```

### Enrichment Phase Logs (Success)
```
[syncWorker] ENRICHMENT-PHASE completed endpoint=projects_v3 pages=102 rows=340
```

### Enrichment Phase Logs (Failure - Non-Fatal)
```
[syncWorker] ENRICHMENT-PHASE error (bootstrap succeeded, so non-fatal): endpoint=projects_v3 msg=E-Komplet request failed (404)
```

---

## Database State

### `sync_endpoint_state` table
After successful bootstrap with failed enrichment:

```sql
SELECT endpoint_key, status, pages_processed_last_job, rows_persisted_last_job, error_message
FROM sync_endpoint_state
WHERE tenant_id = '...' AND job_id = '...'
ORDER BY endpoint_key;

-- Output:
endpoint_key  | status  | pages_processed_last_job | rows_persisted_last_job | error_message
projects_v4   | success | 147                      | 810                     | NULL
projects_v3   | partial | 0                        | 0                       | enrichment_phase_skipped: E-Komplet request failed (404)
```

---

## Code Changes Summary

**File:** `backend/src/services/syncWorker.js`

### New Functions
- `runProjectsEndpoint()` (Refactored coordinator with phase logic)
- `runProjectsSourceSync()` (Extracted paging logic for reuse)

### Modified Error Handling
- **V4 errors:** Thrown to job-level failure (unchanged behavior for bootstrap)
- **V3 errors:** Caught locally, logged, marked as "enrichment_phase_skipped" (NEW behavior)

### Removed
- None; old logic moved to `runProjectsEndpoint_DEPRECATED()` (kept as comments for reference)

---

## Benefits

✅ **Bootstrap robustness:** V4 success + V3 failure no longer cascades to job failure  
✅ **Clear separation:** Bootstrap vs. enrichment intent explicit in code  
✅ **Actionable logging:** Phase prefix (`BOOTSTRAP-PHASE` vs `ENRICHMENT-PHASE`) clarifies criticality  
✅ **Graceful degradation:** System operates on V4 masterdata even if V3 enrichment unavailable  
✅ **Future flexibility:** V3 retries can be scheduled separately without impacting V4 data integrity  

---

## Testing Recommendations

### Test Case 1: V4 Success + V3 Discovery 404
- Bootstrap: Fetch `/api/v4.0/projects?page=1...` (succeeds)
- Enrichment: Fetch `/api/v3/Management/WorkInProgress` (404)
- Expected: Job status = `"success"`, V4 rows persisted, V3 marked "enrichment_phase_skipped"

### Test Case 2: V4 Success + V3 Rate-Limited (429)
- Bootstrap: Fetch V4 (succeeds)
- Enrichment: Fetch V3 (429 rate-limit)
- Expected: Job status = `"success"`, V4 rows persisted, V3 error logged

### Test Case 3: V4 Fail (Fatal)
- Bootstrap: Fetch `/api/v4.0/projects` (500 server error)
- Enrichment: Not attempted
- Expected: Job status = `"failed"`, retry scheduled, V4 state = "partial"

---

## Migration Notes

Existing jobs/data unaffected. New bootstrap jobs will use this architecture automatically.  
No schema changes. No frontend changes. No user-facing behavior change (success rate improves).

