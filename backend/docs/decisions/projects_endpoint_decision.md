# Decision: Projects Endpoint Strategy

Status: verified decision
Date: 2026-04-11

## Decision
- Use projects_v4 as authoritative source for project existence and open/closed status.
- Use projects_v3 WorkInProgress only as enrichment on existing project_core rows.

## Why
- syncWorker treats v4 bootstrap phase as fatal if it fails.
- v3 enrichment is explicitly non-fatal when v4 bootstrap succeeds.
- mapProjectRow enforces source-specific status semantics.

## Consequences
- No new projects are created from v3 alone.
- Close-state truth is anchored in v4 and closed_observed_at retention logic.
- Cleanup of inactive projects is allowed only after terminal v4 pass with zero retries/backlog.
